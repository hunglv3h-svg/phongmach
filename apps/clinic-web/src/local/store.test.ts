import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDraft, type Draft } from '../visit/draft';
import { dbName, LocalStoreError, MemoryStore, openEncryptedStore, purgeLegacySessionDrafts, type DraftStore } from './store';

const owner = { tenant: 'noi-tong-quat', userId: 'noi-doctor' };
const SECRET_SYMPTOMS = 'Đau họng, sốt nhẹ, không ho';
const SECRET_REASON = 'Nguyễn Văn An tái khám tăng huyết áp';

const draft = (over: Partial<Draft> = {}): Draft => ({ ...newDraft(SECRET_REASON), symptoms: SECRET_SYMPTOMS, diagnoses: ['J02.9'], ...over });

const opened: DraftStore[] = [];
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
