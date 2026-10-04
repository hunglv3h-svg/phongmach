import type { Bundle, BundleEntry, ClinicalImpression, Condition, Encounter, List, MedicationRequest, Observation, Provenance, Task } from '@medplum/fhirtypes';
import { DomainError, EXTENSIONS, SYSTEMS } from '@phongmach/fhir-vn-model';
import type { Icd10Entry } from '@phongmach/catalogs';
import type { AckView, DiagnosisView, ExamInput, PrescriptionSummary, Specialty, VisitSummary } from './dto.js';
import type { VisitSecondsSource } from './clientTime.js';
import { buildSendTask } from './outbox.js';
import { priorityOf, specialtyOf } from './queue.js';
import { acksToExtensions, buildMedicationRequest, canonicalContent, toPrescriptionSummary, type SignedLine } from './prescription.js';
import { buildVitalObservations, cleanVitals, parseVitals } from './vitals.js';

const CONDITION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category';

export interface PrescriptionToSign {
  code: string;
  lines: SignedLine[];
  advice?: string | undefined;
  followUpDays?: number | undefined;
  acks: AckView[];
  /** Hàm băm SHA-256 trả về base64, do môi trường cung cấp (gói này không phụ thuộc Node hay trình duyệt). */
  digestBase64: (text: string) => string;
}

export interface CompletionInput {
  /** UUID do client sinh một lần cho mỗi lượt hoàn tất: gửi lại cùng UUID hội tụ về cùng kết quả, không tạo bản ghi trùng (T-IDEM). */
  clientUuid: string;
  patientId: string;
  encounter: Encounter;
  doctor: { id?: string | undefined; name: string };
  now: Date;
  exam: ExamInput;
  diagnoses: Icd10Entry[];
  prescription?: PrescriptionToSign | undefined;
  visitSeconds?: number | undefined;
  /** Thời gian phiên khám đo ở đâu (OFF-3). */
  visitSecondsSource?: VisitSecondsSource | undefined;
}

const part = (clientUuid: string, role: string) => `${clientUuid.toLowerCase()}:${role}`;
const identifier = (clientUuid: string, role: string) => ({ system: SYSTEMS.clientUuid, value: part(clientUuid, role) });
const ifNone = (clientUuid: string, role: string) => `identifier=${SYSTEMS.clientUuid}|${part(clientUuid, role)}`;

/** Các bước ghi của một lần hoàn tất lượt khám, theo đúng thứ tự phải gửi. */
export interface CompletionPlan {
  /** Bước 1: các bản ghi KHÔNG tham chiếu lẫn nhau (sinh hiệu, chẩn đoán, nhận định, từng thuốc), mỗi mục tạo có điều kiện. */
  records: Bundle;
  /** Bước 2 và 3, chỉ có khi kê đơn. */
  prescription?:
    | {
        /** Vị trí các mục thuốc trong `records.entry`, theo thứ tự dòng thuốc của đơn. */
        requestIndexes: number[];
        /** Bước 2: đơn thuốc, trỏ tới id THẬT của các thuốc đã ghi ở bước 1 (cùng thứ tự với `requestIndexes`). */
        list(medicationRequestIds: string[]): { resource: List; ifNoneExist: string };
        /** Bước 3: chữ ký mô phỏng và việc gửi cổng (outbox), trỏ tới id THẬT của đơn đã ghi ở bước 2. */
        signed(listId: string): Bundle;
      }
    | undefined;
  /** Bước cuối, điểm chốt: lượt khám đã đóng. Gửi bằng PUT kèm If-Match theo phiên bản đã đọc, SAU khi mọi bước trước đều đạt. */
  closed: Encounter;
}

/**
 * Kế hoạch hoàn tất một lượt khám: sinh hiệu, chẩn đoán, nhận định, đơn thuốc (nếu có), chữ ký mô phỏng, việc gửi cổng
 * (outbox) và đóng lượt khám.
 *
 * LƯU Ý QUAN TRỌNG (đã đo trên Medplum 5.2.0, kế hoạch F11 và F13). `Bundle` loại `transaction` của Medplum KHÔNG nguyên tử:
 * một mục lỗi (409 do xung đột giao dịch, 412, 400) được báo riêng trong phản hồi HTTP 200, các mục sau nó VẪN chạy, và mục
 * tham chiếu `urn:uuid:` tới mục lỗi được lưu với một id chưa từng tồn tại. Vì vậy việc hoàn tất KHÔNG gửi trong một gói:
 *   - chia thành các bước; bước sau chỉ gửi khi mọi mục của bước trước đã được ghi, và chỉ tham chiếu tới id thật;
 *   - mọi mục tạo mới đều có định danh xác định theo `clientUuid` và `ifNoneExist`, nên gửi lại một bước (hay cả kế hoạch)
 *     không sinh bản ghi trùng;
 *   - đóng lượt khám (Encounter → finished) là lời ghi RIÊNG, đứng cuối, và là điểm chốt: lượt khám đã đóng bằng `clientUuid`
 *     này nghĩa là mọi bản ghi của nó đã có; worker chỉ gửi đơn của lượt khám đã đóng;
 *   - người gọi phải kiểm tra trạng thái từng mục trong phản hồi (`failedEntries`) trước khi sang bước sau.
 */
export function planCompletion(input: CompletionInput): CompletionPlan {
  const { encounter, patientId, now, doctor, clientUuid } = input;
  if (!encounter.id) throw new DomainError('invalid-state', 'Lượt khám chưa có id');
  const vitals = cleanVitals(input.exam.vitals);
  const entries: BundleEntry[] = [];
  const subject = { reference: `Patient/${patientId}` };
  const encRef = { reference: `Encounter/${encounter.id}` };
  const nowIso = now.toISOString();
  const recorder = doctor.id ? { recorder: { reference: `Practitioner/${doctor.id}`, display: doctor.name } } : {};
  const conditional = (resource: BundleEntry['resource'] & { resourceType: string }, role: string): BundleEntry => ({
    resource,
    request: { method: 'POST', url: resource.resourceType, ifNoneExist: ifNone(clientUuid, role) },
  });
  const create = (resource: BundleEntry['resource'] & { resourceType: string }, role: string): void => void entries.push(conditional(resource, role));

  for (const o of buildVitalObservations(vitals, { patientId, encounterId: encounter.id, effective: nowIso })) {
    const role = `obs:${o.code?.coding?.[0]?.code}`;
    create({ ...o, identifier: [identifier(clientUuid, role)] }, role);
  }

  for (const d of input.diagnoses) {
    const role = `dx:${d.code}`;
    const c: Condition = {
      resourceType: 'Condition',
      identifier: [identifier(clientUuid, role)],
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
      category: [{ coding: [{ system: CONDITION_CATEGORY, code: 'encounter-diagnosis' }] }],
      code: { coding: [{ system: SYSTEMS.icd10, code: d.code, display: d.name }], text: d.name },
      subject,
      encounter: encRef,
      recordedDate: nowIso,
      ...recorder,
    };
    create(c, role);
  }

  const symptoms = input.exam.symptoms?.trim();
  const findings = input.exam.findings?.trim();
  if (symptoms || findings) {
    const ci: ClinicalImpression = {
      resourceType: 'ClinicalImpression',
      identifier: [identifier(clientUuid, 'impression')],
      status: 'completed',
      subject,
      encounter: encRef,
      date: nowIso,
      ...(doctor.id ? { assessor: { reference: `Practitioner/${doctor.id}`, display: doctor.name } } : {}),
      ...(symptoms ? { description: symptoms } : {}),
      ...(findings ? { summary: findings } : {}),
    };
    create(ci, 'impression');
  }

  const rx = input.prescription;
  let prescription: CompletionPlan['prescription'];
  if (rx) {
    const diagnoses = input.diagnoses.map((d) => ({ code: d.code, name: d.name }));
    const requestIndexes = rx.lines.map((line, i) => {
      const mr = buildMedicationRequest(line, i, { patientId, encounterId: encounter.id!, code: rx.code, now, doctor, diagnoses });
      create({ ...mr, identifier: [identifier(clientUuid, `mr:${i}`)] }, `mr:${i}`);
      return entries.length - 1;
    });
    const list = (medicationRequestIds: string[]): { resource: List; ifNoneExist: string } => {
      // Đơn chỉ được trỏ tới thuốc ĐÃ ghi: thiếu một id nghĩa là bước 1 chưa xong, không được tạo đơn.
      if (medicationRequestIds.length !== rx.lines.length || medicationRequestIds.some((id) => !id)) throw new DomainError('invalid-state', 'Chưa đủ id thuốc đã ghi để tạo đơn');
      const resource: List = {
        resourceType: 'List',
        status: 'current',
        mode: 'working',
        title: `Đơn thuốc ${rx.code}`,
        code: { coding: [{ system: SYSTEMS.task, code: 'prescription' }], text: 'Đơn thuốc' },
        identifier: [identifier(clientUuid, 'list'), { system: SYSTEMS.prescriptionLocal, value: rx.code }],
        subject,
        encounter: encRef,
        date: nowIso,
        source: { ...(doctor.id ? { reference: `Practitioner/${doctor.id}` } : {}), display: doctor.name },
        entry: medicationRequestIds.map((id) => ({ item: { reference: `MedicationRequest/${id}` } })),
        ...(rx.advice?.trim() ? { note: [{ text: rx.advice.trim() }] } : {}),
        extension: [
          ...(rx.followUpDays !== undefined ? [{ url: EXTENSIONS.followUpDays, valueInteger: rx.followUpDays }] : []),
          ...acksToExtensions(rx.acks),
        ],
      };
      return { resource, ifNoneExist: ifNone(clientUuid, 'list') };
    };

    // Chữ ký MÔ PHỎNG: băm nội dung đơn, gắn nhãn rõ. Chưa gọi nhà cung cấp ký số (T1).
    const digest = rx.digestBase64(
      canonicalContent({
        code: rx.code,
        patientId,
        encounterId: encounter.id,
        signedAt: nowIso,
        diagnoses: diagnoses.map((d) => d.code),
        lines: rx.lines.map((l) => ({ drug: l.drug.code, instruction: l.resolved.instruction, quantity: l.resolved.quantity, days: l.input.days })),
        advice: rx.advice?.trim(),
      })
    );
    const who = { ...(doctor.id ? { reference: `Practitioner/${doctor.id}` } : {}), display: doctor.name };
    const signed = (listId: string): Bundle => {
      if (!listId) throw new DomainError('invalid-state', 'Chưa có id đơn đã ghi để ký và gửi cổng');
      const listRef = `List/${listId}`;
      const provenance: Provenance = {
        resourceType: 'Provenance',
        // Provenance không có `identifier` trong R4: dùng thẻ để tạo có điều kiện, chạy lại không sinh bản trùng.
        meta: { tag: [{ system: SYSTEMS.clientUuid, code: part(clientUuid, 'prov') }] },
        target: [{ reference: listRef }],
        recorded: nowIso,
        agent: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }] }, who }],
        extension: [{ url: EXTENSIONS.simulated, valueBoolean: true }],
        signature: [
          {
            type: [{ system: 'urn:iso-astm:signature-type', code: '1.2.840.10065.1.12.1.1', display: "Author's Signature" }],
            when: nowIso,
            who,
            targetFormat: 'application/json',
            data: digest,
          },
        ],
      };
      const task = buildSendTask({ listRef, patientId, localCode: rx.code, now });
      return {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          { resource: provenance, request: { method: 'POST', url: 'Provenance', ifNoneExist: `_tag=${SYSTEMS.clientUuid}|${part(clientUuid, 'prov')}` } },
          conditional({ ...task, identifier: [...(task.identifier ?? []), identifier(clientUuid, 'task')] }, 'task'),
        ],
      };
    };
    prescription = { requestIndexes, list, signed };
  }

  // Điểm chốt: lượt khám đã đóng. Người gọi gửi nó sau cùng, bằng một lời ghi riêng kèm If-Match theo phiên bản đã đọc.
  const reason = input.exam.reason?.trim();
  const closed: Encounter = {
    ...encounter,
    identifier: [...(encounter.identifier ?? []).filter((i) => i.value !== part(clientUuid, 'complete')), identifier(clientUuid, 'complete')],
    status: 'finished',
    period: { ...encounter.period, start: encounter.period?.start ?? nowIso, end: nowIso },
    ...(reason ? { reasonCode: [{ text: reason }] } : {}),
    extension: [
      ...(encounter.extension ?? []).filter((e) => e.url !== EXTENSIONS.visitSeconds && e.url !== EXTENSIONS.visitSecondsSource),
      ...(input.visitSeconds !== undefined ? [{ url: EXTENSIONS.visitSeconds, valueInteger: input.visitSeconds }] : []),
      ...(input.visitSecondsSource ? [{ url: EXTENSIONS.visitSecondsSource, valueCode: input.visitSecondsSource }] : []),
    ],
  };
  return { records: { resourceType: 'Bundle', type: 'transaction', entry: entries }, prescription, closed };
}

/**
 * Mục phản hồi lỗi (>= 400) của một gói đã gửi. Medplum báo lỗi từng mục trong HTTP 200: phải tự kiểm tra.
 * `code`: mã đi kèm lỗi nếu có (40001 khi mục bị từ chối vì xung đột giao dịch, F13).
 */
export function failedEntries(response: Bundle): Array<{ index: number; status: string; message?: string; code?: string }> {
  return (response.entry ?? []).flatMap((e, index) => {
    const status = String(e.response?.status ?? '');
    if (status && Number.parseInt(status, 10) < 400) return [];
    const issue = e.response?.outcome?.issue?.[0];
    const message = issue?.details?.text ?? issue?.diagnostics;
    const code = issue?.details?.coding?.[0]?.code;
    return [{ index, status: status || '?', ...(message ? { message } : {}), ...(code ? { code } : {}) }];
  });
}

export interface VisitParts {
  encounter: Encounter;
  conditions: Condition[];
  impression?: ClinicalImpression | undefined;
  observations: Observation[];
  list?: List | undefined;
  requests: MedicationRequest[];
  task?: Task | undefined;
  patientName?: string | undefined;
}

export function toDiagnosisView(c: Condition): DiagnosisView | undefined {
  const coding = c.code?.coding?.find((x) => x.system === SYSTEMS.icd10);
  if (!coding?.code) return undefined;
  return { code: coding.code, name: coding.display ?? c.code?.text ?? coding.code };
}

export function isEncounterDiagnosis(c: Condition): boolean {
  return c.category?.some((cat) => cat.coding?.some((x) => x.code === 'encounter-diagnosis')) ?? false;
}

export function toVisitSummary(p: VisitParts): VisitSummary | undefined {
  const e = p.encounter;
  if (!e.id) return undefined;
  const doctor = e.participant?.[0]?.individual?.display;
  const reason = e.reasonCode?.[0]?.text;
  const seconds = e.extension?.find((x) => x.url === EXTENSIONS.visitSeconds)?.valueInteger;
  const prescription: PrescriptionSummary | undefined = p.list ? toPrescriptionSummary(p.list, p.requests, p.task, p.patientName) : undefined;
  const specialty: Specialty = specialtyOf(e);
  return {
    encounterId: e.id,
    date: e.period?.end ?? e.period?.start ?? '',
    specialty,
    ...(doctor ? { doctorName: doctor } : {}),
    ...(reason ? { reason } : {}),
    ...(p.impression?.description ? { symptoms: p.impression.description } : {}),
    ...(p.impression?.summary ? { findings: p.impression.summary } : {}),
    vitals: parseVitals(p.observations),
    diagnoses: p.conditions.filter(isEncounterDiagnosis).map(toDiagnosisView).filter((d): d is DiagnosisView => d !== undefined),
    ...(prescription ? { prescription } : {}),
    ...(seconds !== undefined ? { visitSeconds: seconds } : {}),
  };
}

export { priorityOf };

/** Lượt khám đã được đóng bởi đúng lần hoàn tất mang `clientUuid` này (để nhận ra gửi lại). */
export const wasCompletedBy = (e: Encounter, clientUuid: string): boolean =>
  e.status === 'finished' && (e.identifier ?? []).some((i) => i.system === SYSTEMS.clientUuid && i.value === part(clientUuid, 'complete'));
