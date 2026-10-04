# PHONGMACH

Phần mềm quản lý phòng mạch tư nhân (Việt Nam). Kế hoạch triển khai: [`docs/ke-hoach-trien-khai.md`](docs/ke-hoach-trien-khai.md).
Đang ở **M0-S3**: phần ngoại tuyến đã xong (mất mạng vẫn tiếp đón, khám, ký, in trên từng máy; có mạng lại thì tự đồng bộ, không mất, không trùng), làm trên nền M0-S1 và M0-S2 (tiếp đón, hàng chờ, khám một trang, kê đơn, in, liên thông mô phỏng). Nút "Gửi đơn qua Zalo" là mô phỏng: chỉ hiện bản xem trước tin nhắn, không gửi. Phiên thử với 3 bác sĩ (tiêu chí M0-1) đã chuẩn bị xong, **chưa đo**: xem [`docs/phien-thu-bac-si.md`](docs/phien-thu-bac-si.md). Còn lại tới M0: buổi thử thật với bác sĩ, kịch bản trình diễn và bản dự phòng (kế hoạch, mục 5.9). MVP trình nhà đầu tư dự kiến 13/11/2026.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `apps/clinic-web` | Ứng dụng phòng khám (PWA React + TypeScript + Vite): tiếp đón, hàng chờ, màn hình chờ, khám một trang, kê đơn, in, liên thông, thời gian khám, nhật ký truy cập. Ngoại tuyến nằm ở `src/local`: kho mã hóa trên máy (IndexedDB), hàng đợi đồng bộ, bộ đệm hồ sơ, chỉ báo mạng và danh sách "Chờ đồng bộ". Bài e2e ở `e2e/` |
| `services/bff` | BFF / Domain API (Fastify): lớp duy nhất gọi Medplum; tenant lấy từ phiên; hộp thư đi (outbox) và cổng đơn thuốc mô phỏng; in A5 có QR (mẫu ở `packages/print`); nhận thao tác làm lúc mất mạng (giờ máy khách, số tạm, nạp trước hàng chờ, ghi nhận lần in) |
| `packages/fhir-vn-model` | Mô hình dữ liệu Việt Nam trên FHIR: chuẩn hóa tên không dấu, số điện thoại, CCCD, dựng `Patient` |
| `packages/catalogs` | Danh mục **minh họa** (chưa duyệt y khoa): ICD-10, thuốc, đơn mẫu; tìm không dấu; sinh cách dùng và số lượng |
| `packages/rules` | Quy tắc kê đơn (hàm thuần, dùng chung giao diện và BFF): trùng hoạt chất, dị ứng, số ngày tối đa, thiếu CCCD, trẻ em, "chưa rõ dị ứng" khi mở hồ sơ lúc mất mạng |
| `packages/clinical` | Hàng chờ, sinh hiệu, dị ứng/tiền sử, đơn thuốc, outbox trên FHIR R4; gói hoàn tất lượt khám chạy lại được; đo thời gian phiên khám theo giờ máy chủ hoặc giờ máy khách (lượt làm lúc mất mạng) |
| `packages/print` | Mẫu in đơn A5 có mã QR, dùng chung cho BFF (in khi có mạng) và trình duyệt (in từ dữ liệu trên máy khi mất mạng) |
| `packages/trial` | Bộ ca khám mô phỏng và phiếu ca của phiên thử với bác sĩ (M0-1): 12 ca nội, 12 ca nhi, 3 + 3 ca làm quen. **Minh họa, chưa duyệt y khoa**; không vào giao diện, chỉ script và kiểm thử dùng |
| `infra` | `dev-up.sh` (dựng và chạy môi trường dev), `e2e-cycles.mjs` (bài 20 chu kỳ ngắt và khôi phục mạng trên phòng khám thử riêng), `trial.mjs` (chạy BFF và giao diện riêng cho phiên thử với bác sĩ, và bài diễn tập của nó) |
| `infra/medplum` | Backend Medplum (Docker Compose), smoke test, thử nghiệm hiệu năng và vòng đời phòng khám |
| `docs` | Kế hoạch triển khai; `phien-thu-bac-si.md` (cách chạy buổi thử M0-1, phiếu phản hồi, phiếu quan sát, mẫu biên bản); `phien-thu/ca-mo-phong.md` (bộ ca) |

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
2. Đăng xuất, đăng nhập **BS. Lê Thị Thu Hà** → Hàng chờ → "Gọi vào khám" → nhập sinh hiệu, gõ tắt `viem hong` → chọn đơn mẫu "Viêm họng cấp có chỉ định kháng sinh". Hệ thống cảnh báo **dị ứng** (amoxicillin) và, nếu thêm paracetamol hai dạng, **trùng hoạt chất**; phải ghi lý do mới ký được. "Ký & In" mở hộp thoại in đơn A5 có mã QR. Ở màn hình kết quả, "Gửi đơn qua Zalo" (MÔ PHỎNG) chỉ mở bản xem trước tin nhắn: số điện thoại đã che, không có thuốc hay chẩn đoán.
3. "Liên thông": bấm "Mất kết nối cổng", kê tiếp cho Bình bằng nút "Kê lại đơn này". Đơn đã ký hiện "Chờ gửi lại" kèm lý do. Bật lại cổng: đơn tự gửi được, không mất.
4. **Ngắt mạng trên một máy.** Ngoại tuyến tính theo từng máy (hai máy không thấy nhau khi mất Internet), nên cả đoạn này làm trên máy bác sĩ, bác sĩ tự tiếp đón người mới đến. Vẫn là BS. Hà:
   - Lúc còn mạng, cấp số cho một bệnh nhân rồi mở "Hàng chờ" một lần: máy nạp trước hồ sơ và dị ứng của người đang chờ.
   - Ngắt mạng của trình duyệt: DevTools (F12) → Network → "Offline" (mọi thứ chạy trên localhost nên rút dây mạng không có tác dụng). Thanh trên đổi từ "Có mạng" sang "Mất mạng".
   - "Tiếp đón" → gõ tên người đang chờ: ô tìm ghi "Mất mạng: chỉ tìm trong N hồ sơ trên máy này", vẫn thấy dị ứng đã nạp. Tạo một bệnh nhân mới → "Cấp số": số có nhãn "(tạm)", hiện cả ở "Màn hình chờ".
   - "Hàng chờ" → "Gọi vào khám" người vừa tạo: máy chưa có dữ liệu dị ứng của người này nên đòi bác sĩ hỏi bệnh nhân và ghi lý do. "Ký & In": đơn A5 in từ dữ liệu trên máy, có nhãn "KÝ KHI MẤT MẠNG", mã đơn sinh ngay trên máy. Thanh trên ghi số mục chờ đồng bộ.
   - Ở màn hình kết quả ký, "Gửi đơn qua Zalo" vẫn mở được bản xem trước tin nhắn (nhãn "MÔ PHỎNG: không có tin nhắn nào được gửi"): chỉ dựng từ dữ liệu trên màn hình, không gọi mạng.
   - Bỏ "Offline": các mục tự gửi, thanh trên về "Đã đồng bộ hết". Máy chủ có đúng một bệnh nhân, một lượt khám, một đơn trùng mã đã in, và giữ số tạm nếu chưa ai lấy số đó.
   - Làm đoạn này trên bản build (`preview`, xem trên): chỉ bản build có service worker giữ vỏ ứng dụng, nên tải lại trang trong lúc mất mạng vẫn mở được ứng dụng.
5. Đăng nhập chủ phòng khám → "Thời gian khám" (đo ở máy chủ; lượt làm lúc mất mạng đo bằng đồng hồ máy khám và đếm riêng; so với mục tiêu 60/120 giây) và "Nhật ký truy cập". Trang "Phạm vi" nêu rõ cái gì thật, cái gì mô phỏng, cái gì chưa làm.

## Kiểm thử

```bash
pnpm typecheck
pnpm test                                       # đơn vị: danh mục, quy tắc, mô hình, clinical, BFF, web (không cần Medplum)
pnpm --filter @phongmach/bff test:integration   # BFF với Medplum thật (cần stack đang chạy)
pnpm e2e                                        # Chromium thật, 13 + 25 + 14 + 12 bước (hai bài cuối ngắt mạng thật, bài cuối dùng hai máy); cần stack + seed + BFF + web đang chạy
pnpm e2e:cycles                                 # M0-2: 20 chu kỳ ngắt và khôi phục mạng, đếm 0 mất, 0 trùng; chỉ cần stack đang chạy (tự dựng phần còn lại)
pnpm trial:rehearsal                            # diễn tập kỹ thuật của phiên thử M0-1 trên một phòng khám diễn tập mới; chỉ cần stack đang chạy
```

e2e mặc định mở `http://127.0.0.1:5173`; giao diện ở cổng khác thì đặt `E2E_URL` (`dev-up.sh` in ra giá trị đúng). Bài e2e tạo thêm bệnh nhân (tên bắt đầu bằng `Zq`) và các lượt khám trong hai phòng khám demo mỗi lần chạy, và tự dọn hàng chờ (kể cả sau lần chạy hỏng). Để chạy nhanh bước chèn lỗi cổng, khởi động BFF với `OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000`. Muốn dữ liệu demo sạch: `pnpm stack:down`, xóa volume
(`docker compose -f infra/medplum/docker-compose.yml down -v`), rồi chạy lại các bước trên.

`pnpm e2e:cycles` (tiêu chí M0-2) không nằm trong `pnpm e2e` vì nó không dùng BFF và giao diện demo: `infra/e2e-cycles.mjs` tạo một phòng khám thử mới, build giao diện, chạy một BFF riêng ở cổng 8111 và bản build ở cổng 4174 (cần service worker để tải lại trang khi mất mạng), chạy bài `apps/clinic-web/e2e/offline-cycles.mjs` rồi dừng hai tiến trình đó. Nó không đụng hai phòng khám demo, và chạy được trong lúc BFF và giao diện demo đang chạy. Mỗi chu kỳ một bệnh nhân mới đi hết đường (tạo, cấp số, gọi vào khám, khám, ký và in) qua một lần ngắt và một lần khôi phục mạng, kèm mất phản hồi, tải lại trang khi mất mạng và máy sập đúng lúc in; cuối bài đếm bản ghi bằng tài khoản máy của phòng khám thử.

- Bài in hạt giống ở dòng đầu. Chạy lại đúng một lần chạy cũ: `E2E_SEED=<số> pnpm e2e:cycles`. Số chu kỳ khác: `E2E_CYCLES=100` (T6).
- Cổng 8111 hoặc 4174 đang bị giữ thì script dừng và báo; đổi bằng `CYCLES_BFF_PORT`, `CYCLES_WEB_PORT`. Đã build sẵn thì `CYCLES_SKIP_BUILD=1`.
- Tệp phòng khám tạm, nhật ký và log của lần chạy nằm ở `services/bff/.data/e2e-cycles/` (đã gitignore). Mỗi lần chạy để lại một Project thử trong Medplum.
- `apps/clinic-web/vite.config.ts` đọc `BFF_URL` (mặc định `http://127.0.0.1:8110`) và `PREVIEW_PORT` (mặc định 4173) từ môi trường.

## Phiên thử với bác sĩ (M0-1)

Buổi thử chạy trên một phòng khám thử riêng (phiên `m0-1`), không dùng hai phòng khám demo. Cách điều phối, phiếu phản hồi, phiếu quan sát và mẫu biên bản: [`docs/phien-thu-bac-si.md`](docs/phien-thu-bac-si.md). **Chưa có con số M0-1 nào**; số của bài diễn tập là số chạy thử kỹ thuật.

```bash
pnpm trial:up                     # tạo hoặc dùng lại phòng khám thử, chạy BFF (8112) và bản build (http://127.0.0.1:4175); Ctrl+C để dừng
pnpm trial queue bs1 noi warmup   # xếp 3 ca làm quen cho bác sĩ thử 1 (nội); "nhi" cho nhi
pnpm trial queue bs1 noi          # xếp 12 ca tính số đo
pnpm trial clear                  # dọn hàng chờ sau lượt của một bác sĩ
pnpm trial export                 # CSV từng lượt và bảng p50/p90 theo bác sĩ, do đúng hàm tính của BFF (computeMetrics) tính
pnpm trial sheets                 # sinh lại phiếu ca: docs/phien-thu/ca-mo-phong.md và hai tệp HTML để in, mỗi ca một trang
pnpm trial:rehearsal              # diễn tập: hai bác sĩ thử đi trọn lượt trên Chromium, xuất số đo, so với màn hình "Thời gian khám"
```

- Bộ ca (`packages/trial`) là dữ liệu minh họa, **chưa được cố vấn y khoa duyệt**: phải duyệt trước buổi thử.
- Tệp của phiên nằm ở `services/bff/.data/trial/<phiên>/` (đã gitignore): tệp phòng khám có bí mật của tài khoản máy, nhật ký truy cập, log, bản xuất. Phiên khác: `TRIAL=<tên> pnpm trial …`; tên bắt đầu bằng `dien-tap` là phiên diễn tập và mọi bản xuất của nó tự đóng nhãn "số chạy thử kỹ thuật".
- `pnpm trial:rehearsal` không nằm trong `pnpm e2e` và chưa chạy trong CI. Mỗi lần chạy để lại một Project diễn tập trong Medplum.
- BFF chỉ nghe trên localhost, nên bác sĩ phải ngồi đúng máy đang chạy `pnpm trial:up`.

## Giới hạn của bản hiện tại

- **Chưa có xác thực thật** (T-IDP). BFF chỉ chạy khi đặt `DEMO_AUTH=1`, chỉ lắng nghe trên localhost, và chỉ nên dùng với dữ liệu giả.
- **Mô phỏng**: chữ ký số (băm nội dung, chưa gọi nhà cung cấp), cổng đơn thuốc quốc gia (bộ nối giả có nút chèn lỗi) và nút "Gửi đơn qua Zalo" (chỉ hiện bản xem trước tin nhắn, không gửi, không gọi mạng). Mọi nơi hiển thị đều có nhãn.
- Tin Zalo xem trước chỉ có tên phòng khám, tên bệnh nhân, mã đơn, ngày kê, số nhận đã che (`091****678`) và chỗ cho đường dẫn xem đơn (M1); **không** có thuốc hay chẩn đoán. Gửi thật (ZNS) cần bệnh nhân đồng ý, mẫu tin được duyệt và ý kiến pháp chế (kế hoạch, T-ZALO, T-CONSENT). Nội dung tin dựng bằng hàm thuần `zaloPrescriptionMessage` (`packages/clinical/src/zalo.ts`) để M1 dùng lại.
- Danh mục ICD-10, thuốc và đơn mẫu là **tập con minh họa**, chưa được cố vấn y khoa duyệt, không dùng lâm sàng.
- Chưa có: gửi tin Zalo thật (ZNS), đặt lịch, nhắc lịch, thu tiền (xem kế hoạch, mục 5 và 6).
- **Ngoại tuyến** chạy thật, trong phạm vi sau (kế hoạch, mục 5.8 và 5.9):
  - Tính theo **từng máy**: khi phòng khám mất Internet, hai máy không thấy nhau; người được cấp số ở máy lễ tân chỉ hiện ở máy bác sĩ khi có mạng lại.
  - Khi mất mạng chỉ tìm được người trong hàng chờ hôm nay, hồ sơ đã mở trong ngày và bệnh nhân tạo trên máy đó; không lưu toàn bộ danh sách bệnh nhân. Tìm bằng CCCD chỉ ra bệnh nhân tạo trên máy đó.
  - Làm được khi mất mạng: tìm, tạo bệnh nhân, cấp số (số tạm), gọi vào khám, khám, ký hoặc kết thúc khám, in, in lại. Cần mạng: hủy lượt, sửa dị ứng và tiền sử, bổ sung CCCD, liên thông, thời gian khám, nhật ký truy cập.
  - Đơn ký khi mất mạng dùng chữ ký mô phỏng như khi có mạng, chưa lên cổng cho tới khi đồng bộ; **chưa có** chờ ký số và gửi cổng ở mức đầy đủ. Giá trị pháp lý của đơn in khi chưa liên thông là câu hỏi mở (kế hoạch, Q3).
  - Xung đột (người khác đã mở hoặc kết thúc lượt khám đó trong lúc máy mất mạng) chỉ được **phát hiện và báo**: bản khám giữ trên máy và in lại được, nhưng chưa có cách đưa nó lên máy chủ. Đơn bị quy tắc của máy chủ chặn hẳn khi đồng bộ cũng vậy: chỉ còn cách liên hệ bệnh nhân và kê lại. Không có nút xóa hay hủy mục chưa đồng bộ.
  - Đóng tab trong lúc mất mạng thì mất phiên đăng nhập; dữ liệu trên máy còn nguyên nhưng phải có mạng mới đăng nhập lại được.
  - Lỗi đã biết, chưa sửa trên `main`: "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay có lúc lưu lượt khám nhưng không in đơn, phải bấm lại (thiết kế sửa OFF-8 đang chờ duyệt); hàng chờ có lúc hiện hai dòng cho một lượt khám sau khi mất phản hồi ở "cấp số"; chế độ "Mất mạng" không tự thoát khi không còn mục chờ; mục "thử lại" có thể nằm chờ thêm tới 30 giây. Không lỗi nào làm mất hay trùng bản ghi trên máy chủ.
  - Mới thử bằng kiểm thử tự động trên Chromium không giao diện (máy dev và CI); chưa thử trên máy tính bảng, trên trình duyệt khác, và chưa có bác sĩ thật dùng.
- Dữ liệu trên máy (bản nháp lượt khám, hàng đợi đồng bộ, bộ đệm hồ sơ, đơn ký khi mất mạng) lưu trong IndexedDB, mã hóa AES-GCM, mỗi người dùng một kho. Đăng xuất xóa cả kho lẫn khóa, trừ khi còn mục chưa đồng bộ: khi đó kho đã mã hóa được giữ lại để lần đăng nhập sau của đúng người đó gửi tiếp. Khóa nằm cùng máy với dữ liệu và không có mã PIN, nên **chưa** bảo vệ được trước người dùng chung trình duyệt hay người lấy được ổ đĩa (kế hoạch, OFF-5); cần xác thực thật (T-IDP).
- **Medplum không hoàn tác `transaction` khi một mục lỗi** (xem kế hoạch, F11): việc hoàn tất lượt khám được ghi theo từng bước chạy lại được, không dựa vào hoàn tác. Đóng lượt khám là một lời ghi riêng, gửi sau cùng, chỉ khi mọi bản ghi của lượt khám đã có.
- **Nhiều lời ghi tới cùng lúc** (kế hoạch, F13): Medplum có thể từ chối một lời tạo có điều kiện vì xung đột giao dịch (409 mã 40001). BFF tự thử lại có giới hạn (3 lần, chờ ngẫu nhiên) và ghi một dòng log mỗi lần; hết lượt thì trả 503 kèm `retry: true`, giao diện tự gửi lại cùng `clientUuid` nên không tạo bản ghi trùng. Chưa thử với nhiều bản BFF chạy song song.
- Nhật ký truy cập ghi vào file cục bộ (`services/bff/.data/`); chuyển ra kho bất biến ở M1 (T-AUD).
- Service worker của PWA chỉ lưu vỏ ứng dụng, **không** lưu phản hồi API (có dữ liệu bệnh nhân). Dữ liệu dùng khi mất mạng nằm trong kho mã hóa nói trên.
- `services/bff/.demo-tenants.json` chứa bí mật của các tài khoản máy Medplum; đã nằm trong `.gitignore`, không commit.
