/** Tuổi tròn năm tại thời điểm `now`; undefined nếu không có hoặc sai ngày sinh. */
export function ageInYears(birthDate: string | undefined, now: Date = new Date()): number | undefined {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return undefined;
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const before = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (before) age -= 1;
  return age >= 0 ? age : undefined;
}

/** "3 tuổi", "8 tháng" (dưới 2 tuổi tính theo tháng, như thói quen ở phòng khám nhi). */
export function formatAge(birthDate: string | undefined, now: Date = new Date()): string {
  const years = ageInYears(birthDate, now);
  if (years === undefined || !birthDate) return '';
  if (years >= 2) return `${years} tuổi`;
  const [y, m] = birthDate.split('-').map(Number) as [number, number];
  const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m) - (now.getUTCDate() < Number(birthDate.slice(8)) ? 1 : 0);
  return months >= 1 ? `${months} tháng` : 'sơ sinh';
}
