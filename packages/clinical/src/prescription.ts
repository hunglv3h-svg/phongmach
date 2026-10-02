import type { List, MedicationRequest, Task } from '@medplum/fhirtypes';
import { DomainError, EXTENSIONS, SYSTEMS, type PatientSummary } from '@phongmach/fhir-vn-model';
import { buildInstruction, getDrug, getIcd10, resolveLine, type DrugEntry, type LineInput, type ResolvedLine } from '@phongmach/catalogs';
import type { AckView, DiagnosisView, PrescriptionDetail, PrescriptionLineView, PrescriptionSummary } from './dto.js';
import { toGatewayView } from './outbox.js';

const UCUM = 'http://unitsofmeasure.org';
// Bảng chữ cái Crockford bỏ I, L, O, U: tránh nhầm khi người đọc mã bằng mắt.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Mã đơn nội bộ: PM-YYMMDD-XXXXXX. `random` phải là byte ngẫu nhiên mật mã (crypto.getRandomValues). */
export function makePrescriptionCode(day: string, random: Uint8Array): string {
  const suffix = [...random.subarray(0, 6)].map((b) => ALPHABET[b % 32]).join('');
  return `PM-${day.slice(2).replaceAll('-', '')}-${suffix}`;
}

export interface SignedLine {
  drug: DrugEntry;
  input: LineInput;
  resolved: ResolvedLine;
}

/** Nội dung được ký (băm). Thứ tự khóa cố định để cùng nội dung luôn cho cùng giá trị băm. */
export function canonicalContent(c: {
  code: string;
  patientId: string;
  encounterId: string;
  signedAt: string;
  diagnoses: string[];
  lines: Array<{ drug: string; instruction: string; quantity?: number | undefined; days?: number | undefined }>;
  advice?: string | undefined;
}): string {
  return JSON.stringify({
    code: c.code,
    patientId: c.patientId,
    encounterId: c.encounterId,
    signedAt: c.signedAt,
    diagnoses: [...c.diagnoses].sort(),
    lines: c.lines.map((l) => ({ drug: l.drug, instruction: l.instruction, quantity: l.quantity ?? null, days: l.days ?? null })),
    advice: c.advice ?? '',
  });
}

export function buildMedicationRequest(
  line: SignedLine,
  index: number,
  ctx: { patientId: string; encounterId: string; code: string; now: Date; doctor: { id?: string | undefined; name: string }; diagnoses: Array<{ code: string; name: string }> }
): MedicationRequest {
  const { drug, input, resolved } = line;
  const asNeeded = drug.defaults.asNeeded === true;
  return {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    subject: { reference: `Patient/${ctx.patientId}` },
    encounter: { reference: `Encounter/${ctx.encounterId}` },
    authoredOn: ctx.now.toISOString(),
    requester: { ...(ctx.doctor.id ? { reference: `Practitioner/${ctx.doctor.id}` } : {}), display: ctx.doctor.name },
    groupIdentifier: { system: SYSTEMS.prescriptionLocal, value: ctx.code },
    medicationCodeableConcept: { coding: [{ system: SYSTEMS.drug, code: drug.code, display: drug.name }], text: drug.name },
    reasonCode: ctx.diagnoses.map((d) => ({ coding: [{ system: SYSTEMS.icd10, code: d.code }], text: d.name })),
    dosageInstruction: [
      {
        sequence: index + 1,
        text: resolved.instruction,
        ...(input.timesPerDay && !asNeeded ? { timing: { repeat: { frequency: input.timesPerDay, period: 1, periodUnit: 'd' as const } } } : {}),
        ...(asNeeded ? { asNeededBoolean: true } : {}),
        ...(input.perDose ? { doseAndRate: [{ doseQuantity: { value: input.perDose, unit: drug.unit } }] } : {}),
      },
    ],
    dispenseRequest: {
      ...(resolved.quantity ? { quantity: { value: resolved.quantity, unit: drug.unit } } : {}),
      ...(input.days ? { expectedSupplyDuration: { value: input.days, unit: 'ngày', system: UCUM, code: 'd' } } : {}),
    },
  };
}

export function toLineView(mr: MedicationRequest): PrescriptionLineView | undefined {
  const coding = mr.medicationCodeableConcept?.coding?.find((c) => c.system === SYSTEMS.drug);
  const dosage = mr.dosageInstruction?.[0];
  if (!coding?.code) return undefined;
  const drug = getDrug(coding.code);
  const perDose = dosage?.doseAndRate?.[0]?.doseQuantity?.value;
  const timesPerDay = dosage?.timing?.repeat?.frequency;
  const quantity = mr.dispenseRequest?.quantity?.value;
  const days = mr.dispenseRequest?.expectedSupplyDuration?.value;
  return {
    drug: coding.code,
    name: coding.display ?? drug?.name ?? coding.code,
    unit: mr.dispenseRequest?.quantity?.unit ?? drug?.unit ?? '',
    instruction: dosage?.text ?? '',
    ...(quantity !== undefined ? { quantity } : {}),
    ...(perDose !== undefined ? { perDose } : {}),
    ...(timesPerDay !== undefined ? { timesPerDay } : {}),
    ...(days !== undefined ? { days } : {}),
  };
}

/** Dòng đã lưu → dòng để kê lại. Cách dùng chỉ giữ nếu bác sĩ đã gõ khác bản tự sinh (để sửa liều sau đó vẫn cập nhật cách dùng). */
export function lineToInput(view: PrescriptionLineView): LineInput {
  const drug = getDrug(view.drug);
  const input: LineInput = {
    drug: view.drug,
    ...(view.perDose !== undefined ? { perDose: view.perDose } : {}),
    ...(view.timesPerDay !== undefined ? { timesPerDay: view.timesPerDay } : {}),
    ...(view.days !== undefined ? { days: view.days } : {}),
    ...(view.quantity !== undefined ? { quantity: view.quantity } : {}),
  };
  const auto = drug ? buildInstruction(drug, input) : '';
  if (view.instruction && view.instruction !== auto) input.instruction = view.instruction;
  return input;
}

const refId = (ref: string | undefined, type: string): string | undefined => (ref?.startsWith(`${type}/`) ? ref.slice(type.length + 1) : undefined);

export function toAcks(list: List): AckView[] {
  return (list.extension ?? [])
    .filter((e) => e.url === EXTENSIONS.ruleAck)
    .map((e) => ({
      key: e.extension?.find((x) => x.url === 'key')?.valueString ?? '',
      message: e.extension?.find((x) => x.url === 'message')?.valueString ?? '',
      reason: e.extension?.find((x) => x.url === 'reason')?.valueString ?? '',
    }));
}

export const acksToExtensions = (acks: AckView[]) =>
  acks.map((a) => ({
    url: EXTENSIONS.ruleAck,
    extension: [
      { url: 'key', valueString: a.key },
      { url: 'message', valueString: a.message },
      { url: 'reason', valueString: a.reason },
    ],
  }));

/**
 * Đọc ngược List + các MedicationRequest (+ Task gửi cổng) thành đơn thuốc để hiển thị.
 * Thứ tự dòng theo `List.entry`; MedicationRequest không còn trong danh sách bị bỏ qua.
 */
export function toPrescriptionSummary(
  list: List,
  requests: MedicationRequest[],
  task?: Task,
  patientName?: string
): PrescriptionSummary | undefined {
  const code = list.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
  const patientId = refId(list.subject?.reference, 'Patient');
  if (!list.id || !code || !patientId || !list.date) return undefined;
  const byId = new Map(requests.filter((r) => r.id).map((r) => [r.id!, r]));
  const lines = (list.entry ?? [])
    .map((e) => byId.get(refId(e.item?.reference, 'MedicationRequest') ?? ''))
    .map((mr) => (mr ? toLineView(mr) : undefined))
    .filter((l): l is PrescriptionLineView => l !== undefined);
  const advice = list.note?.[0]?.text;
  const followUp = list.extension?.find((e) => e.url === EXTENSIONS.followUpDays)?.valueInteger;
  const gateway = task ? toGatewayView(task) : undefined;
  return {
    id: list.id,
    code,
    signedAt: list.date,
    ...(list.source?.display ? { signerName: list.source.display } : {}),
    patientId,
    ...(patientName ? { patientName } : {}),
    lines,
    ...(advice ? { advice } : {}),
    ...(followUp !== undefined ? { followUpDays: followUp } : {}),
    acknowledgements: toAcks(list),
    ...(gateway ? { gateway } : {}),
  };
}

/** Một đơn vừa ký trên máy, máy chủ chưa nhận (ký khi mất mạng). */
export interface LocalSignature {
  /** id tạm của đơn và của lượt khám trên máy (chưa có id máy chủ). */
  id: string;
  encounterId: string;
  /** Mã đơn sinh ở máy khách bằng `makePrescriptionCode`, cùng cách máy chủ sẽ tính lại khi đồng bộ. */
  code: string;
  signedAt: string;
  signerName: string;
  patient: PatientSummary;
  /** Mã ICD-10. */
  diagnoses: string[];
  lines: LineInput[];
  advice?: string | undefined;
  followUpDays?: number | undefined;
  acknowledgements: AckView[];
}

/**
 * Đơn thuốc dựng từ dữ liệu trên máy để in ngay khi mất mạng, trước khi máy chủ nhận.
 * Đi qua đúng các hàm mà gói hoàn tất (`buildMedicationRequest`) và đường đọc ngược (`toLineView`) dùng, để tờ in lúc mất mạng
 * giống tờ in lại từ máy chủ sau khi đồng bộ (có kiểm thử so hai đường).
 */
export function localPrescriptionDetail(s: LocalSignature): PrescriptionDetail {
  const diagnoses: DiagnosisView[] = s.diagnoses.map((code) => {
    const entry = getIcd10(code);
    if (!entry) throw new DomainError('invalid-diagnosis', `Mã ICD-10 không có trong danh mục: ${code}`);
    return { code: entry.code, name: entry.name };
  });
  const now = new Date(s.signedAt);
  const lines = s.lines.map((input, index) => {
    const drug = getDrug(input.drug);
    if (!drug) throw new DomainError('invalid-prescription', `Thuốc không có trong danh mục: ${input.drug}`);
    const mr = buildMedicationRequest({ drug, input, resolved: resolveLine(drug, input) }, index, {
      patientId: s.patient.id,
      encounterId: s.encounterId,
      code: s.code,
      now,
      doctor: { name: s.signerName },
      diagnoses,
    });
    return toLineView(mr)!;
  });
  const advice = s.advice?.trim();
  return {
    prescription: {
      id: s.id,
      code: s.code,
      signedAt: now.toISOString(),
      signerName: s.signerName,
      patientId: s.patient.id,
      patientName: s.patient.fullName,
      lines,
      ...(advice ? { advice } : {}),
      ...(s.followUpDays !== undefined ? { followUpDays: s.followUpDays } : {}),
      acknowledgements: s.acknowledgements,
    },
    patient: s.patient,
    diagnoses,
    encounterId: s.encounterId,
  };
}
