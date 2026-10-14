import { z } from 'zod';
import { ROLES } from '../tenants.js';

/**
 * Hồ sơ nhân viên THẬT (T-IDP). Lưu băm mật khẩu (Argon2id) và bí mật TOTP ĐÃ MÃ HÓA (TOTP_ENC_KEY).
 * Ở M0 lưu trong một file JSON (STAFF_FILE), KHÔNG commit (giống .demo-tenants.json). Sang M1 tách ra IdP.
 *
 * `tenants`: danh sách phòng khám nhân viên được phép truy cập. >1 ⇒ phải chọn tenant sau đăng nhập (§4.1).
 * `loginId`: SĐT hoặc mã nhân viên — KHÔNG log, KHÔNG đưa vào nhật ký truy cập.
 */
export const staffSchema = z.object({
  userId: z.string().min(1).max(64),
  loginId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  role: z.enum(ROLES),
  tenants: z.array(z.string().min(1)).min(1),
  /** Băm Argon2id của mật khẩu (chuỗi PHC `$argon2id$...`). */
  passwordHash: z.string().min(1),
  /** Bí mật TOTP đã mã hóa (base64: iv|tag|ciphertext). Thiếu ⇒ chưa đăng ký MFA. */
  totpEnc: z.string().optional(),
  /** Mã khôi phục dùng-một-lần, lưu dạng băm Argon2id. */
  recoveryHashes: z.array(z.string()).default([]),
  /** Tăng mỗi khi đổi/đặt lại mật khẩu hoặc quản trị thu hồi: vô hiệu hóa mọi cookie trusted-device cũ (§4.3). */
  trustedDeviceEpoch: z.number().int().min(0).default(0),
  practitionerId: z.string().optional(),
});

export type StaffRecord = z.infer<typeof staffSchema>;

export const staffFileSchema = z.object({ staff: z.array(staffSchema).default([]) });
export type StaffFile = z.infer<typeof staffFileSchema>;
