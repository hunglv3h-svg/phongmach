import { drugCode } from '@phongmach/catalogs';
import { describe, expect, it } from 'vitest';
import { FakeStore, auditEntries, login, makeApp } from './helpers.js';

/**
 * Đối soát khoảng trống ghi kép (A2, F11): một đơn ĐÃ KÝ (có List) nhưng KHÔNG có Task gửi tương ứng — bị kẹt, worker
 * (chỉ quét Task) không bao giờ thấy. Mô phỏng ở kho giả bằng cách gỡ `gateway` của đơn: khi đó `pendingPrescriptions`
 * không trả nó về (đúng mô hình: không có Task thì không có dòng pending). Đối soát phải tìm và xếp lại hàng, idempotent.
 *
 * ĐÃ QUAN SÁT ĐỎ: tạm cho `FakeStore.reconcilePrescriptions` trả `{ scanned: 0, requeued: [] }` (không làm gì) thì các khẳng
 * định (b) requeued chứa mã, (c) sau khi quét pending có đơn, (d) idempotent ở lần hai đều ĐỎ. Khôi phục cài đặt đúng → XANH.
 */

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = new Date('2026-10-20T03:00:00Z');
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

type Ctx = ReturnType<typeof makeApp>;

const AMOX = { drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 };
const ADULT = { fullName: 'Nguyễn Văn An', birthDate: '1985-03-15', cccd: '000123456789' };

const body = {
  clientUuid: U(9),
  exam: { reason: 'Đau họng', vitals: { temperatureC: 38 } },
  diagnoses: ['J02.9'],
  prescription: { lines: [AMOX], advice: 'Uống nhiều nước', acknowledgements: [] },
};

/** Tiếp đón + mở hồ sơ + ký một đơn, trả về id đơn và các token. */
async function signOne(c: Ctx) {
  const assistant = await login(c.app, 'a', 'a-assistant');
  const doctor = await login(c.app, 'a', 'a-doctor');
  const p = await c.app.inject({ method: 'POST', url: '/api/patients', headers: auth(assistant), payload: { clientUuid: U(1), phone: '0912345678', ...ADULT } });
  const patientId = p.json().patient.id as string;
  const q = await c.app.inject({ method: 'POST', url: '/api/queue', headers: auth(assistant), payload: { clientUuid: U(6), patientId, specialty: 'noi' } });
  const visitId = q.json().item.id as string;
  await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/open`, headers: auth(doctor) });
  const res = await c.app.inject({ method: 'POST', url: `/api/visits/${visitId}/complete`, headers: auth(doctor), payload: body });
  expect(res.statusCode).toBe(201);
  return { id: res.json().prescription.id as string, code: res.json().prescription.code as string, assistant, doctor };
}

/** Gỡ Task gửi của đơn (mô phỏng khoảng trống ghi kép): đơn đã ký nhưng mất trạng thái gửi. */
function dropSendTask(store: FakeStore, prescriptionId: string): void {
  for (const v of store.visits.values()) {
    if (v.result?.prescription?.id === prescriptionId) delete v.result.prescription.gateway;
  }
}

describe('đối soát hộp thư đi (A2): đơn đã ký nhưng chưa được xếp hàng gửi', () => {
  it('đơn mất Task không hiện ở pending; đối soát xếp lại hàng (có nhật ký không PII); gọi lại idempotent', async () => {
    const c = makeApp({ now: () => NOW });
    const { id, code, doctor } = await signOne(c);
    dropSendTask(c.stores.get('a')!, id);

    // (a) TRƯỚC khi quét: đơn bị kẹt không hiện ở "đơn chưa gửi được".
    const before = (await c.app.inject({ method: 'GET', url: '/api/prescriptions/pending', headers: auth(doctor) })).json().pending;
    expect(before.map((p: { prescriptionId: string }) => p.prescriptionId)).not.toContain(id);

    // (b) Đối soát: trả mã đơn trong requeued và ghi đúng một dòng nhật ký không chứa PII.
    const res = await c.app.inject({ method: 'POST', url: '/api/prescriptions/reconcile', headers: auth(doctor) });
    expect(res.statusCode).toBe(200);
    expect(res.json().requeued).toContain(code);
    const audit = auditEntries(c).filter((e) => e.action === 'prescription-reconcile');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenant: 'a', outcome: 'ok', resultCount: 1 });
    expect(JSON.stringify(audit[0])).not.toMatch(/Nguyễn|000123456789|Amoxicillin|J02/i);

    // (c) SAU khi quét: đơn quay lại pending ở trạng thái "đã ký".
    const after = (await c.app.inject({ method: 'GET', url: '/api/prescriptions/pending', headers: auth(doctor) })).json().pending;
    expect(after.find((p: { prescriptionId: string }) => p.prescriptionId === id)).toMatchObject({ gateway: { status: 'signed' } });

    // (d) Gọi lần hai: không còn đơn nào bị kẹt (idempotent theo mã đơn, không tạo trùng).
    const again = await c.app.inject({ method: 'POST', url: '/api/prescriptions/reconcile', headers: auth(doctor) });
    expect(again.json().requeued).toEqual([]);
  });

  it('phụ tá không được quét đối soát (403)', async () => {
    const c = makeApp();
    const assistant = await login(c.app, 'a', 'a-assistant');
    const res = await c.app.inject({ method: 'POST', url: '/api/prescriptions/reconcile', headers: auth(assistant) });
    expect(res.statusCode).toBe(403);
    expect(auditEntries(c).some((e) => e.action === 'prescription-reconcile' && e.outcome === 'denied')).toBe(true);
  });
});
