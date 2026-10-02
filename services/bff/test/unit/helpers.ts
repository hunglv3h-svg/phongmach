import { Writable } from 'node:stream';
import type { Icd10Entry } from '@phongmach/catalogs';
import {
  buildCheckIn,
  nextNumber,
  toQueueItem,
  type AllergyView,
  type CheckInInput,
  type HistoryItem,
  type PendingPrescription,
  type PrescriptionDetail,
  type PrescriptionSummary,
  type QueueItem,
  type VisitContext,
  type VisitSummary,
} from '@phongmach/clinical';
import { vnDay } from '@phongmach/clinical';
import { buildPatient, type NewPatientInput, type PatientSummary, type SearchIntent, toPatientSummary } from '@phongmach/fhir-vn-model';
import { MemoryAuditSink, type AuditSink } from '../../src/audit.js';
import { buildApp, type AppDeps } from '../../src/app.js';
import { SessionService } from '../../src/session.js';
import type { ClinicStore, CompleteCommand, CompleteResult, Doctor, FinishedVisit, OpenResult, OutboxJob, StoreFactory } from '../../src/store.js';
import { parseTenantsFile } from '../../src/tenants.js';

export const tenantsFile = parseTenantsFile({
  tenants: [
    { slug: 'a', name: 'Phòng khám A', projectId: 'pa', clientId: 'ca', secret: 'sa' },
    { slug: 'b', name: 'Phòng khám B', projectId: 'pb', clientId: 'cb', secret: 'sb' },
  ],
  users: [
    { id: 'a-owner', name: 'Chủ A', role: 'owner', tenant: 'a', practitionerId: 'pr-a-owner' },
    { id: 'a-doctor', name: 'BS. Hà', role: 'doctor', tenant: 'a', practitionerId: 'pr-a-doctor' },
    { id: 'a-doctor2', name: 'BS. Lan', role: 'doctor', tenant: 'a', practitionerId: 'pr-a-doctor2' },
    { id: 'a-assistant', name: 'Phụ tá A', role: 'assistant', tenant: 'a' },
    { id: 'b-owner', name: 'Chủ B', role: 'owner', tenant: 'b' },
    { id: 'b-doctor', name: 'BS. B', role: 'doctor', tenant: 'b', practitionerId: 'pr-b-doctor' },
  ],
});

interface FakeVisit {
  item: QueueItem;
  clientUuid: string;
  completedBy?: string;
  result?: VisitSummary;
}

/** Kho giả trong bộ nhớ, tách riêng từng phòng khám, ghi lại những lần được gọi. */
export class FakeStore implements ClinicStore {
  patients = new Map<string, PatientSummary & { clientUuid: string }>();
  visits = new Map<string, FakeVisit>();
  allergies = new Map<string, AllergyView & { patientId: string }>();
  history = new Map<string, HistoryItem & { patientId: string }>();
  completions: CompleteCommand[] = [];
  retried: string[] = [];
  searches: SearchIntent[] = [];
  /** Kết quả ép sẵn cho lần hoàn tất kế tiếp (để thử nhánh lỗi). */
  forceComplete?: CompleteResult;
  finished: FinishedVisit[] = [];
  jobs: OutboxJob[] = [];
  claimResult = true;
  outbox: Array<{ op: 'complete' | 'fail'; taskId: string; detail: string; retryable?: boolean }> = [];
  dueError?: Error;

  constructor(readonly tenant: string) {}

  async searchPatients(intent: SearchIntent): Promise<PatientSummary[]> {
    this.searches.push(intent);
    if (intent.kind === 'phone') return [...this.patients.values()].filter((p) => p.phone === intent.phone);
    return [...this.patients.values()];
  }
  async createPatient(input: NewPatientInput) {
    const existing = [...this.patients.values()].find((p) => p.clientUuid === input.clientUuid);
    if (existing) return { patient: existing, created: false };
    const built = buildPatient(input);
    const patient = { ...toPatientSummary({ ...built, id: crypto.randomUUID() }), clientUuid: input.clientUuid };
    this.patients.set(patient.id, patient);
    return { patient, created: true };
  }
  async readPatient(id: string) {
    return this.patients.get(id);
  }
  async updatePatient(id: string, patch: { cccd?: string | undefined; birthDate?: string | undefined }) {
    const p = this.patients.get(id);
    if (!p) return undefined;
    if (patch.cccd) p.cccdMasked = `${patch.cccd.slice(0, 3)}******${patch.cccd.slice(-3)}`;
    if (patch.birthDate) p.birthDate = patch.birthDate;
    return p;
  }

  async checkIn(input: CheckInInput, now: Date) {
    const patient = this.patients.get(input.patientId);
    if (!patient) return undefined;
    const existing = [...this.visits.values()].find((v) => v.clientUuid === input.clientUuid);
    if (existing) return { item: existing.item, created: false };
    const encs = [...this.visits.values()].map((v) => ({ ...buildCheckIn({ ...input, patientId: v.item.patientId }, { day: vnDay(now), number: v.item.number, now }) }));
    const number = nextNumber(encs);
    const enc = { ...buildCheckIn(input, { day: vnDay(now), number, now }), id: crypto.randomUUID() };
    const item = toQueueItem(enc, { ...buildPatient({ clientUuid: input.clientUuid, fullName: patient.fullName }), id: patient.id, ...(patient.birthDate ? { birthDate: patient.birthDate } : {}) })!;
    this.visits.set(item.id, { item, clientUuid: input.clientUuid });
    return { item, created: true };
  }
  async listQueue() {
    return [...this.visits.values()].map((v) => v.item);
  }
  async cancelVisit(id: string) {
    const v = this.visits.get(id);
    if (!v) return 'not-found' as const;
    if (v.item.status !== 'waiting') return 'not-waiting' as const;
    v.item = { ...v.item, status: 'cancelled' };
    return 'ok' as const;
  }
  async openVisit(id: string, doctor: Doctor, now: Date): Promise<OpenResult> {
    const v = this.visits.get(id);
    if (!v) return { kind: 'not-found' };
    if (v.item.status === 'done' || v.item.status === 'cancelled') return { kind: 'closed' };
    if (v.item.status === 'in-exam' && v.item.doctorUserId !== doctor.userId) return { kind: 'taken', doctorName: v.item.doctorName };
    if (v.item.status === 'waiting') v.item = { ...v.item, status: 'in-exam', doctorName: doctor.name, doctorUserId: doctor.userId, calledAt: now.toISOString() };
    return { kind: 'ok', context: (await this.readVisit(id))! };
  }
  async readVisit(id: string): Promise<VisitContext | undefined> {
    const v = this.visits.get(id);
    const patient = v && this.patients.get(v.item.patientId);
    if (!v || !patient) return undefined;
    return {
      visit: v.item,
      patient,
      allergies: [...this.allergies.values()].filter((a) => a.patientId === patient.id),
      history: [...this.history.values()].filter((h) => h.patientId === patient.id),
      previous: [],
    };
  }
  async completeVisit(cmd: CompleteCommand): Promise<CompleteResult> {
    if (this.forceComplete) return this.forceComplete;
    const v = this.visits.get(cmd.encounterId);
    if (!v) return { kind: 'not-found' };
    if (v.completedBy === cmd.clientUuid && v.result) return { kind: 'ok', visit: v.result, replayed: true };
    if (v.item.status === 'done' || v.item.status === 'cancelled') return { kind: 'already-closed' };
    if (v.item.status !== 'in-exam' || v.item.doctorUserId !== cmd.doctor.userId) return { kind: 'not-open' };
    this.completions.push(cmd);
    const rx = cmd.prescription;
    const prescription: PrescriptionSummary | undefined = rx && {
      id: crypto.randomUUID(),
      code: rx.code,
      signedAt: cmd.now.toISOString(),
      signerName: cmd.doctor.name,
      patientId: v.item.patientId,
      lines: rx.lines.map((l) => ({ drug: l.drug.code, name: l.drug.name, unit: l.drug.unit, instruction: l.resolved.instruction, ...(l.resolved.quantity ? { quantity: l.resolved.quantity } : {}) })),
      ...(rx.advice ? { advice: rx.advice } : {}),
      acknowledgements: rx.acks,
      gateway: { taskId: crypto.randomUUID(), status: 'signed', attempts: 0 },
    };
    const visit: VisitSummary = {
      encounterId: v.item.id,
      date: cmd.now.toISOString(),
      specialty: v.item.specialty,
      vitals: cmd.exam.vitals,
      diagnoses: cmd.diagnoses.map((d: Icd10Entry) => ({ code: d.code, name: d.name })),
      ...(prescription ? { prescription } : {}),
    };
    v.item = { ...v.item, status: 'done' };
    v.completedBy = cmd.clientUuid;
    v.result = visit;
    return { kind: 'ok', visit, replayed: false };
  }

  async listAllergies(patientId: string) {
    return [...this.allergies.values()].filter((a) => a.patientId === patientId);
  }
  async addAllergy(patientId: string, input: { clientUuid: string; kind: 'class' | 'ingredient'; value: string; label?: string | undefined }) {
    if (!this.patients.has(patientId)) return undefined;
    const a = { id: crypto.randomUUID(), kind: input.kind, value: input.value, label: input.label ?? input.value, patientId };
    this.allergies.set(a.id, a);
    return a;
  }
  async removeAllergy(patientId: string, id: string) {
    return this.allergies.get(id)?.patientId === patientId && this.allergies.delete(id);
  }
  async listHistory(patientId: string) {
    return [...this.history.values()].filter((h) => h.patientId === patientId);
  }
  async addHistory(patientId: string, input: { clientUuid: string; text: string }) {
    if (!this.patients.has(patientId)) return undefined;
    const h = { id: crypto.randomUUID(), text: input.text, patientId };
    this.history.set(h.id, h);
    return h;
  }
  async removeHistory(patientId: string, id: string) {
    return this.history.get(id)?.patientId === patientId && this.history.delete(id);
  }
  async patientVisits(patientId: string) {
    return [...this.visits.values()].filter((v) => v.item.patientId === patientId && v.result).map((v) => v.result!);
  }

  async readPrescription(id: string): Promise<PrescriptionDetail | undefined> {
    for (const v of this.visits.values()) {
      if (v.result?.prescription?.id === id) {
        return { prescription: v.result.prescription, patient: this.patients.get(v.item.patientId)!, diagnoses: v.result.diagnoses, encounterId: v.item.id };
      }
    }
    return undefined;
  }
  async pendingPrescriptions(): Promise<PendingPrescription[]> {
    return [...this.visits.values()].flatMap((v) => {
      const rx = v.result?.prescription;
      return rx?.gateway && rx.gateway.status !== 'sent' ? [{ prescriptionId: rx.id, code: rx.code, signedAt: rx.signedAt, gateway: rx.gateway }] : [];
    });
  }
  async retryPrescription(id: string) {
    const rx = (await this.readPrescription(id))?.prescription;
    if (!rx) return 'not-found' as const;
    if (rx.gateway?.status === 'sent') return 'not-retryable' as const;
    this.retried.push(id);
    return 'ok' as const;
  }

  async finishedVisits() {
    return { visits: this.finished, truncated: false };
  }

  async dueSends() {
    if (this.dueError) throw this.dueError;
    return this.jobs;
  }
  async claim() {
    return this.claimResult;
  }
  async complete(job: OutboxJob, nationalCode: string) {
    this.outbox.push({ op: 'complete', taskId: job.taskId, detail: nationalCode });
  }
  async fail(job: OutboxJob, error: string, _now: Date, retryable: boolean) {
    this.outbox.push({ op: 'fail', taskId: job.taskId, detail: error, retryable });
  }
}

export function makeApp(options: { audit?: AuditSink; logStream?: Writable; simulator?: AppDeps['simulator']; now?: () => Date; rules?: AppDeps['rules'] } = {}) {
  const stores = new Map<string, FakeStore>();
  const requested: string[] = [];
  const factory: StoreFactory = async (slug) => {
    requested.push(slug);
    if (!stores.has(slug)) stores.set(slug, new FakeStore(slug));
    return stores.get(slug)!;
  };
  const audit = options.audit ?? new MemoryAuditSink();
  const sessions = new SessionService('x'.repeat(40), 60);
  const app = buildApp({
    tenants: tenantsFile,
    stores: factory,
    audit,
    sessions,
    logLevel: options.logStream ? 'info' : 'silent',
    ...(options.logStream ? { logStream: options.logStream } : {}),
    ...(options.simulator ? { simulator: options.simulator } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
  });
  return { app, stores, requested, audit, sessions, factory };
}

export async function login(app: ReturnType<typeof makeApp>['app'], tenant: string, userId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { tenant, userId } });
  if (res.statusCode !== 200) throw new Error(`đăng nhập thử thất bại: ${res.statusCode} ${res.body}`);
  return res.json().token as string;
}

export function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => lines.join('') };
}

/** Các dòng nhật ký đã ghi (chỉ dùng với kho nhật ký trong bộ nhớ của makeApp). */
export const auditEntries = (c: { audit: AuditSink }) => (c.audit as MemoryAuditSink).entries;
