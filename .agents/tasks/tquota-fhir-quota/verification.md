# T-QUOTA — Verification note

> Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\tquota-fhir-quota`, branch `feat/tquota-fhir-quota`.
> Task: nới hạn mức FHIR theo project để gỡ chặn bài T6 (100 chu kỳ + đồng bộ 40 ca ≤ 60s).

## Những gì đã thay đổi (code + docs)

Cơ chế Medplum 5.2.0 dùng: mảng `Project.systemSetting` (`ProjectSetting[]`) với hai setting `valueInteger`:
`userFhirQuota` (điểm/phút cho mỗi user của project) và `totalFhirQuota` (tổng điểm/phút của mọi user trong
project; mặc định = 10× hạn mức mỗi user). Đây đúng là mẫu đã có sẵn và đang chạy trong repo
(`admin.updateResource<Project>({ ...project, systemSetting: [...] })` ngay sau `createTenantProject`); thay đổi
chỉ thêm một phần tử `totalFhirQuota` bên cạnh `userFhirQuota` và nâng giá trị.

1. `services/bff/scripts/e2e-clinic.ts` (phòng khám thử của bài e2e-cycles / T6):
   - Đổi hằng `USER_FHIR_QUOTA = 500_000` → `FHIR_QUOTA = 1_000_000`.
   - `systemSetting` nay chứa **cả hai** `{ name: 'userFhirQuota', valueInteger: FHIR_QUOTA }` và
     `{ name: 'totalFhirQuota', valueInteger: FHIR_QUOTA }`.
   - Cập nhật chú thích đầu file giải thích số học (~2.500 điểm/lượt; đỉnh ~100.000 điểm/phút cho 40 ca/60s;
     1.000.000 = 20× mặc định ≈ 10× biên) và nguyên nhân gốc (một tài khoản máy duy nhất ⇒ trần tổng-project
     mặc định 500.000 là nút thắt, bằng đúng trần mỗi-user cũ).

2. `services/bff/scripts/trial/clinic.ts` (phòng khám buổi-thử M0-1):
   - Cùng thay đổi: `FHIR_QUOTA = 1_000_000`, thêm `totalFhirQuota`, cập nhật JSDoc với cùng lý do.

3. `infra/medplum/README.md` — mục "Điều cần biết": thêm gạch đầu dòng mô tả nâng hạn mức FHIR theo project
   (T-QUOTA), phân biệt rõ bump-theo-project (có chủ đích) với tắt hạn mức toàn cục (`setup.mjs --no-rate-limits`
   của luồng đo riêng — KHÔNG đụng).

4. `docs/ke-hoach-trien-khai.md`:
   - Mục 5.6 ghi chú 3 (nâng quota phòng khám thử): cập nhật từ `userFhirQuota = 500.000` → cả hai = 1.000.000.
   - Mục 5.6 "Phát hiện 1": thêm phần cập nhật T-QUOTA với nguyên nhân gốc.
   - Bảng "còn lại M0" dòng T6: trạng thái "quota đã nâng; đo thật chờ chạy".
   - Mục "(m) Ghi cùng lúc": làm rõ 429→500 ở BFF chưa đổi; soi 429 phải nhìn log BFF/Medplum.
   - Mục 8 dòng T-QUOTA: ghi rõ phần đủ cho T6 đã làm ở M0, phần còn lại thuộc M1.

## Phân biệt hai loại 429 (bắt buộc)

- **FHIR-quota 429** (việc này): sinh ở `/fhir/R4/*`; log Medplum/BFF có `_consumedPoints … limit …` và/hoặc
  header `RateLimit: … "fhirInteractions";r=…`. Lưu ý: BFF hiện ánh xạ 429-quota thành HTTP 500 cho client, nên
  khi soi phải nhìn log BFF/Medplum chứ không chỉ mã HTTP ở trình duyệt. Nếu còn loại này ở mức 100 ⇒ fix chưa đủ,
  phải nâng tiếp `*FhirQuota`.
- **Login rate-limit 429 (F5)**: chỉ ở `/auth/login` (và `/auth/newuser`, `/auth/newproject`), 5 lần/phút/IP,
  xảy ra khi chạy nhiều lần liền ở khâu dựng dữ liệu. **KHÔNG phải việc này** — chờ ~1 phút rồi chạy lại; nâng
  quota không sửa và không nên sửa loại này.

## Trạng thái kiểm chứng — CHƯA chạy được ở môi trường này

`pnpm typecheck && pnpm test`, dựng stack, seed, và `pnpm e2e:cycles` **CHƯA chạy được** trên hộp này.

Lý do: công cụ thực thi lệnh (shell) trong môi trường agent hiện tại trả về exit code -1 và **không có output**
cho MỌI lệnh, kể cả lệnh tầm thường (`echo hello`, `node --version`, `cmd /c echo probe-ok`). Đây là trục trặc
của lớp thực thi lệnh, không phải lỗi của thay đổi. Vì vậy không chạy được:
- `pnpm typecheck` / `pnpm test` (không cần Medplum nhưng vẫn cần shell).
- `bash infra/dev-up.sh` + `pnpm seed` + `pnpm e2e:cycles` (ngoài ra còn cần Docker Desktop mở và `openssl`
  để `setup.mjs` sinh khóa RSA — các điều kiện Windows đã biết).

**KHÔNG tuyên bố bài T6 đã pass.** Thay đổi config đã sẵn sàng, nhưng chưa được một lần chạy nào xác nhận ở đây.

## Mức độ tin cậy của thay đổi (dù chưa chạy)

- Thay đổi là mẫu đã có sẵn trong repo và đang biên dịch/chạy (chỉ thêm một phần tử `systemSetting` cùng hình
  dạng `ProjectSetting { name, valueInteger }`), nên rủi ro typecheck rất thấp. `name`/`valueInteger` là giá trị
  tự do server đọc lúc chạy, không phải trường có kiểu, nên TS không chặn tên sai — đã gõ đúng theo tài liệu
  Medplum Rate Limits và theo mẫu `userFhirQuota` sẵn có.
- Không đụng: logic idempotent `clientUuid`, gói hoàn tất chạy-lại-được, hàng rào in offline
  (`printHtml`/`whileLocalStoreQuiet`), ngữ nghĩa trong `services/bff/src/medplum.ts`, `setup.mjs`,
  `docker-compose.yml`, `experiments/*.mjs` (yêu cầu "từ chối nếu thấy header `RateLimit`" của `bff-search.mjs`
  không đổi). Không nới lỏng test hiện có.

## Lệnh để chạy ở nơi có stack (Windows + Git Bash, Docker Desktop mở)

```bash
cd phongmach/.worktrees/tquota-fhir-quota
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# 1) Không cần Medplum — phải xanh:
pnpm typecheck && pnpm test

# 2) Dựng stack + seed + ramp e2e-cycles:
bash infra/dev-up.sh                 # hoặc: pnpm stack:up && pnpm seed  (SEED_PATIENTS=5 để nhanh)
E2E_CYCLES=40  pnpm e2e:cycles
E2E_CYCLES=60  pnpm e2e:cycles
E2E_CYCLES=80  pnpm e2e:cycles
E2E_CYCLES=100 pnpm e2e:cycles       # mỗi lần tạo một phòng khám thử MỚI (không đụng demo)
```

Sau mỗi mức: ghi mức cao nhất **xanh ổn định** (chạy lại cùng hạt giống vẫn xanh). Đếm và phân loại MỌI 429 còn
lại từ log BFF (`/tmp/phongmach-dev/*.log` hoặc `services/bff/.data/e2e-cycles/bff.log`) và log Medplum:
- FHIR-quota (có `_consumedPoints … limit …` ở `/fhir/R4/*`): nếu còn ở mức 100 ⇒ nâng tiếp `FHIR_QUOTA` trong
  hai script rồi lặp lại.
- login-F5 (ở `/auth/login`): chấp nhận được, chờ ~1 phút.

Lưu ý F5: chạy bộ integration/e2e 3 lần liền có thể gặp 429 đăng nhập ở khâu dựng dữ liệu — không phải lỗi mã,
chờ 1 phút.
