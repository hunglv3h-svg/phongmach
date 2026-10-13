import 'fake-indexeddb/auto';
import { drugCode, getDrug } from '@phongmach/catalogs';
import type { PrescriptionDetail, QueueItem } from '@phongmach/clinical';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../api';
import { localPrescriptionCode } from '../print';
import { evaluate, lineFromDrug, newDraft, type Draft } from '../visit/draft';
import { OfflineClient, RejectedError } from './client';
import { FakeBff, FakeClock } from './fakeBff';
import type { Op } from './ops';
import { openEncryptedStore, type LocalStore } from './store';
import { SyncEngine } from './sync';

const auth: AuthState = { token: 'tok-doc', user: { id: 'doc', name: 'BS. Thử', role: 'doctor' }, tenant: { slug: 'noi', name: 'Phòng khám Nội (thử)' } };

let bff: FakeBff;
let clock: FakeClock;
let online: boolean;
let store: LocalStore;
let engine: SyncEngine;
let printed: Array<{ detail: PrescriptionDetail; pendingSync: boolean; persisted: { op: boolean; draftGone: boolean } }>;
let client: OfflineClient;
/** Token của phiên mà bộ máy đồng bộ dùng để gửi (đổi được để giả lập đăng nhập lại sau khi hết phiên). */
let sessionToken: string;

beforeEach(async () => {
  bff = new FakeBff();
  clock = new FakeClock();
  online = true;
  sessionToken = 'tok-doc';
  vi.stubGlobal('fetch', bff.fetch);
  store = await openEncryptedStore({ tenant: 'noi', userId: 'doc' });
  engine = new SyncEngine({ store, owner: { tenant: 'noi', userId: 'doc' }, session: () => ({ token: sessionToken, tenant: 'noi', userId: 'doc' }), clock, isOnline: () => online });
  printed = [];
  client = new OfflineClient({
    store,
    engine,
    auth: () => auth,
    now: clock.now,
    // Máy in giả: ghi lại lúc in, kho đã có mục hoàn tất chưa và bản nháp đã bị xóa chưa (N1: không in khi chưa lưu bền).
    printLocal: async (detail, _clinic, pendingSync) => {
      const op = (await engine.ops()).some((o) => o.meta.kind === 'complete');
      const draftGone = (await store.list('drafts')).length === 0;
      printed.push({ detail, pendingSync, persisted: { op, draftGone } });
    },
  });
});

afterEach(async () => {
  engine.stop();
  await store.destroy().catch(() => undefined);
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
  vi.unstubAllGlobals();
});

function goOffline() {
  online = false;
  engine.observe(false);
}
async function goOnline() {
  online = true;
  await engine.wake();
}

/** Một bệnh nhân đang chờ trên máy chủ (đã cấp số lúc có mạng). */
function serverVisit(fullName = 'Nguyễn Văn An', number = 1): QueueItem {
  const patient = { id: crypto.randomUUID(), fullName, phone: '0912345678' };
  bff.patients.set(crypto.randomUUID(), patient);
  const item: QueueItem = { id: crypto.randomUUID(), number, code: `20261020-00${number}`, status: 'waiting', priority: 'normal', specialty: 'noi', patientId: patient.id, patientName: fullName, arrivedAt: '2026-10-20T02:00:00.000Z' };
  bff.visits.set(item.id, { item, clientUuid: crypto.randomUUID() });
  return item;
}

function signedDraft(base: Draft): Draft {
  const amox = lineFromDrug(getDrug(drugCode('Amoxicillin 500 mg'))!);
  return { ...base, symptoms: 'Đau họng, sốt nhẹ', diagnoses: ['J02.9'], lines: [amox], acks: { 'allergy-unknown': 'Đã hỏi bệnh nhân: không dị ứng thuốc' } };
}

describe('ký khi mất mạng', () => {
  it('lưu bền trước rồi mới in: mục hoàn tất (giờ máy này, chưa rõ dị ứng), mục ghi nhận in, đơn để in lại, xóa bản nháp, tất cả trong một giao dịch', async () => {
    const item = serverVisit();
    goOffline();
    const opened = await client.openVisit(item);
    expect(opened).toMatchObject({ offline: true, allergiesKnown: false, historyLoaded: false });
    const draft = signedDraft({ ...newDraft('Đau họng'), openedAt: opened.openedAt, openedOffline: true });
    await store.putDraft(item.id, draft);
    clock.advance(45_000);

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: false, acks: [{ key: 'allergy-unknown', message: 'Chưa rõ dị ứng', reason: 'Đã hỏi bệnh nhân: không dị ứng thuốc' }] });
    expect(out.kind).toBe('offline');
    const signedAt = new Date(clock.now()).toISOString();

    // Đã in đúng một lần, SAU khi mục hoàn tất nằm trong kho và bản nháp đã bị xóa.
    expect(printed).toHaveLength(1);
    expect(printed[0]!.persisted).toEqual({ op: true, draftGone: true });
    expect(printed[0]!.pendingSync).toBe(true);
    expect(printed[0]!.detail.prescription.code).toBe(await localPrescriptionCode(draft.clientUuid, signedAt));
    expect(printed[0]!.detail.prescription.lines.map((l) => l.name)).toEqual(['Amoxicillin 500 mg']);

    const ops = await engine.ops();
    const complete = ops.find((o) => o.meta.kind === 'complete') as Op<'complete'>;
    expect(complete.id).toBe(draft.clientUuid);
    expect(complete.body.payload.body).toMatchObject({ clientUuid: draft.clientUuid, clientTimes: { openedAt: opened.openedAt, signedAt }, allergiesUnknown: true });
    const open = ops.find((o) => o.meta.kind === 'open') as Op<'open'>;
    expect(complete.meta.deps).toEqual([open.id]);
    const print = ops.find((o) => o.meta.kind === 'printed') as Op<'printed'>;
    expect(print.meta.deps).toEqual([complete.id]);
    expect(print.body.payload.prescriptionId).toBe(complete.body.payload.rxTmpId);
    expect(await client.signedOffline(complete.body.payload.rxTmpId!)).toMatchObject({ completeOpId: complete.id });

    // Có mạng lại: mở hồ sơ (giờ máy này) → hoàn tất → ghi nhận in, đúng một đơn trên máy chủ.
    await goOnline();
    expect(bff.requests.filter((r) => r.method === 'POST').map((r) => r.path.replace(/[0-9a-f-]{36}/g, ':id'))).toEqual(['/api/visits/:id/open', '/api/visits/:id/complete', '/api/prescriptions/:id/printed']);
    expect(bff.requests.find((r) => r.path.endsWith('/open'))!.body).toEqual({ openedAt: opened.openedAt });
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
    expect(engine.state.pending).toBe(0);
  });

  it('không in khi chưa lưu bền: ghi trên máy lỗi (đầy bộ nhớ) thì báo lỗi, không in, bản nháp còn nguyên', async () => {
    const item = serverVisit();
    goOffline();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: true });
    await store.putDraft(item.id, draft);
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementation(async (changes) => {
      if (changes.some((c) => c.table === 'signed')) throw new DOMException('Hết chỗ', 'QuotaExceededError');
      return commit(changes);
    });
    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: false, acks: [] });
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringContaining('CHƯA in') });
    expect(printed).toEqual([]);
    expect(await store.getDraft(item.id)).toEqual(draft);
    expect((await engine.ops()).filter((o) => o.meta.kind === 'complete')).toEqual([]);
  });

  it('có mạng nhưng mất phản hồi (máy chủ đã ghi): chuyển sang ký khi mất mạng cùng UUID, in từ máy; đồng bộ lại vẫn một đơn', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    expect(opened).toMatchObject({ offline: false, allergiesKnown: true, historyLoaded: true });
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.fault(/complete$/, 'lost');
    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out.kind).toBe('offline');
    expect(printed).toHaveLength(1);
    expect(printed[0]!.persisted).toEqual({ op: true, draftGone: true });
    expect(bff.completions.size).toBe(1);
    // Lần gửi đầu không có giờ máy khách (ký lúc có mạng); mục đã chuyển mang giờ máy khách, cùng UUID.
    const op = (await engine.ops()).find((o) => o.id === draft.clientUuid) as Op<'complete'>;
    expect(op.body.payload.body.clientTimes?.signedAt).toBe(new Date(clock.now()).toISOString());
    await goOnline();
    expect(bff.sent(draft.clientUuid)).toBe(2);
    expect(bff.completions.size).toBe(1);
    expect(engine.state.pending).toBe(0);
  });

  it('có mạng và máy chủ nhận: kết quả của máy chủ, không in từ máy, không gửi giờ máy khách', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out.kind).toBe('online');
    expect(printed).toEqual([]);
    expect(bff.requests.find((r) => r.path.endsWith('/complete'))!.body!['clientTimes']).toBeUndefined();
  });

  it('có mạng, máy chủ từ chối theo quy tắc (422): hiện tại chỗ, bỏ mục, bản nháp còn; xác nhận rồi ký lại cùng UUID', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt });
    await store.putDraft(item.id, draft);
    bff.rulesRequire = ['allergy:penicillin'];
    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out).toMatchObject({ kind: 'rules', rejected: { unacknowledged: [{ key: 'allergy:penicillin' }] } });
    expect((await engine.ops()).filter((o) => o.meta.kind === 'complete')).toEqual([]);
    expect(await store.getDraft(item.id)).toEqual(draft);
    const acked = { ...draft, acks: { ...draft.acks, 'allergy:penicillin': 'Đã hỏi kỹ, dùng nhiều lần không sao' } };
    expect((await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft: acked, withRx: true, allergiesKnown: true, acks: [] })).kind).toBe('online');
    expect(bff.sent(draft.clientUuid)).toBe(2);
    expect(bff.completions.size).toBe(1);
  });
});

// OFF-8 (kế hoạch, mục 5.8, "Thiết kế OFF-8", phương án A + C1 + A-1). Bất biến K: khi complete() trả về, không có mục hoàn tất nào
// vừa còn tự gửi được vừa chưa có tờ đơn và chưa có bản đơn in lại được trên máy. "Ký & In" lúc ứng dụng coi là CÓ mạng mà máy chủ
// chưa nhận ngay phải kết thúc bằng một trong ba cách: online (máy chủ nhận), offline (ký khi mất mạng, lưu bền rồi in), hoặc failed
// kèm "CHƯA in" (hàng rào ngày từ chối, bị giữ, hoặc lỗi lưu). Năm kết quả không-dứt-điểm cũ (waiting, offline-chưa-chuyển,
// retrying, paused, held) đi qua đường ký khi mất mạng (promote trong lúc giữ khóa), trừ các ca "Rủi ro còn lại".
describe('OFF-8: ký lúc có mạng mà máy chủ chưa nhận ngay vẫn phải in (hoặc báo rõ "CHƯA in")', () => {
  const SERVER_BUSY = { status: 503, body: { error: 'incomplete', retry: true, message: 'Lưu chưa trọn vẹn, hãy bấm lại: dữ liệu sẽ không bị trùng.' } };
  const completeOp = async (id: string) => (await engine.ops()).find((o) => o.id === id) as Op<'complete'> | undefined;
  const signedOnDevice = async () => (await store.list('signed')).length;
  const serverStatus = (item: QueueItem) => bff.visits.get(item.id)!.item.status;
  /** Giờ của máy khách trong FakeClock bắt đầu ở 2026-10-20T03:00:00Z = ngày 20/10 giờ Việt Nam. */
  const SAME_DAY_UTC = '2026-10-20T05:00:00.000Z'; // 12:00 ngày 20/10 giờ VN
  const OTHER_DAY_UTC = '2026-10-19T05:00:00.000Z'; // ngày 19/10 giờ VN

  /** Mở hồ sơ lúc có mạng mà máy chủ lỗi tạm hai lần liền: mục mở hồ sơ ở trạng thái `retry`, còn 4 giây mới gửi lại. */
  async function openWithRetryingOpen(item: QueueItem) {
    bff.fault(/open$/, SERVER_BUSY);
    bff.fault(/open$/, SERVER_BUSY);
    const opened = await client.openVisit(item);
    clock.advance(2000);
    await engine.idle();
    const open = (await engine.ops()).find((o) => o.meta.kind === 'open')!;
    expect(open.meta).toMatchObject({ status: 'retry', attempts: 2, nextAt: clock.now() + 4000 });
    expect(client.online).toBe(true);
    return opened;
  }

  /** Mọi điều phải đúng ngay sau khi đã chuyển một mục sang dạng ký khi mất mạng và in từ máy đúng một lần. */
  async function expectSignedOffline(draft: Draft, opened: { openedAt: string }) {
    const signedAt = new Date(clock.now()).toISOString();
    // In đúng một lần, SAU khi mục hoàn tất và bản nháp đã vào/khỏi kho.
    expect(printed).toHaveLength(1);
    expect(printed[0]!.persisted).toEqual({ op: true, draftGone: true });
    expect(printed[0]!.pendingSync).toBe(true);
    const op = (await completeOp(draft.clientUuid))!;
    // Cùng id, cùng clientUuid, giờ ký là giờ bấm; mục mang id tạm của đơn và có bản đơn + mục ghi nhận in.
    expect(op.id).toBe(draft.clientUuid);
    expect(op.body.payload.body.clientUuid).toBe(draft.clientUuid);
    expect(op.body.payload.body.clientTimes).toEqual({ openedAt: opened.openedAt, signedAt });
    expect(op.body.payload.rxTmpId).toBeDefined();
    expect(await signedOnDevice()).toBe(1);
    const print = (await engine.ops()).find((o) => o.meta.kind === 'printed') as Op<'printed'> | undefined;
    expect(print).toBeDefined();
    expect(print!.body.payload.prescriptionId).toBe(op.body.payload.rxTmpId);
    expect(await store.getDraft(draft.clientUuid)).toBeUndefined();
    return op;
  }

  it('`waiting`: mục mở hồ sơ đang `retry` → C1 đẩy mục trước ngay, máy chủ đã hồi thì ký đi đường có mạng, không cần bấm lại', async () => {
    const item = serverVisit();
    const opened = await openWithRetryingOpen(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: opened.offline });
    await store.putDraft(item.id, draft);
    clock.advance(1000);

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: opened.allergiesKnown, acks: [] });
    // C1: dù mục mở hồ sơ còn 3 giây mới tới hạn gửi lại, nó được đẩy ngay trong lượt gửi này; máy chủ đã hồi nên hoàn tất nhận luôn.
    expect(out.kind).toBe('online');
    expect(printed).toEqual([]); // in qua máy chủ (đường có mạng), không in từ máy
    expect(serverStatus(item)).toBe('done');
    expect(bff.completions.size).toBe(1);
    expect(engine.state.pending).toBe(0);
    expect(await store.getDraft(item.id)).toBeUndefined();
  });

  it('`waiting` mà mục trước lại lỗi tiếp: chuyển sang ký khi mất mạng, in đúng một lần; đồng bộ xong đúng một hoàn tất và một dòng in', async () => {
    const item = serverVisit();
    const opened = await openWithRetryingOpen(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: opened.offline });
    await store.putDraft(item.id, draft);
    clock.advance(1000);
    // C1 đẩy mục mở hồ sơ ngay nhưng máy chủ vẫn lỗi tạm: không về được đường có mạng, phải ký khi mất mạng.
    bff.fault(/open$/, SERVER_BUSY);

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: opened.allergiesKnown, acks: [] });
    expect(out.kind).toBe('offline');
    await expectSignedOffline(draft, opened);

    // Có mạng lại: mở hồ sơ (giờ máy này) → hoàn tất → ghi nhận in, đúng một đơn trên máy chủ, đúng một dòng in.
    await goOnline();
    expect(serverStatus(item)).toBe('done');
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
    expect(engine.state.pending).toBe(0);
  });

  it('`offline` mà chưa chuyển sang dạng ngoại tuyến: mạng vừa có lại, lần gửi lại mục trước lỗi mạng đúng lúc ký → chuyển sang ký khi mất mạng, in đúng một lần', async () => {
    const item = serverVisit();
    bff.fault(/open$/, 'network');
    const opened = await client.openVisit(item);
    expect(opened.offline).toBe(true);
    expect(client.online).toBe(false);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: opened.offline });
    await store.putDraft(item.id, draft);

    // Một lần đọc tới được máy chủ: ứng dụng coi là có mạng lại và gửi lại mục mở hồ sơ. Yêu cầu đó đang đi (chờ ở cổng) thì bác sĩ bấm ký.
    let release!: () => void;
    bff.gate = new Promise<void>((resolve) => (release = resolve));
    bff.fault(/open$/, 'network');
    engine.observe(true);
    await vi.waitFor(() => expect(bff.inFlight).toBe(1));
    expect(client.online).toBe(true);
    // Mở hồ sơ vẫn chưa tới được máy chủ (C1 có thể đẩy nó trong lượt ký này, nhưng lần đó cũng lỗi mạng): mục hoàn tất phải đi
    // đường ký khi mất mạng, không chờ máy chủ.
    bff.fault(/open$/, 'network');
    const signing = client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: opened.allergiesKnown, acks: [] });
    await vi.waitFor(async () => expect(await completeOp(draft.clientUuid)).toBeDefined());
    bff.gate = undefined;
    release();

    expect((await signing).kind).toBe('offline');
    await expectSignedOffline(draft, opened);

    // Máy chủ hồi hẳn: mở hồ sơ gửi được, rồi hoàn tất (đã chuyển, cùng clientUuid) và ghi nhận in; đúng một đơn, một dòng in.
    bff.faults.length = 0;
    await goOnline();
    clock.advance(4000);
    await engine.idle();
    expect(serverStatus(item)).toBe('done');
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
  });

  it('`retrying`: yêu cầu hoàn tất gặp 503, server cùng ngày → chuyển sang ký khi mất mạng, in đúng một lần, giờ ký = giờ bấm, 2 yêu cầu cùng clientUuid', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.fault(/complete$/, { ...SERVER_BUSY, date: SAME_DAY_UTC });

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out.kind).toBe('offline');
    const op = await expectSignedOffline(draft, { openedAt: draft.openedAt! });
    expect(op.meta.attempts).toBe(1); // đã tới máy chủ đúng một lần (503)

    // Có mạng lại: gửi lại cùng clientUuid; đúng một đơn trên máy chủ (idempotent), đúng một dòng in.
    await goOnline();
    expect(bff.sent(draft.clientUuid)).toBe(2);
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
    expect(serverStatus(item)).toBe('done');
  });

  it('`retrying` hàng rào ngày — server KHÁC ngày: KHÔNG chuyển, KHÔNG in, báo "CHƯA in"; mục giữ nguyên dạng có mạng và vẫn tự gửi', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.fault(/complete$/, { ...SERVER_BUSY, date: OTHER_DAY_UTC });

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringContaining('CHƯA in') });
    expect(printed).toEqual([]);
    const op = (await completeOp(draft.clientUuid))!;
    expect(op.body.payload.rxTmpId).toBeUndefined();
    expect(op.body.payload.body.clientTimes).toBeUndefined(); // vẫn dạng có mạng
    expect(await signedOnDevice()).toBe(0);
    expect((await engine.ops()).filter((o) => o.meta.kind === 'printed')).toEqual([]);
    // Vẫn tự gửi lại (lượt khám không mất): sau khi hết chờ máy chủ nhận.
    bff.faults.length = 0;
    clock.advance(2000);
    await engine.idle();
    expect(serverStatus(item)).toBe('done');
  });

  it('`retrying` hàng rào ngày — phản hồi lỗi KHÔNG có Date: KHÔNG chuyển, KHÔNG in, báo "CHƯA in"; mục giữ nguyên dạng có mạng', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.fault(/complete$/, SERVER_BUSY); // không gắn `date`

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringContaining('CHƯA in') });
    expect(printed).toEqual([]);
    const op = (await completeOp(draft.clientUuid))!;
    expect(op.body.payload.rxTmpId).toBeUndefined();
    expect(op.body.payload.body.clientTimes).toBeUndefined();
    expect(await signedOnDevice()).toBe(0);
  });

  it('`paused`: phiên hết hạn (401) đúng lúc ký → chuyển sang ký khi mất mạng (chưa tới máy chủ), in đúng một lần; đăng nhập lại thì máy tự gửi', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.tokens.delete('tok-doc');

    const out = await client.complete({ visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] });
    expect(out.kind).toBe('offline');
    await expectSignedOffline(draft, { openedAt: draft.openedAt! });
    expect(engine.state.paused).toBe('unauthorized');

    // Đăng nhập lại (token mới): bộ máy gửi tiếp; đúng một đơn, đúng một dòng in.
    bff.tokens.set('tok-moi', { userId: 'doc', name: 'BS. Thử' });
    sessionToken = 'tok-moi';
    await engine.run();
    await goOnline();
    expect(serverStatus(item)).toBe('done');
    expect(engine.state.pending).toBe(0);
    expect(bff.completions.size).toBe(1);
    expect(bff.printed).toHaveLength(1);
  });

  it('`held`: mục mở hồ sơ đã bị máy chủ từ chối (409) → chuyển sang ký khi mất mạng, in đúng một lần; đơn bị giữ in LẠI được từ danh sách chờ đồng bộ', async () => {
    const item = serverVisit();
    goOffline();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: true });
    await store.putDraft(item.id, draft);
    const visit = bff.visits.get(item.id)!;
    visit.item = { ...visit.item, status: 'in-exam', doctorUserId: 'khac', doctorName: 'BS. Khác' };
    await goOnline();
    expect((await engine.ops()).find((o) => o.meta.kind === 'open')!.meta.status).toBe('conflict');

    const input = { visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: opened.allergiesKnown, acks: [] };
    const out = await client.complete(input);
    expect(out.kind).toBe('offline');
    const op = await expectSignedOffline(draft, opened);

    // Mục hoàn tất bị giữ (open xung đột) nên không bao giờ gửi; đơn vẫn in lại được từ bản giữ trên máy.
    expect((await client.op(op.id))!.meta.status).toBe('pending');
    const rxTmpId = op.body.payload.rxTmpId!;
    printed.length = 0;
    await client.reprintSigned(rxTmpId);
    expect(printed).toHaveLength(1);
    expect(printed[0]!.detail.prescription.code).toBe(op.body.payload.display!.code);
  });

  it('nhánh mất mạng chịu CÙNG hàng rào ngày: 503 khác ngày rồi mất mạng, ký lại → KHÔNG chuyển, KHÔNG in, báo "CHƯA in" (không tự ý đổi giờ ký của mục đã tới máy chủ)', async () => {
    const item = serverVisit();
    const opened = await client.openVisit(item);
    const draft = signedDraft({ ...newDraft(), openedAt: opened.openedAt, openedOffline: false });
    await store.putDraft(item.id, draft);
    bff.fault(/complete$/, { ...SERVER_BUSY, date: OTHER_DAY_UTC });
    const input = { visit: opened.context.visit, patient: opened.context.patient, draft, withRx: true, allergiesKnown: true, acks: [] };
    expect((await client.complete(input)).kind).toBe('failed');
    expect(bff.sent(draft.clientUuid)).toBe(1);

    goOffline();
    clock.advance(1000);
    const out = await client.complete(input);
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringContaining('CHƯA in') });
    expect(printed).toEqual([]);
    const op = (await completeOp(draft.clientUuid))!;
    // Mục đã tới máy chủ (attempts 1), khác ngày: không được đổi sang giờ ký mới của máy khách.
    expect(op.meta.attempts).toBe(1);
    expect(op.body.payload.body.clientTimes).toBeUndefined();
    expect(op.body.payload.rxTmpId).toBeUndefined();
  });
});

describe('mở hồ sơ khi mất mạng (OFF-4)', () => {
  it('máy không có dị ứng của bệnh nhân: quy tắc "allergy-unknown" ở máy khách chặn ký cho tới khi bác sĩ xác nhận kèm lý do', async () => {
    const item = serverVisit();
    goOffline();
    const opened = await client.openVisit(item);
    expect(opened.allergiesKnown).toBe(false);
    const ctx = { specialty: 'noi' as const, patient: opened.context.patient, allergies: opened.context.allergies, allergiesKnown: opened.allergiesKnown };
    const draft = { ...signedDraft(newDraft()), acks: {} };
    const before = evaluate(draft, ctx);
    expect(before.findings.find((f) => f.rule === 'allergy-unknown')).toMatchObject({ key: 'allergy-unknown', severity: 'ack' });
    expect(before.verdict.unacknowledged.map((f) => f.rule)).toContain('allergy-unknown');
    expect(before.verdict.canSign).toBe(false);
    const after = evaluate({ ...draft, acks: { 'allergy-unknown': 'Đã hỏi bệnh nhân: không dị ứng thuốc' } }, ctx);
    expect(after.verdict.unacknowledged.map((f) => f.rule)).not.toContain('allergy-unknown');
    expect(after.verdict.acknowledged.map((f) => f.rule)).toContain('allergy-unknown');
  });

  it('đã nạp trước dị ứng lúc có mạng: mất mạng vẫn thấy dị ứng và vẫn bị cảnh báo dị ứng thật', async () => {
    const item = serverVisit();
    bff.allergies.set(item.patientId, [{ id: 'a1', kind: 'class', value: 'penicillin', label: 'Penicillin' }]);
    await client.refreshQueue();
    await vi.waitFor(async () => expect((await client.cachedPatient(item.patientId))?.allergies).toHaveLength(1));
    goOffline();
    const opened = await client.openVisit(item);
    expect(opened.allergiesKnown).toBe(true);
    const { findings } = evaluate(signedDraft(newDraft()), { specialty: 'noi', patient: opened.context.patient, allergies: opened.context.allergies, allergiesKnown: opened.allergiesKnown });
    expect(findings.map((f) => f.rule)).toContain('allergy');
    expect(findings.map((f) => f.rule)).not.toContain('allergy-unknown');
  });

  it('nạp trước chỉ người mới vào hàng chờ: lần sau không hỏi lại người đã có trên máy', async () => {
    serverVisit('Nguyễn Văn An', 1);
    serverVisit('Trần Thị Bình', 2);
    await client.refreshQueue();
    await vi.waitFor(() => expect(bff.requests.filter((r) => r.path.startsWith('/api/queue/prefetch'))).toHaveLength(1));
    const first = bff.requests.find((r) => r.path.startsWith('/api/queue/prefetch'))!;
    expect(first.path.split('patients=')[1]!.split(',')).toHaveLength(2);
    serverVisit('Lê Văn Cường', 3);
    clock.advance(10_000);
    await client.refreshQueue();
    await vi.waitFor(() => expect(bff.requests.filter((r) => r.path.startsWith('/api/queue/prefetch'))).toHaveLength(2));
    const second = bff.requests.filter((r) => r.path.startsWith('/api/queue/prefetch'))[1]!;
    expect(second.path.split('patients=')[1]!.split(',')).toHaveLength(1);
    expect((await client.searchCache('cuong')).results.map((p) => p.fullName)).toEqual(['Lê Văn Cường']);
  });
});

describe('tiếp đón khi mất mạng (OFF-2, OFF-4)', () => {
  it('tạo bệnh nhân và cấp số tạm = số lớn nhất máy biết + 1; tìm được trên máy (cả CCCD); có mạng lại thì gửi đúng thứ tự, máy chủ giữ số tạm', async () => {
    serverVisit('Nguyễn Văn An', 1);
    serverVisit('Trần Thị Bình', 2);
    await client.refreshQueue();
    goOffline();
    const { patient, tentative } = await client.createPatient({ clientUuid: crypto.randomUUID(), fullName: 'Zq Phạm Thị Dung', phone: '0901234567', cccd: '001190001234' });
    expect(tentative).toBe(true);
    expect(patient.id.startsWith('tmp-')).toBe(true);
    expect((await client.searchCache('001190001234')).results.map((p) => p.id)).toEqual([patient.id]);
    expect((await client.searchCache('dung')).results.map((p) => p.id)).toEqual([patient.id]);

    const checkIn = await client.checkIn(patient, { clientUuid: crypto.randomUUID(), specialty: 'noi', priority: 'normal', reason: 'Ho' });
    expect(checkIn).toMatchObject({ tentative: true, item: { number: 3, local: { tentative: true, pending: true } } });
    const queue = await client.localQueue();
    expect(queue.map((i) => [i.number, i.patientName, !!i.local?.tentative])).toEqual([
      [1, 'Nguyễn Văn An', false],
      [2, 'Trần Thị Bình', false],
      [3, 'Zq Phạm Thị Dung', true],
    ]);

    await goOnline();
    const created = [...bff.patients.values()].find((p) => p.fullName === 'Zq Phạm Thị Dung')!;
    const visit = [...bff.visits.values()].find((v) => v.item.patientId === created.id)!;
    expect(visit.item.number).toBe(3);
    expect(bff.requests.find((r) => r.path === '/api/queue' && r.method === 'POST')!.body).toMatchObject({ patientId: created.id, proposedNumber: 3, arrivedAt: expect.any(String) });
    // Bộ đệm đã chuyển sang id máy chủ, vẫn tìm được bằng CCCD.
    expect((await client.searchCache('001190001234')).results.map((p) => p.id)).toEqual([created.id]);
  });

  it('người vừa tiếp đón mà máy chủ chưa nhận vẫn tìm thấy khi có mạng, có nhãn "chưa đồng bộ"; nhận rồi thì không hiện hai dòng', async () => {
    // Máy chủ lỗi tạm: hồ sơ nằm trên máy với id tạm, máy chủ chưa có gì để tìm.
    bff.fault(/POST \/api\/patients/, { status: 503 });
    const { patient, tentative } = await client.createPatient({ clientUuid: crypto.randomUUID(), fullName: 'Zq Phạm Thị Dung', phone: '0901234567', cccd: '001190001234' });
    expect([tentative, patient.id.startsWith('tmp-')]).toEqual([true, true]);
    // Có mạng nên ô tìm gọi máy chủ; thiếu phần nối thêm thì hồ sơ này biến mất khỏi màn hình Tiếp đón.
    const offServer = await client.searchOnline('dung', 'tok-doc');
    expect(offServer.results.map((p) => p.id)).toEqual([patient.id]);
    expect(offServer.pending).toEqual([patient.id]);

    // Máy chủ đã nhận: đúng một dòng, của máy chủ, không còn nhãn.
    await goOnline();
    const created = [...bff.patients.values()].find((p) => p.fullName === 'Zq Phạm Thị Dung')!;
    const onServer = await client.searchOnline('dung', 'tok-doc');
    expect(onServer.results.map((p) => p.id)).toEqual([created.id]);
    expect(onServer.pending).toEqual([]);
  });

  it('có mạng: máy chủ từ chối thì bỏ mục, báo lỗi tại chỗ (biểu mẫu còn), không để lại gì trên máy', async () => {
    bff.fault(/POST \/api\/patients/, { status: 422, body: { error: 'invalid-name', message: 'Nhập đủ họ và tên' } });
    await expect(client.createPatient({ clientUuid: crypto.randomUUID(), fullName: 'Zq Thử' })).rejects.toBeInstanceOf(RejectedError);
    expect(await engine.ops()).toEqual([]);
    expect(await store.list('patients')).toEqual([]);
  });
});

// Chu kỳ 16 của M0-2 (xem .agents/tasks/fix-m0-2-cycles.md): bệnh nhân do chính máy này tiếp đón, mất phản hồi ở "tạo bệnh nhân",
// mở hồ sơ khi mất mạng, tải lại trang, rồi có mạng lại. Trong CI lần đó hồ sơ mở bằng BẢN DỰ PHÒNG (không có CCCD, không có dị
// ứng) nên quy tắc `no-cccd` mức chặn khóa nút "Ký & In" — bác sĩ không có cách chữa. Hai lớp độc lập phải giữ:
//   1. mở hồ sơ không được bỏ rơi dữ liệu máy này ĐANG CÓ (hàng đợi còn mục "tạo bệnh nhân" với CCCD đã nhập);
//   2. khi máy thật sự không có dữ liệu, quy tắc đòi XÁC NHẬN kèm lý do, không kết luận "bệnh nhân chưa có CCCD".
describe('mở hồ sơ bằng dữ liệu trên máy: "không biết" khác "không có" (chu kỳ 16 của M0-2)', () => {
  const CCCD = '000123456789';
  const NAME = 'Zc Nguyễn Văn Bình';
  const ruleCtx = (opened: Awaited<ReturnType<OfflineClient['openVisit']>>) => ({
    specialty: 'noi' as const,
    patient: opened.context.patient,
    allergies: [],
    allergiesKnown: opened.allergiesKnown,
    cccdKnown: opened.cccdKnown,
  });

  /** Tải lại trang: cùng CSDL trên máy, nhưng kho, bộ máy đồng bộ và lớp gọi API đều dựng lại từ đầu. */
  async function reload() {
    engine.stop();
    store.close();
    store = await openEncryptedStore({ tenant: 'noi', userId: 'doc' });
    engine = new SyncEngine({ store, owner: { tenant: 'noi', userId: 'doc' }, session: () => ({ token: sessionToken, tenant: 'noi', userId: 'doc' }), clock, isOnline: () => online });
    client = new OfflineClient({ store, engine, auth: () => auth, now: clock.now, printLocal: async () => undefined });
    await client.start();
  }

  /** Tiếp đón trên máy này: mất phản hồi ở "tạo bệnh nhân" (máy chủ đã ghi), rồi mất mạng, cấp số và gọi vào khám. */
  async function receiveThenOpenOffline() {
    bff.fault(/^POST \/api\/patients$/, 'lost');
    const { patient, tentative } = await client.createPatient({ clientUuid: crypto.randomUUID(), fullName: NAME, phone: '0912000016', cccd: CCCD, birthDate: '1956-05-10', gender: 'male' });
    expect(tentative).toBe(true);
    goOffline();
    const { item } = await client.checkIn(patient, { clientUuid: crypto.randomUUID(), specialty: 'noi', priority: 'normal' });
    const first = await client.openVisit(item);
    expect(first.context.patient.cccdMasked).toBeTruthy();
    return patient;
  }

  const rowOf = async (fullName: string) => (await client.localQueue((await client.refreshQueue())?.items))!.find((i) => i.patientName === fullName)!;

  it('tải lại trang khi mất mạng rồi có mạng lại: mở lại hồ sơ vẫn đủ CCCD, không có phát hiện nào chặn ký', async () => {
    await receiveThenOpenOffline();
    await reload();
    await goOnline();

    const opened = await client.openVisit(await rowOf(NAME));
    expect(opened.cccdKnown).toBe(true);
    expect(opened.context.patient.cccdMasked).toBeTruthy();
    expect(evaluate(signedDraft(newDraft()), ruleCtx(opened)).verdict.blocking).toEqual([]);
  });

  it('bộ đệm bệnh nhân tra trượt: mở hồ sơ lấy lại CCCD từ mục "tạo bệnh nhân" còn trong hàng đợi trên máy', async () => {
    const patient = await receiveThenOpenOffline();
    await reload();
    // Đúng triệu chứng đã thấy trong CI (ảnh FAILED-cycles.png, run 38252273087): lần tra bộ đệm theo id không ra hồ sơ nào.
    for (const row of await store.list('patients')) await store.commit([{ table: 'patients', id: row.id, delete: true }]);
    expect(await client.cachedPatient(patient.id)).toBeUndefined();

    const opened = await client.openVisit((await client.localQueue()).find((i) => i.patientName === NAME)!);
    expect(opened.offline).toBe(true);
    expect(opened.cccdKnown).toBe(true);
    expect(opened.context.patient).toMatchObject({ fullName: NAME, cccdMasked: expect.stringContaining('6789'), birthDate: '1956-05-10' });
    // Không có phát hiện mức chặn: bác sĩ ký và in được như mọi chu kỳ khác (vẫn phải xác nhận 'allergy-unknown').
    const { findings, verdict } = evaluate(signedDraft(newDraft()), ruleCtx(opened));
    expect(findings.map((f) => f.rule)).not.toContain('no-cccd');
    expect(verdict.blocking).toEqual([]);
  });

  it('máy không có gì về bệnh nhân này (tiếp đón ở máy khác): đòi xác nhận "cccd-unknown", không kết luận "chưa có CCCD"', async () => {
    const item: QueueItem = { ...serverVisit('Zc Lê Văn Cường', 7), birthDate: '1950-03-02' };
    goOffline();
    const opened = await client.openVisit(item);
    expect(opened).toMatchObject({ offline: true, cccdKnown: false, allergiesKnown: false });
    expect(opened.context.patient.cccdMasked).toBeUndefined();

    const draft = signedDraft(newDraft());
    const { findings, verdict } = evaluate(draft, ruleCtx(opened));
    expect(findings.map((f) => f.rule)).toContain('cccd-unknown');
    expect(findings.map((f) => f.rule)).not.toContain('no-cccd');
    // Vẫn phải ghi lý do mới ký được (N3: không âm thầm), nhưng không còn bị chặn cứng khi mất mạng.
    expect(verdict.blocking).toEqual([]);
    expect(verdict.unacknowledged.map((f) => f.rule)).toContain('cccd-unknown');
    const acked = { ...draft, acks: { ...draft.acks, 'cccd-unknown': 'Đã đối chiếu CCCD trên giấy tờ bệnh nhân mang theo' } };
    expect(evaluate(acked, ruleCtx(opened)).verdict.canSign).toBe(true);
  });
});
