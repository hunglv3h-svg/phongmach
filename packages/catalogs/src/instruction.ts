import type { DrugEntry, Route } from './types.js';

const VERB: Record<Route, string> = {
  uong: 'Uống',
  boi: 'Bôi',
  'nho-mat': 'Nhỏ mắt',
  'nho-mui': 'Nhỏ mũi',
  'nho-tai': 'Nhỏ tai',
  xit: 'Xịt',
  'khi-dung': 'Khí dung',
};

export interface LineDose {
  perDose?: number | undefined;
  timesPerDay?: number | undefined;
  days?: number | undefined;
  quantity?: number | undefined;
  timing?: string | undefined;
}

/** Số theo cách viết tiếng Việt: dấu phẩy thập phân. */
export const formatNumber = (n: number): string => String(n).replace('.', ',');

/** Cách dùng tự sinh từ liều: "Uống 1 viên x 3 lần/ngày, sau ăn". Trả về chuỗi rỗng nếu chưa đủ thông tin. */
export function buildInstruction(drug: DrugEntry, line: LineDose): string {
  const verb = VERB[drug.route];
  const timing = line.timing ?? drug.defaults.timing;
  if (!line.perDose || line.perDose <= 0) return '';
  const dose = `${verb} ${formatNumber(line.perDose)} ${drug.unit}`;
  if (drug.defaults.asNeeded) return `${dose} mỗi lần khi cần${timing ? `, ${timing}` : ''}`;
  if (!line.timesPerDay || line.timesPerDay <= 0) return '';
  return `${dose} x ${formatNumber(line.timesPerDay)} lần/ngày${timing ? `, ${timing}` : ''}`;
}

/** Số lượng cần lấy: tự tính cho thuốc uống theo lịch, nhập tay cho thuốc dùng khi cần, kem bôi, thuốc nhỏ. */
export function computeQuantity(drug: DrugEntry, line: LineDose): number | undefined {
  if (drug.manualQuantity) return line.quantity && line.quantity > 0 ? line.quantity : undefined;
  if (line.perDose && line.timesPerDay && line.days) return Math.ceil(line.perDose * line.timesPerDay * line.days);
  return undefined;
}
