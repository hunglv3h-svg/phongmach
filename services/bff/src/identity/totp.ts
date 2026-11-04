import { Secret, TOTP } from 'otpauth';

const ISSUER = 'PHONGMACH';
const PERIOD = 30;
const DIGITS = 6;

/** Sinh một bí mật TOTP mới (base32). */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secret: string, label: string): TOTP {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: DIGITS, period: PERIOD, secret: Secret.fromBase32(secret) });
}

/** URI otpauth:// để dựng QR lúc đăng ký (§4.2). */
export function otpauthUri(secret: string, label: string): string {
  return totpFor(secret, label).toString();
}

/**
 * Kiểm mã TOTP với cửa sổ ±1 bước 30s (RFC 6238). `now` tiêm được để kiểm thử tất định (không sleep).
 * Trả true nếu khớp.
 */
export function verifyTotp(secret: string, code: string, now: Date): boolean {
  const delta = totpFor(secret, 'x').validate({ token: code, window: 1, timestamp: now.getTime() });
  return delta !== null;
}

/** Tính mã TOTP tại một thời điểm (dùng cho test tất định và cho SĐT-OTP mô phỏng). */
export function generateTotp(secret: string, now: Date): string {
  return totpFor(secret, 'x').generate({ timestamp: now.getTime() });
}
