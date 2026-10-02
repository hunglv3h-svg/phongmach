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

Script in ra địa chỉ giao diện và dòng `E2E_URL=…` để chạy e2e. Giao diện mặc định ở cổng 5173; nếu cổng đó đang do tiến trình khác giữ (dự án khác trên cùng máy) thì script không đụng tới nó mà tự chọn cổng trống đầu tiên từ 5183. Muốn cố định cổng: `WEB_PORT=5190 infra/dev-up.sh`. Trên Windows xem thêm mục [Chạy trên Windows](#chạy-trên-windows).

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

## Chạy trên Windows

Đã chạy được trên Windows 11 với Git Bash (Git for Windows), Docker Desktop đang mở và Node 22. Gõ lệnh trong Git Bash, không phải PowerShell hay cmd:

```bash
infra/dev-up.sh                                 # dựng và chạy như trên Linux; in ra địa chỉ giao diện và E2E_URL
pnpm test
pnpm --filter @phongmach/bff test:integration
E2E_URL=http://127.0.0.1:5183 pnpm e2e          # dùng đúng E2E_URL mà dev-up.sh vừa in ra
infra/dev-up.sh --stop
```

- **Cổng.** Script không bao giờ dừng tiến trình không phải do nó chạy. Cổng 5173 đang do dự án khác giữ thì giao diện chạy ở cổng mới (từ 5183), nên e2e cần `E2E_URL`. Cổng 8110 (BFF) bị giữ thì script dừng và báo.
- **Chromium cho e2e.** `e2e/browser.mjs` tự tìm `chrome-headless-shell` của Playwright trong `%LOCALAPPDATA%\ms-playwright`, và không bao giờ dùng Chrome của hệ thống (nó mở vào phiên Chrome đang dùng). Chưa có thì cài: `pnpm --filter @phongmach/clinic-web exec playwright-core install chromium-headless-shell`. Muốn chỉ định tệp khác: đặt `CHROMIUM_PATH`.
- **Log và tệp PID** nằm ở `/tmp/phongmach-dev` của Git Bash, tức `%TEMP%\phongmach-dev`. BFF và giao diện chạy tiếp sau khi đóng cửa sổ Git Bash; dừng bằng `infra/dev-up.sh --stop` từ cửa sổ Git Bash nào cũng được.
- **Medplum dùng chung cho cả máy**, còn bí mật của nó (`infra/medplum/.env`, `config/`) nằm trong thư mục đã dựng stack và không commit. Chạy `dev-up.sh` ở thư mục khác (ví dụ một git worktree mới) thì script dùng lại stack đang chạy, không sinh mật khẩu mới. Nếu stack đang dừng, script báo cách bật lại; không xóa volume khi chưa hỏi chủ dự án.
- Thư mục chưa có `services/bff/.demo-tenants.json` thì `dev-up.sh` nạp thêm một cặp phòng khám demo mới vào Medplum. Muốn dùng lại cặp đã có, chép tệp đó từ thư mục cũ sang trước khi chạy.
- Tự gõ `pnpm` lần đầu mà Corepack hỏi xác nhận tải: `export COREPACK_ENABLE_DOWNLOAD_PROMPT=0` (`dev-up.sh` đã tự đặt).

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
pnpm e2e                                        # Chromium thật, 13 + 24 + 13 + 12 bước (hai bài cuối ngắt mạng thật, bài cuối dùng hai máy); cần stack + seed + BFF + web đang chạy
pnpm e2e:cycles                                 # M0-2: 20 chu kỳ ngắt và khôi phục mạng, đếm 0 mất, 0 trùng; chỉ cần stack đang chạy (tự dựng phần còn lại)
```

e2e mặc định mở `http://127.0.0.1:5173`; giao diện ở cổng khác thì đặt `E2E_URL` (`dev-up.sh` in ra giá trị đúng). Bài e2e tạo thêm bệnh nhân (tên bắt đầu bằng `Zq`) và các lượt khám trong hai phòng khám demo mỗi lần chạy, và tự dọn hàng chờ (kể cả sau lần chạy hỏng). Để chạy nhanh bước chèn lỗi cổng, khởi động BFF với `OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000`. Muốn dữ liệu demo sạch: `pnpm stack:down`, xóa volume
(`docker compose -f infra/medplum/docker-compose.yml down -v`), rồi chạy lại các bước trên.

`pnpm e2e:cycles` (tiêu chí M0-2) không nằm trong `pnpm e2e` vì nó không dùng BFF và giao diện demo: `infra/e2e-cycles.mjs` tạo một phòng khám thử mới, build giao diện, chạy một BFF riêng ở cổng 8111 và bản build ở cổng 4174 (cần service worker để tải lại trang khi mất mạng), chạy bài `apps/clinic-web/e2e/offline-cycles.mjs` rồi dừng hai tiến trình đó. Nó không đụng hai phòng khám demo, và chạy được trong lúc BFF và giao diện demo đang chạy. Mỗi chu kỳ một bệnh nhân mới đi hết đường (tạo, cấp số, gọi vào khám, khám, ký và in) qua một lần ngắt và một lần khôi phục mạng, kèm mất phản hồi, tải lại trang khi mất mạng và máy sập đúng lúc in; cuối bài đếm bản ghi bằng tài khoản máy của phòng khám thử.

- Bài in hạt giống ở dòng đầu. Chạy lại đúng một lần chạy cũ: `E2E_SEED=<số> pnpm e2e:cycles`. Số chu kỳ khác: `E2E_CYCLES=100` (T6).
- Cổng 8111 hoặc 4174 đang bị giữ thì script dừng và báo; đổi bằng `CYCLES_BFF_PORT`, `CYCLES_WEB_PORT`. Đã build sẵn thì `CYCLES_SKIP_BUILD=1`.
- Tệp phòng khám tạm, nhật ký và log của lần chạy nằm ở `services/bff/.data/e2e-cycles/` (đã gitignore). Mỗi lần chạy để lại một Project thử trong Medplum.
- `apps/clinic-web/vite.config.ts` đọc `BFF_URL` (mặc định `http://127.0.0.1:8110`) và `PREVIEW_PORT` (mặc định 4173) từ môi trường.

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
