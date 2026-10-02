import { getDrug, getIcd10, resolveLine, type DrugEntry, type LineInput } from '@phongmach/catalogs';
import {
  DEFAULT_RULES_CONFIG,
  MIN_ACK_REASON_LENGTH,
  type Acknowledgement,
  type Finding,
  type RuleContext,
  type RulesConfig,
} from './types.js';

/**
 * Kiểm tra một đơn thuốc. Hàm thuần: cùng đầu vào cho cùng kết quả, không đọc đồng hồ hay mạng,
 * nên giao diện (cảnh báo khi gõ) và BFF (kiểm tra lại khi ký, không tin client) chạy cùng một mã.
 *
 * Quy tắc minh họa cho M0; danh mục và ngưỡng chưa được cố vấn y khoa duyệt.
 */
export function checkPrescription(lines: LineInput[], ctx: RuleContext, config: Partial<RulesConfig> = {}): Finding[] {
  const cfg = { ...DEFAULT_RULES_CONFIG, ...config };
  const findings: Finding[] = [];

  if (cfg.requireDiagnosis && ctx.diagnoses.length === 0) {
    findings.push({ key: 'no-diagnosis', rule: 'no-diagnosis', severity: 'block', lines: [], message: 'Chưa chọn chẩn đoán (ICD-10).' });
  }
  if (lines.length === 0) {
    findings.push({ key: 'no-lines', rule: 'no-lines', severity: 'block', lines: [], message: 'Đơn chưa có thuốc nào.' });
  }

  const resolved: Array<{ index: number; line: LineInput; drug: DrugEntry }> = [];
  lines.forEach((line, index) => {
    const drug = getDrug(line.drug);
    if (!drug) {
      findings.push({ key: `unknown-drug:${line.drug}`, rule: 'unknown-drug', severity: 'block', lines: [index], message: `Thuốc "${line.drug}" không có trong danh mục.` });
      return;
    }
    resolved.push({ index, line, drug });
  });

  const chronic = ctx.diagnoses.some((code) => getIcd10(code)?.chronic);
  const maxDays = chronic ? cfg.maxDaysChronic : cfg.maxDays;

  for (const { index, line, drug } of resolved) {
    const r = resolveLine(drug, line);
    const missing: string[] = [];
    if (!r.instruction) missing.push('liều/cách dùng');
    if (!r.quantity) missing.push('số lượng');
    if (missing.length) {
      findings.push({ key: `incomplete:${drug.code}`, rule: 'incomplete-line', severity: 'block', lines: [index], message: `${drug.name}: thiếu ${missing.join(' và ')}.` });
    }
    if (line.days !== undefined && line.days > maxDays) {
      const hint = chronic ? '' : ` (bệnh mạn tính được tối đa ${cfg.maxDaysChronic} ngày)`;
      findings.push({ key: `max-days:${drug.code}`, rule: 'max-days', severity: 'block', lines: [index], message: `${drug.name}: ${line.days} ngày vượt tối đa ${maxDays} ngày${hint}.` });
    }
  }

  // Trùng hoạt chất: một hoạt chất xuất hiện ở từ hai dòng trở lên (kể cả thuốc phối hợp).
  const byIngredient = new Map<string, Array<{ index: number; drug: DrugEntry }>>();
  for (const { index, drug } of resolved) {
    for (const ingredient of new Set(drug.ingredients)) {
      byIngredient.set(ingredient, [...(byIngredient.get(ingredient) ?? []), { index, drug }]);
    }
  }
  for (const [ingredient, entries] of byIngredient) {
    if (entries.length < 2) continue;
    findings.push({
      key: `dup:${ingredient}`,
      rule: 'duplicate-ingredient',
      severity: 'ack',
      lines: entries.map((e) => e.index),
      message: `Trùng hoạt chất ${ingredient}: ${entries.map((e) => e.drug.name).join(' và ')}.`,
    });
  }

  for (const { index, drug } of resolved) {
    for (const allergy of ctx.allergies) {
      const hit = allergy.kind === 'class' ? drug.classes.includes(allergy.value) : drug.ingredients.includes(allergy.value);
      if (!hit) continue;
      findings.push({
        key: `allergy:${allergy.kind}:${allergy.value}:${drug.code}`,
        rule: 'allergy',
        severity: 'ack',
        lines: [index],
        message: `Bệnh nhân có ghi nhận dị ứng ${allergy.label}: ${drug.name} thuộc nhóm/chứa hoạt chất này.`,
      });
    }
  }

  const age = ctx.patient.ageYears;
  if (age === undefined) {
    // Không biết tuổi thì mọi quy tắc theo tuổi (trẻ em, CCCD) bị bỏ qua: không được bỏ qua trong im lặng.
    findings.push({ key: 'no-birthdate', rule: 'no-birthdate', severity: 'ack', lines: [], message: 'Chưa có ngày sinh: không kiểm tra được các quy tắc theo tuổi (trẻ em, CCCD).' });
  }
  if (cfg.requireCccd !== 'off' && !ctx.patient.hasCccd && age !== undefined && age >= cfg.cccdMinAgeYears) {
    findings.push({ key: 'no-cccd', rule: 'no-cccd', severity: cfg.requireCccd, lines: [], message: 'Bệnh nhân chưa có số CCCD (bắt buộc trên đơn thuốc liên thông).' });
  }
  if (age !== undefined && age < cfg.weightRequiredUnderYears && !ctx.patient.weightKg) {
    findings.push({ key: 'no-weight', rule: 'no-weight', severity: 'ack', lines: [], message: 'Trẻ chưa được ghi cân nặng: liều thuốc trẻ em phải tính theo cân nặng.' });
  }
  if (age !== undefined && age < cfg.paediatricFormUnderYears) {
    for (const { index, drug } of resolved) {
      if (drug.route === 'uong' && drug.unit === 'viên' && !drug.paediatric) {
        findings.push({ key: `paed-form:${drug.code}`, rule: 'paediatric-form', severity: 'ack', lines: [index], message: `${drug.name}: dạng viên cho trẻ dưới ${cfg.paediatricFormUnderYears} tuổi; cân nhắc dạng gói hoặc siro.` });
      }
    }
  }

  const order = { block: 0, ack: 1 } as const;
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.lines[0] ?? -1) - (b.lines[0] ?? -1));
}

export interface Verdict {
  /** Có phát hiện `block` hoặc `ack` chưa được xác nhận hợp lệ. */
  canSign: boolean;
  blocking: Finding[];
  /** Phát hiện `ack` chưa có xác nhận kèm lý do. */
  unacknowledged: Finding[];
  /** Xác nhận hợp lệ ứng với phát hiện hiện tại (xác nhận cũ không còn phát hiện tương ứng bị bỏ đi). */
  acknowledged: Array<Finding & { reason: string }>;
}

export function judge(findings: Finding[], acks: Acknowledgement[]): Verdict {
  const reasons = new Map<string, string>();
  for (const a of acks) {
    const reason = a.reason.trim();
    if (reason.length >= MIN_ACK_REASON_LENGTH) reasons.set(a.key, reason);
  }
  const blocking = findings.filter((f) => f.severity === 'block');
  const acknowledged: Verdict['acknowledged'] = [];
  const unacknowledged: Finding[] = [];
  for (const f of findings) {
    if (f.severity !== 'ack') continue;
    const reason = reasons.get(f.key);
    if (reason) acknowledged.push({ ...f, reason });
    else unacknowledged.push(f);
  }
  return { canSign: blocking.length === 0 && unacknowledged.length === 0, blocking, unacknowledged, acknowledged };
}
