import type { LineInput } from '@phongmach/catalogs';

/**
 * Mức của một phát hiện:
 *  - `block`: không được ký (thiếu dữ liệu bắt buộc, vượt giới hạn pháp lý).
 *  - `ack`: bác sĩ được ký nhưng phải xác nhận kèm lý do; lý do được lưu cùng đơn.
 */
export type Severity = 'block' | 'ack';

export type RuleId =
  | 'no-diagnosis'
  | 'no-lines'
  | 'unknown-drug'
  | 'incomplete-line'
  | 'max-days'
  | 'duplicate-ingredient'
  | 'allergy'
  | 'no-cccd'
  | 'no-birthdate'
  | 'no-weight'
  | 'paediatric-form';

export interface Finding {
  /** Khóa ổn định theo nội dung (không theo vị trí dòng) để xác nhận vẫn đúng khi bác sĩ đổi thứ tự thuốc. */
  key: string;
  rule: RuleId;
  severity: Severity;
  /** Chỉ số các dòng thuốc liên quan (từ 0), để giao diện tô dòng. */
  lines: number[];
  message: string;
}

export interface Allergy {
  kind: 'class' | 'ingredient';
  /** Mã nhóm (xem ALLERGY_CLASSES) hoặc tên hoạt chất. */
  value: string;
  label: string;
}

export interface RuleContext {
  specialty: 'noi' | 'nhi';
  patient: {
    ageYears?: number | undefined;
    hasCccd: boolean;
    weightKg?: number | undefined;
  };
  allergies: Allergy[];
  /** Mã ICD-10 đã chọn. */
  diagnoses: string[];
}

/** Cấu hình quy tắc: tách khỏi mã để M1 cho từng phòng khám/nguồn pháp lý khác nhau (T-RULE "không lập trình cứng"). */
export interface RulesConfig {
  maxDays: number;
  maxDaysChronic: number;
  requireDiagnosis: boolean;
  /** Mức áp dụng khi bệnh nhân từ `cccdMinAgeYears` tuổi mà chưa có CCCD. */
  requireCccd: Severity | 'off';
  cccdMinAgeYears: number;
  /** Dưới số tuổi này mà chưa ghi cân nặng thì phải xác nhận. */
  weightRequiredUnderYears: number;
  /** Dưới số tuổi này mà kê thuốc dạng viên (không phải dạng trẻ em) thì phải xác nhận. */
  paediatricFormUnderYears: number;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  maxDays: 30,
  maxDaysChronic: 90,
  requireDiagnosis: true,
  requireCccd: 'block',
  cccdMinAgeYears: 14,
  weightRequiredUnderYears: 12,
  paediatricFormUnderYears: 6,
};

export interface PrescriptionToCheck {
  lines: LineInput[];
}

export interface Acknowledgement {
  key: string;
  reason: string;
}

export const MIN_ACK_REASON_LENGTH = 5;
