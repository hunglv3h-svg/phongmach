import { MedplumClient, OperationOutcomeError, isNotFound, normalizeOperationOutcome } from '@medplum/core';
import type { AllergyIntolerance, Bundle, ClinicalImpression, Condition, Encounter, List, MedicationRequest, Observation, Patient, Resource, Task } from '@medplum/fhirtypes';
import {
  DEFAULT_RETRY,
  buildAllergy,
  buildCheckIn,
  buildCompletionBundle,
  buildHistoryItem,
  claim,
  failedEntries,
  isDue,
  isEncounterDiagnosis,
  markCalled,
  markFailed,
  markSent,
  nextNumber,
  queueNumberOf,
  requeue,
  toAllergyView,
  toDiagnosisView,
  toGatewayView,
  toHistoryItem,
  toPrescriptionSummary,
  toQueueItem,
  toVisitSummary,
  vnDay,
  vnDayRange,
  withdrawAllergy,
  withdrawHistoryItem,
  wasCompletedBy,
  type AllergyView,
  type CheckInInput,
  type DiagnosisView,
  type HistoryItem,
  type PendingPrescription,
  type PrescriptionDetail,
  type QueueItem,
  type RetryPolicy,
  type VisitContext,
  type VisitSummary,
} from '@phongmach/clinical';
import { EXTENSIONS, SYSTEMS, buildPatient, clientUuidQuery, patchPatient, rankByPhoneSuffix, toPatientSummary, type NewPatientInput, type PatientSummary, type SearchIntent } from '@phongmach/fhir-vn-model';
import type { GatewayPayload } from './gateway.js';
import type { ClinicStore, CompleteCommand, CompleteResult, Doctor, FinishedVisit, OpenResult, OutboxJob, StoreFactory } from './store.js';
import type { Tenant } from './tenants.js';

/** Số kết quả lấy về khi tìm theo đoạn số, trước khi xếp hạng theo "kết thúc bằng". */
const FRAGMENT_FETCH = 50;
const QUEUE_MAX = 200;
const CHECK_IN_ATTEMPTS = 5;
const PREVIOUS_VISITS = 10;
const PROBLEM_LIST = 'http://terminology.hl7.org/CodeSystem/condition-category|problem-list-item';
const SEND_TASK = `${SYSTEMS.task}|send-prescription`;

const REVINCLUDES = ['Condition:encounter', 'Observation:encounter', 'ClinicalImpression:encounter', 'MedicationRequest:encounter', 'List:encounter'] as const;

const isPreconditionFailed = (err: unknown): boolean => err instanceof OperationOutcomeError && err.outcome.id === 'precondition-failed';
const refId = (ref: string | undefined, type: string): string | undefined => (ref?.startsWith(`${type}/`) ? ref.slice(type.length + 1) : undefined);
const ifMatch = (r: Resource): { headers: Record<string, string> } | undefined => (r.meta?.versionId ? { headers: { 'If-Match': `W/"${r.meta.versionId}"` } } : undefined);

function entries<T extends Resource>(bundle: Bundle, type: T['resourceType']): T[] {
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is T => r?.resourceType === type);
}

export class MedplumClinicStore implements ClinicStore {
  constructor(
    private readonly medplum: MedplumClient,
    private readonly policy: RetryPolicy = DEFAULT_RETRY
  ) {}

  // ---------------------------------------------------------------------------------------------------- bệnh nhân

  async searchPatients(intent: SearchIntent, limit: number): Promise<PatientSummary[]> {
    switch (intent.kind) {
      case 'empty':
        return [];
      case 'cccd':
        return this.search({ identifier: `${SYSTEMS.cccd}|${intent.cccd}`, _count: String(limit) });
      case 'phone':
        return this.search({ phone: intent.phone, _count: String(limit) });
      case 'phone-fragment': {
        const found = await this.search({ 'phone:contains': intent.digits, _count: String(FRAGMENT_FETCH) });
        return rankByPhoneSuffix(found, intent.digits).slice(0, limit);
      }
      case 'name': {
        // Mỗi token là một điều kiện AND; tên không dấu khớp nhờ HumanName không dấu thêm lúc tạo (T-NAME).
        const params = new URLSearchParams();
        for (const token of intent.tokens) params.append('name', token);
        params.set('_count', String(limit));
        return this.search(params);
      }
    }
  }

  async createPatient(input: NewPatientInput): Promise<{ patient: PatientSummary; created: boolean }> {
    const patient = buildPatient(input);
    const query = clientUuidQuery(input.clientUuid.toLowerCase());
    const existing = await this.medplum.searchOne('Patient', query);
    if (existing) return { patient: toPatientSummary(existing), created: false };
    // Create có điều kiện để hai yêu cầu đồng thời cùng một clientUuid vẫn chỉ tạo một bản ghi.
    const saved = await this.medplum.createResourceIfNoneExist(patient, query);
    return { patient: toPatientSummary(saved), created: true };
  }

  async readPatient(id: string): Promise<PatientSummary | undefined> {
    const p = await this.readOrUndefined('Patient', id);
    return p ? toPatientSummary(p) : undefined;
  }

  async updatePatient(id: string, patch: { cccd?: string | undefined; birthDate?: string | undefined }): Promise<PatientSummary | undefined> {
    const current = await this.readOrUndefined('Patient', id);
    if (!current) return undefined;
    const saved = await this.medplum.updateResource(patchPatient(current, patch), ifMatch(current));
    return toPatientSummary(saved);
  }

  // --------------------------------------------------------------------------------------------------- hàng chờ

  async checkIn(input: CheckInInput, now: Date): Promise<{ item: QueueItem; created: boolean } | undefined> {
    const patient = await this.readOrUndefined('Patient', input.patientId);
    if (!patient) return undefined;
    const uuid = input.clientUuid.toLowerCase();
    const mine = clientUuidQuery(uuid);
    const existing = await this.medplum.searchOne('Encounter', mine);
    if (existing) return { item: this.item(existing, patient), created: false };

    const day = vnDay(now);
    for (let attempt = 0; attempt < CHECK_IN_ATTEMPTS; attempt++) {
      const todays = await this.medplum.searchResources('Encounter', this.dayQuery(day, 'date'));
      const number = nextNumber(todays);
      const enc = buildCheckIn(input, { day, number, now });
      const code = enc.identifier!.find((i) => i.system === SYSTEMS.visitCode)!.value!;
      // Tạo có điều kiện theo mã lượt khám: hai lễ tân cùng lấy số một lúc thì chỉ một người được số đó, người kia thử số kế tiếp.
      const saved = await this.medplum.createResourceIfNoneExist(enc, `identifier=${SYSTEMS.visitCode}|${code}`);
      if (saved.identifier?.some((i) => i.system === SYSTEMS.clientUuid && i.value === uuid)) return { item: this.item(saved, patient), created: true };
    }
    throw new Error('Không cấp được số thứ tự sau nhiều lần thử');
  }

  async listQueue(day: string): Promise<QueueItem[]> {
    const bundle = await this.medplum.search('Encounter', this.dayQuery(day, 'date', { _include: 'Encounter:patient' }));
    const patients = new Map(entries<Patient>(bundle, 'Patient').map((p) => [p.id!, p]));
    return entries<Encounter>(bundle, 'Encounter')
      .map((e) => toQueueItem(e, patients.get(refId(e.subject?.reference, 'Patient') ?? '')))
      .filter((i): i is QueueItem => i !== undefined);
  }

  async cancelVisit(encounterId: string): Promise<'ok' | 'not-found' | 'not-waiting'> {
    const enc = await this.readOrUndefined('Encounter', encounterId);
    if (!enc) return 'not-found';
    if (enc.status !== 'arrived') return 'not-waiting';
    try {
      await this.medplum.updateResource({ ...enc, status: 'cancelled' }, ifMatch(enc));
      return 'ok';
    } catch (err) {
      if (isPreconditionFailed(err)) return 'not-waiting';
      throw err;
    }
  }

  async openVisit(encounterId: string, doctor: Doctor, now: Date): Promise<OpenResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const enc = await this.readOrUndefined('Encounter', encounterId);
      if (!enc) return { kind: 'not-found' };
      if (enc.status === 'finished' || enc.status === 'cancelled') return { kind: 'closed' };
      if (enc.status === 'in-progress') {
        const holder = enc.participant?.[0]?.individual;
        if (holder?.identifier?.value !== doctor.userId) return { kind: 'taken', doctorName: holder?.display };
        const context = await this.readVisit(encounterId);
        return context ? { kind: 'ok', context } : { kind: 'not-found' };
      }
      try {
        await this.medplum.updateResource(markCalled(enc, { id: doctor.practitionerId, name: doctor.name, userId: doctor.userId }, now), ifMatch(enc));
      } catch (err) {
        if (isPreconditionFailed(err)) continue; // người khác vừa đổi: đọc lại rồi quyết định
        throw err;
      }
      const context = await this.readVisit(encounterId);
      return context ? { kind: 'ok', context } : { kind: 'not-found' };
    }
    return { kind: 'taken' };
  }

  async readVisit(encounterId: string): Promise<VisitContext | undefined> {
    const enc = await this.readOrUndefined('Encounter', encounterId);
    const patientId = refId(enc?.subject?.reference, 'Patient');
    if (!enc || !patientId) return undefined;
    const [patient, allergies, history, previous] = await Promise.all([
      this.readOrUndefined('Patient', patientId),
      this.listAllergies(patientId),
      this.listHistory(patientId),
      this.patientVisits(patientId, PREVIOUS_VISITS + 1),
    ]);
    const visit = patient ? toQueueItem(enc, patient) : undefined;
    if (!patient || !visit) return undefined;
    return { visit, patient: toPatientSummary(patient), allergies, history, previous: previous.filter((v) => v.encounterId !== encounterId).slice(0, PREVIOUS_VISITS) };
  }

  async completeVisit(cmd: CompleteCommand): Promise<CompleteResult> {
    const enc = await this.readOrUndefined('Encounter', cmd.encounterId);
    if (!enc) return { kind: 'not-found' };
    if (wasCompletedBy(enc, cmd.clientUuid)) {
      // Gửi lại sau khi đã thành công (mất mạng giữa chừng, bấm hai lần): trả về kết quả cũ, không ghi gì thêm.
      return { kind: 'ok', visit: (await this.loadVisits({ _id: enc.id! }))[0]!, replayed: true };
    }
    if (enc.status === 'finished' || enc.status === 'cancelled') return { kind: 'already-closed' };
    if (enc.status !== 'in-progress' || enc.participant?.[0]?.individual?.identifier?.value !== cmd.doctor.userId) return { kind: 'not-open' };

    const patientId = refId(enc.subject?.reference, 'Patient')!;
    const opened = enc.extension?.find((e) => e.url === EXTENSIONS.examOpened)?.valueDateTime;
    const visitSeconds = opened ? Math.max(0, Math.round((cmd.now.getTime() - Date.parse(opened)) / 1000)) : undefined;
    const bundle = buildCompletionBundle({
      clientUuid: cmd.clientUuid,
      patientId,
      encounter: enc,
      doctor: { id: cmd.doctor.practitionerId, name: cmd.doctor.name },
      now: cmd.now,
      exam: cmd.exam,
      diagnoses: cmd.diagnoses,
      prescription: cmd.prescription,
      visitSeconds,
    });
    const response = await this.medplum.executeBatch(bundle);
    // Medplum không hoàn tác khi một mục lỗi (xem buildCompletionBundle): HTTP 200 vẫn có thể kèm mục 412/400.
    const failed = failedEntries(response);
    if (failed.length) return { kind: 'incomplete', failed };
    return { kind: 'ok', visit: (await this.loadVisits({ _id: enc.id! }))[0]!, replayed: false };
  }

  // ------------------------------------------------------------------------------------- dị ứng và tiền sử

  async listAllergies(patientId: string): Promise<AllergyView[]> {
    const found = await this.medplum.searchResources('AllergyIntolerance', { patient: `Patient/${patientId}`, _count: '100' });
    return found.map(toAllergyView).filter((a): a is AllergyView => a !== undefined);
  }

  async addAllergy(patientId: string, input: { clientUuid: string; kind: 'class' | 'ingredient'; value: string; label?: string | undefined }, now: Date): Promise<AllergyView | undefined> {
    if (!(await this.readOrUndefined('Patient', patientId))) return undefined;
    const resource = buildAllergy(patientId, input, now);
    const saved = await this.medplum.createResourceIfNoneExist(resource, clientUuidQuery(input.clientUuid.toLowerCase()));
    return toAllergyView(saved);
  }

  async removeAllergy(patientId: string, allergyId: string): Promise<boolean> {
    const a = await this.readOrUndefined('AllergyIntolerance', allergyId);
    if (!a || a.patient?.reference !== `Patient/${patientId}`) return false;
    await this.medplum.updateResource(withdrawAllergy(a), ifMatch(a));
    return true;
  }

  async listHistory(patientId: string): Promise<HistoryItem[]> {
    const found = await this.medplum.searchResources('Condition', { patient: `Patient/${patientId}`, category: PROBLEM_LIST, _count: '100' });
    return found.map(toHistoryItem).filter((h): h is HistoryItem => h !== undefined);
  }

  async addHistory(patientId: string, input: { clientUuid: string; text: string }, now: Date): Promise<HistoryItem | undefined> {
    if (!(await this.readOrUndefined('Patient', patientId))) return undefined;
    const saved = await this.medplum.createResourceIfNoneExist(buildHistoryItem(patientId, input, now), clientUuidQuery(input.clientUuid.toLowerCase()));
    return toHistoryItem(saved);
  }

  async removeHistory(patientId: string, itemId: string): Promise<boolean> {
    const c = await this.readOrUndefined('Condition', itemId);
    if (!c || c.subject?.reference !== `Patient/${patientId}`) return false;
    await this.medplum.updateResource(withdrawHistoryItem(c), ifMatch(c));
    return true;
  }

  async patientVisits(patientId: string, limit: number): Promise<VisitSummary[]> {
    return this.loadVisits({ patient: `Patient/${patientId}`, status: 'finished', _sort: '-date', _count: String(limit) });
  }

  // ------------------------------------------------------------------------------------------------ đơn thuốc

  async readPrescription(id: string): Promise<PrescriptionDetail | undefined> {
    const list = await this.readOrUndefined('List', id);
    const patientId = refId(list?.subject?.reference, 'Patient');
    const encounterId = refId(list?.encounter?.reference, 'Encounter');
    const code = list?.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
    if (!list || !patientId || !encounterId || !code) return undefined;
    const [patient, requests, task, conditions] = await Promise.all([
      this.readOrUndefined('Patient', patientId),
      this.requestsOf(list),
      this.medplum.searchOne('Task', { identifier: `${SYSTEMS.prescriptionLocal}|${code}`, code: SEND_TASK }),
      this.medplum.searchResources('Condition', { encounter: `Encounter/${encounterId}`, _count: '50' }),
    ]);
    if (!patient) return undefined;
    const summary = toPrescriptionSummary(list, requests, task, toPatientSummary(patient).fullName);
    if (!summary) return undefined;
    const diagnoses = conditions.filter(isEncounterDiagnosis).map(toDiagnosisView).filter((d): d is DiagnosisView => d !== undefined);
    return { prescription: summary, patient: toPatientSummary(patient), diagnoses, encounterId };
  }

  async pendingPrescriptions(limit: number): Promise<PendingPrescription[]> {
    const bundle = await this.medplum.search(
      'Task',
      new URLSearchParams([
        ['code', SEND_TASK],
        ['status', 'requested,on-hold,in-progress,failed'],
        ['_include', 'Task:focus'],
        ['_include', 'Task:patient'],
        ['_sort', '-_lastUpdated'],
        ['_count', String(limit)],
      ])
    );
    const lists = new Map(entries<List>(bundle, 'List').map((l) => [l.id!, l]));
    const patients = new Map(entries<Patient>(bundle, 'Patient').map((p) => [p.id!, p]));
    return entries<Task>(bundle, 'Task').flatMap((task) => {
      const list = lists.get(refId(task.focus?.reference, 'List') ?? '');
      const gateway = toGatewayView(task);
      const code = list?.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
      if (!list?.id || !gateway || !code || !list.date) return [];
      const patient = patients.get(refId(list.subject?.reference, 'Patient') ?? '');
      return [{ prescriptionId: list.id, code, signedAt: list.date, ...(patient ? { patientName: toPatientSummary(patient).fullName } : {}), ...(list.source?.display ? { doctorName: list.source.display } : {}), gateway }];
    });
  }

  async retryPrescription(id: string, now: Date): Promise<'ok' | 'not-found' | 'not-retryable'> {
    const list = await this.readOrUndefined('List', id);
    const code = list?.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
    if (!list || !code) return 'not-found';
    const task = await this.medplum.searchOne('Task', { identifier: `${SYSTEMS.prescriptionLocal}|${code}`, code: SEND_TASK });
    if (!task) return 'not-found';
    if (task.status === 'completed') return 'not-retryable';
    await this.medplum.updateResource(requeue(task, now), ifMatch(task));
    return 'ok';
  }

  // ------------------------------------------------------------------------------------------ hộp thư đi (outbox)

  async dueSends(now: Date, limit: number): Promise<OutboxJob[]> {
    const tasks = await this.medplum.searchResources('Task', { code: SEND_TASK, status: 'requested,on-hold,in-progress', _sort: '_lastUpdated', _count: String(limit * 3) });
    const jobs: OutboxJob[] = [];
    for (const task of tasks.filter((t) => isDue(t, now, this.policy))) {
      if (jobs.length >= limit) break;
      const job = await this.toJob(task);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  async claim(job: OutboxJob, now: Date): Promise<boolean> {
    const task = await this.readOrUndefined('Task', job.taskId);
    if (!task || task.meta?.versionId !== job.version || !isDue(task, now, this.policy)) return false;
    try {
      await this.medplum.updateResource(claim(task, now), ifMatch(task));
      return true;
    } catch (err) {
      if (isPreconditionFailed(err)) return false;
      throw err;
    }
  }

  async complete(job: OutboxJob, nationalCode: string, now: Date): Promise<void> {
    const task = await this.medplum.readResource('Task', job.taskId);
    await this.medplum.updateResource(markSent(task, nationalCode, now), ifMatch(task));
  }

  async fail(job: OutboxJob, error: string, now: Date, retryable: boolean): Promise<void> {
    const task = await this.medplum.readResource('Task', job.taskId);
    await this.medplum.updateResource(markFailed(task, error, now, this.policy, !retryable), ifMatch(task));
  }

  // ------------------------------------------------------------------------------------------------ số đo

  async finishedVisits(fromDay: string, limit: number): Promise<{ visits: FinishedVisit[]; truncated: boolean }> {
    const found = await this.medplum.searchResources(
      'Encounter',
      new URLSearchParams([['status', 'finished'], ['date', `ge${vnDayRange(fromDay).start}`], ['_sort', '-date'], ['_count', String(limit + 1)]])
    );
    const visits = found.slice(0, limit).map((e): FinishedVisit => {
      const individual = e.participant?.[0]?.individual;
      const seconds = e.extension?.find((x) => x.url === EXTENSIONS.visitSeconds)?.valueInteger;
      return { doctorName: individual?.display, doctorUserId: individual?.identifier?.value, seconds };
    });
    return { visits, truncated: found.length > limit };
  }

  // ----------------------------------------------------------------------------------------------- nội bộ

  private item(e: Encounter, patient: Patient): QueueItem {
    const item = toQueueItem(e, patient);
    if (!item) throw new Error('Lượt khám thiếu trường bắt buộc');
    return item;
  }

  private dayQuery(day: string, param: string, extra: Record<string, string> = {}): URLSearchParams {
    const { start, end } = vnDayRange(day);
    return new URLSearchParams([[param, `ge${start}`], [param, `lt${end}`], ['_count', String(QUEUE_MAX)], ...Object.entries(extra)]);
  }

  private async readOrUndefined<RT extends 'Patient' | 'Encounter' | 'AllergyIntolerance' | 'Condition' | 'List' | 'Task'>(type: RT, id: string) {
    try {
      return await this.medplum.readResource(type, id);
    } catch (err) {
      if (isNotFound(normalizeOperationOutcome(err))) return undefined;
      throw err;
    }
  }

  private async search(query: URLSearchParams | Record<string, string>): Promise<PatientSummary[]> {
    const patients: Patient[] = await this.medplum.searchResources('Patient', query);
    return patients.map(toPatientSummary);
  }

  private async requestsOf(list: List): Promise<MedicationRequest[]> {
    const ids = (list.entry ?? []).map((e) => refId(e.item?.reference, 'MedicationRequest')).filter((x): x is string => !!x);
    return ids.length ? this.medplum.searchResources('MedicationRequest', { _id: ids.join(','), _count: String(ids.length) }) : [];
  }

  /** Tìm lượt khám kèm mọi thứ liên quan trong MỘT truy vấn (`_revinclude`), rồi ghép lại theo lượt khám. */
  private async loadVisits(query: Record<string, string>): Promise<VisitSummary[]> {
    const params = new URLSearchParams(Object.entries(query));
    for (const r of REVINCLUDES) params.append('_revinclude', r);
    params.append('_include', 'Encounter:patient');
    const bundle = await this.medplum.search('Encounter', params);
    const encounters = entries<Encounter>(bundle, 'Encounter');
    const patients = entries<Patient>(bundle, 'Patient');
    const byEnc = <T extends Resource & { encounter?: { reference?: string } }>(type: T['resourceType']) => {
      const map = new Map<string, T[]>();
      for (const r of entries<T>(bundle, type)) {
        const id = refId(r.encounter?.reference, 'Encounter');
        if (id) map.set(id, [...(map.get(id) ?? []), r]);
      }
      return map;
    };
    const conditions = byEnc<Condition>('Condition');
    const observations = byEnc<Observation>('Observation');
    const impressions = byEnc<ClinicalImpression>('ClinicalImpression');
    const requests = byEnc<MedicationRequest>('MedicationRequest');
    const lists = byEnc<List>('List');

    const prescriptionLists = [...lists.values()].flat().filter((l) => l.code?.coding?.some((c) => c.code === 'prescription'));
    const codes = prescriptionLists.map((l) => l.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value).filter((c): c is string => !!c);
    const tasks = codes.length ? await this.medplum.searchResources('Task', { identifier: codes.map((c) => `${SYSTEMS.prescriptionLocal}|${c}`).join(','), code: SEND_TASK, _count: String(codes.length) }) : [];
    const taskByCode = new Map(tasks.map((t) => [t.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value ?? '', t]));

    return encounters.flatMap((enc) => {
      const list = (lists.get(enc.id!) ?? []).find((l) => l.code?.coding?.some((c) => c.code === 'prescription'));
      const code = list?.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
      const patient = patients.find((p) => `Patient/${p.id}` === enc.subject?.reference);
      const visit = toVisitSummary({
        encounter: enc,
        conditions: conditions.get(enc.id!) ?? [],
        impression: impressions.get(enc.id!)?.[0],
        observations: observations.get(enc.id!) ?? [],
        list,
        requests: requests.get(enc.id!) ?? [],
        task: code ? taskByCode.get(code) : undefined,
        patientName: patient ? toPatientSummary(patient).fullName : undefined,
      });
      return visit ? [visit] : [];
    });
  }

  private async toJob(task: Task): Promise<OutboxJob | undefined> {
    const listId = refId(task.focus?.reference, 'List');
    const patientId = refId(task.for?.reference, 'Patient');
    const localCode = task.identifier?.find((i) => i.system === SYSTEMS.prescriptionLocal)?.value;
    if (!task.id || !task.meta?.versionId || !listId || !patientId || !localCode) return undefined;
    const list = await this.readOrUndefined('List', listId);
    const encounterId = refId(list?.encounter?.reference, 'Encounter');
    if (!list || !encounterId) return undefined;
    // Điểm chốt: chỉ gửi đơn của lượt khám đã đóng. Nếu việc hoàn tất ghi dở thì đơn chưa được gửi đi.
    const enc = await this.readOrUndefined('Encounter', encounterId);
    if (enc?.status !== 'finished') return undefined;
    const [patient, requests, conditions] = await Promise.all([
      this.readOrUndefined('Patient', patientId),
      this.requestsOf(list),
      this.medplum.searchResources('Condition', { encounter: `Encounter/${encounterId}`, _count: '50' }),
    ]);
    const summary = toPrescriptionSummary(list, requests, task);
    if (!patient || !summary) return undefined;
    const p = toPatientSummary(patient);
    const cccd = patient.identifier?.find((i) => i.system === SYSTEMS.cccd)?.value;
    const payload: GatewayPayload = {
      localCode,
      issuedAt: summary.signedAt,
      doctorName: summary.signerName ?? '',
      patient: { name: p.fullName, ...(p.birthDate ? { birthDate: p.birthDate } : {}), ...(cccd ? { cccd } : {}), ...(p.gender ? { gender: p.gender } : {}) },
      diagnoses: conditions.filter(isEncounterDiagnosis).map(toDiagnosisView).filter((d): d is DiagnosisView => d !== undefined),
      lines: summary.lines,
      ...(summary.advice ? { advice: summary.advice } : {}),
    };
    return { taskId: task.id, localCode, attempts: toGatewayView(task)?.attempts ?? 0, payload, version: task.meta.versionId };
  }
}

/** Mỗi phòng khám một MedplumClient đăng nhập bằng tài khoản máy riêng (client credentials). */
export class MedplumTenants {
  private readonly clients = new Map<string, Promise<MedplumClient>>();
  private readonly tenants: Map<string, Tenant>;

  constructor(
    private readonly baseUrl: string,
    tenants: Tenant[],
    private readonly policy: RetryPolicy = DEFAULT_RETRY
  ) {
    this.tenants = new Map(tenants.map((t) => [t.slug, t]));
  }

  readonly store: StoreFactory = async (slug) => new MedplumClinicStore(await this.client(slug), this.policy);

  private client(slug: string): Promise<MedplumClient> {
    const tenant = this.tenants.get(slug);
    if (!tenant) return Promise.reject(new Error(`Phòng khám không tồn tại: ${slug}`));
    let client = this.clients.get(slug);
    if (!client) {
      client = this.login(tenant);
      this.clients.set(slug, client);
      // Đăng nhập lỗi thì lần sau thử lại thay vì giữ kết quả lỗi mãi.
      client.catch(() => this.clients.delete(slug));
    }
    return client;
  }

  private async login(tenant: Tenant): Promise<MedplumClient> {
    // cacheTime 0: BFF phục vụ nhiều người dùng, không được trả bản đọc cũ từ bộ nhớ đệm của client.
    const medplum = new MedplumClient({ baseUrl: this.baseUrl, clientId: tenant.clientId, clientSecret: tenant.secret, cacheTime: 0 });
    await medplum.startClientLogin(tenant.clientId, tenant.secret);
    return medplum;
  }
}
