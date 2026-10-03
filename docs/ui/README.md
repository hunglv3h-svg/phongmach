# Mockup giao diện PHONGMACH

Ảnh chụp từ bản xem trước chạy bằng dữ liệu giả (DEMO), chụp bằng Chromium. Không phải thiết kế vẽ tay.

| Thư mục | Nội dung |
|---|---|
| `v0.0-truoc` | Giao diện trước khi thiết kế lại (10 màn hình máy bàn + 1 điện thoại) |
| `v0.1` | Sau UI v0.1: cột bên / thanh tab đáy, cảnh báo dị ứng, màn hình chờ lớn (máy bàn `01`–`14`, điện thoại `m1`–`m6`) |
| `v0.2` | UI v0.2: "phiếu số" làm điểm nhấn, cột bên màu mực (máy bàn `01`–`10`, điện thoại `m1`–`m6`) |
| `v0.2-sang-toi` | v0.2 ở chế độ sáng (`light-*`) và tối (`dark-*`): tiếp đón, hàng chờ, màn hình chờ, liên thông, thời gian khám, nhật ký, phạm vi |

Thiết kế trên Figma (tham khảo, dừng cập nhật; chỉ nâng cấp khi chủ đầu tư có kế hoạch rõ ràng):
https://www.figma.com/design/OY5TtN1TQNrzaIEOMzrRWo

Chưa có ảnh: màn in đơn.

Tạo lại ảnh: chạy BFF xem trước (`services/bff/scripts/preview-server.ts`, chưa commit) và `pnpm --filter @phongmach/clinic-web dev`, rồi dùng Playwright. Kiểm truy cập: `pnpm --filter @phongmach/clinic-web e2e:a11y`.
