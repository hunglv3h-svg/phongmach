// Tạo MỘT phòng khám thử mới cho bài e2e 20 chu kỳ ngắt và khôi phục mạng (M0-2): một Project + tài khoản máy riêng,
// một bác sĩ có Practitioner (bác sĩ tự tiếp đón, N5). Mỗi lần chạy một phòng khám mới, nên số đếm cuối bài là số tuyệt đối
// và bài không bao giờ đụng hai phòng khám demo.
//
//   pnpm --filter @phongmach/bff e2e:clinic       (cần stack Medplum đang chạy)
//
// Hạn mức FHIR của phòng khám thử được nâng lên 10 lần mặc định. Bài chạy khoảng 20 lượt khám mỗi phút, mỗi lượt tốn chừng 2.500 điểm
// của tài khoản máy (ghi 100 điểm, tìm 20), tức là ngay sát hạn mức mặc định 50.000 điểm/phút (F5): không nâng thì Medplum trả 429
// ở khoảng chu kỳ 17 [Đã đo]. Phòng khám thật không khám nhanh như vậy; hạn mức cho tài khoản máy thật là việc của T-QUOTA.
//
// Ghi tệp phòng khám (bí mật của tài khoản máy) vào TENANTS_FILE, mặc định services/bff/.data/e2e-cycles/tenants.json (đã gitignore).
// BFF của bài kiểm thử đọc đúng tệp này qua TENANTS_FILE; bài kiểm thử đọc nó để đếm bản ghi bằng tài khoản máy.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Practitioner, Project } from '@medplum/fhirtypes';
import { parseTenantsFile } from '../src/tenants.js';
import { MEDPLUM_URL, adminClient, createTenantProject, tenantClient } from './medplum-admin.js';

const OUT = process.env['TENANTS_FILE'] ?? fileURLToPath(new URL('../.data/e2e-cycles/tenants.json', import.meta.url));
/** Điểm FHIR mỗi phút cho tài khoản máy của phòng khám thử (mặc định của Medplum: 50.000). */
const USER_FHIR_QUOTA = 500_000;

async function main() {
  const run = randomBytes(4).toString('hex');
  const slug = `thu-${run}`;
  const admin = await adminClient();
  const tenant = await createTenantProject(admin, slug, `Phòng khám thử M0-2 (${run})`);
  const project = await admin.readResource('Project', tenant.projectId);
  await admin.updateResource<Project>({ ...project, systemSetting: [...(project.systemSetting ?? []), { name: 'userFhirQuota', valueInteger: USER_FHIR_QUOTA }] });
  const medplum = await tenantClient(MEDPLUM_URL, tenant);
  const practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Đỗ', given: ['Thử', 'Nghiệm'] }] });
  const file = parseTenantsFile({
    tenants: [tenant],
    users: [{ id: `${slug}-doctor`, name: 'BS. Đỗ Thử Nghiệm', role: 'doctor', tenant: slug, practitionerId: practitioner.id }],
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(file, null, 2), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  // Không in bí mật ra màn hình (log của CI).
  console.log(`Đã tạo phòng khám thử ${slug} (Project ${tenant.projectId}), bác sĩ ${file.users[0]!.id}.`);
  console.log(`Đã ghi ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
