// Kiểu dữ liệu dùng chung giữa BFF và giao diện (chỉ là hình dạng JSON; không phụ thuộc FHIR).
import type { PatientSummary } from '@phongmach/fhir-vn-model';
import type { Allergy } from '@phongmach/rules';

export type Specialty = 'noi' | 'nhi';
export const SPECIALTIES: readonly Specialty[] = ['noi', 'nhi'];
export const SPECIALTY_LABEL: Record<Specialty, string> = { noi: 'Nội tổng quát', nhi: 'Nhi' };

export type QueuePriority = 'normal' | 'appointment' | 'urgent';
export const PRIORITIES: readonly QueuePriority[] = ['normal', 'appointment', 'urgent'];
export const PRIORITY_LABEL: Record<QueuePriority, string> = { normal: 'Thường', appointment: 'Đã hẹn', urgent: 'Cấp cứu/ưu tiên' };

export type QueueStatus = 'waiting' | 'in-exam' | 'done' | 'cancelled';

export interface QueueItem {
  /** id lượt khám (Encounter). */
  id: string;
  number: number;
  /** YYYYMMDD-NNN */
  code: string;
  status: QueueStatus;
  priority: QueuePriority;
  specialty: Specialty;
  patientId: string;
  patientName: string;
  birthDate?: string;
  arrivedAt: string;
  calledAt?: string;
  doctorName?: string;
  /** Người dùng đang giữ hồ sơ (để giao diện biết "bạn đang khám"). */
  doctorUserId?: string;
  reason?: string;
}

/** Màn hình chờ chỉ có số thứ tự và chữ cái đầu: không có họ tên đầy đủ (tối thiểu hóa dữ liệu hiển thị nơi công cộng). */
export interface DisplayItem {
  number: number;
  initials: string;
  priority: QueuePriority;
}

export interface DisplayBoard {
  clinic: string;
  now: string;
  inExam: DisplayItem[];
  waiting: DisplayItem[];
}

export interface VitalsInput {
  temperatureC?: number;
  pulse?: number;
  systolic?: number;
  diastolic?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
}

export interface ExamInput {
  reason?: string;
  symptoms?: string;
  findings?: string;
  vitals: VitalsInput;
}

export interface AllergyView extends Allergy {
  id: string;
  recordedAt?: string;
}

export interface HistoryItem {
  id: string;
  text: string;
  recordedAt?: string;
}

/** Trạng thái gửi cổng liên thông của một đơn. */
export type GatewayStatus = 'signed' | 'sending' | 'retry' | 'sent' | 'failed';

export const GATEWAY_LABEL: Record<GatewayStatus, string> = {
  signed: 'Đã ký',
  sending: 'Đang gửi',
  retry: 'Chờ gửi lại',
  sent: 'Đã gửi',
  failed: 'Lỗi, cần xử lý',
};

export interface GatewayView {
  taskId: string;
  status: GatewayStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  nationalCode?: string;
}

export interface PrescriptionLineView {
  drug: string;
  name: string;
  unit: string;
  instruction: string;
  quantity?: number;
  perDose?: number;
  timesPerDay?: number;
  days?: number;
}

export interface AckView {
  key: string;
  message: string;
  reason: string;
}

export interface PrescriptionSummary {
  /** id của List đại diện cho đơn. */
  id: string;
  /** Mã đơn nội bộ in trên đơn. */
  code: string;
  signedAt: string;
  signerName?: string;
  patientId: string;
  patientName?: string;
  lines: PrescriptionLineView[];
  advice?: string;
  followUpDays?: number;
  acknowledgements: AckView[];
  gateway?: GatewayView;
}

export interface DiagnosisView {
  code: string;
  name: string;
}

export interface VisitSummary {
  encounterId: string;
  date: string;
  specialty: Specialty;
  doctorName?: string;
  reason?: string;
  symptoms?: string;
  findings?: string;
  vitals: VitalsInput;
  diagnoses: DiagnosisView[];
  prescription?: PrescriptionSummary;
  visitSeconds?: number;
}

/** Số đo thời gian phiên khám (T-TELE), tính từ lúc bác sĩ mở hồ sơ đến lúc ký và in. */
export interface VisitMetrics {
  from: string;
  to: string;
  targetP50Seconds: number;
  targetP90Seconds: number;
  /** Phiên dài hơn ngưỡng bị loại (thường là bỏ dở hoặc đi ăn trưa), nêu rõ số lượng để không giấu. */
  excludedLongerThanSeconds: number;
  /** Có nhiều lượt hơn số tối đa đọc được nên số liệu chưa đủ. */
  truncated: boolean;
  doctors: Array<MetricsGroup & { name: string }>;
  all: MetricsGroup;
}

export interface MetricsGroup {
  visits: number;
  excluded: number;
  /** Số lượt (đã tính trong `visits`) đo bằng đồng hồ máy khách vì mở hoặc ký lúc mất mạng (OFF-3). */
  clientMeasured: number;
  /** Lượt có giờ máy khách không hợp lý: không đo được, không tính vào phân vị, đếm riêng để không giấu. */
  invalidClock: number;
  p50Seconds?: number;
  p90Seconds?: number;
}

/** Bệnh nhân trong hàng chờ hôm nay kèm dị ứng, nạp sẵn về máy để tìm và khám khi mất mạng (OFF-4). */
export interface QueuePatient {
  patient: PatientSummary;
  allergies: AllergyView[];
}

/** Mọi thứ bác sĩ cần thấy khi mở hồ sơ để khám. */
export interface VisitContext {
  visit: QueueItem;
  patient: PatientSummary;
  allergies: AllergyView[];
  history: HistoryItem[];
  /** Các lượt khám đã xong gần nhất, mới nhất trước (không gồm lượt hiện tại). */
  previous: VisitSummary[];
}

/** Đơn thuốc kèm thông tin cần để in. */
export interface PrescriptionDetail {
  prescription: PrescriptionSummary;
  patient: PatientSummary;
  diagnoses: DiagnosisView[];
  encounterId: string;
}

/** Một dòng ở màn hình "đơn chưa gửi được". */
export interface PendingPrescription {
  prescriptionId: string;
  code: string;
  signedAt: string;
  patientName?: string;
  doctorName?: string;
  gateway: GatewayView;
}
