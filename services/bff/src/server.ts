import { loadConfig } from './config.js';
import { NdjsonAuditSink } from './audit.js';
import { buildApp } from './app.js';
import { MedplumTenants } from './medplum.js';
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
const app = buildApp({
  tenants,
  stores: new MedplumTenants(config.medplumUrl, tenants.tenants).store,
  audit,
  sessions: new SessionService(config.sessionSecret, config.sessionTtlMinutes),
  logLevel: config.logLevel,
});

if (config.sessionSecretGenerated) app.log.warn('SESSION_SECRET chưa đặt: dùng khóa ngẫu nhiên, phiên sẽ mất khi khởi động lại');
app.log.warn('CHẾ ĐỘ DEMO: không có xác thực thật, chỉ dùng dữ liệu giả');

const shutdown = async () => {
  await app.close();
  await audit.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
