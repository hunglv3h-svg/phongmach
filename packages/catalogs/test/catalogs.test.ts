import { describe, expect, it } from 'vitest';
import {
  ALLERGY_CLASSES,
  DRUGS,
  INGREDIENTS,
  ICD10,
  TEMPLATES,
  buildInstruction,
  computeQuantity,
  drugCode,
  getDrug,
  getIcd10,
  resolveLine,
  searchIngredients,
  searchDrugs,
  searchIcd10,
} from '../src/index.js';

describe('toàn vẹn dữ liệu', () => {
  it('mã ICD-10 hợp lệ và không trùng', () => {
    const codes = ICD10.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const e of ICD10) {
      expect(e.code).toMatch(/^[A-Z]\d{2}(\.\d{1,2})?$/);
      expect(e.name.trim().length).toBeGreaterThanOrEqual(2);
    }
  });
  it('mã thuốc không trùng và mọi thuốc có hoạt chất, đơn vị', () => {
    const codes = DRUGS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of DRUGS) {
      expect(d.code).toMatch(/^[A-Z0-9-]+$/);
      expect(d.ingredients.length).toBeGreaterThan(0);
      for (const i of d.ingredients) expect(i).toBe(i.toLowerCase());
      expect(d.unit.length).toBeGreaterThan(0);
    }
  });
  it('drugCode bỏ dấu và chuẩn hóa', () => {
    expect(drugCode('Paracetamol 500 mg')).toBe('PARACETAMOL-500-MG');
    expect(drugCode('Amoxicillin + acid clavulanic 625 mg')).toBe('AMOXICILLIN-ACID-CLAVULANIC-625-MG');
    expect(drugCode('Kẽm 10 mg')).toBe('KEM-10-MG');
  });
  it('đơn mẫu tham chiếu đúng thuốc và ICD-10, liều hợp lệ', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.lines.length).toBeGreaterThan(0);
      for (const code of t.icd10) expect(getIcd10(code), `${t.id}: ICD-10 ${code}`).toBeDefined();
      for (const l of t.lines) {
        const drug = getDrug(l.drug);
        expect(drug, `${t.id}: thuốc ${l.drug}`).toBeDefined();
        const merged = { ...drug!.defaults, ...l };
        if (t.specialty === 'noi' && !drug!.paediatric) {
          // đơn người lớn phải đủ liều để in được ngay
          const instruction = l.instruction ?? buildInstruction(drug!, merged);
          expect(instruction, `${t.id}: ${drug!.name} thiếu cách dùng`).not.toBe('');
          expect(computeQuantity(drug!, merged) ?? l.quantity, `${t.id}: ${drug!.name} thiếu số lượng`).toBeGreaterThan(0);
        }
        if (merged.days) expect(merged.days).toBeLessThanOrEqual(90);
      }
    }
  });
  it('mỗi chuyên khoa có ít nhất 3 đơn mẫu; đơn nhi không có liều tính sẵn cho thuốc theo cân nặng', () => {
    expect(TEMPLATES.filter((t) => t.specialty === 'noi').length).toBeGreaterThanOrEqual(3);
    const nhi = TEMPLATES.filter((t) => t.specialty === 'nhi');
    expect(nhi.length).toBeGreaterThanOrEqual(3);
    for (const t of nhi) {
      for (const l of t.lines) {
        const drug = getDrug(l.drug)!;
        if (drug.paediatric && drug.route === 'uong' && !drug.defaults.asNeeded) expect(l.perDose, `${t.id}: ${drug.name}`).toBeUndefined();
      }
    }
  });
});

describe('cách dùng và số lượng', () => {
  const para = getDrug(drugCode('Paracetamol 500 mg'))!;
  const amox = getDrug(drugCode('Amoxicillin 500 mg'))!;
  const omep = getDrug(drugCode('Omeprazol 20 mg'))!;
  it('sinh cách dùng từ liều', () => {
    expect(buildInstruction(amox, { perDose: 1, timesPerDay: 3 })).toBe('Uống 1 viên x 3 lần/ngày');
    expect(buildInstruction(omep, { perDose: 1, timesPerDay: 1 })).toBe('Uống 1 viên x 1 lần/ngày, buổi sáng, trước ăn 30 phút');
    expect(buildInstruction(para, { perDose: 1 })).toBe('Uống 1 viên mỗi lần khi cần');
    expect(buildInstruction(amox, { perDose: 0.5, timesPerDay: 2, timing: 'sau ăn' })).toBe('Uống 0,5 viên x 2 lần/ngày, sau ăn');
  });
  it('thiếu liều thì trả rỗng để bắt buộc bác sĩ nhập', () => {
    expect(buildInstruction(amox, {})).toBe('');
    expect(buildInstruction(amox, { perDose: 1 })).toBe('');
  });
  it('tính số lượng cho thuốc theo lịch, nhập tay cho thuốc dùng khi cần', () => {
    expect(computeQuantity(amox, { perDose: 1, timesPerDay: 3, days: 5 })).toBe(15);
    expect(computeQuantity(amox, { perDose: 0.5, timesPerDay: 3, days: 5 })).toBe(8); // làm tròn lên
    expect(computeQuantity(amox, { perDose: 1, timesPerDay: 3 })).toBeUndefined();
    expect(computeQuantity(para, { perDose: 1, timesPerDay: 3, days: 5 })).toBeUndefined();
    expect(computeQuantity(para, { quantity: 10 })).toBe(10);
  });
});

describe('tìm kiếm', () => {
  it('ICD-10 theo mã, theo tên có dấu và không dấu', () => {
    expect(searchIcd10('J02.9')[0]?.code).toBe('J02.9');
    expect(searchIcd10('j02')[0]?.code).toBe('J02.9');
    expect(searchIcd10('viem hong')[0]?.code).toBe('J02.9');
    expect(searchIcd10('Viêm họng')[0]?.code).toBe('J02.9');
    expect(searchIcd10('tang huyet ap')[0]?.code).toBe('I10');
    expect(searchIcd10('sot xuat huyet')[0]?.code).toBe('A90');
  });
  it('mã trùng hẳn xếp trước kết quả chỉ chứa mã đó', () => {
    expect(searchIcd10('I10').map((e) => e.code)[0]).toBe('I10');
  });
  it('thuốc theo tên, hoạt chất và đầu từ', () => {
    expect(searchDrugs('para')[0]?.name).toContain('Paracetamol');
    expect(searchDrugs('amox').some((d) => d.name.startsWith('Amoxicillin'))).toBe(true);
    expect(searchDrugs('clavulanic').map((d) => d.name)).toContain('Amoxicillin + acid clavulanic 625 mg');
    expect(searchDrugs('kem')[0]?.name).toMatch(/Kẽm|kem/i);
  });
  it('truy vấn rỗng hoặc không khớp thì trả mảng rỗng; giới hạn số kết quả', () => {
    expect(searchIcd10('')).toEqual([]);
    expect(searchDrugs('zzzzzz')).toEqual([]);
    expect(searchIcd10('viem', 3).length).toBeLessThanOrEqual(3);
  });
  it('thuốc phối hợp có đủ các hoạt chất để phát hiện trùng', () => {
    const ac = getDrug(drugCode('Amoxicillin + acid clavulanic 625 mg'))!;
    expect(ac.ingredients).toEqual(['amoxicillin', 'acid clavulanic']);
    expect(ac.classes).toContain('penicillin');
  });
});

describe('dị ứng và dòng thuốc', () => {
  it('mọi nhóm của thuốc đều có trong danh sách nhóm dị ứng hoặc là nhóm điều trị không dùng cho dị ứng', () => {
    const allergyIds = new Set(ALLERGY_CLASSES.map((c) => c.id));
    for (const id of ['penicillin', 'cephalosporin', 'beta-lactam', 'nsaid', 'sulfonamide']) expect(allergyIds.has(id)).toBe(true);
    // Thuốc nhóm kháng sinh/kháng viêm phải gắn đúng nhóm để đối chiếu dị ứng hoạt động.
    expect(getDrug(drugCode('Amoxicillin 500 mg'))!.classes).toContain('penicillin');
    expect(getDrug(drugCode('Cefuroxim 500 mg'))!.classes).toContain('beta-lactam');
    expect(getDrug(drugCode('Ibuprofen 400 mg'))!.classes).toContain('nsaid');
  });
  it('tìm hoạt chất không dấu', () => {
    expect(searchIngredients('amox')).toContain('amoxicillin');
    expect(searchIngredients('')).toEqual([]);
    expect(INGREDIENTS.length).toBeGreaterThan(60);
  });
  it('cách dùng gõ tay thắng cách dùng tự sinh; số lượng tự tính', () => {
    const drug = getDrug(drugCode('Amoxicillin 500 mg'))!;
    expect(resolveLine(drug, { drug: drug.code, perDose: 1, timesPerDay: 3, days: 5 })).toEqual({ instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15 });
    expect(resolveLine(drug, { drug: drug.code, perDose: 1, timesPerDay: 3, days: 5, instruction: ' Uống khi no ' }).instruction).toBe('Uống khi no');
    expect(resolveLine(drug, { drug: drug.code })).toEqual({ instruction: '' });
  });
});
