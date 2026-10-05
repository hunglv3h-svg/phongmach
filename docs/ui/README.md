# Mockup giao diện PHONGMACH

Bắt đầu từ `v0.2/index.html` (mở bằng trình duyệt): bản demo tổng hợp theo ba vai trò (bệnh nhân, phụ tá, bác sĩ và chủ phòng mạch). Chi tiết ở `v0.2/README.md` và danh mục từng bước ở `v0.2/danh-muc.md`.

| Thư mục | Nội dung |
|---|---|
| `v0.2` | Thư mục đầu mối hiện hành: demo tổng hợp, 47 ảnh chụp thật (máy bàn, điện thoại, sáng, tối), 13 bản vẽ dự kiến GĐ1–GĐ3 |
| `v0.1` | Ảnh chụp sau UI v0.1 (lưu lại để so sánh) |
| `v0.0-truoc` | Giao diện trước khi thiết kế lại (lưu lại để so sánh) |

Ảnh chụp lấy từ bản xem trước chạy bằng dữ liệu giả, không phải thiết kế vẽ tay. Thiết kế trên Figma chỉ để tham khảo, dừng cập nhật (chỉ nâng cấp khi chủ đầu tư có kế hoạch rõ ràng):
https://www.figma.com/design/OY5TtN1TQNrzaIEOMzrRWo

Tạo lại ảnh: chạy BFF xem trước (`services/bff/scripts/preview-server.ts`, chưa commit) và `pnpm --filter @phongmach/clinic-web dev`, rồi dùng Playwright. Kiểm truy cập: `pnpm --filter @phongmach/clinic-web e2e:a11y`.
