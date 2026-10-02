import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDraft, type Draft } from '../visit/draft';
import type { CachedPatient, QueueSnapshot, SignedOffline } from './cache';
import { newKey, seal } from './crypto';
import { dbName, LocalStoreError, MemoryStore, openEncryptedStore, pendingOnDevice, purgeLegacySessionDrafts, type LocalStore, type OpMeta } from './store';

const owner = { tenant: 'noi-tong-quat', userId: 'noi-doctor' };
const SECRET_SYMPTOMS = 'Đau họng, sốt nhẹ, không ho';
const SECRET_REASON = 'Nguyễn Văn An tái khám tăng huyết áp';

const draft = (over: Partial<Draft> = {}): Draft => ({ ...newDraft(SECRET_REASON), symptoms: SECRET_SYMPTOMS, diagnoses: ['J02.9'], ...over });

const opened: LocalStore[] = [];
const open = async (o = owner) => {
  const s = await openEncryptedStore(o);
  opened.push(s);
  return s;
};

afterEach(async () => {
  for (const s of opened.splice(0)) await s.destroy().catch(() => undefined);
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

/** Đọc thẳng IndexedDB như một người mở tệp của trình duyệt: mọi bản ghi của mọi bảng, mọi byte. */
async function rawDump(name: string): Promise<{ text: string; rows: Array<Record<string, unknown>> }> {
  const db = new Dexie(name);
  await db.open();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of db.tables) rows.push(...((await table.toArray()) as Array<Record<string, unknown>>));
  db.close();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = rows
    .map((r) =>
      Object.values(r)
        .map((v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? decoder.decode(v as ArrayBuffer) : JSON.stringify(v)))
        .join(' ')
    )
    .join('\n');
  return { text, rows };
}

describe('kho bản nháp mã hóa trên máy', () => {
  it('lưu, đọc lại, xóa', async () => {
    const s = await open();
    expect(s.persistent).toBe(true);
    expect(await s.getDraft('v1')).toBeUndefined();
    const d = draft();
    await s.putDraft('v1', d);
    expect(await s.getDraft('v1')).toEqual(d);
    await s.deleteDraft('v1');
    expect(await s.getDraft('v1')).toBeUndefined();
  });

  it('trên đĩa không có chữ nào của bản nháp ở dạng rõ (tên, lý do, triệu chứng, mã chẩn đoán)', async () => {
    const s = await open();
    await s.putDraft('v1', draft());
    const { text, rows } = await rawDump(dbName(owner));
    expect(rows.length).toBeGreaterThanOrEqual(2); // khóa + bản nháp
    for (const secret of [SECRET_SYMPTOMS, SECRET_REASON, 'Nguyễn', 'J02.9', 'symptoms']) expect(text).not.toContain(secret);
  });

  it('mỗi lần ghi một IV mới: cùng nội dung ghi hai lần cho hai bản mã khác nhau', async () => {
    const s = await open();
    const d = draft();
    await s.putDraft('v1', d);
    const first = (await rawDump(dbName(owner))).rows.find((r) => r['id'] === 'v1')!;
    await s.putDraft('v1', d);
    const second = (await rawDump(dbName(owner))).rows.find((r) => r['id'] === 'v1')!;
    expect(Buffer.from(first['iv'] as Uint8Array).equals(Buffer.from(second['iv'] as Uint8Array))).toBe(false);
    expect(Buffer.from(first['ct'] as ArrayBuffer).equals(Buffer.from(second['ct'] as ArrayBuffer))).toBe(false);
  });

  it('bản mã gắn với chỗ của nó: chép bản nháp của lượt khám này sang lượt khám khác thì không đọc được (không lẫn hồ sơ)', async () => {
    const s = await open();
    await s.putDraft('v1', draft());
    s.close();
    const db = new Dexie(dbName(owner));
    await db.open();
    const row = (await db.table('drafts').get('v1')) as Record<string, unknown>;
    await db.table('drafts').put({ ...row, id: 'v2' });
    db.close();
    const again = await open();
    await expect(again.getDraft('v2')).rejects.toBeInstanceOf(LocalStoreError);
    expect(await again.getDraft('v1')).toEqual(draft({ clientUuid: (await again.getDraft('v1'))!.clientUuid }));
  });

  it('khóa không xuất được ra JavaScript', async () => {
    await open();
    const db = new Dexie(dbName(owner));
    await db.open();
    const { key } = (await db.table('meta').get('key')) as { key: CryptoKey };
    db.close();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('mở lại (tải lại trang) dùng đúng khóa cũ', async () => {
    const a = await open();
    await a.putDraft('v1', draft({ symptoms: 'trước khi tải lại' }));
    a.close();
    const b = await open();
    expect((await b.getDraft('v1'))?.symptoms).toBe('trước khi tải lại');
  });

  it('hai tab mở lần đầu cùng lúc: tab đến sau dùng khóa của tab đến trước, không ghi đè (dữ liệu của tab kia vẫn đọc được)', async () => {
    // Tab kia mở kho và ghi nháp đúng lúc tab này đang sinh khóa (khe hở giữa "đọc thấy chưa có khóa" và "thêm khóa").
    const generate = crypto.subtle.generateKey.bind(crypto.subtle);
    let raced = false;
    const spy = vi.spyOn(crypto.subtle, 'generateKey').mockImplementation((async (...args: Parameters<typeof generate>) => {
      if (!raced) {
        raced = true;
        const other = await open();
        await other.putDraft('v1', draft({ symptoms: 'từ tab kia' }));
      }
      return generate(...args);
    }) as typeof crypto.subtle.generateKey);
    try {
      const mine = await open();
      expect(raced).toBe(true);
      expect((await mine.getDraft('v1'))?.symptoms).toBe('từ tab kia');
      await mine.putDraft('v2', draft({ symptoms: 'từ tab này' }));
      expect((await (await open()).getDraft('v2'))?.symptoms).toBe('từ tab này');
    } finally {
      spy.mockRestore();
    }
  });

  it('nhiều lần ghi liên tiếp không chờ nhau: bản đọc ra là bản ghi sau cùng', async () => {
    const s = await open();
    const writes = Array.from({ length: 25 }, (_, i) => s.putDraft('v1', draft({ symptoms: `lần ${i}` })));
    const read = s.getDraft('v1'); // đọc xếp sau mọi lần ghi
    await Promise.all(writes);
    expect((await read)?.symptoms).toBe('lần 24');
  });

  it('mỗi người dùng một kho riêng; đăng xuất xóa cả kho lẫn khóa của người đó, không đụng kho người khác', async () => {
    const mine = await open();
    const other = await open({ tenant: owner.tenant, userId: 'noi-owner' });
    await mine.putDraft('v1', draft());
    await other.putDraft('v1', draft({ symptoms: 'của người khác' }));
    expect(dbName(owner)).not.toBe(dbName({ tenant: owner.tenant, userId: 'noi-owner' }));
    await mine.destroy();
    const names = await Dexie.getDatabaseNames();
    expect(names).not.toContain(dbName(owner));
    expect(names).toContain(dbName({ tenant: owner.tenant, userId: 'noi-owner' }));
    expect((await other.getDraft('v1'))?.symptoms).toBe('của người khác');
    // Đăng nhập lại sau khi đăng xuất: kho mới, khóa mới, không còn gì cũ.
    const fresh = await open();
    expect(await fresh.getDraft('v1')).toBeUndefined();
  });
});

describe('dự phòng khi trình duyệt không có kho mã hóa', () => {
  it('kho trong bộ nhớ: persistent = false, giữ bản sao (không bị sửa ngầm qua tham chiếu)', async () => {
    const m = new MemoryStore();
    const d = draft();
    await m.putDraft('v1', d);
    d.symptoms = 'sửa sau khi lưu';
    expect(m.persistent).toBe(false);
    expect((await m.getDraft('v1'))?.symptoms).toBe(SECRET_SYMPTOMS);
    await m.destroy();
    expect(await m.getDraft('v1')).toBeUndefined();
  });

  it('bản nháp dạng rõ do bản trước để lại trong sessionStorage bị xóa khi khởi động, phiên đăng nhập giữ nguyên', () => {
    const data = new Map<string, string>([
      ['phongmach.draft.v1', JSON.stringify(draft())],
      ['phongmach.auth', '{"token":"t"}'],
    ]);
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    // Object.keys(sessionStorage) liệt kê các khóa: giả lập bằng Proxy.
    const storage = new Proxy(fake, { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
    (globalThis as { sessionStorage?: unknown }).sessionStorage = storage;
    try {
      purgeLegacySessionDrafts();
      expect([...data.keys()]).toEqual(['phongmach.auth']);
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});

const PATIENT = { id: 'p1', fullName: 'Nguyễn Văn An', phone: '0912345678', cccdMasked: '••••••••6789', birthDate: '1985-03-15' };
const opMeta = (over: Partial<OpMeta> = {}): OpMeta => ({ seq: 1, kind: 'complete', status: 'pending', deps: [], day: '2026-10-20', createdAt: 1, attempts: 0, nextAt: 0, ...over });

describe('kho version 2: hàng đợi đồng bộ và bộ đệm ngoại tuyến', () => {
  it('nâng cấp từ version 1: bản nháp cũ vẫn đọc được, có thêm các bảng mới', async () => {
    // Dựng đúng kho của lát 2 (version 1: khóa + bản nháp đã mã hóa).
    const v1 = new Dexie(dbName(owner));
    v1.version(1).stores({ meta: 'k', drafts: 'id' });
    await v1.open();
    const key = await newKey();
    await v1.table('meta').add({ k: 'key', key });
    await v1.table('drafts').put({ id: 'v1', ...(await seal(key, 'drafts:v1', draft())), updatedAt: 1 });
    v1.close();

    const s = await open();
    expect((await s.getDraft('v1'))?.symptoms).toBe(SECRET_SYMPTOMS);
    const raw = new Dexie(dbName(owner));
    await raw.open();
    expect(raw.verno).toBe(2);
    expect(raw.tables.map((t) => t.name).sort()).toEqual(['drafts', 'ids', 'meta', 'ops', 'patients', 'signed', 'snapshots']);
    raw.close();
  });

  it('trên đĩa không có dữ liệu bệnh nhân ở dạng rõ trong mọi bảng mới (hàng đợi, bộ đệm, hàng chờ, đơn ký khi mất mạng)', async () => {
    const s = await open();
    const cached: CachedPatient = { patient: PATIENT, allergies: [{ id: 'a1', kind: 'class', value: 'penicillin', label: 'Penicillin' }], cccd: '001085006789' };
    const snapshot: QueueSnapshot = { day: '2026-10-20', fetchedAt: 'x', items: [{ id: 'v1', number: 7, code: '20261020-007', status: 'waiting', priority: 'normal', specialty: 'noi', patientId: 'p1', patientName: PATIENT.fullName, arrivedAt: 'x', reason: SECRET_REASON }] };
    const signed = { clinicName: 'Phòng khám Nội', completeOpId: 'c1', detail: { encounterId: 'v1', patient: PATIENT, diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp' }], prescription: { id: 'r1', code: 'PM-261020-AAAAAA', signedAt: 'x', patientId: 'p1', lines: [{ drug: 'AMOX', name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống' }], acknowledgements: [] } } } satisfies SignedOffline;
    await s.commit([
      { table: 'ops', id: 'c1', plain: opMeta(), value: { payload: { visitId: 'v1', body: { clientUuid: 'c1', exam: { symptoms: SECRET_SYMPTOMS, vitals: {} }, diagnoses: ['J02.9'] } } } },
      { table: 'ops', id: 'p0', plain: opMeta({ kind: 'patient', seq: 0 }), value: { payload: { tmpId: 'tmp-1', input: { clientUuid: 'p0', fullName: PATIENT.fullName, phone: PATIENT.phone, cccd: '001085006789' } } } },
      { table: 'patients', id: 'p1', plain: { day: '2026-10-20' }, value: cached },
      { table: 'snapshots', id: '2026-10-20', plain: { day: '2026-10-20' }, value: snapshot },
      { table: 'signed', id: 'r1', plain: { day: '2026-10-20' }, value: signed },
      { table: 'ids', id: 'tmp-1', serverId: 'p1', day: '2026-10-20' },
    ]);
    const { text, rows } = await rawDump(dbName(owner));
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const secret of ['Nguyễn', 'Nguyen', '0912345678', '6789', '001085006789', 'Penicillin', 'penicillin', 'Amoxicillin', 'J02.9', 'Viêm', SECRET_SYMPTOMS, SECRET_REASON, 'fullName', 'symptoms']) {
      expect(text).not.toContain(secret);
    }
    // Dạng rõ chỉ có id, trạng thái, thời điểm, loại thao tác, thứ tự, phụ thuộc, ngày.
    const op = rows.find((r) => r['id'] === 'c1')!;
    expect(Object.keys(op).sort()).toEqual(['attempts', 'createdAt', 'ct', 'day', 'deps', 'id', 'iv', 'kind', 'nextAt', 'seq', 'status', 'updatedAt']);
    // Đọc lại đúng.
    expect((await s.get<'patients', CachedPatient>('patients', 'p1'))?.value).toEqual(cached);
    expect((await s.list<'ops', unknown>('ops')).map((r) => [r.id, r.plain.kind])).toEqual(expect.arrayContaining([['c1', 'complete'], ['p0', 'patient']]));
    expect(await s.ids()).toEqual(new Map([['tmp-1', 'p1']]));
  });

  it('một lần commit là một giao dịch: một thay đổi lỗi thì không thay đổi nào được ghi', async () => {
    const s = await open();
    await s.putDraft('v1', draft());
    await expect(
      s.commit([
        { table: 'ops', id: 'c1', plain: opMeta(), value: { payload: {} } },
        { table: 'drafts', id: 'v1', delete: true },
        // Khóa không hợp lệ: IndexedDB từ chối, cả giao dịch bị hủy.
        { table: 'ids', id: undefined as unknown as string, serverId: 'x', day: '2026-10-20' },
      ])
    ).rejects.toThrow();
    expect(await s.pendingCount()).toBe(0);
    expect(await s.getDraft('v1')).toBeDefined();
  });

  it('dọn bộ đệm ngày cũ; mục chưa đồng bộ của ngày cũ không bao giờ bị dọn (kèm ánh xạ id nó cần)', async () => {
    const s = await open();
    const day = (d: string) => ({ day: d });
    await s.commit([
      { table: 'patients', id: 'old', plain: day('2026-10-19'), value: { patient: PATIENT } },
      { table: 'patients', id: 'today', plain: day('2026-10-20'), value: { patient: PATIENT } },
      { table: 'snapshots', id: '2026-10-19', plain: day('2026-10-19'), value: {} },
      { table: 'signed', id: 'r-old', plain: day('2026-10-19'), value: {} },
      { table: 'ops', id: 'old-done', plain: opMeta({ day: '2026-10-19', status: 'done' }), value: { payload: {} } },
      { table: 'ops', id: 'old-pending', plain: opMeta({ day: '2026-10-19', status: 'retry' }), value: { payload: {} } },
      { table: 'ops', id: 'old-conflict', plain: opMeta({ day: '2026-10-19', status: 'conflict' }), value: { payload: {} } },
      { table: 'ids', id: 'tmp-old', serverId: 'srv', day: '2026-10-19' },
    ]);
    await s.purgeBefore('2026-10-20');
    expect((await s.list('patients')).map((r) => r.id)).toEqual(['today']);
    expect(await s.list('snapshots')).toEqual([]);
    expect(await s.list('signed')).toEqual([]);
    expect((await s.list('ops')).map((r) => r.id).sort()).toEqual(['old-conflict', 'old-pending']);
    expect((await s.ids()).get('tmp-old')).toBe('srv');
    expect(await s.pendingCount()).toBe(2);
  });

  it('bản nháp mới nhất trong các id của cùng một lượt khám (id máy chủ và id tạm)', async () => {
    const s = await open();
    await s.putDraft('tmp-v', draft({ symptoms: 'cũ' }));
    await s.putDraft('srv-v', draft({ symptoms: 'mới' }));
    expect((await s.latestDraft(['tmp-v', 'srv-v']))?.draft.symptoms).toBe('mới');
    await s.putDraft('tmp-v', draft({ symptoms: 'mới hơn' }));
    expect(await s.latestDraft(['srv-v', 'tmp-v'])).toMatchObject({ id: 'tmp-v', draft: { symptoms: 'mới hơn' } });
    expect(await s.latestDraft(['khác'])).toBeUndefined();
  });

  it('màn hình đăng nhập biết máy còn bao nhiêu mục chưa đồng bộ của ai, chỉ đọc số đếm và tên nhân viên', async () => {
    const doctor = await open();
    await doctor.setOwnerName('BS. Lê Thị Thu Hà');
    await doctor.commit([
      { table: 'ops', id: 'a', plain: opMeta(), value: { payload: { secret: SECRET_SYMPTOMS } } },
      { table: 'ops', id: 'b', plain: opMeta({ status: 'conflict' }), value: { payload: {} } },
      { table: 'ops', id: 'c', plain: opMeta({ status: 'done' }), value: { payload: {} } },
    ]);
    const assistant = await open({ tenant: owner.tenant, userId: 'noi-assistant' });
    await assistant.setOwnerName('Phụ tá Lan');
    await assistant.commit([{ table: 'ops', id: 'a', plain: opMeta({ status: 'done' }), value: { payload: {} } }]);
    doctor.close();
    assistant.close();
    expect(await pendingOnDevice()).toEqual([{ tenant: 'noi-tong-quat', userId: 'noi-doctor', userName: 'BS. Lê Thị Thu Hà', count: 2 }]);
  });
});
