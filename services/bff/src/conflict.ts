// Thử lại có giới hạn khi Medplum báo xung đột giao dịch (kế hoạch, F13).
// Tạo có điều kiện (`ifNoneExist`) của Medplum 5.2.0 chạy trong giao dịch `serializable`. Nhiều lời cùng lúc thì PostgreSQL hủy bớt
// (mã 40001); Medplum tự thử 3 lần rồi trả 409 `conflict`, và client `@medplum/core` không thử lại 409. Giao dịch bị hủy không ghi gì,
// nên gửi lại đúng lời đó là an toàn với lời ghi có định danh xác định (`clientUuid` + `ifNoneExist`).
import { OperationOutcomeError } from '@medplum/core';
import { BusyError } from './store.js';

/** `serialization_failure` của PostgreSQL: Medplum đưa nguyên mã này vào `details.coding` của OperationOutcome. */
const SERIALIZATION_FAILURE = '40001';

/** Đúng là xung đột giao dịch (409 `conflict` mang mã 40001), không phải một 409 nào khác của Medplum. */
export function isTransactionConflict(err: unknown): boolean {
  if (!(err instanceof OperationOutcomeError) || err.outcome.id !== 'conflict') return false;
  return (err.outcome.issue ?? []).some((i) => i.details?.coding?.some((c) => c.code === SERIALIZATION_FAILURE));
}

export interface ConflictRetry {
  /** Số lần thử lại sau lần gọi đầu. */
  retries: number;
  /** Lần thử lại thứ k (tính từ 0) chờ ngẫu nhiên trong [0, baseMs · 2^k) mili giây. */
  baseMs: number;
  /** Số ngẫu nhiên trong [0, 1) và hàm chờ: tiêm vào được để kiểm thử tất định. */
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Báo mỗi lần thử lại (ghi log, đếm). `what` là loại lời ghi, không mang dữ liệu bệnh nhân. */
  onRetry?: ((info: { what: string; attempt: number }) => void) | undefined;
}

/** 3 lần thử lại, chờ tối đa 50 + 100 + 200 ms: thêm vào 3 lần thử của chính Medplum (gốc 50 ms). */
export const DEFAULT_CONFLICT_RETRY: ConflictRetry = {
  retries: 3,
  baseMs: 50,
  random: Math.random,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Gọi `fn`; gặp xung đột giao dịch thì chờ ngẫu nhiên rồi gọi lại, tối đa `policy.retries` lần. Lỗi khác ném ra nguyên vẹn.
 * Hết lượt mà vẫn xung đột: ném `BusyError`. Chỉ dùng cho lời ghi gửi lại được (xem đầu tệp).
 */
export async function retryOnConflict<T>(what: string, fn: () => Promise<T>, policy: ConflictRetry = DEFAULT_CONFLICT_RETRY): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransactionConflict(err)) throw err;
      if (attempt >= policy.retries) throw new BusyError(what);
      await backoff(what, attempt, policy);
    }
  }
}

/** Báo rồi chờ trước lần thử lại thứ `attempt` (tính từ 0): ngẫu nhiên trong [0, baseMs · 2^attempt) mili giây. */
export async function backoff(what: string, attempt: number, policy: ConflictRetry): Promise<void> {
  policy.onRetry?.({ what, attempt: attempt + 1 });
  await policy.sleep(policy.random() * policy.baseMs * 2 ** attempt);
}

/**
 * Mục của một gói bị từ chối vì xung đột giao dịch (409 mang mã 40001): mục đó không được ghi, gửi lại là an toàn.
 * Trong gói, Medplum báo xung đột riêng từng mục (HTTP 200) và vẫn chạy các mục sau (F11, F13).
 */
export const isConflictEntry = (failed: { status: string; code?: string | undefined }): boolean => Number.parseInt(failed.status, 10) === 409 && failed.code === SERIALIZATION_FAILURE;
