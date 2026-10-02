import type { Encounter, Patient } from '@medplum/fhirtypes';
import { DomainError, EXTENSIONS, SYSTEMS, toPatientSummary } from '@phongmach/fhir-vn-model';
import type { DisplayBoard, DisplayItem, QueueItem, QueuePriority, QueueStatus, Specialty } from './dto.js';
import { PRIORITIES, SPECIALTIES } from './dto.js';

const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

/** YYYYMMDD-NNN */
export function visitCode(day: string, number: number): string {
  return `${day.replaceAll('-', '')}-${String(number).padStart(3, '0')}`;
}

const STATUS: Record<string, QueueStatus> = { arrived: 'waiting', planned: 'waiting', 'in-progress': 'in-exam', finished: 'done', cancelled: 'cancelled' };

export interface CheckInInput {
  patientId: string;
  clientUuid: string;
  specialty: Specialty;
  priority: QueuePriority;
  reason?: string | undefined;
}

export function buildCheckIn(input: CheckInInput, ctx: { day: string; number: number; now: Date }): Encounter {
  if (!SPECIALTIES.includes(input.specialty)) throw new DomainError('invalid-state', 'Chuyên khoa không hợp lệ');
  if (!PRIORITIES.includes(input.priority)) throw new DomainError('invalid-state', 'Mức ưu tiên không hợp lệ');
  const reason = input.reason?.trim();
  return {
    resourceType: 'Encounter',
    status: 'arrived',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    identifier: [
      { system: SYSTEMS.clientUuid, value: input.clientUuid.toLowerCase() },
      { system: SYSTEMS.visitCode, value: visitCode(ctx.day, ctx.number) },
    ],
    subject: { reference: `Patient/${input.patientId}` },
    serviceType: { coding: [{ system: SYSTEMS.specialty, code: input.specialty }] },
    priority: { coding: [{ system: SYSTEMS.priority, code: input.priority }] },
    period: { start: ctx.now.toISOString() },
    ...(reason ? { reasonCode: [{ text: reason }] } : {}),
    extension: [{ url: EXTENSIONS.queueNumber, valueInteger: ctx.number }],
  };
}

/** Số thứ tự kế tiếp từ các lượt đã có trong ngày (không dựa vào bộ đếm chung để khỏi phải khóa). */
export function nextNumber(todays: Encounter[]): number {
  return todays.reduce((max, e) => Math.max(max, queueNumberOf(e) ?? 0), 0) + 1;
}

export function queueNumberOf(e: Encounter): number | undefined {
  return e.extension?.find((x) => x.url === EXTENSIONS.queueNumber)?.valueInteger;
}

export const specialtyOf = (e: Encounter): Specialty => (e.serviceType?.coding?.find((c) => c.system === SYSTEMS.specialty)?.code === 'nhi' ? 'nhi' : 'noi');

export const priorityOf = (e: Encounter): QueuePriority => {
  const code = e.priority?.coding?.find((c) => c.system === SYSTEMS.priority)?.code;
  return PRIORITIES.find((p) => p === code) ?? 'normal';
};

/**
 * `clientUuid` của lần cấp số. Lượt đã ký còn mang một định danh cùng hệ của lần hoàn tất ("<uuid>:complete", xem visit.ts):
 * chỉ lấy định danh không có hậu tố.
 */
export const checkInUuidOf = (e: Encounter): string | undefined => e.identifier?.find((i) => i.system === SYSTEMS.clientUuid && !!i.value && !i.value.includes(':'))?.value;

export function toQueueItem(e: Encounter, patient: Patient | undefined): QueueItem | undefined {
  const number = queueNumberOf(e);
  const code = e.identifier?.find((i) => i.system === SYSTEMS.visitCode)?.value;
  const patientId = e.subject?.reference?.replace('Patient/', '');
  if (!e.id || number === undefined || !code || !patientId || !e.period?.start) return undefined;
  const summary = patient ? toPatientSummary(patient) : undefined;
  const opened = e.extension?.find((x) => x.url === EXTENSIONS.examOpened)?.valueDateTime;
  const doctor = e.participant?.[0]?.individual?.display;
  const doctorUserId = e.participant?.[0]?.individual?.identifier?.value;
  const reason = e.reasonCode?.[0]?.text;
  const clientUuid = checkInUuidOf(e);
  return {
    id: e.id,
    number,
    code,
    status: STATUS[e.status ?? ''] ?? 'waiting',
    priority: priorityOf(e),
    specialty: specialtyOf(e),
    patientId,
    patientName: summary?.fullName ?? '(không rõ)',
    ...(summary?.birthDate ? { birthDate: summary.birthDate } : {}),
    arrivedAt: e.period.start,
    ...(opened ? { calledAt: opened } : {}),
    ...(doctor ? { doctorName: doctor } : {}),
    ...(doctorUserId ? { doctorUserId } : {}),
    ...(reason ? { reason } : {}),
    ...(clientUuid ? { clientUuid } : {}),
  };
}

const PRIORITY_RANK: Record<QueuePriority, number> = { urgent: 0, appointment: 1, normal: 2 };

/**
 * Thứ tự gọi: đang khám trước, rồi đang chờ (cấp cứu/ưu tiên → đã hẹn → thường, cùng nhóm theo số thứ tự), rồi đã xong/hủy.
 * Quy tắc cơ bản của M0; ưu tiên theo giờ hẹn là việc của M1.
 */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  const group = (s: QueueStatus) => (s === 'in-exam' ? 0 : s === 'waiting' ? 1 : 2);
  return [...items].sort(
    (a, b) =>
      group(a.status) - group(b.status) ||
      (a.status === 'waiting' ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] : 0) ||
      a.number - b.number
  );
}

/** "Nguyễn Văn An" → "N.V.A": chỉ chữ cái đầu của từng từ. */
export function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w][0]!.toUpperCase())
    .join('.');
}

export function toDisplayBoard(clinic: string, items: QueueItem[], now: Date): DisplayBoard {
  const pick = (i: QueueItem): DisplayItem => ({ number: i.number, initials: initialsOf(i.patientName), priority: i.priority });
  const sorted = sortQueue(items);
  return {
    clinic,
    now: now.toISOString(),
    inExam: sorted.filter((i) => i.status === 'in-exam').map(pick),
    waiting: sorted.filter((i) => i.status === 'waiting').map(pick),
  };
}

/**
 * Lượt khám sau khi bác sĩ mở hồ sơ. Gọi lại bởi cùng bác sĩ thì giữ nguyên (không đặt lại mốc thời gian).
 * `openedAt`: mở lúc mất mạng, mốc theo đồng hồ máy khách (đã kiểm tra hợp lý), được đánh dấu nguồn 'client' (OFF-3).
 */
export function markCalled(
  e: Encounter,
  doctor: { id?: string | undefined; name: string; userId?: string | undefined },
  now: Date,
  openedAt?: Date
): Encounter {
  const extension = [
    ...(e.extension ?? []).filter((x) => x.url !== EXTENSIONS.examOpened && x.url !== EXTENSIONS.examOpenedSource),
    { url: EXTENSIONS.examOpened, valueDateTime: (openedAt ?? now).toISOString() },
    ...(openedAt ? [{ url: EXTENSIONS.examOpenedSource, valueCode: 'client' }] : []),
  ];
  return {
    ...e,
    status: 'in-progress',
    participant: [
      {
        individual: {
          ...(doctor.id ? { reference: `Practitioner/${doctor.id}` } : {}),
          ...(doctor.userId ? { identifier: { system: SYSTEMS.user, value: doctor.userId } } : {}),
          display: doctor.name,
        },
      },
    ],
    extension,
  };
}
