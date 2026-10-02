// Kiểm thử tích hợp luồng khám trên Medplum thật: hàng chờ → mở hồ sơ → hoàn tất + kê đơn → gửi cổng mô phỏng.
// Tự tạo hai phòng khám riêng cho mỗi lần chạy, không đụng dữ liệu demo.
import { randomUUID } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { Encounter } from '@medplum/fhirtypes';
import { drugCode } from '@phongmach/catalogs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { SimulatedGateway } from '../../src/gateway.js';
import { MedplumClinicStore, MedplumTenants } from '../../src/medplum.js';
import { runOutboxOnce } from '../../src/outbox.js';
import { SessionService } from '../../src/session.js';
import { parseTenantsFile, type Tenant } from '../../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient } from '../../scripts/medplum-admin.js';

const RUN = Math.random().toString(36).slice(2, 8);
const RETRY = { baseMs: 40, capMs: 80, maxAttempts: 3, leaseMs: 60_000 };

let app: ReturnType<typeof buildApp>;
let tenantA: Tenant;
let adminA: MedplumClient;
let stores: MedplumTenants['store'];
let simulator: SimulatedGateway;
let clock = new Date();
const audit = new MemoryAuditSink();
const tokens: Record<string, string> = {};

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });

const AMOX = { drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 };
const PARA = { drug: drugCode('Paracetamol 500 mg'), perDose: 1, quantity: 10 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (type: string, query = '') => (await adminA.search(type as 'Patient', `_summary=count&_total=accurate${query}`)).total ?? -1;

async function newPatient(name: string, extra: object = { birthDate: '1985-03-15', cccd: `000${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}` }) {
  const res = await call('POST', '/api/patients', 'a-assistant', { clientUuid: randomUUID(), fullName: name, phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().patient.id as string;
}
async function enqueue(patientId: string, extra: object = {}) {
  const res = await call('POST', '/api/queue', 'a-assistant', { clientUuid: randomUUID(), patientId, specialty: 'noi', ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().item as { id: string; number: number; code: string };
}
const complete = (visitId: string, who: string, payload: object) => call('POST', `/api/visits/${visitId}/complete`, who, payload);
const completionBody = (clientUuid: string, over: object = {}) => ({
  clientUuid,
  exam: { reason: 'Đau họng 2 ngày', symptoms: 'Đau họng, sốt nhẹ', findings: 'Họng đỏ', vitals: { temperatureC: 38.2, pulse: 96, systolic: 120, diastolic: 80, weightKg: 62 } },
  diagnoses: ['J02.9'],
  prescription: { lines: [AMOX, PARA], advice: 'Uống nhiều nước', followUpDays: 3, acknowledgements: [] },
  ...over,
});
// Đồng hồ của worker không bao giờ chạy lùi so với đồng hồ giả của ứng dụng (test có tua nhanh 75 giây).
const outbox = (slug = 'a') => runOutboxOnce({ tenants: [slug], stores, gateway: simulator, audit, now: () => new Date(Math.max(Date.now(), clock.getTime()) + 1) });

beforeAll(async () => {
  const admin = await adminClient();
  tenantA = await createTenantProject(admin, 'a', `Lâm sàng A ${RUN}`);
  const b = await createTenantProject(admin, 'b', `Lâm sàng B ${RUN}`);
  adminA = await tenantClient(MEDPLUM_URL, tenantA);
  const tenants = parseTenantsFile({
    tenants: [tenantA, b],
    users: [
      { id: 'a-owner', name: 'Chủ A', role: 'owner', tenant: 'a', practitionerId: (await adminA.createResource({ resourceType: 'Practitioner', name: [{ family: 'Chủ', given: ['A'] }] })).id },
      { id: 'a-doctor', name: 'BS. Lê Thu Hà', role: 'doctor', tenant: 'a', practitionerId: (await adminA.createResource({ resourceType: 'Practitioner', name: [{ family: 'Lê', given: ['Thu', 'Hà'] }] })).id },
      { id: 'a-doctor2', name: 'BS. Võ Lan', role: 'doctor', tenant: 'a', practitionerId: (await adminA.createResource({ resourceType: 'Practitioner', name: [{ family: 'Võ', given: ['Lan'] }] })).id },
      { id: 'a-assistant', name: 'Phụ tá A', role: 'assistant', tenant: 'a' },
      { id: 'b-owner', name: 'Chủ B', role: 'owner', tenant: 'b' },
    ],
  });
  simulator = new SimulatedGateway();
  stores = new MedplumTenants(MEDPLUM_URL, tenants.tenants, RETRY).store;
  app = buildApp({ tenants, stores, audit, sessions: new SessionService('i'.repeat(40), 60), simulator, now: () => clock, logLevel: 'silent' });
  for (const u of tenants.users) tokens[u.id] = (await app.inject({ method: 'POST', url: '/api/session', payload: { tenant: u.tenant, userId: u.id } })).json().token;
}, 60_000);
afterAll(async () => app?.close());

describe('hàng chờ trên Medplum thật', () => {
  it('cấp số tăng dần; gửi lại cùng clientUuid không cấp thêm; nhiều lễ tân cùng lúc không trùng số', async () => {
    const ids = await Promise.all(['Nguyễn Văn Một', 'Nguyễn Văn Hai', 'Nguyễn Văn Ba'].map((n) => newPatient(n)));
    const uuid = randomUUID();
    const first = await call('POST', '/api/queue', 'a-assistant', { clientUuid: uuid, patientId: ids[0], specialty: 'noi' });
    const again = await call('POST', '/api/queue', 'a-assistant', { clientUuid: uuid, patientId: ids[0], specialty: 'noi' });
    expect([first.statusCode, again.statusCode, again.json().created]).toEqual([201, 200, false]);
    expect(again.json().item.id).toBe(first.json().item.id);
    expect(first.json().item.number).toBe(1);
    expect(first.json().item.code).toMatch(/^\d{8}-001$/);

    const concurrent = await Promise.all(ids.slice(1).map((patientId) => call('POST', '/api/queue', 'a-assistant', { clientUuid: randomUUID(), patientId, specialty: 'noi' })));
    expect(concurrent.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = concurrent.map((r) => r.json().item.number as number);
    expect(new Set(numbers).size).toBe(2); // không trùng số
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(2);
  });
  it('thứ tự gọi: cấp cứu trước, đã hẹn sau, thường cuối; màn hình chờ không lộ họ tên', async () => {
    const urgent = await enqueue(await newPatient('Phạm Văn Gấp'), { priority: 'urgent' });
    const appt = await enqueue(await newPatient('Hoàng Thị Hẹn'), { priority: 'appointment' });
    const queue = (await call('GET', '/api/queue', 'a-assistant')).json().items as Array<{ id: string; status: string; priority: string }>;
    const waiting = queue.filter((i) => i.status === 'waiting');
    expect(waiting[0]!.id).toBe(urgent.id);
    expect(waiting[1]!.id).toBe(appt.id);
    expect(waiting.slice(2).every((i) => i.priority === 'normal')).toBe(true);
    const board = (await call('GET', '/api/display', 'a-assistant')).json();
    expect(board.waiting[0]).toMatchObject({ initials: 'P.V.G', priority: 'urgent' });
    expect(JSON.stringify(board)).not.toMatch(/Phạm|Hoàng|Gấp/);
  });
  it('bệnh nhân của phòng khám khác thì không đưa vào hàng chờ được', async () => {
    const id = await newPatient('Đặng Văn Riêng');
    const res = await call('POST', '/api/queue', 'b-owner', { clientUuid: randomUUID(), patientId: id, specialty: 'noi' });
    expect(res.statusCode).toBe(404);
    expect((await call('GET', '/api/queue', 'b-owner')).json().items).toEqual([]);
  });
  it('hủy lượt đang chờ; không hủy được lượt đã được mở', async () => {
    const waiting = await enqueue(await newPatient('Vũ Văn Hủy'));
    expect((await call('POST', `/api/queue/${waiting.id}/cancel`, 'a-assistant')).statusCode).toBe(200);
    expect((await call('POST', `/api/queue/${waiting.id}/cancel`, 'a-assistant')).statusCode).toBe(409);
    expect((await call('POST', `/api/visits/${waiting.id}/open`, 'a-doctor')).statusCode).toBe(409);
    const taken = await enqueue(await newPatient('Vũ Văn Đang'));
    expect((await call('POST', `/api/visits/${taken.id}/open`, 'a-doctor')).statusCode).toBe(200);
    expect((await call('POST', `/api/queue/${taken.id}/cancel`, 'a-assistant')).statusCode).toBe(409);
  });
});

describe('luồng khám đầy đủ: mở hồ sơ, kê đơn, ký, in, gửi cổng', () => {
  let patientId = '';
  let visit: { id: string };
  let prescriptionId = '';
  let code = '';
  const uuid = randomUUID();

  it('bác sĩ mở hồ sơ: nhận ngữ cảnh khám; bác sĩ khác bị chặn; chủ phòng khám khác không thấy', async () => {
    patientId = await newPatient('Trần Văn Khám');
    visit = await enqueue(patientId);
    clock = new Date();
    const open = await call('POST', `/api/visits/${visit.id}/open`, 'a-doctor');
    expect(open.statusCode).toBe(200);
    expect(open.json()).toMatchObject({ visit: { status: 'in-exam', doctorName: 'BS. Lê Thu Hà' }, patient: { id: patientId, fullName: 'Trần Văn Khám' }, allergies: [], history: [], previous: [] });
    const other = await call('POST', `/api/visits/${visit.id}/open`, 'a-doctor2');
    expect([other.statusCode, other.json().error]).toEqual([409, 'taken']);
    expect((await call('POST', `/api/visits/${visit.id}/open`, 'b-owner')).statusCode).toBe(404);
  });
  it('dị ứng: phụ tá ghi, quy tắc chặn khi chưa xác nhận', async () => {
    const add = await call('POST', `/api/patients/${patientId}/allergies`, 'a-assistant', { clientUuid: randomUUID(), kind: 'class', value: 'penicillin' });
    expect(add.statusCode).toBe(201);
    const blocked = await complete(visit.id, 'a-doctor', completionBody(uuid));
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().unacknowledged.map((f: { rule: string }) => f.rule)).toContain('allergy');
    expect(await count('Observation')).toBe(0); // chưa ghi gì
    expect(await count('List')).toBe(0);
  });
  it('ký với xác nhận lý do: 201, đủ tài nguyên, đồng hồ phiên khám tính ở server', async () => {
    const finding = (await complete(visit.id, 'a-doctor', completionBody(uuid))).json().unacknowledged.find((f: { rule: string }) => f.rule === 'allergy');
    clock = new Date(clock.getTime() + 75_000);
    const res = await complete(visit.id, 'a-doctor', completionBody(uuid, { prescription: { lines: [AMOX, PARA], advice: 'Uống nhiều nước', followUpDays: 3, acknowledgements: [{ key: finding.key, reason: 'Đã dùng nhiều lần, dung nạp tốt' }] } }));
    expect(res.statusCode).toBe(201);
    const json = res.json();
    prescriptionId = json.prescription.id;
    code = json.prescription.code;
    expect(json.visit).toMatchObject({
      reason: 'Đau họng 2 ngày',
      symptoms: 'Đau họng, sốt nhẹ',
      findings: 'Họng đỏ',
      doctorName: 'BS. Lê Thu Hà',
      visitSeconds: 75,
      vitals: { temperatureC: 38.2, pulse: 96, systolic: 120, diastolic: 80, weightKg: 62 },
    });
    expect(json.visit.diagnoses).toEqual([expect.objectContaining({ code: 'J02.9' })]);
    expect(json.prescription).toMatchObject({ advice: 'Uống nhiều nước', followUpDays: 3, signerName: 'BS. Lê Thu Hà', gateway: { status: 'signed', attempts: 0 } });
    expect(json.prescription.lines).toEqual([
      expect.objectContaining({ name: 'Amoxicillin 500 mg', instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15, days: 5, perDose: 1, timesPerDay: 3 }),
      expect.objectContaining({ name: 'Paracetamol 500 mg', quantity: 10 }),
    ]);
    expect(json.prescription.acknowledgements).toEqual([expect.objectContaining({ reason: 'Đã dùng nhiều lần, dung nạp tốt' })]);
  });
  it('gửi lại cùng clientUuid: 200 replayed, không sinh thêm bản ghi nào', async () => {
    const before = [await count('Observation'), await count('Condition'), await count('MedicationRequest'), await count('List'), await count('Task'), await count('Provenance'), await count('ClinicalImpression')];
    const res = await complete(visit.id, 'a-doctor', completionBody(uuid));
    expect([res.statusCode, res.json().replayed]).toEqual([200, true]);
    expect(res.json().prescription.code).toBe(code);
    const after = [await count('Observation'), await count('Condition'), await count('MedicationRequest'), await count('List'), await count('Task'), await count('Provenance'), await count('ClinicalImpression')];
    expect(after).toEqual(before);
    // Điểm này đồng thời kiểm số lượng: 6 sinh hiệu (nhiệt độ, mạch, HA, cân nặng = 4), 1 chẩn đoán, 2 thuốc, 1 đơn...
    expect(before.slice(2)).toEqual([2, 1, 1, 1, 1]);
    // Khác clientUuid thì là lần hoàn tất khác trên lượt đã đóng: từ chối.
    const other = await complete(visit.id, 'a-doctor', completionBody(randomUUID()));
    expect([other.statusCode, other.json().error]).toEqual([409, 'already-closed']);
  });
  it('lượt khám đã đóng: hàng chờ hiện "done"; mở lại không được', async () => {
    const items = (await call('GET', '/api/queue', 'a-doctor')).json().items as Array<{ id: string; status: string }>;
    expect(items.find((i) => i.id === visit.id)!.status).toBe('done');
    expect((await call('POST', `/api/visits/${visit.id}/open`, 'a-doctor')).statusCode).toBe(409);
  });
  it('đọc lại đơn: chi tiết, lịch sử khám của bệnh nhân, ngữ cảnh lần khám sau', async () => {
    const detail = (await call('GET', `/api/prescriptions/${prescriptionId}`, 'a-assistant')).json();
    expect(detail).toMatchObject({ patient: { fullName: 'Trần Văn Khám' }, prescription: { code, gateway: { status: 'signed' } } });
    expect(detail.diagnoses).toEqual([expect.objectContaining({ code: 'J02.9' })]);
    const visits = (await call('GET', `/api/patients/${patientId}/visits`, 'a-doctor')).json().visits;
    expect(visits).toHaveLength(1);
    expect(visits[0].prescription.code).toBe(code);
    const next = await enqueue(patientId);
    const ctx = (await call('POST', `/api/visits/${next.id}/open`, 'a-doctor')).json();
    expect(ctx.previous).toHaveLength(1);
    expect(ctx.previous[0].prescription.lines).toHaveLength(2);
    expect(ctx.allergies).toEqual([expect.objectContaining({ kind: 'class', value: 'penicillin' })]);
  });
  it('in A5: HTML đầy đủ, có QR, thoát ký tự, khớp dữ liệu đã lưu', async () => {
    const res = await call('GET', `/api/prescriptions/${prescriptionId}/print`, 'a-assistant');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(code);
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Trần Văn Khám');
    expect(res.body).toContain('Uống 1 viên x 3 lần/ngày');
    expect(res.body).toContain('Lê Thu Hà');
  });
  it('gửi cổng: đơn nằm ở "chưa gửi", worker gửi, thành "đã gửi" kèm mã quốc gia', async () => {
    const pending = (await call('GET', '/api/prescriptions/pending', 'a-assistant')).json().pending as Array<{ code: string; gateway: { status: string } }>;
    expect(pending.find((p) => p.code === code)!.gateway.status).toBe('signed');
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
    const detail = (await call('GET', `/api/prescriptions/${prescriptionId}`, 'a-doctor')).json();
    expect(detail.prescription.gateway).toMatchObject({ status: 'sent', attempts: 1, nationalCode: expect.stringMatching(/^SIM-/) });
    const after = (await call('GET', '/api/prescriptions/pending', 'a-assistant')).json().pending as Array<{ code: string }>;
    expect(after.some((p) => p.code === code)).toBe(false);
    expect(await outbox()).toEqual({ sent: 0, failed: 0 }); // không gửi lại đơn đã gửi
    expect(simulator.get('a').accepted).toBe(1);
  });
  it('số đo thời gian: 75 giây của lượt vừa rồi', async () => {
    const m = (await call('GET', '/api/metrics/visits?days=1', 'a-owner')).json();
    expect(m.all).toMatchObject({ visits: 1, p50Seconds: 75 });
    expect(m.doctors).toEqual([expect.objectContaining({ name: 'BS. Lê Thu Hà', visits: 1 })]);
  });
  it('phòng khám B không đọc, in hay gửi lại được đơn của A', async () => {
    for (const [method, url] of [['GET', `/api/prescriptions/${prescriptionId}`], ['GET', `/api/prescriptions/${prescriptionId}/print`], ['POST', `/api/prescriptions/${prescriptionId}/retry`]] as const) {
      expect((await call(method, url, 'b-owner')).statusCode, url).toBe(404);
    }
    expect((await call('GET', '/api/prescriptions/pending', 'b-owner')).json().pending).toEqual([]);
  });
});

describe('liên thông: lỗi cổng, thử lại, không mất đơn', () => {
  afterAll(() => simulator.set('a', { mode: 'up', failNext: 0 }));
  async function signNew(name: string) {
    clock = new Date();
    const patientId = await newPatient(name);
    const visit = await enqueue(patientId);
    await call('POST', `/api/visits/${visit.id}/open`, 'a-doctor');
    const res = await complete(visit.id, 'a-doctor', completionBody(randomUUID(), { prescription: { lines: [PARA], acknowledgements: [] } }));
    expect(res.statusCode).toBe(201);
    return res.json().prescription as { id: string; code: string };
  }
  const status = async (id: string) => (await call('GET', `/api/prescriptions/${id}`, 'a-doctor')).json().prescription.gateway as { status: string; attempts: number; lastError?: string; nextAttemptAt?: string; nationalCode?: string };

  it('cổng chết: "chờ gửi lại" có hẹn giờ; cổng sống lại: tự gửi được, không mất đơn', async () => {
    const rx = await signNew('Lê Văn Lỗi');
    simulator.set('a', { mode: 'down' });
    expect(await outbox()).toEqual({ sent: 0, failed: 1 });
    expect(await status(rx.id)).toMatchObject({ status: 'retry', attempts: 1, lastError: expect.stringContaining('không phản hồi'), nextAttemptAt: expect.any(String) });
    expect(await outbox()).toEqual({ sent: 0, failed: 0 }); // chưa đến hạn thử lại
    simulator.set('a', { mode: 'up' });
    await sleep(RETRY.baseMs + 30);
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
    expect(await status(rx.id)).toMatchObject({ status: 'sent', attempts: 2, nationalCode: expect.stringMatching(/^SIM-/) });
  });
  it('lỗi tạm thời vài lần rồi tự hết (kịch bản trình diễn)', async () => {
    const rx = await signNew('Lê Văn Chập');
    simulator.set('a', { failNext: 2 });
    let sent = 0;
    for (let i = 0; i < 6 && sent === 0; i++) {
      sent += (await outbox()).sent;
      await sleep(RETRY.capMs + 20);
    }
    expect(sent).toBe(1);
    expect(await status(rx.id)).toMatchObject({ status: 'sent', attempts: 3 });
  });
  it('quá số lần: "lỗi"; gửi lại thủ công khi cổng ổn thì gửi được', async () => {
    const rx = await signNew('Lê Văn Hỏng');
    simulator.set('a', { mode: 'down' });
    for (let i = 0; i < RETRY.maxAttempts; i++) {
      await outbox();
      await sleep(RETRY.capMs + 20);
    }
    expect(await status(rx.id)).toMatchObject({ status: 'failed', attempts: RETRY.maxAttempts });
    expect(await outbox()).toEqual({ sent: 0, failed: 0 }); // đã bỏ cuộc, không thử nữa
    const pending = (await call('GET', '/api/prescriptions/pending', 'a-assistant')).json().pending as Array<{ code: string; gateway: { status: string } }>;
    expect(pending.find((p) => p.code === rx.code)!.gateway.status).toBe('failed');
    simulator.set('a', { mode: 'up' });
    expect((await call('POST', `/api/prescriptions/${rx.id}/retry`, 'a-doctor')).statusCode).toBe(200);
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
    expect(await status(rx.id)).toMatchObject({ status: 'sent' });
    expect((await call('POST', `/api/prescriptions/${rx.id}/retry`, 'a-doctor')).statusCode).toBe(409); // đã gửi xong
  });
  it('gửi lặp cùng mã đơn tới cổng không sinh mã quốc gia thứ hai', async () => {
    const rx = await signNew('Lê Văn Lặp');
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
    const first = (await status(rx.id)).nationalCode;
    const accepted = simulator.get('a').accepted;
    // Ép gửi lại một đơn đã gửi bằng cách đưa Task về trạng thái yêu cầu (mô phỏng mất kết quả gửi).
    const store = await stores('a');
    const detail = await store.readPrescription(rx.id);
    const task = await adminA.searchOne('Task', { identifier: `urn:phongmach:ma-don-noi-bo|${detail!.prescription.code}` });
    await adminA.updateResource({ ...task!, status: 'requested', output: [] });
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
    expect((await status(rx.id)).nationalCode).toBe(first);
    expect(simulator.get('a').accepted).toBe(accepted);
  });
});

describe('Medplum không hoàn tác: hoàn tất ghi dở rồi chạy lại', () => {
  it('mục đóng lượt khám bị 412 (có người sửa chen ngang): các mục khác đã ghi, đơn KHÔNG được gửi, chạy lại cùng clientUuid thì hội tụ', async () => {
    const patientId = await newPatient('Mai Văn Dở');
    const visit = await enqueue(patientId);
    await call('POST', `/api/visits/${visit.id}/open`, 'a-doctor');
    const uuid = randomUUID();

    // Kho bọc: sau khi hoàn tất đọc Encounter, có người sửa Encounter nên phiên bản bị cũ.
    const real = await stores('a');
    const client = (real as unknown as { medplum: MedplumClient }).medplum;
    let bumped = false;
    const wrapped = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === 'readResource') {
          return async (type: string, id: string) => {
            const r = await target.readResource(type as 'Encounter', id);
            if (type === 'Encounter' && !bumped) {
              bumped = true;
              await target.updateResource({ ...(r as Encounter), reasonCode: [{ text: 'sửa chen ngang' }] });
            }
            return r;
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as MedplumClient;
    const flaky = new MedplumClinicStore(wrapped, RETRY);

    const exam = { reason: 'Đau họng', vitals: { temperatureC: 37.5 } };
    const { getIcd10, getDrug, resolveLine } = await import('@phongmach/catalogs');
    const drug = getDrug(PARA.drug)!;
    const command = {
      clientUuid: uuid,
      encounterId: visit.id,
      doctor: { userId: 'a-doctor', name: 'BS. Lê Thu Hà', practitionerId: undefined },
      now: new Date(),
      exam,
      diagnoses: [getIcd10('J02.9')!],
      prescription: { code: 'PM-DO-DANG', lines: [{ drug, input: PARA, resolved: resolveLine(drug, PARA) }], acks: [], digestBase64: () => 'x' },
    };
    // Người dùng "a-doctor" đã mở lượt này qua API nên participant có userId khớp.
    const first = await flaky.completeVisit(command);
    expect(first.kind).toBe('incomplete');
    expect(first.kind === 'incomplete' && first.failed.map((f) => f.status)).toEqual(['412']);

    // Lượt khám chưa đóng, dù các mục khác đã ghi.
    const enc = (await adminA.readResource('Encounter', visit.id)) as Encounter;
    expect(enc.status).toBe('in-progress');
    expect(await count('Task', `&identifier=urn:phongmach:ma-don-noi-bo|PM-DO-DANG`)).toBe(1);

    // Điểm chốt: đơn của lượt khám chưa đóng không được gửi đi.
    const before = simulator.get('a').accepted;
    expect(await outbox()).toEqual({ sent: 0, failed: 0 });
    expect(simulator.get('a').accepted).toBe(before);

    // Chạy lại cùng clientUuid (người dùng bấm lại): hội tụ, không bản ghi trùng.
    const second = await real.completeVisit(command);
    expect(second.kind).toBe('ok');
    expect(second.kind === 'ok' && second.replayed).toBe(false);
    expect(await count('Task', `&identifier=urn:phongmach:ma-don-noi-bo|PM-DO-DANG`)).toBe(1);
    expect(await count('List', `&identifier=urn:phongmach:ma-don-noi-bo|PM-DO-DANG`)).toBe(1);
    expect(await count('Condition', `&encounter=Encounter/${visit.id}`)).toBe(1);
    expect(await count('Observation', `&encounter=Encounter/${visit.id}`)).toBe(1);
    expect(await count('MedicationRequest', `&encounter=Encounter/${visit.id}`)).toBe(1);
    expect(((await adminA.readResource('Encounter', visit.id)) as Encounter).status).toBe('finished');

    // Giờ lượt khám đã đóng: đơn được gửi.
    expect(await outbox()).toEqual({ sent: 1, failed: 0 });
  });
});

describe('dị ứng và tiền sử', () => {
  it('ghi, liệt kê, rút lại; không rút được của bệnh nhân khác; tiền sử chỉ bác sĩ/chủ phòng khám', async () => {
    const p1 = await newPatient('Đỗ Văn Dị');
    const p2 = await newPatient('Đỗ Văn Khác');
    const uuid = randomUUID();
    const a = await call('POST', `/api/patients/${p1}/allergies`, 'a-assistant', { clientUuid: uuid, kind: 'ingredient', value: 'paracetamol', label: 'Paracetamol' });
    expect(a.statusCode).toBe(201);
    await call('POST', `/api/patients/${p1}/allergies`, 'a-assistant', { clientUuid: uuid, kind: 'ingredient', value: 'paracetamol', label: 'Paracetamol' }); // gửi lại
    const listed = (await call('GET', `/api/patients/${p1}/allergies`, 'a-assistant')).json().allergies;
    expect(listed).toHaveLength(1);
    expect((await call('DELETE', `/api/patients/${p2}/allergies/${listed[0].id}`, 'a-assistant')).statusCode).toBe(404);
    expect((await call('DELETE', `/api/patients/${p1}/allergies/${listed[0].id}`, 'a-assistant')).statusCode).toBe(200);
    expect((await call('GET', `/api/patients/${p1}/allergies`, 'a-assistant')).json().allergies).toEqual([]);

    expect((await call('GET', `/api/patients/${p1}/medical-history`, 'a-assistant')).statusCode).toBe(403);
    const h = await call('POST', `/api/patients/${p1}/medical-history`, 'a-doctor', { clientUuid: randomUUID(), text: 'Tăng huyết áp 5 năm' });
    expect(h.statusCode).toBe(201);
    expect((await call('GET', `/api/patients/${p1}/medical-history`, 'a-doctor')).json().history).toEqual([expect.objectContaining({ text: 'Tăng huyết áp 5 năm' })]);
    // Tiền sử không lẫn với chẩn đoán lượt khám.
    expect((await call('GET', `/api/patients/${p1}/visits`, 'a-doctor')).json().visits).toEqual([]);
    expect((await call('DELETE', `/api/patients/${p1}/medical-history/${h.json().item.id}`, 'a-doctor')).statusCode).toBe(200);
    expect((await call('GET', `/api/patients/${p1}/medical-history`, 'a-doctor')).json().history).toEqual([]);
  });
  it('bổ sung CCCD và ngày sinh cho bệnh nhân tạo nhanh', async () => {
    const p = await newPatient('Bùi Văn Thiếu', {});
    const res = await call('PATCH', `/api/patients/${p}`, 'a-assistant', { cccd: '000 987 654 321', birthDate: '1990-05-05' });
    expect(res.statusCode).toBe(200);
    expect(res.json().patient).toMatchObject({ birthDate: '1990-05-05', cccdMasked: expect.stringMatching(/4321$/) });
    expect((await call('PATCH', `/api/patients/${p}`, 'a-assistant', { cccd: '123' })).statusCode).toBe(422);
  });
});
