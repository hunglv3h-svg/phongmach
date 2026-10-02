import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8110),
  MEDPLUM_URL: z.url().default('http://localhost:8103'),
  TENANTS_FILE: z.string().default(here('../.demo-tenants.json')),
  AUDIT_FILE: z.string().default(here('../.data/audit.ndjson')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET phải dài ít nhất 32 ký tự').optional(),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(1).default(480),
  /** Chưa có xác thực thật (T-IDP). Chỉ chạy khi đặt rõ DEMO_AUTH=1. */
  DEMO_AUTH: z.enum(['0', '1']).default('0'),
  /** Cổng đơn thuốc quốc gia MÔ PHỎNG (M0). Chưa có bộ nối thật nên mặc định bật; đặt 0 để không gửi gì. */
  SIMULATE_GATEWAY: z.enum(['0', '1']).default('1'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(2000),
  OUTBOX_BASE_MS: z.coerce.number().int().min(100).default(2000),
  OUTBOX_CAP_MS: z.coerce.number().int().min(100).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(6),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  host: string;
  port: number;
  medplumUrl: string;
  tenantsFile: string;
  auditFile: string;
  sessionSecret: string;
  sessionSecretGenerated: boolean;
  sessionTtlMinutes: number;
  demoAuth: boolean;
  simulateGateway: boolean;
  outbox: { pollMs: number; baseMs: number; capMs: number; maxAttempts: number };
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  const generated = !e.SESSION_SECRET;
  return {
    host: e.HOST,
    port: e.PORT,
    medplumUrl: e.MEDPLUM_URL,
    tenantsFile: e.TENANTS_FILE,
    auditFile: e.AUDIT_FILE,
    // Không có mặc định cố định trong mã: thiếu thì sinh ngẫu nhiên, phiên mất khi khởi động lại.
    sessionSecret: e.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    sessionSecretGenerated: generated,
    sessionTtlMinutes: e.SESSION_TTL_MINUTES,
    demoAuth: e.DEMO_AUTH === '1',
    simulateGateway: e.SIMULATE_GATEWAY === '1',
    outbox: { pollMs: e.OUTBOX_POLL_MS, baseMs: e.OUTBOX_BASE_MS, capMs: e.OUTBOX_CAP_MS, maxAttempts: e.OUTBOX_MAX_ATTEMPTS },
    logLevel: e.LOG_LEVEL,
  };
}
