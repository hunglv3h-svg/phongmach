import type { Bundle, BundleEntry, ClinicalImpression, Condition, Encounter, List, MedicationRequest, Observation, Provenance, Task } from '@medplum/fhirtypes';
import { DomainError, EXTENSIONS, SYSTEMS } from '@phongmach/fhir-vn-model';
import type { Icd10Entry } from '@phongmach/catalogs';
import type { AckView, DiagnosisView, ExamInput, PrescriptionSummary, Specialty, VisitSummary } from './dto.js';
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
}

const part = (clientUuid: string, role: string) => `${clientUuid.toLowerCase()}:${role}`;
const identifier = (clientUuid: string, role: string) => ({ system: SYSTEMS.clientUuid, value: part(clientUuid, role) });
const ifNone = (clientUuid: string, role: string) => `identifier=${SYSTEMS.clientUuid}|${part(clientUuid, role)}`;
const urn = (n: number) => `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Gói hoàn tất một lượt khám: sinh hiệu, chẩn đoán, nhận định, đơn thuốc (nếu có), chữ ký mô phỏng, việc gửi cổng
 * (outbox) và đóng lượt khám.
 *
 * LƯU Ý QUAN TRỌNG (đã đo trên Medplum 5.2.0, xem kế hoạch mục 5.6): `Bundle` loại `transaction` của Medplum KHÔNG nguyên tử.
 * Một mục lỗi (412 do If-Match, 400, 404) được báo riêng từng mục trong phản hồi HTTP 200 còn các mục khác vẫn được ghi.
 * Vì vậy gói này được thiết kế để CHẠY LẠI ĐƯỢC thay vì dựa vào hoàn tác:
 *   - mọi mục tạo mới đều có định danh xác định theo `clientUuid` và `ifNoneExist`, nên chạy lại không sinh bản ghi trùng;
 *   - mục đóng lượt khám (Encounter → finished) đứng CUỐI và là điểm chốt: worker chỉ gửi đơn của lượt khám đã đóng;
 *   - người gọi phải kiểm tra trạng thái từng mục trong phản hồi và coi bất kỳ mục >= 400 là thất bại (chạy lại cùng clientUuid).
 */
export function buildCompletionBundle(input: CompletionInput): Bundle {
  const { encounter, patientId, now, doctor, clientUuid } = input;
  if (!encounter.id) throw new DomainError('invalid-state', 'Lượt khám chưa có id');
  const vitals = cleanVitals(input.exam.vitals);
  const entries: BundleEntry[] = [];
  const subject = { reference: `Patient/${patientId}` };
  const encRef = { reference: `Encounter/${encounter.id}` };
  const nowIso = now.toISOString();
  const recorder = doctor.id ? { recorder: { reference: `Practitioner/${doctor.id}`, display: doctor.name } } : {};
  const create = (resource: BundleEntry['resource'] & { resourceType: string }, role: string, fullUrl?: string): void => {
    entries.push({ ...(fullUrl ? { fullUrl } : {}), resource, request: { method: 'POST', url: resource.resourceType, ifNoneExist: ifNone(clientUuid, role) } });
  };

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
  if (rx) {
    const diagnoses = input.diagnoses.map((d) => ({ code: d.code, name: d.name }));
    const mrUrns = rx.lines.map((_, i) => urn(100 + i));
    rx.lines.forEach((line, i) => {
      const mr = buildMedicationRequest(line, i, { patientId, encounterId: encounter.id!, code: rx.code, now, doctor, diagnoses });
      create({ ...mr, identifier: [identifier(clientUuid, `mr:${i}`)] }, `mr:${i}`, mrUrns[i]!);
    });
    const list: List = {
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
      entry: mrUrns.map((u) => ({ item: { reference: u } })),
      ...(rx.advice?.trim() ? { note: [{ text: rx.advice.trim() }] } : {}),
      extension: [
        ...(rx.followUpDays !== undefined ? [{ url: EXTENSIONS.followUpDays, valueInteger: rx.followUpDays }] : []),
        ...acksToExtensions(rx.acks),
      ],
    };
    create(list, 'list', urn(1));

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
    const provenance: Provenance = {
      resourceType: 'Provenance',
      // Provenance không có `identifier` trong R4: dùng thẻ để tạo có điều kiện, chạy lại không sinh bản trùng.
      meta: { tag: [{ system: SYSTEMS.clientUuid, code: part(clientUuid, 'prov') }] },
      target: [{ reference: urn(1) }],
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
    entries.push({ resource: provenance, request: { method: 'POST', url: 'Provenance', ifNoneExist: `_tag=${SYSTEMS.clientUuid}|${part(clientUuid, 'prov')}` } });

    const task = buildSendTask({ listRef: urn(1), patientId, localCode: rx.code, now });
    create({ ...task, identifier: [...(task.identifier ?? []), identifier(clientUuid, 'task')] }, 'task');
  }

  // Điểm chốt: đóng lượt khám đứng cuối, kèm If-Match theo phiên bản đã đọc.
  const reason = input.exam.reason?.trim();
  const finished: Encounter = {
    ...encounter,
    identifier: [...(encounter.identifier ?? []).filter((i) => i.value !== part(clientUuid, 'complete')), identifier(clientUuid, 'complete')],
    status: 'finished',
    period: { ...encounter.period, start: encounter.period?.start ?? nowIso, end: nowIso },
    ...(reason ? { reasonCode: [{ text: reason }] } : {}),
    extension: [
      ...(encounter.extension ?? []).filter((e) => e.url !== EXTENSIONS.visitSeconds),
      ...(input.visitSeconds !== undefined ? [{ url: EXTENSIONS.visitSeconds, valueInteger: input.visitSeconds }] : []),
    ],
  };
  entries.push({
    resource: finished,
    request: { method: 'PUT', url: `Encounter/${encounter.id}`, ...(encounter.meta?.versionId ? { ifMatch: `W/"${encounter.meta.versionId}"` } : {}) },
  });

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

/** Mục phản hồi lỗi (>= 400) của một gói đã gửi. Medplum báo lỗi từng mục trong HTTP 200: phải tự kiểm tra. */
export function failedEntries(response: Bundle): Array<{ index: number; status: string; message?: string }> {
  return (response.entry ?? []).flatMap((e, index) => {
    const status = String(e.response?.status ?? '');
    if (status && Number.parseInt(status, 10) < 400) return [];
    const message = e.response?.outcome?.issue?.[0]?.details?.text ?? e.response?.outcome?.issue?.[0]?.diagnostics;
    return [{ index, status: status || '?', ...(message ? { message } : {}) }];
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
