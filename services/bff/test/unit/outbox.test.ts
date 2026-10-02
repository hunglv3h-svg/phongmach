import { describe, expect, it } from 'vitest';
import { GatewayError, SimulatedGateway, type Gateway, type GatewayPayload } from '../../src/gateway.js';
import { MemoryAuditSink } from '../../src/audit.js';
import { computeMetrics, MAX_COUNTED_SECONDS } from '../../src/metrics.js';
import { runOutboxOnce, startOutboxWorker } from '../../src/outbox.js';
import type { OutboxJob } from '../../src/store.js';
import { FakeStore } from './helpers.js';

const payload = (over: Partial<GatewayPayload> = {}): GatewayPayload => ({
  localCode: 'PM-261020-AAAAAA',
  issuedAt: '2026-10-20T03:00:00Z',
  doctorName: 'BS. Hà',
  patient: { name: 'Nguyễn Văn An' },
  diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp' }],
  lines: [{ drug: 'AMOXICILLIN-500-MG', name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15 }],
  ...over,
});
const job = (id = 't1', over: Partial<GatewayPayload> = {}): OutboxJob => ({ taskId: id, localCode: `code-${id}`, attempts: 0, version: '1', payload: payload({ localCode: `code-${id}`, ...over }) });

function setup(gateway: Gateway) {
  const stores = new Map<string, FakeStore>([['a', new FakeStore('a')], ['b', new FakeStore('b')]]);
  const audit = new MemoryAuditSink();
  const errors: Array<[string, string]> = [];
  const deps = {
    tenants: ['a', 'b'],
    stores: async (slug: string) => stores.get(slug)!,
    gateway,
    audit,
    now: () => new Date('2026-10-20T03:00:00Z'),
    onError: (tenant: string, err: Error) => errors.push([tenant, err.message]),
  };
  return { stores, audit, deps, errors };
}

describe('cổng mô phỏng', () => {
  const sim = () => new SimulatedGateway();
  it('gửi lặp cùng mã đơn trả về cùng mã quốc gia và chỉ đếm một lần (idempotent)', async () => {
    const g = sim();
    const a = await g.submit('a', payload());
    const b = await g.submit('a', payload());
    expect(a.nationalCode).toBe(b.nationalCode);
    expect(a.nationalCode).toMatch(/^SIM-[0-9A-F]{10}$/);
    expect(g.get('a').accepted).toBe(1);
  });
  it('mã khác nhau theo phòng khám và theo đơn', async () => {
    const g = sim();
    const [a, b, c] = await Promise.all([g.submit('a', payload()), g.submit('b', payload()), g.submit('a', payload({ localCode: 'PM-KHAC' }))]);
    expect(new Set([a.nationalCode, b.nationalCode, c.nationalCode]).size).toBe(3);
  });
  it('down: lỗi tạm thời; failNext: lỗi n lần rồi tự hết', async () => {
    const g = sim();
    g.set('a', { mode: 'down' });
    await expect(g.submit('a', payload())).rejects.toMatchObject({ retryable: true });
    await expect(g.submit('b', payload())).resolves.toBeTruthy();
    g.set('a', { mode: 'up', failNext: 2 });
    await expect(g.submit('a', payload())).rejects.toBeInstanceOf(GatewayError);
    await expect(g.submit('a', payload())).rejects.toBeInstanceOf(GatewayError);
    await expect(g.submit('a', payload())).resolves.toBeTruthy();
    expect(g.get('a').failNext).toBe(0);
  });
  it('đơn thiếu nội dung bị từ chối vĩnh viễn (không thử lại được)', async () => {
    const g = sim();
    await expect(g.submit('a', payload({ lines: [] }))).rejects.toMatchObject({ retryable: false });
    await expect(g.submit('a', payload({ diagnoses: [] }))).rejects.toMatchObject({ retryable: false });
  });
  it('giới hạn failNext trong 0..20', () => {
    const g = sim();
    expect(g.set('a', { failNext: 999 }).failNext).toBe(20);
    expect(g.set('a', { failNext: -5 }).failNext).toBe(0);
  });
});

describe('hộp thư đi', () => {
  it('gửi thành công: ghi mã quốc gia và một dòng nhật ký không chứa dữ liệu đơn', async () => {
    const { stores, audit, deps } = setup(new SimulatedGateway());
    stores.get('a')!.jobs = [job('t1')];
    expect(await runOutboxOnce(deps)).toEqual({ sent: 1, failed: 0 });
    expect(stores.get('a')!.outbox).toEqual([{ op: 'complete', taskId: 't1', detail: expect.stringMatching(/^SIM-/) }]);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ tenant: 'a', role: 'system', action: 'gateway-send', outcome: 'ok', resourceIds: ['t1'] });
    expect(JSON.stringify(audit.entries)).not.toMatch(/Nguyễn|Amoxicillin|J02/);
  });
  it('cổng lỗi tạm thời: ghi lỗi để thử lại, kèm nhật ký lỗi', async () => {
    const g = new SimulatedGateway();
    g.set('a', { mode: 'down' });
    const { stores, audit, deps } = setup(g);
    stores.get('a')!.jobs = [job('t1')];
    expect(await runOutboxOnce(deps)).toEqual({ sent: 0, failed: 1 });
    expect(stores.get('a')!.outbox[0]).toMatchObject({ op: 'fail', retryable: true, detail: expect.stringContaining('không phản hồi') });
    expect(audit.entries[0]).toMatchObject({ outcome: 'error' });
  });
  it('đơn bị cổng từ chối vì nội dung: không thử lại', async () => {
    const { stores, deps } = setup(new SimulatedGateway());
    stores.get('a')!.jobs = [job('t1', { lines: [] })];
    await runOutboxOnce(deps);
    expect(stores.get('a')!.outbox[0]).toMatchObject({ op: 'fail', retryable: false });
  });
  it('lỗi không phải của cổng (ví dụ lỗi lập trình) coi như tạm thời, không làm sập vòng gửi', async () => {
    const boom: Gateway = { submit: async () => { throw new TypeError('x'); } };
    const { stores, deps } = setup(boom);
    stores.get('a')!.jobs = [job('t1'), job('t2')];
    expect(await runOutboxOnce(deps)).toEqual({ sent: 0, failed: 2 });
    expect(stores.get('a')!.outbox.every((o) => o.op === 'fail' && o.retryable)).toBe(true);
  });
  it('mất quyền nhận việc (worker khác nhận trước): không gửi', async () => {
    const { stores, deps } = setup(new SimulatedGateway());
    stores.get('a')!.jobs = [job('t1')];
    stores.get('a')!.claimResult = false;
    expect(await runOutboxOnce(deps)).toEqual({ sent: 0, failed: 0 });
    expect(stores.get('a')!.outbox).toEqual([]);
  });
  it('một phòng khám lỗi không làm các phòng khác ngừng gửi', async () => {
    const { stores, deps, errors } = setup(new SimulatedGateway());
    stores.get('a')!.dueError = new Error('Medplum không trả lời');
    stores.get('b')!.jobs = [job('t9')];
    expect(await runOutboxOnce(deps)).toEqual({ sent: 1, failed: 0 });
    expect(errors).toEqual([['a', 'Medplum không trả lời']]);
  });
  it('việc của hai phòng khám dùng cổng riêng: A đang lỗi, B vẫn gửi được', async () => {
    const g = new SimulatedGateway();
    g.set('a', { mode: 'down' });
    const { stores, deps } = setup(g);
    stores.get('a')!.jobs = [job('ta')];
    stores.get('b')!.jobs = [job('tb')];
    expect(await runOutboxOnce(deps)).toEqual({ sent: 1, failed: 1 });
    expect(stores.get('a')!.outbox[0]!.op).toBe('fail');
    expect(stores.get('b')!.outbox[0]!.op).toBe('complete');
  });
  it('worker chạy theo chu kỳ, không chạy chồng, dừng sạch', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let calls = 0;
    const slow: Gateway = {
      submit: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls += 1;
        await new Promise((r) => setTimeout(r, 40));
        concurrent -= 1;
        return { nationalCode: 'X' };
      },
    };
    const { stores, deps } = setup(slow);
    stores.get('a')!.jobs = [job('t1')];
    const worker = startOutboxWorker(deps, 10);
    await new Promise((r) => setTimeout(r, 150));
    await worker.stop();
    const after = calls;
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(after); // đã dừng
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(maxConcurrent).toBe(1);
  });
});

describe('tính số đo', () => {
  const v = (seconds: number | undefined, id = 'u1', name = 'BS. Hà') => ({ doctorUserId: id, doctorName: name, seconds });
  const range = { from: '2026-10-14', to: '2026-10-20', truncated: false };
  it('p50 và p90 theo hạng gần nhất, tách theo bác sĩ', () => {
    const visits = [...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s) => v(s)), v(200, 'u2', 'BS. Lan')];
    const m = computeMetrics(visits, range);
    expect(m.doctors).toEqual([
      { name: 'BS. Hà', visits: 10, excluded: 0, clientMeasured: 0, invalidClock: 0, p50Seconds: 50, p90Seconds: 90 },
      { name: 'BS. Lan', visits: 1, excluded: 0, clientMeasured: 0, invalidClock: 0, p50Seconds: 200, p90Seconds: 200 },
    ]);
    expect(m.all).toMatchObject({ visits: 11, p50Seconds: 60 });
  });
  it('phiên quá dài bị loại khỏi phân vị nhưng được đếm riêng, không giấu', () => {
    const m = computeMetrics([v(30), v(MAX_COUNTED_SECONDS), v(MAX_COUNTED_SECONDS + 1)], range);
    expect(m.all).toMatchObject({ visits: 2, excluded: 1, p90Seconds: MAX_COUNTED_SECONDS });
    expect(m.excludedLongerThanSeconds).toBe(MAX_COUNTED_SECONDS);
  });
  it('lượt không có mốc mở hồ sơ bị bỏ; không có số liệu thì không có phân vị', () => {
    const m = computeMetrics([v(undefined)], range);
    expect(m.all).toEqual({ visits: 0, excluded: 0, clientMeasured: 0, invalidClock: 0 });
    expect(m.doctors).toEqual([]);
  });
  it('lượt mở hoặc ký lúc mất mạng: đo ở máy khách thì tính và đếm riêng; giờ không hợp lý thì không tính nhưng đếm riêng', () => {
    const m = computeMetrics(
      [v(40), { ...v(70), source: 'client' as const }, { ...v(MAX_COUNTED_SECONDS + 5), source: 'client' as const }, { ...v(undefined), source: 'client-invalid' as const }],
      range
    );
    // 40 và 70 vào phân vị; phiên quá dài bị loại (không tính là "đo ở máy khách"); giờ không hợp lý không vào phân vị.
    expect(m.all).toEqual({ visits: 2, excluded: 1, clientMeasured: 1, invalidClock: 1, p50Seconds: 40, p90Seconds: 70 });
    expect(m.doctors[0]).toMatchObject({ visits: 2, clientMeasured: 1, invalidClock: 1 });
  });
  it('báo khi số liệu bị cắt', () => {
    expect(computeMetrics([], { ...range, truncated: true }).truncated).toBe(true);
  });
});
