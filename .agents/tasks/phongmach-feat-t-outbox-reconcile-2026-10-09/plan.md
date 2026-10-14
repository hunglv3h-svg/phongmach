# Kế hoạch triển khai — T-OUTBOX (đối soát hộp thư đi idempotent theo mã đơn)

> Toàn bộ công việc nằm trong worktree `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\t-outbox-reconcile`.
> Mọi đường dẫn dưới đây tương đối với worktree đó. Dùng `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\t-outbox-reconcile"` cho mọi lệnh git.
> Nhánh: `feat/t-outbox-reconcile` (đã có, sạch, HEAD `52c0054`).

## Bối cảnh đã khảo sát (căn cứ cho thiết kế)

Mô hình dữ liệu của một đơn đã ký (xác nhận trong `packages/clinical/src/visit.ts` `planCompletion` và `packages/clinical/src/outbox.ts` `buildSendTask`):

- **Đơn đã ký** = một `List` có `code.coding = {system: SYSTEMS.task, code: 'prescription'}`, có `identifier` gồm `{system: SYSTEMS.prescriptionLocal ('urn:phongmach:ma-don-noi-bo'), value: <mã đơn>}`, thuộc một `Encounter` đã `finished`, trỏ tới các `MedicationRequest` qua `List.entry[].item`.
- **Trạng thái liên thông (send-status)** = một `Task` có `code.coding = {system: SYSTEMS.task, code: 'send-prescription'}` và `identifier` `{system: SYSTEMS.prescriptionLocal, value: <mã đơn>}` (chuỗi tìm `SEND_TASK = 'urn:phongmach:task|send-prescription'` trong `services/bff/src/medplum.ts`).
- **Khoảng trống ghi kép (A2/F11)**: tồn tại `List` đơn thuốc (đã ký) nhưng KHÔNG có `Task send-prescription` tương ứng → đơn bị kẹt, không bao giờ được xếp hàng gửi. Worker hiện tại (`dueSends`/`runOutboxOnce`) chỉ quét `Task`, nên không bao giờ thấy đơn thiếu Task.

Cơ chế idempotent có sẵn để tái dùng: `MedplumClinicStore.retry(...)` + `this.medplum.createResourceIfNoneExist(resource, 'identifier=...')`. Tạo lại `Task` theo `identifier=SYSTEMS.prescriptionLocal|<mã đơn>` ⇒ gọi lặp không sinh Task trùng (đúng yêu cầu idempotent theo mã đơn).

Bất biến phải giữ (đã đọc trong code):
- BFF là lớp DUY NHẤT gọi Medplum; web (`apps/clinic-web/src`) hiện 0 import `@medplum/*` — phải giữ 0. Web chỉ gọi `/api/...` và chỉ import *type* từ `@phongmach/clinical`.
- Tenant lấy từ phiên (`req.session!.tenant` qua `ctx.store(req)`), không từ tham số request.
- Ghi nhật ký (`ctx.record`) TRƯỚC khi trả dữ liệu (fail-closed); không PII trong log/nhật ký.
- KHÔNG đụng cơ chế `clientUuid` idempotency, gói hoàn tất chạy-lại-được, điểm chốt cuối (F11) trong `completeVisit`/`planCompletion`/`writeAll`.
- Cổng vẫn MÔ PHỎNG, giữ nguyên nhãn; không đổi hành vi gửi thật (chưa có cổng thật).

Lệnh kiểm thử của dự án (từ steering + `package.json`): `pnpm typecheck`, `pnpm test` (unit, không cần Medplum), `pnpm --filter @phongmach/bff test:integration` (cần stack Medplum thật đang chạy). Chạy từ Git Bash trên Windows. Lưu ý: đăng nhập Medplum giới hạn 5 lần/phút/IP; hạn mức FHIR ~2500 điểm/lượt. KHÔNG thử trên phòng khám demo — integration test tự tạo tenant tạm bằng `createTenantProject`.

## Thiết kế đã chọn (và lý do)

Thêm một **hàm store** `reconcilePrescriptions(now, limit)` trong `ClinicStore`/`MedplumClinicStore` cạnh các hàm outbox hiện có, và một **route BFF** `POST /api/prescriptions/reconcile` (hành động thủ công/định kỳ, trả về danh sách đã sửa). Lý do chọn hàm store thay vì nhét vào `runOutboxOnce`: (1) đối soát quét `List` (không phải `Task`) nên là một phép quét khác hẳn; (2) giữ `runOutboxOnce` thuần (chỉ gửi), dễ test; (3) route cho phép bác sĩ/chủ phòng khám chủ động "quét lại" và để màn hình hiển thị nhóm này. Worker nền tùy chọn (gọi định kỳ) để sau — M0 chỉ cần route + hiển thị; không thêm worker nền để tránh tăng tải FHIR không cần thiết cho demo.

Thuật toán `reconcilePrescriptions`:
1. Tìm các `List` đơn thuốc gần đây trong cửa sổ thời gian: `search('List', { code: 'urn:phongmach:task|prescription', _sort: '-date', _count: limit })` (cửa sổ = `limit` đơn mới nhất; đủ cho demo, tránh quét toàn bộ).
2. Lấy mã đơn của từng List (`identifier` theo `prescriptionLocal`). Tìm các `Task send-prescription` đang có cho đúng tập mã đó bằng một truy vấn: `searchResources('Task', { identifier: codes.map(c => 'urn:phongmach:ma-don-noi-bo|'+c).join(','), code: SEND_TASK, _count })`.
3. List nào có mã mà KHÔNG có Task tương ứng, VÀ Encounter của List đã `finished` (điểm chốt — chỉ đơn của lượt đã đóng mới được gửi; tái dùng điều kiện `enc.status === 'finished'` như `toJob`) → tạo lại Task bằng `buildSendTask({ listRef, patientId, localCode, now })` qua `createResourceIfNoneExist(task, 'identifier=urn:phongmach:ma-don-noi-bo|'+code)` (idempotent).
4. Trả về `{ scanned, requeued: string[] /* mã đơn */ }`.

Hiển thị (acceptance #2): đơn vừa được đối soát tái tạo Task ở trạng thái `requested` → `pendingPrescriptions` (đã quét `status: requested,on-hold,in-progress,failed`) sẽ tự hiện nó ở màn "Đơn chưa gửi được" với nhãn "Đã ký". Để màn hình chủ động phát hiện và lấp khoảng trống, thêm hành động "Quét đối soát" trên `Gateway.tsx` gọi route mới rồi reload danh sách pending. Như vậy nhóm "đã ký nhưng chưa xếp hàng" được bề mặt hóa (sau khi quét, nó thành một dòng pending bình thường).

## Các bước (theo thứ tự phụ thuộc)

- [ ] 1. Thêm phương thức `reconcilePrescriptions` vào giao diện `OutboxStore` (hoặc `ClinicStore`) và kiểu kết quả `ReconcileResult` trong `services/bff/src/store.ts`.
      Chữ ký: `reconcilePrescriptions(now: Date, limit: number): Promise<ReconcileResult>` với `interface ReconcileResult { scanned: number; requeued: string[] }` (`requeued` = danh sách mã đơn đã tái tạo Task). Đặt cạnh `dueSends/claim/complete/fail` trong `OutboxStore`, kèm chú thích tiếng Việt giải thích khoảng trống ghi kép A2.
      Files: `services/bff/src/store.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` báo lỗi "FakeStore/MedplumClinicStore thiếu reconcilePrescriptions" (chứng tỏ giao diện đã thêm) — lỗi này sẽ được giải quyết ở bước 2–3.

- [ ] 2. Cài `reconcilePrescriptions` trong `MedplumClinicStore` (`services/bff/src/medplum.ts`), đặt trong khối "hộp thư đi (outbox)" cạnh `dueSends`.
      Dùng `this.medplum.search('List', ...)` với `code` = `${SYSTEMS.task}|prescription` (thêm hằng `const PRESCRIPTION_LIST = ...` cạnh `SEND_TASK`), `_sort=-date`, `_count=limit`; đọc mã đơn qua `identifier` `SYSTEMS.prescriptionLocal`; một truy vấn `searchResources('Task', { identifier: <OR các mã>, code: SEND_TASK, _count })` để biết mã nào đã có Task; với List thiếu Task, đọc `Encounter` qua `refId(list.encounter?.reference,'Encounter')`, chỉ xử lý khi `enc.status === 'finished'`; tạo lại Task bằng `this.retry('reconcile', () => this.medplum.createResourceIfNoneExist(buildSendTask({ listRef: 'List/'+list.id, patientId, localCode: code, now }), 'identifier='+SYSTEMS.prescriptionLocal+'|'+code))`. Import `buildSendTask` từ `@phongmach/clinical`. Trả `{ scanned, requeued }`. KHÔNG đụng `completeVisit`/`writeAll`.
      Files: `services/bff/src/medplum.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` không còn lỗi ở `MedplumClinicStore` (FakeStore vẫn lỗi tới bước 3).

- [ ] 3. Cài `reconcilePrescriptions` cho `FakeStore` trong `services/bff/test/unit/helpers.ts`.
      Mô phỏng khoảng trống: FakeStore cần biểu diễn được "đơn đã ký mà Task bị thiếu". Thêm cờ trên bản ghi đơn trong FakeStore (ví dụ `gateway: undefined` nghĩa là chưa có Task / đã mất Task). `reconcilePrescriptions` duyệt các `visits` đã `done` có `result.prescription` nhưng `prescription.gateway` thiếu/null (đại diện "signed nhưng không có send-status"), đặt lại `gateway = { taskId, status: 'signed', attempts: 0 }` và đẩy mã vào `requeued`; gọi lại lần nữa không thêm trùng (vì gateway đã có). Cập nhật `pendingPrescriptions` của FakeStore để một đơn có `gateway == null` KHÔNG xuất hiện (đúng mô hình: không có Task thì không có dòng pending) — đây là nền để bước 6 chứng minh RED.
      Files: `services/bff/test/unit/helpers.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` sạch; `pnpm --filter @phongmach/bff test` biên dịch và chạy (các test cũ vẫn xanh).

- [ ] 4. Thêm action nhật ký và route `POST /api/prescriptions/reconcile`.
      Thêm `'prescription-reconcile'` vào union `AuditAction` trong `services/bff/src/audit.ts`. Trong `services/bff/src/routes/clinical.ts`, thêm route (khai báo TRƯỚC `/api/prescriptions/:id` để không bị bắt nhầm là id, cùng chỗ với `/api/prescriptions/pending`), guard `ctx.guard('prescription-reconcile', ...CLINICAL_ROLES)` (chủ phòng khám + bác sĩ), gọi `(await ctx.store(req)).reconcilePrescriptions(ctx.now(), <limit từ query, mặc định 100, max 500>)`, GHI `ctx.record(req,'prescription-reconcile',{ resultCount: result.requeued.length })` TRƯỚC khi `return result`. Thêm zod `reconcileQuery`.
      Files: `services/bff/src/audit.ts`, `services/bff/src/routes/clinical.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` sạch.

- [ ] 5. Thêm phương thức client API và nút "Quét đối soát" ở màn hình "Đơn chưa gửi được".
      Trong `apps/clinic-web/src/api.ts` thêm `reconcile: (token) => request<{ scanned: number; requeued: string[] }>('POST', '/api/prescriptions/reconcile', { token })`. Trong `apps/clinic-web/src/components/Gateway.tsx` thêm một nút (chỉ bật khi `canControl`/online) gọi `api.reconcile(token)` rồi `pending.reload()`, hiển thị kết quả ngắn ("Đã xếp hàng lại N đơn đã ký" / "Không có đơn nào bị kẹt"); giữ nguyên nhãn "CỔNG QUỐC GIA: MÔ PHỎNG". KHÔNG import `@medplum/*`; chỉ dùng *type* đã có.
      Files: `apps/clinic-web/src/api.ts`, `apps/clinic-web/src/components/Gateway.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck`; `grep -r "@medplum" apps/clinic-web/src` trả về rỗng (bất biến 0 import — kiểm nhanh, không thay cho test).

- [ ] 6. (MUTATION — BẮT BUỘC) Viết test unit cấp route cho đối soát và CHỨNG MINH ĐỎ trước.
      Trong `services/bff/test/unit` (thêm vào `app.test.ts` hoặc file mới `reconcile.test.ts`): dựng app bằng `makeApp`, đăng nhập (`login`), bơm vào FakeStore một đơn "đã ký nhưng thiếu Task" (visit `done`, `prescription` có nhưng `gateway == null`). Khẳng định: (a) TRƯỚC khi quét, `GET /api/prescriptions/pending` KHÔNG chứa đơn đó; (b) `POST /api/prescriptions/reconcile` trả `requeued` chứa mã đơn và ghi 1 dòng nhật ký `prescription-reconcile` (kiểm qua `auditEntries`), KHÔNG chứa PII (tên/thuốc/chẩn đoán); (c) SAU khi quét, `pending` chứa đơn đó ở trạng thái `signed`; (d) gọi `reconcile` lần hai: `requeued` rỗng (idempotent). Thêm test phân quyền: phụ tá (`a-assistant`) bị 403.
      **Bước quan sát ĐỎ (ghi rõ trong mô tả commit/PR):** tạm vô hiệu hóa đối soát (ví dụ cho `reconcilePrescriptions` của FakeStore `return { scanned: 0, requeued: [] }` không làm gì) và chạy test — khẳng định (b)/(c)/(d) ĐỎ. Khôi phục lại cài đặt đúng → XANH. Ghi lại trong `findings`/commit rằng đã quan sát đỏ.
      Files: `services/bff/test/unit/reconcile.test.ts` (hoặc bổ sung `app.test.ts`)
      Verify: `pnpm --filter @phongmach/bff test` — các test đối soát xanh; đã quan sát bước đỏ ở trên.

- [ ] 7. Thêm test tích hợp (Medplum thật) cho khoảng trống ghi kép.
      Trong `services/bff/test/integration/clinical.test.ts`, thêm một `describe('đối soát: đơn đã ký thiếu trạng thái gửi (A2)')`: ký một đơn mới (dùng `signNew`), rồi mô phỏng mất Task bằng cách XÓA/ẩn `Task send-prescription` của đơn đó qua `adminA` (ví dụ `adminA.deleteResource('Task', task.id)` sau khi tìm theo `identifier=urn:phongmach:ma-don-noi-bo|<code>`). Khẳng định: `GET /api/prescriptions/pending` không còn đơn đó (không có Task); gọi `POST /api/prescriptions/reconcile` (hoặc `store.reconcilePrescriptions`) → đơn quay lại `pending` trạng thái `signed`; `worker outbox()` gửi được và `pending` hết; gọi `reconcile` lần hai không tạo Task trùng (`count('Task', '&identifier=...')` vẫn = 1). Tận dụng `createTenantProject`/`adminA` có sẵn; KHÔNG chạm phòng khám demo.
      Files: `services/bff/test/integration/clinical.test.ts`
      Verify: `pnpm --filter @phongmach/bff test:integration` khi stack Medplum chạy. Nếu KHÔNG dựng được stack trong môi trường này, nói rõ "không chạy được integration ở đây" thay vì tuyên bố đã pass; vẫn phải chạy `pnpm typecheck && pnpm test`.

- [ ] 8. Cập nhật tài liệu hiện trạng và trang "Phạm vi".
      Trong `trang-thai-chuc-nang.md` (gốc worktree): đổi dòng "Outbox đối soát idempotent theo mã đơn (đầy đủ)" từ `🔧 | M1 (S2)` sang `✅ | M0` với bằng chứng file/hàm (`medplum.ts reconcilePrescriptions`, route `POST /api/prescriptions/reconcile`, `Gateway.tsx` nút quét, test đột biến). Trong `apps/clinic-web/src/components/Scope.tsx`: thêm một dòng vào mảng `REAL` nêu "bộ quét đối soát tìm đơn đã ký nhưng chưa được xếp hàng gửi và tự xếp lại (idempotent theo mã đơn)". Nếu cần, cập nhật bước kiểm trang "Phạm vi" trong `apps/clinic-web/e2e/visit.mjs` cho khớp danh sách (chỉ khi dòng mới làm e2e so khớp văn bản thất bại).
      Files: `trang-thai-chuc-nang.md`, `apps/clinic-web/src/components/Scope.tsx`, (có thể) `apps/clinic-web/e2e/visit.mjs`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` sạch.

- [ ] 9. Tái tạo `trang-thai-chuc-nang.docx` từ Markdown đã sửa.
      Chạy `python scripts/md-to-docx.py` ở gốc worktree.
      Files: `trang-thai-chuc-nang.docx` (sinh ra)
      Verify: lệnh chạy không lỗi; `git -C <worktree> status` cho thấy `.docx` thay đổi. Nếu Python/thư viện thiếu, nói rõ không chạy được thay vì bỏ qua âm thầm.

- [ ] 10. Kiểm thử toàn bộ và commit.
      Chạy `pnpm typecheck` và `pnpm test` ở gốc worktree (bắt buộc). Chạy `pnpm --filter @phongmach/bff test:integration` nếu dựng được stack (nếu không, nêu rõ). Commit với thông điệp tiếng Việt, stage theo tên file cụ thể (KHÔNG `git add -A`), KHÔNG commit secret (`infra/medplum/.env`, `services/bff/.demo-tenants.json`).
      Files: tất cả các file đã sửa ở trên.
      Verify: `pnpm typecheck && pnpm test` xanh; `git -C <worktree> status` sạch sau commit; `git -C <worktree> log --oneline -1` hiện commit mới.

## Ghi chú giả định

- Cửa sổ thời gian của đối soát hiện biểu diễn bằng "`limit` đơn mới nhất theo `List.date`" cho đơn giản và đủ cho demo M0; nếu sau này cần cửa sổ theo ngày, thêm tham số `fromDay` tương tự `finishedVisits`. Giả định này ghi rõ ở đây thay vì chặn công việc.
- Không thêm worker nền tự chạy đối soát ở M0 (tránh tăng tải FHIR cho demo). Route thủ công + nút trên màn hình đủ cho acceptance #1 và #2. Nếu người dùng muốn chạy định kỳ, có thể bọc trong một worker tương tự `startOutboxWorker` ở `server.ts` sau — ngoài phạm vi plan này.
