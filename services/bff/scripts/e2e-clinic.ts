// Tạo MỘT phòng khám thử mới cho bài e2e ngắt và khôi phục mạng (M0-2 ở 20 chu kỳ; T6 ở 100 chu kỳ): một Project + tài khoản máy riêng,
// một bác sĩ có Practitioner (bác sĩ tự tiếp đón, N5). Mỗi lần chạy một phòng khám mới, nên số đếm cuối bài là số tuyệt đối
// và bài không bao giờ đụng hai phòng khám demo.
//
//   pnpm --filter @phongmach/bff e2e:clinic       (cần stack Medplum đang chạy)
//
// Hạn mức FHIR của phòng khám thử được nâng để bài T6 chạy 100 chu kỳ (pnpm e2e:cycles mức đầy đủ) + đồng bộ 40 ca ≤ 60s không chạm trần.
// Mỗi lượt tốn chừng 2.500 điểm của tài khoản máy (ghi 100 điểm, tìm 20) [Đã đo, mục 5.9 phát hiện 1]. Vế "40 ca/60s" của T6 cần một
// đỉnh ~100.000 điểm/phút (40 × 2.500); 100 chu kỳ + các lần gửi lại (OFF-7) + đợt xả hàng đợi cuối bài tạo đỉnh cao hơn trong một
// cửa sổ 60 giây. Mức cũ 500.000 (10× mặc định) vẫn 429 ở 100 chu kỳ vì phòng khám chỉ có MỘT tài khoản máy (một bác sĩ, N5):
// `totalFhirQuota` (tổng điểm/phút của mọi user trong project) mặc định = 10× hạn mức mỗi user mặc định = 10 × 50.000 = 500.000, bằng
// đúng trần mỗi-user cũ nên trần tổng-project trở thành nút thắt; nâng mỗi-user lên nữa cũng vô ích. Vì vậy đặt CẢ HAI
// `userFhirQuota` và `totalFhirQuota` = 1.000.000 điểm/phút (= 20× mặc định, ~10× biên trên đỉnh ~100.000) cho riêng phòng khám thử này
// (T-QUOTA). Đây là bump theo-project có chủ đích, KHÔNG tắt hạn mức toàn cục. Hạn mức cho tài khoản máy thật ở M1 vẫn là việc của T-QUOTA.
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
/**
 * Điểm FHIR mỗi phút cho phòng khám thử (mặc định của Medplum: mỗi-user 50.000; tổng-project 500.000 = 10× mỗi-user).
 * Đặt cả hạn mức mỗi-user (`userFhirQuota`) và tổng-project (`totalFhirQuota`) để một tài khoản máy duy nhất không bị trần
 * tổng-project chặn (xem chú thích đầu file). 1.000.000 ≈ 10× biên trên đỉnh ~100.000 điểm/phút của bài T6.
 */
const FHIR_QUOTA = 1_000_000;

async function main() {
  const run = randomBytes(4).toString('hex');
  const slug = `thu-${run}`;
  const admin = await adminClient();
  const tenant = await createTenantProject(admin, slug, `Phòng khám thử M0-2 (${run})`);
  const project = await admin.readResource('Project', tenant.projectId);
  await admin.updateResource<Project>({
    ...project,
    systemSetting: [...(project.systemSetting ?? []), { name: 'userFhirQuota', valueInteger: FHIR_QUOTA }, { name: 'totalFhirQuota', valueInteger: FHIR_QUOTA }],
  });
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
