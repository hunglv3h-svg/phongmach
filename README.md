# PHONGMACH

Phần mềm quản lý phòng mạch tư nhân (Việt Nam). Kế hoạch triển khai: [`docs/ke-hoach-trien-khai.md`](docs/ke-hoach-trien-khai.md).
Đang ở **M0-S1** (khung sản phẩm và tiếp đón): MVP trình nhà đầu tư dự kiến 13/11/2026.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `apps/clinic-web` | Ứng dụng phòng khám (PWA React + TypeScript + Vite): tiếp đón, tìm bệnh nhân, nhật ký truy cập |
| `services/bff` | BFF / Domain API (Fastify): lớp duy nhất gọi Medplum; tenant lấy từ phiên, không từ tham số |
| `packages/fhir-vn-model` | Mô hình dữ liệu Việt Nam trên FHIR: chuẩn hóa tên không dấu, số điện thoại, CCCD, dựng `Patient` |
| `infra/medplum` | Backend Medplum (Docker Compose), smoke test, thử nghiệm hiệu năng và vòng đời phòng khám |
| `docs` | Kế hoạch triển khai |

## Chạy thử cục bộ

Cần Node >= 22, pnpm 12, Docker (có `docker compose`).

```bash
pnpm install
pnpm stack:up                 # PostgreSQL 16, Redis 7, Medplum 5.2.0; lần đầu mất khoảng 1 phút
pnpm seed                     # 2 phòng khám demo, mỗi phòng 400 bệnh nhân giả (mất vài phút vì hạn mức mặc định của Medplum)
DEMO_AUTH=1 pnpm dev:bff      # BFF ở http://127.0.0.1:8110
pnpm dev:web                  # giao diện ở http://127.0.0.1:5173
```

Để trình diễn, dùng bản build thay cho bản dev (bản dev của React gọi mọi hiệu ứng hai lần nên nhật ký truy cập có dòng "Mở hồ sơ" đôi):

```bash
pnpm --filter @phongmach/clinic-web build && pnpm --filter @phongmach/clinic-web preview   # http://127.0.0.1:4173
```

## Kiểm thử

```bash
pnpm typecheck
pnpm test                                       # đơn vị: mô hình, BFF, web (không cần Medplum)
pnpm --filter @phongmach/bff test:integration   # BFF với Medplum thật (cần stack đang chạy)
pnpm --filter @phongmach/clinic-web e2e         # Chromium thật; cần stack + seed + BFF + web đang chạy
```

Bài e2e tạo thêm bệnh nhân (tên bắt đầu bằng `Zq`) trong hai phòng khám demo mỗi lần chạy. Muốn dữ liệu demo sạch: `pnpm stack:down`, xóa volume
(`docker compose -f infra/medplum/docker-compose.yml down -v`), rồi chạy lại các bước trên.

## Giới hạn của bản hiện tại

- **Chưa có xác thực thật** (T-IDP). BFF chỉ chạy khi đặt `DEMO_AUTH=1`, chỉ lắng nghe trên localhost, và chỉ nên dùng với dữ liệu giả.
- Chưa có: hàng chờ, khám, kê đơn, ký số, cổng đơn thuốc, Zalo, ngoại tuyến (xem kế hoạch, mục 5 và 6).
- Nhật ký truy cập ghi vào file cục bộ (`services/bff/.data/`); chuyển ra kho bất biến ở M1 (T-AUD).
- Ứng dụng web chỉ lưu vỏ ứng dụng cho PWA, **không** lưu phản hồi API (có dữ liệu bệnh nhân).
- `services/bff/.demo-tenants.json` chứa bí mật của các tài khoản máy Medplum; đã nằm trong `.gitignore`, không commit.
