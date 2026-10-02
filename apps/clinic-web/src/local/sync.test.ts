import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteRequest, NewPatient } from '../api';
import { FakeBff, FakeClock } from './fakeBff';
import { newTmpId, type NewOp } from './ops';
import { dbName, openEncryptedStore, type LocalStore, type Owner } from './store';
import { SyncEngine, inTabLocks, type Locks, type Session, type SyncOptions } from './sync';

const owner: Owner = { tenant: 'noi', userId: 'doc' };
const docSession: Session = { token: 'tok-doc', tenant: 'noi', userId: 'doc' };

let bff: FakeBff;
let clock: FakeClock;
let online: boolean;
const opened: LocalStore[] = [];
const engines: SyncEngine[] = [];

async function openStore(o: Owner = owner): Promise<LocalStore> {
  const s = await openEncryptedStore(o);
  opened.push(s);
  return s;
}

function engine(store: LocalStore, over: Partial<SyncOptions> = {}): SyncEngine {
  const e = new SyncEngine({ store, owner, session: () => docSession, clock, isOnline: () => online, baseMs: 1000, capMs: 8000, periodMs: 30_000, ...over });
  engines.push(e);
  return e;
}

beforeEach(() => {
  bff = new FakeBff();
  clock = new FakeClock();
  online = true;
  vi.stubGlobal('fetch', bff.fetch);
});

afterEach(async () => {
  for (const e of engines.splice(0)) e.stop();
  for (const s of opened.splice(0)) await s.destroy().catch(() => undefined);
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
  vi.unstubAllGlobals();
});

const patientOp = (fullName = 'Nguyễn Văn An', phone = '0912345678'): Extract<NewOp, { kind: 'patient' }> => {
  const input: NewPatient = { clientUuid: crypto.randomUUID(), fullName, phone };
  return { id: input.clientUuid, kind: 'patient', payload: { tmpId: newTmpId(), input } };
};

/** Một chuỗi đầy đủ làm lúc mất mạng: tạo bệnh nhân → cấp số → mở hồ sơ → ký → ghi nhận in, toàn id tạm. */
function offlineChain(fullName = 'Nguyễn Văn An') {
  const p = patientOp(fullName);
  const visitTmpId = newTmpId();
  const rxTmpId = newTmpId();
  const checkin: NewOp = {
    id: crypto.randomUUID(),
    kind: 'checkin',
    deps: [p.id],
    payload: {
      visitTmpId,
      body: { clientUuid: '', patientId: p.payload.tmpId, specialty: 'noi', priority: 'normal', arrivedAt: '2026-10-20T03:00:00.000Z', proposedNumber: 1 },
      display: { patientName: fullName },
    },
  };
  (checkin.payload as { body: { clientUuid: string } }).body.clientUuid = checkin.id;
  const open: NewOp = { id: crypto.randomUUID(), kind: 'open', deps: [checkin.id], payload: { visitId: visitTmpId, openedAt: '2026-10-20T03:01:00.000Z' } };
  const body: CompleteRequest = {
    clientUuid: crypto.randomUUID(),
    exam: { symptoms: 'Đau họng, sốt nhẹ', vitals: {} },
    diagnoses: ['J02.9'],
    prescription: { lines: [{ drug: 'X' }], acknowledgements: [{ key: 'allergy-unknown', reason: 'Đã hỏi bệnh nhân, không dị ứng' }] },
    clientTimes: { openedAt: '2026-10-20T03:01:00.000Z', signedAt: '2026-10-20T03:02:00.000Z' },
    allergiesUnknown: true,
  };
  const complete: NewOp = { id: body.clientUuid, kind: 'complete', deps: [open.id], payload: { visitId: visitTmpId, rxTmpId, body } };
  const printed: NewOp = { id: crypto.randomUUID(), kind: 'printed', deps: [complete.id], payload: { prescriptionId: rxTmpId, printedAt: '2026-10-20T03:02:05.000Z' } };
  return { patient: p, checkin, open, complete, printed, all: [p, checkin, open, complete, printed] as NewOp[] };
}

const statuses = async (e: SyncEngine) => Object.fromEntries((await e.ops()).map((o) => [o.id, o.meta.status]));

describe('gửi lại sau lỗi', () => {
  it('lỗi mạng: mục vẫn còn trong kho; lần gửi lại dùng đúng clientUuid cũ; máy chủ có đúng một bệnh nhân', async () => {
    const store = await openStore();
    const e = engine(store);
    const op = patientOp();
    bff.fault(/POST \/api\/patients/, 'network');
    await e.enqueue([op]);
    await e.run();
    expect((await e.ops()).map((o) => [o.id, o.meta.status, o.meta.attempts])).toEqual([[op.id, 'retry', 1]]);
    expect(bff.patients.size).toBe(0);
    expect(e.state).toMatchObject({ online: false, pending: 1 });

    // Chưa hết thời gian chờ: không gửi; hết thì gửi đúng một lần.
    clock.advance(999);
    await e.idle();
    expect(bff.requests).toHaveLength(1);
    clock.advance(1);
    await e.idle();
    expect(bff.requests.map((r) => r.body?.['clientUuid'])).toEqual([op.id, op.id]);
    expect(bff.patients.size).toBe(1);
    expect(await statuses(e)).toEqual({ [op.id]: 'done' });
    expect(e.state).toMatchObject({ online: true, pending: 0 });
  });

  it('mất phản hồi (máy chủ đã ghi, trình duyệt thấy lỗi mạng): gửi lại cùng UUID, máy chủ trả kết quả cũ, không tạo trùng', async () => {
    const store = await openStore();
    const e = engine(store);
    const op = patientOp();
    bff.fault(/POST \/api\/patients/, 'lost');
    await e.enqueue([op]);
    await e.run();
    expect(bff.patients.size).toBe(1);
    expect(await statuses(e)).toEqual({ [op.id]: 'retry' });
    await e.wake(); // sự kiện `online`: gửi ngay, không chờ hết thời gian chờ
    expect(bff.sent(op.id)).toBe(2);
    expect(bff.patients.size).toBe(1);
    expect(await statuses(e)).toEqual({ [op.id]: 'done' });
  });

  it('chờ theo lũy thừa 2 có trần: 1 s, 2 s, 4 s, 8 s, 8 s', async () => {
    const store = await openStore();
    const e = engine(store);
    for (let i = 0; i < 5; i++) bff.fault(/POST \/api\/patients/, { status: 503, body: { error: 'incomplete', retry: true } });
    await e.enqueue([patientOp()]);
    await e.run();
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [next] = clock.pending();
      waits.push(next!);
      clock.advance(next!);
      await e.idle();
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(bff.requests).toHaveLength(6);
    expect(bff.patients.size).toBe(1);
  });

  it('5xx, 503 ghi dở, 429: lỗi tạm, tự gửi lại (không thành "cần xử lý")', async () => {
    const store = await openStore();
    const e = engine(store);
    const ops = [patientOp('Trần Thị Bình'), patientOp('Lê Văn Cường'), patientOp('Phạm Thị Dung')];
    bff.fault(/POST/, { status: 500 });
    bff.fault(/POST/, { status: 503, body: { error: 'incomplete', retry: true, message: 'Lưu chưa trọn vẹn' } });
    bff.fault(/POST/, { status: 429 });
    await e.enqueue(ops);
    await e.run();
    expect(Object.values(await statuses(e))).toEqual(['retry', 'retry', 'retry']);
    expect(e.state.attention).toBe(0);
    await e.syncNow();
    expect(Object.values(await statuses(e))).toEqual(['done', 'done', 'done']);
  });

  it('trình duyệt sập giữa "lưu" và "gửi": mở lại thì gửi đúng một lần', async () => {
    const before = await openStore();
    const crashed = engine(before);
    const op = patientOp();
    await crashed.enqueue([op]); // đã lưu bền, chưa kịp gửi
    crashed.stop();
    before.close();

    const after = await openStore();
    const e = engine(after);
    await e.start();
    await e.syncNow();
    expect(bff.sent(op.id)).toBe(1);
    expect(bff.patients.size).toBe(1);
    expect(await statuses(e)).toEqual({ [op.id]: 'done' });
  });

  it('trình duyệt sập sau khi máy chủ đã ghi nhưng trước khi đánh dấu xong: mở lại gửi lại cùng UUID, vẫn một bản ghi', async () => {
    const before = await openStore();
    const crashed = engine(before);
    const chain = offlineChain();
    bff.fault(/complete$/, 'lost');
    await crashed.enqueue(chain.all);
    await crashed.run();
    expect(bff.completions.size).toBe(1);
    crashed.stop();
    before.close();

    const after = await openStore();
    const e = engine(after);
    await e.start();
    await e.syncNow();
    expect(bff.sent(chain.complete.id)).toBe(2);
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
    expect(Object.values(await statuses(e)).every((s) => s === 'done')).toBe(true);
  });
});

describe('thứ tự phụ thuộc và id tạm', () => {
  it('gửi theo thứ tự tạo bệnh nhân → cấp số → mở hồ sơ → ký → ghi nhận in; id tạm được thay bằng id máy chủ, không bao giờ lên máy chủ', async () => {
    const store = await openStore();
    const e = engine(store);
    const chain = offlineChain();
    // Xếp ngược thứ tự trong hàng đợi: chỉ phụ thuộc quyết định thứ tự gửi.
    await e.enqueue([...chain.all].reverse());
    await e.run();
    expect(bff.requests.map((r) => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/g, ':id')}`)).toEqual([
      'POST /api/patients',
      'POST /api/queue',
      'POST /api/visits/:id/open',
      'POST /api/visits/:id/complete',
      'POST /api/prescriptions/:id/printed',
    ]);
    expect(JSON.stringify(bff.requests)).not.toContain('tmp-');
    const patient = [...bff.patients.values()][0]!;
    const visit = [...bff.visits.values()][0]!;
    expect(bff.requests[1]!.body!['patientId']).toBe(patient.id);
    expect(bff.requests[2]!.path).toBe(`/api/visits/${visit.item.id}/open`);
    expect(bff.requests[3]!.path).toBe(`/api/visits/${visit.item.id}/complete`);
    expect(bff.printed).toEqual([{ id: visit.prescriptionId, printedAt: '2026-10-20T03:02:05.000Z' }]);
    // Số tạm còn trống thì máy chủ giữ; ánh xạ id tạm được lưu bền.
    expect(visit.item.number).toBe(1);
    const ids = await store.ids();
    expect(ids.get(chain.patient.payload.tmpId)).toBe(patient.id);
    expect(ids.get((chain.checkin.payload as { visitTmpId: string }).visitTmpId)).toBe(visit.item.id);
    expect(ids.get((chain.complete.payload as { rxTmpId: string }).rxTmpId)).toBe(visit.prescriptionId);
  });

  it('mục trước chưa xong (lỗi tạm) thì mục sau chờ, không gửi trước', async () => {
    const store = await openStore();
    const e = engine(store);
    const chain = offlineChain();
    bff.fault(/POST \/api\/queue/, { status: 500 });
    await e.enqueue(chain.all);
    await e.run();
    expect(bff.requests.map((r) => r.path)).toEqual(['/api/patients', '/api/queue']);
    await e.syncNow();
    expect(Object.values(await statuses(e))).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
});

describe('máy chủ từ chối (OFF-7)', () => {
  it('409: giữ mục và báo, không gửi lại, không ghi đè; mục phụ thuộc bị giữ; chuỗi khác vẫn chạy', async () => {
    const store = await openStore();
    const e = engine(store);
    const chain = offlineChain();
    const other = patientOp('Trần Thị Bình');
    bff.fault(/\/open$/, { status: 409, body: { error: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    await e.enqueue([...chain.all, other]);
    await e.run();
    const st = await statuses(e);
    expect(st[chain.open.id]).toBe('conflict');
    expect(st[chain.complete.id]).toBe('pending');
    expect(st[chain.printed.id]).toBe('pending');
    expect(st[other.id]).toBe('done');
    expect(e.state.attention).toBe(3); // mục xung đột + hai mục bị nó giữ
    const conflict = (await e.ops()).find((o) => o.id === chain.open.id)!;
    expect(conflict.body.error).toMatchObject({ status: 409, code: 'taken', message: 'Hồ sơ đang do BS. B khám' });

    // Các lần chạy sau (kể cả "Đồng bộ ngay"): không gửi lại mục xung đột, không gửi mục bị giữ.
    const sentBefore = bff.requests.length;
    await e.syncNow();
    clock.advance(60_000);
    await e.idle();
    expect(bff.requests.length).toBe(sentBefore);
    expect(bff.completions.size).toBe(0);
    // Bản khám trên máy vẫn còn nguyên (in lại được, chờ xử lý).
    const kept = (await e.ops()).find((o) => o.id === chain.complete.id)!;
    expect(kept.body.payload).toEqual(chain.complete.payload);
  });

  it('422 quy tắc kê đơn: chờ bác sĩ xác nhận, rồi gửi lại cùng clientUuid kèm lý do', async () => {
    const store = await openStore();
    const e = engine(store);
    const chain = offlineChain();
    bff.rulesRequire = ['allergy:penicillin'];
    await e.enqueue(chain.all);
    await e.run();
    let st = await statuses(e);
    expect(st[chain.complete.id]).toBe('rules');
    const op = (await e.ops()).find((o) => o.id === chain.complete.id)!;
    expect((op.body.error?.body as { unacknowledged: Array<{ key: string }> }).unacknowledged.map((f) => f.key)).toEqual(['allergy:penicillin']);
    await e.syncNow();
    expect(bff.sent(chain.complete.id)).toBe(1);

    await e.acknowledge(chain.complete.id, [{ key: 'allergy:penicillin', reason: 'Đã gọi bệnh nhân, ngưng amoxicillin' }]);
    await e.idle();
    st = await statuses(e);
    expect(st[chain.complete.id]).toBe('done');
    expect(st[chain.printed.id]).toBe('done');
    const resent = bff.requests.filter((r) => r.body?.['clientUuid'] === chain.complete.id);
    expect(resent).toHaveLength(2);
    expect((resent[1]!.body!['prescription'] as { acknowledgements: Array<{ key: string }> }).acknowledgements.map((a) => a.key)).toEqual(['allergy-unknown', 'allergy:penicillin']);
    expect(bff.completions.size).toBe(1);
  });

  it('lỗi khác (400, 404): cần xử lý, giữ thông điệp, không gửi lại', async () => {
    const store = await openStore();
    const e = engine(store);
    const op = patientOp();
    bff.fault(/POST \/api\/patients/, { status: 422, body: { error: 'invalid-phone', message: 'Số điện thoại không hợp lệ' } });
    await e.enqueue([op]);
    await e.run();
    await e.syncNow();
    expect(await statuses(e)).toEqual({ [op.id]: 'error' });
    expect((await e.ops())[0]!.body.error).toMatchObject({ status: 422, code: 'invalid-phone', message: 'Số điện thoại không hợp lệ' });
    expect(bff.sent(op.id)).toBe(1);
  });

  it('401: tạm dừng, không gửi gì thêm, không bỏ mục nào; đăng nhập lại (token mới) thì gửi tiếp', async () => {
    const store = await openStore();
    let session: Session = { ...docSession, token: 'tok-expired' };
    const e = engine(store, { session: () => session });
    const chain = offlineChain();
    await e.enqueue(chain.all);
    await e.run();
    expect(e.state.paused).toBe('unauthorized');
    expect(bff.requests).toHaveLength(1);
    await e.syncNow();
    clock.advance(120_000);
    await e.idle();
    expect(bff.requests).toHaveLength(1);
    expect(Object.values(await statuses(e))).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    expect(e.state.pending).toBe(5);

    session = docSession; // đăng nhập lại đúng người
    await e.syncNow();
    expect(e.state.paused).toBe(false);
    expect(Object.values(await statuses(e))).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
});

describe('chỉ gửi mục của chính người đang đăng nhập (OFF-6)', () => {
  it('phiên của người khác: không gửi mục nào của kho này, kể cả khi bộ máy cũ còn chạy', async () => {
    const store = await openStore();
    bff.tokens.set('tok-assistant', { userId: 'assistant', name: 'Phụ tá' });
    let session: Session | undefined = docSession;
    const e = engine(store, { session: () => session });
    const op = patientOp();
    session = { token: 'tok-assistant', tenant: 'noi', userId: 'assistant' };
    await e.enqueue([op]);
    await e.syncNow();
    expect(bff.requests).toHaveLength(0);
    expect(e.state.paused).toBe('owner');
    expect(await statuses(e)).toEqual({ [op.id]: 'pending' });
  });

  it('người khác đăng nhập trên cùng máy: kho và hàng đợi của họ riêng, không thấy mục của người trước', async () => {
    const mine = await openStore();
    const mineEngine = engine(mine, { session: () => undefined });
    await mineEngine.enqueue([patientOp()]);
    const assistant = { tenant: 'noi', userId: 'assistant' };
    bff.tokens.set('tok-assistant', { userId: 'assistant', name: 'Phụ tá' });
    const theirs = await openStore(assistant);
    const e = engine(theirs, { owner: assistant, session: () => ({ token: 'tok-assistant', ...assistant }) });
    await e.syncNow();
    expect(bff.requests).toHaveLength(0);
    expect(await mine.pendingCount()).toBe(1);
    expect(dbName(assistant)).not.toBe(dbName(owner));
  });
});

describe('gửi ngay khi có mạng', () => {
  it('thành công: trả kết quả của máy chủ', async () => {
    const store = await openStore();
    const e = engine(store);
    const op = patientOp();
    await e.enqueue([op]);
    const out = await e.submit(op.id);
    expect(out).toMatchObject({ kind: 'done', result: { created: true } });
  });

  it('lỗi mạng: chuyển sang dạng ngoại tuyến (cùng id, cùng clientUuid) ngay trong lần chạy, bản chuyển là bản được gửi sau đó', async () => {
    const store = await openStore();
    const e = engine(store);
    const p = patientOp();
    bff.patients.set(p.id, { id: 'srv-patient', fullName: 'Nguyễn Văn An' });
    const checkin: NewOp = { id: crypto.randomUUID(), kind: 'checkin', payload: { body: { clientUuid: '', patientId: 'srv-patient', specialty: 'noi', priority: 'normal' }, display: { patientName: 'Nguyễn Văn An' } } };
    (checkin.payload as { body: { clientUuid: string } }).body.clientUuid = checkin.id;
    bff.fault(/POST \/api\/queue/, 'network');
    await e.enqueue([checkin]);
    const out = await e.submit(checkin.id, (payload) => {
      const c = payload as Extract<NewOp, { kind: 'checkin' }>['payload'];
      return { payload: { ...c, body: { ...c.body, arrivedAt: '2026-10-20T03:00:00.000Z', proposedNumber: 1 } } };
    });
    expect(out).toEqual({ kind: 'offline' });
    await e.wake();
    const sent = bff.requests.filter((r) => r.path === '/api/queue');
    expect(sent.map((r) => [r.body!['clientUuid'], r.body!['proposedNumber']])).toEqual([
      [checkin.id, undefined],
      [checkin.id, 1],
    ]);
    expect([...bff.visits.values()].map((v) => v.item.number)).toEqual([1]);
  });

  it('trình duyệt báo mất mạng: không gửi, chuyển ngay sang dạng ngoại tuyến', async () => {
    const store = await openStore();
    const e = engine(store);
    online = false;
    const op = patientOp();
    await e.enqueue([op]);
    const promote = vi.fn((payload: unknown) => ({ payload: payload as never }));
    expect(await e.submit(op.id, promote)).toEqual({ kind: 'offline' });
    expect(promote).toHaveBeenCalledTimes(1);
    expect(bff.requests).toHaveLength(0);
    online = true;
    await e.wake();
    expect(await statuses(e)).toEqual({ [op.id]: 'done' });
  });

  it('bị từ chối khi gửi ngay: bỏ được mục (dữ liệu còn trên màn hình); mục đang chờ hoặc đã xong thì không bỏ được', async () => {
    const store = await openStore();
    const e = engine(store);
    const bad = patientOp();
    const waiting = patientOp('Trần Thị Bình');
    bff.fault(/POST \/api\/patients/, { status: 422, body: { error: 'invalid-name', message: 'Nhập đủ họ và tên' } });
    await e.enqueue([bad]);
    expect(await e.submit(bad.id)).toMatchObject({ kind: 'rejected', status: 'error', error: { code: 'invalid-name' } });
    await e.discard(bad.id);
    expect(await e.ops()).toEqual([]);
    online = false;
    await e.enqueue([waiting]);
    await e.run();
    await expect(e.discard(waiting.id)).rejects.toThrow();
    expect(await store.pendingCount()).toBe(1);
  });
});

describe('nhiều tab', () => {
  it('Web Locks: hai tab cùng đồng bộ một lúc, mỗi mục chỉ được gửi một lần', async () => {
    // Đếm số lần xin khóa để biết chắc tab kia đã tới chỗ xin khóa đúng lúc tab này đang gửi.
    let asked = 0;
    const spy: Locks = { request: (name, fn) => (asked++, inTabLocks.request(name, fn)) };
    const a = await openStore();
    const b = await openStore();
    const ea = engine(a, { locks: spy });
    const eb = engine(b, { locks: spy });
    const ops = [patientOp(), patientOp('Trần Thị Bình')];
    await ea.enqueue(ops);
    let open!: () => void;
    bff.gate = new Promise((r) => (open = r));
    const runA = ea.syncNow();
    await vi.waitFor(() => expect(bff.inFlight).toBe(1));
    const runB = eb.syncNow();
    await vi.waitFor(() => expect(asked).toBe(2));
    open();
    bff.gate = undefined;
    await Promise.all([runA, runB]);
    expect(ops.map((o) => bff.sent(o.id))).toEqual([1, 1]);
  });

  it('đối chứng: bỏ khóa thì cùng kịch bản đó gửi trùng (bài trên không đúng một cách vô nghĩa)', async () => {
    const noLock: Locks = { request: (_name, fn) => fn() };
    const a = await openStore();
    const b = await openStore();
    const ea = engine(a, { locks: noLock });
    const eb = engine(b, { locks: noLock });
    const op = patientOp();
    await ea.enqueue([op]);
    let open!: () => void;
    bff.gate = new Promise((r) => (open = r));
    const runA = ea.syncNow();
    await vi.waitFor(() => expect(bff.inFlight).toBe(1));
    const runB = eb.syncNow();
    await vi.waitFor(() => expect(bff.inFlight).toBe(2));
    open();
    bff.gate = undefined;
    await Promise.all([runA, runB]);
    // Máy chủ vẫn không tạo trùng (idempotent theo UUID), nhưng đã gửi hai lần: khóa là thứ ngăn việc này.
    expect(bff.sent(op.id)).toBe(2);
    expect(bff.patients.size).toBe(1);
  });
});
