import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from './tenants.js';

export interface Session {
  userId: string;
  userName: string;
  role: Role;
  tenant: string;
  /** Id phiên: tra kho phiên để thu hồi (§3.2). Có ở token thật; demo token có thể thiếu. */
  sid?: string;
}

/** Token "đã qua mật khẩu, chưa phải phiên" (§4.1(3)). Không mở được route dữ liệu. */
export interface MfaTicket {
  userId: string;
  /** 'verify' = đã có TOTP, chờ nhập mã; 'enroll' = chưa đăng ký, phải đăng ký trước (forced-enrollment gate). */
  stage: 'verify' | 'enroll';
}

/** Token tiền-tenant (§4.1): nhân viên nhiều phòng khám đã xác thực, chờ chọn tenant. */
export interface PretenantTicket {
  userId: string;
  userName: string;
  role: Role;
  /** Danh sách tenant ĐÃ XÁC THỰC — select-tenant chỉ được chọn trong tập này (bất biến #1). */
  allow: string[];
}

const ISSUER = 'phongmach-bff';

/** Cho phép requireSession tra `sid` đã thu hồi. Chỉ cần một phép đọc khóa cục bộ rẻ (có thể đồng bộ). */
export interface SidRevocationCheck {
  /** true nếu `sid` còn hiệu lực (chưa thu hồi); false nếu đã thu hồi/không tồn tại. */
  isActive(sid: string): boolean | Promise<boolean>;
}

export class SessionService {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtlMinutes: number,
    /** Khóa riêng cho mfa/pre-tenant token (khác khóa access). Ở demo có thể trùng secret. */
    refreshSecret: string = secret,
    /** Kho tra `sid` thu hồi. Thiếu (demo) ⇒ không kiểm thu hồi. */
    private readonly revocation?: SidRevocationCheck,
    /** Đồng hồ tiêm được: ký và xác thực dùng cùng đồng hồ để test hết hạn bằng thời gian ảo (không sleep). */
    private readonly now: () => Date = () => new Date()
  ) {
    this.accessKey = new TextEncoder().encode(secret);
    this.refreshKey = new TextEncoder().encode(refreshSecret);
  }

  async sign(session: Session): Promise<string> {
    const iat = Math.floor(this.now().getTime() / 1000);
    const jwt = new SignJWT({ typ: 'access', name: session.userName, role: session.role, tenant: session.tenant, ...(session.sid ? { sid: session.sid } : {}) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.userId)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.accessTtlMinutes * 60);
    return jwt.sign(this.accessKey);
  }

  /**
   * Trả về undefined nếu token sai, hết hạn, SAI `typ` (chỉ nhận 'access'), hoặc `sid` đã thu hồi.
   * mfaToken/pre-tenant token có `typ` khác ⇒ KHÔNG mở được route dữ liệu (bất biến B1/B2b/B4).
   */
  async verify(token: string): Promise<Session | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, { issuer: ISSUER, algorithms: ['HS256'], currentDate: this.now() });
      if (payload['typ'] !== 'access') return undefined;
      const role = payload['role'];
      const tenant = payload['tenant'];
      const name = payload['name'];
      const sid = payload['sid'];
      if (!payload.sub || typeof tenant !== 'string' || typeof name !== 'string' || !ROLES.includes(role as Role)) return undefined;
      if (typeof sid === 'string') {
        // Thu hồi có hiệu lực tức thì cho MỌI route (gồm route đọc, §3.2 HIGH-3).
        if (this.revocation && !(await this.revocation.isActive(sid))) return undefined;
        return { userId: payload.sub, userName: name, role: role as Role, tenant, sid };
      }
      // Token không có sid: chỉ chấp nhận khi KHÔNG cấu hình thu hồi (đường demo). Ở đường thật mọi token có sid.
      if (this.revocation) return undefined;
      return { userId: payload.sub, userName: name, role: role as Role, tenant };
    } catch {
      return undefined;
    }
  }

  // ---- mfaToken: đã qua mật khẩu, ~5 phút, ký bằng refreshKey, typ:'mfa' ----
  async signMfa(ticket: MfaTicket): Promise<string> {
    const iat = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ typ: 'mfa', stage: ticket.stage })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ticket.userId)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 5 * 60)
      .sign(this.refreshKey);
  }

  async verifyMfa(token: string): Promise<MfaTicket | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.refreshKey, { issuer: ISSUER, algorithms: ['HS256'], currentDate: this.now() });
      if (payload['typ'] !== 'mfa' || !payload.sub) return undefined;
      const stage = payload['stage'];
      if (stage !== 'verify' && stage !== 'enroll') return undefined;
      return { userId: payload.sub, stage };
    } catch {
      return undefined;
    }
  }

  // ---- pre-tenant token: ~5 phút, ký bằng refreshKey, typ:'pretenant', mang allow[] đã ký ----
  async signPretenant(ticket: PretenantTicket): Promise<string> {
    const iat = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ typ: 'pretenant', name: ticket.userName, role: ticket.role, allow: ticket.allow })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ticket.userId)
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 5 * 60)
      .sign(this.refreshKey);
  }

  async verifyPretenant(token: string): Promise<PretenantTicket | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.refreshKey, { issuer: ISSUER, algorithms: ['HS256'], currentDate: this.now() });
      if (payload['typ'] !== 'pretenant' || !payload.sub) return undefined;
      const role = payload['role'];
      const name = payload['name'];
      const allow = payload['allow'];
      if (typeof name !== 'string' || !ROLES.includes(role as Role) || !Array.isArray(allow) || !allow.every((t) => typeof t === 'string')) return undefined;
      return { userId: payload.sub, userName: name, role: role as Role, allow: allow as string[] };
    } catch {
      return undefined;
    }
  }

  newSid(): string {
    return randomUUID();
  }
}
