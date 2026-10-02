/** Căn cước công dân: đúng 12 chữ số. Trả về undefined nếu không hợp lệ. */
export function normalizeCccd(input: string): string | undefined {
  const digits = input.replace(/[\s.\-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : undefined;
}

/** Che CCCD khi hiển thị danh sách: chỉ giữ 4 số cuối. */
export function maskCccd(cccd: string): string {
  return `${'•'.repeat(Math.max(0, cccd.length - 4))}${cccd.slice(-4)}`;
}
