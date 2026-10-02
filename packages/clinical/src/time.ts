/** Việt Nam không có giờ mùa hè: múi giờ cố định UTC+7. */
const OFFSET_MS = 7 * 3_600_000;

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) của một thời điểm. Hàng chờ đánh số lại mỗi ngày theo ngày này. */
export function vnDay(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** [đầu ngày, đầu ngày kế) theo giờ Việt Nam, dạng ISO có múi giờ. */
export function vnDayRange(day: string): { start: string; end: string } {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: `${day}T00:00:00+07:00`, end: `${next.toISOString().slice(0, 10)}T00:00:00+07:00` };
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  // Phương pháp xếp hạng gần nhất: không nội suy, nên p90 của 10 lượt là lượt thứ 9 chứ không phải giá trị chưa từng xảy ra.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}
