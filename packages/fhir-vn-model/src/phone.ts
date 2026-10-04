/**
 * Chuẩn hóa số điện thoại Việt Nam về dạng nội địa 0xxxxxxxxx.
 * "+84 912 345 678", "84912345678", "0912.345.678" → "0912345678".
 * Trả về undefined nếu không phải số đầy đủ.
 */
export function normalizePhone(input: string): string | undefined {
  const compact = input.replace(/[\s.\-()]/g, '');
  let national: string;
  if (compact.startsWith('+84')) national = `0${compact.slice(3)}`;
  else if (compact.startsWith('84') && compact.length >= 11) national = `0${compact.slice(2)}`;
  else national = compact;
  return /^0\d{9,10}$/.test(national) ? national : undefined;
}

/**
 * Che số điện thoại khi hiển thị cho người ngoài (bản xem trước tin nhắn): giữ 3 số đầu và 3 số cuối.
 * "0912345678" → "091****678". Không phải số đầy đủ thì trả về undefined (không hiện gì thay vì hiện nguyên chuỗi).
 */
export function maskPhone(input: string): string | undefined {
  const phone = normalizePhone(input);
  return phone && `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}

/** Chỉ giữ chữ số (dùng cho truy vấn tìm theo đoạn số điện thoại, ví dụ 4 số cuối). */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}
