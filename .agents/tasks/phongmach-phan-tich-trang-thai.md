# Phân tích trạng thái dự án PHONGMACH (phục vụ migrate Claude Code → Kiro)

> Báo cáo điều tra CHỈ ĐỌC, lập ngày điều tra trên nhánh `main` (commit `6e3c2f7`).
> Repo: `D:\My Documents D\UNIGIS\PM\phongmach`. Không sửa file nào, không dựng Docker, không chạy build/test.
> Mọi khẳng định dưới đây đều kèm đường dẫn file để người đọc tự kiểm chứng.

---

## Tóm tắt nhanh (đọc cái này trước)

PHONGMACH là phần mềm SaaS quản lý phòng mạch tư nhân Việt Nam, backend **Medplum 5.2.0 (FHIR R4)** tự host qua Docker, kiến trúc **PWA React/TS/Vite + BFF Fastify** (BFF là lớp *duy nhất* gọi Medplum) với các package dùng chung. Bối cảnh đã biết trong brief **khớp với thực tế code và tài liệu**.

Trạng thái cột mốc: đang ở **M0** (MVP trình nhà đầu tư, hạn 13/11/2026). Đã làm xong **M0-S1, M0-S2 và toàn bộ phần ngoại tuyến của M0-S3** — và quan trọng: **có code thật tương ứng với mọi hạng mục mà kế hoạch tuyên bố "Xong"**. Tôi kiểm tra chéo từng hạng mục "Xong" với mã nguồn và xác nhận được tất cả (chi tiết ở mục C). Phần M0 còn thiếu là những việc *cần con người* hoặc chưa chạm tới: Zalo mô phỏng (chưa có một dòng mã), phiên thử với bác sĩ thật (M0-1), kịch bản/diễn tập trình diễn (M0-6), và T6 ngoại tuyến đầy đủ.

Khoảng cách kế hoạch ↔ code: **không phát hiện hạng mục "Xong" nào thiếu code**. Khoảng cách chủ yếu nằm ở **git**: `main` cục bộ và `origin/main` đã phân nhánh (5 vs 24 commit), và vài bản sửa lỗi đã biết nằm ở nhánh/PR chưa merge vào `main` (chi tiết mục D & E).

Rủi ro lớn nhất cho việc migrate sang Kiro: dự án có **rất nhiều quy ước an toàn ngầm định** (BFF là lớp duy nhất gọi Medplum; tenant lấy từ phiên; ghi nhật ký trước khi trả dữ liệu; không PII trong log; mọi phần mô phỏng phải có nhãn; Medplum transaction không nguyên tử nên gói ghi phải chạy lại được; chạy trên Windows bằng Git Bash) cùng một loạt **"bẫy" e2e/Playwright/IndexedDB** đã trả giá để tìm ra. Những quy ước này phải được đưa vào steering file của Kiro, nếu không agent mới sẽ phá vỡ chúng mà không biết (mục F).

---

## (A) Tổng quan dự án và kiến trúc

### A.1 Dự án là gì

- SaaS quản lý phòng mạch tư nhân VN; luồng lõi: **tiếp đón → hàng chờ → khám một trang → kê đơn (có quy tắc) → in A5 QR → liên thông cổng đơn thuốc**, cộng **ngoại tuyến** và **nhật ký truy cập / cách ly tenant**.
- Nguồn: `README.md` (mô tả cấu trúc), `docs/ke-hoach-trien-khai.md` (kế hoạch ~1140 dòng).

### A.2 Kiến trúc thực tế (đã xác minh trong code)

| Lớp | Công nghệ | Vị trí | Vai trò |
|---|---|---|---|
| Giao diện | PWA React + TypeScript + Vite, Dexie, Workbox | `apps/clinic-web` (`@phongmach/clinic-web`) | Tiếp đón, khám, kê đơn, in, ngoại tuyến |
| BFF / Domain API | Fastify + `@medplum/core` | `services/bff` (`@phongmach/bff`) | **Lớp duy nhất gọi Medplum** |
| Mô hình VN trên FHIR | TS thuần | `packages/fhir-vn-model` | Chuẩn hóa tên không dấu, SĐT, CCCD, dựng `Patient` |
| Danh mục | TS thuần | `packages/catalogs` | ICD-10, thuốc, đơn mẫu (minh họa) |
| Quy tắc kê đơn | TS thuần (hàm thuần) | `packages/rules` | Trùng hoạt chất, dị ứng, số ngày, `allergy-unknown` |
| FHIR lâm sàng | TS thuần | `packages/clinical` | Hàng chờ, sinh hiệu, gói hoàn tất lượt khám chạy lại được, đo thời gian |
| In | TS thuần | `packages/print` | Mẫu A5 + QR, dùng chung BFF & trình duyệt |
| Hạ tầng | Docker Compose, scripts `.mjs` | `infra/`, `infra/medplum/` | Medplum 5.2.0 + PostgreSQL 16 + Redis 7, dev-up.sh, bench, e2e-cycles |

**Bằng chứng "BFF là lớp duy nhất gọi Medplum":** số lần import `@medplum/*` trong toàn bộ `apps/clinic-web/src` = **0** (kiểm bằng grep). `MedplumClient` chỉ xuất hiện ở `services/bff/src/medplum.ts`. Giao diện web chỉ gọi `/api/...` (xem `apps/clinic-web/src/api.ts`, chỉ import *type* từ các package dùng chung).

- Monorepo **pnpm 12.8.1**, Node **>= 22** (`package.json` gốc, `.nvmrc` = `22`), 7 workspace package (tên đã xác nhận: `@phongmach/{clinic-web,bff,catalogs,clinical,fhir-vn-model,print,rules}`).
- Mỗi phòng khám = một Medplum `Project` + một `ClientApplication` (client credentials). `MedplumTenants` trong `services/bff/src/medplum.ts` giữ một `MedplumClient` đăng nhập riêng cho mỗi tenant, `cacheTime: 0` để không trả bản đọc cũ cho người dùng khác.

---

## (B) Kế hoạch & cột mốc

Nguồn: `docs/ke-hoach-trien-khai.md`, cập nhật lần 4 ngày 03/10/2026. Hợp nhất ba nguồn: báo cáo nhà đầu tư v2.0, tài liệu nội bộ 34 trang (TL34), và kết quả cài/thử Medplum.

### B.1 Quyết định định hình (02/10/2026)
Chủ dự án chọn **làm sớm + cắt phạm vi**: xây ứng dụng ngay từ 05/10 song song với kiểm chứng, chia Giai đoạn 1 thành hai cột mốc MVP.

### B.2 Các cột mốc

| Cột mốc | Ngày | Nội dung | Trạng thái |
|---|---|---|---|
| **M0 — MVP trình nhà đầu tư** | 13/11/2026 | Lát cắt dọc chạy thật trên Medplum: tiếp đón→khám→kê đơn→in, có ngoại tuyến, nhật ký, cách ly; cổng/ký số/Zalo **mô phỏng có nhãn** | Đang làm; S1+S2+ngoại tuyến S3 xong trước lịch |
| **M1 — MVP pilot** | 31/03/2027 | Nối thật cổng đơn thuốc, ký số, thanh toán QR, Zalo; 15–20 phòng pilot | Chưa bắt đầu (chỉ khi "đi" ngày 13/11) |
| Giai đoạn 2 | 04–07/2027 | Bệnh án điện tử đầy đủ, hóa đơn điện tử, ngoại tuyến hoàn chỉnh, đa vùng/DR | Đầu việc |
| Giai đoạn 3 | 08–12/2027 | Sổ sức khỏe/VNeID, nhà thuốc, AI, ISO 27001 | Đầu việc |

M0 chia 3 sprint: M0-S1 (05–16/10), M0-S2 (19–30/10), M0-S3 (02–13/11).

### B.3 Tiêu chí chấp nhận M0 (mục 5.3)
M0-1 thời gian mở hồ sơ→in đơn (p50 ≤ 60s, p90 ≤ 120s, cần 3 bác sĩ thật); M0-2 ngoại tuyến 20 chu kỳ 0 mất 0 trùng; M0-3 tìm bệnh nhân p95 ≤ 200ms/20.000 BN; M0-4 cách ly; M0-5 trung thực (nhãn mô phỏng); M0-6 ổn định trình diễn.

### B.4 Tiêu chí "đi/không đi" (mục 5.4): T1–T10
T1 cổng+ký số sandbox; T2 hiệu năng quy mô; T3 nâng cấp/khôi phục; T4 năng lực Medplum; T5 chi phí; T6 ngoại tuyến 100 chu kỳ; T7 rời tenant; T8 tìm tiếng Việt; T9 thị trường; T10 pháp lý. Dự phòng: phương án B = .NET + PostgreSQL.

### B.5 Danh mục công việc T-* (mục 8)
~40 mã công việc. Nổi bật đã làm trong M0: **T-APP, T-BFF, T-RULE, T-CAT, T-PRINT, T-TELE, T-SIM, T-DEMO, T-IDEM, T-NAME, T-AUD (mức M0), T-OFF (M0)**. Còn lại cho M1/GĐ2: T-RX (cổng thật), T-SIGN (ký số thật), T-OUTBOX (bộ quét đối soát), T-IDP (xác thực thật), T-ENC (mã hóa cấp trường), T-OFFB (rời tenant), T-MIG, T-PAY, T-ZALO, T-EMR, T-CAP/T-HA/T-DR (công suất/HA/DR), T-IAC, T-COST.

### B.6 Phát hiện kỹ thuật nền tảng (F1–F12, mục 2)
Những phát hiện này định hình toàn bộ thiết kế — đặc biệt:
- **F11**: `Bundle` transaction của Medplum 5.2.0 **không nguyên tử** (một mục lỗi vẫn HTTP 200, các mục khác vẫn ghi). ⇒ mọi gói ghi phải **chạy lại được** (định danh xác định + `ifNoneExist`, điểm chốt đứng cuối).
- **F12**: Chromium (headless) **bỏ mất sự kiện IndexedDB đang dở khi gọi `print()`** ⇒ phải có "hàng rào in".
- F2 (Medplum gọi `api.pwnedpasswords.com`), F4 (tìm tên không dấu phải thêm `HumanName` thứ hai), F5 (hạn mức FHIR theo điểm, 429 âm thầm trong batch), F6 (cách ly tenant), F3 (AuditEvent chỉ cho đọc/ghi theo id, không có cho search, ghi không đợi).

---

## (C) Trạng thái thực tế từng phần (đối chiếu kế hoạch ↔ code)

Ký hiệu: ✅ = kế hoạch nói "Xong" VÀ tìm thấy code xác nhận · ⏳ = chưa làm (đúng như kế hoạch nói) · ⚠️ = cần chú ý.

| Hạng mục | Kế hoạch nói gì | Code xác nhận | Vị trí file |
|---|---|---|---|
| Monorepo, 7 package, CI | Xong (M0-S1) | ✅ pnpm workspace, 7 package tên `@phongmach/*`; CI 3 job | `package.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml` |
| Tìm bệnh nhân (SĐT / 4 số cuối / CCCD / tên không dấu) | Xong (T-NAME) | ✅ `searchPatients` xử lý 5 loại intent; `rankByPhoneSuffix`; tên không dấu nhờ HumanName thứ hai | `services/bff/src/medplum.ts` (`searchPatients`), `packages/fhir-vn-model/src/text.ts` (`foldName`), `search.ts` |
| Ghi idempotent (T-IDEM) | Xong | ✅ `createResourceIfNoneExist` + `clientUuidQuery`; create có điều kiện | `services/bff/src/medplum.ts` (`createPatient`, `checkIn`, `addAllergy`...), `packages/fhir-vn-model/src/identifiers.ts` |
| Nhật ký truy cập fail-closed, không PII | Xong (T-AUD mức M0) | ✅ `record()` ghi NDJSON + `fsync` TRƯỚC khi trả dữ liệu; comment ghi rõ "ghi lỗi thì yêu cầu lỗi"; AuditEntry không chứa nội dung truy vấn | `services/bff/src/audit.ts`, `services/bff/src/routes/context.ts` (`record`, `guard`) |
| Tenant lấy từ phiên | Nguyên tắc xuyên suốt | ✅ `Session.tenant` nằm trong JWT đã ký; verify đọc `tenant` từ token, không từ tham số | `services/bff/src/session.ts` |
| Hàng chờ, cấp số không trùng, màn hình chờ | Xong (M0-S2) | ✅ `checkIn` lấy số kế tiếp + create có điều kiện theo mã lượt khám; `listQueue`, `prefetchQueue` | `services/bff/src/medplum.ts`, `packages/clinical/src/queue.ts` |
| Khám một trang (sinh hiệu, ICD-10 gõ tắt, dị ứng, tiền sử) | Xong | ✅ Visit/ExamForm; vitals/notes trong clinical | `apps/clinic-web/src/visit/{Visit,ExamForm,PatientSide}.tsx`, `packages/clinical/src/{vitals,notes}.ts` |
| Quy tắc kê đơn (chạy ở client + chạy lại ở server khi ký) | Xong (T-RULE) | ✅ hàm thuần dùng chung; `allergy-unknown`, trùng hoạt chất, số ngày, theo tuổi | `packages/rules/src/{check,age,types,index}.ts`, dùng lại ở `services/bff` khi ký |
| In A5 + QR, dùng chung BFF & trình duyệt | Xong (T-PRINT, OFF-1) | ✅ gói `@phongmach/print`; BFF `/print` dùng chung | `packages/print/src/{index,prescription}.ts` |
| Cổng đơn thuốc **mô phỏng** + outbox + thử lại (T-SIM) | Xong, mô phỏng có nhãn | ✅ `SimulatedGateway` nhãn "MÔ PHỎNG", idempotent theo `localCode`, trạng thái tách theo tenant, nút chèn lỗi | `services/bff/src/gateway.ts`, `outbox.ts` |
| Outbox là `Task` trong Medplum, điểm chốt cuối (A2/F11) | Xong (M0-S2) | ✅ `buildCompletionBundle` + `failedEntries`; `toJob` chỉ gửi khi Encounter `finished` | `services/bff/src/medplum.ts` (`completeVisit`, `toJob`, `dueSends`), `packages/clinical/src/outbox.ts` |
| Ký số **mô phỏng** (hash SHA-256 → Provenance, có nhãn) | Mô phỏng | ✅ nhãn "KÝ KHI MẤT MẠNG" / "mô phỏng" (13 chỗ trong .tsx) | `apps/clinic-web/src/visit/*`, `components/*` |
| Đồng hồ phiên khám (T-TELE), giờ máy khách/máy chủ (OFF-3) | Xong phần đo (M0-1 cần người thật) | ✅ `measureVisit`, nguồn `server`/`client`/`client-invalid` | `packages/clinical/src/{time,clientTime}.ts`, `services/bff/src/medplum.ts` (`completeVisit`), `components/Metrics.tsx` |
| Trang "Phạm vi" (đã thật/mô phỏng/chưa làm) (M0-5) | Xong | ✅ `Scope.tsx`, dải nhãn `DemoBanner.tsx` | `apps/clinic-web/src/components/{Scope,DemoBanner}.tsx` |
| **Ngoại tuyến OFF-1→OFF-7** | Xong (M0-S3) | ✅ kho IndexedDB mã hóa AES-GCM-256 khóa không xuất; hàng đợi đồng bộ; bộ đệm; chỉ báo/danh sách | `apps/clinic-web/src/local/*` (`store.ts`, `crypto.ts`, `sync.ts`, `client.ts`, `syncList.ts`, `deps.ts`, `cache.ts`, `OfflineProvider.tsx`), `components/{SyncBar,SyncPanel}.tsx` |
| Kho mã hóa (OFF-5), không PIN | Xong, không PIN (quyết định 02/10) | ✅ AES-GCM 256-bit, `extractable:false`, IV mới mỗi lần ghi, AAD = bảng+id | `apps/clinic-web/src/local/crypto.ts`, `store.ts` |
| BFF nhận thao tác ngoại tuyến (giờ máy khách, số tạm, nạp trước, ghi nhận in) | Xong (OFF-2/3/4, lát 3a) | ✅ `checkIn(arrivedAt,proposedNumber)`, `openVisit(openedAt)`, `completeVisit(clientTimes,allergiesUnknown)`, `prefetchQueue` | `services/bff/src/medplum.ts`, `routes/clinical.ts` |
| M0-2 (20 chu kỳ ngắt/khôi phục mạng) | **Đạt [Đã đo]** | ✅ bài `offline-cycles.mjs` + điều phối `infra/e2e-cycles.mjs`, script `e2e:cycles` | `apps/clinic-web/e2e/offline-cycles.mjs`, `infra/e2e-cycles.mjs` |
| Màn hình nhật ký truy cập cho quản trị | Xong (M0-S1) | ✅ `AuditLog.tsx` | `apps/clinic-web/src/components/AuditLog.tsx` |
| **Zalo mô phỏng** | ⏳ **Chưa** (chưa có dòng mã) | ⚠️ không tìm thấy mã Zalo; nhãn đã chuyển Zalo sang "Chưa có" | — |
| Phiên thử 3 bác sĩ thật (M0-1) | ⏳ Chưa (cần người thật) | — đồng hồ & trang số đo đã có | `components/Metrics.tsx` |
| Kịch bản 10 phút, diễn tập, máy dự phòng (M0-6) | ⏳ Chưa | README có các bước đi tay | `README.md` |
| T6 đầy đủ (100 chu kỳ + 40 ca/60s) | ⏳ Chưa (cần T-QUOTA trước) | — một lần chạy 100 chu kỳ đã đạt | `apps/clinic-web/e2e/offline-cycles.mjs` |

**Kết luận mục C: mọi hạng mục kế hoạch đánh dấu "Xong" đều có code xác nhận.** Không tìm thấy trường hợp "kế hoạch nói xong nhưng không có code". Các mục còn lại ("Chưa") trùng khớp với những gì kế hoạch tự khai là chưa làm.

Kiểm thử (theo kế hoạch mục 5.9, con số của lát 6, **chưa chạy lại trong điều tra này**): 370 unit + 41 integration (Medplum thật) + e2e 13+24+13+12 bước + bài 20 chu kỳ. Số test khớp với số file test tìm thấy (ví dụ `services/bff/test/{unit,integration}`, `apps/clinic-web/src/**/*.test.ts(x)`, `apps/clinic-web/e2e/*`).

---

## (D) Trạng thái git, worktree & CI

### D.1 Nhánh và trạng thái

- Nhánh hiện tại: **`main`** (HEAD `6e3c2f7` — "gom mockup v0.2…").
- ⚠️ **`main` cục bộ đã phân nhánh với `origin/main`**: `git status` báo "diverged, 5 and 24 different commits". Nghĩa là bản cục bộ có 5 commit origin chưa có, origin có 24 commit cục bộ chưa có. **Cần đồng bộ/rebase có chủ đích trước khi làm việc tiếp** — đây là điểm quan trọng nhất khi chuyển môi trường.
- Working tree **sạch** (nothing to commit).
- `main` là nhánh chính (`origin/HEAD -> origin/main`).

### D.2 Lịch sử (40 commit gần nhất) phản ánh đúng tiến trình kế hoạch
Chuỗi commit đi theo đúng M0-S1 → M0-S2 → M0-S3 (các lát OFF, M0-ENV Windows, lát 5 network-cycles, lát 6 offline-labels-docs), rồi tới các commit UI redesign và mockup. Ví dụ: `db6e7f0` (M0-S1/S2 + Medplum backend), `5ead92f` (M0-S2.4), `7067985`/`68d4897` (M0-S3 ngoại tuyến), `702a9c5` (bài 20 chu kỳ), `6775a6e`/`9fde16b` (lát 6).

### D.3 Nhánh dở / PR chưa merge (khoảng cách thực tế)
Kế hoạch (mục 5.8/5.9) tự ghi nhận các điểm sau — xác nhận lại từ git:
- Có **~20 nhánh `claude/*`** local + ~15 remote `origin/claude/*`. Nhiều nhánh là worktree của Claude Code.
- **PR xếp chồng chưa về `main`**: kế hoạch nêu PR #7 (sửa "mục thử lại chờ tới 30s") merge vào nhánh lát 5 *sau* khi nhánh đó đã vào `main`, nên **`main` chưa có bản sửa này**; PR #9 (sửa "hàng chờ hiện hai dòng") còn là bản nháp. ⇒ Bốn lỗi đã biết của lát 5 vẫn còn trên `main` (xem mục E).
- **OFF-8** ("Ký & In lúc có mạng mà máy chủ chưa nhận ngay"): mới có **thiết kế + test tái hiện, CHƯA sửa mã sản phẩm**, đang chờ chủ dự án duyệt (4 câu hỏi ở cuối mục 5.8).

### D.4 Worktree (từ `git worktree list`)
```
.../phongmach                                              6e3c2f7 [main]
.../.claude/worktrees/busy-gould-3a06b4                    daf0c58 (detached)
.../.claude/worktrees/interesting-goldwasser-193dd6        f12040a [claude/m0-ph-feedback-fixes-7c49ec]
.../.claude/worktrees/m0-s3-6-offline-labels-docs-ba204d   f12040a [claude/graphify-d79f64]
.../.claude/worktrees/prepare-m0-1-trial-session-fe4781    1261d92 (detached)
.../.claude/worktrees/relaxed-rosalind-1e624e              f12040a (detached)
.../.claude/worktrees/update-all-app-prompts-320a61        fc2f8d5 [claude/update-all-app-prompts-320a61]
```
6 worktree phụ nằm trong `.claude/worktrees/` — tạo bởi Claude Code. Khi migrate sang Kiro cần quyết định giữ hay dọn các worktree này (xem khuyến nghị G).

### D.5 CI (`.github/workflows/ci.yml`)
Kích hoạt: push `main` + mọi pull_request. **3 job:**
1. **check** — `pnpm typecheck` + `pnpm test` (unit) + `pnpm build`.
2. **integration** — dựng Medplum (Docker Compose) + chờ healthcheck + `pnpm --filter @phongmach/bff test:integration` (Medplum thật).
3. **e2e** — dựng Medplum, `pnpm seed` (SEED_PATIENTS=5), build + preview giao diện, chạy `e2e` + `e2e:visit` + `e2e:offline` + `e2e:conflict` + `e2e:cycles` (M0-2). Dùng Chrome hệ thống trên runner (`CHROMIUM_PATH=/usr/bin/google-chrome`), upload screenshot khi lỗi.

Kế hoạch ghi cả ba job xanh trên `main` tại commit `43e4b6d` (chưa chạy lại trong điều tra này).

---

## (E) Khoảng cách giữa kế hoạch và code

1. **Không có khoảng cách "nói xong nhưng thiếu code".** Đây là kết luận tích cực và đã kiểm chéo kỹ (mục C).

2. **Khoảng cách nằm ở git state, không ở code:**
   - `main` local vs `origin/main` phân nhánh 5↔24 commit (cần hợp nhất).
   - Vài bản sửa lỗi đã biết chưa về `main` (PR #7, PR #9 nháp).

3. **Lỗi đã biết còn trên `main`** (kế hoạch mục 5.9 (a), không lỗi nào gây mất/trùng bản ghi máy chủ):
   - "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay **có lúc không in đơn** → thiết kế **OFF-8 chờ duyệt**.
   - Chế độ "Mất mạng" không tự thoát khi hết mục chờ.
   - Hàng chờ có lúc hiện 2 dòng cho 1 lượt khám (PR #9 nháp).
   - Mục "thử lại" có thể nằm chờ thêm tới 30s (PR #7, chưa về `main`).
   > Lỗi #1 và #3 **có thể gặp ngay trên sân khấu demo** — nên xử lý trước 13/11.

4. **Việc M0 còn lại cần làm:** Zalo mô phỏng (chưa có code), phiên thử bác sĩ thật (M0-1), kịch bản/diễn tập/máy dự phòng (M0-6), T6 đầy đủ (phụ thuộc T-QUOTA).

5. **Giới hạn đã biết cần quyết (mục 5.9 (b)–(k)):** hai máy không thấy nhau khi mất Internet (N5); mục bị từ chối (409/422 blocking) không có đường ra; "đã in đơn rồi mới thấy cảnh báo"; khóa mã hóa nằm cùng máy, không PIN; chưa thử ngoài Chromium headless.

6. **Câu hỏi mở còn treo (mục 3.4 & mục 9):** tài liệu API cổng quốc gia (TL34 Q1, chặn T-RX/M1), mâu thuẫn chi phí 15/25/60 triệu, định danh FHIR chuẩn (đang dùng URN tạm `urn:phongmach:…`), xác thực thật (T-IDP).

---

## (F) Quy ước dự án cần đưa vào steering file Kiro

Đây là phần quan trọng nhất cho việc migrate. Trích từ kế hoạch (mục 5.6, 5.7, 5.8 "bẫy đã gặp") và README. **Nếu agent Kiro không biết các quy ước này, nó sẽ phá vỡ các bất biến an toàn mà không nhận ra.**

### F.1 Bất biến kiến trúc & an toàn (BẮT BUỘC giữ)
- **BFF là lớp DUY NHẤT gọi Medplum.** Giao diện web không bao giờ import `@medplum/*` hay gọi thẳng Medplum (hiện tại = 0 import, phải giữ nguyên).
- **Tenant lấy từ phiên (JWT đã ký), KHÔNG từ tham số request.** (`services/bff/src/session.ts`).
- **Ghi nhật ký truy cập TRƯỚC khi trả dữ liệu (fail-closed).** Ghi nhật ký lỗi ⇒ request lỗi, dữ liệu bệnh nhân không rời BFF (`audit.ts`, `routes/context.ts`).
- **Không PII trong log.** Fastify mặc định log cả query string (có SĐT/CCCD/tên) — đã tắt; nhật ký truy cập không chứa nội dung truy vấn/tên/token. Có test khẳng định điều này.
- **Mọi phần mô phỏng phải có NHÃN trên màn hình** + trang "Phạm vi" (đã thật/mô phỏng/chưa làm). Áp dụng cho: ký số, cổng đơn thuốc, (Zalo khi làm).
- **Medplum transaction KHÔNG nguyên tử (F11):** không dựa vào hoàn tác, không dựa vào `If-Match` trong gói để chặn ghi đồng thời. Mọi gói ghi nhiều bản ghi phải **chạy lại được** (`clientUuid` xác định + `ifNoneExist`), có một mục "điểm chốt" đứng cuối, và **phải kiểm `failedEntries` từng mục** của phản hồi (dù HTTP 200).
- `PUT` với id client tự chọn → 404; dùng `createResourceIfNoneExist` theo identifier.
- Quy tắc kê đơn chạy ở client để cảnh báo nhanh **và chạy lại ở BFF khi ký** (không tin client).

### F.2 Quy ước ngoại tuyến (N1–N5, OFF-*)
- **N1 Lưu bền trước, gửi/in sau.** Ghi cục bộ lỗi ⇒ báo lỗi và **không in**.
- **N2 Một thao tác, một `clientUuid`**, giữ qua mọi lần gửi lại/tải lại/hết phiên.
- **N3 Không âm thầm**: mỗi mục có trạng thái; mục "cần xử lý" không tự bỏ/ghi đè.
- **N5 Ngoại tuyến là của từng máy** (hai máy không thấy nhau khi mất Internet).
- **Mọi lần in đi qua `printHtml` / hàng rào `whileLocalStoreQuiet`** — không bao giờ gọi `window.print()` thẳng (F12).
- Kho cục bộ: IndexedDB (Dexie) + AES-GCM-256, khóa `extractable:false`, IV mới mỗi lần ghi, AAD = tên bảng + id. Trường dạng rõ chỉ gồm id/trạng thái/thời điểm/loại (`local/crypto.ts`, `local/store.ts`).
- Service worker **chỉ lưu vỏ ứng dụng, KHÔNG lưu `/api`** (có dữ liệu bệnh nhân).

### F.3 Môi trường & công cụ (Windows!)
- **Chạy trên Windows bằng Git Bash (Git for Windows), KHÔNG dùng PowerShell/cmd.** `infra/dev-up.sh` cần Git Bash.
- Node **>= 22**, **pnpm 12** (shim corepack của pnpm có thể hỏng — cài pnpm trực tiếp; `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`). pnpm 12 coi script build esbuild là lỗi cứng ⇒ cần `allowBuilds` trong `pnpm-workspace.yaml`.
- Chromium cho e2e: **`chrome-headless-shell` của Playwright**, không dùng Chrome hệ thống (mở vào phiên đang dùng). Trên Windows đặt qua `CHROMIUM_PATH`; `e2e/browser.mjs` tự tìm trong `%LOCALAPPDATA%\ms-playwright`.
- Cổng: dev-up.sh **không bao giờ dừng tiến trình không do nó tạo**; cổng 5173 bận → giao diện chạy từ 5183, cần `E2E_URL`. BFF 8110.
- **Không dùng `pkill -f` theo mẫu chữ** (từng giết chính shell). Dùng file PID + nhóm tiến trình.
- Medplum dùng chung cho cả máy; bí mật ở `infra/medplum/.env`, `config/`, `services/bff/.demo-tenants.json` — **đã gitignore, KHÔNG commit**.
- Lệnh dev chính: `infra/dev-up.sh` (--stop để dừng), hoặc `pnpm stack:up` → `pnpm seed` → `DEMO_AUTH=1 pnpm dev:bff` → `pnpm dev:web`.
- Kiểm thử: `pnpm typecheck`, `pnpm test`, `pnpm --filter @phongmach/bff test:integration`, `pnpm e2e`, `pnpm e2e:cycles`.
- **BFF chỉ chạy với `DEMO_AUTH=1`, chỉ localhost, chỉ dữ liệu giả** (chưa có xác thực thật — T-IDP).

### F.4 Bẫy e2e / Playwright / test (đã trả giá để tìm ra)
- **Không dùng `page.waitForFunction` với hàm `async`**: Playwright coi promise trả về là "truthy" và xong ngay (không chờ gì). Dùng `eventually(() => page.evaluate(async …))`.
- Dấu hiệu của bẫy trên: e2e xanh trên bản dev nhưng đỏ trên bản build (build nhanh hơn).
- **Kiểm thử hẹn giờ phải dùng thời gian ảo, không `sleep`** (CI chậm hơn máy dev; từng làm đỏ CI vì hạn 40ms). Bài hỏng giữa chừng không được để lại trạng thái chung (reset trong `beforeEach`).
- **Hạn mức đăng nhập Medplum 5 lần/phút theo IP (F5)**: chạy bộ integration 3 lần liền sẽ gặp 429 ở khâu dựng dữ liệu — không phải lỗi mã, chờ 1 phút.
- **Không thăm dò trên phòng khám demo** (làm sai số thứ tự/lịch sử) — tạo phòng khám tạm (`createTenantProject`). Bài e2e tự dọn hàng chờ đầu & cuối.
- **Bài kiểm thử chỉ đáng tin sau khi đã thấy nó đỏ** (quy ước đột biến/mutation: mỗi biện pháp an toàn phải có test được xác nhận đỏ khi gỡ biện pháp). Script đột biến phải đếm số bài thực sự chạy.
- Playwright 1.63: sau khi reload lúc `setOffline(true)`, `navigator.onLine` lại `true` dù mọi request lỗi, và bật mạng lại không phát sự kiện `online`.
- `route.fetch()` chạy từ Node nên không chịu `setOffline`.
- **Hạn mức FHIR ~2.500 điểm/lượt khám** (ghi 100, tìm 20); mặc định 50.000 điểm/phút ≈ 20 lượt/phút/tài khoản máy ⇒ T6 cần T-QUOTA trước.

### F.5 Khi hoàn thành một tính năng, cập nhật các nơi mô tả hiện trạng
`components/Scope.tsx`, `components/DemoBanner.tsx`, `README.md` (mục "Giới hạn"), các mục 5.2/5.7/5.9 của kế hoạch, và bước kiểm trang "Phạm vi" trong `e2e/visit.mjs`.

---

## (G) Khuyến nghị cho việc migrate sang Kiro

1. **Dọn trạng thái git trước tiên.** `main` local và `origin/main` đang phân nhánh (5↔24). Trước khi để Kiro làm việc, hợp nhất có chủ đích (xác định đâu là nguồn sự thật — nhiều khả năng `origin/main`). Việc này nên làm thủ công, có review, **không** để agent tự `reset --hard`/`push --force`.

2. **Tạo steering file Kiro từ mục F.** Đề xuất đặt tại `.kiro/steering/phongmach.md` với `inclusion: always` (hoặc `fileMatch` cho các vùng cụ thể). Tối thiểu phải chứa F.1 (bất biến an toàn), F.3 (Windows/Git Bash/pnpm/Chromium), F.4 (bẫy e2e). Đây là thứ dễ bị agent mới vô tình phá nhất.

3. **Quyết định số phận các worktree `.claude/worktrees/`.** 6 worktree + ~35 nhánh `claude/*` là di sản Claude Code. Khuyến nghị: giữ nhánh trên remote để truy vết lịch sử, nhưng dọn các worktree cục bộ đã merge (`git worktree remove`) để tránh nhầm lẫn — **chỉ sau khi xác nhận không còn việc dở trong đó** (ví dụ `prepare-m0-1-trial-session`, `m0-ph-feedback-fixes` nghe như còn việc). Kiểm từng cái bằng `git -C <worktree> status` trước khi xóa.

4. **MCP của Medplum cho Claude Code — bối cảnh câu hỏi gốc của người dùng:** Người dùng hỏi liệu nối MCP Medplum tới Claude/Kiro có ý nghĩa cho dự án không. Căn cứ kiến trúc: **mọi truy cập Medplum đi qua BFF**, và dev chạy Medplum tự host qua Docker. Một MCP server Medplum (đọc FHIR, chạy truy vấn) có thể hữu ích để *agent thăm dò dữ liệu/giản đồ FHIR trong lúc phát triển*, nhưng **không nên trở thành đường ghi** — ghi phải qua BFF để giữ các bất biến (idempotency, nhật ký, tenant từ phiên, gói chạy lại được). Nếu nối, giới hạn ở phạm vi đọc trên stack dev cục bộ. (Đây là nhận định kỹ thuật dựa trên kiến trúc đã đọc; quyết định cuối thuộc chủ dự án.)

5. **Trước demo 13/11, ưu tiên theo thứ tự:** (a) duyệt OFF-8 và sửa lỗi "Ký & In không in" + "hàng chờ 2 dòng" (có thể gặp trên sân khấu); (b) làm Zalo mô phỏng (hạng mục M0 duy nhất chưa có code); (c) phiên thử 3 bác sĩ thật để lấy số M0-1; (d) kịch bản + diễn tập + máy dự phòng (M0-6).

6. **Xác minh lại CI/test trên môi trường Kiro+Windows.** Báo cáo này **không chạy** build/test (điều tra chỉ đọc). Khi migrate, chạy `pnpm typecheck && pnpm test` rồi `pnpm --filter @phongmach/bff test:integration` và `pnpm e2e` qua Git Bash + Docker Desktop để xác nhận 370 unit / 41 integration / e2e vẫn xanh như kế hoạch khai.

7. **Giữ nguyên quy ước "mutation testing".** Khi Kiro thêm/sửa biện pháp an toàn, yêu cầu nó viết test và chứng minh test đỏ khi gỡ biện pháp — đây là văn hóa kiểm thử của dự án, đừng để mất khi đổi agent.

---

## Phụ lục: cơ sở điều tra

- **Đã đọc toàn bộ** `docs/ke-hoach-trien-khai.md` (các mục 1–10, gồm 5.6–5.9, OFF-1→OFF-8, mục 6 cắt phạm vi, mục 7 GĐ2/3, mục 8 danh mục T-*, mục 9 câu hỏi, mục 10 rủi ro).
- **Đã đọc** `README.md` toàn văn; `package.json` gốc; `.github/workflows/ci.yml`; `services/bff/src/{audit,session,gateway,medplum}.ts`, `routes/context.ts`; `packages/rules/src/index.ts`; (xác minh grep) `apps/clinic-web/src/api.ts`, `local/crypto.ts`, `packages/fhir-vn-model/src/text.ts`.
- **Đã liệt kê** cây thư mục `apps/clinic-web/src`, `services/bff/src`, `packages/*/src`, `infra/*`, và các file test/e2e.
- **Đã chạy git chỉ đọc**: `log --oneline -40`, `branch -a`, `status`, `worktree list`.
- **KHÔNG** sửa file, **KHÔNG** dựng Docker, **KHÔNG** chạy build/test/dev — các con số test là trích từ kế hoạch (nhãn [Đã đo] của tác giả kế hoạch), chưa được điều tra này chạy lại.

Nội dung đã được diễn giải và tóm lược từ tài liệu dự án để tuân thủ yêu cầu bản quyền.

---

## (H) Cập nhật tiến độ & trạng thái đóng gói / triển khai (09/10/2026)

> Mục này bổ sung sau khi rà lại kho hạ tầng để phục vụ yêu cầu "dựng Docker/K8s để demo phần mềm thực".

### H.1 Tiến độ cột mốc (không đổi về bản chất so với mục C)
- Vẫn đang ở **M0** (MVP trình nhà đầu tư, hạn 13/11/2026). Xong M0-S1, M0-S2 và toàn bộ phần ngoại tuyến M0-S3, có code xác nhận.
- Việc M0 còn lại: Zalo mô phỏng (chưa có code), phiên thử 3 bác sĩ thật (M0-1, bộ công cụ `packages/trial` + `infra/trial.mjs` đã sẵn, **chưa đo**), kịch bản/diễn tập/máy dự phòng (M0-6), T6 ngoại tuyến đầy đủ (phụ thuộc T-QUOTA).
- Lỗi đã biết còn trên `main` có thể gặp khi demo: "Ký & In không in" (OFF-8 chờ duyệt) và "hàng chờ hiện 2 dòng" (PR #9 nháp).

### H.2 Trạng thái đóng gói hiện tại
- **Chỉ Medplum backend được container hoá**: `infra/medplum/docker-compose.yml` dựng `medplum-server:5.2.0` + `postgres:16` + `redis:7` (phiên bản ghim cố ý). Đây là compose "chỉ dev/thử nghiệm", README của nó liệt kê rõ các việc production chưa làm (TLS/reverse proxy, WAL/PITR, bí mật, egress, giám sát, nhiều bản server sau LB).
- **BFF và PWA CHƯA được đóng gói Docker**: hiện chạy bằng script dev (`pnpm dev:bff` với `DEMO_AUTH=1`, `pnpm dev:web` hoặc bản `preview`). Chưa có `Dockerfile` cho `services/bff` hay `apps/clinic-web`, cũng chưa có compose tổng dựng cả ba lớp (Medplum + BFF + web) trong một lệnh.
- Hệ quả: demo "phần mềm thực" hiện cần Git Bash + nhiều lệnh thủ công (`dev-up.sh`), phụ thuộc môi trường máy (Node 22, pnpm 12, Chromium). Chưa có bản chạy một lệnh, độc lập máy.

### H.3 Quyết định: Docker Compose (KHÔNG Kubernetes) cho mục tiêu demo
Khuyến nghị **dùng Docker Compose** để demo MVP, **không** dùng Kubernetes. Lý do:
- **Mục tiêu là demo trên một máy** (sân khấu nhà đầu tư, 13/11). Compose cho "một lệnh, một máy, lặp lại được"; K8s thêm cả một mặt phẳng điều khiển (cluster, ingress, manifest/Helm, image registry) không mang lại giá trị nào cho một bản demo cục bộ, lại tăng rủi ro trục trặc đúng lúc trình diễn.
- **Hạ tầng nền đã là Compose**: Medplum chính thức phát hành dưới dạng image Docker và dự án đã ghim `medplum-server:5.2.0` + Postgres 16 + Redis 7 trong Compose. Mở rộng Compose để thêm BFF + web là bước nhỏ, nhất quán.
- **K8s là mục tiêu production, không phải M0**: kế hoạch (mục 4, kiến trúc mục tiêu TL34) nêu "Kubernetes hai vùng" cho giai đoạn pilot/production (M1 trở đi), gắn với HA/DR, S3/MinIO cho `Binary` (F10), nhiều bản server sau LB. Đó là T-IAC/T-HA/T-DR/T-CAP — việc của M1/GĐ2, cần cloud trong nước (Q6: K8s SLA ≥ 99,95%). Làm K8s bây giờ là tối ưu sai cột mốc.
- **Lộ trình**: Compose cho M0 demo → khi lên pilot, chuyển sang K8s (hoặc giữ Compose trên 1 VM nếu quy mô pilot nhỏ) như một hạng mục T-IAC riêng, có kiểm thử tải (T2) và DR (T3).

### H.4 Việc cần làm để có bản demo Docker một lệnh (đang giao cho workflow)
1. `Dockerfile` cho `services/bff` (Node 22, build các workspace package phụ thuộc, chạy với `DEMO_AUTH=1`).
2. `Dockerfile` cho `apps/clinic-web` (build Vite tĩnh + nginx phục vụ PWA, giữ service worker cho phần ngoại tuyến; proxy `/api` sang BFF).
3. Một compose tổng `infra/demo/docker-compose.yml` (hoặc override) nối Medplum + Postgres + Redis + BFF + web, có thứ tự khởi động/healthcheck đúng, và bước nạp dữ liệu demo (seed) chạy một lần.
4. Tài liệu "demo bằng Docker" trong README (một lệnh để dựng, địa chỉ truy cập, cách dừng/xóa dữ liệu).
5. Giữ nguyên các bất biến an toàn (BFF là lớp duy nhất gọi Medplum; nhãn mô phỏng; không PII trong log) và các "bẫy" đã biết (service worker chỉ cache vỏ ứng dụng, KHÔNG cache `/api`).
