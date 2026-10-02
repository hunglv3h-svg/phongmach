// Bản nháp lượt khám phía trình duyệt và các hàm chuyển đổi thuần (kiểm thử được, không phụ thuộc React).
import {
  buildInstruction,
  computeQuantity,
  getDrug,
  resolveLine,
  type DrugEntry,
  type LineInput,
  type PrescriptionTemplate,
} from '@phongmach/catalogs';
import { lineToInput, type PrescriptionLineView, type VisitSummary, type VitalsInput } from '@phongmach/clinical';
import { ageInYears, checkPrescription, judge, type Allergy, type Finding, type RulesConfig, type Verdict } from '@phongmach/rules';
import type { PatientSummary } from '@phongmach/fhir-vn-model';
import type { CompleteRequest } from '../api';

/** Số theo cách gõ của người Việt: "37,5" và "37.5" đều được; rỗng là không có; sai là NaN. */
export function parseNum(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return undefined;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export const VITAL_FIELDS = ['temperatureC', 'pulse', 'systolic', 'diastolic', 'respiratoryRate', 'spo2', 'weightKg', 'heightCm'] as const;
export type VitalField = (typeof VITAL_FIELDS)[number];

/** Dòng thuốc trong bản nháp: ô nhập là chuỗi để giữ nguyên cái người dùng đang gõ ("1," chưa phải số). */
export interface LineDraft {
  key: string;
  drug: string;
  perDose: string;
  timesPerDay: string;
  days: string;
  quantity: string;
  /** Chỉ có khi bác sĩ đã gõ khác bản tự sinh. */
  instruction?: string;
}

export interface Draft {
  /** Sinh một lần khi mở hồ sơ: gửi lại cùng UUID không tạo bản ghi trùng. */
  clientUuid: string;
  reason: string;
  symptoms: string;
  findings: string;
  vitals: Record<VitalField, string>;
  diagnoses: string[];
  lines: LineDraft[];
  advice: string;
  followUpDays: string;
  /** khóa phát hiện → lý do xác nhận */
  acks: Record<string, string>;
}

export const emptyVitals = (): Record<VitalField, string> => ({ temperatureC: '', pulse: '', systolic: '', diastolic: '', respiratoryRate: '', spo2: '', weightKg: '', heightCm: '' });

export function newDraft(reason = ''): Draft {
  return { clientUuid: crypto.randomUUID(), reason, symptoms: '', findings: '', vitals: emptyVitals(), diagnoses: [], lines: [], advice: '', followUpDays: '', acks: {} };
}

let lineCounter = 0;
const nextKey = () => `l${++lineCounter}`;
const str = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));

export function lineFromDrug(drug: DrugEntry): LineDraft {
  const d = drug.defaults;
  return { key: nextKey(), drug: drug.code, perDose: str(d.perDose), timesPerDay: str(d.timesPerDay), days: str(d.days), quantity: '' };
}

export function lineFromTemplate(l: PrescriptionTemplate['lines'][number]): LineDraft | undefined {
  const drug = getDrug(l.drug);
  if (!drug) return undefined;
  const base = lineFromDrug(drug);
  return {
    ...base,
    ...(l.perDose !== undefined ? { perDose: str(l.perDose) } : {}),
    ...(l.timesPerDay !== undefined ? { timesPerDay: str(l.timesPerDay) } : {}),
    ...(l.days !== undefined ? { days: str(l.days) } : {}),
    ...(l.quantity !== undefined ? { quantity: str(l.quantity) } : {}),
    ...(l.instruction ? { instruction: l.instruction } : {}),
  };
}

/** Kê lại: sao chép dòng thuốc từ đơn cũ thành dòng nháp mới (đơn mới có UUID mới, quy tắc chạy lại từ đầu). */
export function lineFromPrevious(view: PrescriptionLineView): LineDraft {
  const i = lineToInput(view);
  return { key: nextKey(), drug: i.drug, perDose: str(i.perDose), timesPerDay: str(i.timesPerDay), days: str(i.days), quantity: str(i.quantity), ...(i.instruction ? { instruction: i.instruction } : {}) };
}

export function toLineInput(l: LineDraft): LineInput {
  const perDose = parseNum(l.perDose);
  const timesPerDay = parseNum(l.timesPerDay);
  const days = parseNum(l.days);
  const quantity = parseNum(l.quantity);
  return {
    drug: l.drug,
    ...(perDose !== undefined && !Number.isNaN(perDose) ? { perDose } : {}),
    ...(timesPerDay !== undefined && !Number.isNaN(timesPerDay) ? { timesPerDay } : {}),
    ...(days !== undefined && !Number.isNaN(days) ? { days } : {}),
    ...(quantity !== undefined && !Number.isNaN(quantity) ? { quantity } : {}),
    ...(l.instruction?.trim() ? { instruction: l.instruction } : {}),
  };
}

/** Cách dùng và số lượng hiển thị cho một dòng (tự sinh nếu bác sĩ chưa gõ đè). */
export function describeLine(l: LineDraft): { drug?: DrugEntry; instruction: string; quantity?: number; auto: string } {
  const drug = getDrug(l.drug);
  if (!drug) return { instruction: '', auto: '' };
  const input = toLineInput(l);
  const resolved = resolveLine(drug, input);
  const { instruction: _typed, ...dose } = input;
  void _typed;
  return { drug, instruction: resolved.instruction, ...(resolved.quantity !== undefined ? { quantity: resolved.quantity } : {}), auto: buildInstruction(drug, dose) };
}

/** Sửa ô cách dùng: gõ lại đúng bản tự sinh thì bỏ ghi đè (để đổi liều sau đó còn cập nhật cách dùng). */
export function withInstruction(l: LineDraft, text: string): LineDraft {
  const { instruction: _old, ...rest } = l;
  void _old;
  const auto = describeLine(rest).auto;
  return text.trim() && text !== auto ? { ...rest, instruction: text } : rest;
}

export function toVitals(d: Draft): { vitals: VitalsInput; invalid: VitalField[] } {
  const vitals: VitalsInput = {};
  const invalid: VitalField[] = [];
  for (const f of VITAL_FIELDS) {
    const n = parseNum(d.vitals[f]);
    if (n === undefined) continue;
    if (Number.isNaN(n)) invalid.push(f);
    else vitals[f] = n;
  }
  return { vitals, invalid };
}

export interface RuleView {
  findings: Finding[];
  verdict: Verdict;
}

/** Chạy bộ quy tắc ở trình duyệt để cảnh báo ngay khi gõ. Server chạy lại cùng bộ quy tắc khi ký. */
export function evaluate(
  d: Draft,
  ctx: { specialty: 'noi' | 'nhi'; patient: Pick<PatientSummary, 'birthDate' | 'cccdMasked'>; allergies: Allergy[] },
  config?: Partial<RulesConfig>,
  now = new Date()
): RuleView {
  const { vitals } = toVitals(d);
  const findings = checkPrescription(
    d.lines.map(toLineInput),
    { specialty: ctx.specialty, patient: { ageYears: ageInYears(ctx.patient.birthDate, now), hasCccd: !!ctx.patient.cccdMasked, weightKg: vitals.weightKg }, allergies: ctx.allergies, diagnoses: d.diagnoses },
    config
  );
  const verdict = judge(findings, Object.entries(d.acks).map(([key, reason]) => ({ key, reason })));
  return { findings, verdict };
}

export function toCompleteRequest(d: Draft, includePrescription: boolean): CompleteRequest {
  const { vitals } = toVitals(d);
  const followUp = parseNum(d.followUpDays);
  return {
    clientUuid: d.clientUuid,
    exam: { ...(d.reason.trim() ? { reason: d.reason.trim() } : {}), ...(d.symptoms.trim() ? { symptoms: d.symptoms.trim() } : {}), ...(d.findings.trim() ? { findings: d.findings.trim() } : {}), vitals },
    diagnoses: d.diagnoses,
    ...(includePrescription
      ? {
          prescription: {
            lines: d.lines.map(toLineInput).map((l) => ({ ...l })),
            ...(d.advice.trim() ? { advice: d.advice.trim() } : {}),
            ...(followUp !== undefined && !Number.isNaN(followUp) ? { followUpDays: followUp } : {}),
            acknowledgements: Object.entries(d.acks).map(([key, reason]) => ({ key, reason })),
          },
        }
      : {}),
  };
}

export function applyTemplate(d: Draft, t: PrescriptionTemplate): Draft {
  const lines = t.lines.map(lineFromTemplate).filter((l): l is LineDraft => l !== undefined);
  return {
    ...d,
    lines,
    diagnoses: d.diagnoses.length ? d.diagnoses : t.icd10,
    reason: d.reason.trim() ? d.reason : (t.reason ?? ''),
    advice: t.advice ?? '',
    acks: {},
  };
}

/** Chọn đơn mẫu: đơn đang trống thì điền cả đơn; đã có thuốc thì chỉ thêm thuốc chưa có (không xóa việc bác sĩ đã làm). */
export function addTemplate(d: Draft, t: PrescriptionTemplate): Draft {
  if (d.lines.length === 0) return applyTemplate(d, t);
  const have = new Set(d.lines.map((l) => l.drug));
  const extra = t.lines.map(lineFromTemplate).filter((l): l is LineDraft => l !== undefined && !have.has(l.drug));
  return { ...d, lines: [...d.lines, ...extra], diagnoses: d.diagnoses.length ? d.diagnoses : t.icd10 };
}

/** "Kê lại" một nút: đưa thuốc (và chẩn đoán, lời dặn nếu chưa có) của một lượt khám cũ vào đơn mới. */
export function addPrevious(d: Draft, v: VisitSummary): Draft {
  const rx = v.prescription;
  if (!rx) return d;
  const have = new Set(d.lines.map((l) => l.drug));
  const extra = rx.lines.filter((l) => !have.has(l.drug)).map(lineFromPrevious);
  return {
    ...d,
    lines: [...d.lines, ...extra],
    diagnoses: d.diagnoses.length ? d.diagnoses : v.diagnoses.map((x) => x.code),
    advice: d.advice.trim() ? d.advice : (rx.advice ?? ''),
    followUpDays: d.followUpDays || (rx.followUpDays !== undefined ? String(rx.followUpDays) : ''),
    // Đơn mới là việc mới: các xác nhận cũ không được mang sang.
    acks: {},
  };
}

// --- lưu nháp tạm trong tab (sessionStorage): chống mất công khi tải lại trang. Bản mã hóa và ngoại tuyến là việc của M0-S3.
const PREFIX = 'phongmach.draft.';

export function loadDraft(visitId: string): Draft | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + visitId);
    return raw ? (JSON.parse(raw) as Draft) : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraft(visitId: string, d: Draft): void {
  try {
    sessionStorage.setItem(PREFIX + visitId, JSON.stringify(d));
  } catch {
    // đầy bộ nhớ hoặc bị chặn: bỏ qua, ứng dụng vẫn chạy
  }
}

export function dropDraft(visitId: string): void {
  try {
    sessionStorage.removeItem(PREFIX + visitId);
  } catch {
    // bỏ qua
  }
}

/** Đăng xuất phải xóa mọi bản nháp: chúng chứa dữ liệu lâm sàng. */
export function dropAllDrafts(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    // bỏ qua
  }
}

export { computeQuantity };
