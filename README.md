# PHONGMACH

Phần mềm quản lý phòng mạch tư nhân (Việt Nam). Kế hoạch triển khai: [`docs/ke-hoach-trien-khai.md`](docs/ke-hoach-trien-khai.md).
Đang ở **M0-S2** (hàng chờ, khám một trang, kê đơn, in, liên thông mô phỏng): MVP trình nhà đầu tư dự kiến 13/11/2026.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `apps/clinic-web` | Ứng dụng phòng khám (PWA React + TypeScript + Vite): tiếp đón, hàng chờ, màn hình chờ, khám một trang, kê đơn, in, liên thông, thời gian khám, nhật ký truy cập |
| `services/bff` | BFF / Domain API (Fastify): lớp duy nhất gọi Medplum; tenant lấy từ phiên; hộp thư đi (outbox) và cổng đơn thuốc mô phỏng; in A5 có QR (mẫu ở `packages/print`) |
| `packages/fhir-vn-model` | Mô hình dữ liệu Việt Nam trên FHIR: chuẩn hóa tên không dấu, số điện thoại, CCCD, dựng `Patient` |
| `packages/catalogs` | Danh mục **minh họa** (chưa duyệt y khoa): ICD-10, thuốc, đơn mẫu; tìm không dấu; sinh cách dùng và số lượng |
| `packages/rules` | Quy tắc kê đơn (hàm thuần, dùng chung giao diện và BFF): trùng hoạt chất, dị ứng, số ngày tối đa, thiếu CCCD, trẻ em |
| `packages/clinical` | Hàng chờ, sinh hiệu, dị ứng/tiền sử, đơn thuốc, outbox trên FHIR R4; gói hoàn tất lượt khám chạy lại được |
| `packages/print` | Mẫu in đơn A5 có mã QR, dùng chung cho BFF (in khi có mạng) và trình duyệt (in từ dữ liệu trên máy khi mất mạng) |
| `infra/medplum` | Backend Medplum (Docker Compose), smoke test, thử nghiệm hiệu năng và vòng đời phòng khám |
| `docs` | Kế hoạch triển khai |

## Chạy thử cục bộ

Cần Node >= 22, pnpm 12, Docker (có `docker compose`). Cách nhanh nhất, chạy lại nhiều lần được (cài pnpm nếu thiếu, bật dockerd trong sandbox, dựng Medplum, nạp dữ liệu demo lần đầu, chạy BFF và giao diện):

```bash
infra/dev-up.sh               # --stop để dừng BFF và giao diện; log ở /tmp/phongmach-dev/
```

Hoặc từng bước:

```bash
pnpm install
pnpm stack:up                 # PostgreSQL 16, Redis 7, Medplum 5.2.0; lần đầu mất khoảng 1 phút
pnpm seed                     # 2 phòng khám demo, mỗi phòng 400 bệnh nhân giả (mất vài phút vì hạn mức mặc định của Medplum),
                              # kèm dị ứng, tiền sử và vài lượt khám cũ có đơn; SEED_PATIENTS=5 để nạp nhanh
DEMO_AUTH=1 pnpm dev:bff      # BFF ở http://127.0.0.1:8110 (cổng đơn thuốc quốc gia MÔ PHỎNG, hộp thư đi chạy nền)
pnpm dev:web                  # giao diện ở http://127.0.0.1:5173
```

Để trình diễn, dùng bản build thay cho bản dev (bản dev của React gọi mọi hiệu ứng hai lần nên nhật ký truy cập có dòng "Mở hồ sơ" đôi):

```bash
pnpm --filter @phongmach/clinic-web build && pnpm --filter @phongmach/clinic-web preview   # http://127.0.0.1:4173
```

## Đi qua kịch bản trình diễn

1. Đăng nhập **Phụ tá Nguyễn Thị Lan** (phòng khám Nội) → Tiếp đón → gõ `nguyen van an` → thấy dị ứng Penicillin → "Cấp số". Thêm "Trần Thị Bình" với ưu tiên "Đã hẹn": Bình được gọi trước. Mở "Màn hình chờ".
2. Đăng xuất, đăng nhập **BS. Lê Thị Thu Hà** → Hàng chờ → "Gọi vào khám" → nhập sinh hiệu, gõ tắt `viem hong` → chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh". Hệ thống cảnh báo **dị ứng** (amoxicillin) và, nếu thêm paracetamol hai dạng, **trùng hoạt chất**; phải ghi lý do mới ký được. "Ký & In" mở hộp thoại in đơn A5 có mã QR.
3. "Liên thông": bấm "Mất kết nối cổng", kê tiếp cho Bình bằng nút "Kê lại đơn này". Đơn đã ký hiện "Chờ gửi lại" kèm lý do. Bật lại cổng: đơn tự gửi được, không mất.
4. Đăng nhập chủ phòng khám → "Thời gian khám" (đo ở máy chủ, so với mục tiêu 60/120 giây) và "Nhật ký truy cập". Trang "Phạm vi" nêu rõ cái gì thật, cái gì mô phỏng, cái gì chưa làm.

## Kiểm thử

```bash
pnpm typecheck
pnpm test                                       # đơn vị: danh mục, quy tắc, mô hình, clinical, BFF, web (không cần Medplum)
pnpm --filter @phongmach/bff test:integration   # BFF với Medplum thật (cần stack đang chạy)
pnpm e2e                                        # Chromium thật, 13 + 21 bước; cần stack + seed + BFF + web đang chạy
```

Bài e2e tạo thêm bệnh nhân (tên bắt đầu bằng `Zq`) và các lượt khám trong hai phòng khám demo mỗi lần chạy, và tự dọn hàng chờ (kể cả sau lần chạy hỏng). Để chạy nhanh bước chèn lỗi cổng, khởi động BFF với `OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000`. Muốn dữ liệu demo sạch: `pnpm stack:down`, xóa volume
(`docker compose -f infra/medplum/docker-compose.yml down -v`), rồi chạy lại các bước trên.

## Giới hạn của bản hiện tại

- **Chưa có xác thực thật** (T-IDP). BFF chỉ chạy khi đặt `DEMO_AUTH=1`, chỉ lắng nghe trên localhost, và chỉ nên dùng với dữ liệu giả.
- **Mô phỏng**: chữ ký số (băm nội dung, chưa gọi nhà cung cấp) và cổng đơn thuốc quốc gia (bộ nối giả có nút chèn lỗi). Mọi nơi hiển thị đều có nhãn.
- Danh mục ICD-10, thuốc và đơn mẫu là **tập con minh họa**, chưa được cố vấn y khoa duyệt, không dùng lâm sàng.
- Chưa có: ngoại tuyến (M0-S3, đang làm), Zalo, thu tiền (xem kế hoạch, mục 5 và 6).
- Bản nháp lượt khám lưu trên máy trong IndexedDB, mã hóa AES-GCM, mỗi người dùng một kho, xóa cả kho lẫn khóa khi đăng xuất. Khóa nằm cùng máy với dữ liệu nên **chưa** bảo vệ được trước người dùng chung trình duyệt hay người lấy được ổ đĩa (kế hoạch, OFF-5); cần xác thực thật (T-IDP).
- **Medplum không hoàn tác `transaction` khi một mục lỗi** (xem kế hoạch, F11): gói hoàn tất lượt khám được thiết kế để chạy lại được, không dựa vào hoàn tác.
- Nhật ký truy cập ghi vào file cục bộ (`services/bff/.data/`); chuyển ra kho bất biến ở M1 (T-AUD).
- Ứng dụng web chỉ lưu vỏ ứng dụng cho PWA, **không** lưu phản hồi API (có dữ liệu bệnh nhân).
- `services/bff/.demo-tenants.json` chứa bí mật của các tài khoản máy Medplum; đã nằm trong `.gitignore`, không commit.
