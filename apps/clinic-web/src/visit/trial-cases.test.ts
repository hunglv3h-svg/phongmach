// Bộ ca của phiên thử với bác sĩ (M0-1) phải đi được trên ĐÚNG mã bản nháp và bộ quy tắc của màn hình khám: mỗi ca có một đường đi
// (`steps`) mà bài diễn tập bấm trên giao diện; ở đây chạy đường đi đó bằng các hàm thuần của bản nháp, không cần trình duyệt.
// Ca nào không ký được, hoặc không hiện đúng cảnh báo mà phiếu ca hứa, thì đỏ ở đây trước khi ai đó in phiếu.
import { TEMPLATES, getDrug, getIcd10, resolveLine, searchDrugs, searchIcd10, allergyClassLabel } from '@phongmach/catalogs';
import { buildMedicationRequest, toLineView, type VisitSummary } from '@phongmach/clinical';
import { ALL_CASES, TRIAL_WINDOW, type TrialCase } from '@phongmach/trial';
import { describe, expect, it } from 'vitest';
import { addPrevious, addTemplate, emptyVitals, evaluate, lineFromDrug, newDraft, toCompleteRequest, toVitals, type Draft, type VitalField } from './draft';

const NOW = new Date('2026-11-04T02:00:00Z');

/** Lượt khám cũ như máy chủ trả về: dòng thuốc đi qua đúng hai hàm lưu và đọc của đơn thuốc. */
function priorSummary(c: TrialCase): VisitSummary {
  const v = c.prior!;
  const diagnoses = v.dx.map((code) => ({ code, name: getIcd10(code)!.name }));
  const lines = v.lines.map((input, i) => {
    const drug = getDrug(input.drug)!;
    const mr = buildMedicationRequest({ drug, input, resolved: resolveLine(drug, input) }, i, { patientId: 'p', encounterId: 'e', code: 'PM-000000-AAAAAA', now: NOW, doctor: { name: 'BS' }, diagnoses });
    return toLineView(mr)!;
  });
  return {
    encounterId: 'prior',
    date: NOW.toISOString(),
    specialty: c.specialty,
    vitals: v.vitals,
    diagnoses,
    prescription: { id: 'rx', code: 'PM-000000-AAAAAA', signedAt: NOW.toISOString(), patientId: 'p', lines, acknowledgements: [], ...(v.advice ? { advice: v.advice } : {}), ...(v.followUpDays ? { followUpDays: v.followUpDays } : {}) },
  };
}

function run(c: TrialCase, now: Date) {
  const ctx = {
    specialty: c.specialty,
    patient: { birthDate: c.patient.birthDate, ...(c.patient.hasCccd ? { cccdMasked: '••••••••0000' } : {}) },
    allergies: c.allergies.map((a) => ({ kind: a.kind, value: a.value, label: a.kind === 'class' ? allergyClassLabel(a.value) : (a.label ?? a.value) })),
  };
  const vitals = emptyVitals();
  for (const [field, value] of Object.entries(c.vitals)) vitals[field as VitalField] = String(value).replace('.', ',');
  let d: Draft = { ...newDraft(c.reason), vitals };
  const rulesNow = () => evaluate(d, ctx, undefined, now).findings.map((f) => f.rule);
  const setLine = (drug: string, patch: Record<string, string>) => {
    expect(d.lines.some((l) => l.drug === drug), `${c.id}: sửa dòng ${drug} không có trong đơn`).toBe(true);
    d = { ...d, lines: d.lines.map((l) => (l.drug === drug ? { ...l, ...patch } : l)) };
  };

  for (const s of c.steps) {
    switch (s.do) {
      case 'dx':
        d = { ...d, diagnoses: [...d.diagnoses, searchIcd10(s.query, 8)[0]!.code] };
        break;
      case 'template':
        d = addTemplate(d, TEMPLATES.find((t) => t.id === s.id)!);
        break;
      case 'repeat':
        d = addPrevious(d, priorSummary(c));
        break;
      case 'add':
        d = { ...d, lines: [...d.lines, lineFromDrug(searchDrugs(s.query, 8)[0]!)] };
        break;
      case 'remove':
        expect(d.lines.some((l) => l.drug === s.drug), `${c.id}: bỏ dòng ${s.drug} không có trong đơn`).toBe(true);
        d = { ...d, lines: d.lines.filter((l) => l.drug !== s.drug) };
        break;
      case 'set': {
        const { do: _do, drug, ...patch } = s;
        void _do;
        setLine(drug, patch);
        break;
      }
      case 'weight':
        d = { ...d, vitals: { ...d.vitals, weightKg: s.kg } };
        break;
      case 'expect':
        expect(rulesNow(), `${c.id}: phải đang có cảnh báo ${s.rule}`).toContain(s.rule);
        break;
      case 'ack': {
        const hits = evaluate(d, ctx, undefined, now).findings.filter((f) => f.rule === s.rule && f.severity === 'ack');
        expect(hits.length, `${c.id}: không có cảnh báo ${s.rule} để xác nhận`).toBeGreaterThan(0);
        d = { ...d, acks: { ...d.acks, ...Object.fromEntries(hits.map((f) => [f.key, s.reason])) } };
        break;
      }
    }
  }
  return { d, ...evaluate(d, ctx, undefined, now) };
}

describe('bộ ca của phiên thử đi được trên màn hình khám', () => {
  // Hai đầu của khoảng thử: tuổi của bệnh nhân (và các quy tắc theo tuổi) không được làm đổi kết quả.
  const days = [TRIAL_WINDOW.from, TRIAL_WINDOW.to].map((day) => new Date(`${day}T02:00:00Z`));

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: đi hết đường đi thì ký được, đơn và cảnh báo đúng như phiếu ca ghi', (_id, c) => {
    for (const now of days) {
      const { d, findings, verdict } = run(c, now);
      expect(toVitals(d).invalid, 'sinh hiệu trên phiếu phải nhập được').toEqual([]);
      expect(verdict.blocking.map((f) => f.message), 'không còn lỗi chặn ký').toEqual([]);
      expect(verdict.unacknowledged.map((f) => f.message), 'không còn cảnh báo chưa xác nhận').toEqual([]);
      expect(verdict.canSign).toBe(true);
      expect(findings.filter((f) => f.severity === 'ack').map((f) => f.rule).sort()).toEqual([...c.final.acks].sort());

      const request = toCompleteRequest(d, true);
      expect(request.diagnoses).toEqual(c.final.dx);
      const lines = request.prescription!.lines;
      expect(lines.map((l) => l.drug)).toEqual(c.final.lines.map((l) => l.drug));
      c.final.lines.forEach((want, i) => {
        const got = lines[i]!;
        const quantity = resolveLine(getDrug(got.drug)!, got).quantity;
        if (want.perDose !== undefined) expect(got.perDose, `${want.drug} liều/lần`).toBe(want.perDose);
        if (want.timesPerDay !== undefined) expect(got.timesPerDay, `${want.drug} lần/ngày`).toBe(want.timesPerDay);
        if (want.days !== undefined) expect(got.days, `${want.drug} số ngày`).toBe(want.days);
        if (want.quantity !== undefined) expect(quantity, `${want.drug} số lượng`).toBe(want.quantity);
      });
    }
  });

  it('ca dị ứng và ca trùng hoạt chất thật sự làm màn hình cảnh báo trên đường đi', () => {
    for (const [scenario, rule] of [['di-ung', 'allergy'], ['trung-hoat-chat', 'duplicate-ingredient'], ['thieu-can-nang', 'no-weight']] as const) {
      const cases = ALL_CASES.filter((c) => c.scenarios.includes(scenario));
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) expect(c.steps.some((s) => s.do === 'expect' && s.rule === rule), `${c.id}: thiếu bước kiểm cảnh báo ${rule}`).toBe(true);
    }
  });

  it('ca 90 ngày chỉ ký được vì chẩn đoán là bệnh mạn tính: đổi sang chẩn đoán thường thì bị chặn', () => {
    const cases = ALL_CASES.filter((c) => c.scenarios.includes('man-tinh-90'));
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const { d } = run(c, NOW);
      expect(d.lines.some((l) => l.days === '90'), c.id).toBe(true);
      const acute = evaluate({ ...d, diagnoses: ['J06.9'] }, { specialty: c.specialty, patient: { birthDate: c.patient.birthDate, cccdMasked: 'x' }, allergies: [] }, undefined, NOW);
      expect(acute.verdict.blocking.map((f) => f.rule), c.id).toContain('max-days');
    }
  });
});
