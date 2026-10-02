import { percentile, type VisitMetrics } from '@phongmach/clinical';
import type { FinishedVisit } from './store.js';

/** Mục tiêu của TL34 B.5 (tiêu chí M0-1): p50 <= 60 s, p90 <= 120 s từ mở hồ sơ đến ký và in. */
export const TARGET_P50_SECONDS = 60;
export const TARGET_P90_SECONDS = 120;
/** Phiên dài hơn ngưỡng này gần như chắc chắn là bỏ dở (đi ăn trưa), không phản ánh tốc độ làm việc. Vẫn đếm riêng, không giấu. */
export const MAX_COUNTED_SECONDS = 30 * 60;

interface Group {
  name: string;
  counted: number[];
  excluded: number;
}

const summarize = (g: { counted: number[]; excluded: number }) => {
  const sorted = [...g.counted].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  return { visits: sorted.length, excluded: g.excluded, ...(p50 !== undefined ? { p50Seconds: p50 } : {}), ...(p90 !== undefined ? { p90Seconds: p90 } : {}) };
};

export function computeMetrics(visits: FinishedVisit[], range: { from: string; to: string; truncated: boolean }): VisitMetrics {
  const byDoctor = new Map<string, Group>();
  const all = { counted: [] as number[], excluded: 0 };
  for (const v of visits) {
    if (v.seconds === undefined) continue; // không có mốc mở hồ sơ thì không đo được
    const key = v.doctorUserId ?? v.doctorName ?? '?';
    const g = byDoctor.get(key) ?? { name: v.doctorName ?? '(không rõ)', counted: [], excluded: 0 };
    byDoctor.set(key, g);
    if (v.seconds > MAX_COUNTED_SECONDS) {
      g.excluded += 1;
      all.excluded += 1;
    } else {
      g.counted.push(v.seconds);
      all.counted.push(v.seconds);
    }
  }
  return {
    from: range.from,
    to: range.to,
    targetP50Seconds: TARGET_P50_SECONDS,
    targetP90Seconds: TARGET_P90_SECONDS,
    excludedLongerThanSeconds: MAX_COUNTED_SECONDS,
    truncated: range.truncated,
    doctors: [...byDoctor.values()].map((g) => ({ name: g.name, ...summarize(g) })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    all: summarize(all),
  };
}
