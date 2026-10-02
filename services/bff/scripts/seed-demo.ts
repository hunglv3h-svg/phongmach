// Nạp dữ liệu demo cho M0: hai phòng khám (mỗi phòng khám một Project + tài khoản máy), bác sĩ, bệnh nhân giả.
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
import { buildPatient, clientUuidQuery, type NewPatientInput } from '@phongmach/fhir-vn-model';
import { parseTenantsFile, type DemoUser, type Tenant, type TenantsFile } from '../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient as loginTenant } from './medplum-admin.js';

const PATIENTS_PER_CLINIC = Number(process.env['SEED_PATIENTS'] ?? 400);
const OUT = process.env['TENANTS_FILE'] ?? fileURLToPath(new URL('../.demo-tenants.json', import.meta.url));
const BATCH = 100;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = 15_000;

interface ClinicSpec {
  slug: string;
  name: string;
  kind: 'adult' | 'pediatric';
  users: Array<{ id: string; name: string; role: DemoUser['role']; practitioner?: boolean }>;
  story: Array<Omit<NewPatientInput, 'clientUuid'>>;
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
  const counted = await medplum.search('Patient', '_summary=count&_total=accurate');
  return counted.total ?? 0;
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
    console.log(`${spec.slug}: ${total} bệnh nhân`);
  }
  console.log(`\nĐã ghi ${OUT}`);
  console.log('Người dùng demo:');
  for (const u of file.users) console.log(`  ${u.tenant} / ${u.id}  (${u.role})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
