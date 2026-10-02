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

beforeEach(async () => {
  bff = new FakeBff();
  clock = new FakeClock();
  online = true;
  vi.stubGlobal('fetch', bff.fetch);
  store = await openEncryptedStore({ tenant: 'noi', userId: 'doc' });
  engine = new SyncEngine({ store, owner: { tenant: 'noi', userId: 'doc' }, session: () => ({ token: 'tok-doc', tenant: 'noi', userId: 'doc' }), clock, isOnline: () => online });
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

  it('có mạng: máy chủ từ chối thì bỏ mục, báo lỗi tại chỗ (biểu mẫu còn), không để lại gì trên máy', async () => {
    bff.fault(/POST \/api\/patients/, { status: 422, body: { error: 'invalid-name', message: 'Nhập đủ họ và tên' } });
    await expect(client.createPatient({ clientUuid: crypto.randomUUID(), fullName: 'Zq Thử' })).rejects.toBeInstanceOf(RejectedError);
    expect(await engine.ops()).toEqual([]);
    expect(await store.list('patients')).toEqual([]);
  });
});
