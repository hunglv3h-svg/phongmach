# CI fix — PR #17 (feat/docker-demo-off8-search-p2)

## Chuẩn bị môi trường

Lệnh đã chạy (cwd = repo gốc `d:\My Documents D\UNIGIS\PM\phongmach`):

```
git fetch origin
git worktree add .worktrees/ci-fix-off8-e2e feat/docker-demo-off8-search-p2
New-Item -ItemType Directory -Force -Path ".worktrees\ci-fix-off8-e2e\.agents\tasks"
docker ps
curl.exe -s http://localhost:8103/healthcheck
```

Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ci-fix-off8-e2e`
Nhánh: `feat/docker-demo-off8-search-p2` (tracking `origin/feat/docker-demo-off8-search-p2`)
HEAD: `ca11f77` — trùng với `main` và `origin/feat/docker-demo-off8-search-p2` tại thời điểm này.

Không đụng: `.worktrees/off8-sign-print`, `.worktrees/trial1-seed-data`, `.worktrees/trial2-ui-v02`, `.worktrees/fix-e2e-off8`, `.worktrees/m0-6-demo-rehearsal`, `main`.

## Container id trước khi làm

| Container | ID | Trạng thái |
|---|---|---|
| phongmach-medplum-medplum-server-1 | `6bdd98a57bb8` | Up 8 hours, 0.0.0.0:8103->8103/tcp |
| phongmach-medplum-postgres-1 | `396bce70e6ed` | Up 8 hours (healthy) |
| phongmach-medplum-redis-1 | `75c24bc8cbaf` | Up 8 hours (healthy) |

Khớp đúng id mong đợi; không container nào bị recreate (chỉ đọc `docker ps`, không chạy compose up/down).

Healthcheck `http://localhost:8103/healthcheck`:

```json
{"ok":true,"version":"5.2.0-8b7e513","platform":"linux","runtime":"v24.18.1","postgres":true,"redis":true,"redisInstances":{"default":true}}
```

Demo `phongmach-demo-web-1` (`267e110ffea0`, cổng 8081) vẫn Up (healthy) — không đụng tới.

---

# Bản sửa và kiểm chứng (bước sửa CI đỏ — e2e `offline-sign.mjs` bước 11)

## KẾT LUẬN: lỗi ở BÀI TEST (đúng như chẩn đoán `off8-diagnosis.md`)

Mã sản phẩm OFF-8 KHÔNG bị sửa một dòng nào. Chỉ sửa `apps/clinic-web/e2e/offline-sign.mjs`
(+12 / −1 dòng), chữa hai khuyết điểm của khối OFF-8:

1. **Thiếu tiền đề.** Khối "mất phản hồi" ở trên đã hoàn tất lượt khám của Nguyễn Văn An (máy chủ
   ghi xong dù trình duyệt chỉ thấy lỗi mạng) nên dòng của An chuyển `done`, không còn nút "Gọi vào
   khám", và màn hình còn đứng ở trang kết quả ký. Bản sửa: bấm "Về hàng chờ", cấp số MỚI cho ĐÚNG
   An qua `POST /api/queue` (theo `patientId`, không theo tên — hàng chờ demo có nhiều "Nguyễn Văn
   An" và cả "Nguyen Van An" không dấu), rồi bấm `call` trên dòng chọn theo `data-number`. Chờ bằng
   auto-wait của Playwright trên ĐÚNG điều kiện, KHÔNG `sleep`, KHÔNG `page.waitForFunction` với
   hàm async.
2. **Lỗi console do chính bài test dựng ra chưa được khai báo.** Khối OFF-8 trả 503 bằng
   `route.fulfill` nhưng không đặt `d.expected`, nên "Failed to load resource … 503" rơi vào
   `problems` và bước 15 (phép kiểm console) đỏ. Bản sửa đặt `d.expected = /status of 503/` ĐÚNG
   trong khối đó rồi trả về `undefined` ngay sau khi đồng bộ xong — cơ chế y như
   `offline-conflict.mjs` dùng cho 409/422/401; không nới cho loại lỗi nào khác, phép kiểm console
   cuối bài còn nguyên.

Không xoá bước nào, không xoá assertion nào, không nới timeout, không `sleep`. Mọi khẳng định của
bước 11 (`busy === 1`; trang in có "KÝ KHI MẤT MẠNG"; `added503.length === 1`;
`added503[0].prescription.code === busyCode`) và bước 12 (`atPrint = [0,0,0]`) giữ nguyên.

## Môi trường chạy kiểm chứng

| | CI | Tại chỗ (bước này) |
|---|---|---|
| Trình duyệt | google-chrome (Linux) | `chrome-headless-shell` của Playwright (Windows) |
| Giao diện | bản build, cổng 4173 | bản build, cổng **4176** (4173/4174/4175 do tiến trình của phiên khác và của chính bước này giữ; theo bất biến "không dừng tiến trình không do mình tạo" nên không giết chúng) |
| BFF | `DEMO_AUTH=1 OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000` | BFF riêng của worktree này ở **127.0.0.1:8120**, cùng cấu hình như CI (mấy lượt chạy đầu dùng tạm BFF 8110 của worktree khác — xem "Hạn chế") |
| Medplum | dựng mới trong job | stack dùng chung, **không recreate** |

Lệnh (PowerShell, `$wt` = đường dẫn worktree):

```
$env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
pnpm --dir $wt --filter @phongmach/clinic-web build
# BFF riêng (trong services/bff): DEMO_AUTH=1 PORT=8120 OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000 pnpm start
# apps/clinic-web/.env tạm: BFF_URL=http://127.0.0.1:8120 và PREVIEW_PORT=4176
#   (vite đọc BFF_URL/PREVIEW_PORT qua loadEnv từ tệp .env, không qua biến tiến trình)
pnpm --dir $wt --filter @phongmach/clinic-web e2e:offline     # với E2E_URL=http://localhost:4176
```

## 1. `e2e:offline` XANH toàn bộ, kể cả bước 11

```
✓ 10. mất phản hồi khi ký (máy chủ đã ghi): in từ máy, gửi lại cùng UUID, máy chủ vẫn chỉ có 1 lượt khám mới, mã PM-261012-PBM7HS trùng
✓ 11. 503 lúc ký (OFF-8): in một tờ A5 từ máy, không im lặng; tự gửi lại, máy chủ có đúng 1 lượt khám mới, mã PM-261012-BPYP65 trùng
✓ 12. ba lần in đều gọi print() khi không còn yêu cầu IndexedDB nào đang dở (hàng rào in)
✓ 13. đăng xuất khi còn mục chờ: hỏi "Chờ đồng bộ" / "Đăng xuất, giữ dữ liệu", không có nút hủy; …
✓ 14. hết mục chờ: đăng xuất xóa kho và khóa như trước
✓ 15. không có lỗi nào trong console của trình duyệt (ngoài lỗi tải do cố ý ngắt mạng)

Đạt 15/15.
```

exit code 0. Nhật ký: `%TEMP%\off8-fix-run3.log` (lần xanh đầu tiên) và `%TEMP%\off8-fix-run4.log`
(chạy lại sau khi đã hoàn nguyên mọi đột biến — vẫn 15/15).

## 2. PHÉP THỬ NGƯỢC (mutation testing) — 5 đột biến, tất cả ĐỎ ĐÚNG CHỖ

Mỗi đột biến áp tạm rồi hoàn nguyên (`git checkout --` cho mã sản phẩm; khôi phục bản sao
`%TEMP%\offline-sign.FIXED.mjs` cho bài test).

| # | Đột biến đã áp | Kết quả | Output then chốt |
|---|---|---|---|
| N1 | Hoàn nguyên TOÀN BỘ bản sửa (về đúng mã như CI) | ĐỎ bước 11 | `locator.click: Timeout 30000ms exceeded` — `getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).filter({ has: getByTestId('call') }).getByTestId('call')` tại `offline-sign.mjs:230:138`, `name: 'TimeoutError'` — **trùng khít lỗi CI run 38199281630** |
| N2 | Chỉ bỏ `back-to-queue` (giữ phần cấp số lại) | ĐỎ bước 11 | `locator.click: Timeout` — `locator('[data-testid="queue-row"][data-number="65"]').getByTestId('call')` (dòng 237) ⇒ điều hướng là điều kiện CẦN |
| N3 | Chỉ bỏ phần cấp số lại, dùng lại locator theo tên như mã CI | ĐỎ bước 11 | `locator.waitFor: getByTestId('visit')` hết giờ (dòng 236) + console `409 (Conflict)` ⇒ bấm vào dòng An của NGƯỜI KHÁC; tiền đề "An đang chờ" là điều kiện CẦN và lọc theo tên thật sự không an toàn |
| N4 | Trong bài test: tiêu đề `date` của phản hồi 503 lùi 36 giờ (hôm qua) | ĐỎ bước 11, ĐÚNG chỗ khác | `locator.waitFor: getByTestId('offline-sign-result')` hết giờ (dòng 251): hàng rào ngày A-1 chặn chuyển → `complete()` báo "CHƯA in". KHÔNG đỏ ở locator hàng chờ ⇒ bước 11 thật sự đi qua nhánh OFF-8 |
| N5 | **Mã sản phẩm**: `src/local/sync.ts` → `settleFocus` thêm `if (this.current.online) continue;` (hành vi trước OFF-8: chỉ chuyển khi mất mạng) | Bước 1–10 XANH, ĐỎ bước 11 | `locator.waitFor: getByTestId('offline-sign-result')` hết giờ (dòng 250) ⇒ bước 11 là phép kiểm hồi quy THẬT của OFF-8, không phải bài test rỗng |

Hoàn nguyên đã xác nhận: `git checkout -- apps/clinic-web/src/local/sync.ts` (N5), khôi phục
`offline-sign.mjs` từ bản sao (N1–N4), build lại để `dist` khớp mã sản phẩm sạch; sau đó
`git status --short` chỉ còn `M apps/clinic-web/e2e/offline-sign.mjs` + `?? .agents/`, và
`e2e:offline` chạy lại **15/15 xanh**.

Nhật ký từng đột biến: `%TEMP%\off8-mutation-N1.log` … `off8-mutation-N5.log`.

## 3. `typecheck` và `test` XANH

```
pnpm --dir $wt typecheck   → 9 gói "Done" (cuối: services/bff, apps/clinic-web)
pnpm --dir $wt test        → Test Files 1,1,1,2,1,1,14,10 passed; BFF: 128 tests passed
```

Nhật ký: `%TEMP%\off8-typecheck.log`, `%TEMP%\off8-unit.log`.

## 4. Các bài e2e khác (chạy cả bộ)

| Bài | Kết quả tại chỗ | Ghi chú |
|---|---|---|
| `e2e` (smoke.mjs) | **XANH 13/13** | |
| `e2e:visit` | xanh bước 1–16, **ĐỎ bước 17** | hạn chế môi trường (hai BFF), không liên quan bản sửa — bản sửa chỉ chạm `offline-sign.mjs`, `visit.mjs` không dùng tệp đó |
| `e2e:offline` | **XANH 15/15** | mục tiêu của bước này |
| `e2e:conflict` | xanh bước 1–11, **ĐỎ bước 12** (2/2 lần) | **phát hiện mới, ngoài phạm vi** — xem dưới |

### `e2e:visit` bước 17 — hạn chế môi trường, không phải hồi quy

Bước 17 chờ `gateway-status` = "Chờ gửi lại" sau khi bật lỗi "mất kết nối cổng" bằng `sim-down`.
Trạng thái cổng mô phỏng nằm trong BỘ NHỚ của một tiến trình BFF, nhưng máy này có **hai** BFF chạy
song song trên cùng Medplum và cùng tenant demo: 8110 (worktree `fix-e2e-off8` của phiên khác, cổng
mô phỏng đang "up") và 8120 (của bước này, vừa bị `sim-down`). Bộ phát hàng đợi gửi của BFF 8110
nhặt luôn Task của đơn vừa ký và gửi THÀNH CÔNG, nên đơn không bao giờ vào "Chờ gửi lại". CI chỉ có
một BFF nên không có hiện tượng này; không dừng tiến trình của phiên khác (bất biến). Hai lượt chạy
trước đó còn gặp 409 ở bước 10 vì phiên khác chạy `resetDemoQueue` giữa lượt khám của bài; lượt sau
bước 10 xanh.

### `e2e:conflict` bước 12 — PHÁT HIỆN MỚI, cần quyết định của chủ dự án

Bước 12 (khối OFF-8 "401 đúng lúc ký", cũng thêm ở `d589343` và cũng chưa từng chạy thật) đỏ
**xác định, 2/2 lần**:

```
✗ Hỏng ở bước 12
 AssertionError: OFF-8: 401 lúc ký phải in từ máy hoặc hiện kết quả ký, không im lặng bỏ qua
 at apps/clinic-web/e2e/offline-conflict.mjs:308
```

Bằng chứng ở mã nguồn: `src/api.ts:123` — `if (res.status === 401 && options.token) onUnauthorized?.()`
→ `App.tsx:26` đưa ngay về màn hình đăng nhập, nên màn hình khám (và khung in) bị tháo trước khi
người dùng thấy kết quả ký. Trong khi đó bộ máy đồng bộ (`sync.ts`) CÓ chuyển mục sang dạng ngoại
tuyến khi 401 (`settleFocus` chạy sau khi `verdict === 'paused'` ngắt vòng gửi), và các bài unit
`client.test.ts:368`, `sync.test.ts:457` khẳng định đúng điều đó ở mức bộ máy.

Nghĩa là: ở mức bộ máy OFF-8 đã đúng, nhưng ở mức vỏ ứng dụng, 401 lúc ký vẫn "im lặng" theo nghĩa
người dùng bị đẩy về màn hình đăng nhập và KHÔNG thấy tờ đơn. Làm bước 12 xanh buộc phải **đổi điều
người dùng thấy** (giữ màn hình khám / in xong rồi mới về đăng nhập) — đó là quyết định sản phẩm,
nên bước này KHÔNG tự ý sửa mã sản phẩm và KHÔNG nới bài test.

Hệ quả cho CI: sau bản sửa này job e2e sẽ đi qua `e2e:offline`, nhưng dự kiến đỏ ở `e2e:conflict`
bước 12. Cần một quyết định riêng: đổi hành vi 401 trong `App.tsx`/`api.ts`, hay đổi kỳ vọng của
bước 12 cho khớp hành vi đã chốt.

## 5. BẤT BIẾN: Medplum KHÔNG bị recreate

`docker ps` trước và sau toàn bộ việc kiểm chứng — cùng container id, vẫn running:

```
6bdd98a57bb8 phongmach-medplum-medplum-server-1 Up 8 hours
396bce70e6ed phongmach-medplum-postgres-1       Up 8 hours (healthy)
75c24bc8cbaf phongmach-medplum-redis-1          Up 8 hours (healthy)
{"ok":true,"version":"5.2.0-8b7e513","platform":"linux","postgres":true,"redis":true}
```

Chỉ `docker ps` và `curl /healthcheck`; không `compose up`, không `down`, không `-v`, không xoá
volume, không đụng `phongmach-demo-*`.

## 6. Hạn chế / chưa kiểm chứng được (trung thực)

1. **Một phiên khác đang chạy e2e trên CÙNG tenant demo và cùng Medplum** trong lúc bước này làm
   việc (thấy BFF + bản build của worktree `fix-e2e-off8`, tiến trình `e2e/_diag.mjs`, và các bệnh
   nhân thử lạ như "Zq Lỗi Tạm …" trong hàng chờ hôm nay). Nhiễu này đã làm `e2e:offline` đỏ một
   lần ở bước 10 (`resetDemoQueue` của phiên khác hủy lượt đang chờ của An) và `e2e:visit` đỏ 409
   hai lần ở bước 10. Lượt xanh 15/15 của `e2e:offline` đạt được khi không bị cắt ngang; CI seed
   tenant mới nên không có nhiễu này.
2. **Chưa chạy trọn vẹn `e2e:visit` tại chỗ** (bước 17 cần đúng MỘT BFF cho mỗi Medplum tenant).
   Không dừng BFF của phiên khác vì bất biến "không dừng tiến trình không do mình tạo".
   **Không sửa gì để chữa hai vết đỏ này** (409 ở bước 10, bước 17): chúng là nhiễu của môi trường
   dùng chung — ba phiên (`ci-fix-off8-e2e`, `fix-e2e-off8`, `m0-6-demo-rehearsal`) dùng chung một
   Medplum. Tín hiệu đáng tin là CI (một BFF duy nhất, tenant seed mới): ở đó `e2e:visit` **xanh**
   (xem mục 8).
3. **`e2e:cycles` (M0-2) chưa chạy** ở bước này: cần stack riêng và hạn mức FHIR; bản sửa không
   chạm bài đó.
4. Đột biến N6 của kế hoạch chẩn đoán (sinh `clientUuid` MỚI khi gửi lại) **không chạy**: N5 đã
   chứng minh bước 11 là phép kiểm hồi quy thật của mã sản phẩm OFF-8; bỏ N6 để tiết kiệm lượt chạy
   và tránh thêm bản ghi vào tenant demo đang dùng chung.
5. Tệp tạm `apps/clinic-web/.env` (trỏ `/api` sang BFF 8120) đã **xoá sau khi kiểm chứng**.
   `services/bff/.demo-tenants.json` được sao từ worktree khác để BFF riêng dùng chung tenant demo;
   tệp này nằm trong `.gitignore`, KHÔNG commit.

## 7. Trạng thái tệp sau bước này

Đã commit và push: `55d0854` trên `feat/docker-demo-off8-search-p2`
("fix: dung lai tien de cho khoi OFF-8 trong e2e offline-sign (buoc 11)", 1 tệp, +12/−1).
Tiến trình do bước này tạo (BFF 8120, bản build cổng 4176) đã dừng; tệp tạm
`apps/clinic-web/.env` và `apps/clinic-web/e2e/_probe401.mjs` đã xoá.

## 8. CI THẬT (Linux + /usr/bin/google-chrome) — PR #17, run 38241747644

`gh pr checks 17 --repo hunglv3h-svg/phongmach`:

| Job | Kết quả | Thời gian |
|---|---|---|
| Kiểu, kiểm thử đơn vị, build | **pass** | 49s |
| Kiểm thử tích hợp với Medplum thật | **pass** | 1m43s |
| Giao diện đầu-cuối (Chromium) trên Medplum thật | **fail** | 2m58s |

Chi tiết từng bước của job e2e (`gh api .../actions/jobs/114785789997`):

| # | Bước | Kết quả |
|---|---|---|
| 10 | `e2e` (smoke) | success |
| 11 | `e2e:visit` | success |
| 12 | **`e2e:offline`** (ngắt mạng thật, ký khi mất mạng, mất phản hồi, 503 OFF-8) | **success** |
| 13 | `e2e:conflict` (409 / 422 / 401) | **failure** |
| 14 | `e2e:cycles` (M0-2) | skipped (vì 13 đỏ) |

Nguyên văn trong nhật ký CI:

```
✓ 11. 503 lúc ký (OFF-8): in một tờ A5 từ máy, không im lặng; tự gửi lại, máy chủ có đúng 1 lượt khám mới …
$ node e2e/offline-conflict.mjs
✗ Hỏng ở bước 12
 AssertionError [ERR_ASSERTION]: OFF-8: 401 lúc ký phải in từ máy hoặc hiện kết quả ký, không …
    at …/apps/clinic-web/e2e/offline-conflict.mjs:308:10
```

⇒ Bản sửa đã được kiểm chứng trong **môi trường CI thật**, không chỉ trên Windows +
chrome-headless-shell: `e2e:offline` (gồm bước 11) xanh, và `e2e:visit` cũng xanh trên CI — khẳng
định hai vết đỏ `e2e:visit` tại chỗ (409 ở bước 10, bước 17) đúng là nhiễu môi trường dùng chung.
Vết đỏ còn lại của job e2e đúng là `e2e:conflict` bước 12 như đã báo trước, không phát sinh chỗ nào
khác.

## 9. VIỆC 3 — "401 lúc ký: đăng nhập lại có LẤY LẠI và IN LẠI được tờ đơn không?"

**Trả lời: CÓ. Dữ liệu không mất, mã đơn không đổi, in lại được sau khi đăng nhập lại — nhưng ĐÚNG
LÚC 401 thì KHÔNG có tờ giấy nào ra và màn hình không nói gì về việc đơn đã ký.**

Cách kiểm: ngoài việc đọc mã, đã chạy một lần thật bằng tệp thăm dò tạm
`apps/clinic-web/e2e/_probe401.mjs` (Chromium thật, BFF 8120 riêng, bệnh nhân thử riêng
"Zq Probe401 …" để không đụng dữ liệu của phiên khác; **tệp đã xoá sau khi đo**, nhật ký ở
`%TEMP%\off8-probe401.log`). Kết quả nguyên văn:

```
· bệnh nhân thử Zq Probe401 68ssr, số 112
· màn hình đăng nhập hiện sau 294 ms; khung in xuất hiện sau KHÔNG BAO GIỜ ms   (thăm dò 15 giây)
· kết quả ký trên màn hình: KHÔNG
· bộ đếm hàng rào in window.__idb.atPrint = []
· kho trên máy sau 401: {"names":["phongmach:noi-tong-quat:noi-doctor"],
    "rows":{"drafts":0,"ids":0,"meta":2,"ops":3,"patients":1,"signed":1,"snapshots":1},
    "ops":["printed:pending","open:done","complete:pending"]}
· chỉ báo: "Máy này còn 2 mục chưa đồng bộ của BS. Lê Thị Thu Hà (Phòng khám Nội tổng quát (demo)).
    Người đó đăng nhập lại trên máy này thì các mục được gửi tiếp."
· sau khi đăng nhập lại: sync-status pending=2 attention=0
· danh sách chờ đồng bộ: ["complete:sending [CÓ NÚT IN LẠI]","printed:waiting"]
· bấm "In lại đơn (từ máy này)": khung in 0 -> 1
· trang in lại có "KÝ KHI MẤT MẠNG": true; có tên: true; mã: PM-261012-H0KT04
· atPrint sau khi in lại = [0]
· máy chủ: 1 lượt khám, mã đơn PM-261012-H0KT04
· lỗi console ngoài dự kiến: []
```

Trả lời từng câu hỏi:

1. **Bản khám/đơn còn trong kho trên máy sau khi bị đẩy ra đăng nhập? CÓ.** `App.tsx:26` xử lý 401
   bằng `update(undefined)` và ghi rõ "KHÔNG xóa dữ liệu trên máy"; chỉ `logout(keep=false)` do
   người dùng bấm mới gọi `store.destroy()`. Đo thật: kho `phongmach:noi-tong-quat:noi-doctor` còn,
   có **`signed` = 1 bản đơn** và 3 mục hàng đợi (`complete:pending`, `printed:pending`,
   `open:done`) ⇒ bộ máy ĐÃ chuyển mục sang dạng "ký khi mất mạng" (`settleFocus` ghi cả bản đơn và
   mục ghi nhận in) đúng như OFF-8 thiết kế, chỉ có tờ giấy là không ra.
2. **Đăng nhập lại đúng người thì mục chờ hiện lại? CÓ.** Màn hình đăng nhập báo "Máy này còn 2 mục
   chưa đồng bộ của BS. Lê Thị Thu Hà"; đăng nhập lại → `pending=2`, danh sách "Chờ đồng bộ" có
   `complete` và `printed`; bộ máy tự gửi và máy chủ nhận **đúng 1 lượt khám, mã đơn trùng y hệt**
   `PM-261012-H0KT04` (N2 giữ nguyên `clientUuid`, không trùng bản ghi).
3. **Có đường in lại tờ A5 đó không, và có đi qua hàng rào in? CÓ cả hai.** Dòng `complete` trong
   danh sách "Chờ đồng bộ" có nút **"In lại đơn (từ máy này)"** (`SyncPanel.tsx:94-97`,
   `data-testid="sync-reprint"`; `syncList.ts:198` gắn `reprint` cho MỌI dòng có `rxTmpId`, không
   riêng dòng "cần xử lý"). Bấm → `client.reprintSigned` → `printLocal` → **`printHtml`** →
   **`whileLocalStoreQuiet`** (`print.ts:11-27, 38-40`). Đo thật: khung in 0 → 1, trang in có nhãn
   "KÝ KHI MẤT MẠNG", tên bệnh nhân và đúng mã đơn; `atPrint = [0]` ⇒ in khi không còn yêu cầu
   IndexedDB đang dở (F12 còn nguyên). Mỗi lần in lại còn ghi thêm một mục `printed` để máy chủ có
   dòng nhật ký (OFF-1).
4. **Bài test che đường này chưa? CHƯA trọn.** Có: `client.test.ts:368` ("`paused`: 401 đúng lúc ký
   → chuyển sang ký khi mất mạng, in đúng một lần; đăng nhập lại thì máy tự gửi") và
   `sync.test.ts:457` ở mức bộ máy; `offline-conflict.mjs` bước 7 (401 → đăng nhập lại, 4 mục còn
   nguyên) và bước 5 (in lại từ danh sách cho dòng xung đột) ở mức e2e. **Chưa có bài nào** kiểm
   chuỗi "401 ĐÚNG LÚC KÝ → đăng nhập lại → bấm In lại đơn → ra đúng tờ A5 đó" trên trình duyệt
   thật; chính vì vậy khoảng trống này chưa bị ai phát hiện. Lưu ý thêm: `client.test.ts:368` nói
   "in đúng một lần" là ở mức bộ máy (hàm in giả bị gọi), KHÔNG chứng minh tờ giấy ra ở trình duyệt
   thật — đo thật cho thấy ở trình duyệt thì không ra.

**Hệ quả cho quyết định A/B** (vẫn để chủ dự án chọn, bước này không hiện thực gì):

- Dữ liệu **không mất**, không trùng, mã đơn **giống hệt** tờ sẽ in ⇒ phương án **B (giữ hành vi
  hôm nay, sửa kỳ vọng bước 12 cho khớp) là một cắt phạm vi M0 có thể chấp nhận**: bác sĩ đăng nhập
  lại rồi bấm "In lại đơn (từ máy này)" trong danh sách "Chờ đồng bộ" — chậm vài chục giây, bệnh
  nhân không ra về tay trắng.
- NHƯNG có một điều kiện kèm theo: **ở đúng lúc 401, màn hình không hề nói đơn đã ký và in lại được
  ở đâu**. Thông điệp duy nhất là của màn hình đăng nhập: "Máy này còn 2 mục chưa đồng bộ … đăng
  nhập lại thì các mục được gửi tiếp" — nói về việc GỬI, không nói về việc IN. Bác sĩ không biết
  đường đi này sẽ tưởng mất đơn và ký lại (tạo thêm một lượt khám mới). Vậy nếu chọn B thì nên kèm:
  (a) ghi vào README mục "Giới hạn"; (b) một câu trong kịch bản demo/hướng dẫn; và nếu được, (c)
  một dòng chữ ở màn hình đăng nhập loại "đơn đã ký còn trên máy, đăng nhập lại để in lại" — (c) là
  thay đổi nhỏ về chữ, không đổi luồng.
- Phương án **A** (in trước rồi mới về đăng nhập) chỉ mua thêm việc bác sĩ không phải đăng nhập lại
  để lấy tờ giấy; không cần cho tính toàn vẹn dữ liệu.
