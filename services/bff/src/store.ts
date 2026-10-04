import type { Icd10Entry } from '@phongmach/catalogs';
import type {
  AllergyView,
  CheckInInput,
  ExamInput,
  HistoryItem,
  PendingPrescription,
  PrescriptionDetail,
  PrescriptionToSign,
  QueueItem,
  QueuePatient,
  VisitSecondsSource,
  VisitContext,
  VisitSummary,
} from '@phongmach/clinical';
import type { NewPatientInput, PatientSummary, SearchIntent } from '@phongmach/fhir-vn-model';
import type { GatewayPayload } from './gateway.js';

export interface Doctor {
  /** id Practitioner (có với bác sĩ, không có với phụ tá). */
  practitionerId?: string | undefined;
  userId: string;
  name: string;
}

export type OpenResult =
  | { kind: 'ok'; context: VisitContext }
  | { kind: 'not-found' }
  | { kind: 'closed' }
  | { kind: 'taken'; doctorName?: string | undefined };

/** Cấp số cho thao tác làm lúc mất mạng (OFF-2). */
export interface CheckInOptions {
  /** Giờ đến theo máy khách (đã kiểm tra hợp lý): ngày của lượt khám tính theo giờ này. */
  arrivedAt?: Date | undefined;
  /** Số tạm máy khách đã báo cho bệnh nhân: giữ nếu còn trống, nếu không thì cấp số kế tiếp. */
  proposedNumber?: number | undefined;
}

export interface CompleteCommand {
  clientUuid: string;
  encounterId: string;
  doctor: Doctor;
  /** Giờ máy chủ nhận yêu cầu. */
  now: Date;
  /** Có khi mở hoặc ký lúc mất mạng: giờ theo đồng hồ máy khách (OFF-3). */
  clientTimes?: { openedAt: string; signedAt: string } | undefined;
  exam: ExamInput;
  diagnoses: Icd10Entry[];
  prescription?: PrescriptionToSign | undefined;
}

export type CompleteResult =
  | { kind: 'ok'; visit: VisitSummary; replayed: boolean }
  | { kind: 'not-found' }
  /** Lượt khám chưa được mở (chưa "gọi vào khám") hoặc do người khác giữ. */
  | { kind: 'not-open' }
  /** Lượt khám đã đóng bằng một lần hoàn tất khác (khác clientUuid). */
  | { kind: 'already-closed' }
  /** Ghi dở: một số mục lỗi. Chạy lại với cùng clientUuid sẽ hoàn tất. */
  | { kind: 'incomplete'; failed: Array<{ index: number; status: string; message?: string; code?: string }> };

export interface OutboxJob {
  taskId: string;
  localCode: string;
  attempts: number;
  payload: GatewayPayload;
  /** Phiên bản Task đã đọc, để nhận việc bằng If-Match: hai worker không cùng gửi một đơn. */
  version: string;
}

export interface FinishedVisit {
  doctorName?: string | undefined;
  doctorUserId?: string | undefined;
  seconds?: number | undefined;
  source?: VisitSecondsSource | undefined;
}

/** Hộp thư đi của MỘT phòng khám. */
export interface OutboxStore {
  /** Việc đến hạn gửi, chỉ của các lượt khám đã đóng (điểm chốt của việc hoàn tất). */
  dueSends(now: Date, limit: number): Promise<OutboxJob[]>;
  /** false nếu worker khác đã nhận trước. */
  claim(job: OutboxJob, now: Date): Promise<boolean>;
  complete(job: OutboxJob, nationalCode: string, now: Date): Promise<void>;
  fail(job: OutboxJob, error: string, now: Date, retryable: boolean): Promise<void>;
}

/**
 * Kho đang bận: xung đột giao dịch còn nguyên sau các lần thử lại (kế hoạch, F13), hoặc cấp số không giành được số trống
 * sau nhiều vòng. Lời ghi này chưa được nhận; gửi lại cùng `clientUuid` là an toàn. BFF trả 503 `busy` kèm `retry: true`.
 */
export class BusyError extends Error {
  /** `what`: loại lời ghi (không phải dữ liệu bệnh nhân), để ghi log. */
  constructor(readonly what: string) {
    super(`Kho đang bận: ${what}`);
    this.name = 'BusyError';
  }
}

/** Truy cập dữ liệu của MỘT phòng khám. Mọi thứ khác trong BFF chỉ biết giao diện này, không biết Medplum. */
export interface ClinicStore extends OutboxStore {
  searchPatients(intent: SearchIntent, limit: number): Promise<PatientSummary[]>;
  /** `created` là false khi `clientUuid` đã được dùng: gửi lại không tạo bệnh nhân trùng. */
  createPatient(input: NewPatientInput): Promise<{ patient: PatientSummary; created: boolean }>;
  readPatient(id: string): Promise<PatientSummary | undefined>;
  /** Bổ sung thông tin còn thiếu (CCCD, ngày sinh). Trả về undefined nếu không có bệnh nhân. */
  updatePatient(id: string, patch: { cccd?: string | undefined; birthDate?: string | undefined }): Promise<PatientSummary | undefined>;

  checkIn(input: CheckInInput, now: Date, options?: CheckInOptions): Promise<{ item: QueueItem; created: boolean } | undefined>;
  listQueue(day: string): Promise<QueueItem[]>;
  /**
   * Tóm tắt và dị ứng của bệnh nhân đang chờ hoặc đang khám trong ngày (nạp trước cho lúc mất mạng, OFF-4).
   * `patientIds` chỉ lọc bớt: không bao giờ trả về người ngoài hàng chờ của ngày đó.
   */
  prefetchQueue(day: string, patientIds?: string[]): Promise<QueuePatient[]>;
  cancelVisit(encounterId: string): Promise<'ok' | 'not-found' | 'not-waiting'>;
  /** `openedAt`: mở lúc mất mạng, mốc theo máy khách (đã kiểm tra hợp lý). */
  openVisit(encounterId: string, doctor: Doctor, now: Date, openedAt?: Date): Promise<OpenResult>;
  readVisit(encounterId: string): Promise<VisitContext | undefined>;
  completeVisit(command: CompleteCommand): Promise<CompleteResult>;

  listAllergies(patientId: string): Promise<AllergyView[]>;
  addAllergy(patientId: string, input: { clientUuid: string; kind: 'class' | 'ingredient'; value: string; label?: string | undefined }, now: Date): Promise<AllergyView | undefined>;
  removeAllergy(patientId: string, allergyId: string): Promise<boolean>;
  listHistory(patientId: string): Promise<HistoryItem[]>;
  addHistory(patientId: string, input: { clientUuid: string; text: string }, now: Date): Promise<HistoryItem | undefined>;
  removeHistory(patientId: string, itemId: string): Promise<boolean>;
  patientVisits(patientId: string, limit: number): Promise<VisitSummary[]>;

  readPrescription(id: string): Promise<PrescriptionDetail | undefined>;
  pendingPrescriptions(limit: number): Promise<PendingPrescription[]>;
  /** Đưa việc gửi của đơn về "chờ gửi" để thử ngay. 'not-retryable' nếu đơn đã gửi xong. */
  retryPrescription(id: string, now: Date): Promise<'ok' | 'not-found' | 'not-retryable'>;

  finishedVisits(fromDay: string, limit: number): Promise<{ visits: FinishedVisit[]; truncated: boolean }>;
}

/** Trả về kho của phòng khám theo `slug`. `slug` luôn lấy từ phiên đã xác thực, không từ tham số của yêu cầu. */
export type StoreFactory = (tenantSlug: string) => Promise<ClinicStore>;
