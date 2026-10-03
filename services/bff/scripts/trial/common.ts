// Phần dùng chung của các lệnh phiên thử (M0-1): tên phiên, nơi để tệp, định danh xác định, mở kho của phòng khám thử.
//
// Một "phiên" là một phòng khám thử riêng trong Medplum, không dính tới hai phòng khám demo. Mặc định là phiên `m0-1` (buổi thử thật
// với bác sĩ). Đặt biến môi trường TRIAL để dùng phiên khác; tên bắt đầu bằng `dien-tap` là phiên diễn tập kỹ thuật, và mọi tệp xuất
// từ phiên đó được đóng nhãn "số chạy thử kỹ thuật".
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MedplumClient } from '@medplum/core';
import { ALL_CASES, type TrialCase } from '@phongmach/trial';
import { MedplumClinicStore } from '../../src/medplum.js';
import { parseTenantsFile, type DemoUser, type Tenant, type TenantsFile } from '../../src/tenants.js';
import { MEDPLUM_URL, tenantClient } from '../medplum-admin.js';

export const TRIAL = (process.env['TRIAL'] ?? 'm0-1').toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(TRIAL)) throw new Error(`TRIAL chỉ gồm chữ thường, số và dấu gạch ngang (tối đa 40 ký tự), đang là "${TRIAL}"`);

export const REHEARSAL = TRIAL.startsWith('dien-tap');
export const SLUG = `thu-${TRIAL}`;
export const CLINIC_NAME = REHEARSAL ? `Phòng khám DIỄN TẬP KỸ THUẬT (${TRIAL})` : 'Phòng khám thử M0-1';
/** Thư mục gốc của mọi tệp phiên thử (đã gitignore cùng services/bff/.data). */
export const TRIAL_ROOT = fileURLToPath(new URL('../../.data/trial/', import.meta.url));
export const DIR = join(TRIAL_ROOT, TRIAL);
/** Tệp phòng khám (có bí mật của tài khoản máy): BFF của phiên thử đọc đúng tệp này qua TENANTS_FILE. */
export const TENANTS_FILE = process.env['TENANTS_FILE'] ?? join(DIR, 'tenants.json');
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const DOCTOR_IDS = ['bs1', 'bs2', 'bs3'] as const;
export type DoctorId = (typeof DOCTOR_IDS)[number];
export const isDoctorId = (x: string): x is DoctorId => (DOCTOR_IDS as readonly string[]).includes(x);

/**
 * Người dùng của phòng khám thử. Tên bác sĩ là tên giả cố định: tên thật của bác sĩ tham gia chỉ ghi trong biên bản, không đưa vào
 * hệ thống. Điều phối viên có vai trò chủ phòng khám để xem "Thời gian khám" của cả ba bác sĩ và "Nhật ký truy cập".
 */
export const USERS: ReadonlyArray<{ id: string; name: string; role: DemoUser['role']; practitioner?: { family: string; given: string[] } }> = [
  { id: 'bs1', name: 'Bác sĩ thử 1', role: 'doctor', practitioner: { family: 'Bác sĩ thử', given: ['1'] } },
  { id: 'bs2', name: 'Bác sĩ thử 2', role: 'doctor', practitioner: { family: 'Bác sĩ thử', given: ['2'] } },
  { id: 'bs3', name: 'Bác sĩ thử 3', role: 'doctor', practitioner: { family: 'Bác sĩ thử', given: ['3'] } },
  { id: 'phu-ta', name: 'Phụ tá (điều phối viên dùng)', role: 'assistant' },
  { id: 'dieu-phoi', name: 'Điều phối viên (xem số đo)', role: 'owner' },
];

/** Người "khám" các lượt cũ nạp sẵn: không phải một trong ba bác sĩ thử, nên các lượt đó không bao giờ lẫn vào số đo của họ. */
export const PRIOR_DOCTOR = { userId: 'nap-san', name: 'BS. khám trước (dữ liệu nạp sẵn)' } as const;

/** UUID xác định từ chuỗi (dạng v5, SHA-1), để chạy lại lệnh nào cũng không tạo bản ghi trùng. */
export function stableUuid(name: string): string {
  const h = createHash('sha1').update(`phongmach-trial:${SLUG}:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Mỗi bác sĩ có bản sao bệnh nhân riêng của từng ca: lượt khám của người này không làm đổi hồ sơ người kia nhìn thấy. */
export const patientUuid = (doctor: DoctorId, caseId: string) => stableUuid(`patient:${doctor}:${caseId}`);

export interface Clinic {
  file: TenantsFile;
  tenant: Tenant;
  medplum: MedplumClient;
  store: MedplumClinicStore;
}

export function readTenantsFile(): TenantsFile | undefined {
  if (!existsSync(TENANTS_FILE)) return undefined;
  return parseTenantsFile(JSON.parse(readFileSync(TENANTS_FILE, 'utf8')));
}

/** Mở phòng khám thử đã tạo bằng `pnpm trial setup`. Từ chối mọi tệp không phải của một phòng khám thử. */
export async function openClinic(): Promise<Clinic> {
  const file = readTenantsFile();
  if (!file) throw new Error(`Chưa có phòng khám thử của phiên "${TRIAL}" (${TENANTS_FILE}). Chạy "pnpm trial setup" trước.`);
  const tenant = file.tenants[0]!;
  if (file.tenants.length !== 1 || tenant.slug !== SLUG) throw new Error(`${TENANTS_FILE} không phải tệp của phòng khám thử "${SLUG}". Các lệnh phiên thử không chạy trên phòng khám demo.`);
  const medplum = await tenantClient(MEDPLUM_URL, tenant);
  return { file, tenant, medplum, store: new MedplumClinicStore(medplum) };
}

export interface CasePatient {
  doctor: DoctorId;
  caseId: string;
  warmup: boolean;
}

/** id bệnh nhân trên máy chủ ↔ (bác sĩ, ca), tra theo UUID xác định của bệnh nhân. */
export async function patientIndex(medplum: MedplumClient): Promise<{ byId: Map<string, CasePatient>; idOf: (doctor: DoctorId, c: TrialCase) => string }> {
  const wanted = new Map<string, CasePatient>();
  for (const doctor of DOCTOR_IDS) for (const c of ALL_CASES) wanted.set(patientUuid(doctor, c.id), { doctor, caseId: c.id, warmup: c.warmup });
  const byId = new Map<string, CasePatient>();
  const ids = new Map<string, string>();
  // Phòng khám thử chỉ có bệnh nhân của bộ ca (cộng vài người điều phối viên tạo tay), ít hơn 1000 nhiều.
  for (const p of await medplum.searchResources('Patient', { _count: '1000' })) {
    for (const i of p.identifier ?? []) {
      const hit = i.value ? wanted.get(i.value) : undefined;
      if (!hit || !p.id) continue;
      byId.set(p.id, hit);
      ids.set(`${hit.doctor}:${hit.caseId}`, p.id);
    }
  }
  return {
    byId,
    idOf: (doctor, c) => {
      const id = ids.get(`${doctor}:${c.id}`);
      if (!id) throw new Error(`Không thấy bệnh nhân của ca ${c.id} cho ${doctor}. Chạy lại "pnpm trial setup".`);
      return id;
    },
  };
}
