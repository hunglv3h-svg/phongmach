# Bộ prompt theo phiên làm việc — PHONGMACH

Sổ theo dõi các phiên làm việc với agent (Claude Code trước đây, Kiro từ nay). Mỗi mục là một phiên: mục tiêu, prompt đã dùng (hoặc sẽ dùng), và trạng thái. Dùng để kiểm tra tiến độ nhanh mà không phải lần giở git log.

**Quy ước trạng thái:** ✅ Đã chạy & merge · 🔧 Đang làm · ⏳ Còn phải chạy · 👤 Cần con người (không code được) · ⏸ Treo lại theo quyết định chủ dự án.

**Lưu ý viết prompt cho Kiro:** bối cảnh dự án và quy ước (BFF là lớp duy nhất gọi Medplum, Medplum transaction không nguyên tử, chạy bằng Git Bash, các lệnh test…) đã nằm trong `.kiro/steering/` ở workspace root và tự nạp vào mọi phiên — **đừng lặp lại trong prompt**. Prompt chỉ nên chứa thứ riêng của nhiệm vụ: mục tiêu, tiêu chí done đo được, ranh giới (cái KHÔNG đụng), cách verify.

---

## Đã chạy (theo lịch sử `origin/main`)

| # | Phiên | PR | Kết quả |
|---|---|---|---|
| ✅ | Cài Medplum backend, smoke test, kế hoạch chi tiết | — | `0f03a59`, Medplum 5.2.0 + số đo cơ sở |
| ✅ | Review tài liệu nội bộ 34 trang, cập nhật kế hoạch | — | `8f156a9` |
| ✅ | Tái định phạm vi quanh MVP nhà đầu tư (M0) | — | `46dcbb2` |
| ✅ | M0-S1: khung monorepo, fhir-vn-model, BFF, clinic-web | — | `bbb25e6`, `80fcac3` |
| ✅ | M0-S2.1: danh mục ICD-10/thuốc/đơn mẫu, tìm không dấu | — | `fa3380e` |
| ✅ | M0-S2.2: quy tắc kê đơn, gói clinical, gói hoàn tất lượt khám chạy lại được | — | `576a1be`, `05ba111`, `4ba3bd9` |
| ✅ | M0-S3-5: bài 100 chu kỳ ngắt/khôi phục mạng | #6 | `816809d` |
| ✅ | M0-S3 ngoại tuyến (relaxed-rosalind) | #8 | `43e4b6d` |
| ✅ | M0-S3-6: nhãn ngoại tuyến, cập nhật tài liệu | #10 | `19d4275` |
| ✅ | M0-ZALO: nút "Gửi đơn qua Zalo" mô phỏng | #11 | `f868f3b` |
| ✅ | M0-3: tìm bệnh nhân qua BFF (đo tốc độ) | #12 | `681087f` |
| ✅ | M0-THU: công cụ phiên thử bác sĩ (ca mô phỏng, trial:up, rehearsal) | #13 | `52e3b2a` |
| ✅ | M0-BFF: sửa xung đột giao dịch Medplum 40001 khi ký cùng lúc | #14 | `1df6000` |
| ✅ | M0-TIM-SUA: tìm bệnh nhân — tính đúng (khóa chính xác vào meta.tag) | #15 | `4013df1` |
| ✅ | Docker demo (BFF + web) + OFF-8 + P2 search | #17 | `96a22ad` |
| ✅ | OFF-8: "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay vẫn phải in | #17 | `d589343`, `c5940ba` |
| ✅ | P2: tìm bệnh nhân — gõ lẫn tên/số, báo "còn người trùng tên", xếp hạng ổn định | #15, #17 | `2a7c1cc` |
| ✅ | Demo seed phong phú + UI v0.2 | #16, #19 | `02c6fc8` |
| ✅ | Tự thoát chế độ "Mất mạng" khi máy chủ hồi (thăm dò /api/health) | #22 | `7bb77a5` |
| ✅ | T-QUOTA: nâng hạn mức FHIR theo project; T6 100 chu kỳ chạy xanh | #25 | `af7d800`, `8625b95` |
| ✅ | Xử lý tay mục offline "cần xử lý" (xung đột/lỗi dữ liệu) | #25 | `36490c8`, `488323f` |
| ✅ | Tracker chức năng: xác minh sâu, chuyển ra gốc, script .docx, hook nhắc | #24 | `51a8527`, `52c0054` |
| ✅ | T-OUTBOX: đối soát idempotent đơn đã ký thiếu Task gửi (A2/F11), nút "Quét đối soát" | — | `ac109ae` (HEAD) |

> Ngoài git: migrate môi trường Claude Code → Kiro (steering file, đồng bộ git về origin/main, giữ mockup ở nhánh `ui-mockups`, dọn 6 worktree). Không nằm trong lịch sử commit sản phẩm.

---

## Còn phải chạy

> Chức năng M0 đã kín (xem `trang-thai-chuc-nang.md`). Các mục P1 (OFF-8) và P2 (tìm bệnh nhân)
> trước đây ở đây đã merge — chuyển lên bảng "Đã chạy". Chưa có việc code M0 nào mở; việc M0
> còn lại nằm ở mục "Cần con người / treo lại" bên dưới.
>
> Khi mở M1, hạng mục nền không phụ thuộc nguồn ngoài đáng làm trước là **T-IDP** (xác thực
> nhân viên thật, bỏ `DEMO_AUTH`). Các mục nối hệ thật khác (T-RX cổng, T-SIGN ký số, T-ZALO,
> T-PAY) chờ tài liệu API / sandbox / pháp chế.

---

## Cần con người / treo lại

| | Hạng mục | Ghi chú |
|---|---|---|
| 👤 | **M0-1**: phiên thử 3 bác sĩ thật, đo thời gian mở hồ sơ → in đơn (p50 ≤ 60s, p90 ≤ 120s) | Công cụ đã sẵn (`pnpm trial:up`, `pnpm trial:rehearsal`), chỉ cần người thật ngồi đo |
| ⏸ | **M0-6**: diễn tập trình diễn + máy dự phòng + video quay sẵn | Treo lại theo quyết định chủ dự án |
| ⏳ | **T6 đầy đủ**: ngoại tuyến 100 chu kỳ + đồng bộ 40 ca ≤ 60s | Phụ thuộc nới hạn mức FHIR (T-QUOTA) trước |

---

## Cách dùng sổ này

- Khi bắt đầu một phiên: chép prompt từ mục "Còn phải chạy", mở **phiên Kiro mới** (để context sạch, steering tự nạp), dán prompt.
- Khi xong & merge: chuyển mục đó lên bảng "Đã chạy", ghi số PR và commit.
- Khi phát sinh việc mới: thêm vào "Còn phải chạy" theo đúng khuôn (mục tiêu / tiêu chí done / ranh giới / verify).
