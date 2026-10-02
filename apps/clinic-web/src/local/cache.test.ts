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
const checkin = (visitTmpId: string, proposedNumber: number, patientName = 'Trần Thị Bình') =>
  ({ visitTmpId, body: { clientUuid: 'u', patientId: 'tmp-p', specialty: 'noi', priority: 'normal', arrivedAt: '2026-10-20T03:00:00.000Z', proposedNumber }, display: { patientName } }) satisfies Payloads['checkin'];

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

  it('thao tác bị máy chủ từ chối (xung đột) được đánh dấu cần xử lý', () => {
    const merged = mergeQueue([item({ status: 'in-exam', doctorUserId: 'other', doctorName: 'BS. B' })], [op('complete', { visitId: 'v1', body: { clientUuid: 'c', exam: { vitals: {} }, diagnoses: [] } }, 'conflict')], new Map(), ME);
    expect(merged[0]!.local).toEqual({ pending: true, attention: true });
  });

  it('số tạm: lớn nhất máy này biết (kể cả số tạm đã cấp) + 1', () => {
    expect(nextLocalNumber([])).toBe(1);
    expect(nextLocalNumber(mergeQueue([item({ number: 5 })], [op('checkin', checkin('tmp-a', 6))], new Map(), ME))).toBe(7);
  });
});
