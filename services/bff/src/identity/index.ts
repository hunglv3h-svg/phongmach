import { readFileSync, writeFileSync } from 'node:fs';
import type { Role } from '../tenants.js';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from './crypto.js';
import { LoginRateLimiter } from './rateLimit.js';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp.js';
import { staffFileSchema, type StaffRecord } from './types.js';

export type { StaffRecord } from './types.js';
export { staffFileSchema, staffSchema } from './types.js';

/**
 * Claim mà một IdP OIDC thật sẽ phát ra (ranh giới OIDC-ready, §2.3/§3.1). Ở M0 identity nhúng BFF phát
 * ra chính claim này; sang M1 BFF nhận claim tương đương từ id_token của IdP — lớp route KHÔNG đổi.
 */
export interface StaffClaim {
  sub: string;
  name: string;
  role: Role;
  /** Danh sách tenant đã xác thực. 1 phần tử ⇒ cấp phiên ngay; >1 ⇒ phải chọn tenant (§4.1). */
  tenants: string[];
  practitionerId?: string;
}

/** Vai trò BẮT BUỘC TOTP (§4.1(3)). assistant: khuyến khích, không chặn ở M0. */
export const MFA_REQUIRED_ROLES: Role[] = ['owner', 'doctor'];
export const mfaRequired = (role: Role): boolean => MFA_REQUIRED_ROLES.includes(role);

export type PasswordResult =
  | { kind: 'invalid' }
  | { kind: 'locked' }
  | { kind: 'ok'; claim: StaffClaim; mfa: 'none' | 'verify' | 'enroll' };

export interface IdentityStoreOptions {
  staff: StaffRecord[];
  totpEncKey: string;
  /** Lưu lại khi tạo/sửa hồ sơ (ví dụ ghi STAFF_FILE). Thiếu ⇒ chỉ trong bộ nhớ (test). */
  persist?: (staff: StaffRecord[]) => void;
  /** Giới hạn tốc độ đăng nhập; mặc định 5 lần/phút. */
  rateLimit?: { maxFailures: number; windowMs: number };
}

export class IdentityStore {
  private readonly staff = new Map<string, StaffRecord>();
  private readonly byLogin = new Map<string, string>();
  private readonly limiter: LoginRateLimiter;

  constructor(private readonly opts: IdentityStoreOptions) {
    for (const s of opts.staff) this.add(s);
    const rl = opts.rateLimit ?? { maxFailures: 5, windowMs: 60_000 };
    this.limiter = new LoginRateLimiter(rl.maxFailures, rl.windowMs);
  }

  private add(s: StaffRecord): void {
    this.staff.set(s.userId, s);
    this.byLogin.set(s.loginId, s.userId);
  }

  private save(): void {
    this.opts.persist?.([...this.staff.values()]);
  }

  get(userId: string): StaffRecord | undefined {
    return this.staff.get(userId);
  }

  private claimOf(s: StaffRecord): StaffClaim {
    return { sub: s.userId, name: s.name, role: s.role, tenants: s.tenants, ...(s.practitionerId ? { practitionerId: s.practitionerId } : {}) };
  }

  /**
   * Bước 1 — xác thực mật khẩu + quyết định MFA. KHÔNG tiết lộ tài khoản có tồn tại hay không ra lỗi
   * (cùng trả 'invalid' cho sai loginId và sai mật khẩu). Rate-limit theo loginId + IP (gọi với khóa gộp).
   * `now`: thời điểm (tiêm cho test). Trả 'locked' nếu đang bị chặn.
   */
  async authenticate(loginId: string, password: string, now: Date, rateKey?: string): Promise<PasswordResult> {
    const key = rateKey ?? loginId;
    const nowMs = now.getTime();
    if (this.limiter.isLocked(key, nowMs)) return { kind: 'locked' };
    const userId = this.byLogin.get(loginId);
    const s = userId ? this.staff.get(userId) : undefined;
    const ok = s ? await verifyPassword(s.passwordHash, password) : false;
    if (!s || !ok) {
      this.limiter.recordFailure(key, nowMs);
      return { kind: 'invalid' };
    }
    this.limiter.recordSuccess(key);
    const claim = this.claimOf(s);
    if (!mfaRequired(s.role) && !s.totpEnc) return { kind: 'ok', claim, mfa: 'none' };
    return { kind: 'ok', claim, mfa: s.totpEnc ? 'verify' : 'enroll' };
  }

  /** Bước 2a — kiểm mã TOTP đã đăng ký. Trả claim nếu đúng. */
  async verifyMfaCode(userId: string, code: string, now: Date): Promise<StaffClaim | undefined> {
    const s = this.staff.get(userId);
    if (!s?.totpEnc) return undefined;
    const secret = decryptSecret(s.totpEnc, this.opts.totpEncKey);
    if (!verifyTotp(secret, code, now)) return undefined;
    return this.claimOf(s);
  }

  /** Bắt đầu đăng ký TOTP (forced-enrollment): sinh bí mật, trả URI otpauth. Chưa lưu tới khi xác minh. */
  beginEnroll(userId: string): { secret: string; otpauth: string } | undefined {
    const s = this.staff.get(userId);
    if (!s) return undefined;
    const secret = newTotpSecret();
    return { secret, otpauth: otpauthUri(secret, s.loginId) };
  }

  /** Hoàn tất đăng ký TOTP: xác minh một mã trước khi lưu bí mật đã mã hóa. Trả claim nếu thành công. */
  async completeEnroll(userId: string, secret: string, code: string, now: Date): Promise<StaffClaim | undefined> {
    const s = this.staff.get(userId);
    if (!s) return undefined;
    if (!verifyTotp(secret, code, now)) return undefined;
    s.totpEnc = encryptSecret(secret, this.opts.totpEncKey);
    this.save();
    return this.claimOf(s);
  }

  // ---- Quản trị (owner): tạo nhân viên, gán vai trò/tenant (§9) ----
  async createStaff(input: { userId: string; loginId: string; name: string; role: Role; tenants: string[]; password: string; practitionerId?: string }): Promise<StaffRecord> {
    if (this.staff.has(input.userId)) throw Object.assign(new Error('nhân viên đã tồn tại'), { statusCode: 409, code: 'exists' });
    if (this.byLogin.has(input.loginId)) throw Object.assign(new Error('loginId đã dùng'), { statusCode: 409, code: 'exists' });
    const rec: StaffRecord = {
      userId: input.userId,
      loginId: input.loginId,
      name: input.name,
      role: input.role,
      tenants: input.tenants,
      passwordHash: await hashPassword(input.password),
      recoveryHashes: [],
      trustedDeviceEpoch: 0,
      ...(input.practitionerId ? { practitionerId: input.practitionerId } : {}),
    };
    this.add(rec);
    this.save();
    return rec;
  }

  assignRole(userId: string, role: Role, tenants: string[]): StaffRecord | undefined {
    const s = this.staff.get(userId);
    if (!s) return undefined;
    s.role = role;
    s.tenants = tenants;
    this.save();
    return s;
  }

  /** Danh sách nhân viên (không lộ băm mật khẩu/bí mật TOTP). */
  list(): Array<{ userId: string; loginId: string; name: string; role: Role; tenants: string[]; mfaEnrolled: boolean }> {
    return [...this.staff.values()].map((s) => ({ userId: s.userId, loginId: s.loginId, name: s.name, role: s.role, tenants: s.tenants, mfaEnrolled: Boolean(s.totpEnc) }));
  }
}

/** Dựng IdentityStore từ STAFF_FILE; persist ghi lại chính file đó. */
export function identityFromFile(path: string, totpEncKey: string): IdentityStore {
  let staff: StaffRecord[] = [];
  try {
    staff = staffFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).staff;
  } catch {
    staff = [];
  }
  return new IdentityStore({
    staff,
    totpEncKey,
    persist: (all) => writeFileSync(path, JSON.stringify({ staff: all }, null, 2), 'utf8'),
  });
}
