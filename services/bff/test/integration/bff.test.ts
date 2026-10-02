// Kiểm thử tích hợp: BFF + Medplum thật. Cần stack đang chạy (infra/medplum/README.md).
// Tự tạo hai phòng khám riêng cho mỗi lần chạy, không đụng dữ liệu demo.
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { MedplumTenants } from '../../src/medplum.js';
import { SessionService } from '../../src/session.js';
import { parseTenantsFile } from '../../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject } from '../../scripts/medplum-admin.js';

const RUN = Math.random().toString(36).slice(2, 8);
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[randomInt(23)]).join('');
// Họ không trùng ai: so khớp theo tiền tố nên dùng chuỗi ngẫu nhiên.
const FAMILY = `Zq${letters(5)}`;

let app: ReturnType<typeof buildApp>;
const audit = new MemoryAuditSink();
const tokens: Record<string, string> = {};

const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });
const search = async (who: string, q: string) => (await call('GET', `/api/patients/search?q=${encodeURIComponent(q)}`, who)).json() as { intent: string; results: Array<{ id: string; fullName: string; phone?: string }> };

beforeAll(async () => {
  const admin = await adminClient();
  const a = await createTenantProject(admin, 'a', `Kiểm thử A ${RUN}`);
  const b = await createTenantProject(admin, 'b', `Kiểm thử B ${RUN}`);
  const tenants = parseTenantsFile({
    tenants: [a, b],
    users: [
      { id: 'a-owner', name: 'Chủ A', role: 'owner', tenant: 'a' },
      { id: 'a-assistant', name: 'Phụ tá A', role: 'assistant', tenant: 'a' },
      { id: 'b-owner', name: 'Chủ B', role: 'owner', tenant: 'b' },
    ],
  });
  const sessions = new SessionService('i'.repeat(40), 60);
  app = buildApp({ tenants, stores: new MedplumTenants(MEDPLUM_URL, tenants.tenants).store, audit, sessions, logLevel: 'silent' });
  for (const [tenant, user] of [['a', 'a-owner'], ['a', 'a-assistant'], ['b', 'b-owner']] as const) {
    tokens[user] = (await app.inject({ method: 'POST', url: '/api/session', payload: { tenant, userId: user } })).json().token;
  }
});
afterAll(async () => app?.close());

describe('bệnh nhân qua BFF trên Medplum thật', () => {
  const phone = `09${randomInt(0, 1e8).toString().padStart(8, '0')}`;
  const cccd = `000${randomInt(0, 1e9).toString().padStart(9, '0')}`;
  const clientUuid = randomUUID();
  let id = '';

  it('tạo bệnh nhân và gửi lại cùng clientUuid thì không tạo thêm', async () => {
    const payload = { clientUuid, fullName: `${FAMILY} Văn Ân`, phone: `+84 ${phone.slice(1)}`, cccd, birthDate: '1985-03-15', gender: 'male' };
    const first = await call('POST', '/api/patients', 'a-assistant', payload);
    expect(first.statusCode).toBe(201);
    id = first.json().patient.id;
    expect(first.json().patient).toMatchObject({ fullName: `${FAMILY} Văn Ân`, phone, cccdMasked: expect.stringMatching(/^•+\d{4}$/) });
    const second = await call('POST', '/api/patients', 'a-assistant', payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ created: false, patient: { id } });
    expect((await search('a-assistant', FAMILY.toLowerCase())).results).toHaveLength(1);
  });

  it('nhiều yêu cầu đồng thời cùng clientUuid vẫn chỉ ra một bệnh nhân', async () => {
    const family = `Zq${letters(5)}`;
    const uuid = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => call('POST', '/api/patients', 'a-assistant', { clientUuid: uuid, fullName: `${family} Thị Lan` }))
    );
    for (const r of responses) expect([200, 201]).toContain(r.statusCode);
    expect(new Set(responses.map((r) => r.json().patient.id)).size).toBe(1);
    expect((await search('a-assistant', family)).results).toHaveLength(1);
  });

  it.each([
    ['tên không dấu', () => `${FAMILY.toLowerCase()} van an`, 'name'],
    ['tên có dấu', () => `${FAMILY} Văn Ân`, 'name'],
    ['tiền tố của tên', () => FAMILY.slice(0, 5).toLowerCase(), 'name'],
    ['số điện thoại đầy đủ', () => phone, 'phone'],
    ['số điện thoại có +84', () => `+84${phone.slice(1)}`, 'phone'],
    ['4 số cuối', () => phone.slice(-4), 'phone-fragment'],
    ['CCCD', () => cccd, 'cccd'],
  ])('tìm theo %s', async (_label, query, kind) => {
    const found = await search('a-assistant', query());
    expect(found.intent).toBe(kind);
    expect(found.results.map((r) => r.id)).toContain(id);
  });

  it('đọc theo id', async () => {
    const res = await call('GET', `/api/patients/${id}`, 'a-assistant');
    expect(res.statusCode).toBe(200);
    expect(res.json().patient.id).toBe(id);
  });
});

describe('cách ly giữa hai phòng khám', () => {
  it('phòng khám B không tìm thấy, không đọc được bệnh nhân của A', async () => {
    const family = `Zq${letters(5)}`;
    const phone = `09${randomInt(0, 1e8).toString().padStart(8, '0')}`;
    const created = await call('POST', '/api/patients', 'a-assistant', { clientUuid: randomUUID(), fullName: `${family} Minh Quân`, phone });
    const id = created.json().patient.id as string;
    expect((await search('a-assistant', family)).results).toHaveLength(1);
    for (const q of [family, phone, phone.slice(-4)]) {
      expect((await search('b-owner', q)).results.map((r) => r.id)).not.toContain(id);
    }
    expect((await call('GET', `/api/patients/${id}`, 'b-owner')).statusCode).toBe(404);
  });
  it('cùng clientUuid ở hai phòng khám cho hai bệnh nhân khác nhau', async () => {
    const uuid = randomUUID();
    const family = `Zq${letters(5)}`;
    const a = await call('POST', '/api/patients', 'a-owner', { clientUuid: uuid, fullName: `${family} Văn A` });
    const b = await call('POST', '/api/patients', 'b-owner', { clientUuid: uuid, fullName: `${family} Văn B` });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().patient.id).not.toBe(b.json().patient.id);
  });
});

describe('nhật ký truy cập trên dữ liệu thật', () => {
  it('có bản ghi cho đăng nhập, tạo, tìm và đọc; không chứa nội dung truy vấn', async () => {
    const mine = audit.entries.filter((e) => e.tenant === 'a');
    for (const action of ['login', 'create', 'search', 'read'] as const) expect(mine.some((e) => e.action === action)).toBe(true);
    const text = JSON.stringify(audit.entries);
    expect(text).not.toContain(FAMILY);
    const read = mine.find((e) => e.action === 'read');
    expect(read?.resourceIds).toHaveLength(1);
  });
  it('chủ phòng khám xem được nhật ký của chính mình', async () => {
    const res = await call('GET', '/api/audit?limit=20', 'a-owner');
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.length).toBeGreaterThan(0);
  });
});
