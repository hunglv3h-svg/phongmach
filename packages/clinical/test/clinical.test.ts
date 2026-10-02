import type { Bundle, Encounter, List, MedicationRequest, Patient, Task } from '@medplum/fhirtypes';
import { describe, expect, it } from 'vitest';
import { drugCode, getDrug, getIcd10, resolveLine, type LineInput } from '@phongmach/catalogs';
import { DomainError, buildPatient, toPatientSummary } from '@phongmach/fhir-vn-model';
import {
  DEFAULT_RETRY,
  attemptsOf,
  backoffMs,
  buildAllergy,
  buildCheckIn,
  buildCompletionBundle,
  buildHistoryItem,
  buildMedicationRequest,
  buildSendTask,
  buildVitalObservations,
  claim,
  failedEntries,
  cleanVitals,
  initialsOf,
  isDue,
  lineToInput,
  localPrescriptionDetail,
  makePrescriptionCode,
  markCalled,
  markFailed,
  markSent,
  nextNumber,
  parseVitals,
  percentile,
  requeue,
  sortQueue,
  toAllergyView,
  toDisplayBoard,
  toGatewayView,
  toHistoryItem,
  toPrescriptionSummary,
  toQueueItem,
  toVisitSummary,
  toLineView,
  vnDay,
  vnDayRange,
  withdrawAllergy,
  withdrawHistoryItem,
  visitCode,
  type QueueItem,
  type SignedLine,
} from '../src/index.js';

const NOW = new Date('2026-10-20T01:30:00Z'); // 08:30 giờ Việt Nam
const UUID = '11111111-1111-4111-8111-111111111111';
const patient: Patient = { ...buildPatient({ clientUuid: UUID, fullName: 'Nguyễn Văn An', birthDate: '1985-03-15' }), id: 'p1' };

describe('thời gian', () => {
  it('ngày theo giờ Việt Nam, kể cả sau 17:00 UTC', () => {
    expect(vnDay(new Date('2026-10-20T16:59:00Z'))).toBe('2026-10-20');
    expect(vnDay(new Date('2026-10-20T17:00:00Z'))).toBe('2026-10-21');
    expect(vnDayRange('2026-12-31')).toEqual({ start: '2026-12-31T00:00:00+07:00', end: '2027-01-01T00:00:00+07:00' });
  });
  it('phân vị theo hạng gần nhất', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 90)).toBe(90);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe('hàng chờ', () => {
  const enc = (n: number, extra: Partial<Parameters<typeof buildCheckIn>[0]> = {}): Encounter => ({
    ...buildCheckIn({ patientId: 'p1', clientUuid: UUID, specialty: 'noi', priority: 'normal', ...extra }, { day: '2026-10-20', number: n, now: NOW }),
    id: `e${n}`,
  });
  it('mã lượt khám và số thứ tự kế tiếp', () => {
    expect(visitCode('2026-10-20', 7)).toBe('20261020-007');
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([enc(1), enc(5), enc(3)])).toBe(6);
  });
  it('dựng Encounter đúng trạng thái và định danh', () => {
    const e = enc(7, { reason: ' đau họng ' });
    expect(e).toMatchObject({ status: 'arrived', period: { start: NOW.toISOString() }, reasonCode: [{ text: 'đau họng' }] });
    expect(e.identifier?.map((i) => i.value)).toEqual([UUID, '20261020-007']);
  });
  it('từ chối chuyên khoa hoặc ưu tiên lạ', () => {
    expect(() => buildCheckIn({ patientId: 'p1', clientUuid: UUID, specialty: 'x' as never, priority: 'normal' }, { day: '2026-10-20', number: 1, now: NOW })).toThrow(DomainError);
    expect(() => buildCheckIn({ patientId: 'p1', clientUuid: UUID, specialty: 'noi', priority: 'x' as never }, { day: '2026-10-20', number: 1, now: NOW })).toThrow(DomainError);
  });
  it('đọc ngược thành mục hàng chờ', () => {
    const item = toQueueItem({ ...enc(2, { specialty: 'nhi', priority: 'appointment' }), subject: { reference: 'Patient/p1' } }, patient)!;
    expect(item).toMatchObject({ id: 'e2', number: 2, status: 'waiting', priority: 'appointment', specialty: 'nhi', patientId: 'p1', patientName: 'Nguyễn Văn An', birthDate: '1985-03-15' });
  });
  it('bác sĩ mở hồ sơ: đang khám, ghi mốc mở', () => {
    const called = markCalled(enc(1), { id: 'dr1', name: 'BS. Hà' }, NOW);
    const item = toQueueItem(called, patient)!;
    expect(item).toMatchObject({ status: 'in-exam', doctorName: 'BS. Hà', calledAt: NOW.toISOString() });
  });
  it('thứ tự gọi: đang khám, rồi cấp cứu, đã hẹn, thường; đã xong cuối', () => {
    const mk = (number: number, status: QueueItem['status'], priority: QueueItem['priority']): QueueItem => ({ id: `e${number}`, number, code: `c${number}`, status, priority, specialty: 'noi', patientId: 'p', patientName: 'A B', arrivedAt: NOW.toISOString() });
    const sorted = sortQueue([mk(1, 'waiting', 'normal'), mk(2, 'done', 'normal'), mk(3, 'waiting', 'appointment'), mk(4, 'in-exam', 'normal'), mk(5, 'waiting', 'urgent'), mk(6, 'waiting', 'normal')]);
    expect(sorted.map((i) => i.number)).toEqual([4, 5, 3, 1, 6, 2]);
  });
  it('màn hình chờ chỉ có số và chữ cái đầu, không có họ tên', () => {
    const items: QueueItem[] = [
      { id: 'a', number: 1, code: 'c1', status: 'in-exam', priority: 'normal', specialty: 'noi', patientId: 'p', patientName: 'Nguyễn Văn An', arrivedAt: NOW.toISOString() },
      { id: 'b', number: 2, code: 'c2', status: 'waiting', priority: 'normal', specialty: 'noi', patientId: 'p', patientName: 'đặng bảo ngọc', arrivedAt: NOW.toISOString() },
      { id: 'c', number: 3, code: 'c3', status: 'done', priority: 'normal', specialty: 'noi', patientId: 'p', patientName: 'Trần Thị Bình', arrivedAt: NOW.toISOString() },
    ];
    const board = toDisplayBoard('PK A', items, NOW);
    expect(board.inExam).toEqual([{ number: 1, initials: 'N.V.A', priority: 'normal' }]);
    expect(board.waiting).toEqual([{ number: 2, initials: 'Đ.B.N', priority: 'normal' }]);
    const json = JSON.stringify(board);
    for (const name of ['Nguyễn', 'Văn', 'Trần', 'Bình', 'ngọc']) expect(json).not.toContain(name);
    expect(initialsOf('  Lê   Minh Khang ')).toBe('L.M.K');
  });
});

describe('sinh hiệu', () => {
  it('khứ hồi: dựng Observation rồi đọc lại', () => {
    const v = { temperatureC: 38.5, pulse: 96, systolic: 120, diastolic: 80, spo2: 98, weightKg: 62.5, heightCm: 168, respiratoryRate: 18 };
    const obs = buildVitalObservations(v, { patientId: 'p1', encounterId: 'e1', effective: NOW.toISOString() });
    expect(obs).toHaveLength(7); // 6 đơn + 1 huyết áp
    expect(parseVitals(obs)).toEqual(v);
    expect(obs.every((o) => o.subject?.reference === 'Patient/p1' && o.encounter?.reference === 'Encounter/e1')).toBe(true);
  });
  it('bỏ trường trống, bắt số vô lý', () => {
    expect(buildVitalObservations({}, { patientId: 'p', encounterId: 'e', effective: NOW.toISOString() })).toEqual([]);
    expect(() => cleanVitals({ temperatureC: 370 })).toThrow(/ngoài khoảng/);
    expect(() => cleanVitals({ pulse: Number.NaN })).toThrow(/không phải số/);
    expect(() => cleanVitals({ systolic: 120 })).toThrow(/cả số tâm thu/);
    expect(() => cleanVitals({ systolic: 80, diastolic: 120 })).toThrow(/lớn hơn/);
    expect(() => cleanVitals({ weightKg: 0 })).toThrow(DomainError);
  });
});

describe('dị ứng và tiền sử', () => {
  it('ghi dị ứng theo nhóm, đọc lại, rút lại thì biến mất', () => {
    const a = { ...buildAllergy('p1', { clientUuid: UUID, kind: 'class', value: 'Penicillin' }, NOW), id: 'a1' };
    expect(toAllergyView(a)).toMatchObject({ id: 'a1', kind: 'class', value: 'penicillin' });
    expect(toAllergyView(withdrawAllergy(a))).toBeUndefined();
    // Bản ghi rút lại không được còn clinicalStatus (ràng buộc ait-2 của FHIR; Medplum cảnh báo khi vi phạm).
    expect(withdrawAllergy(a).clinicalStatus).toBeUndefined();
    expect(a.clinicalStatus).toBeDefined();
  });
  it('dị ứng theo hoạt chất giữ tên hiển thị; nhóm lạ bị từ chối', () => {
    const a = { ...buildAllergy('p1', { clientUuid: UUID, kind: 'ingredient', value: 'amoxicillin', label: 'Amoxicillin' }, NOW), id: 'a2' };
    expect(toAllergyView(a)).toMatchObject({ kind: 'ingredient', value: 'amoxicillin', label: 'Amoxicillin' });
    expect(() => buildAllergy('p1', { clientUuid: UUID, kind: 'class', value: 'khong-co' }, NOW)).toThrow(DomainError);
    expect(() => buildAllergy('p1', { clientUuid: UUID, kind: 'ingredient', value: '  ' }, NOW)).toThrow(DomainError);
  });
  it('tiền sử là Condition problem-list-item, không lẫn với chẩn đoán lượt khám', () => {
    const h = { ...buildHistoryItem('p1', { clientUuid: UUID, text: ' Tăng huyết áp 5 năm ' }, NOW), id: 'h1' };
    expect(toHistoryItem(h)).toMatchObject({ id: 'h1', text: 'Tăng huyết áp 5 năm' });
    expect(toHistoryItem(withdrawHistoryItem(h))).toBeUndefined();
    expect(withdrawHistoryItem(h).clinicalStatus).toBeUndefined(); // con-5
    expect(() => buildHistoryItem('p1', { clientUuid: UUID, text: ' ' }, NOW)).toThrow(DomainError);
    expect(() => buildHistoryItem('p1', { clientUuid: UUID, text: 'x'.repeat(301) }, NOW)).toThrow(DomainError);
  });
});

const line = (name: string, extra: Partial<LineInput> = {}): SignedLine => {
  const drug = getDrug(drugCode(name))!;
  const input: LineInput = { drug: drug.code, ...extra };
  return { drug, input, resolved: resolveLine(drug, input) };
};

describe('đơn thuốc', () => {
  it('mã đơn nội bộ có tiền tố, ngày và 6 ký tự dễ đọc', () => {
    expect(makePrescriptionCode('2026-10-20', new Uint8Array([0, 1, 31, 32, 255, 10]))).toBe('PM-261020-01Z0ZA');
    const random = new Uint8Array([200, 17, 3, 99, 250, 5]);
    expect(makePrescriptionCode('2026-10-20', random)).toMatch(/^PM-261020-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
  it('khứ hồi một dòng thuốc: dựng MedicationRequest, đọc lại, kê lại', () => {
    const l = line('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 });
    const mr = buildMedicationRequest(l, 0, { patientId: 'p1', encounterId: 'e1', code: 'PM-X', now: NOW, doctor: { id: 'dr1', name: 'BS. Hà' }, diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp' }] });
    expect(mr).toMatchObject({ status: 'active', intent: 'order', groupIdentifier: { value: 'PM-X' } });
    const view = toLineView({ ...mr, id: 'm1' })!;
    expect(view).toMatchObject({ drug: l.drug.code, instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15, perDose: 1, timesPerDay: 3, days: 5, unit: 'viên' });
    // Cách dùng giống bản tự sinh thì không giữ lại, để sửa liều sau đó còn cập nhật được.
    expect(lineToInput(view)).toEqual({ drug: l.drug.code, perDose: 1, timesPerDay: 3, days: 5, quantity: 15 });
    expect(lineToInput({ ...view, instruction: 'Uống 2 viên một lần' }).instruction).toBe('Uống 2 viên một lần');
  });
  it('thuốc dùng khi cần: không có lịch lần/ngày, số lượng nhập tay', () => {
    const l = line('Paracetamol 500 mg', { perDose: 1, quantity: 10, instruction: 'Uống khi sốt' });
    const mr = buildMedicationRequest(l, 0, { patientId: 'p1', encounterId: 'e1', code: 'PM-X', now: NOW, doctor: { name: 'BS' }, diagnoses: [] });
    expect(mr.dosageInstruction?.[0]).toMatchObject({ asNeededBoolean: true, text: 'Uống khi sốt' });
    expect(mr.dosageInstruction?.[0]?.timing).toBeUndefined();
    expect(toLineView({ ...mr, id: 'm' })).toMatchObject({ quantity: 10, perDose: 1 });
  });
});

describe('gói hoàn tất lượt khám', () => {
  const encounter: Encounter = { ...buildCheckIn({ patientId: 'p1', clientUuid: UUID, specialty: 'noi', priority: 'normal', reason: 'Đau họng' }, { day: '2026-10-20', number: 1, now: NOW }), id: 'e1', meta: { versionId: 'v7' } };
  const called = markCalled(encounter, { id: 'dr1', name: 'BS. Hà' }, NOW);
  const dx = [getIcd10('J02.9')!];
  const base = {
    clientUuid: UUID,
    patientId: 'p1',
    encounter: called,
    doctor: { id: 'dr1', name: 'BS. Hà' },
    now: new Date(NOW.getTime() + 90_000),
    exam: { reason: 'Đau họng 2 ngày', symptoms: 'Đau họng, sốt nhẹ', findings: 'Họng đỏ', vitals: { temperatureC: 38, weightKg: 60 } },
    diagnoses: dx,
    visitSeconds: 90,
  };
  const types = (b: Bundle) => (b.entry ?? []).map((e) => e.resource?.resourceType);
  const digestBase64 = () => 'ZGlnZXN0'; // "digest" dạng base64 hợp lệ (Medplum kiểm tra định dạng base64Binary)

  it('khám không kê đơn: không có List, Task, Provenance', () => {
    const b = buildCompletionBundle(base);
    expect(b.type).toBe('transaction');
    expect(types(b)).toEqual(['Observation', 'Observation', 'Condition', 'ClinicalImpression', 'Encounter']);
    const enc = b.entry!.at(-1)!;
    expect(enc.request).toMatchObject({ method: 'PUT', url: 'Encounter/e1', ifMatch: 'W/"v7"' });
    expect(enc.resource).toMatchObject({ status: 'finished', reasonCode: [{ text: 'Đau họng 2 ngày' }], period: { end: base.now.toISOString() } });
  });
  it('kê đơn: List, thuốc, chữ ký mô phỏng và Task cùng một giao dịch, tham chiếu urn khớp', () => {
    const lines = [line('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 }), line('Paracetamol 500 mg', { perDose: 1, quantity: 10 })];
    const b = buildCompletionBundle({ ...base, prescription: { code: 'PM-261020-ABC123', lines, advice: 'Uống nhiều nước', followUpDays: 3, acks: [{ key: 'k', message: 'm', reason: 'đã cân nhắc' }], digestBase64 } });
    expect(types(b)).toEqual(['Observation', 'Observation', 'Condition', 'ClinicalImpression', 'MedicationRequest', 'MedicationRequest', 'List', 'Provenance', 'Task', 'Encounter']);
    const list = b.entry!.find((e) => e.resource?.resourceType === 'List')!;
    const mrUrls = b.entry!.filter((e) => e.resource?.resourceType === 'MedicationRequest').map((e) => e.fullUrl);
    expect((list.resource as List).entry?.map((x) => x.item?.reference)).toEqual(mrUrls);
    const prov = b.entry!.find((e) => e.resource?.resourceType === 'Provenance')!.resource as { target: Array<{ reference: string }>; extension: Array<{ valueBoolean: boolean }>; signature: Array<{ data: string }> };
    expect(prov.target[0]!.reference).toBe(list.fullUrl);
    expect(prov.extension[0]!.valueBoolean).toBe(true); // nhãn mô phỏng
    expect(prov.signature[0]!.data).toBe('ZGlnZXN0');
    const task = b.entry!.find((e) => e.resource?.resourceType === 'Task')!.resource as Task;
    expect(task.focus?.reference).toBe(list.fullUrl);
    expect(task.status).toBe('requested');
    expect(task.identifier?.map((i) => i.value)).toContain('PM-261020-ABC123');
    // Mọi mục đều là giao dịch hợp lệ: có request.
    expect(b.entry!.every((e) => e.request?.method && e.request.url)).toBe(true);
    // Điểm chốt đứng cuối.
    expect(b.entry!.at(-1)!.resource?.resourceType).toBe('Encounter');
  });
  it('khứ hồi toàn bộ: dựng gói, giả lập máy chủ gán id, đọc lại thành VisitSummary', () => {
    const lines = [line('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 })];
    const b = buildCompletionBundle({ ...base, prescription: { code: 'PM-X', lines, advice: 'Nghỉ ngơi', followUpDays: 5, acks: [{ key: 'allergy:x', message: 'Dị ứng X', reason: 'đã dùng trước đây' }], digestBase64 } });
    const res = (t: string) => b.entry!.filter((e) => e.resource?.resourceType === t).map((e, i) => ({ ...e.resource!, id: t === 'Encounter' ? 'e1' : `${t}-${i}` }));
    const requests = res('MedicationRequest') as MedicationRequest[];
    const list = { ...(res('List')[0] as List), entry: requests.map((r) => ({ item: { reference: `MedicationRequest/${r.id}` } })) };
    const task = { ...(res('Task')[0] as Task), id: 't1' };
    const v = toVisitSummary({
      encounter: res('Encounter')[0] as Encounter,
      conditions: res('Condition') as never,
      impression: res('ClinicalImpression')[0] as never,
      observations: res('Observation') as never,
      list,
      requests,
      task,
    })!;
    expect(v).toMatchObject({ encounterId: 'e1', reason: 'Đau họng 2 ngày', symptoms: 'Đau họng, sốt nhẹ', findings: 'Họng đỏ', doctorName: 'BS. Hà', visitSeconds: 90, vitals: { temperatureC: 38, weightKg: 60 } });
    expect(v.diagnoses).toEqual([{ code: 'J02.9', name: getIcd10('J02.9')!.name }]);
    expect(v.prescription).toMatchObject({
      code: 'PM-X',
      advice: 'Nghỉ ngơi',
      followUpDays: 5,
      signerName: 'BS. Hà',
      acknowledgements: [{ key: 'allergy:x', message: 'Dị ứng X', reason: 'đã dùng trước đây' }],
      gateway: { taskId: 't1', status: 'signed', attempts: 0 },
    });
    expect(v.prescription!.lines).toHaveLength(1);
    expect(toPrescriptionSummary({ ...list, date: undefined }, requests)).toBeUndefined();
  });
  it('chạy lại được: mọi mục tạo mới có định danh xác định và ifNoneExist, hai lần dựng cho cùng khóa', () => {
    const lines = [line('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 })];
    const make = (clientUuid: string) => buildCompletionBundle({ ...base, clientUuid, prescription: { code: 'PM-X', lines, acks: [], digestBase64 } });
    const a = make(UUID);
    const keys = (b: Bundle) => b.entry!.filter((e) => e.request?.method === 'POST').map((e) => e.request!.ifNoneExist);
    expect(keys(a)).toEqual(keys(make(UUID)));
    expect(keys(a).every((k) => k && /^(identifier|_tag)=urn:phongmach:client-uuid\|/.test(k))).toBe(true);
    expect(new Set(keys(a)).size).toBe(keys(a).length); // không mục nào dùng chung khóa
    expect(keys(make('22222222-2222-4222-8222-222222222222'))).not.toEqual(keys(a));
    // Điều kiện tạo trùng với định danh trên chính tài nguyên (nếu khác nhau, tạo có điều kiện sẽ không bao giờ khớp).
    for (const e of a.entry!.filter((x) => x.request?.method === 'POST' && x.request.ifNoneExist!.startsWith('identifier='))) {
      const values = ((e.resource as { identifier?: Array<{ value?: string }> }).identifier ?? []).map((i) => i.value);
      expect(values.some((v) => e.request!.ifNoneExist!.endsWith(`|${v}`))).toBe(true);
    }
  });
  it('đơn dựng trên máy khi mất mạng giống hệt đơn máy chủ đọc lại sau khi đồng bộ (tờ in không lệch bản ghi)', () => {
    const inputs: LineInput[] = [
      { drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 },
      { drug: drugCode('Paracetamol 500 mg'), perDose: 1, quantity: 10, instruction: 'Uống khi sốt trên 38,5 độ' },
      { drug: drugCode('Cetirizin 10 mg'), perDose: 1, timesPerDay: 1, days: 14 },
    ];
    const signedAt = '2026-10-20T16:59:30.000Z'; // 23:59 giờ Việt Nam: ngày trên đơn theo giờ ký, không theo lúc đồng bộ
    const acks = [{ key: 'allergy:x', message: 'Dị ứng X', reason: 'đã dùng trước đây' }];
    const signedLines = inputs.map((input) => {
      const drug = getDrug(input.drug)!;
      return { drug, input, resolved: resolveLine(drug, input) };
    });
    // Đường máy chủ: gói hoàn tất, giả lập gán id, đọc ngược.
    const b = buildCompletionBundle({ ...base, now: new Date(signedAt), prescription: { code: 'PM-261020-ABC123', lines: signedLines, advice: '  Uống nhiều nước ', followUpDays: 3, acks, digestBase64 } });
    const res = (t: string) => b.entry!.filter((e) => e.resource?.resourceType === t).map((e, i) => ({ ...e.resource!, id: `${t}-${i}` }));
    const requests = res('MedicationRequest') as MedicationRequest[];
    const list = { ...(res('List')[0] as List), entry: requests.map((r) => ({ item: { reference: `MedicationRequest/${r.id}` } })) };
    const server = toPrescriptionSummary(list, requests, undefined, 'Nguyễn Văn An')!;
    // Đường trên máy.
    const local = localPrescriptionDetail({
      id: 'local-1',
      encounterId: 'e1',
      code: 'PM-261020-ABC123',
      signedAt,
      signerName: 'BS. Hà',
      patient: toPatientSummary(patient),
      diagnoses: ['J02.9'],
      lines: inputs,
      advice: '  Uống nhiều nước ',
      followUpDays: 3,
      acknowledgements: acks,
    });
    const { id: _a, ...serverRest } = server;
    const { id: _b, ...localRest } = local.prescription;
    void _a;
    void _b;
    expect(localRest).toEqual(serverRest);
    expect(local.prescription.lines.map((l) => l.instruction)).toEqual(['Uống 1 viên x 3 lần/ngày', 'Uống khi sốt trên 38,5 độ', expect.any(String)]);
    expect(local.diagnoses).toEqual(res('Condition').map((c) => ({ code: 'J02.9', name: (c as { code: { coding: Array<{ display: string }> } }).code.coding[0]!.display })));
    expect(() => localPrescriptionDetail({ ...local.prescription, encounterId: 'e1', signedAt, signerName: 'x', patient: toPatientSummary(patient), diagnoses: ['Z99.999'], lines: inputs, acknowledgements: [] })).toThrow(DomainError);
    expect(() => localPrescriptionDetail({ ...local.prescription, encounterId: 'e1', signedAt, signerName: 'x', patient: toPatientSummary(patient), diagnoses: ['J02.9'], lines: [{ drug: 'THUOC-LA' }], acknowledgements: [] })).toThrow(DomainError);
  });
  it('phát hiện mục lỗi trong phản hồi dù HTTP 200', () => {
    const response: Bundle = { resourceType: 'Bundle', type: 'transaction-response', entry: [{ response: { status: '201' } }, { response: { status: '412', outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'processing', details: { text: 'Precondition Failed' } }] } } }, { response: { status: '200' } }, { response: { status: '404' } }] };
    expect(failedEntries(response)).toEqual([{ index: 1, status: '412', message: 'Precondition Failed' }, { index: 3, status: '404' }]);
    expect(failedEntries({ resourceType: 'Bundle', type: 'transaction-response', entry: [{ response: { status: '201 Created' } }] })).toEqual([]);
  });
  it('lượt khám chưa có id thì từ chối', () => {
    expect(() => buildCompletionBundle({ ...base, encounter: { ...called, id: undefined } })).toThrow(DomainError);
  });
});

describe('hộp thư đi', () => {
  const t0 = buildSendTask({ listRef: 'List/l1', patientId: 'p1', localCode: 'PM-X', now: NOW });
  const task: Task = { ...t0, id: 't1' };
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  it('mới ký: đến hạn ngay, hiển thị "đã ký"', () => {
    expect(isDue(task, NOW)).toBe(true);
    expect(toGatewayView(task)).toMatchObject({ status: 'signed', attempts: 0 });
  });
  it('gửi lỗi: chờ gửi lại theo lũy thừa 2, có trần', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    const failed = markFailed(claim(task, NOW), 'cổng không phản hồi', NOW);
    expect(failed.status).toBe('on-hold');
    expect(attemptsOf(failed)).toBe(1);
    expect(isDue(failed, later(1_999))).toBe(false);
    expect(isDue(failed, later(2_000))).toBe(true);
    expect(toGatewayView(failed)).toMatchObject({ status: 'retry', attempts: 1, lastError: 'cổng không phản hồi', nextAttemptAt: later(2_000).toISOString() });
  });
  it('quá số lần thì bỏ cuộc (lỗi), không còn đến hạn; gửi lại thủ công đưa về từ đầu', () => {
    let t = task;
    for (let i = 0; i < DEFAULT_RETRY.maxAttempts; i++) t = markFailed(claim(t, NOW), 'lỗi', NOW);
    expect(t.status).toBe('failed');
    expect(isDue(t, later(10 * 60_000))).toBe(false);
    expect(toGatewayView(t)).toMatchObject({ status: 'failed', attempts: DEFAULT_RETRY.maxAttempts });
    const again = requeue(t, later(1000));
    expect(again.status).toBe('requested');
    expect(attemptsOf(again)).toBe(0);
    expect(isDue(again, later(1000))).toBe(true);
  });
  it('lỗi do nội dung đơn (không thử lại được) thì chuyển thẳng sang lỗi', () => {
    const t = markFailed(claim(task, NOW), 'đơn không hợp lệ', NOW, DEFAULT_RETRY, true);
    expect(t.status).toBe('failed');
    expect(toGatewayView(t)).toMatchObject({ status: 'failed', attempts: 1, lastError: 'đơn không hợp lệ' });
  });
  it('gửi được: đã gửi, có mã quốc gia, xóa lỗi cũ khỏi hiển thị', () => {
    const failed = markFailed(claim(task, NOW), 'lỗi tạm', NOW);
    const sent = markSent(claim(failed, later(3000)), 'QG-123', later(3500));
    expect(sent.status).toBe('completed');
    expect(isDue(sent, later(60_000))).toBe(false);
    const v = toGatewayView(sent)!;
    expect(v).toMatchObject({ status: 'sent', nationalCode: 'QG-123', attempts: 2 });
    expect(v.lastError).toBeUndefined();
    expect(v.nextAttemptAt).toBeUndefined();
  });
  it('việc đang gửi bị bỏ dở (BFF sập) được nhận lại sau thời hạn thuê', () => {
    const c = claim(task, NOW);
    expect(isDue(c, later(DEFAULT_RETRY.leaseMs - 1))).toBe(false);
    expect(isDue(c, later(DEFAULT_RETRY.leaseMs))).toBe(true);
    expect(toGatewayView(c)).toMatchObject({ status: 'sending' });
  });
  it('lỗi quá dài bị cắt', () => {
    expect(toGatewayView(markFailed(task, 'x'.repeat(1000), NOW))!.lastError).toHaveLength(300);
  });
});
