import type { Specialty } from '@phongmach/clinical';
import { NHI_CASES } from './cases-nhi.js';
import { NOI_CASES } from './cases-noi.js';
import type { TrialCase } from './types.js';

export * from './types.js';
export * from './sheets.js';
export { NOI_CASES, NHI_CASES };

/** Cả bộ ca: nội trước, nhi sau; trong mỗi chuyên khoa ca làm quen đứng trước. Thứ tự này cũng là thứ tự xếp hàng chờ. */
export const ALL_CASES: readonly TrialCase[] = [...NOI_CASES, ...NHI_CASES];

/** Ca của một chuyên khoa, theo thứ tự gọi khám. `warmup`: chỉ ca làm quen (true) hoặc chỉ ca tính số đo (false). */
export function casesOf(specialty: Specialty, warmup?: boolean): TrialCase[] {
  return ALL_CASES.filter((c) => c.specialty === specialty && (warmup === undefined || c.warmup === warmup));
}

/** Số lượt tối thiểu mỗi bác sĩ theo tiêu chí M0-1 (kế hoạch, mục 5.3). */
export const M01_MIN_VISITS = 10;
/** Số bác sĩ theo tiêu chí M0-1. */
export const M01_DOCTORS = 3;
