import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Băm mật khẩu bằng Argon2id với tham số OWASP (secure defaults, NIT-5): memoryCost 19456 KiB (19 MiB),
 * timeCost 2, parallelism 1. KHÔNG dùng mặc định yếu. Chuỗi trả về là PHC tự mang tham số + salt.
 * algorithm: 2 = Argon2id (tránh const enum ambient dưới verbatimModuleSyntax).
 */
const ARGON_OPTS = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('mật khẩu rỗng');
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!password) return false;
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Khóa 32 byte lấy từ TOTP_ENC_KEY (chuỗi ≥32 ký tự hoặc base64 32 byte). */
function encKey(totpEncKey: string): Buffer {
  // Chuẩn hóa về đúng 32 byte bằng SHA-256 của khóa cấu hình (ổn định, không phụ thuộc độ dài khai).
  return createHash('sha256').update(totpEncKey).digest();
}

/** Mã hóa bí mật TOTP để lưu: AES-256-GCM, IV ngẫu nhiên mỗi lần. Trả base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string, totpEncKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(totpEncKey), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(enc: string, totpEncKey: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encKey(totpEncKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** So khớp an toàn-thời-gian hai chuỗi hex cùng độ dài (dùng cho mã OTP mô phỏng). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
