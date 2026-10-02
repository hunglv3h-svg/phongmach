# Backend Medplum cho PHONGMACH

Lõi dữ liệu y tế (FHIR R4) của dự án, theo mục 5.1 của báo cáo "Quản lý Phòng mạch Việt Nam v2.0".
Thư mục này chỉ phục vụ **dev / thử nghiệm**. Kế hoạch đầy đủ: [`docs/ke-hoach-trien-khai.md`](../../docs/ke-hoach-trien-khai.md).

## Chạy

Cần Docker (có `docker compose`), Node >= 18 và `openssl`.

```bash
node infra/medplum/setup.mjs                                   # sinh .env + config/medplum.config.json (không commit)
docker compose -f infra/medplum/docker-compose.yml up -d       # postgres 16, redis 7, medplum-server 5.2.0
node infra/medplum/smoke-test.mjs                              # kiểm tra
```

Lần khởi động đầu mất khoảng 1 phút (chạy ~100 migration). Server ở `http://localhost:8103`
(`/healthcheck`, `/fhir/R4/metadata`).

Dừng và xóa dữ liệu: `docker compose -f infra/medplum/docker-compose.yml down -v`.

## Điều cần biết

- **Medplum không có trên npm dưới dạng `@medplum/server`.** Server được phát hành dưới dạng image Docker
  `medplum/medplum-server` (hoặc build từ mã nguồn). Các gói `@medplum/core`, `@medplum/fhirtypes`… có trên npm
  và dùng cho client / lớp Việt Nam hóa. Phiên bản được ghim ở `5.2.0`.
- **Tài khoản siêu quản trị mặc định `admin@example.com` / `medplum_admin` hoạt động trên bản cài mới.**
  Smoke test báo `FAIL` có chủ đích cho đến khi đổi mật khẩu. Đổi mật khẩu qua API cũng gọi kiểm tra
  `api.pwnedpasswords.com` (xem dưới).
- **Medplum gọi `api.pwnedpasswords.com` mỗi lần tạo user hoặc đặt mật khẩu**, không có công tắc cấu hình
  (quan sát trong mã nguồn server 5.2.0: `newuser`, `setpassword`, `changepassword`; thử thật với `newuser`). Mạng không ra được host đó thì các thao tác
  này lỗi `fetch failed`. Bản cấu hình ở đây tắt tự đăng ký (`registerEnabled: false`).
- Hạn mức mặc định: đăng nhập 5 lần/phút; FHIR 50.000 điểm/phút/người dùng (đọc = 1, tìm = 20, ghi = 100,
  tức khoảng 500 lần ghi/phút), mỗi project gấp 10 lần. Nhập dữ liệu hàng loạt sẽ chạm hạn mức; `batch` vẫn trả
  HTTP 200 còn từng phần tử bên trong trả 429, nên phải kiểm tra từng phần tử.
- `saveAuditEvents: true` được bật. Đọc và ghi sinh `AuditEvent` được lưu; **tìm kiếm thì không**.

## Smoke test kiểm tra gì

Server lên, FHIR R4, tạo 2 phòng khám (mỗi phòng khám một `Project` + một `ClientApplication`), tạo
Patient/Encounter/Condition/MedicationRequest, tìm theo số điện thoại và CCCD, cách ly dữ liệu giữa hai phòng
khám (đọc/tìm/sửa chéo đều bị chặn), `AuditEvent`, lịch sử phiên bản, và tài khoản mặc định.
Mã thoát 1 nếu có mục `FAIL`; `WARN` không làm hỏng kết quả.

## Trước khi đưa lên production (chưa làm)

Đổi/vô hiệu tài khoản mặc định; TLS và reverse proxy (phải chuyển tiếp IP thật của client, vì hạn mức đăng nhập tính theo IP);
Postgres có sao lưu liên tục (WAL/PITR) và bản sao; Redis bền vững; quản lý bí mật (không để khóa ký trong file);
kiểm soát egress; giám sát và cảnh báo; chạy nhiều bản server sau bộ cân bằng tải. Không hạng mục nào ở đây đã
được kiểm chứng.
