# Bộ prompt theo phiên làm việc — PHONGMACH

Sổ theo dõi các phiên làm việc với agent (Claude Code trước đây, Kiro từ nay). Mỗi mục là một phiên: mục tiêu, prompt đã dùng (hoặc sẽ dùng), và trạng thái. Dùng để kiểm tra tiến độ nhanh mà không phải lần giở git log.

**Quy ước trạng thái:** ✅ Đã chạy & merge · 🔧 Đang làm · ⏳ Còn phải chạy · 👤 Cần con người (không code được) · ⏸ Treo lại theo quyết định chủ dự án.

**Lưu ý viết prompt cho Kiro:** bối cảnh dự án và quy ước (BFF là lớp duy nhất gọi Medplum, Medplum transaction không nguyên tử, chạy bằng Git Bash, các lệnh test…) đã nằm trong `.kiro/steering/` ở workspace root và tự nạp vào mọi phiên — **đừng lặp lại trong prompt**. Prompt chỉ nên chứa thứ riêng của nhiệm vụ: mục tiêu, tiêu chí done đo được, ranh giới (cái KHÔNG đụng), cách verify.

---

## Đã chạy (theo lịch sử `origin/main`, kiểm 17/10/2026 ở `ae1f908`)

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
| ✅ | P2: tìm bệnh nhân — gõ lẫn tên/số, báo "còn người trùng tên", xếp hạng ổn định | #17 | `3347540` |
| ✅ | Demo seed phong phú + UI v0.2 | #16, #19 | `02c6fc8` |
| ✅ | M0-2: sửa ba lỗi tiềm ẩn làm đỏ `e2e:cycles` (quy tắc `cccd-unknown`, tìm người chưa đồng bộ, bài bấm lại nút hàng chờ) | #20 | `8847519` |
| ✅ | Tự thoát chế độ "Mất mạng" khi máy chủ hồi (thăm dò /api/health) | #22 | `7bb77a5` |
| ✅ | T-QUOTA: nâng hạn mức FHIR theo project; T6 100 chu kỳ chạy xanh | #25 | `af7d800`, `8625b95` |
| ✅ | Xử lý tay mục offline "cần xử lý" (xung đột/lỗi dữ liệu) | #25 | `36490c8`, `488323f` |
| ✅ | Tracker chức năng: xác minh sâu, chuyển ra gốc, script .docx, hook nhắc | #24 | `51a8527`, `52c0054` |
| ✅ | T-OUTBOX: đối soát idempotent đơn đã ký thiếu Task gửi (A2/F11), nút "Quét đối soát" | — | `ac109ae` |
| ✅ | T-IDP: xác thực nhân viên thật (Phương án B, mật khẩu + TOTP, `AUTH_MODE=real` hoặc `demo`, kho phiên SQLite) | #26 | `a79cae1`, `82aa76b` (merge `ae1f908`) |
| ✅ | Demo Docker cổng 8081: chờ Medplum sẵn sàng trước khi seed; `AUTH_MODE=demo` cho ảnh demo | #28 | `ab22fd3`, `b9c03ba` |
| ✅ | Cập nhật trạng thái dự án theo `main` `ae1f908`, prompt M0-S3.5c | #27 | `abd1d1d` (merge `ed4f4aa`) |

> Ngoài git: migrate môi trường Claude Code → Kiro (steering file, đồng bộ git về origin/main, giữ mockup ở nhánh `ui-mockups`, dọn 6 worktree). Không nằm trong lịch sử commit sản phẩm.

---

## Còn phải chạy

> **Từ 11/11/2026: danh sách đủ mọi việc còn lại, prompt chép-dán và cột đánh DONE nằm ở
> `docs/ke-hoach-trien-khai.md` mục 11** (bản Word: `docs/ke-hoach-trien-khai.docx`). Sổ này chỉ còn giữ lịch sử
> các phiên đã chạy.
>
> Chức năng M0 đã kín (xem `trang-thai-chuc-nang.md`) và T-IDP đã xong. Trên `main` còn **hai lỗi đã biết** của hàng đợi
> đồng bộ, cả hai đã có bản sửa từ 03–04/10 nhưng bản sửa lạc ngoài `main` (PR #7 và #9 merge vào nhánh lát 5). Đó là
> việc code M0 duy nhất còn mở, nên làm trước buổi trình diễn 13/11: **M0-S3.5c**, prompt ở kế hoạch mục 11.4 (nguyên
> văn prompt của PR #27). Các ứng viên kế tiếp mà PR #27 nêu nay là các việc **Q-ROW**, **T6-40**, **T-AUD** và
> **OFF-PIN** ở bảng 11.3, đều đã có prompt.

---

## Cần con người / treo lại

| | Hạng mục | Ghi chú |
|---|---|---|
| 👤 | **M0-1**: phiên thử 3 bác sĩ thật, đo thời gian mở hồ sơ → in đơn (p50 ≤ 60s, p90 ≤ 120s) | Công cụ đã sẵn (`pnpm trial:up`, `pnpm trial:rehearsal`), chỉ cần người thật ngồi đo |
| ⏸ | **M0-6**: diễn tập trình diễn + máy dự phòng + video quay sẵn | Treo lại theo quyết định chủ dự án. Phần mã đã viết (kịch bản 10 phút, `pnpm demo:rehearsal`, nhãn cho số "Thời gian khám") nằm ở nhánh cục bộ `feat/m0-6-demo-rehearsal`, chưa đẩy; muốn dùng thì phải rebase lên `main` |

---

## Cách dùng sổ này

- Khi bắt đầu một phiên: chép prompt từ mục "Còn phải chạy", mở **phiên Kiro mới** (để context sạch, steering tự nạp), dán prompt.
- Khi xong & merge: chuyển mục đó lên bảng "Đã chạy", ghi số PR và commit.
- Khi phát sinh việc mới: thêm vào "Còn phải chạy" theo đúng khuôn (mục tiêu / tiêu chí done / ranh giới / verify).
