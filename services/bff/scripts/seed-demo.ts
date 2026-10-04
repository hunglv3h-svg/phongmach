// Nạp dữ liệu demo cho M0: hai phòng khám (mỗi phòng khám một Project + tài khoản máy), bác sĩ, bệnh nhân giả,
// cùng dị ứng, tiền sử và vài lượt khám cũ có đơn thuốc để trình diễn "kê lại" và cảnh báo dị ứng.
//
//   pnpm seed                 (cần stack Medplum đang chạy; xem infra/medplum/README.md)
//   SEED_PATIENTS=1000 pnpm seed
//
// Chạy lại được: bệnh nhân tạo bằng create có điều kiện theo UUID xác định, nên không bao giờ trùng.
// Ghi .demo-tenants.json (bí mật, đã gitignore). Dữ liệu hoàn toàn là giả, không dùng dữ liệu bệnh nhân thật.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, Patient, Practitioner } from '@medplum/fhirtypes';
import { getDrug, getIcd10, resolveLine, type LineInput } from '@phongmach/catalogs';
import { makePrescriptionCode, vnDay, type SignedLine } from '@phongmach/clinical';
import { buildPatient, clientUuidQuery, type NewPatientInput } from '@phongmach/fhir-vn-model';
import { MedplumClinicStore } from '../src/medplum.js';
import { parseTenantsFile, type DemoUser, type Tenant, type TenantsFile } from '../src/tenants.js';
import { backfillSearchKeys } from './backfill-search-keys.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient as loginTenant } from './medplum-admin.js';

const PATIENTS_PER_CLINIC = Number(process.env['SEED_PATIENTS'] ?? 400);
const OUT = process.env['TENANTS_FILE'] ?? fileURLToPath(new URL('../.demo-tenants.json', import.meta.url));
const BATCH = 100;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = 15_000;

interface StoryVisit {
  /** Chỉ số trong `story` của phòng khám. */
  patient: number;
  daysAgo: number;
  doctor: string;
  specialty: 'noi' | 'nhi';
  reason: string;
  symptoms: string;
  findings: string;
  vitals: Record<string, number>;
  dx: string[];
  lines: LineInput[];
  advice?: string;
  followUpDays?: number;
}

interface ClinicSpec {
  slug: string;
  name: string;
  kind: 'adult' | 'pediatric';
  users: Array<{ id: string; name: string; role: DemoUser['role']; practitioner?: boolean }>;
  story: Array<Omit<NewPatientInput, 'clientUuid'>>;
  allergies: Array<{ patient: number; kind: 'class' | 'ingredient'; value: string; label?: string }>;
  history: Array<{ patient: number; text: string }>;
  visits: StoryVisit[];
}

const CLINICS: ClinicSpec[] = [
  {
    slug: 'noi-tong-quat',
    name: 'Phòng khám Nội tổng quát (demo)',
    kind: 'adult',
    users: [
      { id: 'noi-owner', name: 'BS. Trần Quốc Hưng (chủ phòng khám)', role: 'owner', practitioner: true },
      { id: 'noi-doctor', name: 'BS. Lê Thị Thu Hà', role: 'doctor', practitioner: true },
      { id: 'noi-assistant', name: 'Phụ tá Nguyễn Thị Lan', role: 'assistant' },
    ],
    // Bệnh nhân dùng trong kịch bản trình diễn: tìm theo tên không dấu, 4 số cuối, CCCD.
    story: [
      { fullName: 'Nguyễn Văn An', phone: '0912345678', cccd: '000123456789', birthDate: '1985-03-15', gender: 'male' },
      { fullName: 'Nguyễn Văn Ân', phone: '0903115678', cccd: '000987654321', birthDate: '1991-11-02', gender: 'male' },
      { fullName: 'Trần Thị Bình', phone: '0987665678', cccd: '000555444333', birthDate: '1972-08-20', gender: 'female' },
    ],
    allergies: [
      { patient: 0, kind: 'class', value: 'penicillin' },
      { patient: 2, kind: 'class', value: 'nsaid' },
    ],
    history: [
      { patient: 0, text: 'Tăng huyết áp 3 năm, đang dùng amlodipin' },
      { patient: 2, text: 'Viêm mũi dị ứng theo mùa' },
    ],
    visits: [
      {
        patient: 0, daysAgo: 45, doctor: 'noi-doctor', specialty: 'noi', reason: 'Sổ mũi, ho 3 ngày', symptoms: 'Sổ mũi, ho khan, không sốt', findings: 'Họng hơi đỏ, phổi thông khí đều',
        vitals: { temperatureC: 36.8, pulse: 78, systolic: 128, diastolic: 82, weightKg: 68 }, dx: ['J06.9'],
        lines: [
          { drug: 'PARACETAMOL-500-MG', perDose: 1, quantity: 10, instruction: 'Uống 1 viên mỗi lần khi sốt hoặc đau, cách nhau ít nhất 4–6 giờ, tối đa 4 viên/ngày' },
          { drug: 'CETIRIZIN-10-MG', perDose: 1, timesPerDay: 1, days: 5 },
        ],
        advice: 'Uống nhiều nước, nghỉ ngơi. Tái khám nếu sốt trên 3 ngày hoặc khó thở.',
      },
      {
        patient: 0, daysAgo: 35, doctor: 'noi-doctor', specialty: 'noi', reason: 'Tái khám huyết áp', symptoms: 'Không đau đầu, không chóng mặt', findings: 'Tim đều, không phù',
        vitals: { pulse: 74, systolic: 135, diastolic: 85, weightKg: 68 }, dx: ['I10'],
        lines: [{ drug: 'AMLODIPIN-5-MG', perDose: 1, timesPerDay: 1, days: 30 }],
        advice: 'Uống thuốc đều mỗi sáng, hạn chế muối. Đo huyết áp tại nhà.', followUpDays: 30,
      },
      {
        patient: 2, daysAgo: 40, doctor: 'noi-doctor', specialty: 'noi', reason: 'Hắt hơi, ngạt mũi', symptoms: 'Hắt hơi từng cơn buổi sáng, ngạt mũi', findings: 'Niêm mạc mũi nhợt, phù nề',
        vitals: { temperatureC: 36.6, pulse: 72, systolic: 118, diastolic: 76, weightKg: 54 }, dx: ['J30.4'],
        lines: [{ drug: 'CETIRIZIN-10-MG', perDose: 1, timesPerDay: 1, days: 14 }],
        advice: 'Tránh bụi, giữ ấm.',
      },
    ],
  },
  {
    slug: 'nhi',
    name: 'Phòng khám Nhi (demo)',
    kind: 'pediatric',
    users: [
      { id: 'nhi-owner', name: 'BS. Phạm Thanh Mai (chủ phòng khám)', role: 'owner', practitioner: true },
      { id: 'nhi-assistant', name: 'Phụ tá Võ Thị Hạnh', role: 'assistant' },
    ],
    story: [
      { fullName: 'Lê Minh Khang', phone: '0934567890', birthDate: '2021-06-10', gender: 'male' },
      { fullName: 'Đặng Bảo Ngọc', phone: '0976543210', birthDate: '2019-01-25', gender: 'female' },
    ],
    allergies: [{ patient: 1, kind: 'class', value: 'cephalosporin' }],
    history: [{ patient: 0, text: 'Sinh đủ tháng, tiêm chủng đủ theo lịch' }],
    visits: [
      {
        patient: 0, daysAgo: 30, doctor: 'nhi-owner', specialty: 'nhi', reason: 'Sốt, ho 2 ngày', symptoms: 'Sốt nhẹ, ho, bú/ăn kém hơn', findings: 'Họng đỏ, phổi không ran',
        vitals: { temperatureC: 38.2, pulse: 110, spo2: 98, weightKg: 17.5 }, dx: ['J06.9'],
        lines: [
          { drug: 'PARACETAMOL-150-MG-GOI', perDose: 1, quantity: 6, instruction: 'Uống 1 gói mỗi lần khi sốt trên 38,5 độ, cách nhau ít nhất 4–6 giờ' },
          { drug: 'NATRI-CLORID-0-9-NHO-MUI', quantity: 1, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' },
        ],
        advice: 'Cho bé uống nhiều nước. Tái khám nếu sốt trên 3 ngày hoặc thở nhanh.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------

const FAMILY = ['Nguyễn', 'Nguyễn', 'Nguyễn', 'Trần', 'Trần', 'Lê', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MALE = { middle: ['Văn', 'Minh', 'Quốc', 'Hữu', 'Đức', 'Thanh', 'Gia', 'Bảo'], given: ['An', 'Bình', 'Dũng', 'Hùng', 'Khang', 'Long', 'Nam', 'Phúc', 'Sơn', 'Tuấn', 'Quân', 'Hải', 'Đạt', 'Huy'] };
const FEMALE = { middle: ['Thị', 'Ngọc', 'Thu', 'Kim', 'Bảo', 'Thanh', 'Hồng'], given: ['Anh', 'Châu', 'Hà', 'Hạnh', 'Lan', 'Linh', 'Mai', 'Ngân', 'Phương', 'Quỳnh', 'Trang', 'Yến', 'Vy', 'Nhi'] };

/** Bộ sinh số giả ngẫu nhiên xác định (mulberry32) để chạy lại ra cùng dữ liệu. */
function rng(seed: string) {
  let a = createHash('sha1').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID xác định từ chuỗi (dạng v5, dùng SHA-1) để tạo có điều kiện không bao giờ trùng khi chạy lại. */
function stableUuid(name: string): string {
  const h = createHash('sha1').update(`phongmach-demo:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generatePatients(spec: ClinicSpec, count: number): NewPatientInput[] {
  const rand = rng(spec.slug);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  const usedPhones = new Set(spec.story.map((s) => s.phone));
  const out: NewPatientInput[] = spec.story.map((s, i) => ({ ...s, clientUuid: stableUuid(`${spec.slug}:story:${i}`) }));
  const now = new Date();
  for (let i = 0; out.length < count; i++) {
    const male = rand() < 0.5;
    const pool = male ? MALE : FEMALE;
    const fullName = `${pick(FAMILY)} ${pick(pool.middle)} ${pick(pool.given)}`;
    let phone: string;
    do {
      phone = `09${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    const ageYears = spec.kind === 'pediatric' ? rand() * 14 : 18 + rand() * 67;
    const birth = new Date(now.getTime() - ageYears * 365.25 * 86_400_000);
    const adult = spec.kind === 'adult';
    out.push({
      clientUuid: stableUuid(`${spec.slug}:${i}`),
      fullName,
      phone,
      // CCCD giả có tiền tố 000 (mã tỉnh không tồn tại) để không nhầm với số thật.
      ...(adult ? { cccd: `000${String(Math.floor(rand() * 1e9)).padStart(9, '0')}` } : {}),
      birthDate: birth.toISOString().slice(0, 10),
      gender: male ? 'male' : 'female',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

const tenantClient = (t: Tenant) => loginTenant(MEDPLUM_URL, t);

/** Dùng lại các phòng khám đã tạo nếu thông tin đăng nhập trong file còn dùng được. */
async function reuseExisting(): Promise<TenantsFile | undefined> {
  if (!existsSync(OUT)) return undefined;
  try {
    const file = parseTenantsFile(JSON.parse(readFileSync(OUT, 'utf8')));
    const wanted = new Set(CLINICS.map((c) => c.slug));
    if (file.tenants.length !== wanted.size || !file.tenants.every((t) => wanted.has(t.slug))) return undefined;
    for (const t of file.tenants) await tenantClient(t);
    return file;
  } catch {
    return undefined;
  }
}

async function createTenants(): Promise<TenantsFile> {
  const admin = await adminClient();
  const tenants: Tenant[] = [];
  const users: DemoUser[] = [];
  for (const spec of CLINICS) {
    const tenant = await createTenantProject(admin, spec.slug, spec.name);
    tenants.push(tenant);
    const medplum = await tenantClient(tenant);
    for (const u of spec.users) {
      let practitionerId: string | undefined;
      if (u.practitioner) {
        const [family, ...given] = u.name.replace(/^(BS\.|Phụ tá)\s*/, '').replace(/\s*\(.*\)$/, '').split(' ');
        const p = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family, given }] });
        practitionerId = p.id;
      }
      users.push({ id: u.id, name: u.name, role: u.role, tenant: spec.slug, ...(practitionerId ? { practitionerId } : {}) });
    }
  }
  return { tenants, users };
}

async function runBatch(medplum: MedplumClient, entries: BundleEntry[]): Promise<void> {
  let pending = entries;
  for (let attempt = 1; pending.length; attempt++) {
    const result = (await medplum.executeBatch({ resourceType: 'Bundle', type: 'batch', entry: pending } satisfies Bundle)) as Bundle;
    const failed: BundleEntry[] = [];
    (result.entry ?? []).forEach((e, i) => {
      const status = String(e.response?.status ?? '');
      if (status.startsWith('2')) return;
      if (!status.startsWith('429')) throw new Error(`Phần tử batch lỗi: ${status}`);
      failed.push(pending[i]!);
    });
    if (!failed.length) return;
    if (attempt >= MAX_ATTEMPTS) throw new Error(`Vẫn còn ${failed.length} phần tử bị giới hạn tốc độ sau ${MAX_ATTEMPTS} lần thử`);
    process.stdout.write(`  hạn mức FHIR: chờ ${BACKOFF_MS / 1000}s rồi gửi lại ${failed.length} phần tử\n`);
    await new Promise((r) => setTimeout(r, BACKOFF_MS));
    pending = failed;
  }
}

async function seedPatients(t: Tenant, spec: ClinicSpec): Promise<number> {
  const medplum = await tenantClient(t);
  const inputs = generatePatients(spec, PATIENTS_PER_CLINIC);
  for (let i = 0; i < inputs.length; i += BATCH) {
    const entries: BundleEntry[] = inputs.slice(i, i + BATCH).map((input) => ({
      request: { method: 'POST', url: 'Patient', ifNoneExist: clientUuidQuery(input.clientUuid) },
      resource: buildPatient(input) satisfies Patient,
    }));
    await runBatch(medplum, entries);
  }
  // Bệnh nhân đã có từ lần seed trước (tạo có điều kiện nên không được ghi lại) có thể chưa mang khóa tìm chính xác: ghi bổ sung.
  const { updated } = await backfillSearchKeys(medplum, console.log);
  if (updated) console.log(`  ${spec.slug}: ghi khóa tìm cho ${updated} bệnh nhân đã có`);
  const counted = await medplum.search('Patient', '_summary=count&_total=accurate');
  return counted.total ?? 0;
}

const sha256Base64 = (text: string) => createHash('sha256').update(text).digest('base64');

/**
 * Dị ứng, tiền sử và lượt khám cũ có đơn: đi qua đúng đường ghi của ứng dụng (cùng MedplumClinicStore), nên dữ liệu demo
 * có cùng hình dạng với dữ liệu thật. Chạy lại được: mọi khóa đều xác định, lượt đã có thì được nhận ra và bỏ qua.
 */
async function seedClinical(file: TenantsFile, spec: ClinicSpec): Promise<string> {
  const tenant = file.tenants.find((t) => t.slug === spec.slug)!;
  const medplum = await tenantClient(tenant);
  const store = new MedplumClinicStore(medplum);
  const patientId = async (index: number) => {
    const found = await medplum.searchOne('Patient', clientUuidQuery(stableUuid(`${spec.slug}:story:${index}`)));
    if (!found?.id) throw new Error(`Không thấy bệnh nhân demo ${spec.slug}:${index}`);
    return found.id;
  };
  const now = new Date();
  let notes = 0;
  for (const [i, a] of spec.allergies.entries()) {
    await store.addAllergy(await patientId(a.patient), { clientUuid: stableUuid(`${spec.slug}:allergy:${i}`), kind: a.kind, value: a.value, ...(a.label ? { label: a.label } : {}) }, now);
    notes += 1;
  }
  for (const [i, h] of spec.history.entries()) {
    await store.addHistory(await patientId(h.patient), { clientUuid: stableUuid(`${spec.slug}:history:${i}`), text: h.text }, now);
    notes += 1;
  }
  let visits = 0;
  for (const [i, v] of spec.visits.entries()) {
    const user = file.users.find((u) => u.id === v.doctor)!;
    const doctor = { userId: user.id, name: user.name.replace(/\s*\(.*\)$/, ''), practitionerId: user.practitionerId };
    const at = new Date(now.getTime() - v.daysAgo * 86_400_000);
    const checkedIn = await store.checkIn({ clientUuid: stableUuid(`${spec.slug}:visit:${i}:in`), patientId: await patientId(v.patient), specialty: v.specialty, priority: 'normal', reason: v.reason }, at);
    if (!checkedIn) throw new Error('Không cho vào hàng chờ được');
    await store.openVisit(checkedIn.item.id, doctor, at);
    const lines: SignedLine[] = v.lines.map((input) => {
      const drug = getDrug(input.drug);
      if (!drug) throw new Error(`Thuốc demo không có trong danh mục: ${input.drug}`);
      return { drug, input, resolved: resolveLine(drug, input) };
    });
    const clientUuid = stableUuid(`${spec.slug}:visit:${i}:done`);
    const result = await store.completeVisit({
      clientUuid,
      encounterId: checkedIn.item.id,
      doctor,
      now: new Date(at.getTime() + 75_000),
      exam: { reason: v.reason, symptoms: v.symptoms, findings: v.findings, vitals: v.vitals },
      diagnoses: v.dx.map((c) => getIcd10(c)!),
      prescription: {
        code: makePrescriptionCode(vnDay(at), createHash('sha256').update(clientUuid).digest()),
        lines,
        advice: v.advice,
        followUpDays: v.followUpDays,
        acks: [],
        digestBase64: sha256Base64,
      },
    });
    if (result.kind !== 'ok') throw new Error(`Không tạo được lượt khám demo ${spec.slug}:${i}: ${result.kind}`);
    visits += 1;
  }
  return `${notes} ghi chú, ${visits} lượt khám cũ`;
}

async function main() {
  const reused = await reuseExisting();
  const file = reused ?? (await createTenants());
  console.log(reused ? 'Dùng lại các phòng khám demo đã có.' : 'Đã tạo các phòng khám demo mới.');
  writeFileSync(OUT, JSON.stringify(file, null, 2), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  for (const spec of CLINICS) {
    const tenant = file.tenants.find((t) => t.slug === spec.slug)!;
    const total = await seedPatients(tenant, spec);
    console.log(`${spec.slug}: ${total} bệnh nhân, ${await seedClinical(file, spec)}`);
  }
  console.log(`\nĐã ghi ${OUT}`);
  console.log('Người dùng demo:');
  for (const u of file.users) console.log(`  ${u.tenant} / ${u.id}  (${u.role})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
