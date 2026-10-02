// BFF giả trong bộ nhớ cho kiểm thử đơn vị của bộ máy đồng bộ (chỉ dùng trong *.test.ts).
// Giữ đúng các hợp đồng mà hàng đợi dựa vào: idempotent theo clientUuid, giữ số tạm nếu còn trống, 409 khi xung đột,
// 422 khi quy tắc kê đơn chặn, 401 khi token hết hạn. Chèn được lỗi: mất mạng, mất phản hồi (máy chủ đã ghi), mã HTTP bất kỳ.
import type { QueueItem } from '@phongmach/clinical';

export type Fault = 'network' | 'lost' | { status: number; body?: unknown };

export interface RecordedRequest {
  method: string;
  path: string;
  token?: string;
  body?: Record<string, unknown>;
}

interface Visit {
  item: QueueItem;
  clientUuid: string;
  completedBy?: string;
  prescriptionId?: string;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeBff {
  readonly requests: RecordedRequest[] = [];
  /** token → người dùng; token không có ở đây trả 401. */
  readonly tokens = new Map<string, { userId: string; name: string }>();
  readonly patients = new Map<string, { id: string; fullName: string; phone?: string }>();
  readonly visits = new Map<string, Visit>();
  readonly completions = new Map<string, Record<string, unknown>>();
  readonly printed: Array<{ id: string; printedAt?: string }> = [];
  /** Dị ứng theo id bệnh nhân (cho nạp trước). */
  readonly allergies = new Map<string, Array<{ id: string; kind: 'class' | 'ingredient'; value: string; label?: string }>>();
  /** Lỗi chèn cho các yêu cầu tới, theo thứ tự; mỗi lỗi dùng một lần cho yêu cầu khớp đầu tiên. */
  readonly faults: Array<{ match: RegExp; fault: Fault }> = [];
  /** Quy tắc kê đơn ở máy chủ: trả về các khóa phải được xác nhận (ví dụ dị ứng phụ tá vừa ghi ở máy khác). */
  rulesRequire: string[] = [];
  /** Cổng chặn: yêu cầu chờ ở đây tới khi kiểm thử mở (tạo đúng khe hở giữa hai tab). */
  gate: Promise<void> | undefined;
  inFlight = 0;

  constructor() {
    this.tokens.set('tok-doc', { userId: 'doc', name: 'BS. Thử' });
  }

  fault(match: RegExp, fault: Fault): void {
    this.faults.push({ match, fault });
  }

  /** Số yêu cầu tới một đường dẫn mang `clientUuid` này. */
  sent(clientUuid: string): number {
    return this.requests.filter((r) => r.body?.['clientUuid'] === clientUuid).length;
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = String(input);
    const method = init.method ?? 'GET';
    const token = (init.headers as Record<string, string> | undefined)?.['authorization']?.replace('Bearer ', '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    this.requests.push({ method, path, ...(token ? { token } : {}), ...(body ? { body } : {}) });
    this.inFlight++;
    try {
      if (this.gate) await this.gate;
      const i = this.faults.findIndex((f) => f.match.test(`${method} ${path}`));
      const fault = i >= 0 ? this.faults.splice(i, 1)[0]!.fault : undefined;
      if (fault === 'network') throw new TypeError('Failed to fetch');
      if (fault && fault !== 'lost') return json(fault.status, fault.body ?? { error: 'error', message: `Lỗi ${fault.status}` });
      const res = this.handle(method, path, token, body);
      // Mất phản hồi: máy chủ đã ghi xong nhưng trình duyệt chỉ thấy lỗi mạng.
      if (fault === 'lost') throw new TypeError('Failed to fetch');
      return res;
    } finally {
      this.inFlight--;
    }
  };

  private handle(method: string, path: string, token: string | undefined, body: Record<string, unknown> | undefined): Response {
    const user = token ? this.tokens.get(token) : undefined;
    if (!user) return json(401, { error: 'unauthenticated' });
    let m: RegExpExecArray | null;

    if (method === 'POST' && path === '/api/patients') {
      const uuid = String(body!['clientUuid']);
      const existing = this.patients.get(uuid);
      if (existing) return json(200, { patient: existing, created: false });
      const patient = { id: crypto.randomUUID(), fullName: String(body!['fullName']), ...(body!['phone'] ? { phone: String(body!['phone']) } : {}) };
      this.patients.set(uuid, patient);
      return json(201, { patient, created: true });
    }

    if (method === 'POST' && path === '/api/queue') {
      const uuid = String(body!['clientUuid']);
      const existing = [...this.visits.values()].find((v) => v.clientUuid === uuid);
      if (existing) return json(200, { item: existing.item, created: false });
      const patient = [...this.patients.values()].find((p) => p.id === body!['patientId']);
      if (!patient) return json(404, { error: 'not-found' });
      const taken = new Set([...this.visits.values()].map((v) => v.item.number));
      const next = Math.max(0, ...taken) + 1;
      const proposed = body!['proposedNumber'] as number | undefined;
      const number = proposed !== undefined && proposed <= next && !taken.has(proposed) ? proposed : next;
      const item: QueueItem = {
        id: crypto.randomUUID(),
        number,
        code: `20261020-${String(number).padStart(3, '0')}`,
        status: 'waiting',
        priority: 'normal',
        specialty: 'noi',
        patientId: patient.id,
        patientName: patient.fullName,
        arrivedAt: String(body!['arrivedAt'] ?? new Date().toISOString()),
      };
      this.visits.set(item.id, { item, clientUuid: uuid });
      return json(201, { item, created: true });
    }

    if (method === 'POST' && (m = /^\/api\/visits\/([^/]+)\/open$/.exec(path))) {
      const v = this.visits.get(m[1]!);
      if (!v) return json(404, { error: 'not-found' });
      if (v.item.status === 'done' || v.item.status === 'cancelled') return json(409, { error: 'closed', message: 'Lượt khám đã kết thúc hoặc đã hủy' });
      if (v.item.status === 'in-exam' && v.item.doctorUserId !== user.userId) return json(409, { error: 'taken', message: `Hồ sơ đang do ${v.item.doctorName} khám` });
      if (v.item.status === 'waiting') v.item = { ...v.item, status: 'in-exam', doctorUserId: user.userId, doctorName: user.name, calledAt: String(body?.['openedAt'] ?? new Date().toISOString()) };
      const patient = [...this.patients.values()].find((p) => p.id === v.item.patientId)!;
      return json(200, { visit: v.item, patient, allergies: [], history: [], previous: [] });
    }

    if (method === 'POST' && (m = /^\/api\/visits\/([^/]+)\/complete$/.exec(path))) {
      const v = this.visits.get(m[1]!);
      if (!v) return json(404, { error: 'not-found' });
      const uuid = String(body!['clientUuid']);
      if (v.completedBy === uuid) return json(200, { ...this.completions.get(uuid), replayed: true });
      if (v.item.status === 'done') return json(409, { error: 'already-closed', message: 'Lượt khám đã được kết thúc' });
      if (v.item.status !== 'in-exam' || v.item.doctorUserId !== user.userId) return json(409, { error: 'not-open', message: 'Chưa mở hồ sơ hoặc hồ sơ do người khác khám' });
      const rx = body!['prescription'] as { acknowledgements: Array<{ key: string }> } | undefined;
      const missing = this.rulesRequire.filter((k) => !rx?.acknowledgements.some((a) => a.key === k));
      if (rx && missing.length) {
        return json(422, { error: 'rules-not-satisfied', blocking: [], unacknowledged: missing.map((key) => ({ key, rule: 'allergy', severity: 'ack', lines: [], message: `Cần xác nhận ${key}` })) });
      }
      v.item = { ...v.item, status: 'done' };
      v.completedBy = uuid;
      const prescription = rx ? { id: crypto.randomUUID(), code: 'PM-261020-AAAAAA', signedAt: new Date().toISOString(), patientId: v.item.patientId, lines: [], acknowledgements: [] } : undefined;
      if (prescription) v.prescriptionId = prescription.id;
      const response = { visit: { encounterId: v.item.id, date: new Date().toISOString(), specialty: 'noi', vitals: {}, diagnoses: [] }, ...(prescription ? { prescription } : {}) };
      this.completions.set(uuid, response);
      return json(201, { ...response, replayed: false });
    }

    if (method === 'GET' && path === '/api/queue') {
      return json(200, { day: '2026-10-20', items: [...this.visits.values()].map((v) => v.item) });
    }

    if (method === 'GET' && path.startsWith('/api/queue/prefetch')) {
      const ids = new URL(path, 'http://x').searchParams.get('patients')?.split(',') ?? [];
      const active = new Set([...this.visits.values()].filter((v) => v.item.status === 'waiting' || v.item.status === 'in-exam').map((v) => v.item.patientId));
      const patients = [...this.patients.values()].filter((p) => active.has(p.id) && ids.includes(p.id)).map((patient) => ({ patient, allergies: this.allergies.get(patient.id) ?? [] }));
      return json(200, { day: '2026-10-20', patients });
    }

    if (method === 'POST' && (m = /^\/api\/prescriptions\/([^/]+)\/printed$/.exec(path))) {
      if (![...this.visits.values()].some((v) => v.prescriptionId === m![1])) return json(404, { error: 'not-found' });
      this.printed.push({ id: m[1]!, ...(body?.['printedAt'] ? { printedAt: String(body['printedAt']) } : {}) });
      return json(200, { ok: true });
    }

    return json(404, { error: 'not-found' });
  }
}

/** Đồng hồ và bộ hẹn giờ ảo: thời gian chỉ trôi khi kiểm thử gọi `advance`. */
export class FakeClock {
  private t: number;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;

  constructor(start = Date.parse('2026-10-20T03:00:00Z')) {
    this.t = start;
  }

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  /** Hẹn giờ đang chờ: còn bao lâu nữa thì chạy (mili giây). */
  pending(): number[] {
    return this.timers.map((t) => t.at - this.t).sort((a, b) => a - b);
  }

  /** Cho thời gian trôi `ms`, chạy các hẹn giờ tới hạn. Trả về số hẹn giờ đã chạy. */
  advance(ms: number): number {
    this.t += ms;
    const due = this.timers.filter((t) => t.at <= this.t);
    this.timers = this.timers.filter((t) => t.at > this.t);
    for (const t of due) t.fn();
    return due.length;
  }
}
