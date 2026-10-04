// Ghi khóa tìm chính xác (`meta.tag`: từng từ của tên không dấu, 4 số cuối điện thoại; xem packages/fhir-vn-model/src/searchKeys.ts)
// cho bệnh nhân tạo TRƯỚC khi có khóa tìm. Không có bước này thì hồ sơ cũ vẫn tìm ra như trước (theo đầu từ và theo "chứa"),
// nhưng không được bảo đảm đứng trong 20 kết quả đầu ở phòng khám lớn (tiêu chí M0-3).
//
//   pnpm --filter @phongmach/bff backfill:search-keys      (cần stack Medplum đang chạy)
//   TENANTS_FILE=… pnpm --filter @phongmach/bff backfill:search-keys     tệp phòng khám khác (mặc định .demo-tenants.json)
//
// Chạy lại được: hồ sơ đã đủ và đúng khóa thì bỏ qua. Chỉ thêm tag, không đổi nội dung nào khác của hồ sơ. `pnpm seed` cũng gọi hàm này.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OperationOutcomeError, type MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { hasSearchKeys, withSearchKeys } from '@phongmach/fhir-vn-model';
import { isTransactionConflict } from '../src/conflict.js';
import { parseTenantsFile } from '../src/tenants.js';
import { MEDPLUM_URL, tenantClient } from './medplum-admin.js';

const PAGE = 1000;
const IN_FLIGHT = 4;
const MAX_ATTEMPTS = 8;
/** Hạn mức FHIR mặc định khoảng 500 lần ghi mỗi phút (F5): gặp 429 thì chờ rồi ghi tiếp. */
const QUOTA_BACKOFF_MS = 15_000;

const outcomeId = (err: unknown): string | undefined => (err instanceof OperationOutcomeError ? err.outcome.id : undefined);

/** Ghi khóa tìm cho mọi bệnh nhân của MỘT phòng khám còn thiếu khóa. Trả về số hồ sơ đã xem và số đã ghi. */
export async function backfillSearchKeys(medplum: MedplumClient, say: (msg: string) => void = () => undefined): Promise<{ scanned: number; updated: number }> {
  // Gom trước rồi mới ghi: ghi trong lúc đang lật trang theo `_lastUpdated` sẽ đẩy hồ sơ vừa ghi xuống cuối danh sách.
  const stale: Patient[] = [];
  let scanned = 0;
  for await (const page of medplum.searchResourcePages('Patient', { _count: String(PAGE), _sort: '_lastUpdated' })) {
    scanned += page.length;
    for (const p of page) if (!hasSearchKeys(p)) stale.push(p);
  }

  let updated = 0;
  let next = 0;
  async function save(patient: Patient): Promise<void> {
    let current = patient;
    for (let attempt = 1; ; attempt++) {
      try {
        await medplum.updateResource(withSearchKeys(current), { headers: { 'If-Match': `W/"${current.meta?.versionId}"` } });
        return;
      } catch (err) {
        const id = outcomeId(err);
        if (attempt >= MAX_ATTEMPTS) throw err;
        if (id === 'too-many-requests') {
          say(`  hạn mức FHIR: chờ ${QUOTA_BACKOFF_MS / 1000}s rồi ghi tiếp`);
          await new Promise((r) => setTimeout(r, QUOTA_BACKOFF_MS));
        } else if (id === 'precondition-failed') {
          // Có người vừa sửa hồ sơ này: đọc lại rồi tính khóa trên bản mới, không ghi đè bản của họ.
          current = await medplum.readResource('Patient', current.id!);
          if (hasSearchKeys(current)) return;
        } else if (isTransactionConflict(err)) {
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt * Math.random()));
        } else throw err;
      }
    }
  }
  await Promise.all(
    Array.from({ length: IN_FLIGHT }, async () => {
      while (next < stale.length) {
        await save(stale[next++]!);
        updated++;
        if (updated % 1000 === 0) say(`  ${updated}/${stale.length}`);
      }
    })
  );
  return { scanned, updated };
}

async function main() {
  const path = process.env['TENANTS_FILE'] ?? fileURLToPath(new URL('../.demo-tenants.json', import.meta.url));
  const file = parseTenantsFile(JSON.parse(readFileSync(path, 'utf8')));
  for (const tenant of file.tenants) {
    const started = Date.now();
    const { scanned, updated } = await backfillSearchKeys(await tenantClient(MEDPLUM_URL, tenant), console.log);
    console.log(`${tenant.slug}: ${scanned} bệnh nhân, ghi khóa tìm cho ${updated} (${((Date.now() - started) / 1000).toFixed(1)} giây)`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
