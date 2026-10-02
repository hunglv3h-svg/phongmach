import { describe, expect, it } from 'vitest';
import { drugCode, type LineInput } from '@phongmach/catalogs';
import { ageInYears, checkPrescription, formatAge, judge, type Allergy, type RuleContext } from '../src/index.js';

const L = (name: string, extra: Partial<LineInput> = {}): LineInput => ({ drug: drugCode(name), ...extra });
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  specialty: 'noi',
  patient: { ageYears: 40, hasCccd: true },
  allergies: [],
  diagnoses: ['J02.9'],
  ...over,
});
const rules = (findings: ReturnType<typeof checkPrescription>) => findings.map((f) => f.rule);

const AMOX = L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 });
const PARA = L('Paracetamol 500 mg', { perDose: 1, quantity: 10 });

describe('đơn hợp lệ', () => {
  it('không có phát hiện nào', () => {
    expect(checkPrescription([AMOX, PARA], ctx())).toEqual([]);
  });
});

describe('trường bắt buộc', () => {
  it('chặn khi chưa có chẩn đoán hoặc chưa có thuốc', () => {
    const f = checkPrescription([], ctx({ diagnoses: [] }));
    expect(rules(f)).toEqual(['no-diagnosis', 'no-lines']);
    expect(f.every((x) => x.severity === 'block')).toBe(true);
  });
  it('chặn khi thiếu liều hoặc số lượng, nêu rõ thiếu gì', () => {
    const [f] = checkPrescription([L('Amoxicillin 500 mg')], ctx());
    expect(f!.rule).toBe('incomplete-line');
    expect(f!.message).toContain('liều/cách dùng và số lượng');
    // Thuốc nhi dạng gói để trống liều: bác sĩ phải nhập.
    const paed = checkPrescription([L('Paracetamol 150 mg (gói)')], ctx());
    expect(paed.some((x) => x.rule === 'incomplete-line')).toBe(true);
  });
  it('thuốc dùng khi cần: đủ khi có liều và số lượng nhập tay', () => {
    expect(checkPrescription([PARA], ctx())).toEqual([]);
    expect(rules(checkPrescription([L('Paracetamol 500 mg', { perDose: 1 })], ctx()))).toEqual(['incomplete-line']);
  });
  it('mã thuốc lạ bị chặn', () => {
    expect(rules(checkPrescription([{ drug: 'KHONG-CO' }], ctx()))).toEqual(['unknown-drug']);
  });
  it('CCCD: chặn người từ 14 tuổi chưa có, không áp cho trẻ nhỏ, tắt được bằng cấu hình', () => {
    const noCccd = ctx({ patient: { ageYears: 40, hasCccd: false } });
    expect(rules(checkPrescription([AMOX], noCccd))).toEqual(['no-cccd']);
    expect(checkPrescription([AMOX], ctx({ patient: { ageYears: 5, hasCccd: false, weightKg: 18 }, specialty: 'nhi' }))).not.toContainEqual(expect.objectContaining({ rule: 'no-cccd' }));
    expect(checkPrescription([AMOX], noCccd, { requireCccd: 'off' })).toEqual([]);
    expect(checkPrescription([AMOX], noCccd, { requireCccd: 'ack' })[0]!.severity).toBe('ack');
  });
});

describe('số ngày tối đa', () => {
  it('30 ngày với bệnh thường, chặn khi vượt', () => {
    const f = checkPrescription([L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 31 })], ctx());
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'max-days', severity: 'block' });
    expect(f[0]!.message).toContain('tối đa 30 ngày');
    expect(f[0]!.message).toContain('bệnh mạn tính');
  });
  it('đúng 30 ngày thì được', () => {
    expect(checkPrescription([L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 30 })], ctx())).toEqual([]);
  });
  it('bệnh mạn tính cho tới 90 ngày, không hơn', () => {
    const chronic = ctx({ diagnoses: ['I10'] });
    expect(checkPrescription([L('Amlodipin 5 mg', { perDose: 1, timesPerDay: 1, days: 90 })], chronic)).toEqual([]);
    expect(rules(checkPrescription([L('Amlodipin 5 mg', { perDose: 1, timesPerDay: 1, days: 91 })], chronic))).toEqual(['max-days']);
  });
  it('giới hạn lấy từ cấu hình', () => {
    expect(rules(checkPrescription([L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 8 })], ctx(), { maxDays: 7 }))).toEqual(['max-days']);
  });
});

describe('trùng hoạt chất', () => {
  it('hai thuốc cùng hoạt chất (khác hàm lượng) phải xác nhận', () => {
    const f = checkPrescription([PARA, L('Paracetamol 150 mg (gói)', { perDose: 1, timesPerDay: 3, days: 3 })], ctx({ patient: { ageYears: 40, hasCccd: true } }));
    const dup = f.find((x) => x.rule === 'duplicate-ingredient')!;
    expect(dup.severity).toBe('ack');
    expect(dup.lines).toEqual([0, 1]);
    expect(dup.key).toBe('dup:paracetamol');
  });
  it('thuốc phối hợp trùng với thuốc đơn chất', () => {
    const f = checkPrescription([L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 5 }), L('Amoxicillin + acid clavulanic 625 mg', { perDose: 1, timesPerDay: 2, days: 5 })], ctx());
    expect(f.find((x) => x.rule === 'duplicate-ingredient')!.key).toBe('dup:amoxicillin');
  });
  it('khóa không đổi khi đổi thứ tự dòng', () => {
    const a = checkPrescription([PARA, L('Paracetamol 250 mg (gói)', { perDose: 1, timesPerDay: 3, days: 3 })], ctx());
    const b = checkPrescription([L('Paracetamol 250 mg (gói)', { perDose: 1, timesPerDay: 3, days: 3 }), PARA], ctx());
    expect(a.find((x) => x.rule === 'duplicate-ingredient')!.key).toBe(b.find((x) => x.rule === 'duplicate-ingredient')!.key);
  });
});

describe('dị ứng', () => {
  const penicillin: Allergy = { kind: 'class', value: 'penicillin', label: 'Penicillin' };
  it('cảnh báo thuốc cùng nhóm với dị ứng đã ghi', () => {
    const f = checkPrescription([AMOX], ctx({ allergies: [penicillin] }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'allergy', severity: 'ack', lines: [0], key: `allergy:class:penicillin:${AMOX.drug}` });
    expect(f[0]!.message).toContain('Penicillin');
  });
  it('không cảnh báo thuốc khác nhóm; dị ứng nhóm beta-lactam bao cả penicillin và cephalosporin', () => {
    expect(checkPrescription([PARA], ctx({ allergies: [penicillin] }))).toEqual([]);
    const beta: Allergy = { kind: 'class', value: 'beta-lactam', label: 'Beta-lactam' };
    const f = checkPrescription([AMOX, L('Cefuroxim 500 mg', { perDose: 1, timesPerDay: 2, days: 5 })], ctx({ allergies: [beta] }));
    expect(f.filter((x) => x.rule === 'allergy')).toHaveLength(2);
  });
  it('dị ứng theo hoạt chất, kể cả thuốc phối hợp', () => {
    const ing: Allergy = { kind: 'ingredient', value: 'amoxicillin', label: 'amoxicillin' };
    const combo = L('Amoxicillin + acid clavulanic 625 mg', { perDose: 1, timesPerDay: 2, days: 5 });
    expect(rules(checkPrescription([combo], ctx({ allergies: [ing] })))).toEqual(['allergy']);
  });
});

describe('trẻ em', () => {
  const child = (ageYears: number, weightKg?: number): RuleContext => ctx({ specialty: 'nhi', patient: { ageYears, hasCccd: false, weightKg } });
  it('chưa ghi cân nặng thì phải xác nhận', () => {
    expect(rules(checkPrescription([AMOX], child(4)))).toContain('no-weight');
    expect(rules(checkPrescription([AMOX], child(4, 16)))).not.toContain('no-weight');
    expect(rules(checkPrescription([AMOX], child(13)))).not.toContain('no-weight');
  });
  it('trẻ dưới 6 tuổi dùng thuốc viên thì phải xác nhận, dạng gói thì không', () => {
    expect(rules(checkPrescription([AMOX], child(4, 16)))).toEqual(['paediatric-form']);
    const sachet = L('Amoxicillin 250 mg (gói)', { perDose: 1, timesPerDay: 3, days: 5 });
    expect(checkPrescription([sachet], child(4, 16))).toEqual([]);
    expect(checkPrescription([AMOX], child(7, 24))).toEqual([]);
  });
});

describe('thiếu ngày sinh', () => {
  it('không bỏ qua trong im lặng: phải xác nhận', () => {
    const f = checkPrescription([AMOX], ctx({ patient: { ageYears: undefined, hasCccd: false } }));
    expect(rules(f)).toEqual(['no-birthdate']);
    expect(f[0]!.severity).toBe('ack');
  });
});

describe('xác nhận (judge)', () => {
  const allergy: Allergy = { kind: 'class', value: 'penicillin', label: 'Penicillin' };
  it('block thì không ký được dù có xác nhận', () => {
    const f = checkPrescription([L('Amoxicillin 500 mg', { perDose: 1, timesPerDay: 3, days: 31 })], ctx());
    const v = judge(f, [{ key: f[0]!.key, reason: 'bệnh nhân đã dùng nhiều lần' }]);
    expect(v.canSign).toBe(false);
    expect(v.blocking).toHaveLength(1);
  });
  it('ack cần lý do đủ dài mới tính', () => {
    const f = checkPrescription([AMOX], ctx({ allergies: [allergy] }));
    expect(judge(f, []).canSign).toBe(false);
    expect(judge(f, [{ key: f[0]!.key, reason: '  ok ' }]).canSign).toBe(false);
    const v = judge(f, [{ key: f[0]!.key, reason: 'Đã từng dùng, dung nạp tốt' }]);
    expect(v.canSign).toBe(true);
    expect(v.acknowledged[0]).toMatchObject({ rule: 'allergy', reason: 'Đã từng dùng, dung nạp tốt' });
  });
  it('xác nhận của một phát hiện không áp cho phát hiện khác', () => {
    const f = checkPrescription([AMOX, L('Amoxicillin 250 mg (gói)', { perDose: 1, timesPerDay: 3, days: 5 })], ctx({ allergies: [allergy] }));
    expect(f.filter((x) => x.severity === 'ack').length).toBeGreaterThanOrEqual(3); // 2 dị ứng + 1 trùng hoạt chất
    const one = judge(f, [{ key: f.find((x) => x.rule === 'allergy')!.key, reason: 'Đã cân nhắc kỹ' }]);
    expect(one.canSign).toBe(false);
    expect(one.unacknowledged.length).toBe(f.length - 1);
  });
  it('xác nhận cũ không còn phát hiện tương ứng bị bỏ qua', () => {
    const v = judge([], [{ key: 'allergy:class:penicillin:X', reason: 'đã không còn dùng' }]);
    expect(v).toMatchObject({ canSign: true, acknowledged: [] });
  });
});

describe('tuổi', () => {
  const now = new Date('2026-10-20T03:00:00Z');
  it('tính tuổi tròn năm', () => {
    expect(ageInYears('1985-03-15', now)).toBe(41);
    expect(ageInYears('1985-10-21', now)).toBe(40);
    expect(ageInYears('1985-10-20', now)).toBe(41);
    expect(ageInYears('2030-01-01', now)).toBeUndefined();
    expect(ageInYears(undefined, now)).toBeUndefined();
    expect(ageInYears('15/03/1985', now)).toBeUndefined();
  });
  it('hiển thị tuổi: dưới 2 tuổi theo tháng', () => {
    expect(formatAge('1985-03-15', now)).toBe('41 tuổi');
    expect(formatAge('2025-03-15', now)).toBe('19 tháng');
    expect(formatAge('2026-10-10', now)).toBe('sơ sinh');
    expect(formatAge('2019-01-25', now)).toBe('7 tuổi');
  });
});
