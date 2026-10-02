import { TEMPLATES, drugCode, getDrug } from '@phongmach/catalogs';
import { describe, expect, it } from 'vitest';
import { addPrevious, addTemplate, applyTemplate, describeLine, evaluate, lineFromDrug, lineFromPrevious, lineFromTemplate, newDraft, parseNum, toCompleteRequest, toLineInput, toVitals, withInstruction } from './draft';

const amox = () => lineFromDrug(getDrug(drugCode('Amoxicillin 500 mg'))!);
const adult = { birthDate: '1985-03-15', cccdMasked: '••••6789' };
const NOW = new Date('2026-10-20T03:00:00Z');

describe('số nhập tay', () => {
  it('chấp nhận dấu phẩy và dấu chấm; rỗng là không có; sai là NaN', () => {
    expect(parseNum('37,5')).toBe(37.5);
    expect(parseNum(' 37.5 ')).toBe(37.5);
    expect(parseNum('')).toBeUndefined();
    expect(parseNum('abc')).toBeNaN();
    expect(parseNum('1,')).toBeNaN();
    expect(parseNum('-3')).toBeNaN();
  });
  it('sinh hiệu: gom số hợp lệ, liệt kê ô sai', () => {
    const d = newDraft();
    d.vitals.temperatureC = '38,2';
    d.vitals.pulse = 'chín mươi';
    d.vitals.weightKg = '62';
    expect(toVitals(d)).toEqual({ vitals: { temperatureC: 38.2, weightKg: 62 }, invalid: ['pulse'] });
  });
});

describe('dòng thuốc', () => {
  it('lấy liều mặc định của danh mục và tự sinh cách dùng, số lượng', () => {
    const l = amox();
    expect(l).toMatchObject({ perDose: '1', timesPerDay: '3', days: '5' });
    expect(describeLine(l)).toMatchObject({ instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15, auto: 'Uống 1 viên x 3 lần/ngày' });
  });
  it('đổi liều thì cách dùng và số lượng đổi theo', () => {
    const l = { ...amox(), days: '7', timesPerDay: '2' };
    expect(describeLine(l)).toMatchObject({ instruction: 'Uống 1 viên x 2 lần/ngày', quantity: 14 });
  });
  it('cách dùng gõ tay thắng; gõ lại đúng bản tự sinh thì bỏ ghi đè', () => {
    const typed = withInstruction(amox(), 'Uống 1 viên khi no');
    expect(typed.instruction).toBe('Uống 1 viên khi no');
    expect(describeLine(typed).instruction).toBe('Uống 1 viên khi no');
    const back = withInstruction(typed, 'Uống 1 viên x 3 lần/ngày');
    expect(back.instruction).toBeUndefined();
    expect(withInstruction(typed, '  ').instruction).toBeUndefined();
  });
  it('thuốc nhi dạng gói để trống liều: chưa đủ cho tới khi bác sĩ nhập', () => {
    const l = lineFromDrug(getDrug(drugCode('Paracetamol 150 mg (gói)'))!);
    expect(l.perDose).toBe('');
    expect(describeLine(l).instruction).toBe('');
  });
  it('ô nhập sai không lọt vào yêu cầu gửi đi', () => {
    expect(toLineInput({ ...amox(), perDose: 'x', days: '' })).toEqual({ drug: drugCode('Amoxicillin 500 mg'), timesPerDay: 3 });
  });
});

describe('đơn mẫu và kê lại', () => {
  it('đơn mẫu điền chẩn đoán, lý do, thuốc, lời dặn; không ghi đè chẩn đoán bác sĩ đã chọn', () => {
    const t = TEMPLATES.find((x) => x.id === 'viem-hong-cap')!;
    const d = applyTemplate(newDraft(), t);
    expect(d.diagnoses).toEqual(['J02.9']);
    expect(d.reason).toBe('Đau họng, sốt');
    expect(d.lines.map((l) => l.drug)).toEqual(t.lines.map((l) => l.drug));
    expect(d.advice).toBe(t.advice);
    const chosen = { ...newDraft('Ho kéo dài'), diagnoses: ['J20.9'] };
    const d2 = applyTemplate(chosen, t);
    expect(d2.diagnoses).toEqual(['J20.9']);
    expect(d2.reason).toBe('Ho kéo dài');
  });
  it('mọi đơn mẫu đều dựng được các dòng thuốc hợp lệ (không mã thuốc lạ)', () => {
    for (const t of TEMPLATES) {
      for (const line of t.lines) expect(lineFromTemplate(line), `${t.id}: ${line.drug}`).toBeDefined();
    }
  });
  it('đơn mẫu có thể kê ra đơn hợp lệ chỉ với thao tác điền thêm liều nếu cần (người lớn)', () => {
    const t = TEMPLATES.find((x) => x.id === 'viem-hong-cap')!;
    const d = applyTemplate(newDraft(), t);
    const { findings } = evaluate(d, { specialty: 'noi', patient: adult, allergies: [] }, undefined, NOW);
    expect(findings).toEqual([]);
  });
  it('kê lại: sao chép liều từ đơn cũ, giữ cách dùng gõ tay, UUID mới', () => {
    const view = { drug: drugCode('Amoxicillin 500 mg'), name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15, perDose: 1, timesPerDay: 3, days: 5 };
    const l = lineFromPrevious(view);
    expect(l).toMatchObject({ perDose: '1', timesPerDay: '3', days: '5', quantity: '15' });
    expect(l.instruction).toBeUndefined();
    expect(lineFromPrevious({ ...view, instruction: 'Uống sau ăn' }).instruction).toBe('Uống sau ăn');
    expect(newDraft().clientUuid).not.toBe(newDraft().clientUuid);
  });
});

describe('thêm đơn mẫu và kê lại vào đơn đang soạn', () => {
  const view = { drug: drugCode('Amoxicillin 500 mg'), name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15, perDose: 1, timesPerDay: 3, days: 5 };
  const visit = { encounterId: 'e', date: '2026-10-01T03:00:00Z', specialty: 'noi' as const, vitals: {}, diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp' }], prescription: { id: 'r', code: 'PM-X', signedAt: '2026-10-01T03:00:00Z', patientId: 'p', lines: [view, { ...view, drug: drugCode('Paracetamol 500 mg'), name: 'Paracetamol 500 mg', perDose: 1, timesPerDay: undefined, days: undefined, quantity: 10, instruction: 'Uống khi sốt' }], advice: 'Nghỉ ngơi', followUpDays: 3, acknowledgements: [] } };
  it('kê lại vào đơn trống: đủ thuốc, chẩn đoán, lời dặn, tái khám; xác nhận cũ không mang sang', () => {
    const d = addPrevious({ ...newDraft(), acks: { cu: 'lý do cũ' } }, visit);
    expect(d.lines.map((l) => l.drug)).toEqual([drugCode('Amoxicillin 500 mg'), drugCode('Paracetamol 500 mg')]);
    expect(d).toMatchObject({ diagnoses: ['J02.9'], advice: 'Nghỉ ngơi', followUpDays: '3', acks: {} });
  });
  it('kê lại vào đơn đã có thuốc: chỉ thêm thuốc chưa có, giữ chẩn đoán và lời dặn bác sĩ đã nhập', () => {
    const base = { ...newDraft(), diagnoses: ['J20.9'], advice: 'Lời dặn mới', lines: [amox()] };
    const d = addPrevious(base, visit);
    expect(d.lines).toHaveLength(2);
    expect(d.diagnoses).toEqual(['J20.9']);
    expect(d.advice).toBe('Lời dặn mới');
  });
  it('lượt khám không có đơn thì không đổi gì', () => {
    const d = newDraft();
    expect(addPrevious(d, { ...visit, prescription: undefined })).toBe(d);
  });
  it('thêm đơn mẫu vào đơn đã có thuốc không xóa thuốc cũ và không trùng thuốc', () => {
    const t = TEMPLATES.find((x) => x.id === 'viem-hong-cap')!;
    const d = addTemplate({ ...newDraft(), lines: [amox()] }, t);
    expect(d.lines.map((l) => l.drug).filter((x) => x === drugCode('Amoxicillin 500 mg'))).toHaveLength(1);
    expect(d.lines.length).toBe(t.lines.length);
    expect(addTemplate(newDraft(), t).lines).toHaveLength(t.lines.length);
  });
});

describe('quy tắc trong trình duyệt', () => {
  const draft = () => ({ ...newDraft(), diagnoses: ['J02.9'], lines: [amox()] });
  it('đơn hợp lệ ký được', () => {
    const r = evaluate(draft(), { specialty: 'noi', patient: adult, allergies: [] }, undefined, NOW);
    expect(r.verdict.canSign).toBe(true);
  });
  it('dị ứng cần lý do; điền lý do thì ký được; đổi thuốc khác nhóm thì xác nhận cũ không còn tác dụng', () => {
    const allergies = [{ kind: 'class' as const, value: 'penicillin', label: 'Penicillin' }];
    const d = draft();
    const first = evaluate(d, { specialty: 'noi', patient: adult, allergies }, undefined, NOW);
    expect(first.verdict.canSign).toBe(false);
    const key = first.verdict.unacknowledged[0]!.key;
    const acked = { ...d, acks: { [key]: 'Đã dùng nhiều lần, dung nạp tốt' } };
    expect(evaluate(acked, { specialty: 'noi', patient: adult, allergies }, undefined, NOW).verdict.canSign).toBe(true);
    const changed = { ...acked, lines: [lineFromDrug(getDrug(drugCode('Paracetamol 500 mg'))!)] };
    const r = evaluate({ ...changed, lines: [{ ...changed.lines[0]!, quantity: '10', perDose: '1' }] }, { specialty: 'noi', patient: adult, allergies }, undefined, NOW);
    expect(r.findings).toEqual([]);
  });
  it('cân nặng nhập ở phần sinh hiệu được dùng cho quy tắc trẻ em', () => {
    const child = { birthDate: '2021-06-10' };
    const d = draft();
    const without = evaluate(d, { specialty: 'nhi', patient: child, allergies: [] }, undefined, NOW);
    expect(without.findings.map((f) => f.rule)).toContain('no-weight');
    d.vitals.weightKg = '16';
    const withWeight = evaluate(d, { specialty: 'nhi', patient: child, allergies: [] }, undefined, NOW);
    expect(withWeight.findings.map((f) => f.rule)).not.toContain('no-weight');
  });
});

describe('yêu cầu hoàn tất gửi lên server', () => {
  it('có UUID, sinh hiệu, chẩn đoán, thuốc và các xác nhận; không có đơn thì không có phần đơn', () => {
    const d = { ...newDraft('Đau họng'), diagnoses: ['J02.9'], lines: [amox()], advice: ' Uống nhiều nước ', acks: { k: 'lý do dài đủ' }, followUpDays: '3' };
    d.vitals.temperatureC = '38,5';
    const req = toCompleteRequest(d, true);
    expect(req).toMatchObject({ clientUuid: d.clientUuid, exam: { reason: 'Đau họng', vitals: { temperatureC: 38.5 } }, diagnoses: ['J02.9'] });
    expect(req.prescription).toMatchObject({ advice: 'Uống nhiều nước', followUpDays: 3, acknowledgements: [{ key: 'k', reason: 'lý do dài đủ' }] });
    expect(req.prescription!.lines).toEqual([{ drug: drugCode('Amoxicillin 500 mg'), perDose: 1, timesPerDay: 3, days: 5 }]);
    expect(toCompleteRequest(d, false).prescription).toBeUndefined();
  });
});
