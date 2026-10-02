import type { Observation } from '@medplum/fhirtypes';
import { DomainError } from '@phongmach/fhir-vn-model';
import type { VitalsInput } from './dto.js';

interface Simple {
  field: keyof VitalsInput;
  loinc: string;
  display: string;
  unit: string;
  ucum: string;
  min: number;
  max: number;
  label: string;
}

const SIMPLE: Simple[] = [
  { field: 'temperatureC', loinc: '8310-5', display: 'Body temperature', unit: '°C', ucum: 'Cel', min: 30, max: 45, label: 'Nhiệt độ' },
  { field: 'pulse', loinc: '8867-4', display: 'Heart rate', unit: 'lần/phút', ucum: '/min', min: 20, max: 300, label: 'Mạch' },
  { field: 'respiratoryRate', loinc: '9279-1', display: 'Respiratory rate', unit: 'lần/phút', ucum: '/min', min: 5, max: 100, label: 'Nhịp thở' },
  { field: 'spo2', loinc: '59408-5', display: 'Oxygen saturation by pulse oximetry', unit: '%', ucum: '%', min: 50, max: 100, label: 'SpO2' },
  { field: 'weightKg', loinc: '29463-7', display: 'Body weight', unit: 'kg', ucum: 'kg', min: 0.3, max: 400, label: 'Cân nặng' },
  { field: 'heightCm', loinc: '8302-2', display: 'Body height', unit: 'cm', ucum: 'cm', min: 20, max: 260, label: 'Chiều cao' },
];
const BP = { panel: '85354-9', systolic: '8480-6', diastolic: '8462-4' };
const SYS = { min: 40, max: 300 };
const DIA = { min: 20, max: 200 };

const LOINC = 'http://loinc.org';
const CATEGORY = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }];

/** Bỏ trường rỗng/NaN, kiểm khoảng hợp lý để bắt gõ nhầm (nhiệt độ 370 thay vì 37,0). */
export function cleanVitals(input: VitalsInput): VitalsInput {
  const out: VitalsInput = {};
  const put = (field: keyof VitalsInput, label: string, min: number, max: number) => {
    const v = input[field];
    if (v === undefined || v === null) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new DomainError('invalid-vitals', `${label} không phải số`);
    if (v < min || v > max) throw new DomainError('invalid-vitals', `${label} ${v} ngoài khoảng hợp lý (${min}–${max})`);
    out[field] = v;
  };
  for (const s of SIMPLE) put(s.field, s.label, s.min, s.max);
  put('systolic', 'Huyết áp tâm thu', SYS.min, SYS.max);
  put('diastolic', 'Huyết áp tâm trương', DIA.min, DIA.max);
  if ((out.systolic === undefined) !== (out.diastolic === undefined)) throw new DomainError('invalid-vitals', 'Huyết áp cần cả số tâm thu và tâm trương');
  if (out.systolic !== undefined && out.diastolic !== undefined && out.systolic <= out.diastolic) {
    throw new DomainError('invalid-vitals', 'Huyết áp tâm thu phải lớn hơn tâm trương');
  }
  return out;
}

const q = (value: number, unit: string, ucum: string) => ({ value, unit, system: 'http://unitsofmeasure.org', code: ucum });

export function buildVitalObservations(
  vitals: VitalsInput,
  ctx: { patientId: string; encounterId: string; effective: string }
): Observation[] {
  const v = cleanVitals(vitals);
  const base = {
    resourceType: 'Observation' as const,
    status: 'final' as const,
    category: CATEGORY,
    subject: { reference: `Patient/${ctx.patientId}` },
    encounter: { reference: `Encounter/${ctx.encounterId}` },
    effectiveDateTime: ctx.effective,
  };
  const out: Observation[] = [];
  for (const s of SIMPLE) {
    const value = v[s.field];
    if (value === undefined) continue;
    out.push({ ...base, code: { coding: [{ system: LOINC, code: s.loinc, display: s.display }], text: s.label }, valueQuantity: q(value, s.unit, s.ucum) });
  }
  if (v.systolic !== undefined && v.diastolic !== undefined) {
    out.push({
      ...base,
      code: { coding: [{ system: LOINC, code: BP.panel, display: 'Blood pressure panel' }], text: 'Huyết áp' },
      component: [
        { code: { coding: [{ system: LOINC, code: BP.systolic, display: 'Systolic blood pressure' }] }, valueQuantity: q(v.systolic, 'mmHg', 'mm[Hg]') },
        { code: { coding: [{ system: LOINC, code: BP.diastolic, display: 'Diastolic blood pressure' }] }, valueQuantity: q(v.diastolic, 'mmHg', 'mm[Hg]') },
      ],
    });
  }
  return out;
}

/** Đọc ngược các Observation sinh hiệu thành VitalsInput (cho lịch sử khám). */
export function parseVitals(observations: Observation[]): VitalsInput {
  const out: VitalsInput = {};
  for (const o of observations) {
    const code = o.code?.coding?.find((c) => c.system === LOINC)?.code;
    if (code === BP.panel) {
      for (const c of o.component ?? []) {
        const cc = c.code?.coding?.find((x) => x.system === LOINC)?.code;
        if (cc === BP.systolic && c.valueQuantity?.value !== undefined) out.systolic = c.valueQuantity.value;
        if (cc === BP.diastolic && c.valueQuantity?.value !== undefined) out.diastolic = c.valueQuantity.value;
      }
      continue;
    }
    const s = SIMPLE.find((x) => x.loinc === code);
    if (s && o.valueQuantity?.value !== undefined) out[s.field] = o.valueQuantity.value;
  }
  return out;
}
