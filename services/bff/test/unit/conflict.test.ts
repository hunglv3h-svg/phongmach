import { OperationOutcomeError } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFLICT_RETRY, isTransactionConflict, retryOnConflict, type ConflictRetry } from '../../src/conflict.js';
import { BusyError } from '../../src/store.js';
import { captureLogs, login, makeApp, type FakeStore } from './helpers.js';

// Đúng hình dạng Medplum 5.2.0 trả cho BFF khi giao dịch `serializable` hỏng lần thử cuối (đã đo, kế hoạch F13).
const outcome = (id: string, code: string, pg?: string): OperationOutcome => ({
  resourceType: 'OperationOutcome',
  id,
  issue: [{ severity: 'error', code: code as 'conflict', details: { ...(pg ? { coding: [{ code: pg }] } : {}), text: 'could not serialize access due to read/write dependencies among transactions' } }],
});
const conflict = () => new OperationOutcomeError(outcome('conflict', 'conflict', '40001'));

/** Chính sách có bộ sinh ngẫu nhiên cố định và hàm chờ chỉ ghi lại số mili giây. */
function policy(random = 1, over: Partial<ConflictRetry> = {}) {
  const sleeps: number[] = [];
  const retried: Array<{ what: string; attempt: number }> = [];
  const p: ConflictRetry = { ...DEFAULT_CONFLICT_RETRY, random: () => random, sleep: async (ms) => void sleeps.push(ms), onRetry: (i) => void retried.push(i), ...over };
  return { p, sleeps, retried };
}
/** Hàm ném `errors` lần lượt rồi trả 'ok'; đếm số lần được gọi. */
function failing(errors: unknown[]) {
  let calls = 0;
  const fn = async () => {
    const err = errors[calls++];
    if (err) throw err;
    return 'ok';
  };
  return { fn, calls: () => calls };
}

describe('nhận diện xung đột giao dịch', () => {
  it('chỉ 409 `conflict` mang mã 40001 mới là xung đột giao dịch', () => {
    expect(isTransactionConflict(conflict())).toBe(true);
    expect(isTransactionConflict(new OperationOutcomeError(outcome('conflict', 'conflict', '23505')))).toBe(false); // trùng khóa duy nhất
    expect(isTransactionConflict(new OperationOutcomeError(outcome('conflict', 'conflict')))).toBe(false);
    expect(isTransactionConflict(new OperationOutcomeError(outcome('precondition-failed', 'processing', '40001')))).toBe(false); // 412
    expect(isTransactionConflict(new OperationOutcomeError(outcome('too-many-requests', 'throttled')))).toBe(false); // 429
    expect(isTransactionConflict(new Error('could not serialize access'))).toBe(false);
    expect(isTransactionConflict(undefined)).toBe(false);
  });
});

describe('thử lại khi xung đột giao dịch', () => {
  it('không lỗi thì gọi đúng một lần, không chờ', async () => {
    const { p, sleeps, retried } = policy();
    const f = failing([]);
    expect(await retryOnConflict('patient', f.fn, p)).toBe('ok');
    expect([f.calls(), sleeps, retried]).toEqual([1, [], []]);
  });
  it('xung đột hai lần rồi qua: gọi ba lần, chờ ngẫu nhiên trong [0, 50·2^k) trước mỗi lần thử lại', async () => {
    const full = policy(1);
    const f = failing([conflict(), conflict()]);
    expect(await retryOnConflict('check-in', f.fn, full.p)).toBe('ok');
    expect(f.calls()).toBe(3);
    expect(full.sleeps).toEqual([50, 100]);
    expect(full.retried).toEqual([{ what: 'check-in', attempt: 1 }, { what: 'check-in', attempt: 2 }]);

    const half = policy(0.5);
    await retryOnConflict('check-in', failing([conflict(), conflict(), conflict()]).fn, half.p);
    expect(half.sleeps).toEqual([25, 50, 100]);
    const none = policy(0);
    await retryOnConflict('check-in', failing([conflict()]).fn, none.p);
    expect(none.sleeps).toEqual([0]);
  });
  it('xung đột mãi: thử lại đúng 3 lần (4 lần gọi) rồi báo bận, tổng chờ không quá 350 ms', async () => {
    const { p, sleeps } = policy(1);
    const f = failing([conflict(), conflict(), conflict(), conflict(), conflict(), conflict()]);
    const err = await retryOnConflict('allergy', f.fn, p).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusyError);
    expect((err as BusyError).what).toBe('allergy');
    expect(f.calls()).toBe(4);
    expect(sleeps).toEqual([50, 100, 200]);
  });
  it('lỗi khác (412, 409 không phải 40001, lỗi thường) ném ra nguyên vẹn, không thử lại', async () => {
    for (const other of [new OperationOutcomeError(outcome('precondition-failed', 'processing')), new OperationOutcomeError(outcome('conflict', 'conflict', '23505')), new Error('đĩa đầy')]) {
      const { p, sleeps } = policy();
      const f = failing([other]);
      expect(await retryOnConflict('patient', f.fn, p).catch((e: unknown) => e)).toBe(other);
      expect([f.calls(), sleeps]).toEqual([1, []]);
    }
  });
  it('lỗi khác sau một lần xung đột cũng ném ra nguyên vẹn', async () => {
    const { p } = policy();
    const other = new Error('mất kết nối');
    const f = failing([conflict(), other]);
    expect(await retryOnConflict('patient', f.fn, p).catch((e: unknown) => e)).toBe(other);
    expect(f.calls()).toBe(2);
  });
  it('chính sách mặc định: 3 lần thử lại, gốc 50 ms', () => {
    expect([DEFAULT_CONFLICT_RETRY.retries, DEFAULT_CONFLICT_RETRY.baseMs]).toEqual([3, 50]);
  });
});

describe('BFF khi kho báo bận', () => {
  const UUID = '3f2b8d1e-6c4a-4f0e-9a57-2d1c8b7e5a10';
  it('trả 503 `busy` kèm retry: true (không phải 500), log chỉ ghi loại lời ghi', async () => {
    const logs = captureLogs();
    const c = makeApp({ logStream: logs.stream });
    const token = await login(c.app, 'a', 'a-assistant');
    const store = (await c.factory('a')) as FakeStore;
    store.createPatient = async () => {
      throw new BusyError('patient');
    };
    const res = await c.app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '0912345678' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'busy', retry: true, message: expect.stringContaining('không bị trùng') });
    expect(logs.text()).toContain('"what":"patient"');
    expect(logs.text()).not.toMatch(/Nguyễn|0912345678/);
  });
});
