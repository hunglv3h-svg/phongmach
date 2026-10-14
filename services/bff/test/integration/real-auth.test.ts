// Kiểm thử tích hợp XÁC THỰC THẬT trên Medplum thật (T-IDP): đăng nhập mật khẩu + TOTP qua BFF rồi gọi
// route dữ liệu. Chứng minh end-to-end: (B2) tenant đến từ phiên đã ký — token của phòng khám A không đọc
// được bệnh nhân của B kể cả khi nhồi tenant vào request; (B7) completeVisit từ chối khi danh tính người
// ký không khớp người đã mở hồ sơ (danh tính chốt lúc tạo mục, không lấy từ phiên sống).
//
// Cần stack Medplum đang chạy. Lưu ý F5: bộ này KHÔNG đăng nhập Medplum nhiều lần (một lần/khâu dựng).
import { randomUUID } from 'node:crypto';
import { getIcd10 } from '@phongmach/catalogs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { encryptSecret, hashPassword } from '../../src/identity/crypto.js';
import { generateTotp } from '../../src/identity/totp.js';
import { IdentityStore } from '../../src/identity/index.js';
import { MedplumTenants } from '../../src/medplum.js';
import { SessionService } from '../../src/session.js';
import { SqliteSessionStore } from '../../src/sessionStore.js';
import { parseTenantsFile, type Tenant } from '../../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject } from '../../scripts/medplum-admin.js';

const RUN = Math.random().toString(36).slice(2, 8);
const TOTP_ENC_KEY = 'k'.repeat(40);
const KNOWN = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const PASS = 'm@tKhauRatManh123';
const NOW = new Date('2026-10-05T08:00:00Z');

let app: ReturnType<typeof buildApp>;
let sessionStore: SqliteSessionStore;
let tenantA: Tenant;
let stores: MedplumTenants['store'];
const audit = new MemoryAuditSink();
const tokens: Record<string, string> = {};

const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  const admin = await adminClient();
  tenantA = await createTenantProject(admin, 'a', `Auth A ${RUN}`);
  const b = await createTenantProject(admin, 'b', `Auth B ${RUN}`);
  // docA và docA2 cùng tenant 'a' (cho B7: một người mở, người kia không hoàn tất được); docB ở tenant 'b' (cho B2).
  const tenants = parseTenantsFile({
    tenants: [tenantA, b],
    users: [
      { id: 'docA', name: 'BS. A', role: 'doctor', tenant: 'a' },
      { id: 'docA2', name: 'BS. A2', role: 'doctor', tenant: 'a' },
      { id: 'docB', name: 'BS. B', role: 'doctor', tenant: 'b' },
    ],
  });

  sessionStore = new SqliteSessionStore(':memory:');
  const sessions = new SessionService('A'.repeat(40), 15, 'R'.repeat(40), sessionStore, () => NOW);
  const records = await Promise.all(
    [
      { userId: 'docA', loginId: '0900000011', name: 'BS. A', role: 'doctor' as const, tenants: ['a'] },
      { userId: 'docA2', loginId: '0900000013', name: 'BS. A2', role: 'doctor' as const, tenants: ['a'] },
      { userId: 'docB', loginId: '0900000012', name: 'BS. B', role: 'doctor' as const, tenants: ['b'] },
    ].map(async (s) => ({ ...s, passwordHash: await hashPassword(PASS), totpEnc: encryptSecret(KNOWN, TOTP_ENC_KEY), recoveryHashes: [], trustedDeviceEpoch: 0 }))
  );
  const identity = new IdentityStore({ staff: records, totpEncKey: TOTP_ENC_KEY });

  stores = new MedplumTenants(MEDPLUM_URL, tenants.tenants).store;
  app = buildApp({
    mode: 'real',
    tenants,
    stores,
    audit,
    sessions,
    identity,
    sessionStore,
    now: () => NOW,
    logLevel: 'silent',
  });

  // Đăng nhập thật: mật khẩu → TOTP → access token.
  const byLogin: Record<string, string> = { '0900000011': 'docA', '0900000013': 'docA2', '0900000012': 'docB' };
  for (const loginId of Object.keys(byLogin)) {
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId, password: PASS } });
    expect(first.json().mfaRequired).toBe(true);
    const mfa = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken: first.json().mfaToken, code: generateTotp(KNOWN, NOW) } });
    expect(mfa.statusCode).toBe(200);
    tokens[byLogin[loginId]!] = mfa.json().token;
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
  sessionStore?.close();
});

describe('B2 — tenant từ phiên đã ký (xác thực thật, Medplum thật)', () => {
  it('bác sĩ A tạo bệnh nhân; bác sĩ B không đọc được, nhồi tenant vào request cũng không', async () => {
    const family = `Zq${RUN}`;
    const created = await call('POST', '/api/patients', 'docA', { clientUuid: randomUUID(), fullName: `${family} Văn An`, phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` });
    expect(created.statusCode).toBe(201);
    const id = created.json().patient.id as string;

    // Bác sĩ B nhồi ?tenant=a và header x-tenant:a — vẫn chỉ thấy tenant của phiên B.
    const bSees = await app.inject({ method: 'GET', url: `/api/patients/search?q=${family.toLowerCase()}&tenant=a`, headers: { authorization: `Bearer ${tokens['docB']}`, 'x-tenant': 'a' } });
    expect(bSees.json().results.map((r: { id: string }) => r.id)).not.toContain(id);
    expect((await call('GET', `/api/patients/${id}`, 'docB')).statusCode).toBe(404);
    // Bác sĩ A đọc được.
    expect((await call('GET', `/api/patients/${id}`, 'docA')).statusCode).toBe(200);
  });

  it('nhật ký login/ok có userId+tenant; không có loginId/mật khẩu', async () => {
    const logins = audit.entries.filter((e) => e.action === 'login' && e.outcome === 'ok');
    expect(logins.some((e) => e.userId === 'docA' && e.tenant === 'a')).toBe(true);
    const text = JSON.stringify(audit.entries);
    for (const secret of ['0900000011', PASS]) expect(text).not.toContain(secret);
  });
});

// B7 — danh tính người ký được CHỐT lúc tạo mục (so participant.individual.identifier với cmd.doctor.userId),
// KHÔNG lấy từ phiên sống lúc gửi. Chạy trên Medplum thật với xác thực thật (docA, docA2 cùng tenant 'a').
describe('B7 — quyền đồng bộ theo danh tính người ký, chốt lúc tạo mục (xác thực thật, Medplum thật)', () => {
  const newPatient = async (who: string, fullName: string) => {
    const res = await call('POST', '/api/patients', who, { clientUuid: randomUUID(), fullName, phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, birthDate: '1985-03-15', cccd: `000${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}` });
    expect(res.statusCode).toBe(201);
    return res.json().patient.id as string;
  };
  const enqueue = async (who: string, patientId: string) => {
    const res = await call('POST', '/api/queue', who, { clientUuid: randomUUID(), patientId, specialty: 'noi' });
    expect(res.statusCode).toBe(201);
    return res.json().item.id as string;
  };
  const completion = (clientUuid: string) => ({ clientUuid, exam: { reason: 'Đau họng', vitals: { temperatureC: 38 } }, diagnoses: ['J02.9'] });

  it('(a) mục do docA mở: docA2 (cùng tenant, phiên khác) KHÔNG hoàn tất được; docA thì được', async () => {
    const patientId = await newPatient('docA', `Zb${RUN} Văn Mở`);
    const visitId = await enqueue('docA', patientId);
    expect((await call('POST', `/api/visits/${visitId}/open`, 'docA')).statusCode).toBe(200);

    // docA2 đăng nhập thật, phiên hợp lệ, cùng tenant — nhưng danh tính ký (từ phiên sống) KHÔNG khớp người đã mở.
    const byOther = await call('POST', `/api/visits/${visitId}/complete`, 'docA2', completion(randomUUID()));
    expect([byOther.statusCode, byOther.json().error]).toEqual([409, 'not-open']);

    // Lượt khám vẫn đang mở, chưa bị ghi dưới danh tính docA2.
    const store = await stores('a');
    const ctx = await store.readVisit(visitId);
    expect(ctx?.visit.status).toBe('in-exam');
    expect(ctx?.visit.doctorName).toBe('BS. A');

    // Chính người đã mở (docA) hoàn tất được.
    expect((await call('POST', `/api/visits/${visitId}/complete`, 'docA', completion(randomUUID()))).statusCode).toBe(201);
  });

  it('(b) mục mang userId không khớp nhân viên thật (giả lập di trú demo→thật, pre-cutover) → completeVisit TỪ CHỐI, không ghi dưới danh tính phiên sống', async () => {
    const patientId = await newPatient('docA', `Zb${RUN} Văn Cũ`);
    const visitId = await enqueue('docA', patientId);
    expect((await call('POST', `/api/visits/${visitId}/open`, 'docA')).statusCode).toBe(200);

    // Dựng lệnh trực tiếp: danh tính người ký nằm trong payload MỤC (doctor.userId), đây là một userId thời demo
    // không khớp người đã mở (docA). Đây đúng là cách danh tính được chốt lúc tạo mục, không lấy từ phiên sống.
    const store = await stores('a');
    const result = await store.completeVisit({
      clientUuid: randomUUID(),
      encounterId: visitId,
      doctor: { userId: 'demo-pre-cutover', name: 'BS. Demo Cũ', practitionerId: undefined },
      now: NOW,
      exam: { reason: 'Đau họng', vitals: { temperatureC: 38 } },
      diagnoses: [getIcd10('J02.9')!],
    });
    // Bị từ chối: participant của Encounter (docA) không khớp doctor.userId trong payload mục.
    expect(result.kind).toBe('not-open');

    // Không âm thầm ghi dưới danh tính phiên sống: lượt khám vẫn mở, participant vẫn là docA.
    const ctx = await store.readVisit(visitId);
    expect(ctx?.visit.status).toBe('in-exam');
    expect(ctx?.visit.doctorName).toBe('BS. A');
  });
});
