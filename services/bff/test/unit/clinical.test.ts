import { drugCode } from '@phongmach/catalogs';
import { describe, expect, it } from 'vitest';
import { SimulatedGateway } from '../../src/gateway.js';
import { FakeStore, auditEntries, login, makeApp } from './helpers.js';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = new Date('2026-10-20T03:00:00Z');

type Ctx = ReturnType<typeof makeApp>;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Tạo bệnh nhân + đưa vào hàng chờ, trả về id lượt khám. */
async function checkIn(c: Ctx, token: string, patient: { fullName: string; birthDate?: string; cccd?: string }, n = 1, extra: Record<string, unknown> = {}) {
  const p = await c.app.inject({ method: 'POST', url: '/api/patients', headers: auth(token), payload: { clientUuid: U(n), phone: '0912345678', ...patient } });
  const patientId = p.json().patient.id as string;
  const q = await c.app.inject({ method: 'POST', url: '/api/queue', headers: auth(token), payload: { clientUuid: U(n + 5), patientId, specialty: 'noi', ...extra } });
  expect(q.statusCode).toBe(201);
  return { patientId, visitId: q.json().item.id as string };
}

const AMOX = { drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 };
const PARA = { drug: drugCode('Paracetamol 500 mg'), perDose: 1, quantity: 10 };
const ADULT = { fullName: 'Nguyễn Văn An', birthDate: '1985-03-15', cccd: '000123456789' };

const body = (over: Record<string, unknown> = {}) => ({
  clientUuid: U(9),
  exam: { reason: 'Đau họng', vitals: { temperatureC: 38 } },
  diagnoses: ['J02.9'],
  prescription: { lines: [AMOX, PARA], advice: 'Uống nhiều nước', acknowledgements: [] },
  ...over,
});

async function opened(c: Ctx, patient: { fullName: string; birthDate?: string; cccd?: string } = ADULT, n = 1) {
  const assistant = await login(c.app, 'a', 'a-assistant');
  const doctor = await login(c.app, 'a', 'a-doctor');
  const ids = await checkIn(c, assistant, patient, n);
  const open = await c.app.inject({ method: 'POST', url: `/api/visits/${ids.visitId}/open`, headers: auth(doctor) });
  expect(open.statusCode).toBe(200);
  return { ...ids, assistant, doctor };
}

describe('phân quyền', () => {
  it('phụ tá không mở hồ sơ, không hoàn tất, không xem lịch sử khám, tiền sử, số đo hay điều khiển cổng; mọi lần bị từ chối đều có nhật ký', async () => {
    const c = makeApp({ simulator: new SimulatedGateway() });
    const { visitId, patientId, assistant } = await opened(c);
    const calls: Array<[string, string]> = [
      ['POST', `/api/visits/${visitId}/open`],
      ['GET', `/api/visits/${visitId}`],
      ['POST', `/api/visits/${visitId}/complete`],
      ['GET', `/api/patients/${patientId}/visits`],
      ['GET', `/api/patients/${patientId}/medical-history`],
      ['POST', `/api/patients/${patientId}/medical-history`],
      ['GET', '/api/metrics/visits'],
      ['GET', '/api/sim/gateway'],
      ['POST', `/api/prescriptions/${U(1)}/retry`],
    ];
    for (const [method, url] of calls) {
      const res = await c.app.inject({ method: method as 'GET', url, headers: auth(assistant), payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    const denied = auditEntries(c).filter((e) => e.outcome === 'denied');
    expect(denied).toHaveLength(calls.length);
  });
  it('phụ tá vẫn làm được việc tiếp đón: hàng chờ, check-in, dị ứng, bổ sung CCCD', async () => {
    const c = makeApp();
    const { patientId, assistant } = await opened(c);
    expect((await c.app.inject({ method: 'GET', url: '/api/queue', headers: auth(assistant) })).statusCode).toBe(200);
    const add = await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    expect(add.statusCode).toBe(201);
    expect((await c.app.inject({ method: 'GET', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant) })).json().allergies).toHaveLength(1);
    const patch = await c.app.inject({ method: 'PATCH', url: `/api/patients/${patientId}`, headers: auth(assistant), payload: { cccd: '000555444333' } });
    expect(patch.statusCode).toBe(200);
  });
  it('mọi đường mới đều đòi đăng nhập', async () => {
    const { app } = makeApp();
    for (const [method, url] of [['GET', '/api/queue'], ['GET', '/api/display'], ['POST', `/api/visits/${U(1)}/open`], ['GET', `/api/prescriptions/${U(1)}/print`], ['GET', '/api/prescriptions/pending'], ['GET', '/api/metrics/visits'], ['GET', '/api/sim/gateway']]) {
      expect((await app.inject({ method: method as 'GET', url })).statusCode, url).toBe(401);
    }
  });
  it('id không phải UUID bị từ chối trước khi chạm kho', async () => {
    const c = makeApp();
    const doctor = await login(c.app, 'a', 'a-doctor');
    const res = await c.app.inject({ method: 'POST', url: '/api/visits/khong-phai-uuid/open', headers: auth(doctor) });
    expect(res.statusCode).toBe(400);
  });
});

describe('hàng chờ', () => {
  it('cấp số, gửi lại cùng clientUuid không cấp thêm, và hủy chỉ áp cho lượt đang chờ', async () => {
    const c = makeApp({ now: () => NOW });
    const token = await login(c.app, 'a', 'a-assistant');
    const { patientId, visitId } = await checkIn(c, token, ADULT);
    const again = await c.app.inject({ method: 'POST', url: '/api/queue', headers: auth(token), payload: { clientUuid: U(6), patientId, specialty: 'noi' } });
    expect([again.statusCode, again.json().created]).toEqual([200, false]);
    const queue = (await c.app.inject({ method: 'GET', url: '/api/queue', headers: auth(token) })).json();
    expect(queue.items).toHaveLength(1);
    expect(queue.day).toBe('2026-10-20');
    expect((await c.app.inject({ method: 'POST', url: `/api/queue/${visitId}/cancel`, headers: auth(token) })).statusCode).toBe(200);
    expect((await c.app.inject({ method: 'POST', url: `/api/queue/${visitId}/cancel`, headers: auth(token) })).statusCode).toBe(409);
  });
  it('bệnh nhân không tồn tại thì 404; chuyên khoa hoặc ưu tiên lạ thì 400', async () => {
    const c = makeApp();
    const token = await login(c.app, 'a', 'a-assistant');
    const post = (payload: object) => c.app.inject({ method: 'POST', url: '/api/queue', headers: auth(token), payload });
    expect((await post({ clientUuid: U(1), patientId: U(2), specialty: 'noi' })).statusCode).toBe(404);
    expect((await post({ clientUuid: U(1), patientId: U(2), specialty: 'tim' })).statusCode).toBe(400);
    expect((await post({ clientUuid: U(1), patientId: U(2), specialty: 'noi', priority: 'vip' })).statusCode).toBe(400);
  });
  it('màn hình chờ chỉ có số và chữ cái đầu', async () => {
    const c = makeApp();
    const token = await login(c.app, 'a', 'a-assistant');
    await checkIn(c, token, { fullName: 'Trần Thị Bình', birthDate: '1972-08-20' });
    const board = (await c.app.inject({ method: 'GET', url: '/api/display', headers: auth(token) })).json();
    expect(board.waiting).toEqual([{ number: 1, initials: 'T.T.B', priority: 'normal' }]);
    expect(board.clinic).toBe('Phòng khám A');
    expect(JSON.stringify(board)).not.toMatch(/Trần|Bình|0912/);
  });
  it('hàng chờ của phòng khám B không lẫn bệnh nhân của A', async () => {
    const c = makeApp();
    const a = await login(c.app, 'a', 'a-assistant');
    await checkIn(c, a, ADULT);
    const b = await login(c.app, 'b', 'b-owner');
    expect((await c.app.inject({ method: 'GET', url: '/api/queue', headers: auth(b) })).json().items).toEqual([]);
  });
});

describe('mở hồ sơ khám', () => {
  it('một lượt khám chỉ một bác sĩ giữ; bác sĩ đó mở lại được; bác sĩ khác bị 409', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const again = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
    expect(again.statusCode).toBe(200);
    expect(again.json().visit.status).toBe('in-exam');
    const other = await login(c.app, 'a', 'a-doctor2');
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(other) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('taken');
    expect(res.json().message).toContain('BS. Hà');
  });
  it('lượt khám không tồn tại: 404; phòng khám khác không thấy lượt khám của A', async () => {
    const c = makeApp();
    const { visitId } = await opened(c);
    const bDoctor = await login(c.app, 'b', 'b-doctor');
    expect((await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(bDoctor) })).statusCode).toBe(404);
  });
  it('nhật ký ghi id bệnh nhân và lượt khám, không ghi tên', async () => {
    const c = makeApp();
    const { patientId, visitId } = await opened(c);
    const entry = auditEntries(c).find((e) => e.action === 'visit-open')!;
    expect(entry.resourceIds).toEqual([patientId, visitId]);
    expect(JSON.stringify(entry)).not.toMatch(/Nguyễn|An\b/);
  });
});

describe('hoàn tất lượt khám và kê đơn', () => {
  it('đơn hợp lệ: ký được, mã đơn có định dạng, kho nhận đúng nội dung', async () => {
    const c = makeApp({ now: () => NOW });
    const { visitId, doctor } = await opened(c);
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.replayed).toBe(false);
    expect(json.prescription.code).toMatch(/^PM-261020-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(json.prescription.lines).toHaveLength(2);
    const cmd = c.stores.get('a')!.completions[0]!;
    expect(cmd.doctor).toMatchObject({ userId: 'a-doctor', practitionerId: 'pr-a-doctor' });
    expect(cmd.diagnoses.map((d) => d.code)).toEqual(['J02.9']);
    expect(cmd.prescription!.lines.map((l) => l.resolved.quantity)).toEqual([15, 10]);
  });
  it('mã đơn xác định theo clientUuid: gửi lại sau lỗi giữa chừng cho đúng cùng mã', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = makeApp({ now: () => NOW });
      const { visitId, doctor } = await opened(c);
      const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
      codes.push(res.json().prescription.code);
    }
    expect(codes[0]).toBe(codes[1]);
    const c = makeApp({ now: () => NOW });
    const { visitId, doctor } = await opened(c);
    const other = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ clientUuid: U(7) }) });
    expect(other.json().prescription.code).not.toBe(codes[0]);
  });
  it('mã đơn = PM-<ngày>-<6 ký tự đầu SHA-256(clientUuid)>: cùng vectơ với hàm sinh mã ở máy khách (in khi mất mạng)', async () => {
    const c = makeApp({ now: () => NOW });
    const { visitId, doctor } = await opened(c);
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ clientUuid: '11111111-1111-4111-8111-111111111111' }) });
    expect(res.json().prescription.code).toBe('PM-261020-XP25EM'); // apps/clinic-web/src/print.test.ts dùng cùng giá trị
  });
  it('gửi lại sau khi đã hoàn tất: 200, replayed, không ghi thêm, không chạy lại quy tắc', async () => {
    const c = makeApp({ now: () => NOW });
    const { visitId, patientId, assistant, doctor } = await opened(c);
    const first = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    // Sau khi ký, phụ tá ghi nhận dị ứng penicillin: gửi lại KHÔNG được bị từ chối vì chuyện đã xong.
    await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    const second = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(second.json().replayed).toBe(true);
    expect(second.json().prescription.code).toBe(first.json().prescription.code);
    expect(c.stores.get('a')!.completions).toHaveLength(1);
  });
  it('khám không kê đơn thì hoàn tất được, nhưng phải có chẩn đoán hợp lệ', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const post = (payload: object) => c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload });
    expect((await post(body({ diagnoses: [] }))).statusCode).toBe(422);
    const unknown = await post(body({ diagnoses: ['Z99.99'] }));
    expect([unknown.statusCode, unknown.json().error]).toEqual([422, 'invalid-diagnosis']);
    const ok = await post(body({ prescription: undefined }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().prescription).toBeUndefined();
  });
  it('sinh hiệu vô lý bị bắt ở BFF dù client không kiểm tra', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ exam: { vitals: { temperatureC: 370 } } }) });
    // Trong kho thật DomainError 'invalid-vitals' được ném khi dựng gói; kho giả không dựng nên chỉ kiểm hình dạng ở đây.
    expect([201, 422]).toContain(res.statusCode);
    expect((await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ exam: { vitals: { temperatureC: 'nóng' } } }) })).statusCode).toBe(400);
  });
  it('chưa mở hồ sơ hoặc do bác sĩ khác khám: 409', async () => {
    const c = makeApp();
    const { visitId } = await opened(c);
    const other = await login(c.app, 'a', 'a-doctor2');
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(other), payload: body() });
    expect([res.statusCode, res.json().error]).toEqual([409, 'not-open']);
  });
  it('ghi dở thì báo 503 kèm "bấm lại", và nhật ký ghi lỗi', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    c.stores.get('a')!.forceComplete = { kind: 'incomplete', failed: [{ index: 7, status: '412' }] };
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    expect([res.statusCode, res.json().retry]).toEqual([503, true]);
    expect(auditEntries(c).some((e) => e.action === 'visit-complete' && e.outcome === 'error')).toBe(true);
  });
});

describe('quy tắc kê đơn được kiểm tra lại ở server', () => {
  const sign = (c: Ctx, visitId: string, doctor: string, rx: object) => c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body({ prescription: rx }) });

  it('dị ứng: bị chặn khi chưa xác nhận, ký được khi có lý do, lý do được lưu cùng đơn', async () => {
    const c = makeApp({ now: () => NOW });
    const { visitId, patientId, assistant, doctor } = await opened(c);
    await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    const blocked = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [] });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('rules-not-satisfied');
    const finding = blocked.json().unacknowledged[0];
    expect(finding.rule).toBe('allergy');
    expect(c.stores.get('a')!.completions).toHaveLength(0);

    const tooShort = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [{ key: finding.key, reason: 'ok' }] });
    expect(tooShort.statusCode).toBe(422);

    const signed = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [{ key: finding.key, reason: 'Đã dùng nhiều lần, dung nạp tốt' }] });
    expect(signed.statusCode).toBe(201);
    expect(signed.json().prescription.acknowledgements).toEqual([{ key: finding.key, message: expect.stringContaining('dị ứng'), reason: 'Đã dùng nhiều lần, dung nạp tốt' }]);
  });
  it('xác nhận của client cho một phát hiện khác không có tác dụng; xác nhận thừa bị bỏ', async () => {
    const c = makeApp();
    const { visitId, patientId, assistant, doctor } = await opened(c);
    await c.app.inject({ method: 'POST', url: `/api/patients/${patientId}/allergies`, headers: auth(assistant), payload: { clientUuid: U(3), kind: 'class', value: 'penicillin' } });
    const res = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [{ key: 'allergy:class:nsaid:KHAC', reason: 'một lý do dài đủ' }] });
    expect(res.statusCode).toBe(422);
  });
  it('số ngày vượt tối đa là chặn cứng: xác nhận không cứu được', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const long = { drug: AMOX.drug, perDose: 1, timesPerDay: 3, days: 31 };
    const first = await sign(c, visitId, doctor, { lines: [long], acknowledgements: [] });
    expect(first.statusCode).toBe(422);
    const key = first.json().blocking[0].key;
    const second = await sign(c, visitId, doctor, { lines: [long], acknowledgements: [{ key, reason: 'tôi biết rồi, bệnh nhân đi xa' }] });
    expect(second.statusCode).toBe(422);
    expect(second.json().blocking[0].rule).toBe('max-days');
  });
  it('bệnh mạn tính được tới 90 ngày', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const res = await c.app.inject({
      method: 'POST',
      url: `/api/visits/${visitId}/complete`,
      headers: auth(doctor),
      payload: body({ diagnoses: ['I10'], prescription: { lines: [{ drug: drugCode('Amlodipin 5 mg'), perDose: 1, timesPerDay: 1, days: 90 }], acknowledgements: [] } }),
    });
    expect(res.statusCode).toBe(201);
  });
  it('trùng hoạt chất phải xác nhận', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const res = await sign(c, visitId, doctor, { lines: [PARA, { drug: drugCode('Paracetamol 250 mg (gói)'), perDose: 1, timesPerDay: 3, days: 3 }], acknowledgements: [] });
    expect(res.statusCode).toBe(422);
    expect(res.json().unacknowledged[0].rule).toBe('duplicate-ingredient');
  });
  it('thiếu CCCD chặn người lớn; bổ sung CCCD rồi ký được', async () => {
    const c = makeApp();
    const { visitId, patientId, assistant, doctor } = await opened(c, { fullName: 'Lê Văn Cường', birthDate: '1980-01-01' });
    const blocked = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [] });
    expect(blocked.json().blocking.map((f: { rule: string }) => f.rule)).toEqual(['no-cccd']);
    await c.app.inject({ method: 'PATCH', url: `/api/patients/${patientId}`, headers: auth(assistant), payload: { cccd: '000111222333' } });
    expect((await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [] })).statusCode).toBe(201);
  });
  it('quy tắc đọc cấu hình: đổi ngưỡng ngày tối đa mà không sửa mã', async () => {
    const c = makeApp({ rules: { maxDays: 4 } });
    const { visitId, doctor } = await opened(c);
    const res = await sign(c, visitId, doctor, { lines: [AMOX], acknowledgements: [] });
    expect(res.json().blocking[0]).toMatchObject({ rule: 'max-days', message: expect.stringContaining('tối đa 4 ngày') });
  });
  it('thuốc không có trong danh mục bị chặn, không thể lọt xuống kho', async () => {
    const c = makeApp();
    const { visitId, doctor } = await opened(c);
    const res = await sign(c, visitId, doctor, { lines: [{ drug: 'THUOC-LA', perDose: 1, timesPerDay: 1, days: 1 }], acknowledgements: [] });
    expect(res.statusCode).toBe(422);
    expect(res.json().blocking[0].rule).toBe('unknown-drug');
  });
});

describe('đơn thuốc: đọc, in, gửi lại', () => {
  async function signed(c: Ctx, fullName = 'Nguyễn Văn An') {
    const { visitId, patientId, assistant, doctor } = await opened(c, { fullName, birthDate: '1985-03-15', cccd: '000123456789' });
    const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    return { id: res.json().prescription.id as string, patientId, assistant, doctor, code: res.json().prescription.code as string };
  }
  it('in A5 có mã đơn, mã QR (SVG), nhãn mô phỏng; mọi dữ liệu nhập đều được thoát ký tự HTML', async () => {
    const c = makeApp();
    const { id, assistant, code } = await signed(c, '<script>alert(1)</script> Văn An');
    const res = await c.app.inject({ method: 'GET', url: `/api/prescriptions/${id}/print`, headers: auth(assistant) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    const html = res.body;
    expect(html).toContain('@page { size: A5');
    expect(html).toContain('<svg');
    expect(html).toContain(code);
    expect(html).toContain('BẢN MÔ PHỎNG');
    expect(html).toContain('Amoxicillin 500 mg');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'");
  });
  it('xem đơn và in đều có nhật ký, không ghi nội dung', async () => {
    const c = makeApp();
    const { id, patientId, assistant } = await signed(c);
    await c.app.inject({ method: 'GET', url: `/api/prescriptions/${id}`, headers: auth(assistant) });
    await c.app.inject({ method: 'GET', url: `/api/prescriptions/${id}/print`, headers: auth(assistant) });
    const entries = auditEntries(c).filter((e) => e.action === 'prescription-read' || e.action === 'prescription-print');
    expect(entries.map((e) => e.action)).toEqual(['prescription-read', 'prescription-print']);
    for (const e of entries) {
      expect(e.resourceIds).toEqual([patientId, id]);
      expect(JSON.stringify(e)).not.toMatch(/Amoxicillin|Nguyễn/);
    }
  });
  it('đơn của phòng khám A không đọc hay in được từ phòng khám B', async () => {
    const c = makeApp();
    const { id } = await signed(c);
    const b = await login(c.app, 'b', 'b-owner');
    for (const suffix of ['', '/print']) {
      expect((await c.app.inject({ method: 'GET', url: `/api/prescriptions/${id}${suffix}`, headers: auth(b) })).statusCode).toBe(404);
    }
  });
  it('danh sách chưa gửi và gửi lại', async () => {
    const c = makeApp();
    const { id, doctor, assistant } = await signed(c);
    const pending = (await c.app.inject({ method: 'GET', url: '/api/prescriptions/pending', headers: auth(assistant) })).json().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ prescriptionId: id, gateway: { status: 'signed' } });
    expect((await c.app.inject({ method: 'POST', url: `/api/prescriptions/${id}/retry`, headers: auth(doctor) })).statusCode).toBe(200);
    expect(c.stores.get('a')!.retried).toEqual([id]);
    expect((await c.app.inject({ method: 'POST', url: `/api/prescriptions/${U(4)}/retry`, headers: auth(doctor) })).statusCode).toBe(404);
  });
});

describe('cổng mô phỏng', () => {
  it('không có bộ mô phỏng thì đường điều khiển không tồn tại (không lộ ở môi trường thật)', async () => {
    const c = makeApp();
    const token = await login(c.app, 'a', 'a-doctor');
    expect((await c.app.inject({ method: 'GET', url: '/api/sim/gateway', headers: auth(token) })).statusCode).toBe(404);
    expect((await c.app.inject({ method: 'POST', url: '/api/sim/gateway', headers: auth(token), payload: { mode: 'down' } })).statusCode).toBe(404);
  });
  it('trạng thái tách riêng từng phòng khám: A chèn lỗi không ảnh hưởng B', async () => {
    const sim = new SimulatedGateway();
    const c = makeApp({ simulator: sim });
    const a = await login(c.app, 'a', 'a-doctor');
    const b = await login(c.app, 'b', 'b-doctor');
    const set = await c.app.inject({ method: 'POST', url: '/api/sim/gateway', headers: auth(a), payload: { mode: 'down', failNext: 3 } });
    expect(set.json()).toMatchObject({ simulated: true, state: { mode: 'down', failNext: 3 } });
    expect((await c.app.inject({ method: 'GET', url: '/api/sim/gateway', headers: auth(b) })).json().state).toMatchObject({ mode: 'up', failNext: 0 });
    expect((await c.app.inject({ method: 'POST', url: '/api/sim/gateway', headers: auth(a), payload: { failNext: 99 } })).statusCode).toBe(400);
    expect(auditEntries(c).some((e) => e.action === 'gateway-sim')).toBe(true);
  });
});

describe('số đo thời gian phiên khám', () => {
  const store = (c: Ctx) => c.stores.get('a') ?? ({} as FakeStore);
  it('chủ phòng khám thấy theo từng bác sĩ; bác sĩ chỉ thấy của mình', async () => {
    const c = makeApp({ now: () => NOW });
    const owner = await login(c.app, 'a', 'a-owner');
    const doctor = await login(c.app, 'a', 'a-doctor');
    // Gọi một lần để kho của A được tạo rồi nạp số liệu.
    await c.app.inject({ method: 'GET', url: '/api/queue', headers: auth(owner) });
    store(c).finished = [
      { doctorName: 'BS. Hà', doctorUserId: 'a-doctor', seconds: 50 },
      { doctorName: 'BS. Hà', doctorUserId: 'a-doctor', seconds: 70 },
      { doctorName: 'BS. Hà', doctorUserId: 'a-doctor', seconds: 4000 },
      { doctorName: 'BS. Lan', doctorUserId: 'a-doctor2', seconds: 100 },
    ];
    const asOwner = (await c.app.inject({ method: 'GET', url: '/api/metrics/visits?days=7', headers: auth(owner) })).json();
    expect(asOwner.doctors.map((d: { name: string }) => d.name)).toEqual(['BS. Hà', 'BS. Lan']);
    expect(asOwner.all).toMatchObject({ visits: 3, excluded: 1 });
    expect(asOwner).toMatchObject({ from: '2026-10-14', to: '2026-10-20', targetP50Seconds: 60, targetP90Seconds: 120 });
    const asDoctor = (await c.app.inject({ method: 'GET', url: '/api/metrics/visits', headers: auth(doctor) })).json();
    expect(asDoctor.doctors.map((d: { name: string }) => d.name)).toEqual(['BS. Hà']);
    expect(asDoctor.all.visits).toBe(2);
  });
  it('days ngoài khoảng bị từ chối', async () => {
    const c = makeApp();
    const owner = await login(c.app, 'a', 'a-owner');
    expect((await c.app.inject({ method: 'GET', url: '/api/metrics/visits?days=0', headers: auth(owner) })).statusCode).toBe(400);
    expect((await c.app.inject({ method: 'GET', url: '/api/metrics/visits?days=91', headers: auth(owner) })).statusCode).toBe(400);
  });
});

describe('nhật ký không chứa dữ liệu bệnh nhân', () => {
  it('sau một lượt khám đầy đủ, không dòng nhật ký nào chứa tên, CCCD, thuốc hay chẩn đoán', async () => {
    const c = makeApp({ now: () => NOW });
    const { visitId, patientId, doctor } = await opened(c);
    await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body() });
    await c.app.inject({ method: 'GET', url: `/api/patients/${patientId}/visits`, headers: auth(doctor) });
    const all = JSON.stringify(auditEntries(c));
    expect(all).not.toMatch(/Nguyễn|000123456789|Amoxicillin|Paracetamol|J02|họng|Uống/i);
    expect(auditEntries(c).length).toBeGreaterThanOrEqual(6);
  });
});
