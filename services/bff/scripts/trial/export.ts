// `pnpm trial export`: xuất số đo của phiên thử ra CSV (từng lượt) và một bảng tóm tắt theo từng bác sĩ.
//
// Mọi con số p50, p90, số lượt, số lượt bị loại đều do `computeMetrics` của BFF tính (services/bff/src/metrics.ts), trên đúng dữ liệu
// mà đường `GET /api/metrics/visits` đọc (`store.finishedVisits`). Tệp này không có công thức phân vị hay ngưỡng loại nào của riêng nó:
// nó chỉ chọn lượt nào đưa vào hàm đó (bỏ ca làm quen, bỏ người không phải bác sĩ thử) và trình bày kết quả.
import { addDays, vnDay, type MetricsGroup, type QueueItem, type VisitMetrics } from '@phongmach/clinical';
import { M01_DOCTORS, M01_MIN_VISITS } from '@phongmach/trial';
import { computeMetrics } from '../../src/metrics.js';
import type { FinishedVisit } from '../../src/store.js';
import type { CasePatient } from './common.js';

export type RowKind = 'tinh-so-do' | 'lam-quen' | 'ngoai-bo-ca';

export interface ExportRow {
  doctorName: string;
  doctorUserId: string;
  caseId: string;
  kind: RowKind;
  day: string;
  code: string;
  openedAt: string;
  finishedAt: string;
  seconds: number | undefined;
  source: string;
  /** Lượt này có vào p50/p90 của M0-1 không, và nếu không thì vì sao. */
  counted: string;
}

export interface DoctorSummary {
  userId: string;
  name: string;
  /** Do `computeMetrics` tính trên các lượt của bác sĩ này sau khi bỏ ca làm quen và lượt ngoài bộ ca. */
  metrics: MetricsGroup;
  warmupExcluded: number;
  outsideExcluded: number;
  /** Đã mở hồ sơ nhưng không ký (đang khám dở hoặc bị hủy sau khi mở). */
  abandoned: number;
  enoughVisits: boolean;
  p50Ok: boolean | undefined;
  p90Ok: boolean | undefined;
}

export interface ExportReport {
  clinic: { slug: string; name: string };
  rehearsal: boolean;
  generatedAt: string;
  days: number;
  /** Đúng thứ màn hình "Thời gian khám" của chủ phòng khám hiển thị cho cùng khoảng ngày: mọi lượt, mọi người, kể cả ca làm quen. */
  screen: VisitMetrics;
  /** Số đo M0-1: chỉ ba bác sĩ thử, chỉ ca tính số đo. */
  m01: VisitMetrics;
  doctors: DoctorSummary[];
  minVisits: number;
  /** Lượt đã ký của người không phải bác sĩ thử (ví dụ điều phối viên tự khám thử). */
  otherUsers: number;
  rows: ExportRow[];
}

export interface ExportInput {
  clinic: { slug: string; name: string };
  rehearsal: boolean;
  now: Date;
  days: number;
  visits: FinishedVisit[];
  truncated: boolean;
  doctors: Array<{ userId: string; name: string }>;
  patients: Map<string, CasePatient>;
  /** Mọi lượt trong khoảng ngày (mọi trạng thái), để đếm lượt mở rồi không ký. */
  queueItems: QueueItem[];
}

/** Khoảng ngày theo đúng cách của đường `GET /api/metrics/visits`: `days` ngày tính đến hôm nay (giờ Việt Nam). */
export function exportRange(now: Date, days: number): { from: string; to: string } {
  const to = vnDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

const EMPTY: MetricsGroup = { visits: 0, excluded: 0, clientMeasured: 0, invalidClock: 0 };
/** Giờ Việt Nam, dạng "2026-11-04 09:15:32" (Excel đọc được). */
const vnTime = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') : '');

export function buildReport(input: ExportInput): ExportReport {
  const { from, to } = exportRange(input.now, input.days);
  const range = { from, to, truncated: input.truncated };
  const trialDoctors = new Map(input.doctors.map((d) => [d.userId, d]));
  if (new Set(input.doctors.map((d) => d.name)).size !== input.doctors.length) throw new Error('Tên các bác sĩ thử phải khác nhau (bảng số đo gộp theo tên)');

  const kindOf = (v: { patientId?: string | undefined }): RowKind => {
    const p = v.patientId ? input.patients.get(v.patientId) : undefined;
    return !p ? 'ngoai-bo-ca' : p.warmup ? 'lam-quen' : 'tinh-so-do';
  };
  const byTrialDoctor = input.visits.filter((v) => v.doctorUserId && trialDoctors.has(v.doctorUserId));
  const measured = byTrialDoctor.filter((v) => kindOf(v) === 'tinh-so-do');
  const screen = computeMetrics(input.visits, range);
  const m01 = computeMetrics(measured, range);

  const doctors = input.doctors.map((d): DoctorSummary => {
    const own = byTrialDoctor.filter((v) => v.doctorUserId === d.userId);
    const { name: _name, ...found } = m01.doctors.find((x) => x.name === d.name) ?? { name: d.name, ...EMPTY };
    void _name;
    const group: MetricsGroup = found;
    return {
      userId: d.userId,
      name: d.name,
      metrics: group,
      warmupExcluded: own.filter((v) => kindOf(v) === 'lam-quen').length,
      outsideExcluded: own.filter((v) => kindOf(v) === 'ngoai-bo-ca').length,
      abandoned: input.queueItems.filter((i) => i.doctorUserId === d.userId && !!i.calledAt && (i.status === 'in-exam' || i.status === 'cancelled')).length,
      enoughVisits: group.visits >= M01_MIN_VISITS,
      p50Ok: group.p50Seconds === undefined ? undefined : group.p50Seconds <= m01.targetP50Seconds,
      p90Ok: group.p90Seconds === undefined ? undefined : group.p90Seconds <= m01.targetP90Seconds,
    };
  });

  // Lý do một lượt không vào phân vị lấy từ chính `computeMetrics` (gọi trên riêng lượt đó), không chép lại ngưỡng của nó.
  const verdict = (v: FinishedVisit): string => {
    const one = computeMetrics([v], range).all;
    if (one.visits === 1) return 'có';
    if (one.excluded === 1) return `không: dài hơn ${Math.round(m01.excludedLongerThanSeconds / 60)} phút`;
    if (one.invalidClock === 1) return 'không: giờ máy khách không hợp lý';
    return 'không: không có mốc mở hồ sơ';
  };
  const rows: ExportRow[] = input.visits.map((v) => {
    const p = v.patientId ? input.patients.get(v.patientId) : undefined;
    const kind = kindOf(v);
    const trial = !!v.doctorUserId && trialDoctors.has(v.doctorUserId);
    return {
      doctorName: v.doctorName ?? '',
      doctorUserId: v.doctorUserId ?? '',
      caseId: p?.caseId ?? '',
      kind,
      day: v.finishedAt ? vnDay(new Date(v.finishedAt)) : '',
      code: v.code ?? '',
      openedAt: vnTime(v.openedAt),
      finishedAt: vnTime(v.finishedAt),
      seconds: v.seconds,
      source: v.source ?? '',
      counted: !trial ? 'không: không phải bác sĩ thử' : kind === 'lam-quen' ? 'không: ca làm quen' : kind === 'ngoai-bo-ca' ? 'không: bệnh nhân ngoài bộ ca' : verdict(v),
    };
  });
  for (const i of input.queueItems) {
    if (!i.calledAt || (i.status !== 'in-exam' && i.status !== 'cancelled')) continue;
    const p = input.patients.get(i.patientId);
    rows.push({
      doctorName: i.doctorName ?? '',
      doctorUserId: i.doctorUserId ?? '',
      caseId: p?.caseId ?? '',
      kind: !p ? 'ngoai-bo-ca' : p.warmup ? 'lam-quen' : 'tinh-so-do',
      day: vnDay(new Date(i.calledAt)),
      code: i.code,
      openedAt: vnTime(i.calledAt),
      finishedAt: '',
      seconds: undefined,
      source: '',
      counted: i.status === 'in-exam' ? 'không: mở rồi chưa ký (đang khám dở)' : 'không: mở rồi bị hủy, không ký',
    });
  }
  rows.sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'vi') || a.openedAt.localeCompare(b.openedAt) || a.code.localeCompare(b.code));

  return {
    clinic: input.clinic,
    rehearsal: input.rehearsal,
    generatedAt: input.now.toISOString(),
    days: input.days,
    screen,
    m01,
    doctors,
    minVisits: M01_MIN_VISITS,
    otherUsers: input.visits.length - byTrialDoctor.length,
    rows,
  };
}

const CSV_HEADER = ['bac_si', 'ma_nguoi_dung', 'ca', 'loai_ca', 'ngay', 'ma_luot_kham', 'mo_ho_so_luc', 'ky_luc', 'giay', 'nguon_do', 'tinh_vao_phan_vi'];
const cell = (value: string | number | undefined): string => {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Mỗi lượt một dòng. Có BOM để Excel đọc đúng tiếng Việt. */
export function toCsv(report: ExportReport): string {
  const lines = [CSV_HEADER, ...report.rows.map((r) => [r.doctorName, r.doctorUserId, r.caseId, r.kind, r.day, r.code, r.openedAt, r.finishedAt, r.seconds, r.source, r.counted])];
  return `﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}

export const REHEARSAL_BANNER = 'SỐ CHẠY THỬ KỸ THUẬT (diễn tập), KHÔNG PHẢI SỐ CỦA BÁC SĨ. Không ghi các con số này vào tài liệu như kết quả M0-1.';

const sec = (n: number | undefined) => (n === undefined ? '—' : String(n));
const pass = (ok: boolean | undefined) => (ok === undefined ? '—' : ok ? 'đạt' : 'KHÔNG đạt');

export function toMarkdown(report: ExportReport): string {
  const m = report.m01;
  const row = (name: string, g: MetricsGroup, extra: string[]) => `| ${[name, g.visits, sec(g.p50Seconds), sec(g.p90Seconds), g.clientMeasured, g.invalidClock, g.excluded, ...extra].join(' | ')} |`;
  const pooledP50 = m.all.p50Seconds === undefined ? undefined : m.all.p50Seconds <= m.targetP50Seconds;
  const pooledP90 = m.all.p90Seconds === undefined ? undefined : m.all.p90Seconds <= m.targetP90Seconds;
  const enough = report.doctors.filter((d) => d.enoughVisits).length;
  const out = [
    '# Số đo thời gian khám của phiên thử (M0-1)',
    '',
    ...(report.rehearsal ? [`> **${REHEARSAL_BANNER}**`, ''] : []),
    `- Phòng khám: ${report.clinic.name} (\`${report.clinic.slug}\`)`,
    `- Khoảng: ${m.from} đến ${m.to} (${report.days} ngày, giờ Việt Nam); xuất lúc ${vnTime(report.generatedAt)}`,
    '- Đồng hồ: từ lúc bác sĩ mở hồ sơ đến lúc ký, do máy chủ đo; lượt mở hoặc ký lúc mất mạng đo bằng đồng hồ máy khám (cột "Đo ở máy khám"). Cùng hàm tính với màn hình "Thời gian khám".',
    `- Ngưỡng M0-1 (kế hoạch, mục 5.3): ${M01_DOCTORS} bác sĩ thật, mỗi người ít nhất ${report.minVisits} lượt; p50 ≤ ${m.targetP50Seconds} giây, p90 ≤ ${m.targetP90Seconds} giây.`,
    '- Các con số này chỉ là số M0-1 khi các lượt do bác sĩ thật khám trong buổi thử. Lượt do đội kỹ thuật tự chạy là số chạy thử kỹ thuật.',
    ...(m.truncated ? ['- **Số liệu bị cắt** vì quá nhiều lượt trong khoảng: xuất lại với khoảng ngắn hơn.'] : []),
    '',
    '## Theo từng bác sĩ (ca tính số đo, đã loại ca làm quen)',
    '',
    `| Bác sĩ | Số lượt | p50 (giây) | p90 (giây) | Đo ở máy khám | Loại: giờ không hợp lý | Loại: dài hơn ${Math.round(m.excludedLongerThanSeconds / 60)} phút | Ca làm quen (loại) | Ngoài bộ ca (loại) | Mở rồi không ký | Đủ ${report.minVisits} lượt | p50 ≤ ${m.targetP50Seconds} | p90 ≤ ${m.targetP90Seconds} |`,
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.doctors.map((d) =>
      row(d.name, d.metrics, [String(d.warmupExcluded), String(d.outsideExcluded), String(d.abandoned), d.enoughVisits ? 'có' : `CHƯA (${d.metrics.visits}/${report.minVisits})`, pass(d.p50Ok), pass(d.p90Ok)])
    ),
    row('Gộp các bác sĩ thử', m.all, [
      String(report.doctors.reduce((n, d) => n + d.warmupExcluded, 0)),
      String(report.doctors.reduce((n, d) => n + d.outsideExcluded, 0)),
      String(report.doctors.reduce((n, d) => n + d.abandoned, 0)),
      `${enough}/${M01_DOCTORS} bác sĩ đủ lượt`,
      pass(pooledP50),
      pass(pooledP90),
    ]),
    '',
    'Kế hoạch chưa nói rõ ngưỡng áp cho từng bác sĩ hay cho số gộp: bảng ghi cả hai, người đọc biên bản quyết định.',
    '',
    '## Đối chiếu với màn hình "Thời gian khám" (mọi lượt, kể cả ca làm quen)',
    '',
    'Đăng nhập điều phối viên, mở "Thời gian khám", chọn cùng khoảng thời gian: bảng trên màn hình phải trùng bảng này.',
    '',
    '| Bác sĩ | Số lượt | Trung vị (p50) | p90 | Phiên bị loại | Đo ở máy khám | Giờ không hợp lý |',
    '|---|---|---|---|---|---|---|',
    ...report.screen.doctors.map((d) => `| ${[d.name, d.visits, sec(d.p50Seconds), sec(d.p90Seconds), d.excluded, d.clientMeasured, d.invalidClock].join(' | ')} |`),
    `| ${['Toàn phòng khám', report.screen.all.visits, sec(report.screen.all.p50Seconds), sec(report.screen.all.p90Seconds), report.screen.all.excluded, report.screen.all.clientMeasured, report.screen.all.invalidClock].join(' | ')} |`,
    '',
    ...(report.otherUsers ? [`Có ${report.otherUsers} lượt đã ký của người không phải bác sĩ thử: nằm trong bảng đối chiếu, không nằm trong số đo M0-1.`, ''] : []),
  ];
  return `${out.join('\n').trimEnd()}\n`;
}
