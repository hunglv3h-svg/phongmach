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
  clientUuid: string;
  lines: SignedLine[];
  advice?: string | undefined;
  followUpDays?: number | undefined;
  acks: AckView[];
  /** Hàm băm SHA-256 trả về base64, do môi trường cung cấp (gói này không phụ thuộc Node hay trình duyệt). */
  digestBase64: (text: string) => string;
}

export interface CompletionInput {
  patientId: string;
  encounter: Encounter;
  doctor: { id?: string | undefined; name: string };
  now: Date;
  exam: ExamInput;
  diagnoses: Icd10Entry[];
  prescription?: PrescriptionToSign | undefined;
  visitSeconds?: number | undefined;
}

const urn = (n: number) => `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Gói giao dịch hoàn tất một lượt khám: sinh hiệu, chẩn đoán, nhận định, đơn thuốc (nếu có), chữ ký mô phỏng,
 * việc gửi cổng (outbox) và đóng lượt khám. Tất cả cùng thành công hoặc cùng thất bại.
 * Lượt khám được cập nhật kèm `If-Match` theo phiên bản đã đọc: hai lần hoàn tất đồng thời chỉ một lần thành công.
 */
export function buildCompletionBundle(input: CompletionInput): Bundle {
  const { encounter, patientId, now, doctor } = input;
  if (!encounter.id) throw new DomainError('invalid-state', 'Lượt khám chưa có id');
  const vitals = cleanVitals(input.exam.vitals);
  const entries: BundleEntry[] = [];
  const subject = { reference: `Patient/${patientId}` };
  const encRef = { reference: `Encounter/${encounter.id}` };
  const nowIso = now.toISOString();
  const recorder = doctor.id ? { recorder: { reference: `Practitioner/${doctor.id}`, display: doctor.name } } : {};

  const reason = input.exam.reason?.trim();
  const finished: Encounter = {
    ...encounter,
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

  for (const o of buildVitalObservations(vitals, { patientId, encounterId: encounter.id, effective: nowIso })) {
    entries.push({ resource: o, request: { method: 'POST', url: 'Observation' } });
  }

  for (const d of input.diagnoses) {
    const c: Condition = {
      resourceType: 'Condition',
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
      category: [{ coding: [{ system: CONDITION_CATEGORY, code: 'encounter-diagnosis' }] }],
      code: { coding: [{ system: SYSTEMS.icd10, code: d.code, display: d.name }], text: d.name },
      subject,
      encounter: encRef,
      recordedDate: nowIso,
      ...recorder,
    };
    entries.push({ resource: c, request: { method: 'POST', url: 'Condition' } });
  }

  const symptoms = input.exam.symptoms?.trim();
  const findings = input.exam.findings?.trim();
  if (symptoms || findings) {
    const ci: ClinicalImpression = {
      resourceType: 'ClinicalImpression',
      status: 'completed',
      subject,
      encounter: encRef,
      date: nowIso,
      ...(doctor.id ? { assessor: { reference: `Practitioner/${doctor.id}`, display: doctor.name } } : {}),
      ...(symptoms ? { description: symptoms } : {}),
      ...(findings ? { summary: findings } : {}),
    };
    entries.push({ resource: ci, request: { method: 'POST', url: 'ClinicalImpression' } });
  }

  const rx = input.prescription;
  if (rx) {
    const diagnoses = input.diagnoses.map((d) => ({ code: d.code, name: d.name }));
    const mrUrns = rx.lines.map((_, i) => urn(100 + i));
    rx.lines.forEach((line, i) => {
      const mr = buildMedicationRequest(line, i, { patientId, encounterId: encounter.id!, code: rx.code, now, doctor, diagnoses });
      entries.push({ fullUrl: mrUrns[i]!, resource: mr, request: { method: 'POST', url: 'MedicationRequest' } });
    });
    const list: List = {
      resourceType: 'List',
      status: 'current',
      mode: 'working',
      title: `Đơn thuốc ${rx.code}`,
      code: { coding: [{ system: SYSTEMS.task, code: 'prescription' }], text: 'Đơn thuốc' },
      identifier: [
        { system: SYSTEMS.clientUuid, value: rx.clientUuid.toLowerCase() },
        { system: SYSTEMS.prescriptionLocal, value: rx.code },
      ],
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
    entries.push({ fullUrl: urn(1), resource: list, request: { method: 'POST', url: 'List' } });

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
    const provenance: Provenance = {
      resourceType: 'Provenance',
      target: [{ reference: urn(1) }],
      recorded: nowIso,
      agent: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }] }, who: { ...(doctor.id ? { reference: `Practitioner/${doctor.id}` } : {}), display: doctor.name } }],
      extension: [{ url: EXTENSIONS.simulated, valueBoolean: true }],
      signature: [
        {
          type: [{ system: 'urn:iso-astm:signature-type', code: '1.2.840.10065.1.12.1.1', display: "Author's Signature" }],
          when: nowIso,
          who: { ...(doctor.id ? { reference: `Practitioner/${doctor.id}` } : {}), display: doctor.name },
          targetFormat: 'application/json',
          data: digest,
        },
      ],
    };
    entries.push({ resource: provenance, request: { method: 'POST', url: 'Provenance' } });

    const task: Task = buildSendTask({ listRef: urn(1), patientId, localCode: rx.code, now });
    entries.push({ resource: task, request: { method: 'POST', url: 'Task' } });
  }

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
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
