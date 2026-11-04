import { Writable } from 'node:stream';
import { MemoryAuditSink, type AuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { IdentityStore } from '../../src/identity/index.js';
import { hashPassword } from '../../src/identity/crypto.js';
import { encryptSecret } from '../../src/identity/crypto.js';
import { generateTotp } from '../../src/identity/totp.js';
import { SessionService } from '../../src/session.js';
import { SqliteSessionStore } from '../../src/sessionStore.js';
import type { StoreFactory } from '../../src/store.js';
import { parseTenantsFile } from '../../src/tenants.js';
import { FakeStore } from './helpers.js';

export const TOTP_ENC_KEY = 'k'.repeat(40);
export const ACCESS_SECRET = 'A'.repeat(40);
export const REFRESH_SECRET = 'R'.repeat(40);
/** Bí mật TOTP đã biết trước cho test tất định (base32). */
export const KNOWN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const realTenants = parseTenantsFile({
  tenants: [
    { slug: 'a', name: 'Phòng khám A', projectId: 'pa', clientId: 'ca', secret: 'sa' },
    { slug: 'b', name: 'Phòng khám B', projectId: 'pb', clientId: 'cb', secret: 'sb' },
  ],
  // users ở đây chỉ để parseTenantsFile hợp lệ; mode real KHÔNG dùng danh sách này.
  users: [{ id: 'ignore', name: 'x', role: 'assistant', tenant: 'a' }],
});

export interface MakeRealOptions {
  audit?: AuditSink;
  now?: () => Date;
  logStream?: Writable;
  /** Nhân viên seed sẵn. */
  staff?: Array<{ userId: string; loginId: string; name: string; role: 'owner' | 'doctor' | 'assistant'; tenants: string[]; password: string; totp?: string | 'known' }>;
  accessTtlMinutes?: number;
  refreshTtlMs?: number;
  rateLimit?: { maxFailures: number; windowMs: number };
}

export async function makeReal(options: MakeRealOptions = {}) {
  const stores = new Map<string, FakeStore>();
  const requested: string[] = [];
  const factory: StoreFactory = async (slug) => {
    requested.push(slug);
    if (!stores.has(slug)) stores.set(slug, new FakeStore(slug));
    return stores.get(slug)!;
  };
  const audit = options.audit ?? new MemoryAuditSink();
  const sessionStore = new SqliteSessionStore(':memory:');
  const sessions = new SessionService(ACCESS_SECRET, options.accessTtlMinutes ?? 15, REFRESH_SECRET, sessionStore, options.now ?? (() => new Date()));

  const seeded = options.staff ?? [];
  const records = await Promise.all(
    seeded.map(async (s) => ({
      userId: s.userId,
      loginId: s.loginId,
      name: s.name,
      role: s.role,
      tenants: s.tenants,
      passwordHash: await hashPassword(s.password),
      recoveryHashes: [] as string[],
      trustedDeviceEpoch: 0,
      ...(s.totp ? { totpEnc: encryptSecret(s.totp === 'known' ? KNOWN_TOTP_SECRET : s.totp, TOTP_ENC_KEY) } : {}),
    }))
  );
  const identity = new IdentityStore({ staff: records, totpEncKey: TOTP_ENC_KEY, ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}) });

  const app = buildApp({
    mode: 'real',
    tenants: realTenants,
    stores: factory,
    audit,
    sessions,
    identity,
    sessionStore,
    refreshTtlMs: options.refreshTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    logLevel: options.logStream ? 'info' : 'silent',
    ...(options.logStream ? { logStream: options.logStream } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { app, stores, requested, audit, sessions, sessionStore, identity };
}

/** Tính mã TOTP tất định cho một bí mật đã biết tại thời điểm `now`. */
export const totpCode = (secret: string, now: Date) => generateTotp(secret, now);

/** Đọc refresh cookie từ phản hồi set-cookie. */
export function refreshCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  for (const line of arr) {
    const m = /pm_refresh=([^;]+)/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}
