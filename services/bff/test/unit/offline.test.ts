// Phía BFF của ngoại tuyến (M0-S3, kế hoạch OFF-1 đến OFF-4): giờ máy khách, số tạm, nạp trước, ghi nhận lần in lúc mất mạng.
import { drugCode } from '@phongmach/catalogs';
import { describe, expect, it } from 'vitest';
import { auditEntries, login, makeApp } from './helpers.js';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = new Date('2026-10-20T03:00:00Z'); // 10:00 giờ Việt Nam
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
type Ctx = ReturnType<typeof makeApp>;

const AMOX = { drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 };
const body = (over: Record<string, unknown> = {}) => ({
  clientUuid: '11111111-1111-4111-8111-111111111111',
  exam: { reason: 'Đau họng', vitals: {} },
  diagnoses: ['J02.9'],
  prescription: { lines: [AMOX], acknowledgements: [] },
  ...over,
});

async function patient(c: Ctx, token: string, n: number, fullName = 'Nguyễn Văn An') {
  const p = await c.app.inject({ method: 'POST', url: '/api/patients', headers: auth(token), payload: { clientUuid: U(n), fullName, birthDate: '1985-03-15', cccd: '000123456789' } });
  return p.json().patient.id as string;
}
const enqueue = (c: Ctx, token: string, patientId: string, n: number, extra: Record<string, unknown> = {}) =>
  c.app.inject({ method: 'POST', url: '/api/queue', headers: auth(token), payload: { clientUuid: U(n), patientId, specialty: 'noi', ...extra } });

async function setup(c: Ctx) {
  const assistant = await login(c.app, 'a', 'a-assistant');
  const doctor = await login(c.app, 'a', 'a-doctor');
  const patientId = await patient(c, assistant, 1);
  const visitId = (await enqueue(c, assistant, patientId, 2)).json().item.id as string;
  return { assistant, doctor, patientId, visitId };
}

describe('cấp số lúc mất mạng (OFF-2)', () => {
  it('giờ đến và số tạm của máy khách được chuyển xuống kho; nhật ký ghi là thao tác lúc mất mạng kèm giờ máy khách', async () => {
    const c = makeApp({ now: () => NOW });
    const assistant = await login(c.app, 'a', 'a-assistant');
    const patientId = await patient(c, assistant, 1);
    const res = await enqueue(c, assistant, patientId, 2, { arrivedAt: at(-3 * 3600_000), proposedNumber: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.number).toBe(1);
    expect(c.stores.get('a')!.checkIns[0]!.options).toEqual({ arrivedAt: new Date(at(-3 * 3600_000)), proposedNumber: 1 });
    expect(c.stores.get('a')!.checkIns[0]!.input).not.toHaveProperty('arrivedAt');
    const entry = auditEntries(c).find((e) => e.action === 'check-in')!;
    expect(entry).toMatchObject({ queryKind: 'offline', clientTs: at(-3 * 3600_000) });
  });
  it('giờ đến ở tương lai (đồng hồ máy khách chạy nhanh) thì dùng giờ máy chủ; giờ sai định dạng hoặc số tạm ngoài khoảng bị từ chối', async () => {
    const c = makeApp({ now: () => NOW });
    const assistant = await login(c.app, 'a', 'a-assistant');
    const patientId = await patient(c, assistant, 1);
    expect((await enqueue(c, assistant, patientId, 2, { arrivedAt: at(3600_000) })).statusCode).toBe(201);
    expect(c.stores.get('a')!.checkIns[0]!.options.arrivedAt).toBeUndefined();
    expect((await enqueue(c, assistant, patientId, 3, { arrivedAt: '20/10/2026 10:00' })).statusCode).toBe(400);
    expect((await enqueue(c, assistant, patientId, 3, { arrivedAt: '2026-10-20T10:00:00' })).statusCode).toBe(400); // thiếu múi giờ
    expect((await enqueue(c, assistant, patientId, 3, { proposedNumber: 0 })).statusCode).toBe(400);
    expect((await enqueue(c, assistant, patientId, 3, { proposedNumber: 1.5 })).statusCode).toBe(400);
  });
  it('thao tác có mạng không có trường mới: nhật ký không gắn "offline"', async () => {
    const c = makeApp({ now: () => NOW });
    await setup(c);
    expect(auditEntries(c).find((e) => e.action === 'check-in')).not.toHaveProperty('queryKind');
  });
});

describe('mở hồ sơ và ký lúc mất mạng (OFF-3)', () => {
  it('mốc mở theo máy khách được chuyển xuống kho (hợp lý), bỏ qua nếu ở tương lai; không có body vẫn mở bình thường', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, visitId } = await setup(c);
    const open = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor), payload: { openedAt: at(-600_000) } });
    expect(open.statusCode).toBe(200);
    expect(c.stores.get('a')!.opens[0]).toEqual({ id: visitId, openedAt: new Date(at(-600_000)) });
    expect(auditEntries(c).find((e) => e.action === 'visit-open')).toMatchObject({ queryKind: 'offline', clientTs: at(-600_000) });

    const c2 = makeApp({ now: () => NOW });
    const s2 = await setup(c2);
    await c2.app.inject({ method: 'POST', url: `/api/visits/${s2.visitId}/open`, headers: auth(s2.doctor), payload: { openedAt: at(3600_000) } });
    expect(c2.stores.get('a')!.opens[0]!.openedAt).toBeUndefined();
    const c3 = makeApp({ now: () => NOW });
    const s3 = await setup(c3);
    expect((await c3.app.inject({ method: 'POST', url: `/api/visits/${s3.visitId}/open`, headers: auth(s3.doctor) })).statusCode).toBe(200);
    expect((await c3.app.inject({ method: 'POST', url: `/api/visits/${s3.visitId}/open`, headers: auth(s3.doctor), payload: { openedAt: 'hôm qua' } })).statusCode).toBe(400);
  });

  it('ký lúc mất mạng: mã đơn theo ngày ký của máy khách (trùng mã đã in), giờ máy khách chuyển xuống kho, nhật ký ghi "offline"', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, visitId } = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
    // Ký 23:59 ngày 19/10 giờ Việt Nam, đồng bộ lúc 10:00 ngày 20/10: mã đơn phải mang ngày 19.
    const clientTimes = { openedAt: '2026-10-19T16:58:00Z', signedAt: '2026-10-19T16:59:00Z' };
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ clientTimes }) });
    expect(res.statusCode).toBe(201);
    expect(res.json().prescription.code).toBe('PM-261019-XP25EM'); // cùng vectơ với apps/clinic-web/src/print.test.ts
    expect(c.stores.get('a')!.completions[0]!.clientTimes).toEqual(clientTimes);
    expect(auditEntries(c).filter((e) => e.action === 'visit-complete').at(-1)).toMatchObject({ outcome: 'ok', queryKind: 'offline', clientTs: clientTimes.signedAt });
  });

  it('giờ máy khách sai định dạng thì từ chối (lỗi của máy khách, không phải giờ không hợp lý)', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, visitId } = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ clientTimes: { openedAt: 'x', signedAt: at(0) } }) });
    expect(res.statusCode).toBe(400);
  });

  it('máy không có dữ liệu dị ứng lúc ký: máy chủ cũng đòi xác nhận "allergy-unknown" và lưu lý do cùng đơn', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, visitId } = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
    const refused = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ allergiesUnknown: true }) });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().unacknowledged.map((f: { rule: string }) => f.rule)).toEqual(['allergy-unknown']);
    const reason = 'Đã hỏi, bệnh nhân không dị ứng thuốc nào';
    const ok = await c.app.inject({
      method: 'POST',
      url: `/api/visits/${visitId}/complete`,
      headers: auth(doctor),
      payload: body({ allergiesUnknown: true, prescription: { lines: [AMOX], acknowledgements: [{ key: 'allergy-unknown', reason }] } }),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().prescription.acknowledgements).toEqual([expect.objectContaining({ key: 'allergy-unknown', reason })]);
  });

  it('dị ứng thật được ghi ở máy khác khi đang mất mạng: máy chủ vẫn bắt, dù máy khách khai "chưa rõ dị ứng"', async () => {
    const c = makeApp({ now: () => NOW });
    const { assistant, doctor, visitId, patientId } = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
    await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    const res = await c.app.inject({
      method: 'POST',
      url: `/api/visits/${visitId}/complete`,
      headers: auth(doctor),
      payload: body({ allergiesUnknown: true, prescription: { lines: [AMOX], acknowledgements: [{ key: 'allergy-unknown', reason: 'Đã hỏi bệnh nhân' }] } }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().unacknowledged.map((f: { rule: string }) => f.rule)).toEqual(['allergy']);
  });
});

describe('nạp trước hàng chờ (OFF-4)', () => {
  it('chỉ người đang chờ hoặc đang khám hôm nay, kèm dị ứng; tham số lọc không lấy được người ngoài hàng chờ', async () => {
    const c = makeApp({ now: () => NOW });
    const { assistant, doctor, patientId, visitId } = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    const outsider = await patient(c, assistant, 4, 'Lê Văn Ngoài');
    const cancelledPatient = await patient(c, assistant, 5, 'Phạm Thị Hủy');
    const cancelled = (await enqueue(c, assistant, cancelledPatient, 6)).json().item.id as string;
    await c.app.inject({ method: 'POST', url: `/api/queue/${cancelled}/cancel`, headers: auth(assistant) });
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });

    const all = await c.app.inject({ method: 'GET', url: '/api/queue/prefetch', headers: auth(doctor) });
    expect(all.statusCode).toBe(200);
    expect(all.json().patients.map((p: { patient: { id: string } }) => p.patient.id)).toEqual([patientId]);
    expect(all.json().patients[0].allergies).toEqual([expect.objectContaining({ kind: 'class', value: 'penicillin' })]);

    const filtered = await c.app.inject({ method: 'GET', url: `/api/queue/prefetch?patients=${outsider},${cancelledPatient},${patientId},khong-phai-id`, headers: auth(assistant) });
    expect(filtered.json().patients.map((p: { patient: { id: string } }) => p.patient.id)).toEqual([patientId]);
    expect(c.stores.get('a')!.prefetches.at(-1)).toEqual({ day: '2026-10-20', patientIds: [outsider, cancelledPatient, patientId] });
  });
  it('mỗi lần nạp một dòng nhật ký có id bệnh nhân, không có tên hay dị ứng; phòng khám khác không thấy gì', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, patientId } = await setup(c);
    await c.app.inject({ method: 'GET', url: '/api/queue/prefetch', headers: auth(doctor) });
    const entry = auditEntries(c).find((e) => e.action === 'queue-prefetch')!;
    expect(entry).toMatchObject({ outcome: 'ok', resultCount: 1, resourceIds: [patientId] });
    expect(JSON.stringify(entry)).not.toMatch(/Nguyễn|penicillin/);
    const b = await login(c.app, 'b', 'b-doctor');
    expect((await c.app.inject({ method: 'GET', url: '/api/queue/prefetch', headers: auth(b) })).json().patients).toEqual([]);
    expect((await c.app.inject({ method: 'GET', url: '/api/queue/prefetch' })).statusCode).toBe(401);
  });
});

describe('ghi nhận lần in lúc mất mạng (OFF-1)', () => {
  async function signed(c: Ctx) {
    const s = await setup(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${s.visitId}/open`, headers: auth(s.doctor) });
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${s.visitId}/complete`, headers: auth(s.doctor), payload: body() });
    return { ...s, rxId: res.json().prescription.id as string };
  }
  it('ghi một dòng "In đơn thuốc" đánh dấu offline, kèm giờ in theo máy khách; phụ tá cũng ghi được', async () => {
    const c = makeApp({ now: () => NOW });
    const { assistant, patientId, rxId } = await signed(c);
    const res = await c.app.inject({ method: 'POST', url: `/api/prescriptions/${rxId}/printed`, headers: auth(assistant), payload: { printedAt: at(-60_000) } });
    expect(res.statusCode).toBe(200);
    const entry = auditEntries(c).filter((e) => e.action === 'prescription-print').at(-1)!;
    expect(entry).toMatchObject({ outcome: 'ok', role: 'assistant', queryKind: 'offline', clientTs: at(-60_000), resourceIds: [patientId, rxId] });
  });
  it('đơn không có hoặc của phòng khám khác: 404, không ghi dòng in; giờ sai định dạng bị từ chối', async () => {
    const c = makeApp({ now: () => NOW });
    const { doctor, rxId } = await signed(c);
    expect((await c.app.inject({ method: 'POST', url: `/api/prescriptions/${U(7)}/printed`, headers: auth(doctor) })).statusCode).toBe(404);
    const b = await login(c.app, 'b', 'b-doctor');
    expect((await c.app.inject({ method: 'POST', url: `/api/prescriptions/${rxId}/printed`, headers: auth(b) })).statusCode).toBe(404);
    expect(auditEntries(c).filter((e) => e.action === 'prescription-print')).toEqual([]);
    expect((await c.app.inject({ method: 'POST', url: `/api/prescriptions/${rxId}/printed`, headers: auth(doctor), payload: { printedAt: 'vừa xong' } })).statusCode).toBe(400);
  });
});
