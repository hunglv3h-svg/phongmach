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
  /**
   * Chế độ xác thực (T-IDP). KHÔNG có mặc định: thiếu hoặc giá trị lạ ⇒ loadConfig ném ⇒ server thoát
   * trước khi listen. Chốt fail-closed: một môi trường không khai mode không bao giờ mở ra mạng.
   *   'real' — xác thực nhân viên thật (mật khẩu + MFA), được bind host ngoài localhost.
   *   'demo' — chế độ diễn tập, có nhãn, chỉ localhost, dùng dữ liệu giả (thay DEMO_AUTH=1 cũ).
   */
  AUTH_MODE: z.enum(['real', 'demo']),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET phải dài ít nhất 32 ký tự').optional(),
  /** Khóa ký refresh / mfaToken / pre-tenant token — PHẢI khác SESSION_SECRET. Bắt buộc ở mode 'real'. */
  REFRESH_SECRET: z.string().min(32, 'REFRESH_SECRET phải dài ít nhất 32 ký tự').optional(),
  /** Khóa mã hóa bí mật TOTP khi lưu (§4.2). Bắt buộc ở mode 'real'. */
  TOTP_ENC_KEY: z.string().min(32, 'TOTP_ENC_KEY phải dài ít nhất 32 ký tự').optional(),
  /** Kho phiên/refresh có thu hồi (§3.2). Đường dẫn file SQLite ở M0. Bắt buộc ở mode 'real'. */
  SESSION_STORE_URL: z.string().min(1).optional(),
  /** Hồ sơ nhân viên thật (JSON) — danh tính + băm mật khẩu + bí mật TOTP. Bắt buộc ở mode 'real'. */
  STAFF_FILE: z.string().optional(),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(1).default(480),
  /** Tuổi access token ở mode 'real' (phút). Mặc định 15 (§3.2). */
  ACCESS_TTL_MINUTES: z.coerce.number().int().min(1).default(15),
  /** Tuổi refresh token ở mode 'real' (ngày). Mặc định 7 (§3.2). */
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  /** Cổng đơn thuốc quốc gia MÔ PHỎNG (M0). Chưa có bộ nối thật nên mặc định bật; đặt 0 để không gửi gì. */
  SIMULATE_GATEWAY: z.enum(['0', '1']).default('1'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(2000),
  OUTBOX_BASE_MS: z.coerce.number().int().min(100).default(2000),
  OUTBOX_CAP_MS: z.coerce.number().int().min(100).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(6),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AuthMode = 'real' | 'demo';

export interface Config {
  host: string;
  port: number;
  medplumUrl: string;
  tenantsFile: string;
  auditFile: string;
  mode: AuthMode;
  sessionSecret: string;
  sessionSecretGenerated: boolean;
  refreshSecret: string;
  totpEncKey: string;
  sessionStoreUrl: string;
  staffFile: string | undefined;
  sessionTtlMinutes: number;
  accessTtlMinutes: number;
  refreshTtlDays: number;
  simulateGateway: boolean;
  outbox: { pollMs: number; baseMs: number; capMs: number; maxAttempts: number };
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  const real = e.AUTH_MODE === 'real';

  // Hợp đồng cấu hình (§5.1.1): ở mode 'real' các khóa định danh BẮT BUỘC hiện diện-và-hợp-lệ.
  // Thiếu/sai ⇒ ném ngay (một chỗ duy nhất) để server.ts thoát trước listen. KHÔNG sinh ngẫu nhiên ở 'real'.
  if (real) {
    const missing: string[] = [];
    if (!e.SESSION_SECRET) missing.push('SESSION_SECRET');
    if (!e.REFRESH_SECRET) missing.push('REFRESH_SECRET');
    if (!e.TOTP_ENC_KEY) missing.push('TOTP_ENC_KEY');
    if (!e.SESSION_STORE_URL) missing.push('SESSION_STORE_URL');
    if (missing.length > 0) {
      throw new Error(`AUTH_MODE=real cần các khóa cấu hình bắt buộc (phải đặt rõ, không sinh ngẫu nhiên): ${missing.join(', ')}`);
    }
    if (e.SESSION_SECRET === e.REFRESH_SECRET) {
      throw new Error('REFRESH_SECRET phải khác SESSION_SECRET (khóa ký access và refresh/mfa/pre-tenant tách biệt).');
    }
  }

  const generated = !real && !e.SESSION_SECRET;
  return {
    host: e.HOST,
    port: e.PORT,
    medplumUrl: e.MEDPLUM_URL,
    tenantsFile: e.TENANTS_FILE,
    auditFile: e.AUDIT_FILE,
    mode: e.AUTH_MODE,
    // Ở 'demo' thiếu thì sinh ngẫu nhiên (phiên mất khi khởi động lại); ở 'real' đã bắt buộc ở trên.
    sessionSecret: e.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    sessionSecretGenerated: generated,
    refreshSecret: e.REFRESH_SECRET ?? randomBytes(32).toString('hex'),
    totpEncKey: e.TOTP_ENC_KEY ?? randomBytes(32).toString('hex'),
    sessionStoreUrl: e.SESSION_STORE_URL ?? ':memory:',
    staffFile: e.STAFF_FILE,
    sessionTtlMinutes: e.SESSION_TTL_MINUTES,
    accessTtlMinutes: e.ACCESS_TTL_MINUTES,
    refreshTtlDays: e.REFRESH_TTL_DAYS,
    simulateGateway: e.SIMULATE_GATEWAY === '1',
    outbox: { pollMs: e.OUTBOX_POLL_MS, baseMs: e.OUTBOX_BASE_MS, capMs: e.OUTBOX_CAP_MS, maxAttempts: e.OUTBOX_MAX_ATTEMPTS },
    logLevel: e.LOG_LEVEL,
  };
}
