// Xuất số đo của phiên thử (M0-1): chọn đúng lượt đưa vào `computeMetrics`, đếm riêng những gì bị loại, không giấu gì.
import type { QueueItem } from '@phongmach/clinical';
import { describe, expect, it } from 'vitest';
import { MAX_COUNTED_SECONDS, TARGET_P50_SECONDS, TARGET_P90_SECONDS, computeMetrics } from '../../src/metrics.js';
import type { FinishedVisit } from '../../src/store.js';
import { REHEARSAL_BANNER, buildReport, exportRange, toCsv, toMarkdown, type ExportInput } from '../../scripts/trial/export.js';

// 10:00 ngày 04/11/2026 giờ Việt Nam.
const NOW = new Date('2026-11-04T03:00:00Z');
const DOCTORS = [
  { userId: 'bs1', name: 'Bác sĩ thử 1' },
  { userId: 'bs2', name: 'Bác sĩ thử 2' },
  { userId: 'bs3', name: 'Bác sĩ thử 3' },
];
const nameOf = (userId: string) => DOCTORS.find((d) => d.userId === userId)?.name ?? 'Điều phối viên (xem số đo)';

/** Bệnh nhân của bộ ca: `<bác sĩ>-N01` là ca tính số đo, `<bác sĩ>-NL1` là ca làm quen. */
const patients = new Map<string, { doctor: 'bs1' | 'bs2' | 'bs3'; caseId: string; warmup: boolean }>();
for (const doctor of ['bs1', 'bs2', 'bs3'] as const) {
  for (let i = 1; i <= 12; i++) patients.set(`${doctor}-N${String(i).padStart(2, '0')}`, { doctor, caseId: `N${String(i).padStart(2, '0')}`, warmup: false });
  for (let i = 1; i <= 3; i++) patients.set(`${doctor}-NL${i}`, { doctor, caseId: `NL${i}`, warmup: true });
}

let serial = 0;
function visit(doctor: string, caseId: string, seconds: number | undefined, over: Partial<FinishedVisit> = {}): FinishedVisit {
  serial += 1;
  const finished = new Date(NOW.getTime() - serial * 60_000);
  return {
    doctorUserId: doctor,
    doctorName: nameOf(doctor),
    seconds,
    source: 'server',
    encounterId: `e${serial}`,
    patientId: `${doctor}-${caseId}`,
    code: `20261104-${String(serial).padStart(3, '0')}`,
    openedAt: seconds === undefined ? undefined : new Date(finished.getTime() - seconds * 1000).toISOString(),
    finishedAt: finished.toISOString(),
    ...over,
  };
}
const measuredTen = (doctor: string, seconds: number[]) => seconds.map((s, i) => visit(doctor, `N${String(i + 1).padStart(2, '0')}`, s));
const input = (visits: FinishedVisit[], over: Partial<ExportInput> = {}): ExportInput => ({
  clinic: { slug: 'thu-m0-1', name: 'Phòng khám thử M0-1' },
  rehearsal: false,
  now: NOW,
  days: 1,
  visits,
  truncated: false,
  doctors: DOCTORS,
  patients,
  queueItems: [],
  ...over,
});
const TEN = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('xuất số đo phiên thử', () => {
  it('khoảng ngày tính như đường GET /api/metrics/visits: "days" ngày đến hôm nay theo giờ Việt Nam', () => {
    expect(exportRange(NOW, 1)).toEqual({ from: '2026-11-04', to: '2026-11-04' });
    expect(exportRange(NOW, 30)).toEqual({ from: '2026-10-06', to: '2026-11-04' });
    // 23:30 ngày 04/11 giờ UTC đã là 05/11 ở Việt Nam.
    expect(exportRange(new Date('2026-11-04T23:30:00Z'), 1).to).toBe('2026-11-05');
  });

  it('ca làm quen bị loại khỏi số đo M0-1 nhưng vẫn nằm trong bảng đối chiếu với màn hình', () => {
    const visits = [...[3, 4, 5].map((s, i) => visit('bs1', `NL${i + 1}`, s)), ...measuredTen('bs1', TEN)];
    const r = buildReport(input(visits));
    const bs1 = r.doctors[0]!;
    expect(bs1.metrics).toEqual({ visits: 10, excluded: 0, clientMeasured: 0, invalidClock: 0, p50Seconds: 50, p90Seconds: 90 });
    expect(bs1).toMatchObject({ warmupExcluded: 3, outsideExcluded: 0, abandoned: 0, enoughVisits: true, p50Ok: true, p90Ok: true });
    // Màn hình "Thời gian khám" không biết ca làm quen: 13 lượt, trung vị bị ba lượt nhanh kéo xuống.
    expect(r.screen.doctors).toEqual([{ name: 'Bác sĩ thử 1', visits: 13, excluded: 0, clientMeasured: 0, invalidClock: 0, p50Seconds: 40, p90Seconds: 90 }]);
    expect(r.rows.filter((x) => x.counted === 'không: ca làm quen').map((x) => x.caseId).sort()).toEqual(['NL1', 'NL2', 'NL3']);
    expect(r.rows.filter((x) => x.counted === 'có')).toHaveLength(10);
  });

  it('mọi con số của bảng là kết quả của computeMetrics trên các lượt được chọn, không tính lại', () => {
    const visits = [
      ...measuredTen('bs1', TEN),
      ...measuredTen('bs2', [61, 62, 63, 64, 65, 66, 67, 68, 69, 130]),
      visit('bs1', 'NL1', 2),
      visit('dieu-phoi', 'N01', 5, { patientId: 'bs1-N01' }),
    ];
    const r = buildReport(input(visits));
    const chosen = visits.filter((v) => v.doctorUserId !== 'dieu-phoi' && !v.patientId!.includes('NL'));
    const expected = computeMetrics(chosen, { from: '2026-11-04', to: '2026-11-04', truncated: false });
    expect(r.m01).toEqual(expected);
    expect(r.screen).toEqual(computeMetrics(visits, { from: '2026-11-04', to: '2026-11-04', truncated: false }));
    for (const d of r.doctors.filter((x) => x.metrics.visits)) {
      const { name: _name, ...want } = expected.doctors.find((x) => x.name === d.name)!;
      void _name;
      expect(d.metrics).toEqual(want);
    }
    expect(r.doctors.filter((x) => x.metrics.visits).map((x) => x.userId)).toEqual(['bs1', 'bs2']);
    expect(r.otherUsers).toBe(1);
    expect(r.m01.targetP50Seconds).toBe(TARGET_P50_SECONDS);
    expect(r.m01.targetP90Seconds).toBe(TARGET_P90_SECONDS);
  });

  it('so với ngưỡng 60/120 giây và mức 10 lượt cho từng bác sĩ; bác sĩ chưa có lượt nào thì để trống, không coi là đạt', () => {
    const visits = [...measuredTen('bs1', TEN), ...measuredTen('bs2', [61, 62, 63, 64, 65, 66, 67, 68, 69, 130]).slice(0, 7), ...measuredTen('bs2', [200, 210, 220]).map((v, i) => ({ ...v, patientId: `bs2-N${String(i + 8).padStart(2, '0')}` }))];
    const r = buildReport(input(visits));
    const [bs1, bs2, bs3] = r.doctors;
    expect(bs1).toMatchObject({ enoughVisits: true, p50Ok: true, p90Ok: true });
    expect(bs2!.metrics).toMatchObject({ visits: 10, p50Seconds: 65, p90Seconds: 210 });
    expect(bs2).toMatchObject({ enoughVisits: true, p50Ok: false, p90Ok: false });
    expect(bs3!.metrics).toEqual({ visits: 0, excluded: 0, clientMeasured: 0, invalidClock: 0 });
    expect(bs3).toMatchObject({ enoughVisits: false, p50Ok: undefined, p90Ok: undefined });
    const md = toMarkdown(r);
    expect(md).toContain('| Bác sĩ thử 2 | 10 | 65 | 210 | 0 | 0 | 0 | 0 | 0 | 0 | có | KHÔNG đạt | KHÔNG đạt |');
    expect(md).toContain('| Bác sĩ thử 3 | 0 | — | — | 0 | 0 | 0 | 0 | 0 | 0 | CHƯA (0/10) | — | — |');
    expect(md).toContain('2/3 bác sĩ đủ lượt');
  });

  it('chưa đủ 10 lượt thì ghi rõ, kể cả khi p50 và p90 đang đạt', () => {
    const r = buildReport(input(measuredTen('bs1', TEN).slice(0, 7)));
    expect(r.doctors[0]).toMatchObject({ enoughVisits: false, p50Ok: true, p90Ok: true });
    expect(toMarkdown(r)).toContain('CHƯA (7/10)');
  });

  it('lượt dài hơn 30 phút, giờ máy khách không hợp lý, lượt đo ở máy khách: đếm riêng từng loại, không giấu', () => {
    const visits = [
      ...measuredTen('bs1', TEN),
      visit('bs1', 'N11', MAX_COUNTED_SECONDS + 1),
      visit('bs1', 'N12', undefined, { source: 'client-invalid' }),
      { ...visit('bs2', 'N01', 45), source: 'client' as const },
      visit('bs2', 'N02', undefined),
    ];
    const r = buildReport(input(visits));
    expect(r.doctors[0]!.metrics).toMatchObject({ visits: 10, excluded: 1, invalidClock: 1, clientMeasured: 0 });
    expect(r.doctors[1]!.metrics).toMatchObject({ visits: 1, clientMeasured: 1 });
    const counted = (caseId: string, doctor: string) => r.rows.find((x) => x.caseId === caseId && x.doctorUserId === doctor)!.counted;
    expect(counted('N11', 'bs1')).toBe('không: dài hơn 30 phút');
    expect(counted('N12', 'bs1')).toBe('không: giờ máy khách không hợp lý');
    expect(counted('N01', 'bs2')).toBe('có');
    expect(counted('N02', 'bs2')).toBe('không: không có mốc mở hồ sơ');
    expect(toMarkdown(r)).toContain('| Bác sĩ thử 1 | 10 | 50 | 90 | 0 | 1 | 1 |');
  });

  it('bệnh nhân ngoài bộ ca và lượt của người không phải bác sĩ thử không vào số đo, được đếm riêng', () => {
    const visits = [...measuredTen('bs1', TEN), visit('bs1', 'X', 15, { patientId: 'tao-tay' }), visit('dieu-phoi', 'N01', 9, { patientId: 'bs2-N01' })];
    const r = buildReport(input(visits));
    expect(r.doctors[0]).toMatchObject({ outsideExcluded: 1 });
    expect(r.doctors[0]!.metrics.visits).toBe(10);
    expect(r.otherUsers).toBe(1);
    expect(r.rows.find((x) => x.doctorUserId === 'dieu-phoi')!.counted).toBe('không: không phải bác sĩ thử');
    expect(r.rows.find((x) => x.kind === 'ngoai-bo-ca' && x.doctorUserId === 'bs1')!.counted).toBe('không: bệnh nhân ngoài bộ ca');
    expect(toMarkdown(r)).toContain('Có 1 lượt đã ký của người không phải bác sĩ thử');
  });

  it('lượt đã mở hồ sơ mà không ký (đang khám dở, hoặc bị hủy sau khi mở) được đếm theo bác sĩ và có dòng trong CSV', () => {
    const item = (over: Partial<QueueItem>): QueueItem => ({ id: 'q', number: 1, code: '20261104-090', status: 'waiting', priority: 'normal', specialty: 'noi', patientId: 'bs1-N05', patientName: 'X', arrivedAt: NOW.toISOString(), ...over });
    const queueItems = [
      item({ status: 'in-exam', calledAt: '2026-11-04T02:00:00Z', doctorUserId: 'bs1', doctorName: 'Bác sĩ thử 1', code: '20261104-091' }),
      item({ status: 'cancelled', calledAt: '2026-11-04T02:10:00Z', doctorUserId: 'bs1', doctorName: 'Bác sĩ thử 1', code: '20261104-092', patientId: 'bs1-N06' }),
      item({ status: 'cancelled', code: '20261104-093' }), // hủy khi còn đang chờ: chưa ai mở
      item({ status: 'done', calledAt: '2026-11-04T02:20:00Z', doctorUserId: 'bs1', code: '20261104-094' }),
      item({ status: 'waiting', code: '20261104-095' }),
    ];
    const r = buildReport(input(measuredTen('bs1', TEN), { queueItems }));
    expect(r.doctors[0]!.abandoned).toBe(2);
    expect(r.doctors[1]!.abandoned).toBe(0);
    const notSigned = r.rows.filter((x) => x.finishedAt === '');
    expect(notSigned.map((x) => [x.code, x.caseId, x.counted])).toEqual([
      ['20261104-091', 'N05', 'không: mở rồi chưa ký (đang khám dở)'],
      ['20261104-092', 'N06', 'không: mở rồi bị hủy, không ký'],
    ]);
    expect(notSigned[0]!.openedAt).toBe('2026-11-04 09:00:00');
  });

  it('CSV: có BOM, mỗi lượt một dòng, giờ Việt Nam, thoát dấu phẩy và dấu nháy', () => {
    const visits = [visit('bs1', 'N01', 42, { doctorName: 'Bác sĩ "thử", 1', openedAt: '2026-11-04T02:00:00Z', finishedAt: '2026-11-04T02:00:42Z', code: '20261104-001' })];
    const csv = toCsv(buildReport(input(visits, { doctors: [{ userId: 'bs1', name: 'Bác sĩ "thử", 1' }] })));
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('bac_si,ma_nguoi_dung,ca,loai_ca,ngay,ma_luot_kham,mo_ho_so_luc,ky_luc,giay,nguon_do,tinh_vao_phan_vi');
    expect(lines[1]).toBe('"Bác sĩ ""thử"", 1",bs1,N01,tinh-so-do,2026-11-04,20261104-001,2026-11-04 09:00:00,2026-11-04 09:00:42,42,server,có');
  });

  it('phiên diễn tập kỹ thuật đóng nhãn "không phải số của bác sĩ"; phiên thật thì không', () => {
    const visits = measuredTen('bs1', TEN);
    expect(toMarkdown(buildReport(input(visits, { rehearsal: true })))).toContain(REHEARSAL_BANNER);
    expect(toMarkdown(buildReport(input(visits)))).not.toContain(REHEARSAL_BANNER);
  });

  it('định danh lượt khám và bệnh nhân chỉ dùng cho bản xuất: kết quả của computeMetrics (thứ đường /api/metrics/visits trả về) không chứa chúng', () => {
    const v = visit('bs1', 'N01', 42, { encounterId: 'luot-kham-bi-mat', patientId: 'benh-nhan-bi-mat', code: '20261104-777' });
    const json = JSON.stringify(computeMetrics([v], { from: '2026-11-04', to: '2026-11-04', truncated: false }));
    for (const id of ['luot-kham-bi-mat', 'benh-nhan-bi-mat', '20261104-777', v.openedAt!, v.finishedAt!]) expect(json).not.toContain(id);
  });

  it('báo khi số liệu bị cắt, và từ chối khi hai bác sĩ thử trùng tên (bảng gộp theo tên)', () => {
    expect(toMarkdown(buildReport(input([], { truncated: true })))).toContain('Số liệu bị cắt');
    expect(() => buildReport(input([], { doctors: [DOCTORS[0]!, { userId: 'bs9', name: DOCTORS[0]!.name }] }))).toThrow(/khác nhau/);
  });
});
