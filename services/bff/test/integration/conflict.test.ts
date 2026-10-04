// Xung đột giao dịch khi nhiều lời ghi tới cùng lúc (kế hoạch, F13), trên Medplum thật.
// Tự tạo sáu phòng khám riêng cho mỗi lần chạy (hạn mức FHIR tính theo tài khoản máy của từng phòng khám).
// Kho dùng client Medplum bọc ngoài để:
//   (a) đếm xung đột THẬT mà Medplum trả về (các bài tái hiện chỉ có nghĩa khi con số này lớn hơn 0);
//   (b) chèn lỗi đúng hình dạng đã đo vào một lời tạo có điều kiện hoặc một mục của gói (các bài tất định).
// Các bài tất định đếm đúng số lần gọi chỉ ở chỗ mọi lần gọi đều bị chèn lỗi (không tới Medplum). Chỗ nào có lời gọi thật theo sau
// thì chỉ đòi "ít nhất": tệp kiểm thử khác chạy song song có thể gây thêm một xung đột thật, và BFF phải thử lại cả lần đó.
import { randomUUID } from 'node:crypto';
import { OperationOutcomeError, type MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, Encounter, OperationOutcome, Resource } from '@medplum/fhirtypes';
import { drugCode } from '@phongmach/catalogs';
import { SYSTEMS, clientUuidQuery } from '@phongmach/fhir-vn-model';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from '../../src/audit.js';
import { buildApp } from '../../src/app.js';
import { DEFAULT_CONFLICT_RETRY, type ConflictRetry } from '../../src/conflict.js';
import { SimulatedGateway } from '../../src/gateway.js';
import { MedplumClinicStore, MedplumTenants } from '../../src/medplum.js';
import { runOutboxOnce } from '../../src/outbox.js';
import { SessionService } from '../../src/session.js';
import { parseTenantsFile, type Tenant } from '../../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient } from '../../scripts/medplum-admin.js';

const RUN = Math.random().toString(36).slice(2, 8);
/** Số lời tạo bệnh nhân cùng lúc mỗi vòng và số vòng tối đa của bài tái hiện (hạn mức một tài khoản máy: 50.000 điểm/phút). */
const N = 20;
const MAX_ROUNDS = 6;
/** Số lượt khám ký cùng lúc mỗi vòng và số vòng tối đa; mỗi vòng một phòng khám riêng (z0, z1, z2). Đã đo: ở 5 lượt có vòng không gặp xung đột nào. */
const M = 12;
const MAX_SIGN_ROUNDS = 3;

// x: lời tạo đơn lẻ (bệnh nhân, cấp số, dị ứng, tiền sử); y, w: hoàn tất lượt khám, chèn lỗi; z0–z2: hoàn tất lượt khám cùng lúc.
const SLUGS = ['x', 'y', 'w', 'z0', 'z1', 'z2'] as const;
type Slug = (typeof SLUGS)[number];

let app: ReturnType<typeof buildApp>;
const clinics = {} as Record<Slug, Tenant>;
const direct = {} as Record<Slug, MedplumClient>;
const stores = {} as Record<string, MedplumClinicStore>;
const tokens: Record<string, string> = {};
const audit = new MemoryAuditSink();
const simulator = new SimulatedGateway();

/** Những gì lớp bọc quan sát và chèn. */
const tap = {
  /** Xung đột thật Medplum trả về cho một lời tạo có điều kiện, và mã PostgreSQL đi kèm. */
  seen: 0,
  codes: new Set<string>(),
  /** Mục 409 thật trong phản hồi của một gói, và mã PostgreSQL đi kèm. */
  entrySeen: 0,
  entryCodes: new Set<string>(),
  /** Loại tài nguyên của từng lời tạo có điều kiện kho đã gọi, và các loại trong từng gói kho đã gửi (kể cả lần bị chèn lỗi). */
  calls: [] as string[],
  batches: [] as string[][],
  /** Số lỗi đã chèn kể từ lần đặt lại gần nhất. */
  injected: 0,
  /** Chèn `left` lần xung đột (mã `pg`) vào lời tạo có điều kiện của loại tài nguyên `type`: lời đó không tới Medplum. */
  inject: undefined as { type: string; left: number; pg: string } | undefined,
  /** Chèn vào `left` gói kế tiếp có mục loại `type`: mục đó không được ghi và mang trạng thái `status` (kèm mã `pg` nếu có). */
  injectEntry: undefined as { type: string; left: number; status: string; pg?: string } | undefined,
  /** Ném xung đột (mã `pg`) cho cả `left` gói kế tiếp: gói không tới Medplum. */
  injectBatch: undefined as { left: number; pg: string } | undefined,
  /** Số lần một "lễ tân khác" lấy đúng số đang được cấp ngay trước lời cấp số của kho. */
  steal: 0,
  /** Lần thử lại và số mili giây đã chờ, do kho báo. */
  retried: [] as Array<{ what: string; attempt: number }>,
  sleeps: [] as number[],
  reset() {
    this.calls = [];
    this.batches = [];
    this.injected = 0;
    this.inject = undefined;
    this.injectEntry = undefined;
    this.injectBatch = undefined;
    this.steal = 0;
    this.retried = [];
    this.sleeps = [];
  },
};

// Hình dạng Medplum 5.2.0 trả về khi giao dịch `serializable` hỏng ở lần thử cuối (hai bài tái hiện bên dưới kiểm lại mã 40001).
const outcomeOf = (pg?: string): OperationOutcome => ({
  resourceType: 'OperationOutcome',
  id: 'conflict',
  issue: [{ severity: 'error', code: 'conflict', details: { ...(pg ? { coding: [{ code: pg }] } : {}), text: 'could not serialize access due to read/write dependencies among transactions' } }],
});
const pgConflict = (pg: string) => new OperationOutcomeError(outcomeOf(pg));
// Nhận diện ở lớp bọc không dùng mã của BFF: bài phải đếm được xung đột cả khi biện pháp bị gỡ.
const pgCodes = (outcome: unknown) => ((outcome as OperationOutcome | undefined)?.issue?.[0]?.details?.coding ?? []).map((c) => c.code ?? '?');

function tapped(client: MedplumClient): MedplumClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'createResourceIfNoneExist') {
        return async (resource: Resource, query: string) => {
          tap.calls.push(resource.resourceType);
          const inj = tap.inject;
          if (inj && inj.type === resource.resourceType && inj.left > 0) {
            inj.left--;
            tap.injected++;
            throw pgConflict(inj.pg);
          }
          if (resource.resourceType === 'Encounter' && tap.steal > 0) {
            // Một lễ tân khác lấy đúng số này trước: một lượt khám khác cùng mã lượt, khác clientUuid.
            tap.steal--;
            tap.injected++;
            const enc = resource as Encounter;
            await target.createResourceIfNoneExist({ ...enc, identifier: (enc.identifier ?? []).map((i) => (i.system === SYSTEMS.clientUuid ? { ...i, value: randomUUID() } : i)) }, query);
          }
          try {
            return await target.createResourceIfNoneExist(resource, query);
          } catch (err) {
            if (err instanceof OperationOutcomeError && err.outcome.id === 'conflict') {
              tap.seen++;
              for (const c of pgCodes(err.outcome)) tap.codes.add(c);
            }
            throw err;
          }
        };
      }
      if (prop === 'executeBatch') {
        return async (bundle: Bundle) => {
          const entries = bundle.entry ?? [];
          tap.batches.push(entries.map((e) => e.resource?.resourceType ?? '?'));
          const thrown = tap.injectBatch;
          if (thrown && thrown.left > 0) {
            thrown.left--;
            tap.injected++;
            throw pgConflict(thrown.pg);
          }
          const inj = tap.injectEntry;
          const at = inj && inj.left > 0 ? entries.findIndex((e) => e.resource?.resourceType === inj.type) : -1;
          if (inj && at >= 0) {
            // Đúng điều Medplum làm khi từ chối một mục: mục đó KHÔNG được ghi, các mục khác vẫn chạy, phản hồi vẫn là HTTP 200.
            // (Các gói của kế hoạch hoàn tất không có tham chiếu giữa các mục, nên bỏ một mục không ảnh hưởng mục khác.)
            inj.left--;
            tap.injected++;
            const response = await target.executeBatch({ ...bundle, entry: entries.filter((_, i) => i !== at) });
            const rejected: BundleEntry = { response: { status: inj.status, outcome: outcomeOf(inj.pg) } };
            return { ...response, entry: [...(response.entry ?? []).slice(0, at), rejected, ...(response.entry ?? []).slice(at)] };
          }
          const response = await target.executeBatch(bundle);
          for (const e of response.entry ?? []) {
            if (e.response?.status?.startsWith('409')) {
              tap.entrySeen++;
              for (const c of pgCodes(e.response.outcome)) tap.entryCodes.add(c);
            }
          }
          return response;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as MedplumClient;
}

const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, ...(payload ? { payload } : {}) });
const count = async (slug: Slug, type: string, query = '') => (await direct[slug].search(type as 'Patient', `_summary=count&_total=accurate${query}`)).total ?? -1;
const digits = (n: number) => Math.floor(Math.random() * 10 ** n).toString().padStart(n, '0');
const patientBody = (fullName: string, clientUuid: string = randomUUID()) => ({ clientUuid, fullName, phone: `09${digits(8)}`, birthDate: '1985-03-15', cccd: `000${digits(9)}` });
async function newPatient(slug: Slug, name: string) {
  const res = await call('POST', '/api/patients', `${slug}-assistant`, patientBody(name));
  expect(res.statusCode).toBe(201);
  return res.json().patient.id as string;
}
const nextNumber = async () => Math.max(0, ...((await call('GET', '/api/queue', 'x-assistant')).json().items as Array<{ number: number }>).map((i) => i.number)) + 1;
const tally = (xs: number[]) => JSON.stringify(xs.reduce<Record<number, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}));
const BUSY = { error: 'busy', retry: true, message: expect.any(String) };
const INCOMPLETE = { error: 'incomplete', retry: true, message: expect.any(String) };

// ------------------------------------------------------------------------------------------- hoàn tất lượt khám
const PARA = { drug: drugCode('Paracetamol 500 mg'), perDose: 1, quantity: 10 };
/** Một lượt khám có 2 sinh hiệu, 1 chẩn đoán, 1 nhận định, 1 thuốc, 1 đơn (kèm chữ ký mô phỏng và việc gửi cổng). */
const completion = (clientUuid: string) => ({ clientUuid, exam: { reason: 'Đau họng', symptoms: 'Đau họng 2 ngày', vitals: { temperatureC: 37.5, pulse: 80 } }, diagnoses: ['J02.9'], prescription: { lines: [PARA], acknowledgements: [] } });
const RECORDS = ['Observation', 'Observation', 'Condition', 'ClinicalImpression', 'MedicationRequest'];
const SIGNED = ['Provenance', 'Task'];
const FULL = { status: 'finished', Observation: 2, Condition: 1, ClinicalImpression: 1, MedicationRequest: 1, List: 1, Provenance: 1, Task: 1, lines: 1 };

/** Bệnh nhân mới, đã cấp số, bác sĩ đã mở hồ sơ: sẵn sàng để ký. */
async function visitReady(slug: Slug, name: string) {
  const patientId = await newPatient(slug, name);
  const checkIn = await call('POST', '/api/queue', `${slug}-assistant`, { clientUuid: randomUUID(), patientId, specialty: 'noi' });
  expect(checkIn.statusCode).toBe(201);
  const id = checkIn.json().item.id as string;
  expect((await call('POST', `/api/visits/${id}/open`, `${slug}-doctor`)).statusCode).toBe(200);
  return { id, uuid: randomUUID() };
}
const sign = (slug: Slug, v: { id: string; uuid: string }) => call('POST', `/api/visits/${v.id}/complete`, `${slug}-doctor`, completion(v.uuid));
/** Đếm thẳng trong Medplum những gì một lần ký để lại, và số dòng thuốc đọc được qua đơn (tham chiếu của đơn phải trỏ tới thuốc có thật). */
async function parts(slug: Slug, v: { id: string; uuid: string }) {
  const of = (type: string) => count(slug, type, `&encounter=Encounter/${v.id}`);
  const list = await direct[slug].searchOne('List', `encounter=Encounter/${v.id}`);
  return {
    status: (await direct[slug].readResource('Encounter', v.id)).status,
    Observation: await of('Observation'),
    Condition: await of('Condition'),
    ClinicalImpression: await of('ClinicalImpression'),
    MedicationRequest: await of('MedicationRequest'),
    List: await of('List'),
    Provenance: await count(slug, 'Provenance', `&_tag=${SYSTEMS.clientUuid}|${v.uuid}:prov`),
    Task: await count(slug, 'Task', `&${clientUuidQuery(`${v.uuid}:task`)}`),
    lines: list ? ((await call('GET', `/api/prescriptions/${list.id}`, `${slug}-assistant`)).json().prescription?.lines?.length ?? -1) : 0,
  };
}
const outbox = (slug: Slug) => runOutboxOnce({ tenants: [slug], stores: async (s) => stores[s]!, gateway: simulator, audit, now: () => new Date(Date.now() + 1) });

beforeAll(async () => {
  const admin = await adminClient();
  const conflict: ConflictRetry = {
    ...DEFAULT_CONFLICT_RETRY,
    onRetry: (info) => void tap.retried.push(info),
    sleep: async (ms) => {
      tap.sleeps.push(ms);
      await DEFAULT_CONFLICT_RETRY.sleep(ms);
    },
  };
  for (const slug of SLUGS) {
    clinics[slug] = await createTenantProject(admin, slug, `Xung đột ${slug} ${RUN}`);
    direct[slug] = await tenantClient(MEDPLUM_URL, clinics[slug]);
    stores[slug] = new MedplumClinicStore(tapped(await tenantClient(MEDPLUM_URL, clinics[slug])), undefined, conflict);
  }
  const tenants = parseTenantsFile({
    tenants: SLUGS.map((s) => clinics[s]),
    users: SLUGS.flatMap((s) => [
      { id: `${s}-assistant`, name: `Phụ tá ${s}`, role: 'assistant' as const, tenant: s },
      { id: `${s}-doctor`, name: `BS. ${s}`, role: 'doctor' as const, tenant: s },
    ]),
  });
  app = buildApp({ tenants, stores: async (slug) => stores[slug]!, audit, sessions: new SessionService('i'.repeat(40), 60), simulator, logLevel: 'silent' });
  for (const u of tenants.users) tokens[u.id] = (await app.inject({ method: 'POST', url: '/api/session', payload: { tenant: u.tenant, userId: u.id } })).json().token;
}, 90_000);
afterAll(async () => app?.close());
beforeEach(() => tap.reset());

describe('tái hiện: nhiều lời tạo bệnh nhân cùng lúc', () => {
  it(`${N} lời cùng lúc làm Medplum trả 409 mã 40001; BFF thử lại nên mọi lời vẫn 201, không thiếu, không trùng`, async () => {
    const before = await count('x', 'Patient');
    const statuses: number[] = [];
    const ids = new Set<string>();
    let rounds = 0;
    while (tap.seen === 0 && rounds < MAX_ROUNDS) {
      rounds++;
      const res = await Promise.all(Array.from({ length: N }, (_, i) => call('POST', '/api/patients', 'x-assistant', patientBody(`Tải ${RUN} ${rounds}-${i}`))));
      for (const r of res) {
        statuses.push(r.statusCode);
        if (r.statusCode === 201) ids.add(r.json().patient.id);
      }
    }
    // In ra để đọc được ở log, kể cả của CI (`test:integration` chạy với --silent=false): đã gặp bao nhiêu xung đột, cần tới lần thử lại thứ mấy.
    console.info(`[xung đột, tạo bệnh nhân] ${rounds} vòng x ${N} lời, ${tap.seen} xung đột thật, lần thử lại xa nhất: ${Math.max(0, ...tap.retried.map((r) => r.attempt))}, mã trả về: ${tally(statuses)}`);
    // Điều kiện để bài có nghĩa: tình huống đã thật sự xảy ra. Không thấy xung đột nào thì bài chưa kiểm được gì.
    expect(tap.seen, `không tái hiện được xung đột sau ${rounds} vòng x ${N} lời: tăng N`).toBeGreaterThan(0);
    expect([...tap.codes]).toEqual(['40001']);
    expect(statuses.filter((s) => s !== 201)).toEqual([]);
    expect(ids.size).toBe(rounds * N);
    expect((await count('x', 'Patient')) - before).toBe(rounds * N);
    // Mọi xung đột đều đã đi qua đường thử lại (không lời nào hết lượt).
    expect(tap.retried.filter((r) => r.what === 'patient')).toHaveLength(tap.seen);
  }, 90_000);
});

describe('xung đột chèn vào một lời tạo có điều kiện (tất định)', () => {
  it('tạo bệnh nhân: xung đột 2 lần rồi qua → 201, đúng một bản ghi; chờ trong giới hạn trước mỗi lần thử lại', async () => {
    const body = patientBody(`Chèn Hai ${RUN}`);
    tap.inject = { type: 'Patient', left: 2, pg: '40001' };
    const res = await call('POST', '/api/patients', 'x-assistant', body);
    expect([res.statusCode, res.json().created]).toEqual([201, true]);
    expect(tap.injected).toBe(2);
    expect(tap.calls.length).toBeGreaterThanOrEqual(3);
    expect(tap.retried.slice(0, 2)).toEqual([{ what: 'patient', attempt: 1 }, { what: 'patient', attempt: 2 }]);
    expect(tap.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(tap.sleeps[0]!).toBeLessThan(50);
    expect(tap.sleeps[1]!).toBeLessThan(100);
    expect(await count('x', 'Patient', `&${clientUuidQuery(body.clientUuid)}`)).toBe(1);
  });

  it('tạo bệnh nhân: xung đột mãi → 503 `busy` sau đúng 4 lần gọi, không ghi gì; gửi lại cùng clientUuid thì 201', async () => {
    const body = patientBody(`Chèn Mãi ${RUN}`);
    tap.inject = { type: 'Patient', left: 99, pg: '40001' };
    const res = await call('POST', '/api/patients', 'x-assistant', body);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(BUSY);
    expect(tap.calls).toEqual(['Patient', 'Patient', 'Patient', 'Patient']);
    expect(tap.sleeps).toHaveLength(3);
    expect(await count('x', 'Patient', `&${clientUuidQuery(body.clientUuid)}`)).toBe(0);

    tap.inject = undefined;
    const again = await call('POST', '/api/patients', 'x-assistant', body);
    expect([again.statusCode, again.json().created]).toEqual([201, true]);
    expect(await count('x', 'Patient', `&${clientUuidQuery(body.clientUuid)}`)).toBe(1);
  });

  it('409 không phải xung đột giao dịch (mã khác 40001) thì không thử lại: 500 như trước, gọi đúng 1 lần', async () => {
    const body = patientBody(`Chèn Khác ${RUN}`);
    tap.inject = { type: 'Patient', left: 1, pg: '23505' };
    const res = await call('POST', '/api/patients', 'x-assistant', body);
    expect([res.statusCode, res.json().error]).toEqual([500, 'internal']);
    expect(tap.calls).toEqual(['Patient']);
    expect(tap.retried).toEqual([]);
  });

  it('cấp số: xung đột 3 lần rồi qua → 201 với đúng số kế tiếp (không bỏ số), một lượt khám', async () => {
    const patientId = await newPatient('x', `Chèn Số ${RUN}`);
    const next = await nextNumber();
    tap.reset();
    const clientUuid = randomUUID();
    tap.inject = { type: 'Encounter', left: 3, pg: '40001' };
    const res = await call('POST', '/api/queue', 'x-assistant', { clientUuid, patientId, specialty: 'noi' });
    expect([res.statusCode, res.json().item?.number]).toEqual([201, next]);
    expect(tap.injected).toBe(3);
    expect(tap.retried.slice(0, 3)).toEqual([1, 2, 3].map((attempt) => ({ what: 'check-in', attempt })));
    expect(await count('x', 'Encounter', `&${clientUuidQuery(clientUuid)}`)).toBe(1);
  });

  it('cấp số: xung đột mãi → 503 `busy`, chưa có lượt khám; gửi lại cùng clientUuid thì 201 với đúng số đó', async () => {
    const patientId = await newPatient('x', `Chèn Số Mãi ${RUN}`);
    const next = await nextNumber();
    tap.reset();
    const body = { clientUuid: randomUUID(), patientId, specialty: 'noi' };
    tap.inject = { type: 'Encounter', left: 99, pg: '40001' };
    const res = await call('POST', '/api/queue', 'x-assistant', body);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(BUSY);
    expect(tap.calls).toHaveLength(4);
    expect(await count('x', 'Encounter', `&${clientUuidQuery(body.clientUuid)}`)).toBe(0);

    tap.inject = undefined;
    const again = await call('POST', '/api/queue', 'x-assistant', body);
    expect([again.statusCode, again.json().item?.number]).toEqual([201, next]);
  });

  it('cấp số: 5 vòng liền số nào cũng bị lễ tân khác lấy trước → 503 `busy` (không phải 500), chưa có lượt khám; gửi lại thì 201', async () => {
    const patientId = await newPatient('x', `Giành Số ${RUN}`);
    const next = await nextNumber();
    tap.reset();
    const body = { clientUuid: randomUUID(), patientId, specialty: 'noi' };
    tap.steal = 5;
    const res = await call('POST', '/api/queue', 'x-assistant', body);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(BUSY);
    expect(tap.injected).toBe(5);
    expect(await count('x', 'Encounter', `&${clientUuidQuery(body.clientUuid)}`)).toBe(0);

    const again = await call('POST', '/api/queue', 'x-assistant', body);
    expect([again.statusCode, again.json().item?.number]).toEqual([201, next + 5]);
  });

  it('dị ứng: xung đột 1 lần rồi qua → 201, đúng một dòng dị ứng', async () => {
    const patientId = await newPatient('x', `Chèn Dị Ứng ${RUN}`);
    tap.reset();
    tap.inject = { type: 'AllergyIntolerance', left: 1, pg: '40001' };
    const res = await call('POST', `/api/patients/${patientId}/allergies`, 'x-assistant', { clientUuid: randomUUID(), kind: 'class', value: 'penicillin' });
    expect(res.statusCode).toBe(201);
    expect(tap.injected).toBe(1);
    expect(tap.retried[0]).toEqual({ what: 'allergy', attempt: 1 });
    expect((await call('GET', `/api/patients/${patientId}/allergies`, 'x-assistant')).json().allergies).toHaveLength(1);
  });

  it('tiền sử: xung đột 1 lần rồi qua → 201, đúng một dòng tiền sử', async () => {
    const patientId = await newPatient('x', `Chèn Tiền Sử ${RUN}`);
    tap.reset();
    tap.inject = { type: 'Condition', left: 1, pg: '40001' };
    const res = await call('POST', `/api/patients/${patientId}/medical-history`, 'x-doctor', { clientUuid: randomUUID(), text: 'Tăng huyết áp 5 năm' });
    expect(res.statusCode).toBe(201);
    expect(tap.injected).toBe(1);
    expect(tap.retried[0]).toEqual({ what: 'history', attempt: 1 });
    expect((await call('GET', `/api/patients/${patientId}/medical-history`, 'x-doctor')).json().history).toHaveLength(1);
  });
});

describe('tái hiện: nhiều lượt khám ký cùng lúc', () => {
  it(`${M} lượt ký cùng lúc: Medplum từ chối vài mục của gói (409 mã 40001) mà vẫn trả HTTP 200; không lượt nào thiếu hay trùng bản ghi`, async () => {
    const done: Array<{ slug: Slug; id: string; uuid: string; first: number; last: number; resends: number }> = [];
    let rounds = 0;
    while (tap.entrySeen === 0 && rounds < MAX_SIGN_ROUNDS) {
      const slug = SLUGS[3 + rounds]!;
      rounds++;
      const visits: Array<{ id: string; uuid: string }> = [];
      for (let i = 0; i < M; i++) visits.push(await visitReady(slug, `Ký ${RUN} ${rounds}-${i}`));
      const first = await Promise.all(visits.map((v) => sign(slug, v)));
      for (const [i, r] of first.entries()) {
        // Lời nào nhận 5xx thì gửi lại cùng clientUuid, như hàng đợi đồng bộ của giao diện làm.
        let res = r;
        let resends = 0;
        while (res.statusCode >= 500 && resends < 5) {
          resends++;
          res = await sign(slug, visits[i]!);
        }
        done.push({ slug, ...visits[i]!, first: r.statusCode, last: res.statusCode, resends });
      }
    }
    console.info(`[xung đột, ký] ${rounds} vòng x ${M} lượt, ${tap.entrySeen} mục 409 thật, lần thử lại xa nhất: ${Math.max(0, ...tap.retried.map((r) => r.attempt))}, mã trả về lần đầu: ${tally(done.map((d) => d.first))}, số lượt phải gửi lại: ${done.filter((d) => d.resends).length}`);
    expect(tap.entrySeen, `không tái hiện được xung đột sau ${rounds} vòng x ${M} lượt: tăng M`).toBeGreaterThan(0);
    expect([...tap.entryCodes]).toEqual(['40001']);
    // Lần đầu chỉ được là 201, hoặc 503 "gửi lại" khi hết lượt thử; sau khi gửi lại thì mọi lượt đều xong.
    expect(done.filter((d) => ![201, 503].includes(d.first) || ![200, 201].includes(d.last))).toEqual([]);
    // Điều phải đúng trong mọi trường hợp: lượt khám đã đóng thì đủ bản ghi, đơn trỏ tới thuốc có thật, không bản ghi trùng.
    for (const d of done) expect(await parts(d.slug, d), `lượt ${d.id} (lần đầu ${d.first}, gửi lại ${d.resends} lần)`).toEqual(FULL);
  }, 120_000);
});

describe('hoàn tất lượt khám: lỗi chèn vào một mục (tất định)', () => {
  it('một sinh hiệu bị 409 mã 40001 một lần → BFF gửi lại gói đó, trả 201 ngay trong yêu cầu, đủ bản ghi', async () => {
    const v = await visitReady('y', `Sinh Hiệu Một ${RUN}`);
    tap.reset();
    tap.injectEntry = { type: 'Observation', left: 1, status: '409', pg: '40001' };
    const res = await sign('y', v);
    expect([res.statusCode, res.json().replayed]).toEqual([201, false]);
    expect(tap.injected).toBe(1);
    expect(tap.batches.slice(0, 2)).toEqual([RECORDS, RECORDS]);
    expect(tap.batches.at(-1)).toEqual(SIGNED);
    expect(tap.retried[0]).toEqual({ what: 'complete', attempt: 1 });
    expect(await parts('y', v)).toEqual(FULL);
  });

  it('sinh hiệu bị 409 mãi → 503 `incomplete` sau đúng 4 lần gửi; lượt khám CHƯA đóng, chưa có đơn; gửi lại cùng clientUuid thì 201, đủ, không trùng, đơn gửi được', async () => {
    const v = await visitReady('y', `Sinh Hiệu Mãi ${RUN}`);
    await outbox('y'); // gửi hết đơn của các bài trước, để cuối bài đếm đúng một đơn
    tap.reset();
    tap.injectEntry = { type: 'Observation', left: 99, status: '409', pg: '40001' };
    const res = await sign('y', v);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(INCOMPLETE);
    expect(tap.batches).toEqual([RECORDS, RECORDS, RECORDS, RECORDS]);
    // Điểm chốt: còn mục chưa ghi thì KHÔNG đóng lượt khám, KHÔNG tạo đơn. (Trước bản sửa: lượt khám đã đóng và lần gửi lại trả 200 mà không ghi bù.)
    expect(await parts('y', v)).toEqual({ ...FULL, status: 'in-progress', Observation: 1, List: 0, Provenance: 0, Task: 0, lines: 0 });
    expect(await outbox('y')).toEqual({ sent: 0, failed: 0 });

    tap.injectEntry = undefined;
    const again = await sign('y', v);
    expect([again.statusCode, again.json().replayed]).toEqual([201, false]);
    expect(await parts('y', v)).toEqual(FULL);
    expect(await outbox('y')).toEqual({ sent: 1, failed: 0 });
    // Gửi thêm lần nữa: lượt khám đã đóng bằng clientUuid này, trả kết quả cũ, không ghi gì.
    const replay = await sign('y', v);
    expect([replay.statusCode, replay.json().replayed]).toEqual([200, true]);
    expect(await parts('y', v)).toEqual(FULL);
  });

  it('thuốc bị 409 một lần → 201; đơn trỏ tới thuốc có thật', async () => {
    const v = await visitReady('y', `Thuốc Một ${RUN}`);
    tap.reset();
    tap.injectEntry = { type: 'MedicationRequest', left: 1, status: '409', pg: '40001' };
    const res = await sign('y', v);
    expect(res.statusCode).toBe(201);
    expect(res.json().prescription.lines).toHaveLength(1);
    expect(tap.injected).toBe(1);
    expect(await parts('y', v)).toEqual(FULL);
  });

  it('thuốc bị 409 mãi → 503 `incomplete`; không có đơn nào trỏ tới thuốc chưa tồn tại, lượt khám chưa đóng; gửi lại thì 201 với đủ dòng thuốc', async () => {
    const v = await visitReady('y', `Thuốc Mãi ${RUN}`);
    tap.reset();
    tap.injectEntry = { type: 'MedicationRequest', left: 99, status: '409', pg: '40001' };
    const res = await sign('y', v);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(INCOMPLETE);
    expect(await parts('y', v)).toEqual({ ...FULL, status: 'in-progress', MedicationRequest: 0, List: 0, Provenance: 0, Task: 0, lines: 0 });

    tap.injectEntry = undefined;
    const again = await sign('y', v);
    expect(again.statusCode).toBe(201);
    expect(again.json().prescription.lines).toHaveLength(1);
    expect(await parts('y', v)).toEqual(FULL);
  });

  it('đơn (List) bị 409 một lần → 201; bị mãi → 503 `busy`, chưa có chữ ký hay việc gửi cổng, lượt khám chưa đóng; gửi lại thì 201', async () => {
    const once = await visitReady('w', `Đơn Một ${RUN}`);
    tap.reset();
    tap.inject = { type: 'List', left: 1, pg: '40001' };
    expect((await sign('w', once)).statusCode).toBe(201);
    expect(tap.injected).toBe(1);
    expect(await parts('w', once)).toEqual(FULL);

    const forever = await visitReady('w', `Đơn Mãi ${RUN}`);
    tap.reset();
    tap.inject = { type: 'List', left: 99, pg: '40001' };
    const res = await sign('w', forever);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(BUSY);
    expect(tap.calls).toEqual(['List', 'List', 'List', 'List']);
    expect(await parts('w', forever)).toEqual({ ...FULL, status: 'in-progress', List: 0, Provenance: 0, Task: 0, lines: 0 });

    tap.inject = undefined;
    expect((await sign('w', forever)).statusCode).toBe(201);
    expect(await parts('w', forever)).toEqual(FULL);
  });

  it('việc gửi cổng (Task) bị 409 một lần → 201; bị mãi → 503 `incomplete`, lượt khám chưa đóng nên đơn chưa được gửi; gửi lại thì 201, một Task', async () => {
    const once = await visitReady('w', `Task Một ${RUN}`);
    tap.reset();
    tap.injectEntry = { type: 'Task', left: 1, status: '409', pg: '40001' };
    expect((await sign('w', once)).statusCode).toBe(201);
    expect(tap.batches.slice(-2)).toEqual([SIGNED, SIGNED]);
    expect(await parts('w', once)).toEqual(FULL);

    const forever = await visitReady('w', `Task Mãi ${RUN}`);
    await outbox('w');
    tap.reset();
    tap.injectEntry = { type: 'Task', left: 99, status: '409', pg: '40001' };
    const res = await sign('w', forever);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(INCOMPLETE);
    expect(tap.batches.filter((b) => b.includes('Task'))).toHaveLength(4);
    expect(await parts('w', forever)).toEqual({ ...FULL, status: 'in-progress', Task: 0 });
    expect(await outbox('w')).toEqual({ sent: 0, failed: 0 });

    tap.injectEntry = undefined;
    expect((await sign('w', forever)).statusCode).toBe(201);
    expect(await parts('w', forever)).toEqual(FULL);
    expect(await outbox('w')).toEqual({ sent: 1, failed: 0 });
  });

  it('mục lỗi không phải xung đột giao dịch (400, hoặc 409 mã khác 40001) → không gửi lại gói: 503 `incomplete` sau đúng 1 lần gửi, lượt khám chưa đóng', async () => {
    for (const fault of [{ status: '400' }, { status: '409', pg: '23505' }]) {
      const v = await visitReady('w', `Lỗi Khác ${fault.status} ${RUN}`);
      tap.reset();
      tap.injectEntry = { type: 'Observation', left: 1, ...fault };
      const res = await sign('w', v);
      expect(res.statusCode, fault.status).toBe(503);
      expect(res.json()).toEqual(INCOMPLETE);
      expect(tap.batches, fault.status).toEqual([RECORDS]);
      expect(tap.retried).toEqual([]);
      expect((await parts('w', v)).status).toBe('in-progress');
      // Gửi lại (máy khách tự làm sau 503): hội tụ.
      expect((await sign('w', v)).statusCode).toBe(201);
      expect(await parts('w', v)).toEqual(FULL);
    }
  });

  it('cả gói bị ném 409 mã 40001 một lần → BFF gửi lại, 201; bị mãi → 503 `busy`, lượt khám chưa đóng', async () => {
    const once = await visitReady('w', `Gói Một ${RUN}`);
    tap.reset();
    tap.injectBatch = { left: 1, pg: '40001' };
    expect((await sign('w', once)).statusCode).toBe(201);
    expect(tap.injected).toBe(1);
    expect(await parts('w', once)).toEqual(FULL);

    const forever = await visitReady('w', `Gói Mãi ${RUN}`);
    tap.reset();
    tap.injectBatch = { left: 99, pg: '40001' };
    const res = await sign('w', forever);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(BUSY);
    expect(tap.batches).toEqual([RECORDS, RECORDS, RECORDS, RECORDS]);
    expect((await parts('w', forever)).status).toBe('in-progress');
  });
});

describe('ghép nối', () => {
  it('MedplumTenants chuyển chính sách thử lại cho kho của từng phòng khám', async () => {
    const policy: ConflictRetry = { ...DEFAULT_CONFLICT_RETRY, retries: 1 };
    const store = await new MedplumTenants(MEDPLUM_URL, [clinics.x], undefined, policy).store('x');
    expect((store as unknown as { conflict: ConflictRetry }).conflict).toBe(policy);
  });
});
