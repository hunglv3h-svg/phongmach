import { loadConfig } from './config.js';
import { NdjsonAuditSink } from './audit.js';
import { buildApp } from './app.js';
import { SimulatedGateway } from './gateway.js';
import { MedplumTenants } from './medplum.js';
import { startOutboxWorker } from './outbox.js';
import { SessionService } from './session.js';
import { loadTenantsFile } from './tenants.js';

const config = loadConfig();

if (!config.demoAuth) {
  console.error('Chưa có xác thực thật (T-IDP): BFF chỉ chạy được ở chế độ demo. Đặt DEMO_AUTH=1 và chỉ chạy với dữ liệu giả.');
  process.exit(1);
}
if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.error(`Chế độ demo không có xác thực thật nên chỉ được lắng nghe trên localhost, không phải ${config.host}.`);
  process.exit(1);
}

const tenants = loadTenantsFile(config.tenantsFile);
const audit = new NdjsonAuditSink(config.auditFile);
const retry = { baseMs: config.outbox.baseMs, capMs: config.outbox.capMs, maxAttempts: config.outbox.maxAttempts, leaseMs: 60_000 };
const stores = new MedplumTenants(config.medplumUrl, tenants.tenants, retry).store;
// Bộ nối thật (T-RX) sẽ thay SimulatedGateway ở đây mà không đổi gì khác: cùng giao diện `Gateway`.
const simulator = config.simulateGateway ? new SimulatedGateway() : undefined;
const app = buildApp({
  tenants,
  stores,
  audit,
  sessions: new SessionService(config.sessionSecret, config.sessionTtlMinutes),
  ...(simulator ? { simulator } : {}),
  logLevel: config.logLevel,
});
const outbox = simulator
  ? startOutboxWorker(
      { tenants: tenants.tenants.map((t) => t.slug), stores, gateway: simulator, audit, onError: (tenant, err) => app.log.error({ tenant, errName: err.name, errMessage: err.message }, 'hộp thư đi lỗi') },
      config.outbox.pollMs
    )
  : undefined;

if (config.sessionSecretGenerated) app.log.warn('SESSION_SECRET chưa đặt: dùng khóa ngẫu nhiên, phiên sẽ mất khi khởi động lại');
app.log.warn('CHẾ ĐỘ DEMO: không có xác thực thật, chỉ dùng dữ liệu giả');
if (simulator) app.log.warn('CỔNG ĐƠN THUỐC QUỐC GIA LÀ MÔ PHỎNG: không gửi gì ra ngoài');

const shutdown = async () => {
  await outbox?.stop();
  await app.close();
  await audit.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
