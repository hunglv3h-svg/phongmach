// `pnpm trial setup`: tạo (hoặc dùng lại) phòng khám thử của phiên, ba bác sĩ có Practitioner, một phụ tá, một điều phối viên,
// rồi nạp bệnh nhân giả của bộ ca cho từng bác sĩ, kèm dị ứng, tiền sử và lượt khám cũ có đơn (để "kê lại").
// Chạy lại được: phòng khám đã có thì dùng lại; mọi bản ghi tạo có điều kiện theo UUID xác định nên không bao giờ trùng.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Bundle, BundleEntry, Patient, Practitioner, Project } from '@medplum/fhirtypes';
import { getDrug, getIcd10, resolveLine } from '@phongmach/catalogs';
import { makePrescriptionCode, vnDay, type SignedLine } from '@phongmach/clinical';
import { buildPatient, clientUuidQuery, type NewPatientInput } from '@phongmach/fhir-vn-model';
import { ALL_CASES, type TrialCase } from '@phongmach/trial';
import { MedplumClinicStore } from '../../src/medplum.js';
import { parseTenantsFile, type TenantsFile } from '../../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient } from '../medplum-admin.js';
import { CLINIC_NAME, DOCTOR_IDS, PRIOR_DOCTOR, SLUG, TENANTS_FILE, TRIAL, USERS, patientUuid, readTenantsFile, stableUuid, type DoctorId } from './common.js';

/**
 * Điểm FHIR mỗi phút cho tài khoản máy của phòng khám thử (mặc định của Medplum: 50.000). Nạp các lượt khám cũ tốn khoảng 2.500 điểm
 * mỗi lượt (kế hoạch, mục 5.9, bài học 6), và buổi thử đo thời gian thao tác chứ không đo hạn mức: một lần 429 giữa lượt khám sẽ làm
 * bẩn số đo. Hạn mức cho phòng khám thật là việc của T-QUOTA.
 */
const USER_FHIR_QUOTA = 500_000;

const sha256Base64 = (text: string) => createHash('sha256').update(text).digest('base64');
const pad3 = (n: number) => String(n).padStart(3, '0');

/** Bệnh nhân của một ca cho một bác sĩ. Số điện thoại và CCCD là số giả sinh từ thứ tự ca (CCCD có tiền tố 000, mã tỉnh không tồn tại). */
export function patientInput(doctor: DoctorId, c: TrialCase): NewPatientInput {
  const n = pad3(ALL_CASES.indexOf(c) + 1);
  const d = DOCTOR_IDS.indexOf(doctor) + 1;
  return {
    clientUuid: patientUuid(doctor, c.id),
    fullName: c.patient.fullName,
    phone: `0900${n}${d}00`,
    ...(c.patient.hasCccd ? { cccd: `000${n}${d}00000` } : {}),
    birthDate: c.patient.birthDate,
    gender: c.patient.gender,
  };
}

async function reuse(): Promise<TenantsFile | undefined> {
  let file: TenantsFile | undefined;
  try {
    file = readTenantsFile();
    if (!file || file.tenants.length !== 1 || file.tenants[0]!.slug !== SLUG) return undefined;
    await tenantClient(MEDPLUM_URL, file.tenants[0]!);
    return file;
  } catch {
    return undefined;
  }
}

async function create(): Promise<TenantsFile> {
  const admin = await adminClient();
  const tenant = await createTenantProject(admin, SLUG, CLINIC_NAME);
  const project = await admin.readResource('Project', tenant.projectId);
  await admin.updateResource<Project>({ ...project, systemSetting: [...(project.systemSetting ?? []), { name: 'userFhirQuota', valueInteger: USER_FHIR_QUOTA }] });
  const medplum = await tenantClient(MEDPLUM_URL, tenant);
  const users: TenantsFile['users'] = [];
  for (const u of USERS) {
    const practitioner = u.practitioner ? await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [u.practitioner] }) : undefined;
    users.push({ id: u.id, name: u.name, role: u.role, tenant: SLUG, ...(practitioner?.id ? { practitionerId: practitioner.id } : {}) });
  }
  return parseTenantsFile({ tenants: [tenant], users });
}

export async function setup(): Promise<void> {
  let file = await reuse();
  const reused = !!file;
  if (!file) {
    // Tệp cũ còn đó mà không đăng nhập được (stack Medplum đã được dựng lại): giữ một bản sao rồi mới tạo phòng khám mới.
    if (existsSync(TENANTS_FILE)) copyFileSync(TENANTS_FILE, `${TENANTS_FILE}.cu-${Date.now()}`);
    file = await create();
    mkdirSync(dirname(TENANTS_FILE), { recursive: true });
    writeFileSync(TENANTS_FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
    chmodSync(TENANTS_FILE, 0o600);
  }
  const tenant = file.tenants[0]!;
  // Không in bí mật ra màn hình.
  console.log(`${reused ? 'Dùng lại' : 'Đã tạo'} phòng khám thử "${tenant.name}" (${SLUG}, Project ${tenant.projectId}), phiên "${TRIAL}".`);

  const medplum = await tenantClient(MEDPLUM_URL, tenant);
  const entries: BundleEntry[] = DOCTOR_IDS.flatMap((doctor) =>
    ALL_CASES.map((c) => {
      const input = patientInput(doctor, c);
      return { request: { method: 'POST' as const, url: 'Patient', ifNoneExist: clientUuidQuery(input.clientUuid) }, resource: buildPatient(input) satisfies Patient };
    })
  );
  const result = (await medplum.executeBatch({ resourceType: 'Bundle', type: 'batch', entry: entries } satisfies Bundle)) as Bundle;
  const failed = (result.entry ?? []).filter((e) => !String(e.response?.status ?? '').startsWith('2'));
  if (failed.length) throw new Error(`Không nạp được ${failed.length} bệnh nhân (ví dụ: HTTP ${failed[0]!.response?.status}). Chạy lại lệnh.`);

  const store = new MedplumClinicStore(medplum);
  const now = new Date();
  let notes = 0;
  let visits = 0;
  for (const doctor of DOCTOR_IDS) {
    for (const c of ALL_CASES) {
      const key = `${doctor}:${c.id}`;
      const patient = await medplum.searchOne('Patient', clientUuidQuery(patientUuid(doctor, c.id)));
      if (!patient?.id) throw new Error(`Không thấy bệnh nhân vừa nạp của ca ${key}`);
      for (const [i, a] of c.allergies.entries()) {
        await store.addAllergy(patient.id, { clientUuid: stableUuid(`allergy:${key}:${i}`), kind: a.kind, value: a.value, ...(a.label ? { label: a.label } : {}) }, now);
        notes += 1;
      }
      for (const [i, text] of c.history.entries()) {
        await store.addHistory(patient.id, { clientUuid: stableUuid(`history:${key}:${i}`), text }, now);
        notes += 1;
      }
      if (c.prior) {
        await seedPriorVisit(store, patient.id, key, c, now);
        visits += 1;
      }
    }
  }
  const total = (await medplum.search('Patient', '_summary=count&_total=accurate')).total ?? 0;
  console.log(`Bệnh nhân: ${total} (mỗi bác sĩ ${ALL_CASES.length} ca: 12 nội + 12 nhi tính số đo, 3 + 3 làm quen); ${notes} dị ứng và tiền sử; ${visits} lượt khám cũ có đơn.`);
  console.log(`Đã ghi ${TENANTS_FILE}`);
  console.log('Người dùng:');
  for (const u of file.users) console.log(`  ${u.id.padEnd(10)} ${u.name} (${u.role})`);
}

/**
 * Lượt khám cũ có đơn, đi qua đúng đường ghi của ứng dụng (như seed-demo). Hai điều giữ số đo sạch:
 * người khám là PRIOR_DOCTOR chứ không phải bác sĩ thử, và ngày khám cách hơn 90 ngày nên nằm ngoài mọi khoảng của "Thời gian khám".
 */
async function seedPriorVisit(store: MedplumClinicStore, patientId: string, key: string, c: TrialCase, now: Date): Promise<void> {
  const v = c.prior!;
  const at = new Date(now.getTime() - v.daysAgo * 86_400_000);
  const checkedIn = await store.checkIn({ clientUuid: stableUuid(`prior:${key}:in`), patientId, specialty: c.specialty, priority: 'normal', reason: v.reason }, at);
  if (!checkedIn) throw new Error(`Không cho vào hàng chờ được (lượt khám cũ của ${key})`);
  await store.openVisit(checkedIn.item.id, PRIOR_DOCTOR, at);
  const lines: SignedLine[] = v.lines.map((input) => {
    const drug = getDrug(input.drug);
    if (!drug) throw new Error(`Thuốc của ca ${c.id} không có trong danh mục: ${input.drug}`);
    return { drug, input, resolved: resolveLine(drug, input) };
  });
  const clientUuid = stableUuid(`prior:${key}:done`);
  const result = await store.completeVisit({
    clientUuid,
    encounterId: checkedIn.item.id,
    doctor: PRIOR_DOCTOR,
    now: new Date(at.getTime() + 75_000),
    exam: { reason: v.reason, symptoms: v.symptoms, findings: v.findings, vitals: v.vitals },
    diagnoses: v.dx.map((code) => getIcd10(code)!),
    prescription: {
      code: makePrescriptionCode(vnDay(at), createHash('sha256').update(clientUuid).digest()),
      lines,
      advice: v.advice,
      followUpDays: v.followUpDays,
      acks: [],
      digestBase64: sha256Base64,
    },
  });
  if (result.kind !== 'ok') throw new Error(`Không tạo được lượt khám cũ của ${key}: ${result.kind}`);
}
