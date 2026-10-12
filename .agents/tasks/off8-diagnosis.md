# Chẩn đoán CI đỏ — `apps/clinic-web/e2e/offline-sign.mjs` hỏng ở bước 11 (OFF-8, 503 lúc ký)

Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ci-fix-off8-e2e` (nhánh
`feat/docker-demo-off8-search-p2`, HEAD `ca11f77` = `main`).
Môi trường: Windows + PowerShell, pnpm 12.8.1, Node v22.23.2, chrome-headless-shell của
Playwright (`chromium_headless_shell-1243`). CI đỏ: run 38199281630.

**Đã tái hiện được tại chỗ, cùng một thông điệp, cùng một dòng.**

---

## 1. Lệnh đã chạy

```powershell
# openssl chỉ cần cho infra/medplum/setup.mjs; stack Medplum đã chạy nên chỉ đặt PATH cho chắc
$env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"

cd "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ci-fix-off8-e2e"
pnpm install                                        # Done in 11.3s, 459 gói, lockfile không đổi
pnpm --filter @phongmach/clinic-web build           # tsc + vite build: ✓ built in 3.39s, PWA 9 entries

pnpm --filter @phongmach/clinic-web preview         # chạy nền
#   -> "Port 4173 is in use, trying another one..."  -> http://localhost:4174/

$env:E2E_URL = "http://localhost:4174"
pnpm --filter @phongmach/clinic-web e2e:offline
```

Khác biệt môi trường so với CI (ghi rõ để không nhận công sai):

| | CI | Tại chỗ |
|---|---|---|
| Hệ điều hành | Linux | Windows 11 |
| Trình duyệt | `/usr/bin/google-chrome` (CHROMIUM_PATH) | `chrome-headless-shell-1243` của Playwright |
| Giao diện | build + preview ở 4173 | build + preview ở **4174** (4173 đang do worktree `fix-e2e-off8` giữ; theo bất biến "không bao giờ dừng tiến trình không do mình tạo" nên không giết nó) |
| BFF | `DEMO_AUTH=1` dựng mới + seed mới | **tái dùng BFF đang chạy ở 127.0.0.1:8110** (tiến trình `tsx src/server.ts` của worktree `fix-e2e-off8`, cùng mã sản phẩm `ca11f77`, cùng Medplum, dữ liệu demo đã seed) — tránh seed lại và tránh hạn mức đăng nhập Medplum 5 lần/phút/IP |
| Medplum | dựng mới trong job | stack dùng chung, **không recreate** (xem §5) |

Dù khác hệ điều hành và cổng, lỗi vẫn ra **đúng y như CI** → nguyên nhân không phụ thuộc môi trường.

## 2. Output then chốt của lần tái hiện

```
✓  1. có mạng: cấp số 30 cho Nguyễn Văn An; máy đã nạp trước hàng chờ và hồ sơ (bộ đệm mã hóa)
✓  2. mất mạng: tìm "nguyen van an" trong bộ đệm ("Mất mạng: chỉ tìm trong 1 hồ sơ trên máy này") …
✓  3. mất mạng: tạo "Zq Ngoại Tuyến 9901v" và cấp số 031 (tạm); tìm lại được bằng CCCD trong bộ đệm
✓  4. hàng chờ và màn hình chờ khi mất mạng …
✓  5. gọi vào khám khi mất mạng … đòi xác nhận "allergy-unknown"; tiền sử "chưa tải"
✓  6. ký khi mất mạng: mã PM-261012-7WA43C sinh ở máy, nhãn "KÝ KHI MẤT MẠNG", PDF đúng 1 trang A5
✓  7. đọc thẳng IndexedDB: 6 mục chờ và bộ đệm, không có PII ở dạng rõ
✓  8. mất mạng: xem trước Zalo (mô phỏng) … 0 yêu cầu mạng; Esc đóng
✓  9. có mạng lại: tự đồng bộ hết; máy chủ có đúng 1 bệnh nhân, 1 lượt khám, 1 đơn, giữ số 31
✓ 10. mất phản hồi khi ký (máy chủ đã ghi): in từ máy, gửi lại cùng UUID, đúng 1 lượt khám mới,
       mã PM-261012-D2NCZG trùng
✗ Hỏng ở bước 11
 locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' })
      .filter({ has: getByTestId('call') }).getByTestId('call')
    at …\apps\clinic-web\e2e\offline-sign.mjs:230:138
```

Giống CI: 1–10 xanh, bước 11 (`// OFF-8: máy chủ trả 503 …`) hỏng ở **dòng 230** — cùng
locator, cùng `TimeoutError`.

Nhật ký đầy đủ: `%TEMP%\off8-repro-1.log`. Ảnh chụp lúc hỏng:
`apps/clinic-web/e2e/screenshots/FAILED-offline.png`. Ảnh của CI đã tải về:
`.agents/tasks/ci-screenshots/FAILED-offline.png`
(`gh run download 38199281630 -n e2e-screenshots -D ….agents\tasks\ci-screenshots`).

## 3. Trạng thái quan sát được lúc hỏng

### Bằng chứng A — ảnh chụp (tại chỗ và CI **giống nhau từng chi tiết**)

Cả hai ảnh đều cho thấy ứng dụng **vẫn đứng ở màn hình Khám**, không phải Hàng chờ:

- thẻ đang chọn trên thanh trên: **"Đang khám: Nguyễn Văn An"** (nền xanh);
- nội dung: thẻ kết quả **"Đã ký đơn khi mất mạng"** của bước 10 — mã đơn
  `PM-261012-D2NCZG` (tại chỗ) / `PM-261012-R4TBRB` (CI), huy hiệu "Đã đồng bộ lên máy chủ",
  các nút "In lại đơn" / "Gửi đơn qua Zalo" / **"Về hàng chờ"**;
- huy hiệu đồng bộ: "Có mạng · Đã đồng bộ hết".

Tức là **không có một `queue-row` nào trong DOM**: `Shell.tsx` (dòng 96–105) chỉ dựng đúng MỘT
màn hình một lúc (`screen === 'queue' && <Queue …>`), nên khi `screen === 'visit'` thì cả danh
sách hàng chờ không tồn tại. Locator chờ 30 s rồi hết giờ. Đây là lỗi tiền đề, **không phải**
tính nhất quán trễ: không có phần tử nào để nhất quán.

### Bằng chứng B — trạng thái hàng chờ trên máy chủ sau lần chạy

```powershell
$s = Invoke-RestMethod http://127.0.0.1:8110/api/session -Method Post `
      -ContentType application/json -Body '{"tenant":"noi-tong-quat","userId":"noi-doctor"}'
Invoke-RestMethod http://127.0.0.1:8110/api/queue -Headers @{authorization="Bearer $($s.token)"}
```

```
30 | Nguyễn Văn An        | done | noi-doctor      <- lượt do bước 1 cấp số, bước 10 đã hoàn tất
31 | Zq Ngoại Tuyến 9901v | done | noi-doctor
```

Số 30 là lượt mà bước 1 cấp cho An; bước 10 gọi vào khám rồi ký (máy chủ **đã ghi** dù trình
duyệt thấy lỗi mạng) nên lượt chuyển **`done`**. Trong `Queue.tsx` (dòng 87–91) nút `call` chỉ
được dựng khi `i.status === 'waiting'`:

```tsx
{i.status === 'waiting' && clinical && (
  <button … data-testid="call">Gọi vào khám</button>
)}
```

Nên **ngay cả khi** bấm "Về hàng chờ" trước, dòng của An vẫn nằm ở mục "Đã xong hoặc hủy" và
không có nút `call`: bước 11 sẽ hỏng lần nữa ở cùng locator.

### Bằng chứng C — loại trừ giả thuyết "nhất quán trễ"

- Lỗi không phải "0 kết quả rồi có" mà là **phần tử không bao giờ tồn tại** (màn hình khác).
- Trạng thái `done` của An ở §3B là **xác định** (do chính bước 10 tạo ra), không phải độ trễ
  đọc-sau-ghi: chờ thêm bao lâu cũng không làm `done` quay về `waiting`.
- `Queue` tự tải lại hàng chờ mỗi 5 s (`usePoll`, `Queue.tsx` dòng 19 + `hooks.ts`), nên nếu
  chỉ là trễ đồng bộ thì 30 s auto-wait của Playwright đã đủ.

### So khớp hai khuyết điểm của bài test

| # | Khuyết điểm trong `offline-sign.mjs` | Hệ quả |
|---|---|---|
| 1 | Khối OFF-8 (dòng 226–250) **thiếu `await page.getByTestId('back-to-queue').click()`** mà khối "mất phản hồi" ở trên có (dòng 195) | màn hình còn ở Khám → không có `queue-row` nào → **chính là lỗi CI** |
| 2 | Khối OFF-8 giả định An vẫn `waiting`, nhưng bước 10 đã hoàn tất lượt của An → `done`, không còn nút `call`; không có bước nào cấp số lại cho An | sửa xong #1 vẫn đỏ ở cùng locator |

Không có mâu thuẫn nào với mã sản phẩm OFF-8: bước 11 **chưa bao giờ chạy tới** chỗ dựng 503
(`page.route`, dòng 234) — biến `busy` còn 0, `signWithTemplate()` chưa gọi. Các khẳng định của
OFF-8 (in một tờ từ máy, tự gửi lại cùng UUID, đúng 1 lượt khám mới, mã trùng) **chưa được e2e
kiểm lần nào**; đó là việc của bước sửa, không phải của chẩn đoán này.

## 4. KẾT LUẬN

Lỗi nằm trong **bài test** `apps/clinic-web/e2e/offline-sign.mjs`, khối OFF-8 dòng 226–250
(chỗ hỏng: dòng 230): thiếu điều hướng "Về hàng chờ" và thiếu việc dựng lại tiền đề "An đang
chờ" sau khi bước 10 đã hoàn tất lượt khám của An. Mã sản phẩm OFF-8 (`src/local/sync.ts`,
`src/local/client.ts`, `src/api.ts`, `src/local/ops.ts` trong `d589343`) không liên quan tới
lần hỏng này và chưa bị bài test này buộc tội — nhưng cũng chưa được nó chứng minh.

**KẾT LUẬN: lỗi ở BÀI TEST.**

(Cảnh báo cho bước sửa: vì OFF-8 là một trong hai lỗi dự án liệt "cần kiểm chứng lại trước demo
13/11", nếu sau khi sửa tiền đề mà bước 11 vẫn đỏ ở các khẳng định OFF-8 — không in, báo "CHƯA
in", hoặc `added503.length !== 1` — thì khi đó mới là lỗi MÃ SẢN PHẨM và phải báo riêng, không
được nới bài test cho qua.)

## 5. Bất biến môi trường — Medplum KHÔNG bị recreate

Trước và sau lần tái hiện, cùng container id, vẫn running:

```
6bdd98a57bb8 phongmach-medplum-medplum-server-1 Up 8 hours  created=2026-10-04 16:20:49 +07
396bce70e6ed phongmach-medplum-postgres-1       Up 8 hours (healthy) created=2026-10-02 20:43:42 +07
75c24bc8cbaf phongmach-medplum-redis-1          Up 8 hours (healthy) created=2026-10-02 20:43:42 +07
{"ok":true,"version":"5.2.0-8b7e513","platform":"linux","postgres":true,"redis":true}
```

Không chạy `docker compose down`, không `-v`, không xóa volume, không đụng
`phongmach-demo-*` hay các stack khác.

## 6. KẾ HOẠCH SỬA (không làm yếu phép kiểm)

Giữ nguyên **toàn bộ** các khẳng định của bước 11 (`busy === 1`; trang in có "KÝ KHI MẤT MẠNG";
`added503.length === 1`; `added503[0].prescription.code === busyCode`), giữ bước 12
(`atPrint` = `[0,0,0]`, ba lần in), **không** nới timeout, **không** `sleep`, **không** xóa bước
hay assertion nào. Chỉ dựng lại đúng tiền đề mà khối OFF-8 cần.

- [ ] 1. Dựng lại tiền đề của khối OFF-8 trong `apps/clinic-web/e2e/offline-sign.mjs`:
      chèn ngay sau dòng 229 (`const before503 = …`) và trước dòng 230 — về hàng chờ, cấp số
      lại cho **đúng** An (theo `anId`, không theo tên) qua phiên BFF `doctor` đã có, rồi bấm
      `call` trên dòng chọn theo `data-number` thay vì theo tên:

```js
  // Khối "mất phản hồi" ở trên đã hoàn tất lượt khám của An (máy chủ ghi xong dù trình duyệt thấy lỗi mạng) nên dòng của An
  // chuyển 'done' và không còn nút "Gọi vào khám"; màn hình cũng còn ở trang kết quả ký. Dựng lại tiền đề của khối OFF-8:
  // về hàng chờ rồi cấp số mới cho ĐÚNG An (theo id, không theo tên — phòng khám demo có nhiều người cùng tên).
  await page.getByTestId('back-to-queue').click();
  const again = await doctor('POST', '/api/queue', { clientUuid: crypto.randomUUID(), patientId: anId, specialty: 'noi' });
  assert.equal(again.item.status, 'waiting', `cấp số lại cho An phải ra lượt đang chờ: ${JSON.stringify(again)}`);
  // Hàng chờ tự tải lại mỗi 5 giây; Playwright chờ ĐÚNG điều kiện (dòng có số đó, có nút gọi), không ngủ cố định.
  const anRow = page.locator(`[data-testid="queue-row"][data-number="${again.item.number}"]`);
  await anRow.getByTestId('call').click();
```

      đồng thời **xóa** dòng 230 cũ (`page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' })…click()`).
      Lý do chọn id + `data-number` thay vì lọc theo tên: hàng chờ demo hiện có nhiều người tên
      "Nguyễn Văn An" và cả "Nguyen Van An" không dấu (đã thấy ở §3B), lọc theo tên có thể bấm
      sang người khác, làm `anVisits()` đếm sai và đỏ ở chỗ không liên quan.
      Hợp đồng `POST /api/queue` đã kiểm trong mã: `services/bff/src/routes/clinical.ts`
      dòng 34–43 (`checkInBody`: `clientUuid`, `patientId`, `specialty` 'noi' | 'nhi',
      `priority` mặc định 'normal') và dòng 111–129 (trả `{ item, created }`, 201 khi tạo mới);
      `services/bff/src/medplum.ts` dòng 200–227 cho phép cấp số lại trong cùng ngày (số mới,
      không trùng, idempotent theo `clientUuid`).
      Files: `apps/clinic-web/e2e/offline-sign.mjs`
      Verify: `$env:E2E_URL="http://localhost:4174"; pnpm --filter @phongmach/clinic-web e2e:offline`
      → "Đạt 14/14" (bước 11 in được tờ A5 từ máy, bước 12 `atPrint = [0,0,0]`), exit code 0.

- [ ] 2. Soát hai bài e2e ngoại tuyến còn lại xem có cùng khuyết điểm "ký xong rồi dùng lại hàng
      chờ" không: `offline-conflict.mjs` (ca 401 đúng lúc ký, cũng mới thêm ở `d589343` và cũng
      chưa chạy thật) và `offline-cycles.mjs`. Chỉ sửa nếu thật sự thiếu `back-to-queue` /
      thiếu cấp số lại; không đổi khẳng định.
      Files: `apps/clinic-web/e2e/offline-conflict.mjs`, `apps/clinic-web/e2e/offline-cycles.mjs` (nếu cần)
      Verify: `pnpm --filter @phongmach/clinic-web e2e:conflict` xanh (chạy cách bài trên ≥ 1
      phút để không chạm hạn mức đăng nhập Medplum 5 lần/phút/IP).

- [ ] 3. Kiểm chứng không hồi quy phần không-e2e (bài test chỉ sửa tệp `.mjs` nên phải xanh y như trước).
      Files: không đổi
      Verify: `pnpm typecheck` → 9 gói Done; `pnpm test` → tất cả xanh (clinic-web 210 bài).

- [ ] 4. Chạy PHÉP THỬ NGƯỢC ở §7, ghi kết quả (đỏ đúng chỗ) vào
      `.agents/tasks/off8-diagnosis.md` hoặc một `verification.md` cạnh nó, rồi commit trên
      nhánh của worktree. KHÔNG merge, KHÔNG push.
      Verify: `git -C "…\.worktrees\ci-fix-off8-e2e" status --short` chỉ còn tệp mong đợi;
      `git log --oneline -1` có commit của bản sửa.

Ghi chú khi chạy lại ở máy này: giao diện preview đang ở **http://localhost:4174** (cổng 4173 do
worktree khác giữ) và BFF dùng chung ở 127.0.0.1:8110. Nếu preview đã tắt:
`pnpm --filter @phongmach/clinic-web build` rồi `pnpm --filter @phongmach/clinic-web preview`,
đọc cổng thực tế trong output và đặt `E2E_URL` theo đúng cổng đó (dùng `localhost`, không phải
`127.0.0.1`: vite preview chỉ lắng nghe trên `::1` ở máy này).

## 7. PHÉP THỬ NGƯỢC dự kiến (mỗi lần áp tạm rồi hoàn tác bằng `git checkout`)

| # | Cố ý làm hỏng | Kỳ vọng ĐỎ đúng chỗ |
|---|---|---|
| N1 | Bỏ lại đoạn vừa chèn ở việc 1 (về đúng mã như CI) | đỏ ở bước 11, `locator.click: Timeout` trên `call` — trùng khít lỗi CI, chứng minh bản sửa đúng là cái chữa lỗi |
| N2 | Chỉ bỏ `await page.getByTestId('back-to-queue').click()` (giữ phần cấp số lại) | đỏ ở bước 11 cùng locator → chứng minh điều hướng là điều kiện cần |
| N3 | Chỉ bỏ phần cấp số lại (giữ `back-to-queue`) | đỏ ở bước 11 cùng locator → chứng minh tiền đề "An đang chờ" là điều kiện cần (và `done` thật sự không có nút `call`) |
| N4 | Trong bài test, đổi tiêu đề `date` của phản hồi 503 (dòng 237) thành **ngày hôm qua** | hàng rào ngày A-1 chặn chuyển → `client.complete()` trả `failed` "CHƯA in" → đỏ ở `offline-sign-result` (dòng 240), KHÔNG đỏ ở locator hàng chờ → chứng minh bước 11 thật sự đi qua nhánh OFF-8 |
| N5 | Trong mã sản phẩm `src/local/sync.ts`, trả `settleFocus` về hành vi trước OFF-8 (chỉ chuyển khi mất mạng) | đỏ ở bước 11: không có `offline-sign-result` / không có tờ in "KÝ KHI MẤT MẠNG" → chứng minh bước 11 là phép kiểm hồi quy thật của OFF-8, không phải bài test rỗng |
| N6 | Trong mã sản phẩm, sinh `clientUuid` MỚI khi gửi lại sau 503 | đỏ ở `added503.length === 1` (thành 2) hoặc ở so mã đơn → chứng minh phép kiểm "không trùng bản ghi" còn hiệu lực |

N1–N3 là bắt buộc (chứng minh bản sửa chữa đúng bệnh). N4 bắt buộc (chứng minh bước 11 không bị
biến thành bài test rỗng). N5–N6 nên làm nếu còn hạn mức đăng nhập Medplum; nếu bỏ, ghi rõ lý do
thay vì im lặng.
