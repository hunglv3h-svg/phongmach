import { Writable } from 'node:stream';
import type { NewPatientInput, PatientSummary, SearchIntent } from '@phongmach/fhir-vn-model';
import { MemoryAuditSink, type AuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { SessionService } from '../../src/session.js';
import type { ClinicStore, StoreFactory } from '../../src/store.js';
import { parseTenantsFile } from '../../src/tenants.js';

export const tenantsFile = parseTenantsFile({
  tenants: [
    { slug: 'a', name: 'Phòng khám A', projectId: 'pa', clientId: 'ca', secret: 'sa' },
    { slug: 'b', name: 'Phòng khám B', projectId: 'pb', clientId: 'cb', secret: 'sb' },
  ],
  users: [
    { id: 'a-owner', name: 'Chủ A', role: 'owner', tenant: 'a' },
    { id: 'a-assistant', name: 'Phụ tá A', role: 'assistant', tenant: 'a' },
    { id: 'b-owner', name: 'Chủ B', role: 'owner', tenant: 'b' },
  ],
});

/** Kho giả trong bộ nhớ, tách riêng từng phòng khám, ghi lại những lần được gọi. */
export class FakeStore implements ClinicStore {
  patients = new Map<string, PatientSummary & { clientUuid: string }>();
  searches: SearchIntent[] = [];
  constructor(readonly tenant: string) {}

  async searchPatients(intent: SearchIntent): Promise<PatientSummary[]> {
    this.searches.push(intent);
    if (intent.kind === 'phone') return [...this.patients.values()].filter((p) => p.phone === intent.phone);
    return [...this.patients.values()];
  }
  async createPatient(input: NewPatientInput) {
    const existing = [...this.patients.values()].find((p) => p.clientUuid === input.clientUuid);
    if (existing) return { patient: existing, created: false };
    const patient = { id: crypto.randomUUID(), fullName: input.fullName, clientUuid: input.clientUuid, ...(input.phone ? { phone: input.phone } : {}) };
    this.patients.set(patient.id, patient);
    return { patient, created: true };
  }
  async readPatient(id: string) {
    return this.patients.get(id);
  }
}

export function makeApp(options: { audit?: AuditSink; logStream?: Writable } = {}) {
  const stores = new Map<string, FakeStore>();
  const requested: string[] = [];
  const factory: StoreFactory = async (slug) => {
    requested.push(slug);
    if (!stores.has(slug)) stores.set(slug, new FakeStore(slug));
    return stores.get(slug)!;
  };
  const audit = options.audit ?? new MemoryAuditSink();
  const sessions = new SessionService('x'.repeat(40), 60);
  const app = buildApp({ tenants: tenantsFile, stores: factory, audit, sessions, logLevel: options.logStream ? 'info' : 'silent', ...(options.logStream ? { logStream: options.logStream } : {}) });
  return { app, stores, requested, audit, sessions };
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
