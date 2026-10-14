import { loadConfig } from './config.js';
import { NdjsonAuditSink } from './audit.js';
import { buildApp } from './app.js';
import { DEFAULT_CONFLICT_RETRY } from './conflict.js';
import { SimulatedGateway } from './gateway.js';
import { identityFromFile } from './identity/index.js';
import { MedplumTenants } from './medplum.js';
import { startOutboxWorker } from './outbox.js';
import { SessionService } from './session.js';
import { SqliteSessionStore } from './sessionStore.js';
import { loadTenantsFile } from './tenants.js';

// loadConfig ném nếu AUTH_MODE thiếu/sai hoặc (ở real) thiếu khóa bắt buộc ⇒ thoát trước khi listen.
const config = loadConfig();

if (config.mode === 'demo' && config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.error(`Chế độ demo không có xác thực thật nên chỉ được lắng nghe trên localhost, không phải ${config.host}.`);
  process.exit(1);
}

const tenants = loadTenantsFile(config.tenantsFile);
const audit = new NdjsonAuditSink(config.auditFile);
const retry = { baseMs: config.outbox.baseMs, capMs: config.outbox.capMs, maxAttempts: config.outbox.maxAttempts, leaseMs: 60_000 };
const conflict = { ...DEFAULT_CONFLICT_RETRY, onRetry: (info: { what: string; attempt: number }) => app.log.warn(info, 'thử lại vì xung đột giao dịch') };
const stores = new MedplumTenants(config.medplumUrl, tenants.tenants, retry, conflict).store;
const simulator = config.simulateGateway ? new SimulatedGateway() : undefined;

// Ở mode 'real': kho phiên có thu hồi + danh tính nhân viên; access ngắn, refresh dài, verify kiểm thu hồi sid.
const sessionStore = config.mode === 'real' ? new SqliteSessionStore(config.sessionStoreUrl) : undefined;
const identity = config.mode === 'real' ? identityFromFile(config.staffFile ?? '', config.totpEncKey) : undefined;
const sessions =
  config.mode === 'real'
    ? new SessionService(config.sessionSecret, config.accessTtlMinutes, config.refreshSecret, sessionStore)
    : new SessionService(config.sessionSecret, config.sessionTtlMinutes);
// server.ts dùng đồng hồ thật mặc định; test tiêm `now` qua buildApp/SessionService.

const app = buildApp({
  mode: config.mode,
  tenants,
  stores,
  audit,
  sessions,
  ...(identity ? { identity } : {}),
  ...(sessionStore ? { sessionStore } : {}),
  refreshTtlMs: config.refreshTtlDays * 24 * 60 * 60 * 1000,
  ...(simulator ? { simulator } : {}),
  logLevel: config.logLevel,
});
const outbox = simulator
  ? startOutboxWorker(
      { tenants: tenants.tenants.map((t) => t.slug), stores, gateway: simulator, audit, onError: (tenant, err) => app.log.error({ tenant, errName: err.name, errMessage: err.message }, 'hộp thư đi lỗi') },
      config.outbox.pollMs
    )
  : undefined;

if (config.mode === 'demo') {
  if (config.sessionSecretGenerated) app.log.warn('SESSION_SECRET chưa đặt: dùng khóa ngẫu nhiên, phiên sẽ mất khi khởi động lại');
  app.log.warn('CHẾ ĐỘ DEMO: không có xác thực thật, chỉ dùng dữ liệu giả');
} else {
  app.log.info('Chế độ THẬT: xác thực nhân viên bằng mật khẩu + MFA (TOTP), phiên có thu hồi');
  // STAFF_FILE không nằm trong hợp đồng cấu hình bắt buộc (§5.1.1), nên thiếu/đọc lỗi ⇒ danh sách rỗng,
  // BFF vẫn khởi động nhưng KHÔNG ai đăng nhập được. Cảnh báo rõ để không im lặng (fail-fast spirit).
  if (identity && identity.list().length === 0) {
    app.log.warn(`Chế độ THẬT nhưng không nạp được nhân viên nào từ STAFF_FILE (${config.staffFile ?? 'chưa đặt'}): không ai đăng nhập được. Kiểm tra STAFF_FILE.`);
  }
}
if (simulator) app.log.warn('CỔNG ĐƠN THUỐC QUỐC GIA LÀ MÔ PHỎNG: không gửi gì ra ngoài');

const shutdown = async () => {
  await outbox?.stop();
  await app.close();
  await audit.close();
  sessionStore?.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
