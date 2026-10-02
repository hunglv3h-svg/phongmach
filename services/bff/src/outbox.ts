import type { AuditSink } from './audit.js';
import { GatewayError, type Gateway } from './gateway.js';
import type { StoreFactory } from './store.js';

export interface OutboxDeps {
  tenants: string[];
  stores: StoreFactory;
  gateway: Gateway;
  audit: AuditSink;
  now?: () => Date;
  /** Chỉ ghi tên và thông điệp lỗi, không ghi dữ liệu đơn thuốc. */
  onError?: (tenant: string, err: Error) => void;
  batch?: number;
}

export interface OutboxRun {
  sent: number;
  failed: number;
}

/**
 * Một vòng gửi: lấy việc đến hạn của từng phòng khám, nhận việc, gửi, ghi kết quả.
 * Gửi đi là việc đặc biệt nhạy cảm (dữ liệu bệnh nhân rời hệ thống) nên mỗi lần gửi đều có dòng nhật ký.
 */
export async function runOutboxOnce(deps: OutboxDeps): Promise<OutboxRun> {
  const run: OutboxRun = { sent: 0, failed: 0 };
  const now = deps.now ?? (() => new Date());
  for (const tenant of deps.tenants) {
    try {
      const store = await deps.stores(tenant);
      for (const job of await store.dueSends(now(), deps.batch ?? 20)) {
        if (!(await store.claim(job, now()))) continue;
        const entry = { ts: now().toISOString(), requestId: `outbox-${job.taskId}-${job.attempts + 1}`, tenant, userId: 'system', userName: 'Hộp thư đi', role: 'system' as const, action: 'gateway-send' as const, resourceIds: [job.taskId] };
        try {
          const { nationalCode } = await deps.gateway.submit(tenant, job.payload);
          await store.complete(job, nationalCode, now());
          await deps.audit.record({ ...entry, outcome: 'ok' });
          run.sent += 1;
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          const retryable = !(e instanceof GatewayError) || e.retryable;
          await store.fail(job, e.message, now(), retryable);
          await deps.audit.record({ ...entry, outcome: 'error' });
          run.failed += 1;
        }
      }
    } catch (err) {
      // Lỗi của một phòng khám (Medplum không trả lời...) không được làm các phòng khám khác ngừng gửi.
      deps.onError?.(tenant, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return run;
}

export function startOutboxWorker(deps: OutboxDeps, intervalMs: number): { stop(): Promise<void> } {
  let running: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const timer = setInterval(() => {
    // Không chạy chồng: vòng sau chờ vòng trước xong.
    running = running.then(() => (stopped ? undefined : runOutboxOnce(deps).catch((e: Error) => deps.onError?.('*', e))));
  }, intervalMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
