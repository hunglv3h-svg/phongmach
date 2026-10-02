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

/** Chỉ giữ chữ số (dùng cho truy vấn tìm theo đoạn số điện thoại, ví dụ 4 số cuối). */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}
