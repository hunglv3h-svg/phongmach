# Báo cáo độ đầy đủ GIAO DIỆN — luồng M0 PHONGMACH

Ngày: 2026-10-13 · Phạm vi: `apps/clinic-web/src` (chỉ đọc) · Không chạy stack.

> Ghi chú phương pháp: báo cáo này đọc mã nguồn giao diện và các bước e2e, KHÔNG chạy ứng dụng. Những chỗ cần xác minh lúc chạy được ghi rõ "cần kiểm khi chạy". Báo cáo không đề xuất đụng tới các bất biến (BFF-gọi-Medplum, tenant-từ-JWT), logic idempotent `clientUuid`, gói hoàn tất, hay hàng rào in `whileLocalStoreQuiet`/`printHtml`.

---

## 1. Tóm tắt nhanh (đọc trước)

Giao diện M0 **đã khá đầy đủ về trạng thái**: hầu hết màn hình lõi đều có xử lý tải / rỗng / lỗi / mất mạng, và trạng thái "cần xử lý" của ngoại tuyến được thể hiện nhất quán ở nhiều nơi (thanh trên, hàng chờ, danh sách Chờ đồng bộ, màn hình kết quả ký offline). Nhãn mô phỏng (ký số, cổng quốc gia, Zalo) có mặt đồng bộ và có một bài e2e khẳng định sự nhất quán giữa dải nhãn `DemoBanner` và trang `Scope`.

Các khoảng trống đáng chú ý nhất, theo thứ tự ảnh hưởng tới demo:

1. **Hủy lượt (`Hủy`) không có bước xác nhận** — bấm là gọi API hủy ngay. Đây là thao tác phá hủy duy nhất trong luồng lễ tân mà không có xác nhận (`Queue.tsx`). Nhỡ tay là mất lượt.
2. **Không có error boundary toàn cục** — `main.tsx` chỉ bọc `<App/>` trong `StrictMode`; một lỗi render chưa bắt sẽ cho màn hình trắng giữa buổi demo. (cần kiểm khi chạy để thấy mức độ.)
3. **Kiểm thử tablet rất mỏng** — bước tablet trong `visit.mjs` chỉ kiểm một kích thước ngang 1024×768 và chỉ khẳng định "không cuộn ngang". Không kiểm chân dung (portrait), không kiểm kích thước vùng chạm, không thao tác chạm. Bác sĩ dùng tablet thật nên đây là rủi ro ngầm.
4. **Một số nút thiếu trạng thái "đang xử lý"** — ví dụ nút `Hủy` ở hàng chờ có khóa theo `busy` (tốt), nhưng nút "Làm mới" ở Hàng chờ/Nhật ký không có phản hồi "đang tải"; nút "Cấp số" khóa khi `queuing` (tốt).

Chi tiết từng màn hình và bảng xếp hạng ở cuối.

---

## 2. Bằng chứng theo từng màn hình / thành phần

Ký hiệu trạng thái: **Tải** = loading, **Rỗng** = empty, **Lỗi** = API 4xx/5xx + mất mạng, **Cần xử lý** = trạng thái attention của ngoại tuyến. ✅ có · ⚠️ một phần · ❌ không có · n/a không áp dụng.

### 2.1. Khung ứng dụng — `App.tsx`, `components/Shell.tsx`, `main.tsx`
- **Làm gì**: `App` quản lý phiên (load/save `sessionStorage`), xử lý 401 (về đăng nhập, giữ dữ liệu máy — OFF-6), đăng xuất có/không giữ dữ liệu. `Shell` là khung điều hướng (tab Tiếp đón / Hàng chờ / Khám / Màn hình chờ / Liên thông / Thời gian khám / Nhật ký / Phạm vi), thanh đồng bộ, hộp thoại đăng xuất khi còn mục chưa đồng bộ.
- Tải: ✅ `App` hiện "Đang mở dữ liệu trên máy…" khi `store` chưa sẵn.
- Lỗi: ⚠️ `logout` có fallback khi `destroy()` lỗi (đặt `notice`). Nhưng **không có error boundary** cho lỗi render (`main.tsx`): lỗi chưa bắt → màn trắng. (cần kiểm khi chạy)
- Cần xử lý: ✅ Hộp thoại đăng xuất (`role="alertdialog"`, `data-testid="logout-dialog"`) khi `pendingCount() > 0`, hai lựa chọn "Chờ đồng bộ" / "Đăng xuất, giữ dữ liệu".
- Khoảng trống: thiếu error boundary toàn cục; `saveAuth` nuốt lỗi `sessionStorage` im lặng (chấp nhận được cho M0).

### 2.2. Đăng nhập — `components/Login.tsx`
- **Làm gì**: chọn phòng khám + người dùng demo (chưa có mật khẩu — nhãn rõ ràng). Hiện số mục chưa đồng bộ còn trên máy theo từng nhân viên (OFF-6), và thông báo phiên hết hạn.
- Tải: ✅ "Đang tải…" khi chưa có `tenants`.
- Rỗng: ⚠️ nếu `demoUsers()` trả danh sách rỗng thì không có thông điệp riêng (chỉ không hiện thẻ nào). Ít khả năng xảy ra ở demo.
- Lỗi: ✅ `error` khi `demoUsers()` hoặc `login()` lỗi (`role="alert"`). `pendingOnDevice()` lỗi → đặt `[]`, không chặn đăng nhập.
- Cần xử lý: ✅ nhãn "Máy này còn N mục chưa đồng bộ của …" và câu phiên hết hạn (`expiredText`).
- Khoảng trống: nhỏ.

### 2.3. Tiếp đón / Tìm bệnh nhân — `components/Reception.tsx`, `components/PatientDetail.tsx`, `components/PatientForm.tsx`
- **Làm gì**: tìm theo tên không dấu / SĐT / 4 số cuối / CCCD (debounce 150ms, bỏ kết quả cũ), gợi ý ý định tìm, chọn bằng bàn phím/chuột; mở chi tiết; tạo bệnh nhân mới; cấp số vào hàng chờ; bổ sung CCCD/ngày sinh; quản lý dị ứng.
- Tải: ✅ "Đang tìm…" (search status). `PatientDetail` tải tóm tắt + dị ứng (không có spinner riêng nhưng dùng dữ liệu máy làm nền).
- Rỗng: ✅ "Không có bệnh nhân khớp." + nút "+ Thêm bệnh nhân mới".
- Lỗi: ✅ `search.status === 'error'` hiện lỗi trong `search-status`; `ApiError status 0` (mất mạng) tự chuyển sang tìm trong bộ đệm máy (`searchLocal`). `PatientDetail`/`PatientForm` có `error` (`role="alert"`). Form kiểm hợp lệ cục bộ bằng `buildPatient` trước khi gửi.
- Cần xử lý: ✅ "Mất mạng: chỉ tìm trong N hồ sơ trên máy này"; nhãn "chưa đồng bộ" cho hồ sơ tạo offline (`result-unsynced`); `from-cache` ở chi tiết; cảnh báo "Máy chưa có dữ liệu dị ứng…".
- Chống trùng khi bấm: ✅ `PatientForm` và `checkIn` dùng một `clientUuid`/`useRef` cho mỗi lần mở form/lần cấp số; nút khóa theo `busy`/`queuing`.
- Khoảng trống: **nút "Cấp số" (`check-in`) không bị khóa theo mạng/offline rõ ràng** — hoạt động qua hàng đợi máy nên vẫn cho cấp số tạm (đúng thiết kế OFF-2), nhưng không có nhãn trực tiếp trên nút rằng số sẽ là "tạm" cho tới khi notice hiện ra. (cần kiểm khi chạy để xem có gây nhầm không.)

### 2.4. Hàng chờ — `components/Queue.tsx`
- **Làm gì**: gộp hàng chờ máy chủ (poll 5s) với thao tác chưa đồng bộ trên máy; phân nhóm Đang khám / Đang chờ / Đã xong-hủy; gọi vào khám / tiếp tục khám / hủy; hiện số tạm, "cần xử lý", đổi số.
- Tải: ✅ "Đang tải…" khi `!merged && !server.error`.
- Rỗng: ✅ "Chưa có ai trong hàng chờ…".
- Lỗi: ✅ gộp `error` cục bộ và `server.error` (`role="alert"`); `usePoll` giữ dữ liệu cũ khi lỗi mạng.
- Cần xử lý: ✅ badge "Chờ đồng bộ" / "Cần xử lý" theo `local.pending`/`local.attention`; thông báo đổi số (`renumbered`); nhãn offline "hàng chờ theo dữ liệu trên máy này".
- Phản hồi khi bấm: ✅ nút gọi/tiếp tục khóa theo `busy`; "Tiếp tục khám" khóa nếu không phải bác sĩ đang giữ (có `title`).
- **Khoảng trống chính (chặn-demo nhẹ)**: **nút `Hủy` không có xác nhận** — `onClick={() => void act(i.id, async () => api.cancelVisit(...))}` gọi hủy ngay. Thao tác phá hủy nên có hộp thoại "Hủy lượt của <tên> số <N>?". Hiện chỉ khóa theo mạng và số tạm, không có bước xác nhận.
- Khoảng trống nhỏ: nút "Làm mới" không có trạng thái đang tải.

### 2.5. Màn hình chờ (TV) — `components/Display.tsx`
- **Làm gì**: bảng cho phòng chờ, chỉ số thứ tự + chữ cái đầu (không PII); poll 3s; dựng từ dữ liệu máy khi mất mạng hoặc có số tạm; nút Toàn màn hình.
- Tải: ⚠️ không có "Đang tải…" tường minh; lưới trống cho tới khi có `data` (chấp nhận được cho màn hình TV).
- Rỗng: ✅ "Không có ai đang chờ" / "—" cho khu "Mời vào khám".
- Lỗi: ✅ "Mất kết nối, đang thử lại… (lý do)" (`role="alert"`); nhãn offline.
- Cần xử lý: ✅ nhãn "tạm" cho số cấp offline; nhãn "theo dữ liệu trên máy này".
- Khoảng trống: `requestFullscreen` không bắt lỗi (một số trình duyệt chặn) — nhỏ. (cần kiểm khi chạy)

### 2.6. Khám một trang — `visit/Visit.tsx` (+ `ExamForm`, `PatientSide`, `PrescriptionEditor`, `RulesPanel`, `draft`)
- **Làm gì**: ba cột (hồ sơ / khám / kê đơn); đồng hồ phiên; đọc & lưu bản nháp mã hóa; đánh giá quy tắc client; ký & in hoặc kết thúc không kê đơn.
- Tải: ✅ "Đang mở bản nháp…" (giai đoạn `Visit` trước khi dựng `VisitEditor`).
- Rỗng: ✅ ExamForm nhắc "Chưa chọn chẩn đoán…"; PrescriptionEditor "Chưa có thuốc…"; PatientSide "Chưa ghi nhận"/"Lần đầu đến khám".
- Lỗi: ✅ `sign-error` (`role="alert"`) cho lỗi ký/mạng và cho 422 server rules; `loadError` khi không đọc được bản nháp; trạng thái lưu nháp (`draft-saved` với `saveError`).
- Cần xử lý / offline: ✅ nhãn "Mở khi mất mạng…"; cảnh báo dị ứng chưa biết (`allergy-unknown` qua `allergiesKnown`); "CCCD chưa tải về máy" vs "chưa có CCCD" phân biệt rõ.
- Phản hồi khi bấm: ✅ nút Ký/Kết thúc hiện "Đang lưu…" khi `saving`; `blockedBy` liệt kê lý do chưa ký được (`sign-blocked`).
- Nhãn mô phỏng: ✅ dòng cố định dưới nút ký: "Chữ ký số là **mô phỏng** … cổng quốc gia **mô phỏng**".
- Khoảng trống: khi `store.persistent === false` (trình duyệt chặn lưu) có nhãn cảnh báo nháp chỉ ở tab này — tốt; không có khoảng trống đáng kể.

### 2.7. Kê đơn & cảnh báo — `visit/PrescriptionEditor.tsx`, `visit/RulesPanel.tsx`
- **Làm gì**: đơn mẫu, gõ thêm thuốc, số lượng tự tính / nhập tay, cảnh báo theo dòng; `RulesPanel` phân biệt "Không thể ký" (block) vs "Cần xác nhận" (ack, phải nhập lý do ≥ `MIN_ACK_REASON_LENGTH`).
- Tải/Rỗng/Lỗi: n/a (hàm thuần, không gọi mạng); rỗng có nhắc.
- Cần xử lý: ✅ cảnh báo không có lối tắt "bỏ qua tất cả" (cố ý); lý do xác nhận lưu cùng đơn.
- Khoảng trống: không đáng kể. (e2e `visit.mjs` kiểm đủ: dị ứng, trùng hoạt chất, lý do quá ngắn.)

### 2.8. Kết quả ký (online) — `visit/SignResult.tsx`
- **Làm gì**: mã đơn, nhãn ký số MÔ PHỎNG, trạng thái liên thông tự cập nhật (poll 2s), thời gian phiên khám, in lại (kể cả offline), nút Zalo.
- Tải: ⚠️ không có spinner cho poll liên thông (giữ trạng thái "đã biết" — hợp lý).
- Lỗi: ✅ `printErr` (`role="alert"`); nhãn "đã in từ dữ liệu trên máy".
- Cần xử lý/offline: ✅ không hỏi cổng khi mất mạng, giữ trạng thái cuối.
- Nhãn mô phỏng: ✅ badge "chữ ký số MÔ PHỎNG", "cổng mô phỏng", Zalo "MÔ PHỎNG".

### 2.9. Kết quả ký khi mất mạng — `visit/OfflineSignResult.tsx`
- **Làm gì**: theo dõi mục hoàn tất trong hàng đợi (pending → done / conflict / rules / error / held), in lại từ dữ liệu máy, cảnh báo lệch mã đơn qua nửa đêm.
- Trạng thái: ✅ phủ đủ 6 trạng thái đồng bộ với badge màu; mỗi trạng thái lỗi có `role="alert"` và hướng dẫn ("Mở 'Chờ đồng bộ'…").
- Cần xử lý: ✅ đây là nơi thể hiện "cần xử lý" rõ nhất ở luồng khám; có bài e2e riêng `offline-sign.mjs`, `offline-conflict.mjs`.
- Nhãn mô phỏng: ✅ badge "chữ ký số MÔ PHỎNG" + "chưa liên thông".

### 2.10. Zalo (mô phỏng) — `visit/ZaloPreview.tsx`
- **Làm gì**: nút "Gửi đơn qua Zalo" chỉ mở bản xem trước; không gọi mạng, không PII thuốc/chẩn đoán.
- Nhãn mô phỏng: ✅ nút có badge "MÔ PHỎNG"; hộp thoại có nhãn `ZALO_SIMULATED_LABEL` = "MÔ PHỎNG: không có tin nhắn nào được gửi"; `visit.mjs` khẳng định không phát sinh yêu cầu mạng và không lộ số giữa SĐT.
- Khoảng trống: không. Đây là ví dụ mẫu về "trình diễn trung thực".

### 2.11. Liên thông cổng — `components/Gateway.tsx`
- **Làm gì**: hộp thư đi (poll 2s), bảng điều khiển cổng mô phỏng (up/down/lỗi 2 lần), gửi lại thủ công, ETA thử lại.
- Tải: ⚠️ không có "Đang tải…" tường minh (bảng trống tới khi có data).
- Rỗng: ✅ "Không có đơn nào đang chờ: tất cả đã gửi." (`pending-empty`).
- Lỗi: ✅ `error`/`pending.error` (`role="alert"`); nhãn offline; `simGet` nuốt 404 (cổng không mô phỏng).
- Cần xử lý/offline: ✅ nút điều khiển và "Gửi lại ngay" khóa khi offline/không phải vai trò điều khiển (`canControl`), có `title` giải thích.
- Nhãn mô phỏng: ✅ "CỔNG QUỐC GIA: MÔ PHỎNG" + "Chưa gửi gì ra ngoài".

### 2.12. Thời gian khám — `components/Metrics.tsx`
- **Làm gì**: bảng p50/p90 theo bác sĩ so mục tiêu 60/120s; chọn khoảng; cột loại trừ, đo-ở-máy-khách, giờ không hợp lý.
- Tải: ⚠️ không có "Đang tải…" (dựa `usePoll`, bảng xuất hiện khi có data).
- Rỗng: ✅ "Chưa có lượt khám nào trong khoảng này."
- Lỗi: ✅ `m.error` khi online (`role="alert"`); nhãn offline "cần mạng".
- Cần xử lý: n/a (dữ liệu máy chủ).
- Bảng có `table-wrap` cuộn ngang có `role="region"`/`tabIndex` (tốt cho tablet).

### 2.13. Nhật ký truy cập — `components/AuditLog.tsx`
- **Làm gì**: 50 dòng gần nhất, mô tả hành động không PII.
- Tải: ✅ "Đang tải…" khi `!entries && online`.
- Rỗng: ⚠️ nếu `entries` là mảng rỗng, bảng hiện nhưng không có dòng "chưa có nhật ký" (hiếm — luôn có dòng đăng nhập). (cần kiểm khi chạy)
- Lỗi: ✅ `error` (`role="alert"`); nhãn offline.
- `table-wrap` cuộn ngang có `role="region"` (tốt cho tablet).

### 2.14. Phạm vi — `components/Scope.tsx` & Dải nhãn — `components/DemoBanner.tsx`
- **Làm gì**: ba khối Đã làm thật / Mô phỏng / Chưa làm; dải nhãn cố định trên đầu mọi màn hình.
- Nhãn mô phỏng: ✅ **nhất quán và được e2e khẳng định mạnh** — `visit.mjs` kiểm từng mục nằm đúng khối, và kiểm dải nhãn `DemoBanner` khớp với `Scope` (Zalo cùng nhóm "mô phỏng", ngoại tuyến ở "đã làm thật", v.v.). Đây là biện pháp an toàn "trình diễn trung thực" được kiểm thử.
- Khoảng trống: không.

### 2.15. Thành phần đồng bộ — `components/SyncBar.tsx`, `components/SyncPanel.tsx` (+ `local/syncList.ts`)
- **Làm gì**: `SyncBar` chỉ báo mạng/đang gửi/số chờ/số cần xử lý/hết phiên; `SyncPanel` danh sách Chờ đồng bộ với trạng thái từng mục, xác nhận lại 422, in lại; `SyncNotices` thông báo không âm thầm (tắt từng cái).
- Cần xử lý: ✅✅ đây là trung tâm của trạng thái "cần xử lý": badge "N cần xử lý" ở thanh trên (không tắt được ngoài việc xử lý xong — N3), các dòng conflict/rules/error có `role="alert"`, nút "Xác nhận và gửi lại" khi hợp lệ, hoặc câu "không gửi lại được bằng xác nhận" khi block.
- **Theo chủ đích thiết kế (KHÔNG phải khoảng trống)**: KHÔNG có nút xóa/bỏ/hủy mục chưa đồng bộ (đã chốt M0 — mục chỉ rời danh sách khi máy chủ nhận). Vậy câu hỏi của chủ dự án "không có nút để xử lý mục offline bị kẹt" cần hiểu lại: **có** nút xử lý (Đồng bộ ngay / Thử kết nối lại / Xác nhận và gửi lại / In lại) nhưng **cố ý không có** nút bỏ mục. Một mục "error" thuần (không phải 422 rules, không phải conflict) chỉ có thể chờ gửi lại tự động — xem khoảng trống bên dưới.
- Khoảng trống (nên-có): với mục trạng thái **`error`** (lỗi máy chủ không phải rules/conflict), `SyncPanel` chỉ hiện thông điệp lỗi, **không có nút "Thử gửi lại mục này ngay"** riêng; người dùng phải bấm "Đồng bộ ngay" chung. (cần kiểm khi chạy xem cơ chế auto-retry có đủ không.)

### 2.16. Thành phần phụ — `components/Typeahead.tsx`, `components/Allergies.tsx`
- `Typeahead`: ✅ tìm trong danh mục local, chọn bàn phím/chuột, có `role="combobox"/"listbox"`. Không có trạng thái lỗi vì không gọi mạng.
- `Allergies`: ✅ Tải/Rỗng/Lỗi/offline (`locked`), trạng thái "chưa biết dị ứng" (`unknown`); nút xóa khóa khi offline có `title`.

---

## 3. Responsive / tablet — mức kiểm thực tế

**CSS (`styles.css`) có breakpoint khá đầy đủ:**
- `.reception` 1 cột ≤ 760px; `.row` 1 cột ≤ 520px; `.rx-tools` 1 cột ≤ 520px.
- `.visit` 3→2 cột ở ≤ 1080px và ở 1024–1439px (vì cột trái cố định 248px), 1 cột ≤ 720px.
- `.queue-row` xếp lại ≤ 700px.
- Điều hướng: cột trái ≥ 1024px; thanh tab đáy + menu "Thêm" ≤ 759px.
- `.search-input { min-height: 56px }` — vùng chạm lớn (tốt cho tablet).
- Dải nhãn mô phỏng cố ý KHÔNG ẩn ở ≤ 759px (giữ bất biến #2) — có ghi chú trong CSS.

**Bước e2e tablet trong `visit.mjs` (dòng ~423) kiểm RẤT ÍT:**
```
await page.setViewportSize({ width: 1024, height: 768 });   // chỉ MỘT kích thước, nằm NGANG
… openPatient → checkIn → callPatient …
const overflow = scrollWidth > clientWidth;
assert.equal(overflow, false, 'không cuộn ngang ở 1024×768');  // chỉ khẳng định DUY NHẤT điều này
await shot('19-visit-tablet-landscape');
```
Nghĩa là bước tablet **chỉ chứng minh màn hình khám không bị cuộn ngang ở 1024×768 ngang**. Nó KHÔNG kiểm:
- Chân dung (portrait, ví dụ 768×1024 hay 820×1180) — bố cục dọc chưa có bài kiểm nào.
- Kích thước/khoảng cách vùng chạm (tap target) theo WCAG/khuyến nghị tablet.
- Thao tác bằng chạm (tap, không có hover) — logic `onMouseMove` trong `Typeahead`/`Reception` dựa vào di chuyển con trỏ; **trên màn hình cảm ứng không có `mousemove`**, cần kiểm khi chạy xem chọn gợi ý bằng chạm có mượt không.
- Các màn hình khác ở tablet (Hàng chờ, Liên thông, Nhật ký, Màn hình chờ) — chỉ màn khám được chụp ở 1024×768.

Kết luận: khung CSS responsive đã đặt nền tốt, nhưng **bằng chứng kiểm thử tablet mỏng**; không thể khẳng định hành vi chạm/portrait nếu không chạy thử trên thiết bị.

---

## 4. Khoảng trống UX tổng hợp (đối chiếu câu hỏi của chủ dự án)

| Câu hỏi | Phát hiện |
|---|---|
| Thiếu phản hồi khi bấm? | Phần lớn nút có khóa `busy`/`saving`/`queuing`. Thiếu phản hồi ở: nút "Làm mới" (Hàng chờ, Nhật ký) không có trạng thái tải; một số màn thiếu "Đang tải…" tường minh (Màn hình chờ, Liên thông, Metrics) nhưng giữ dữ liệu cũ. |
| Thiếu xác nhận thao tác phá hủy? | **Có khoảng trống rõ: nút `Hủy` lượt ở Hàng chờ gọi API ngay, không xác nhận.** (Đăng xuất khi còn mục chưa đồng bộ thì có hộp thoại.) |
| Không có nút xử lý mục offline bị kẹt? | Có đủ nút cho conflict/rules/retry/in-lại; **cố ý** không có nút bỏ mục (chốt M0). Riêng mục `error` thuần thiếu nút gửi-lại-mục-này. |
| Nhãn mô phỏng nhất quán? | ✅ Nhất quán và được e2e khẳng định (DemoBanner ↔ Scope ↔ nhãn trên từng nút ký/cổng/Zalo). Không có khoảng trống. |
| Error boundary? | ❌ Không có — rủi ro màn trắng khi demo. |

---

## 5. Bảng xếp hạng khoảng trống theo mức độ + ước lượng công sức

Ước lượng: S ≈ ≤ 2 giờ · M ≈ nửa ngày đến 1 ngày · L ≈ nhiều ngày. Chỉ là ước lượng đọc-mã, chưa tính kiểm thử mutation bắt buộc (xem ghi chú).

| # | Khoảng trống | Mức | Công sức | Ghi chú |
|---|---|---|---|---|
| 1 | **Xác nhận khi "Hủy" lượt** ở Hàng chờ (hộp thoại "Hủy lượt của <tên> số <N>?") | chặn-demo | S | Có sẵn mẫu `role="alertdialog"` trong `Shell` (hộp thoại đăng xuất) để tái dùng. |
| 2 | **Error boundary toàn cục** trong `main.tsx` (màn hình lỗi thân thiện + nút tải lại) | chặn-demo | S | Tránh màn trắng giữa buổi trình diễn. cần kiểm khi chạy để xác định điểm dễ vỡ. |
| 3 | **Kiểm thử tablet đầy đủ hơn**: thêm viewport portrait + ít nhất Hàng chờ/Liên thông; kiểm thao tác chạm cho `Typeahead` (không có hover) | nên-có | M | Bác sĩ dùng tablet thật; hiện chỉ 1 kích thước ngang. Logic `onMouseMove` cần kiểm khi chạy bằng chạm. |
| 4 | **Trạng thái "đang xử lý" cho nút "Làm mới"** (Hàng chờ, Nhật ký) và "Đang tải…" tường minh cho Metrics/Liên thông/Màn hình chờ | nên-có | S | Hiện giữ dữ liệu cũ, không sai nhưng thiếu phản hồi tức thì. |
| 5 | **Nút "Thử gửi lại mục này" cho mục trạng thái `error`** trong `SyncPanel` (hiện chỉ có "Đồng bộ ngay" chung) | nên-có | S–M | Không đụng logic hàng đợi/idempotent; chỉ gọi lại cơ chế gửi sẵn có. Cần kiểm khi chạy xem auto-retry đã đủ chưa. |
| 6 | **Thông điệp rỗng cho Nhật ký khi 0 dòng** và cho Đăng nhập khi 0 tenant | để-sau | S | Hiếm xảy ra ở demo. |
| 7 | **Bắt lỗi `requestFullscreen`** ở Màn hình chờ (một số trình duyệt từ chối) | để-sau | S | Nhỏ, chỉ ảnh hưởng nút Toàn màn hình. |
| 8 | **Nhãn trực tiếp trên nút "Cấp số" khi offline** (số sẽ là "tạm") | để-sau | S | Đã có notice sau khi bấm; nhãn trước khi bấm giúp rõ hơn. cần kiểm khi chạy mức nhầm lẫn. |

Ghi chú văn hóa kiểm thử (từ steering): mỗi biện pháp an toàn mới (đặc biệt #1 xác nhận hủy, #2 error boundary) nên có bài test được chứng minh ĐỎ khi gỡ biện pháp. Điều này làm công sức thực tế của #1/#2 nhỉnh hơn ước lượng S một chút.

---

## 6. Kết luận

Giao diện M0 đã đạt mức đầy đủ trạng thái tốt: tải/rỗng/lỗi/mất mạng/cần-xử-lý được xử lý ở hầu hết màn hình, và "trình diễn trung thực" (nhãn mô phỏng) được bảo vệ bằng e2e. Hai việc nên làm trước khi coi là "đủ giao diện cho demo" là **xác nhận khi hủy lượt** và **error boundary toàn cục** — cả hai đều nhỏ và không chạm bất biến an toàn. Việc nên-có lớn nhất là **mở rộng kiểm thử tablet** (portrait + thao tác chạm), vì đây là chỗ hiện chỉ có một phép kiểm "không cuộn ngang" và không thể khẳng định hành vi chạm nếu không chạy thử.

Mọi nhận định về hành vi lúc chạy (màn trắng khi lỗi render, thao tác chạm trên tablet, auto-retry mục `error`, nút Toàn màn hình) đều được đánh dấu "cần kiểm khi chạy" vì báo cáo này chỉ đọc mã, không chạy stack.
