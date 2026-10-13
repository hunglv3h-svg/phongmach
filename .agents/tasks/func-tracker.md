# Báo cáo: xác minh sâu tracker chức năng + chuyển ra gốc + script .docx + hook

Nhánh: `docs/func-tracker-verify` · base commit `1d2eb63349659a2123b19e81b5667c35c8be3fdd` · ngày 2026-10-13.

Vòng đầu (không có `review.json`). Làm đủ 4 việc. Chỉ chạm các file cho phép, `git add` theo tên.

## Việc orchestrator cần làm (QUAN TRỌNG)

- **Đóng PR #23** (nhánh `docs/trang-thai-chuc-nang`, bản tracker cũ ở `docs/trang-thai-chuc-nang.md`).
  Nhánh này đã `git mv docs/trang-thai-chuc-nang.md trang-thai-chuc-nang.md` nên khi merge nhánh
  `docs/func-tracker-verify` thì bản cũ ở `docs/` tự biến mất. PR #23 vẫn phải đóng thủ công để
  không merge trùng (hai nhánh cùng đụng file đó).

## Việc 1 — Xác minh sâu (đọc code, không tin tài liệu)

Đã đọc trực tiếp mã nguồn tại base commit để kiểm từng ô. Bất biến "web không import `@medplum/*`"
đã kiểm: 0 import trong `apps/clinic-web/src` (grep). Lời gọi Medplum thật chỉ ở
`services/bff/src/medplum.ts`; `@phongmach/{clinical,fhir-vn-model}` chỉ import *kiểu* FHIR.

### Ô đổi trạng thái (trước → sau + bằng chứng code)

| Dòng | Trước | Sau | Bằng chứng |
|---|---|---|---|
| "Báo còn người trùng tên khi >20" | ⬜ / M1 | ✅ / M0 | `components/Reception.tsx`: hằng `MORE_HINT='còn người trùng tên...'`, `showMoreHint` dựa trên `search.hasMore`; BFF `medplum.ts` `searchPatients` trả `hasMore` từ `count()` |
| "Gõ lẫn tên và số trong một lần tìm" | ⬜ / M1 | ✅ / M0 | `packages/fhir-vn-model/src/search.ts` `classifyQuery` có nhánh `name+number`; `medplum.ts` `searchPatients` case `name+number` (AND tên + đuôi số); UI `Reception.tsx`/`startNew` xử lý `name+number`. Ghi chú ke-hoach dòng 186 "chưa gõ lẫn" là cũ |
| "Xác thực nhân viên thật (đăng nhập, MFA)" | ⬜ / M1 | ⬜ / M1 (giữ, bổ sung ghi chú) | Giữ ⬜ vì tiêu đề là xác thực THẬT (chưa có). Ghi chú thêm: đăng nhập demo không mật khẩu ở `components/Login.tsx`, có nhãn ở `Scope.tsx` nhóm mô phỏng; `DEMO_AUTH=1` |

Ghi chú: đã **tạm nâng** 2 dòng tìm bệnh nhân vì có bằng chứng code rõ ràng và trùng với nhãn trang
"Phạm vi" (REAL liệt kê cả hai). Nếu reviewer muốn giữ nguyên vì chưa đo tốc độ ở M0-3 thì chỉ cần
hạ lại ký hiệu — bằng chứng code đã ghi ở cột Ghi chú.

### Dòng mới thêm (chức năng có trong code mà bảng chưa liệt kê)

| Nhóm | Dòng mới | Bằng chứng |
|---|---|---|
| 1. Tiếp đón & hàng chờ | "Hủy lượt chờ (chỉ khi đang chờ)" ✅ | `medplum.ts` `cancelVisit` (chặn nếu status ≠ `arrived`); `components/Queue.tsx` |
| 9. Hạ tầng & vận hành | "Ghi nhiều bản ghi chạy lại được (idempotent, chốt cuối) + chịu xung đột giao dịch" ✅ | `medplum.ts` `completeVisit`/`writeAll` kiểm `failedEntries` từng mục dù HTTP 200, chốt đóng lượt khám cuối (F11); `conflict.ts` `retryOnConflict` cho mã 40001 (commit `05af7cb`) |

### Ô giữ nguyên trạng thái nhưng siết lại cột Ghi chú (trỏ đúng file/hàm đã đọc)

Toàn bộ các ô ✅/🟡/🔧 còn lại được đối chiếu code và cập nhật cột Ghi chú để trỏ chính xác:
- Tìm bệnh nhân → `medplum.ts searchPatients` (5 nhánh), `fhir-vn-model search.ts classifyQuery`.
- Cấp số / hàng chờ / màn hình chờ → `packages/clinical/src/queue.ts` (`nextNumber`, `buildCheckIn`, `sortQueue`, `toDisplayBoard`, `initialsOf`).
- Khám → `visit/{Visit,ExamForm,PatientSide}.tsx`, `clinical/vitals.ts`, `routes/clinical.ts completeBody`.
- ICD-10 → `catalogs/src/icd10.ts` (tập con **có nhãn minh họa** trong chính file).
- Dị ứng/tiền sử → `clinical/notes.ts` (`buildAllergy`/`buildHistoryItem`/`withdraw*`).
- Đo thời gian → `clinical/clientTime.ts measureVisit`, `time.ts percentile`, `medplum.ts finishedVisits`.
- Đơn mẫu → `catalogs/src/templates.ts` (13 mẫu). Quy tắc → `rules/src/check.ts` (`duplicate-ingredient`, `allergy`, `max-days` 30/90, `no-cccd`, `cccd-unknown`, `allergy-unknown`; `judge` buộc lý do ≥5 ký tự).
- In A5 → `print/src/prescription.ts renderPrescriptionHtml` (QR SVG, CSP `default-src 'none'`, `esc` thoát HTML).
- Cổng → `gateway.ts` (`SimulatedGateway`: `mode up/down`, `failNext`, mã `SIM-`, idempotent theo `localCode`), outbox `dueSends/claim/complete/fail`, `components/Gateway.tsx`.
- Ngoại tuyến → `local/crypto.ts` (AES-GCM-256, `extractable:false`, IV mới mỗi lần, AAD), `local/store.ts` (`whileLocalStoreQuiet`), `local/sync.ts` (`SyncEngine`), `local/deps.ts` (`needsAttention`: conflict/rules/error → held), `local/OfflineProvider.tsx` (thăm dò `api.health`), `visit/OfflineSignResult.tsx`.
- Zalo → `clinical/zalo.ts zaloPrescriptionMessage` (không có thuốc/chẩn đoán), `visit/ZaloPreview.tsx` (`ZALO_SIMULATED_LABEL`).
- Tenant/nhật ký → `session.ts` (tenant từ JWT đã ký), `audit.ts` (`NdjsonAuditSink`, `h.sync()`, `AuditEntry` không PII), `routes/context.ts` (ghi trước khi trả), `components/{AuditLog,Scope,DemoBanner}.tsx`.

Nhãn mô phỏng khớp màn hình: `Scope.tsx` (REAL/SIMULATED/MISSING), `DemoBanner.tsx`, `print` `.sim`.

## Việc 2 — Chuyển ra gốc

`git mv docs/trang-thai-chuc-nang.md trang-thai-chuc-nang.md` (file gốc đang ở nhánh
`origin/docs/trang-thai-chuc-nang`; đã `git checkout` vào nhánh này rồi `git mv`, giữ lịch sử).
Không còn bản ở `docs/`. Tham chiếu nội bộ trỏ `docs/ke-hoach-trien-khai.md` vẫn đúng.

## Việc 3 — Script sinh .docx

`scripts/md-to-docx.py` (python-docx 1.2.0, không pandoc/libreoffice). Đọc `trang-thai-chuc-nang.md`
ở gốc, sinh `trang-thai-chuc-nang.docx` cùng chỗ. Hỗ trợ heading `#/##/###`, bảng markdown → Word
'Table Grid' có kẻ khung, đoạn văn, danh sách, trích dẫn; font Calibri (tiếng Việt + ký hiệu Unicode).
README ở `scripts/README.md`.

### Lệnh đã chạy + kết quả

```
$ python scripts/md-to-docx.py
Đã sinh ...\trang-thai-chuc-nang.docx       (exit 0, không lỗi)
```

Mở lại .docx bằng python-docx để kiểm:

```
tables = 11
paragraphs = 31
total table rows = 79
header: ['Chức năng', 'Trạng thái', 'Mốc', 'Ghi chú / nguồn']
cell[1][0]: Tìm bệnh nhân: SĐT, 4 số cuối, CCCD, tên không dấu   (dấu tiếng Việt OK)
cell[1][1]: '✅'                                                   (ký hiệu OK)
✅ count = 32 · 🟡 count = 4 · 🔧 count = 6 · ⬜ count = 30
has "Xác minh sâu": True · has heading "Tiếp đón": True
```

→ table count > 0, số đoạn > 0, ô có dấu tiếng Việt và ký hiệu không lỗi.

## Việc 4 — Hook nhắc cập nhật tăng dần

`.kiro/hooks/nhac-cap-nhat-trang-thai-chuc-nang.json` (schema `{version:v1, hooks:[{name,trigger,matcher,action}]}`).
- `trigger: PostFileSave`.
- `matcher`: `(apps/clinic-web/src/|services/bff/src/|packages/[^/]+/src/).*\.(ts|tsx)$`.
- `action.type: agent` (chèn lời nhắc vào ngữ cảnh, KHÔNG chạy lệnh, KHÔNG chặn).
- Prompt: khi đổi file code chức năng → nếu đổi trạng thái một chức năng thì **chỉ sửa dòng liên quan**
  trong `trang-thai-chuc-nang.md` dựa trên tracker lần trước (incremental — KHÔNG đọc lại toàn bộ code),
  rồi chạy `python scripts/md-to-docx.py`; refactor/sửa lỗi không đổi trạng thái thì bỏ qua.

**Vì sao incremental:** theo yêu cầu chủ dự án (tin nhắn 12.2) — đọc toàn bộ code chỉ làm một lần
(vòng xác minh sâu này); các lần sau dựa trên trạng thái tracker đã ghi để tiết kiệm thời gian.

### Kiểm hook

```
JSON hợp lệ; keys = [action, matcher, name, trigger]; trigger=PostFileSave; action.type=agent
regex khớp: apps/clinic-web/src/visit/Visit.tsx, services/bff/src/medplum.ts, packages/rules/src/check.ts
regex KHÔNG khớp: docs/x.md, packages/rules/dist/x.ts
```

## git status sau khi stage (chỉ các file cho phép)

Đã `git add` theo tên: `trang-thai-chuc-nang.md` (rename từ `docs/...`), `trang-thai-chuc-nang.docx`,
`scripts/md-to-docx.py`, `scripts/README.md`, `.kiro/hooks/nhac-cap-nhat-trang-thai-chuc-nang.json`,
`.agents/tasks/func-tracker.md`. Không `git add -A`. Không chạm mã sản phẩm. Không commit bí mật.
(Kết quả `git status`/commit/push ghi ở tin nhắn cuối sau khi chạy.)
