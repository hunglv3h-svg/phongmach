import type {
  AllergyView,
  DisplayBoard,
  ExamInput,
  HistoryItem,
  PendingPrescription,
  PrescriptionDetail,
  PrescriptionSummary,
  QueueItem,
  QueuePatient,
  QueuePriority,
  Specialty,
  VisitContext,
  VisitMetrics,
  VisitSummary,
} from '@phongmach/clinical';
import type { Gender, PatientSummary } from '@phongmach/fhir-vn-model';
import type { Finding } from '@phongmach/rules';

export type Role = 'owner' | 'doctor' | 'assistant';

export interface AuthState {
  token: string;
  user: { id: string; name: string; role: Role };
  tenant: { slug: string; name: string };
}

export interface DemoTenant {
  slug: string;
  name: string;
  users: Array<{ id: string; name: string; role: Role }>;
}

export interface AuditEntry {
  ts: string;
  requestId: string;
  userId: string;
  userName?: string;
  role: Role | 'system';
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  queryKind?: string;
  resultCount?: number;
  resourceIds?: string[];
  /** Thao tác làm lúc mất mạng: giờ theo máy khách (máy khách khai). */
  clientTs?: string;
}

export interface NewPatient {
  clientUuid: string;
  fullName: string;
  phone?: string;
  cccd?: string;
  birthDate?: string;
  gender?: Gender;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Nội dung JSON của phản hồi lỗi (ví dụ danh sách phát hiện của quy tắc kê đơn). */
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const KEY = 'phongmach.auth';

export function loadAuth(): AuthState | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthState) : undefined;
  } catch {
    return undefined;
  }
}

export function saveAuth(auth: AuthState | undefined): void {
  try {
    if (auth) sessionStorage.setItem(KEY, JSON.stringify(auth));
    else sessionStorage.removeItem(KEY);
  } catch {
    // trình duyệt chặn sessionStorage: ứng dụng vẫn chạy, chỉ không nhớ phiên khi tải lại
  }
}

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: (() => void) | undefined): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, options: { body?: unknown; token?: string; signal?: AbortSignal; text?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Không kết nối được máy chủ');
  }
  if (res.ok) return (options.text ? await res.text() : await res.json()) as T;
  let code = 'error';
  let message = `Lỗi ${res.status}`;
  let parsed: unknown;
  try {
    const body = (await res.json()) as { error?: string; message?: string; issues?: Array<{ path: string; message: string }> };
    parsed = body;
    code = body.error ?? code;
    message = body.message ?? body.issues?.map((i) => `${i.path}: ${i.message}`).join('; ') ?? message;
  } catch {
    // phản hồi không phải JSON
  }
  if (res.status === 401 && options.token) onUnauthorized?.();
  throw new ApiError(res.status, code, message, parsed);
}

export interface CheckInRequest {
  clientUuid: string;
  patientId: string;
  specialty: Specialty;
  priority: QueuePriority;
  reason?: string;
  /** Cấp số lúc mất mạng (OFF-2): giờ đến theo máy khách và số tạm đã báo cho bệnh nhân. */
  arrivedAt?: string;
  proposedNumber?: number;
}

export interface CompleteRequest {
  clientUuid: string;
  exam: ExamInput;
  diagnoses: string[];
  prescription?: {
    lines: Array<{ drug: string; perDose?: number; timesPerDay?: number; days?: number; quantity?: number; instruction?: string }>;
    advice?: string;
    followUpDays?: number;
    acknowledgements: Array<{ key: string; reason: string }>;
  };
  /** Mở hoặc ký lúc mất mạng (OFF-3): cả hai mốc theo đồng hồ của máy này. */
  clientTimes?: { openedAt: string; signedAt: string };
  /** Máy không có dữ liệu dị ứng lúc ký (OFF-4): máy chủ đòi xác nhận 'allergy-unknown' như máy khách đã đòi. */
  allergiesUnknown?: boolean;
}

export interface CompleteResponse {
  visit: VisitSummary;
  prescription?: PrescriptionSummary;
  replayed: boolean;
}

/** Phản hồi 422 khi quy tắc kê đơn không cho ký (kiểm tra lại ở server). */
export interface RulesRejected {
  error: 'rules-not-satisfied';
  blocking: Finding[];
  unacknowledged: Finding[];
}

export interface SimState {
  mode: 'up' | 'down';
  failNext: number;
  accepted: number;
}

export const api = {
  demoUsers: () => request<{ demo: boolean; tenants: DemoTenant[] }>('GET', '/api/session/demo-users'),
  login: (tenant: string, userId: string) => request<AuthState>('POST', '/api/session', { body: { tenant, userId } }),
  search: (token: string, q: string, signal?: AbortSignal) =>
    request<{ intent: string; results: PatientSummary[] }>('GET', `/api/patients/search?q=${encodeURIComponent(q)}`, { token, ...(signal ? { signal } : {}) }),
  createPatient: (token: string, patient: NewPatient) => request<{ patient: PatientSummary; created: boolean }>('POST', '/api/patients', { token, body: patient }),
  readPatient: (token: string, id: string) => request<{ patient: PatientSummary }>('GET', `/api/patients/${id}`, { token }),
  audit: (token: string, limit = 50) => request<{ entries: AuditEntry[] }>('GET', `/api/audit?limit=${limit}`, { token }),
  patchPatient: (token: string, id: string, patch: { cccd?: string; birthDate?: string }) => request<{ patient: PatientSummary }>('PATCH', `/api/patients/${id}`, { token, body: patch }),

  queue: (token: string, signal?: AbortSignal) => request<{ day: string; items: QueueItem[] }>('GET', '/api/queue', { token, ...(signal ? { signal } : {}) }),
  checkIn: (token: string, body: CheckInRequest) => request<{ item: QueueItem; created: boolean }>('POST', '/api/queue', { token, body }),
  cancelVisit: (token: string, id: string) => request<{ ok: true }>('POST', `/api/queue/${id}/cancel`, { token }),
  display: (token: string, signal?: AbortSignal) => request<DisplayBoard>('GET', '/api/display', { token, ...(signal ? { signal } : {}) }),
  /** Tóm tắt và dị ứng của người đang chờ hoặc đang khám hôm nay, để tìm và khám khi mất mạng (OFF-4). */
  prefetch: (token: string, patientIds: string[], signal?: AbortSignal) =>
    request<{ day: string; patients: QueuePatient[] }>('GET', `/api/queue/prefetch?patients=${patientIds.map(encodeURIComponent).join(',')}`, { token, ...(signal ? { signal } : {}) }),

  /** `openedAt`: mở lúc mất mạng, mốc theo đồng hồ máy này (OFF-3). Không có thì không gửi body (Fastify từ chối JSON rỗng). */
  openVisit: (token: string, id: string, body?: { openedAt: string }) => request<VisitContext>('POST', `/api/visits/${id}/open`, { token, ...(body ? { body } : {}) }),
  completeVisit: (token: string, id: string, body: CompleteRequest) => request<CompleteResponse>('POST', `/api/visits/${id}/complete`, { token, body }),

  allergies: (token: string, patientId: string) => request<{ allergies: AllergyView[] }>('GET', `/api/patients/${patientId}/allergies`, { token }),
  addAllergy: (token: string, patientId: string, body: { clientUuid: string; kind: 'class' | 'ingredient'; value: string; label?: string }) =>
    request<{ allergy: AllergyView }>('POST', `/api/patients/${patientId}/allergies`, { token, body }),
  removeAllergy: (token: string, patientId: string, id: string) => request<{ ok: true }>('DELETE', `/api/patients/${patientId}/allergies/${id}`, { token }),
  addHistory: (token: string, patientId: string, body: { clientUuid: string; text: string }) =>
    request<{ item: HistoryItem }>('POST', `/api/patients/${patientId}/medical-history`, { token, body }),
  removeHistory: (token: string, patientId: string, id: string) => request<{ ok: true }>('DELETE', `/api/patients/${patientId}/medical-history/${id}`, { token }),

  prescription: (token: string, id: string) => request<PrescriptionDetail>('GET', `/api/prescriptions/${id}`, { token }),
  printHtml: (token: string, id: string) => request<string>('GET', `/api/prescriptions/${id}/print`, { token, text: true }),
  pending: (token: string, signal?: AbortSignal) => request<{ pending: PendingPrescription[] }>('GET', '/api/prescriptions/pending', { token, ...(signal ? { signal } : {}) }),
  /** Ghi nhật ký một lần in làm lúc mất mạng (trình duyệt in từ dữ liệu trên máy, không qua /print). */
  printed: (token: string, id: string, body: { printedAt: string }) => request<{ ok: true }>('POST', `/api/prescriptions/${id}/printed`, { token, body }),
  retry: (token: string, id: string) => request<{ ok: true }>('POST', `/api/prescriptions/${id}/retry`, { token }),

  simGet: (token: string) => request<{ simulated: boolean; state: SimState }>('GET', '/api/sim/gateway', { token }),
  simSet: (token: string, body: { mode?: 'up' | 'down'; failNext?: number }) => request<{ simulated: boolean; state: SimState }>('POST', '/api/sim/gateway', { token, body }),

  metrics: (token: string, days = 14) => request<VisitMetrics>('GET', `/api/metrics/visits?days=${days}`, { token }),
};
