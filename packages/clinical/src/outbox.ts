import type { Task } from '@medplum/fhirtypes';
import { EXTENSIONS, SYSTEMS } from '@phongmach/fhir-vn-model';
import type { GatewayStatus, GatewayView } from './dto.js';

/**
 * Hộp thư đi (transactional outbox, A2): Task `send-prescription` được ghi CÙNG giao dịch với đơn đã ký,
 * nên không thể có đơn đã ký mà không có việc gửi, và ngược lại.
 *
 * Trạng thái FHIR Task ↔ trạng thái hiển thị:
 *   requested → Đã ký | in-progress → Đang gửi | on-hold → Chờ gửi lại | completed → Đã gửi | failed → Lỗi
 */
export interface RetryPolicy {
  baseMs: number;
  capMs: number;
  maxAttempts: number;
  /** Việc đang gửi mà quá thời gian này (BFF sập giữa chừng) thì được nhận lại; cổng gửi idempotent theo mã đơn nên an toàn. */
  leaseMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { baseMs: 2_000, capMs: 30_000, maxAttempts: 6, leaseMs: 60_000 };

const ext = (t: Task, url: string) => t.extension?.find((e) => e.url === url);
const withExt = (t: Task, url: string, value: Record<string, unknown> | undefined): Task => ({
  ...t,
  extension: [...(t.extension ?? []).filter((e) => e.url !== url), ...(value ? [{ url, ...value }] : [])],
});

export const attemptsOf = (t: Task): number => ext(t, EXTENSIONS.attempts)?.valueInteger ?? 0;
const dateOf = (t: Task, url: string): string | undefined => ext(t, url)?.valueDateTime;

export function buildSendTask(ctx: { listRef: string; patientId: string; localCode: string; now: Date }): Task {
  return {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: SYSTEMS.task, code: 'send-prescription' }] },
    identifier: [{ system: SYSTEMS.prescriptionLocal, value: ctx.localCode }],
    focus: { reference: ctx.listRef },
    for: { reference: `Patient/${ctx.patientId}` },
    authoredOn: ctx.now.toISOString(),
    extension: [
      { url: EXTENSIONS.attempts, valueInteger: 0 },
      { url: EXTENSIONS.nextAttempt, valueDateTime: ctx.now.toISOString() },
    ],
  };
}

export function isDue(t: Task, now: Date, policy: RetryPolicy = DEFAULT_RETRY): boolean {
  if (t.status === 'requested' || t.status === 'on-hold') {
    const next = dateOf(t, EXTENSIONS.nextAttempt);
    return !next || Date.parse(next) <= now.getTime();
  }
  if (t.status === 'in-progress') {
    const claimed = dateOf(t, EXTENSIONS.claimedAt);
    return !claimed || Date.parse(claimed) + policy.leaseMs <= now.getTime();
  }
  return false;
}

export function claim(t: Task, now: Date): Task {
  return withExt({ ...t, status: 'in-progress' }, EXTENSIONS.claimedAt, { valueDateTime: now.toISOString() });
}

export function markSent(t: Task, nationalCode: string, now: Date): Task {
  const done = withExt(withExt({ ...t, status: 'completed' }, EXTENSIONS.claimedAt, undefined), EXTENSIONS.nextAttempt, undefined);
  return {
    ...withExt(done, EXTENSIONS.attempts, { valueInteger: attemptsOf(t) + 1 }),
    output: [{ type: { coding: [{ system: SYSTEMS.task, code: 'national-code' }] }, valueString: nationalCode }],
    executionPeriod: { start: t.authoredOn ?? now.toISOString(), end: now.toISOString() },
  };
}

export const backoffMs = (attempts: number, policy: RetryPolicy = DEFAULT_RETRY): number => Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempts - 1));

export function markFailed(t: Task, error: string, now: Date, policy: RetryPolicy = DEFAULT_RETRY): Task {
  const attempts = attemptsOf(t) + 1;
  const giveUp = attempts >= policy.maxAttempts;
  let next = withExt({ ...t, status: giveUp ? 'failed' : 'on-hold' }, EXTENSIONS.claimedAt, undefined);
  next = withExt(next, EXTENSIONS.attempts, { valueInteger: attempts });
  next = withExt(next, EXTENSIONS.lastError, { valueString: error.slice(0, 300) });
  return withExt(next, EXTENSIONS.nextAttempt, giveUp ? undefined : { valueDateTime: new Date(now.getTime() + backoffMs(attempts, policy)).toISOString() });
}

/** Bấm "gửi lại" thủ công cho đơn đã bỏ cuộc (hoặc đang chờ): thử ngay, đếm lại từ đầu, giữ lại lỗi gần nhất để dễ chẩn đoán. */
export function requeue(t: Task, now: Date): Task {
  let next = withExt({ ...t, status: 'requested' }, EXTENSIONS.attempts, { valueInteger: 0 });
  next = withExt(next, EXTENSIONS.claimedAt, undefined);
  return withExt(next, EXTENSIONS.nextAttempt, { valueDateTime: now.toISOString() });
}

export const SIGNED_STATUS: Record<NonNullable<Task['status']>, GatewayStatus | undefined> = {
  draft: 'signed',
  requested: 'signed',
  received: 'signed',
  accepted: 'signed',
  rejected: 'failed',
  ready: 'signed',
  cancelled: 'failed',
  'in-progress': 'sending',
  'on-hold': 'retry',
  failed: 'failed',
  completed: 'sent',
  'entered-in-error': 'failed',
};

export function toGatewayView(t: Task): GatewayView | undefined {
  if (!t.id || !t.status) return undefined;
  const status = SIGNED_STATUS[t.status] ?? 'signed';
  const nextAttemptAt = dateOf(t, EXTENSIONS.nextAttempt);
  const lastError = ext(t, EXTENSIONS.lastError)?.valueString;
  const nationalCode = t.output?.find((o) => o.type?.coding?.some((c) => c.code === 'national-code'))?.valueString;
  return {
    taskId: t.id,
    status,
    attempts: attemptsOf(t),
    ...(nextAttemptAt && (status === 'retry' || status === 'signed') ? { nextAttemptAt } : {}),
    // Đã gửi được thì lỗi cũ không còn ý nghĩa với người dùng.
    ...(lastError && status !== 'sent' ? { lastError } : {}),
    ...(nationalCode ? { nationalCode } : {}),
  };
}
