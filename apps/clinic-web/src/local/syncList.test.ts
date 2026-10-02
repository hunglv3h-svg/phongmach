import 'fake-indexeddb/auto';
import type { QueueItem } from '@phongmach/clinical';
import type { PrescriptionDetail } from '@phongmach/clinical';
import type { Finding } from '@phongmach/rules';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, CompleteRequest } from '../api';
import type { LocalQueueItem, SignedOffline } from './cache';
import { OfflineClient } from './client';
import { FakeBff, FakeClock } from './fakeBff';
import { newTmpId, type AnyOp, type NewOp, type OpBody, type Payloads } from './ops';
import { openEncryptedStore, type LocalStore, type OpKind, type OpMeta } from './store';
import { SyncEngine } from './sync';
import { syncListActions } from './syncActions';
import syncActionsSource from './syncActions.ts?raw';
import { ackList, buildNotices, buildSyncRows, conflictText, expiredText, holderFromMessage, indicatorView, overviewOf, visibleNotices, type SyncData, type SyncRow, type ViewContext } from './syncList';
import syncListSource from './syncList.ts?raw';
import useSyncOverviewSource from './useSyncOverview.ts?raw';
import shellSource from '../components/Shell.tsx?raw';
import syncBarSource from '../components/SyncBar.tsx?raw';
import syncPanelSource from '../components/SyncPanel.tsx?raw';

// 10:00:00 giờ Việt Nam.
const T0 = Date.parse('2026-10-20T03:00:00Z');
const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({ now: T0, online: true, paused: false, me: 'doc', ...over });

let seq = 0;
/** Một mục hàng đợi đã giải mã, dựng thẳng trong bộ nhớ (không qua kho): đầu vào của các hàm thuần. */
function op<K extends OpKind>(kind: K, payload: Payloads[K], meta: Partial<OpMeta> = {}, body: Partial<OpBody<K>> = {}, id: string = crypto.randomUUID()): AnyOp {
  seq += 1;
  return {
    id,
    meta: { seq, kind, status: 'pending', deps: [], day: '2026-10-20', createdAt: T0, attempts: 0, nextAt: 0, ...meta },
    body: { payload, ...body },
    updatedAt: T0 + seq,
  } as unknown as AnyOp;
}

const signedStub = (code: string, fullName: string): SignedOffline => ({ detail: { prescription: { code }, patient: { fullName } }, clinicName: 'PK', completeOpId: 'x' }) as unknown as SignedOffline;
const exam: CompleteRequest = { clientUuid: 'x', exam: { vitals: {} }, diagnoses: ['J02.9'], prescription: { lines: [{ drug: 'X' }], acknowledgements: [] } };
const finding = (key: string, message: string, severity: Finding['severity'] = 'ack'): Finding => ({ key, rule: 'allergy', severity, lines: [0], message });
const data = (ops: AnyOp[], over: Partial<SyncData> = {}): SyncData => ({ ops, ids: new Map(), queue: [], signed: new Map(), ...over });
const queued = (id: string, number: number, patientName: string, over: Partial<LocalQueueItem> = {}): LocalQueueItem => ({
  id,
  number,
  code: `20261020-${number}`,
  status: 'in-exam',
  priority: 'normal',
  specialty: 'noi',
  patientId: 'p1',
  patientName,
  arrivedAt: '2026-10-20T02:00:00.000Z',
  ...over,
});

/** Chuỗi làm lúc mất mạng cho một lượt khám đã có trên máy chủ: mở hồ sơ → ký → ghi nhận in, cộng một lần in lại. */
function visitChain(openMeta: Partial<OpMeta> = {}, openBody: Partial<OpBody<'open'>> = {}) {
  const display = { patientName: 'Zq Xung Đột', number: 5 };
  const open = op('open', { visitId: 'v1', openedAt: '2026-10-20T03:01:00.000Z', display }, openMeta, openBody);
  const complete = op('complete', { visitId: 'v1', rxTmpId: 'tmp-rx', body: exam, display: { ...display, code: 'PM-261020-ABC123' } }, { deps: [open.id] });
  const printed = op('printed', { prescriptionId: 'tmp-rx', printedAt: '2026-10-20T03:02:05.000Z', display: { ...display, code: 'PM-261020-ABC123' } }, { deps: [complete.id] });
  const reprinted = op('printed', { prescriptionId: 'tmp-rx', printedAt: '2026-10-20T03:09:00.000Z', display: { ...display, code: 'PM-261020-ABC123' } }, { deps: [complete.id] });
  return { open, complete, printed, reprinted, all: [open, complete, printed, reprinted] };
}

describe('dựng dòng danh sách chờ đồng bộ (hàm thuần)', () => {
  it('chờ gửi, chờ mục trước, đang gửi, thử lại lúc mấy giờ (lần thứ mấy): đúng nhãn, đúng thứ tự hàng đợi', () => {
    const patient = op('patient', { tmpId: 'tmp-p', input: { clientUuid: 'u', fullName: 'Zq Mới Đến' } });
    const checkin = op('checkin', { visitTmpId: 'tmp-v', body: { clientUuid: 'c', patientId: 'tmp-p', specialty: 'noi', priority: 'normal', proposedNumber: 7 }, display: { patientName: 'Zq Mới Đến' } }, { deps: [patient.id] });
    const retry = op('patient', { tmpId: 'tmp-q', input: { clientUuid: 'r', fullName: 'Zq Thử Lại' } }, { status: 'retry', attempts: 2, nextAt: T0 + 4000 }, { error: { status: 503, code: 'incomplete', message: 'Lưu chưa trọn vẹn' } });
    const sending = op('patient', { tmpId: 'tmp-s', input: { clientUuid: 's', fullName: 'Zq Đang Gửi' } });
    const done = op('patient', { tmpId: 'tmp-d', input: { clientUuid: 'd', fullName: 'Zq Đã Xong' } }, { status: 'done' });

    const rows = buildSyncRows(data([sending, done, retry, checkin, patient]), ctx({ sending: sending.id }));
    expect(rows.map((r) => [r.patientName, r.status, r.statusLabel])).toEqual([
      ['Zq Mới Đến', 'pending', 'Chờ gửi'],
      ['Zq Mới Đến', 'waiting', 'Chờ mục trước: «Tạo bệnh nhân · Zq Mới Đến»'],
      ['Zq Thử Lại', 'retry', 'Thử lại lúc 10:00:04 (lần gửi thứ 3)'],
      ['Zq Đang Gửi', 'sending', 'Đang gửi…'],
    ]);
    expect(rows.map((r) => r.kindLabel)).toEqual(['Tạo bệnh nhân', 'Cấp số', 'Tạo bệnh nhân', 'Tạo bệnh nhân']);
    // Số tạm của lượt cấp khi mất mạng, và thông điệp lỗi gần nhất của máy chủ.
    expect(rows[1]).toMatchObject({ number: 7, tentative: true, blockedBy: { id: patient.id }, attention: false });
    expect(rows[2]).toMatchObject({ retry: { at: T0 + 4000, attempts: 2 }, error: { status: 503, code: 'incomplete', message: 'Lưu chưa trọn vẹn' } });
    expect(rows.every((r) => !r.attention)).toBe(true);
  });

  it('409: dòng xung đột mang câu của OFF-7 kèm số và tên người giữ; mục phụ thuộc "bị giữ vì mục X", kể cả qua nhiều bậc', () => {
    const c = visitChain({ status: 'conflict' }, { error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. Trần Quốc Hưng khám' } });
    const rows = buildSyncRows(data(c.all, { signed: new Map([['tmp-rx', signedStub('PM-261020-ABC123', 'Zq Xung Đột')]]) }), ctx());
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['open', 'conflict'],
      ['complete', 'held'],
      ['printed', 'held'],
      ['printed', 'held'],
    ]);
    expect(rows[0]).toMatchObject({
      statusLabel: 'Xung đột',
      conflict: 'Lượt khám 005 đã do BS. Trần Quốc Hưng mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.',
      error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. Trần Quốc Hưng khám' },
    });
    const held = 'Bị giữ: mục «Mở hồ sơ khám · Zq Xung Đột · số 005» đang xung đột';
    expect(rows.slice(1).map((r) => r.statusLabel)).toEqual([held, held, held]);
    // Mục ghi nhận in phụ thuộc mục ký, nhưng bị giữ vì chính mục xung đột (mở hồ sơ), không phải vì mục ký.
    expect(rows.slice(1).map((r) => r.blockedBy?.id)).toEqual([c.open.id, c.open.id, c.open.id]);
    expect(rows.every((r) => r.attention)).toBe(true);
    // Bản khám vẫn trên máy: in lại được từ mục ký.
    expect(rows[1]).toMatchObject({ kindLabel: 'Ký đơn', code: 'PM-261020-ABC123', reprint: 'tmp-rx' });
    expect(rows[0]!.reprint).toBeUndefined();
  });

  it('thứ tự hiện: mục trước luôn đứng trên mục phụ thuộc nó, kể cả khi nó được xếp vào hàng đợi sau (mục ghi nhận in xếp trước mục ký)', () => {
    const complete = op('complete', { visitId: 'v1', rxTmpId: 'tmp-rx', body: exam, display: { patientName: 'Zq Thứ Tự', number: 5 } }, { seq: 30 });
    const printed = op('printed', { prescriptionId: 'tmp-rx', printedAt: '2026-10-20T03:02:05.000Z' }, { seq: 20, deps: [complete.id] });
    const open = op('open', { visitId: 'v1' }, { seq: 10 });
    complete.meta.deps = [open.id];
    const other = op('patient', { tmpId: 'tmp-p', input: { clientUuid: 'u', fullName: 'Zq Khác' } }, { seq: 25 });
    expect(buildSyncRows(data([printed, other, complete, open]), ctx()).map((r) => r.kind)).toEqual(['open', 'complete', 'printed', 'patient']);
  });

  it('409: tên người giữ lượt khám lấy từ hàng chờ của máy chủ khi có (không gọi chính mình là người khác); không có tên thì ghi "người khác"', () => {
    const closed = visitChain({ status: 'conflict' }, { error: { status: 409, code: 'closed', message: 'Lượt khám đã kết thúc hoặc đã hủy' } });
    const byOther = buildSyncRows(data(closed.all, { queue: [queued('v1', 5, 'Zq Xung Đột', { status: 'done', doctorUserId: 'owner', doctorName: 'BS. Chủ' })] }), ctx());
    expect(byOther[0]!.conflict).toBe(conflictText(5, 'BS. Chủ'));
    const byMe = buildSyncRows(data(closed.all, { queue: [queued('v1', 5, 'Zq Xung Đột', { status: 'done', doctorUserId: 'doc', doctorName: 'BS. Thử' })] }), ctx());
    expect(byMe[0]!.conflict).toBe('Lượt khám 005 đã do người khác mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.');
    expect(holderFromMessage('Hồ sơ đang do người khác khám')).toBeUndefined();
    expect(holderFromMessage('Chưa mở hồ sơ hoặc hồ sơ do người khác khám')).toBeUndefined();
  });

  it('422 quy tắc kê đơn: dòng "chờ bác sĩ xác nhận" mang các phát hiện của máy chủ; mục ghi nhận in bị giữ vì nó', () => {
    const c = visitChain({ status: 'done' });
    const unack = [finding('allergy:class:penicillin:amox', 'Bệnh nhân có ghi nhận dị ứng Penicillin: Amoxicillin 500 mg thuộc nhóm này.')];
    c.complete.meta.status = 'rules';
    c.complete.body.error = { status: 422, code: 'rules-not-satisfied', message: 'Lỗi 422', body: { error: 'rules-not-satisfied', blocking: [], unacknowledged: unack } };
    const rows = buildSyncRows(data(c.all), ctx());
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['complete', 'rules'],
      ['printed', 'held'],
      ['printed', 'held'],
    ]);
    expect(rows[0]).toMatchObject({ statusLabel: 'Chờ bác sĩ xác nhận', rules: { unacknowledged: unack, blocking: [] }, attention: true });
    expect(rows[1]!.statusLabel).toBe('Bị giữ: mục «Ký đơn · Zq Xung Đột · số 005 · PM-261020-ABC123» đang chờ bác sĩ xác nhận');
  });

  it('lỗi khác: "cần xử lý", giữ nguyên thông điệp của máy chủ', () => {
    const bad = op('patient', { tmpId: 'tmp-p', input: { clientUuid: 'u', fullName: 'Zq Sai Số' } }, { status: 'error' }, { error: { status: 422, code: 'invalid-phone', message: 'Số điện thoại không hợp lệ' } });
    const checkin = op('checkin', { visitTmpId: 'tmp-v', body: { clientUuid: 'c', patientId: 'tmp-p', specialty: 'noi', priority: 'normal', proposedNumber: 3 }, display: { patientName: 'Zq Sai Số' } }, { deps: [bad.id] });
    const rows = buildSyncRows(data([bad, checkin]), ctx());
    expect(rows[0]).toMatchObject({ status: 'error', statusLabel: 'Cần xử lý', error: { status: 422, code: 'invalid-phone', message: 'Số điện thoại không hợp lệ' } });
    expect(rows[1]).toMatchObject({ status: 'held', statusLabel: 'Bị giữ: mục «Tạo bệnh nhân · Zq Sai Số» cần xử lý' });
  });

  it('mục cần xử lý và mục bị giữ không bao giờ rời danh sách: mất mạng, hết phiên, đang gửi, thời gian trôi đều không đổi trạng thái của chúng', () => {
    const c = visitChain({ status: 'conflict' }, { error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    const expected = buildSyncRows(data(c.all), ctx()).map((r) => [r.id, r.status]);
    expect(expected).toHaveLength(4);
    for (const over of [{ online: false }, { paused: 'unauthorized' as const }, { paused: 'owner' as const }, { sending: c.open.id }, { sending: c.complete.id }, { now: T0 + 86_400_000 }]) {
      expect(buildSyncRows(data(c.all), ctx(over)).map((r) => [r.id, r.status])).toEqual(expected);
    }
  });

  it('mất mạng hoặc hết phiên: mục chờ ghi rõ đang chờ gì, kèm số lần đã gửi chưa được', () => {
    const fresh = op('patient', { tmpId: 'tmp-a', input: { clientUuid: 'a', fullName: 'Zq A' } });
    const failed = op('patient', { tmpId: 'tmp-b', input: { clientUuid: 'b', fullName: 'Zq B' } }, { status: 'retry', attempts: 3, nextAt: T0 + 8000 }, { error: { status: 0, code: 'network', message: 'Không kết nối được máy chủ' } });
    const labels = (over: Partial<ViewContext>) => buildSyncRows(data([fresh, failed]), ctx(over)).map((r) => [r.status, r.statusLabel]);
    expect(labels({ online: false })).toEqual([['pending', 'Chờ có mạng'], ['pending', 'Chờ có mạng (đã gửi 3 lần chưa được)']]);
    expect(labels({ paused: 'unauthorized' })).toEqual([['pending', 'Chờ đăng nhập lại'], ['pending', 'Chờ đăng nhập lại (đã gửi 3 lần chưa được)']]);
    // Tới giờ gửi lại (bộ máy sắp chạy): không còn ghi "thử lại lúc" một giờ đã qua.
    expect(labels({ now: T0 + 8000 })).toEqual([['pending', 'Chờ gửi'], ['pending', 'Chờ gửi (đã gửi 3 lần chưa được)']]);
  });

  it('tên, số, mã đơn: mục cũ không có nhãn riêng thì tra qua hàng chờ trên máy (kể cả id tạm đã có id máy chủ) và đơn đã ký', () => {
    const signed = signedStub('PM-261020-ZZZ999', 'Zq Đơn Cũ');
    const open = op('open', { visitId: 'tmp-v' });
    const complete = op('complete', { visitId: 'tmp-v', rxTmpId: 'tmp-rx', body: exam }, { deps: [open.id] });
    const noRx = op('complete', { visitId: 'v9', body: { ...exam, prescription: undefined } });
    const printed = op('printed', { prescriptionId: 'tmp-rx', printedAt: '2026-10-20T03:02:05.000Z' }, { deps: [complete.id] });
    const rows = buildSyncRows(
      data([open, complete, noRx, printed], {
        ids: new Map([['tmp-v', 'srv-v']]),
        queue: [queued('srv-v', 12, 'Zq Hàng Chờ'), queued('v9', 4, 'Zq Số Tạm', { local: { tentative: true } })],
        signed: new Map([['tmp-rx', signed]]),
      }),
      ctx()
    );
    expect(rows.map((r) => [r.kindLabel, r.patientName, r.number, r.tentative, r.code])).toEqual([
      ['Mở hồ sơ khám', 'Zq Hàng Chờ', 12, undefined, undefined],
      ['Ký đơn', 'Zq Hàng Chờ', 12, undefined, 'PM-261020-ZZZ999'],
      ['Kết thúc khám (không kê đơn)', 'Zq Số Tạm', 4, true, undefined],
      ['Ghi nhận in đơn', 'Zq Đơn Cũ', undefined, undefined, 'PM-261020-ZZZ999'],
    ]);
    expect(rows[2]!.label).toBe('Kết thúc khám (không kê đơn) · Zq Số Tạm · số 004 (tạm)');
    expect(rows[2]!.reprint).toBeUndefined();
  });
});

describe('xác nhận lại phát hiện của máy chủ (422)', () => {
  const findings = [finding('allergy:a', 'Dị ứng A'), finding('allergy:b', 'Dị ứng B')];
  it(`mỗi phát hiện một lý do, ít nhất 5 ký tự sau khi bỏ khoảng trắng; thiếu một lý do thì chưa gửi được`, () => {
    expect(ackList(findings, {})).toBeUndefined();
    expect(ackList(findings, { 'allergy:a': 'Đã gọi bệnh nhân, ngưng thuốc' })).toBeUndefined();
    expect(ackList(findings, { 'allergy:a': 'Đã gọi bệnh nhân', 'allergy:b': 'abcd' })).toBeUndefined();
    expect(ackList(findings, { 'allergy:a': 'Đã gọi bệnh nhân', 'allergy:b': '  ab    ' })).toBeUndefined();
    expect(ackList(findings, { 'allergy:a': '  Đã gọi bệnh nhân ', 'allergy:b': 'abcde', other: 'bỏ qua' })).toEqual([
      { key: 'allergy:a', reason: 'Đã gọi bệnh nhân' },
      { key: 'allergy:b', reason: 'abcde' },
    ]);
    expect(ackList([], {})).toBeUndefined();
  });
});

describe('thông báo không âm thầm (N3)', () => {
  it('một thông báo cho mỗi mục vừa bị từ chối (xung đột, chờ xác nhận, cần xử lý); mục bị giữ không có thông báo riêng', () => {
    const c = visitChain({ status: 'conflict' }, { error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    const rules = op('complete', { visitId: 'v2', rxTmpId: 'tmp-r2', body: exam, display: { patientName: 'Zq Dị Ứng', number: 6, code: 'PM-261020-DDD444' } }, { status: 'rules' }, { error: { status: 422, code: 'rules-not-satisfied', message: 'Lỗi 422' } });
    const error = op('patient', { tmpId: 'tmp-p', input: { clientUuid: 'u', fullName: 'Zq Sai Số' } }, { status: 'error' }, { error: { status: 400, code: 'invalid', message: 'Thiếu họ tên' } });
    const notices = buildNotices(data([...c.all, rules, error]), ctx());
    expect(notices.map((n) => [n.kind, n.opId])).toEqual([
      ['conflict', c.open.id],
      ['rules', rules.id],
      ['error', error.id],
    ]);
    expect(notices[0]!.text).toBe('Lượt khám 005 đã do BS. B mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống. Bản khám vẫn giữ trên máy này.');
    expect(notices[1]!.text).toContain('Đơn PM-261020-DDD444 của Zq Dị Ứng đã in nhưng CHƯA lưu lên máy chủ');
    expect(notices[2]!.text).toBe('Máy chủ từ chối mục «Tạo bệnh nhân · Zq Sai Số»: Thiếu họ tên');
  });

  it('mục bị từ chối lần nữa là sự việc mới (id thông báo đổi), nên thông báo đã tắt hiện lại', () => {
    const rules = op('complete', { visitId: 'v2', body: exam }, { status: 'rules' }, { error: { status: 422, code: 'rules-not-satisfied', message: 'Lỗi 422' } });
    const first = buildNotices(data([rules]), ctx())[0]!.id;
    expect(buildNotices(data([rules]), ctx())[0]!.id).toBe(first);
    const again = { ...rules, updatedAt: rules.updatedAt + 5000 } as AnyOp;
    expect(buildNotices(data([again]), ctx())[0]!.id).not.toBe(first);
  });

  it('máy chủ đổi số tạm: báo số cũ và số mới; giữ đúng số thì không báo', () => {
    const item = (number: number): QueueItem => queued('srv', number, 'Zq Số Tạm') as QueueItem;
    const checkin = (proposed: number, got: number) =>
      op('checkin', { visitTmpId: 'tmp-v', body: { clientUuid: 'c', patientId: 'p', specialty: 'noi', priority: 'normal', proposedNumber: proposed }, display: { patientName: 'Zq Số Tạm' } }, { status: 'done' }, { result: { item: item(got), created: true } });
    const moved = checkin(7, 9);
    expect(buildNotices(data([moved, checkin(8, 8)]), ctx())).toEqual([
      { id: `renumbered:${moved.id}`, kind: 'renumbered', opId: moved.id, text: 'Số 007 (cấp khi mất mạng) của Zq Số Tạm đã đổi thành 009: máy khác đã cấp số đó trước.' },
    ]);
  });

  it('mã đơn trên máy chủ khác mã đã in: báo cả hai mã; trùng mã thì không báo', () => {
    const complete = (printed: string, server: string) =>
      op('complete', { visitId: 'v1', rxTmpId: 'tmp-rx', body: exam, display: { patientName: 'Zq Lệch Mã', number: 5, code: printed } }, { status: 'done' }, { result: { visit: {}, prescription: { id: 'rx', code: server }, replayed: false } as never });
    const off = complete('PM-261020-AAA111', 'PM-261021-AAA111');
    expect(buildNotices(data([off, complete('PM-261020-BBB222', 'PM-261020-BBB222')]), ctx())).toEqual([
      { id: `code-mismatch:${off.id}`, kind: 'code-mismatch', opId: off.id, text: 'Mã đơn trên máy chủ (PM-261021-AAA111) khác mã đã in (PM-261020-AAA111) của Zq Lệch Mã: hãy in lại đơn.' },
    ]);
  });
});

describe('tắt thông báo không tắt được huy hiệu (N3)', () => {
  const sync = { online: true, paused: false as const, counted: true, pending: 4, attention: 4, version: 1 };

  it('tắt hết thông báo: thông báo biến mất, nhưng huy hiệu "cần xử lý", số mục chờ và các dòng của danh sách giữ nguyên', () => {
    const c = visitChain({ status: 'conflict' }, { error: { status: 409, code: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    const d = data(c.all);
    const before = overviewOf(d, sync, true, 'doc', new Set(), T0);
    expect(before.notices.map((n) => n.kind)).toEqual(['conflict']);
    expect(before.view).toMatchObject({ pending: 4, attention: 4 });

    const after = overviewOf(d, sync, true, 'doc', new Set(before.notices.map((n) => n.id)), T0);
    expect(after.notices).toEqual([]);
    expect(after.view).toEqual(before.view);
    expect(after.view.attention).toBe(4);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows!.filter((r) => r.attention)).toHaveLength(4);
  });

  it('tắt một thông báo không tắt thông báo khác; chưa đọc xong kho thì chưa có dòng và chưa có thông báo', () => {
    const a = op('patient', { tmpId: 'tmp-a', input: { clientUuid: 'a', fullName: 'Zq A' } }, { status: 'error' }, { error: { status: 400, code: 'x', message: 'Sai A' } });
    const b = op('patient', { tmpId: 'tmp-b', input: { clientUuid: 'b', fullName: 'Zq B' } }, { status: 'error' }, { error: { status: 400, code: 'x', message: 'Sai B' } });
    const all = buildNotices(data([a, b]), ctx());
    expect(visibleNotices(all, new Set([all[0]!.id])).map((n) => n.opId)).toEqual([b.id]);
    expect(overviewOf(undefined, sync, true, 'doc', new Set(), T0)).toMatchObject({ rows: undefined, notices: [], view: { attention: 4 } });
  });
});

describe('chỉ báo mạng và đồng bộ', () => {
  const state = { online: true, paused: false as const, counted: true, pending: 0, attention: 0, version: 1 };

  it('chưa đếm xong thì hiện "đang đếm", không hiện 0 và không hiện "đã đồng bộ hết"', () => {
    const v = indicatorView({ ...state, counted: false }, true);
    expect(v.pending).toBeUndefined();
    expect(v.summary).toBe('Đang đếm mục chờ…');
    expect(indicatorView(state, true)).toMatchObject({ pending: 0, summary: 'Đã đồng bộ hết' });
    expect(indicatorView({ ...state, pending: 3, attention: 2 }, true)).toMatchObject({ pending: 3, attention: 2, summary: '3 mục chờ đồng bộ' });
  });

  it('có mạng hay mất mạng, đang gửi, lần gửi thành công cuối (giờ Việt Nam)', () => {
    expect(indicatorView(state, false)).toMatchObject({ online: false, sending: false });
    expect(indicatorView({ ...state, pending: 1, sending: 'op-1' }, true)).toMatchObject({ online: true, sending: true });
    expect(indicatorView(state, true).lastSync).toBeUndefined();
    expect(indicatorView({ ...state, lastSyncAt: T0 + 32 * 60_000 }, true).lastSync).toBe('Gửi lần cuối 10:32');
  });

  it('hết phiên (401): "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục"', () => {
    expect(indicatorView({ ...state, pending: 4, paused: 'unauthorized' }, true).expired).toBe('Phiên đã hết hạn: đăng nhập lại để đồng bộ 4 mục');
    expect(indicatorView({ ...state, pending: 4 }, true).expired).toBeUndefined();
    expect(indicatorView({ ...state, pending: 4, paused: 'owner' }, true).expired).toBeUndefined();
    expect(expiredText(0)).toBe('Phiên đã hết hạn: đăng nhập lại');
    // Chưa đếm xong: không bịa ra con số.
    expect(expiredText(undefined)).toBe('Phiên đã hết hạn: đăng nhập lại để đồng bộ các mục còn trên máy này');
    expect(indicatorView({ ...state, counted: false, paused: 'unauthorized' }, true).expired).toBe(expiredText(undefined));
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Từ hàng đợi thật: kho IndexedDB giả, bộ máy đồng bộ thật, BFF giả, đồng hồ ảo.

const auth: AuthState = { token: 'tok-doc', user: { id: 'doc', name: 'BS. Thử', role: 'doctor' }, tenant: { slug: 'noi', name: 'Phòng khám Nội (thử)' } };
const owner = { tenant: 'noi', userId: 'doc' };

describe('danh sách dựng từ hàng đợi thật', () => {
  let bff: FakeBff;
  let clock: FakeClock;
  let online: boolean;
  let store: LocalStore;
  let engine: SyncEngine;
  let client: OfflineClient;
  let printed: Array<{ detail: PrescriptionDetail; pendingSync: boolean }>;
  const engines: SyncEngine[] = [];

  const newEngine = (s: LocalStore) => {
    const e = new SyncEngine({ store: s, owner, session: () => ({ token: 'tok-doc', ...owner }), clock, isOnline: () => online, baseMs: 1000, capMs: 8000 });
    engines.push(e);
    return e;
  };
  const rows = async () => buildSyncRows(await client.syncData(), { now: clock.now(), online: engine.state.online, paused: engine.state.paused, me: 'doc', ...(engine.state.sending ? { sending: engine.state.sending } : {}) });

  beforeEach(async () => {
    bff = new FakeBff();
    clock = new FakeClock(T0);
    online = true;
    vi.stubGlobal('fetch', bff.fetch);
    store = await openEncryptedStore(owner);
    engine = newEngine(store);
    printed = [];
    client = new OfflineClient({ store, engine, auth: () => auth, now: clock.now, printLocal: async (detail, _clinic, pendingSync) => void printed.push({ detail, pendingSync }) });
  });

  afterEach(async () => {
    for (const e of engines.splice(0)) e.stop();
    await store.destroy().catch(() => undefined);
    for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
    vi.unstubAllGlobals();
  });

  /** Một lượt khám đang chờ trên máy chủ, đã có trong ảnh chụp hàng chờ của máy này. */
  async function serverVisit(fullName: string, number: number): Promise<QueueItem> {
    const patient = { id: crypto.randomUUID(), fullName };
    bff.patients.set(crypto.randomUUID(), patient);
    const item: QueueItem = { id: crypto.randomUUID(), number, code: `20261020-00${number}`, status: 'waiting', priority: 'normal', specialty: 'noi', patientId: patient.id, patientName: fullName, arrivedAt: '2026-10-20T02:00:00.000Z' };
    bff.visits.set(item.id, { item, clientUuid: crypto.randomUUID() });
    await client.saveSnapshot('2026-10-20', [...bff.visits.values()].map((v) => v.item));
    return item;
  }

  /** Mở hồ sơ, ký và ghi nhận in lúc mất mạng cho một lượt khám của máy chủ (như `OfflineClient` ghi vào hàng đợi). */
  function offlineVisitOps(item: QueueItem): { open: NewOp; complete: NewOp; printed: NewOp } {
    const display = { patientName: item.patientName, number: item.number };
    const open: NewOp = { id: crypto.randomUUID(), kind: 'open', payload: { visitId: item.id, openedAt: '2026-10-20T03:01:00.000Z', display } };
    const body: CompleteRequest = { ...exam, clientUuid: crypto.randomUUID(), clientTimes: { openedAt: '2026-10-20T03:01:00.000Z', signedAt: '2026-10-20T03:02:00.000Z' } };
    const rxTmpId = newTmpId();
    const complete: NewOp = { id: body.clientUuid, kind: 'complete', deps: [open.id], payload: { visitId: item.id, rxTmpId, body, display: { ...display, code: 'PM-261020-ABC123' } } };
    const printed: NewOp = { id: crypto.randomUUID(), kind: 'printed', deps: [complete.id], payload: { prescriptionId: rxTmpId, printedAt: '2026-10-20T03:02:05.000Z', display: { ...display, code: 'PM-261020-ABC123' } } };
    return { open, complete, printed };
  }

  it('409 thật: người khác đã mở lượt khám; danh sách báo xung đột kèm tên, mục ký và ghi nhận in bị giữ; "Đồng bộ ngay" và thời gian trôi không gửi lại, không làm mục biến mất', async () => {
    const item = await serverVisit('Zq Xung Đột', 5);
    const o = offlineVisitOps(item);
    online = false;
    await engine.enqueue([o.open, o.complete, o.printed]);
    // Chủ phòng khám mở cùng lượt đó ở máy khác.
    bff.tokens.set('tok-owner', { userId: 'owner', name: 'BS. Chủ' });
    await bff.fetch(`/api/visits/${item.id}/open`, { method: 'POST', headers: { authorization: 'Bearer tok-owner' } });
    online = true;
    await engine.wake();

    const expected = [
      ['open', 'conflict', 'Xung đột'],
      ['complete', 'held', 'Bị giữ: mục «Mở hồ sơ khám · Zq Xung Đột · số 005» đang xung đột'],
      ['printed', 'held', 'Bị giữ: mục «Mở hồ sơ khám · Zq Xung Đột · số 005» đang xung đột'],
    ];
    const first = await rows();
    expect(first.map((r) => [r.kind, r.status, r.statusLabel])).toEqual(expected);
    expect(first[0]!.conflict).toBe('Lượt khám 005 đã do BS. Chủ mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.');
    expect(first[0]!.error).toEqual({ status: 409, code: 'taken', message: 'Hồ sơ đang do BS. Chủ khám' });
    expect(engine.state).toMatchObject({ pending: 3, attention: 3 });

    const sent = bff.requests.length;
    await engine.syncNow();
    clock.advance(120_000);
    await engine.idle();
    await engine.wake();
    expect(bff.requests.length).toBe(sent);
    expect(bff.requests.filter((r) => r.path.endsWith('/complete'))).toHaveLength(0);
    expect(bff.completions.size).toBe(0);
    expect((await rows()).map((r) => [r.kind, r.status, r.statusLabel])).toEqual(expected);
  });

  it('422 thật: dòng "chờ xác nhận" mang phát hiện của máy chủ; lỗi tạm thành "thử lại lúc … (lần gửi thứ …)" theo đồng hồ ảo', async () => {
    const item = await serverVisit('Zq Dị Ứng', 6);
    const o = offlineVisitOps(item);
    bff.rulesRequire = ['allergy:class:penicillin'];
    bff.fault(/\/open$/, { status: 503, body: { error: 'incomplete', message: 'Lưu chưa trọn vẹn' } });
    await engine.enqueue([o.open, o.complete, o.printed]);
    await engine.run();
    expect((await rows()).map((r) => [r.kind, r.status, r.statusLabel])).toEqual([
      ['open', 'retry', 'Thử lại lúc 10:00:01 (lần gửi thứ 2)'],
      ['complete', 'waiting', 'Chờ mục trước: «Mở hồ sơ khám · Zq Dị Ứng · số 006»'],
      ['printed', 'waiting', 'Chờ mục trước: «Ký đơn · Zq Dị Ứng · số 006 · PM-261020-ABC123»'],
    ]);
    expect((await rows())[0]!.error).toEqual({ status: 503, code: 'incomplete', message: 'Lưu chưa trọn vẹn' });

    clock.advance(1000);
    await engine.idle();
    const after = await rows();
    expect(after.map((r) => [r.kind, r.status])).toEqual([
      ['complete', 'rules'],
      ['printed', 'held'],
    ]);
    expect(after[0]!.rules?.unacknowledged.map((f) => f.key)).toEqual(['allergy:class:penicillin']);
    expect(after[1]!.statusLabel).toBe('Bị giữ: mục «Ký đơn · Zq Dị Ứng · số 006 · PM-261020-ABC123» đang chờ bác sĩ xác nhận');
  });

  it('đang gửi: dòng của mục đang nằm trên đường truyền ghi "Đang gửi…", xong thì rời danh sách', async () => {
    const p: NewOp = { id: crypto.randomUUID(), kind: 'patient', payload: { tmpId: newTmpId(), input: { clientUuid: '', fullName: 'Zq Đang Gửi' } } };
    (p.payload as Payloads['patient']).input.clientUuid = p.id;
    await engine.enqueue([p]);
    let open!: () => void;
    bff.gate = new Promise((r) => (open = r));
    const run = engine.run();
    await vi.waitFor(() => expect(bff.inFlight).toBe(1));
    expect((await rows()).map((r) => [r.patientName, r.status, r.statusLabel])).toEqual([['Zq Đang Gửi', 'sending', 'Đang gửi…']]);
    expect(indicatorView(engine.state, true).sending).toBe(true);
    open();
    bff.gate = undefined;
    await run;
    expect(await rows()).toEqual([]);
    expect(indicatorView(engine.state, true)).toMatchObject({ sending: false, pending: 0, lastSync: 'Gửi lần cuối 10:00' });
  });

  it('"đang đếm" trước lần đếm đầu: kho còn 2 mục từ phiên trước, bộ máy mới chưa đếm thì chỉ báo không được hiện 0', async () => {
    online = false;
    await engine.enqueue([
      { id: crypto.randomUUID(), kind: 'patient', payload: { tmpId: newTmpId(), input: { clientUuid: 'a', fullName: 'Zq Một' } } },
      { id: crypto.randomUUID(), kind: 'patient', payload: { tmpId: newTmpId(), input: { clientUuid: 'b', fullName: 'Zq Hai' } } },
    ]);
    engine.stop();

    // Đăng nhập lại (tải lại trang): bộ máy mới trên cùng kho.
    const fresh = newEngine(store);
    expect(await store.pendingCount()).toBe(2);
    expect(fresh.state).toMatchObject({ counted: false, pending: 0 });
    const before = indicatorView(fresh.state, false);
    expect(before.pending).toBeUndefined();
    expect(before.summary).toBe('Đang đếm mục chờ…');

    await fresh.start();
    expect(fresh.state).toMatchObject({ counted: true, pending: 2 });
    expect(indicatorView(fresh.state, false)).toMatchObject({ pending: 2, summary: '2 mục chờ đồng bộ' });
  });

  /** Đơn đã ký khi mất mạng, giữ trên máy để in lại (như `OfflineClient.complete` ghi cùng giao dịch với mục hoàn tất). */
  async function keepSigned(o: { complete: NewOp }, patientName: string, day = '2026-10-20'): Promise<string> {
    const rxTmpId = (o.complete.payload as Payloads['complete']).rxTmpId!;
    const detail = { prescription: { id: rxTmpId, code: 'PM-261020-ABC123' }, patient: { id: 'p', fullName: patientName }, diagnoses: [], encounterId: 'v' } as unknown as PrescriptionDetail;
    await store.commit([{ table: 'signed', id: rxTmpId, plain: { day }, value: { detail, clinicName: 'Phòng khám Nội (thử)', completeOpId: o.complete.id } }]);
    return rxTmpId;
  }
  const actions = () => syncListActions(client);
  const rowOf = async (id: string): Promise<SyncRow> => (await rows()).find((r) => r.id === id)!;
  const completeRequests = (uuid: string) => bff.requests.filter((r) => r.path.endsWith('/complete') && r.body?.['clientUuid'] === uuid);

  it('xác nhận 422 từ danh sách: gửi lại CÙNG clientUuid kèm lý do; máy chủ có đúng một lượt hoàn tất; thiếu hoặc quá ngắn thì không gửi gì', async () => {
    const item = await serverVisit('Zq Dị Ứng', 6);
    const o = offlineVisitOps(item);
    await keepSigned(o, 'Zq Dị Ứng');
    bff.rulesRequire = ['allergy:class:penicillin'];
    await engine.enqueue([o.open, o.complete, o.printed]);
    await engine.run();
    const row = await rowOf(o.complete.id);
    expect(row.status).toBe('rules');
    expect(completeRequests(o.complete.id)).toHaveLength(1);

    await expect(actions().acknowledge(row, {})).rejects.toThrow(/lý do/);
    await expect(actions().acknowledge(row, { 'allergy:class:penicillin': 'ok' })).rejects.toThrow(/lý do/);
    expect(completeRequests(o.complete.id)).toHaveLength(1);
    expect((await rowOf(o.complete.id)).status).toBe('rules');

    await actions().acknowledge(row, { 'allergy:class:penicillin': '  Đã gọi bệnh nhân: từng dùng amoxicillin, không phản ứng ' });
    await engine.idle();
    const sent = completeRequests(o.complete.id);
    expect(sent).toHaveLength(2);
    expect(bff.requests.filter((r) => r.path.endsWith('/complete'))).toHaveLength(2);
    expect((sent[1]!.body!['prescription'] as { acknowledgements: unknown[] }).acknowledgements).toEqual([{ key: 'allergy:class:penicillin', reason: 'Đã gọi bệnh nhân: từng dùng amoxicillin, không phản ứng' }]);
    expect(bff.completions.size).toBe(1);
    expect([...bff.completions.keys()]).toEqual([o.complete.id]);
    // Máy chủ nhận rồi: mục ký và mục ghi nhận in rời danh sách.
    expect(await rows()).toEqual([]);
    expect(bff.printed).toHaveLength(1);
  });

  it('xác nhận chỉ dùng được cho mục đang chờ xác nhận; đơn có lỗi chặn thì không gửi lại được bằng xác nhận', async () => {
    const item = await serverVisit('Zq Xung Đột', 5);
    const o = offlineVisitOps(item);
    bff.fault(/\/open$/, { status: 409, body: { error: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    await engine.enqueue([o.open, o.complete, o.printed]);
    await engine.run();
    const sent = bff.requests.length;
    for (const row of await rows()) await expect(actions().acknowledge(row, { any: 'Lý do đủ dài' })).rejects.toThrow();
    const blocked: SyncRow = { ...(await rowOf(o.complete.id)), status: 'rules', rules: { unacknowledged: [finding('a', 'A')], blocking: [finding('b', 'B', 'block')] } };
    await expect(actions().acknowledge(blocked, { a: 'Lý do đủ dài' })).rejects.toThrow(/không xác nhận được/);
    expect(bff.requests.length).toBe(sent);
    expect((await rows()).map((r) => r.status)).toEqual(['conflict', 'held', 'held']);
  });

  it('409 từ danh sách: in lại được từ bản giữ trên máy (nhãn "ký khi mất mạng"); lần in lại thành một mục bị giữ; máy chủ không nhận gì thêm', async () => {
    const item = await serverVisit('Zq Xung Đột', 5);
    const o = offlineVisitOps(item);
    const rxTmpId = await keepSigned(o, 'Zq Xung Đột');
    bff.fault(/\/open$/, { status: 409, body: { error: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    await engine.enqueue([o.open, o.complete, o.printed]);
    await engine.run();
    const sent = bff.requests.length;

    const row = await rowOf(o.complete.id);
    expect(row).toMatchObject({ status: 'held', reprint: rxTmpId });
    await actions().reprint(row);
    await engine.idle();
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatchObject({ pendingSync: true, detail: { prescription: { code: 'PM-261020-ABC123' } } });
    expect((await rows()).map((r) => [r.kind, r.status, r.patientName, r.code])).toEqual([
      ['open', 'conflict', 'Zq Xung Đột', undefined],
      ['complete', 'held', 'Zq Xung Đột', 'PM-261020-ABC123'],
      ['printed', 'held', 'Zq Xung Đột', 'PM-261020-ABC123'],
      ['printed', 'held', 'Zq Xung Đột', 'PM-261020-ABC123'],
    ]);
    expect(bff.requests.length).toBe(sent);
    // Mục không có đơn giữ trên máy thì không in lại được.
    await expect(actions().reprint(await rowOf(o.open.id))).rejects.toThrow();
    expect(printed).toHaveLength(1);
  });

  it('không có đường nào xóa mục khỏi danh sách: gọi mọi thao tác của danh sách trên mọi dòng, ở mọi trạng thái, không mục nào rời hàng đợi', async () => {
    // Ba chuỗi: xung đột (và hai mục bị giữ), chờ xác nhận (và một mục bị giữ), lỗi khác; cộng một mục đang thử lại.
    const conflictItem = await serverVisit('Zq Xung Đột', 5);
    const conflict = offlineVisitOps(conflictItem);
    const rules = offlineVisitOps(await serverVisit('Zq Dị Ứng', 6));
    await keepSigned(conflict, 'Zq Xung Đột');
    await keepSigned(rules, 'Zq Dị Ứng');
    const bad: NewOp = { id: crypto.randomUUID(), kind: 'patient', payload: { tmpId: newTmpId(), input: { clientUuid: 'bad', fullName: 'Zq Sai Số' } } };
    const flaky: NewOp = { id: crypto.randomUUID(), kind: 'patient', payload: { tmpId: newTmpId(), input: { clientUuid: 'flaky', fullName: 'Zq Thử Lại' } } };
    bff.rulesRequire = ['allergy:class:penicillin'];
    bff.fault(new RegExp(`${conflictItem.id}/open$`), { status: 409, body: { error: 'taken', message: 'Hồ sơ đang do BS. B khám' } });
    bff.fault(/POST \/api\/patients/, { status: 422, body: { error: 'invalid-phone', message: 'Số điện thoại không hợp lệ' } });
    for (let i = 0; i < 40; i++) bff.fault(/POST \/api\/patients/, { status: 503, body: { error: 'incomplete', message: 'Lưu chưa trọn vẹn' } });
    await engine.enqueue([conflict.open, conflict.complete, conflict.printed, rules.open, rules.complete, rules.printed, bad, flaky]);
    await engine.run();
    const before = await rows();
    expect(before.map((r) => r.status).sort()).toEqual(['conflict', 'error', 'held', 'held', 'held', 'retry', 'rules']);
    const ids = before.map((r) => r.id).sort();

    const a = actions();
    expect(Object.keys(a).sort()).toEqual(['acknowledge', 'reprint', 'syncNow']);
    for (const row of before) {
      await a.syncNow();
      await a.acknowledge(row, {}).catch(() => undefined);
      await a.acknowledge(row, { other: 'Lý do cho khóa khác' }).catch(() => undefined);
      await a.reprint(row).catch(() => undefined);
      clock.advance(60_000);
      await engine.idle();
    }
    await a.syncNow();
    const after = await rows();
    // Mọi mục ban đầu còn nguyên (in lại chỉ thêm mục ghi nhận in, không bỏ mục nào).
    expect(after.map((r) => r.id).filter((id) => ids.includes(id)).sort()).toEqual(ids);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    const statusOf = (list: SyncRow[], id: string) => list.find((r) => r.id === id)!.status;
    for (const id of [conflict.open.id, conflict.complete.id, conflict.printed.id, rules.complete.id, rules.printed.id, bad.id]) expect(statusOf(after, id)).toBe(statusOf(before, id));
    expect(bff.completions.size).toBe(0);
    expect(bff.requests.filter((r) => r.path.endsWith('/complete'))).toHaveLength(1);
  });

  it('mã của danh sách không nhắc tới việc bỏ mục (`discard`): danh sách chỉ nhận `SyncListActions`, không nhận bộ máy đồng bộ', () => {
    for (const [name, source] of Object.entries({ syncActionsSource, syncListSource, useSyncOverviewSource, syncPanelSource, syncBarSource })) {
      expect(source.length, name).toBeGreaterThan(500);
      expect(/\.discard\s*\(|\bdelete:\s*true|store\.commit\(/.test(source), `${name} không được bỏ mục hay ghi thẳng vào kho`).toBe(false);
    }
    // Khung ứng dụng chỉ gọi bộ máy qua `syncListActions` và nút "Chờ đồng bộ" của hộp thoại đăng xuất.
    expect(shellSource).toContain('syncListActions(client)');
    expect(/\.discard\s*\(/.test(shellSource)).toBe(false);
    expect(shellSource.match(/client\.engine\.\w+/g)).toEqual(['client.engine.syncNow']);
  });

  it('nhãn hiển thị của mục (tên, số, mã đơn) không bao giờ lên máy chủ', async () => {
    const item = await serverVisit('Zq Không Lộ', 8);
    online = false;
    engine.observe(false);
    const opened = await client.openVisit(item);
    expect(opened.offline).toBe(true);
    await client.recordLocalPrint(newTmpId(), undefined, { patientName: 'Zq Không Lộ', code: 'PM-261020-ABC123' });
    const queuedOps = await engine.ops();
    expect(queuedOps.map((o) => (o.body.payload as { display?: unknown }).display)).toEqual([
      { patientName: 'Zq Không Lộ', number: 8 },
      { patientName: 'Zq Không Lộ', code: 'PM-261020-ABC123' },
    ]);
    online = true;
    await engine.wake();
    const openRequest = bff.requests.find((r) => r.path.endsWith('/open'))!;
    expect(Object.keys(openRequest.body ?? {})).toEqual(['openedAt']);
    expect(JSON.stringify(bff.requests)).not.toContain('display');
    expect(JSON.stringify(bff.requests)).not.toContain('Zq Không Lộ');
  });
});
