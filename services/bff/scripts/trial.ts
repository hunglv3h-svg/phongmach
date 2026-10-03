// Lệnh của phiên thử với bác sĩ (tiêu chí M0-1). Chạy ở gốc kho, cần stack Medplum đang chạy:
//
//   pnpm trial setup                          tạo hoặc dùng lại phòng khám thử, nạp bệnh nhân của bộ ca (chạy lại không tạo trùng)
//   pnpm trial queue bs1 noi warmup           xếp 3 ca làm quen (không tính số đo) cho bác sĩ thử 1, chuyên khoa nội
//   pnpm trial queue bs1 noi                  xếp 12 ca tính số đo; thêm "round=2" để xếp lại cả nhóm, "force" để xếp chồng
//   pnpm trial clear                          dọn sau lượt: hủy các lượt đang chờ; "force" hủy cả lượt đang khám dở
//   pnpm trial export                         xuất CSV và bảng tóm tắt (30 ngày); "days=1" cho riêng hôm nay; "name=<tên tệp>"
//   pnpm trial sheets                         sinh lại phiếu ca: docs/phien-thu/ca-mo-phong.md và hai tệp HTML để in
//   pnpm trial plan bs1 noi                   kế hoạch dạng JSON cho bài diễn tập kỹ thuật, ghi vào thư mục của phiên (thêm "warmup" cho ca làm quen)
//
// Phiên mặc định là `m0-1` (buổi thử thật). Phiên khác: TRIAL=<tên> pnpm trial …; tên bắt đầu bằng `dien-tap` là diễn tập kỹ thuật.
// Dữ liệu hoàn toàn là giả. Xem docs/phien-thu-bac-si.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays, type QueueItem, type Specialty } from '@phongmach/clinical';
import { ALL_CASES, casesOf, renderHtml, renderMarkdown } from '@phongmach/trial';
import { setup } from './trial/clinic.js';
import { DIR, DOCTOR_IDS, REHEARSAL, REPO_ROOT, TRIAL, TRIAL_ROOT, USERS, isDoctorId, openClinic, patientIndex, type DoctorId } from './trial/common.js';
import { REHEARSAL_BANNER, buildReport, exportRange, toCsv, toMarkdown } from './trial/export.js';
import { clear, queue } from './trial/queue.js';

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

function doctorAndSpecialty(): { doctor: DoctorId; specialty: Specialty } {
  const doctor = args.find(isDoctorId);
  const specialty = args.find((a): a is Specialty => a === 'noi' || a === 'nhi');
  if (!doctor || !specialty) throw new Error(`Cần nêu bác sĩ (${DOCTOR_IDS.join(', ')}) và chuyên khoa (noi, nhi). Ví dụ: pnpm trial ${command} bs1 noi`);
  return { doctor, specialty };
}

function positiveInt(text: string | undefined, fallback: number, what: string, max: number): number {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${what} phải là số nguyên từ 1 đến ${max}, đang là "${text}"`);
  return n;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`Đã ghi ${path}`);
}

async function runExport(): Promise<void> {
  // Cùng giới hạn với đường GET /api/metrics/visits: tối đa 90 ngày, tối đa 1000 lượt.
  const days = positiveInt(option('days'), 30, 'days', 90);
  const { tenant, medplum, store } = await openClinic();
  const now = new Date();
  const { from, to } = exportRange(now, days);
  const { visits, truncated } = await store.finishedVisits(from, 1000);
  const index = await patientIndex(medplum);
  const queueItems: QueueItem[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) queueItems.push(...(await store.listQueue(day)));
  const report = buildReport({
    clinic: { slug: tenant.slug, name: tenant.name },
    rehearsal: REHEARSAL,
    now,
    days,
    visits,
    truncated,
    doctors: USERS.filter((u) => u.role === 'doctor').map((u) => ({ userId: u.id, name: u.name })),
    patients: index.byId,
    queueItems,
  });
  const name = option('name') ?? `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  if (!/^[\w.-]+$/.test(name)) throw new Error('name chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới');
  const markdown = toMarkdown(report);
  console.log(`\n${markdown}`);
  write(join(DIR, 'export', `${name}-luot-kham.csv`), toCsv(report));
  write(join(DIR, 'export', `${name}-tom-tat.md`), markdown);
  write(join(DIR, 'export', `${name}-tom-tat.json`), JSON.stringify(report, null, 2));
  if (REHEARSAL) console.log(`\n${REHEARSAL_BANNER}`);
}

function runSheets(): void {
  write(join(REPO_ROOT, 'docs', 'phien-thu', 'ca-mo-phong.md'), renderMarkdown(ALL_CASES));
  for (const specialty of ['noi', 'nhi'] as const) {
    write(join(TRIAL_ROOT, 'phieu-ca', `phieu-ca-${specialty}.html`), renderHtml(casesOf(specialty), `Phiếu ca ${specialty} · phiên thử M0-1`));
  }
  console.log('Mở hai tệp HTML bằng trình duyệt rồi in (A4, mỗi ca một trang). Phiếu chưa được cố vấn y khoa duyệt: đưa duyệt trước buổi thử.');
}

async function runPlan(): Promise<void> {
  const { doctor, specialty } = doctorAndSpecialty();
  // Ghi vào thư mục của phiên, không nhận đường dẫn qua tham số: đường dẫn có dấu cách bị tách khi đi qua pnpm trên Windows.
  const out = join(DIR, `plan-${doctor}-${specialty}${flag('warmup') ? '-warmup' : ''}.json`);
  const { tenant } = await openClinic();
  const plan = {
    trial: TRIAL,
    tenant: { slug: tenant.slug, name: tenant.name },
    doctor: USERS.find((u) => u.id === doctor),
    specialty,
    cases: casesOf(specialty, flag('warmup')).map((c) => ({ id: c.id, warmup: c.warmup, patientName: c.patient.fullName, reason: c.reason, story: c.story, findings: c.findings, vitals: c.vitals, steps: c.steps, final: c.final })),
  };
  write(out, JSON.stringify(plan, null, 2));
}

async function main(): Promise<void> {
  switch (command) {
    case 'setup':
      return setup();
    case 'queue': {
      const { doctor, specialty } = doctorAndSpecialty();
      return queue(doctor, specialty, { warmup: flag('warmup'), round: positiveInt(option('round'), 1, 'round', 99), force: flag('force') });
    }
    case 'clear':
      return clear({ force: flag('force') });
    case 'export':
      return runExport();
    case 'sheets':
      return runSheets();
    case 'plan':
      return runPlan();
    default:
      throw new Error('Lệnh: setup | queue <bs1|bs2|bs3> <noi|nhi> [warmup] [round=N] [force] | clear [force] | export [days=N] [name=…] | sheets | plan <bs> <noi|nhi> [warmup]');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
