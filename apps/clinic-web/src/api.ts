import type { Gender, PatientSummary } from '@phongmach/fhir-vn-model';

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
  role: Role;
  action: 'login' | 'search' | 'read' | 'create' | 'audit-read';
  outcome: 'ok' | 'denied' | 'error';
  queryKind?: string;
  resultCount?: number;
  resourceIds?: string[];
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
    message: string
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

async function request<T>(method: string, path: string, options: { body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
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
  if (res.ok) return (await res.json()) as T;
  let code = 'error';
  let message = `Lỗi ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string; message?: string; issues?: Array<{ path: string; message: string }> };
    code = body.error ?? code;
    message = body.message ?? body.issues?.map((i) => `${i.path}: ${i.message}`).join('; ') ?? message;
  } catch {
    // phản hồi không phải JSON
  }
  if (res.status === 401 && options.token) onUnauthorized?.();
  throw new ApiError(res.status, code, message);
}

export const api = {
  demoUsers: () => request<{ demo: boolean; tenants: DemoTenant[] }>('GET', '/api/session/demo-users'),
  login: (tenant: string, userId: string) => request<AuthState>('POST', '/api/session', { body: { tenant, userId } }),
  search: (token: string, q: string, signal?: AbortSignal) =>
    request<{ intent: string; results: PatientSummary[] }>('GET', `/api/patients/search?q=${encodeURIComponent(q)}`, { token, ...(signal ? { signal } : {}) }),
  createPatient: (token: string, patient: NewPatient) => request<{ patient: PatientSummary; created: boolean }>('POST', '/api/patients', { token, body: patient }),
  readPatient: (token: string, id: string) => request<{ patient: PatientSummary }>('GET', `/api/patients/${id}`, { token }),
  audit: (token: string, limit = 50) => request<{ entries: AuditEntry[] }>('GET', `/api/audit?limit=${limit}`, { token }),
};
