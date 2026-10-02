import type { AllergyIntolerance, Condition } from '@medplum/fhirtypes';
import { DomainError, SYSTEMS } from '@phongmach/fhir-vn-model';
import { ALLERGY_CLASSES, allergyClassLabel } from '@phongmach/catalogs';
import type { Allergy } from '@phongmach/rules';
import type { AllergyView, HistoryItem } from './dto.js';

export interface NewAllergy {
  clientUuid: string;
  kind: 'class' | 'ingredient';
  value: string;
  label?: string | undefined;
}

export function buildAllergy(patientId: string, input: NewAllergy, now: Date): AllergyIntolerance {
  const value = input.value.trim().toLowerCase();
  if (!value) throw new DomainError('invalid-allergy', 'Chưa chọn nhóm thuốc hoặc hoạt chất');
  if (input.kind === 'class' && !ALLERGY_CLASSES.some((c) => c.id === value)) throw new DomainError('invalid-allergy', 'Nhóm thuốc không có trong danh mục');
  const label = input.kind === 'class' ? allergyClassLabel(value) : (input.label?.trim() || value);
  const system = input.kind === 'class' ? SYSTEMS.allergyClass : SYSTEMS.ingredient;
  return {
    resourceType: 'AllergyIntolerance',
    identifier: [{ system: SYSTEMS.clientUuid, value: input.clientUuid.toLowerCase() }],
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'unconfirmed' }] },
    category: ['medication'],
    code: { coding: [{ system, code: value, display: label }], text: label },
    patient: { reference: `Patient/${patientId}` },
    recordedDate: now.toISOString(),
  };
}

const ENTERED_IN_ERROR = (system: string) => ({ coding: [{ system, code: 'entered-in-error' }] });

/** Rút lại bản ghi nhập nhầm. FHIR (ait-2) cấm giữ `clinicalStatus` khi `verificationStatus` là entered-in-error. */
export function withdrawAllergy(a: AllergyIntolerance): AllergyIntolerance {
  const { clinicalStatus: _drop, ...rest } = a;
  void _drop;
  return { ...rest, verificationStatus: ENTERED_IN_ERROR('http://terminology.hl7.org/CodeSystem/allergyintolerance-verification') };
}

const isWithdrawn = (r: AllergyIntolerance | Condition) => r.verificationStatus?.coding?.some((c) => c.code === 'entered-in-error') ?? false;

export function toAllergyView(a: AllergyIntolerance): AllergyView | undefined {
  if (!a.id || isWithdrawn(a)) return undefined;
  const coding = a.code?.coding?.[0];
  if (!coding?.code) return undefined;
  const kind = coding.system === SYSTEMS.allergyClass ? 'class' : coding.system === SYSTEMS.ingredient ? 'ingredient' : undefined;
  if (!kind) return undefined;
  return { id: a.id, kind, value: coding.code, label: coding.display ?? a.code?.text ?? coding.code, ...(a.recordedDate ? { recordedAt: a.recordedDate } : {}) };
}

export const toRuleAllergy = ({ kind, value, label }: AllergyView): Allergy => ({ kind, value, label });

const CONDITION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category';

export function buildHistoryItem(patientId: string, input: { clientUuid: string; text: string }, now: Date): Condition {
  const text = input.text.trim();
  if (!text) throw new DomainError('invalid-state', 'Nhập nội dung tiền sử');
  if (text.length > 300) throw new DomainError('invalid-state', 'Tiền sử quá dài (tối đa 300 ký tự)');
  return {
    resourceType: 'Condition',
    identifier: [{ system: SYSTEMS.clientUuid, value: input.clientUuid.toLowerCase() }],
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    category: [{ coding: [{ system: CONDITION_CATEGORY, code: 'problem-list-item' }] }],
    code: { text },
    subject: { reference: `Patient/${patientId}` },
    recordedDate: now.toISOString(),
  };
}

/** Như trên: Condition (con-5) cũng cấm giữ `clinicalStatus` khi entered-in-error. */
export function withdrawHistoryItem(c: Condition): Condition {
  const { clinicalStatus: _drop, ...rest } = c;
  void _drop;
  return { ...rest, verificationStatus: ENTERED_IN_ERROR('http://terminology.hl7.org/CodeSystem/condition-ver-status') };
}

export function isHistoryItem(c: Condition): boolean {
  return c.category?.some((cat) => cat.coding?.some((x) => x.system === CONDITION_CATEGORY && x.code === 'problem-list-item')) ?? false;
}

export function toHistoryItem(c: Condition): HistoryItem | undefined {
  if (!c.id || isWithdrawn(c) || !isHistoryItem(c) || !c.code?.text) return undefined;
  return { id: c.id, text: c.code.text, ...(c.recordedDate ? { recordedAt: c.recordedDate } : {}) };
}
