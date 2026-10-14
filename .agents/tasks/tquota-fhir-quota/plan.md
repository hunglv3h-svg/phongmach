# Implementation Plan — T-QUOTA: nới hạn mức FHIR theo project cho bài T6 (100 chu kỳ)

> Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\tquota-fhir-quota`. Mọi đường dẫn tương đối với worktree này.
> Nhánh: `feat/tquota-fhir-quota` (dựng từ `origin/main`, HEAD `a64afb4`).

## Design decisions (đã kiểm chứng, không để implementer tự chọn)

**Cơ chế Medplum 5.2.0 (ĐÃ XÁC MINH, không đoán).**
- Hạn mức FHIR cấu hình được ở 3 mức: Server (`defaultRateLimit`/`defaultFhirQuota` trong server config), **Project** (`Project.systemSetting`), User (`UserConfiguration`). Nguồn: [Medplum Rate Limits](https://www.medplum.com/docs/rate-limits), [Project Settings](https://www.medplum.com/docs/self-hosting/project-settings). *Nội dung đã diễn giải lại để tuân thủ giấy phép.*
- Mức Project dùng mảng `Project.systemSetting` (số ít — đã xác minh trong `@medplum/fhirtypes@5.2.0`: `node_modules/.pnpm/@medplum+fhirtypes@5.2.0/.../Project.d.ts` khai báo `systemSetting?: ProjectSetting[]`; tài liệu web ghi `systemSettings` là viết thoáng). Mỗi phần tử là `ProjectSetting { name, value[x] }`; dùng `valueInteger`.
- Hai tên setting liên quan (đã xác minh trên trang Rate Limits):
  - `userFhirQuota` — ghi đè hạn mức điểm/phút **cho mỗi user** của project.
  - `totalFhirQuota` — ghi đè **tổng điểm/phút của toàn bộ user trong project**; **mặc định bằng 10× hạn mức mỗi user**.
- `name`/`valueInteger` là giá trị tự do do server đọc lúc chạy, KHÔNG phải trường có kiểu trong `ProjectSetting`, nên TypeScript không chặn tên sai — phải gõ đúng.
- Mẫu áp dụng đúng đã có sẵn trong repo và đang chạy: `services/bff/scripts/e2e-clinic.ts` và `services/bff/scripts/trial/clinic.ts` đều `admin.updateResource<Project>({ ...project, systemSetting: [...(project.systemSetting ?? []), { name: 'userFhirQuota', valueInteger: USER_FHIR_QUOTA }] })` ngay sau `createTenantProject`.

**Chẩn đoán gốc rễ vì sao 100 chu kỳ vẫn 429.**
- Phòng khám thử của bài e2e-cycles chỉ có **một tài khoản máy** (một bác sĩ, N5). Mọi tải đi qua một user.
- Code hiện chỉ đặt `userFhirQuota = 500_000`, KHÔNG đặt `totalFhirQuota`. `totalFhirQuota` giữ mặc định = 10× hạn mức mặc định mỗi user của server = 10 × 50.000 = **500.000**. Với đúng một user, trần mỗi-user (500.000) và trần tổng-project (500.000) **bằng nhau** → trần tổng-project trở thành ràng buộc chặn, nâng mỗi-user lên nữa cũng vô ích.
- Số liệu đã đo (kế hoạch mục 5.9, phát hiện 1): mỗi lượt ~2.500 điểm; mặc định 429 ở chu kỳ 17–18 (`_consumedPoints 50011, limit 50000`); vế "đồng bộ 40 ca trong 60 giây" cần **~100.000 điểm/phút** (2× mặc định). 100 chu kỳ + các lần gửi lại (OFF-7) + đợt xả hàng đợi cuối bài tạo đỉnh cao hơn trong một cửa sổ 60 giây.

**Mức hạn mức chọn + số học biện minh.**
- Đặt **cả `userFhirQuota` VÀ `totalFhirQuota` = 1_000_000** điểm/phút cho phòng khám thử (và phòng khám buổi-thử của trial).
- Số học: nhu cầu đo được cho đỉnh một phút ≈ 100.000 điểm (40 ca × 2.500). 1.000.000 = 20× hạn mức mặc định mỗi user, **~10× biên** trên đỉnh 100.000 — đủ hấp thụ gửi lại dồn, đợt xả cuối, và tìm/đếm cuối bài mà không chạm trần. Nâng `totalFhirQuota` cùng mức để trần tổng-project không còn là nút thắt (đây chính là lỗ hổng của mức 500.000 cũ).
- **Phạm vi:** chỉ áp cho phòng khám thử/buổi-thử (opt-in, gắn với T6), KHÔNG tắt hạn mức toàn cục và KHÔNG đụng `setup.mjs`/`docker-compose.yml` của stack dev. Không hardcode trần vô hạn vĩnh viễn cho mọi project. Luồng đo riêng `--no-rate-limits` + `experiments/*.mjs` (và yêu cầu "từ chối nếu thấy header `RateLimit`" của `bff-search.mjs`) KHÔNG đổi.

**Phân biệt hai loại 429 (bắt buộc nêu trong VERIFY/báo cáo).**
- 429 do **hạn mức FHIR** (việc này): sinh ở các endpoint `/fhir/R4/*`; log Medplum/BFF có `_consumedPoints … limit …` và/hoặc header `RateLimit: … "fhirInteractions";r=…`. Lưu ý: hiện BFF **đổi 429 hạn mức thành HTTP 500** cho client (kế hoạch mục 5.9, "429 … vẫn thành 500 (T-QUOTA)") — nên khi soi, nhìn log BFF/Medplum chứ không chỉ mã HTTP ở trình duyệt.
- 429 do **rate-limit đăng nhập 5 lần/phút/IP (F5)**: chỉ ở `/auth/login` (và `/auth/newuser`, `/auth/newproject`), xảy ra ở khâu dựng dữ liệu / đăng nhập siêu quản trị khi chạy nhiều lần liền. KHÔNG phải việc này — chờ ~1 phút. Việc nâng quota KHÔNG sửa và KHÔNG nên sửa loại này.

**Không đụng (bất biến).** Logic idempotent `clientUuid`, gói hoàn tất chạy-lại-được, hàng rào in offline (`printHtml`/`whileLocalStoreQuiet`), ngữ nghĩa trong `services/bff/src/medplum.ts`. BFF là lớp duy nhất gọi Medplum; tenant từ JWT. Chỉ sửa script tạo phòng khám thử + tài liệu.

---

## Các bước

- [ ] 1. Nâng hạn mức phòng khám thử e2e-cycles: đặt cả `userFhirQuota` và `totalFhirQuota` = 1_000_000.
      Trong `services/bff/scripts/e2e-clinic.ts`: đổi hằng `USER_FHIR_QUOTA = 500_000` thành `FHIR_QUOTA = 1_000_000` (hoặc giữ tên nhưng thêm hằng tổng), và sửa lời gọi `admin.updateResource<Project>` để `systemSetting` chứa **cả hai** phần tử: `{ name: 'userFhirQuota', valueInteger: FHIR_QUOTA }` **và** `{ name: 'totalFhirQuota', valueInteger: FHIR_QUOTA }`. Cập nhật comment đầu file (dòng ~8–10) giải thích: một tài khoản máy duy nhất ⇒ phải nâng cả trần tổng-project (mặc định chỉ 10× mỗi-user = 500.000, bằng trần mỗi-user cũ nên là nút thắt); 1.000.000 ≈ 10× biên trên đỉnh ~100.000 điểm/phút mà vế "40 ca/60s" của T6 cần; dẫn chiếu T-QUOTA và mục 5.9 phát hiện 1.
      Files: `services/bff/scripts/e2e-clinic.ts`
      Verify: `pnpm typecheck` ở gốc worktree — không lỗi kiểu; `pnpm --filter @phongmach/bff build` biên dịch sạch.

- [ ] 2. Nâng hạn mức phòng khám buổi-thử (trial) đồng mức để nhất quán và tránh 429 làm bẩn số đo M0-1.
      Trong `services/bff/scripts/trial/clinic.ts`: cùng thay đổi như bước 1 — thêm phần tử `{ name: 'totalFhirQuota', valueInteger: … }` bên cạnh `userFhirQuota` trong `systemSetting` của hàm `create()`, nâng hằng lên 1_000_000, và cập nhật khối JSDoc (dòng ~18–22) với cùng lý do (một tài khoản máy cho buổi thử nên trần tổng-project cũng phải nâng; gắn T-QUOTA).
      Files: `services/bff/scripts/trial/clinic.ts`
      Verify: `pnpm typecheck && pnpm --filter @phongmach/bff build` — không lỗi.

- [ ] 3. Chạy kiểm thử không cần Medplum để chắc không vỡ gì.
      Không sửa file ở bước này; chỉ chạy. Lưu ý repo: hạn mức đăng nhập F5 và integration cần stack thật nên KHÔNG chạy ở bước này.
      Files: (không)
      Verify: `pnpm typecheck && pnpm test` ở gốc worktree — toàn bộ unit test xanh (mốc đã biết ~363 bài; con số có thể đã tăng, miễn không có bài đỏ mới do thay đổi này). Không có unit test nào khẳng định giá trị hằng quota, nên không bài nào cần sửa; nếu có bài đỏ, dừng và chẩn đoán trước khi đi tiếp.

- [ ] 4. Cập nhật tài liệu hạn mức trong README của infra Medplum.
      Trong `infra/medplum/README.md`, mục "Điều cần biết" (gạch đầu dòng "Hạn mức mặc định: …"): thêm một câu/ghi chú rằng hạn mức FHIR theo project nâng được qua `Project.systemSetting` với `userFhirQuota` (mỗi user) và `totalFhirQuota` (tổng project, mặc định 10× mỗi user); phòng khám thử của bài T6/e2e-cycles và buổi-thử đặt cả hai = 1.000.000 điểm/phút trong `services/bff/scripts/{e2e-clinic,trial/clinic}.ts` để chạy 100 chu kỳ không chạm trần; đây là bump theo-project có chủ đích (T-QUOTA), KHÔNG phải tắt hạn mức toàn cục (luồng đo riêng vẫn dùng `setup.mjs --no-rate-limits`). *Nếu trích từ tài liệu Medplum thì thêm ghi chú: nội dung đã diễn giải lại cho tuân thủ giấy phép.*
      Files: `infra/medplum/README.md`
      Verify: `pnpm typecheck` vẫn xanh (markdown không ảnh hưởng build); đọc lại đoạn vừa sửa, xác nhận phân biệt rõ bump-per-project vs disable-toàn-cục và nêu đúng tên hai setting.

- [ ] 5. Ghi nhận T-QUOTA đã làm trong kế hoạch triển khai.
      Trong `docs/ke-hoach-trien-khai.md`:
      (a) Mục 8, dòng bảng `T-QUOTA`: giữ mô tả `userFhirQuota`/`totalFhirQuota` từng project; ghi rõ phần đã làm cho M0/T6 (phòng khám thử e2e-cycles + buổi-thử đặt cả hai = 1.000.000 điểm/phút trong code, dựng-lại-được), phần còn lại thuộc M1 (tài khoản nhập dữ liệu hạn mức cao, proxy chuyển IP thật cho hạn mức đăng nhập). Nếu cột GĐ đang là `1`, bổ sung ghi chú rằng phần đủ cho T6 đã làm ở M0.
      (b) Mục 5.9, "Phát hiện 1" (dòng ~894): thêm một câu cập nhật rằng T-QUOTA đã nâng hạn mức phòng khám thử (cả `userFhirQuota` lẫn `totalFhirQuota` = 1.000.000) để gỡ chặn T6; nêu nguyên nhân gốc (một tài khoản máy ⇒ trần tổng-project mặc định 500.000 là nút thắt). Giữ nguyên số liệu đo cũ.
      (c) Mục 5.9, danh sách "429 … vẫn thành 500 (T-QUOTA)" (dòng ~1179) và dòng bảng T6 (dòng ~1086): cập nhật trạng thái "cần T-QUOTA trước" → đã nâng quota; vẫn ghi là việc đo thật 100 chu kỳ chờ chạy nếu stack chưa dựng được ở môi trường này.
      Files: `docs/ke-hoach-trien-khai.md`
      Verify: đọc lại ba đoạn; đảm bảo không mâu thuẫn và vẫn phân biệt hai loại 429. `pnpm typecheck` xanh.

- [ ] 6. VERIFY đầu-cuối trên stack thật (hoặc hoãn có điều kiện, báo rõ, KHÔNG tuyên bố sai).
      Điều kiện tiên quyết (môi trường Windows + Git Bash, Docker Desktop mở; `setup.mjs` cần `openssl` để sinh khóa RSA; script là Bash). Trình tự:
      1. Dựng stack: `infra/dev-up.sh` (hoặc `pnpm stack:up` rồi `pnpm seed`).
      2. Chạy ramp, mỗi mức một lần, in hạt giống để chạy lại: `E2E_CYCLES=40 pnpm e2e:cycles`, rồi `60`, `80`, `100`. Mỗi lần tạo một phòng khám thử MỚI (script tự tạo) nên không đụng phòng khám demo.
      3. Với mỗi mức: ghi mức cao nhất **xanh ổn định** (chạy lại cùng hạt giống vẫn xanh). Nếu máy không chịu nổi 100, nâng dần và báo mức cao nhất xanh.
      4. Đếm và phân loại MỌI 429 còn lại: soi log BFF ở `/tmp/phongmach-dev` (hoặc `WORK=services/bff/.data/e2e-cycles/bff.log`) và log Medplum. Phân loại từng cái: (i) **FHIR-quota** nếu có `_consumedPoints … limit …` / header `RateLimit` ở endpoint `/fhir/R4/*` (nếu còn loại này ở mức 100 ⇒ nâng tiếp `*FhirQuota` và lặp lại); (ii) **login-F5** nếu ở `/auth/login` (chấp nhận được, chỉ chờ ~1 phút). Báo rõ số lượng từng loại.
      Nếu KHÔNG dựng được stack ở môi trường này (Docker tắt, thiếu `openssl`, script chỉ chạy trên Bash): deliverable là thay đổi config + `pnpm typecheck && pnpm test` xanh; hoãn phần chạy 100 chu kỳ kèm hướng dẫn chạy ở trên. TUYỆT ĐỐI không ghi là đã pass khi chưa chạy.
      Files: (không — chỉ chạy và báo cáo; nếu mức 100 vẫn còn FHIR-quota 429 thì quay lại bước 1–2 nâng `*FhirQuota` rồi lặp)
      Verify: báo cáo nêu: mức cao nhất xanh ổn định; số 429 còn lại và loại từng cái; nếu hoãn thì nêu rõ lý do môi trường và lệnh chạy lại.

## Ghi chú cho reviewer / văn hóa kiểm thử

Đây là thay đổi cấu hình/hạ tầng (giá trị hằng + lời gọi `updateResource` + tài liệu), không có biện pháp an toàn mới nào để viết test đột-biến RED-when-removed. Giữ nguyên văn hóa: không nới lỏng/vô hiệu test hiện có; không đụng các bất biến idempotent/completion/print-fence. Bằng chứng đúng đắn là bài e2e-cycles tự nó (chạy ở bước 6) — khi chưa nâng quota nó đỏ ở ~chu kỳ 17 do 429, nâng rồi mới xanh ở 100.
