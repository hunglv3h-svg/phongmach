import type { QueueItem } from '@phongmach/clinical';
import { describe, expect, it } from 'vitest';
import { mergeQueue, nextLocalNumber, searchLocal, type CachedPatient } from './cache';
import type { AnyOp, Payloads } from './ops';
import type { OpKind, OpMeta, OpStatus } from './store';

const entry = (id: string, fullName: string, phone?: string, cccd?: string): CachedPatient => ({ patient: { id, fullName, ...(phone ? { phone } : {}), cccdMasked: '••••••••1234' }, ...(cccd ? { cccd } : {}) });
const CACHE = [
  entry('p1', 'Nguyễn Văn An', '0912345678'),
  entry('p2', 'Nguyễn Văn Ân', '0987655678'),
  entry('p3', 'Trần Thị Bình', '0905678123'),
  entry('p4', 'Lê Anh Tuấn', '0911111111', '001085001234'),
];
const names = (q: string) => searchLocal(q, CACHE).map((p) => p.fullName);

describe('tìm trong bộ đệm khi mất mạng', () => {
  it('tên không dấu, theo tiền tố từng từ, mọi từ phải khớp', () => {
    expect(names('nguyen van an')).toEqual(['Nguyễn Văn An', 'Nguyễn Văn Ân']);
    expect(names('ng v a')).toEqual(['Nguyễn Văn An', 'Nguyễn Văn Ân']);
    expect(names('binh')).toEqual(['Trần Thị Bình']);
    expect(names('an')).toEqual(['Lê Anh Tuấn', 'Nguyễn Văn An', 'Nguyễn Văn Ân']);
    expect(names('guyen')).toEqual([]); // không khớp giữa từ
    expect(names('tran binh x')).toEqual([]);
  });

  it('số điện thoại đầy đủ (mọi cách viết) và 4 số cuối (số kết thúc bằng đoạn đó xếp trước)', () => {
    expect(names('0912 345 678')).toEqual(['Nguyễn Văn An']);
    expect(names('+84912345678')).toEqual(['Nguyễn Văn An']);
    expect(names('5678')).toEqual(['Nguyễn Văn An', 'Nguyễn Văn Ân', 'Trần Thị Bình']);
  });

  it('CCCD chỉ tìm được với bệnh nhân tạo trên máy này (bộ đệm khác chỉ có CCCD đã che)', () => {
    expect(names('001085001234')).toEqual(['Lê Anh Tuấn']);
    expect(names('001085009999')).toEqual([]);
  });

  it('ô trống hoặc quá ngắn: không có kết quả', () => {
    expect(names('')).toEqual([]);
    expect(names('12')).toEqual([]);
  });
});

const ME = { id: 'doc', name: 'BS. Hà' };
let seq = 0;
function op<K extends OpKind>(kind: K, payload: Payloads[K], status: OpStatus = 'pending', result?: unknown): AnyOp {
  const meta: OpMeta = { seq: ++seq, kind, status, deps: [], day: '2026-10-20', createdAt: Date.parse('2026-10-20T03:00:00Z'), attempts: 0, nextAt: 0 };
  return { id: `op${seq}`, meta, body: { payload, ...(result ? { result } : {}) }, updatedAt: 0 } as AnyOp;
}
const item = (over: Partial<QueueItem>): QueueItem => ({ id: 'v1', number: 1, code: 'c', status: 'waiting', priority: 'normal', specialty: 'noi', patientId: 'p1', patientName: 'Nguyễn Văn An', arrivedAt: '2026-10-20T02:00:00Z', ...over });
const checkin = (visitTmpId: string, proposedNumber: number, patientName = 'Trần Thị Bình', over: Partial<Payloads['checkin']['body']> = {}) =>
  ({ visitTmpId, body: { clientUuid: 'u', patientId: 'tmp-p', specialty: 'noi', priority: 'normal', arrivedAt: '2026-10-20T03:00:00.000Z', proposedNumber, ...over }, display: { patientName } }) satisfies Payloads['checkin'];
const UUID_E = '3f2b8c1e-5a47-4d09-9e6b-0c1d2e3f4a5b';

describe('gộp hàng chờ của máy chủ với thao tác trên máy', () => {
  it('người cấp số khi mất mạng hiện với số tạm; mở hồ sơ và ký trên máy hiện đúng trạng thái dù máy chủ chưa biết', () => {
    const merged = mergeQueue(
      [item({ id: 'v1', number: 1 }), item({ id: 'v2', number: 2, patientName: 'Lê Văn C' })],
      [op('checkin', checkin('tmp-v3', 3)), op('open', { visitId: 'tmp-v3', openedAt: '2026-10-20T03:05:00.000Z' }), op('open', { visitId: 'v1' }), op('complete', { visitId: 'v1', body: { clientUuid: 'c', exam: { vitals: {} }, diagnoses: [] } })],
      new Map(),
      ME
    );
    expect(merged.map((i) => [i.number, i.status, i.local])).toEqual([
      [3, 'in-exam', { tentative: true, pending: true }],
      [2, 'waiting', undefined],
      [1, 'done', { pending: true }],
    ]);
    expect(merged[0]).toMatchObject({ patientName: 'Trần Thị Bình', doctorUserId: 'doc', calledAt: '2026-10-20T03:05:00.000Z' });
  });

  it('đã đồng bộ: dùng bản của máy chủ (id thật); máy chủ đổi số thì ghi lại số cũ và số mới', () => {
    const server = item({ id: 'srv-v3', number: 4, patientName: 'Trần Thị Bình' });
    const merged = mergeQueue([item({}), server], [op('checkin', checkin('tmp-v3', 3), 'done', { item: server, created: true }), op('open', { visitId: 'tmp-v3' })], new Map([['tmp-v3', 'srv-v3']]), ME);
    expect(merged.find((i) => i.id === 'srv-v3')).toMatchObject({ number: 4, status: 'in-exam', local: { renumbered: { from: 3, to: 4 }, pending: true } });
    expect(merged).toHaveLength(2);
  });

  it('đã đồng bộ nhưng ảnh chụp hàng chờ chưa tải lại: vẫn hiện (từ kết quả của máy chủ), không mất dòng', () => {
    const server = item({ id: 'srv-v3', number: 3, patientName: 'Trần Thị Bình' });
    const merged = mergeQueue([item({})], [op('checkin', checkin('tmp-v3', 3), 'done', { item: server, created: true })], new Map([['tmp-v3', 'srv-v3']]), ME);
    expect(merged.map((i) => [i.id, i.number, i.local])).toEqual([
      ['v1', 1, undefined],
      ['srv-v3', 3, undefined],
    ]);
  });

  // Mất phản hồi ở "cấp số": máy chủ đã có lượt E, mục cấp số trên máy chưa xong (đã chuyển sang dạng ngoại tuyến, id tạm) và
  // CHƯA có ánh xạ id. Máy tải được hàng chờ của máy chủ trước khi mục đó được gửi lại.
  describe('máy chủ đã có lượt khám mà mục cấp số trên máy chưa xong (mất phản hồi ở cấp số)', () => {
    const E = item({ id: 'srv-E', number: 3, patientId: 'p9', patientName: 'Trần Thị Bình', clientUuid: UUID_E });
    const lost = (over: Partial<Payloads['checkin']['body']> = {}) => op('checkin', checkin('tmp-v3', 3, 'Trần Thị Bình', { clientUuid: UUID_E, patientId: 'p9', ...over }), 'retry');

    it('nhận ra lượt của máy chủ và lượt tạm là một theo clientUuid: MỘT dòng, mang id và số của máy chủ, trạng thái theo thao tác trên máy', () => {
      const merged = mergeQueue([item({}), E], [lost(), op('open', { visitId: 'tmp-v3', openedAt: '2026-10-20T03:05:00.000Z' })], new Map(), ME);
      expect(merged.filter((i) => i.patientId === 'p9')).toHaveLength(1);
      expect(merged.map((i) => [i.id, i.number, i.status, i.local])).toEqual([
        ['srv-E', 3, 'in-exam', { pending: true }],
        ['v1', 1, 'waiting', undefined],
      ]);
      expect(merged[0]).toMatchObject({ doctorUserId: 'doc', doctorName: 'BS. Hà', calledAt: '2026-10-20T03:05:00.000Z' });
    });

    it('chưa mở hồ sơ: một dòng đang chờ, có nhãn chờ đồng bộ, không còn là số tạm; đã ký trên máy: một dòng đã xong', () => {
      const waiting = mergeQueue([E], [lost()], new Map(), ME);
      expect(waiting.map((i) => [i.id, i.status, i.local])).toEqual([['srv-E', 'waiting', { pending: true }]]);
      const signed = mergeQueue([E], [lost(), op('open', { visitId: 'tmp-v3' }), op('complete', { visitId: 'tmp-v3', body: { clientUuid: 'c', exam: { vitals: {} }, diagnoses: [] } })], new Map(), ME);
      expect(signed.map((i) => [i.id, i.status, i.local])).toEqual([['srv-E', 'done', { pending: true }]]);
    });

    it('máy chủ cấp số khác số tạm: vẫn một dòng, ghi lại số cũ và số mới', () => {
      const merged = mergeQueue([E], [lost({ proposedNumber: 2 })], new Map(), ME);
      expect(merged.map((i) => [i.id, i.number, i.local])).toEqual([['srv-E', 3, { renumbered: { from: 2, to: 3 }, pending: true }]]);
    });

    it('máy chủ ghi clientUuid bằng chữ thường: khớp không phân biệt hoa thường', () => {
      expect(mergeQueue([E], [lost({ clientUuid: UUID_E.toUpperCase() })], new Map(), ME)).toHaveLength(1);
    });

    it('cùng bệnh nhân, cùng ngày nhưng là lần cấp số KHÁC (clientUuid khác): hai lượt khám, hai dòng, không gộp theo bệnh nhân', () => {
      const morning = item({ id: 'srv-sang', number: 1, status: 'done', patientId: 'p9', patientName: 'Trần Thị Bình', clientUuid: '0a1b2c3d-0000-4000-8000-000000000001' });
      const merged = mergeQueue([morning], [lost()], new Map(), ME);
      expect(merged.map((i) => [i.id, i.number, i.status, i.local])).toEqual([
        ['tmp-v3', 3, 'waiting', { tentative: true, pending: true }],
        ['srv-sang', 1, 'done', undefined],
      ]);
    });

    it('máy chủ bản cũ không trả clientUuid: như trước (hai dòng cho tới khi mục cấp số gửi lại xong), không lỗi', () => {
      const { clientUuid: _, ...old } = E;
      expect(mergeQueue([old], [lost()], new Map(), ME).map((i) => i.id)).toEqual(['srv-E', 'tmp-v3']);
    });
  });

  it('thao tác bị máy chủ từ chối (xung đột) được đánh dấu cần xử lý', () => {
    const merged = mergeQueue([item({ status: 'in-exam', doctorUserId: 'other', doctorName: 'BS. B' })], [op('complete', { visitId: 'v1', body: { clientUuid: 'c', exam: { vitals: {} }, diagnoses: [] } }, 'conflict')], new Map(), ME);
    expect(merged[0]!.local).toEqual({ pending: true, attention: true });
  });

  it('số tạm: lớn nhất máy này biết (kể cả số tạm đã cấp) + 1', () => {
    expect(nextLocalNumber([])).toBe(1);
    expect(nextLocalNumber(mergeQueue([item({ number: 5 })], [op('checkin', checkin('tmp-a', 6))], new Map(), ME))).toBe(7);
  });
});
