/**
 * Bộ nối kênh phụ của MFA. Ở M0 là MÔ PHỎNG-CÓ-NHÃN (giống Zalo/cổng đơn thuốc): cùng giao diện với bộ
 * nối thật, nhưng không gửi gì ra ngoài — mã OTP hiện trên màn/log demo. Sang M1 thay bằng bộ nối thật
 * mà không đổi giao diện. TOTP (totp.ts) là MFA THẬT, bắt buộc cho owner/doctor — không nằm ở đây.
 */
export interface SmsOtpConnector {
  readonly simulated: boolean;
  /** Gửi OTP tới số điện thoại. Ở bản mô phỏng, trả lại mã để demo hiển thị (bản thật trả void). */
  send(phone: string, code: string): Promise<void>;
}

/** Bộ nối SĐT-OTP mô phỏng: không gửi gì; mã được tạo và kiểm ở identity, bản mô phỏng chỉ "không gửi". */
export class SimulatedSmsOtp implements SmsOtpConnector {
  readonly simulated = true;
  readonly sent: Array<{ phone: string; code: string }> = [];
  async send(phone: string, code: string): Promise<void> {
    // Không gửi gì ra ngoài: ghi lại để demo/kiểm thử xem được.
    this.sent.push({ phone, code });
  }
}
