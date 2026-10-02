import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from './tenants.js';

export interface Session {
  userId: string;
  userName: string;
  role: Role;
  tenant: string;
}

const ISSUER = 'phongmach-bff';

export class SessionService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlMinutes: number
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(session: Session): Promise<string> {
    return new SignJWT({ name: session.userName, role: session.role, tenant: session.tenant })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlMinutes}m`)
      .sign(this.key);
  }

  /** Trả về undefined nếu token sai, hết hạn hoặc thiếu trường. */
  async verify(token: string): Promise<Session | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      const role = payload['role'];
      const tenant = payload['tenant'];
      const name = payload['name'];
      if (!payload.sub || typeof tenant !== 'string' || typeof name !== 'string' || !ROLES.includes(role as Role)) return undefined;
      return { userId: payload.sub, userName: name, role: role as Role, tenant };
    } catch {
      return undefined;
    }
  }
}
