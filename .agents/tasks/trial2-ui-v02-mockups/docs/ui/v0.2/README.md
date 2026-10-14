# Mockup giao diện PHONGMACH v0.2 (thư mục đầu mối)

Mở `index.html` bằng trình duyệt để xem bản demo tổng hợp theo ba vai trò: bệnh nhân, phụ tá, bác sĩ và chủ phòng mạch, kèm trang "Cả buổi khám" và bộ lọc theo giai đoạn (Đã chạy được, GĐ1, GĐ2, GĐ3).
`phongmach-demo-tong-hop.html` là cùng nội dung gói trong một file (có sẵn ảnh bên trong), dùng để gửi qua thư.

| Thư mục, file | Nội dung |
|---|---|
| `index.html` | Demo tổng hợp, cần thư mục `man-hinh-that` nằm cạnh |
| `phongmach-demo-tong-hop.html` | Cùng demo, một file độc lập |
| `man-hinh-that/` | 47 ảnh chụp màn hình thật của bản xem trước v0.2 (máy bàn, điện thoại, chế độ sáng và tối). Tên file: `<vai trò>-<số thứ tự>-<màn hình>`; đuôi `-toi` là chế độ tối |
| `du-kien/` | 13 bản vẽ dự kiến xuất ra ảnh (GĐ1–GĐ3 và số liệu minh họa) |
| `danh-muc.md` | Danh mục 32 bước: vai trò, giai đoạn, loại (ảnh thật hay bản vẽ), tệp ảnh |

Tiền tố vai trò trong `man-hinh-that`: `bn` bệnh nhân, `pt` phụ tá, `bs` bác sĩ, `cp` chủ phòng mạch.

Lưu ý
- Ảnh thật chụp từ bản xem trước chạy bằng dữ liệu giả; tên, số điện thoại, CCCD là dữ liệu mẫu. Chữ ký số và cổng đơn thuốc quốc gia là mô phỏng.
- Bản vẽ dự kiến minh họa hướng thiết kế, không phải cam kết tính năng hay tiến độ. Số liệu trong bản vẽ là ví dụ.
- Giai đoạn theo kế hoạch hiện hành (GĐ1 12/2026–03/2027, GĐ2 04–07/2027, GĐ3 08–12/2027) và có thể thay đổi.

Các bản cũ: `../v0.0-truoc` (trước thiết kế lại), `../v0.1`.
