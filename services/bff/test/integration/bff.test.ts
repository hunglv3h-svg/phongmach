// Kiểm thử tích hợp: BFF + Medplum thật. Cần stack đang chạy (infra/medplum/README.md).
// Tự tạo hai phòng khám riêng cho mỗi lần chạy, không đụng dữ liệu demo.
import { randomInt, randomUUID } from 'node:crypto';
import { SEARCH_TAGS } from '@phongmach/fhir-vn-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { MedplumTenants } from '../../src/medplum.js';
import { SessionService } from '../../src/session.js';
import { parseTenantsFile, type Tenant } from '../../src/tenants.js';
import { backfillSearchKeys } from '../../scripts/backfill-search-keys.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient } from '../../scripts/medplum-admin.js';

const RUN = Math.random().toString(36).slice(2, 8);
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[randomInt(23)]).join('');
// Họ không trùng ai: so khớp theo tiền tố nên dùng chuỗi ngẫu nhiên.
const FAMILY = `Zq${letters(5)}`;

let app: ReturnType<typeof buildApp>;
const audit = new MemoryAuditSink();
const tokens: Record<string, string> = {};
/** Tài khoản máy của phòng khám A: để ghi thẳng vào Medplum những hồ sơ không đi qua BFF. */
let tenantA: Tenant;

const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });
const search = async (who: string, q: string) => (await call('GET', `/api/patients/search?q=${encodeURIComponent(q)}`, who)).json() as { intent: string; results: Array<{ id: string; fullName: string; phone?: string }> };

beforeAll(async () => {
  const admin = await adminClient();
  const a = await createTenantProject(admin, 'a', `Kiểm thử A ${RUN}`);
  tenantA = a;
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

// Tiêu chí M0-3: người cần tìm phải có trong 20 kết quả kể cả khi rất nhiều người khác cũng khớp theo cách lỏng hơn.
// Các bài này kiểm trên Medplum thật rằng tính chất đó ĐÚNG với bản đã sửa (Medplum hiểu `_tag` chính xác, AND, OR; khóa được ghi
// và được giữ). Chúng KHÔNG đủ để bắt việc gỡ bản sửa: Medplum không sắp xếp và cắt ở _count, mà phần bị cắt tùy kế hoạch truy vấn
// của Postgres [Đã đo: người cần tìm tạo sau cùng lúc bị bỏ sót, lúc không]. Bài tất định cho phần gộp và xếp hạng: test/unit/search.test.ts.
describe('tìm đúng khi nhiều người cùng khớp (M0-3)', () => {
  const create = async (fullName: string, phone?: string) =>
    (await call('POST', '/api/patients', 'a-assistant', { clientUuid: randomUUID(), fullName, ...(phone ? { phone } : {}) })).json().patient.id as string;
  const patch = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/patients/${id}`, headers: { authorization: `Bearer ${tokens['a-assistant']}` }, payload });
  const endsBeforeMiddle = (results: Array<{ phone?: string }>, digits: string) => {
    const firstMiddle = results.findIndex((r) => !r.phone?.endsWith(digits));
    return firstMiddle === -1 || results.slice(firstMiddle).every((r) => !r.phone?.endsWith(digits));
  };

  describe('đoạn số điện thoại', () => {
    // 4 số không bắt đầu bằng 0 hay 1 và ba số cuối từ 100 trở lên: không trùng phần đuôi 1000–1051 của các số "chứa ở giữa".
    const digits = `${randomInt(2, 10)}${randomInt(100, 1000)}`;
    const first = `037001${digits}`;
    const second = `038002${digits}`;
    let ids: string[] = [];

    beforeAll(async () => {
      const family = `Zq${letters(5)}`;
      // 52 người có 4 số đó ở GIỮA số điện thoại: nhiều hơn số kết quả "chứa" mà BFF lấy về (50).
      for (let i = 0; i < 52; i++) await create(`${family} Thị Giữa`, `09${digits}${1000 + i}`);
      ids = [await create(`${family} Văn Cuối`, first), await create(`${family} Thị Cuối`, second)];
    });

    it('4 số cuối: người có số KẾT THÚC bằng 4 số đó đứng đầu dù hơn 50 số khác chứa chúng', async () => {
      const found = await search('a-assistant', digits);
      expect(found.intent).toBe('phone-fragment');
      expect(found.results).toHaveLength(20);
      expect(found.results.slice(0, 2).map((r) => r.id).sort()).toEqual([...ids].sort());
      expect(endsBeforeMiddle(found.results, digits)).toBe(true);
      expect(found.results.every((r) => r.phone?.includes(digits))).toBe(true);
      expect(new Set(found.results.map((r) => r.id)).size).toBe(20);
    });
    it('5 số cuối: chỉ ra người có số kết thúc đúng bằng cả đoạn, không ra người chỉ chung 4 số cuối', async () => {
      const found = await search('a-assistant', first.slice(-5));
      expect(found.results.map((r) => r.id)).toEqual([ids[0]]);
    });
    it('3 số cuối: người có số kết thúc bằng 3 số đó vẫn đứng đầu', async () => {
      const tail = digits.slice(1);
      const found = await search('a-assistant', tail);
      expect(found.results.slice(0, 2).map((r) => r.id).sort()).toEqual([...ids].sort());
      expect(endsBeforeMiddle(found.results, tail)).toBe(true);
    });
  });

  describe('tên', () => {
    const family = `Zq${letters(5)}`;
    const q = family.toLowerCase();
    let an = '';
    let aan = '';

    beforeAll(async () => {
      // 22 người chỉ khớp ĐẦU TỪ với "an" (Anh): nhiều hơn số kết quả trả về (20).
      for (let i = 0; i < 22; i++) await create(`${family} Thị Anh`);
      an = await create(`${family} Văn An`);
      aan = await create(`${family} Thị Ân`);
    });

    it('người khớp đúng từng từ đứng trước người chỉ khớp đầu từ', async () => {
      const found = await search('a-assistant', `${q} an`);
      expect(found.results).toHaveLength(20);
      expect(found.results.slice(0, 2).map((r) => r.id).sort()).toEqual([an, aan].sort());
      expect(new Set(found.results.map((r) => r.id)).size).toBe(20);
    });
    it('đủ họ tên không dấu: đúng người đó đứng đầu', async () => {
      const found = await search('a-assistant', `${q} van an`);
      expect(found.results[0]?.id).toBe(an);
    });
    it('gõ dở từ cuối vẫn ra theo đầu từ', async () => {
      const found = await search('a-assistant', `${q} thi a`);
      expect(found.results).toHaveLength(20);
      expect(found.results.every((r) => /Thị (Anh|Ân)$/.test(r.fullName))).toBe(true);
    });
    it('sửa hồ sơ (bổ sung CCCD) không làm mất khóa tìm', async () => {
      const cccd = `000${randomInt(0, 1e9).toString().padStart(9, '0')}`;
      expect((await patch(an, { cccd })).statusCode).toBe(200);
      const found = await search('a-assistant', `${q} an`);
      expect(found.results.slice(0, 2).map((r) => r.id).sort()).toEqual([an, aan].sort());
    });
  });

  describe('hồ sơ tạo trước khi có khóa tìm', () => {
    const family = `Zq${letters(5)}`;
    const q = family.toLowerCase();
    const digits = `${randomInt(2, 10)}${randomInt(100, 1000)}`;
    let medplum: Awaited<ReturnType<typeof tenantClient>>;
    let anh = '';
    let an = '';

    beforeAll(async () => {
      // Ghi thẳng vào Medplum, không qua buildPatient: không có meta.tag, như bệnh nhân của bản trước.
      medplum = await tenantClient(MEDPLUM_URL, tenantA);
      const legacy = (given: string[], phone: string) =>
        medplum.createResource({ resourceType: 'Patient', name: [{ use: 'official', family, given, text: [family, ...given].join(' ') }], telecom: [{ system: 'phone', value: phone }] });
      anh = (await legacy(['Thi', 'Anh'], `09${digits}7777`)).id;
      an = (await legacy(['Van', 'An'], `039003${digits}`)).id;
    });

    it('vẫn tìm ra, và người khớp đúng từ, người có số kết thúc bằng 4 số, vẫn đứng trước', async () => {
      expect((await search('a-assistant', `${q} an`)).results.map((r) => r.id)).toEqual([an, anh]);
      expect((await search('a-assistant', digits)).results.map((r) => r.id)).toEqual([an, anh]);
    });
    it('được ghi khóa tìm ngay lần sửa đầu tiên', async () => {
      expect((await medplum.readResource('Patient', an)).meta?.tag ?? []).toEqual([]);
      expect((await patch(an, { birthDate: '1985-03-15' })).statusCode).toBe(200);
      const tags = (await medplum.readResource('Patient', an)).meta?.tag ?? [];
      expect(tags.filter((t) => t.system === SEARCH_TAGS.nameWord).map((t) => t.code)).toEqual([q, 'van', 'an']);
      expect(tags.filter((t) => t.system === SEARCH_TAGS.phoneSuffix).map((t) => t.code)).toEqual([digits]);
    });
    it('ghi bổ sung (backfill): ghi khóa cho hồ sơ còn thiếu, không đổi gì khác; chạy lại thì không ghi gì', async () => {
      const before = await medplum.readResource('Patient', anh);
      expect(before.meta?.tag ?? []).toEqual([]);
      const first = await backfillSearchKeys(medplum);
      expect(first.updated).toBeGreaterThanOrEqual(1);
      expect(first.scanned).toBeGreaterThan(first.updated);
      const after = await medplum.readResource('Patient', anh);
      expect(after.meta?.tag?.map((t) => t.code)).toEqual([q, 'thi', 'anh', `${digits}7777`.slice(-4)]);
      expect({ ...after, meta: undefined }).toEqual({ ...before, meta: undefined });
      expect(await backfillSearchKeys(medplum)).toEqual({ scanned: first.scanned, updated: 0 });
    });
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
