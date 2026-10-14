# Kiểm chứng OFF-8 — "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay

Môi trường: Windows + PowerShell (pwsh). Trình chạy pnpm 12.8.1 (kích hoạt qua
`corepack prepare pnpm@12.8.1 --activate`; pnpm hệ thống là 11.13.1, corepack không tự đổi).
Mọi lệnh chạy nhắm vào worktree tuyệt đối
`d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print`.

## Thiết kế áp dụng

Theo `docs/ke-hoach-trien-khai.md` mục "Thiết kế OFF-8", phương án **A + C1 + A-1**
(được chủ dự án duyệt), và kế hoạch
`.agents/tasks/phongmach-fix-off8-sign-print-2026-10-03/plan.md`.
Bất biến K: khi `OfflineClient.complete()` trả về, không có mục `complete` nào vừa còn tự
gửi được, vừa chưa có tờ đơn và chưa có bản đơn in lại được trên máy.

## Thứ tự test-first (đỏ trước, xanh sau)

Đây là lần lặp ĐẦU (không có `review.json`).

1. **Viết/chuyển bài tái hiện trước, chứng minh ĐỎ trên mã sản phẩm chưa sửa.**
   - `apps/clinic-web/src/local/client.test.ts`: chuyển nhóm "TÁI HIỆN (chưa sửa)" thành
     nhóm "OFF-8…" với 9 bài theo tiêu chí chấp nhận của thiết kế (waiting→C1 online;
     waiting mục trước lỗi tiếp→offline; offline chưa chuyển→offline; retrying cùng ngày→offline;
     retrying khác ngày / thiếu Date→failed "CHƯA in"; paused→offline; held→offline + in lại;
     nhánh mất mạng chịu cùng hàng rào ngày→failed "CHƯA in"). Bài "bấm lại thì in" cũ bỏ.
   - `apps/clinic-web/src/local/sync.test.ts`: thêm nhóm "OFF-8…" (chuyển trong lúc giữ khóa
     khi paused:owner / 401 / hai tab; C1 đẩy mục trước của focus chứ không đẩy lượt khác;
     mục tự nó bị từ chối không bao giờ promote còn mục bị giữ thì vẫn chuyển; hàng rào ngày).
   - Kết quả ĐỎ đã lưu ở `repro-red.txt`: **14 failed | 31 passed (45)** trên mã sản phẩm
     chưa sửa (9 bài client + 5 bài sync mới đỏ). Lệnh:
     `pnpm --dir "...\off8-sign-print" --filter @phongmach/clinic-web test -- src/local/client.test.ts src/local/sync.test.ts`
   - Hỗ trợ test (không phải mã sản phẩm): `fakeBff.ts` cho `Fault` nhận thêm `date?` và gắn
     tiêu đề `Date` vào phản hồi lỗi, để kiểm được hai biến thể "cùng ngày / khác ngày".

2. **Sửa mã sản phẩm đúng theo A + C1 + A-1.**
   - `apps/clinic-web/src/api.ts`: `ApiError` mang thêm `serverDate`; `request()` đọc
     `res.headers.get('date')` cho phản hồi lỗi (nền cho hàng rào ngày A-1).
   - `apps/clinic-web/src/local/ops.ts`: `OpError` mang thêm `serverDate`.
   - `apps/clinic-web/src/local/sync.ts`:
     - `classify()` chép `serverDate` sang `OpError`.
     - `settleFocus()` chạy chuyển cho MỌI mục focus chưa dứt điểm (không chỉ khi mất mạng),
       kể cả ở hai lối ra sớm (paused:'owner', paused:'unauthorized'); mục tự nó ATTENTION thì
       không chuyển, mục bị GIỮ vì mục trước thì vẫn chuyển.
     - Hàng rào ngày A-1 (`dateFenceAllows` + `dateFenceOk` + `dateFenceBlocks`): mục đã tới máy
       chủ (error.status ≠ 0) mang giờ ký chỉ được chuyển khi `vnDay(signedAt)` = `vnDay(Date)`;
       khác ngày hoặc thiếu `Date` thì không chuyển.
     - C1: dựng tập "tổ tiên của focus" theo `deps`, các mục đó bỏ qua `nextAt` trong lượt gửi.
     - `enqueue()` giữ lại `error` của lần gửi trước khi cập nhật payload (để hàng rào ngày còn
       dữ liệu khi `complete` bấm lại). `Outcome`: mục đã tới máy chủ mà không được chuyển trả
       `retrying` (kể cả khi đang mất mạng); mục đã chuyển trả `offline` (thắng cả held/paused).
   - `apps/clinic-web/src/local/client.ts`:
     - `complete()`: `done`/`rejected` như cũ; `offline` → in từ máy; `retrying`/`held`/`paused`/
       `waiting` → `failed` với một câu chứa đúng chữ **"CHƯA in"**. Nhánh mất mạng thuần chịu
       CÙNG hàng rào ngày qua `engine.dateFenceBlocks(opId, signedAt)`.
     - `openVisit()`/`checkIn()`: bỏ nhánh enqueue lại sau `submit` (bộ máy đã chuyển trong lúc
       giữ khóa; lần enqueue lại cũ đặt `nextAt=0` gây gửi lại sớm sai thời gian chờ).
   - KHÔNG đụng: cơ chế idempotent theo `clientUuid`, gói hoàn tất lượt khám chạy lại được,
     BFF, `@phongmach/print`, hành vi ngoại tuyến thuần (các bài "ký khi mất mạng" cũ vẫn xanh).

3. **Làm XANH.** Sau khi sửa, hai tệp test đạt **45 passed (45)**.

## Đột biến (chứng minh bộ test bắt lỗi)

Mỗi đột biến áp tạm rồi hoàn tác (`git checkout`), xác nhận có ít nhất một bài đỏ:

| Đột biến | Kết quả |
|---|---|
| A: chỉ chuyển khi mất mạng (hành vi cũ) — `settleFocus` thoát khi `current.online` | 9 failed / 45 |
| B: bỏ hàng rào ngày (`dateFenceAllows` luôn `true`) | 4 failed / 45 |
| C: C1 đẩy MỌI mục (bỏ điều kiện tổ tiên của focus) | 1 failed / 45 (bài "không đẩy lượt khác") |
| D: trả `failed` cho `retrying` mà KHÔNG có chữ "CHƯA in" | 2 failed / 19 (client) |

(Các đột biến khác trong kế hoạch — chuyển ngoài khóa, in trước khi ghi, sinh clientUuid mới
khi chuyển, lấy giờ ký lúc chuyển — được chặn bởi: chuyển làm trong `locks.request` của bộ máy;
máy in giả kiểm `persisted.op`/`draftGone` tại lúc in; `expectSignedOffline` kiểm cùng
`clientUuid` và `clientTimes.signedAt` = giờ bấm. Bốn đột biến chạy ở trên đã phủ các bất biến
phân biệt của OFF-8.)

## Kiểm chứng bắt buộc

Chạy từ gốc worktree (pnpm 12.8.1):

- `pnpm --dir "...\off8-sign-print" typecheck` → **không lỗi** (tất cả 8 gói: fhir-vn-model,
  catalogs, rules, clinical, print, trial, bff, clinic-web — Done).
- `pnpm --dir "...\off8-sign-print" test` → **tất cả XANH**, theo gói:
  - fhir-vn-model 45, catalogs 16, rules 27, clinical 83, print 4, trial 13,
  - **clinic-web 210** (gồm OFF-8: 9 bài client + 5 bài sync mới), bff 119.
  - Tổng 517 kiểm thử, 14 tệp của clinic-web đều xanh. (Con số lệch mốc "370" trong thiết kế
    vì dự án đã lớn thêm sau lát 6: Zalo, trial, F13…; mốc đó là ảnh chụp cũ của riêng clinic-web.)

### `pnpm e2e:cycles` — KHÔNG dựng được stack trong môi trường này

Đã viết đủ ba thay đổi e2e theo tiêu chí chấp nhận (giữ trong worktree):

- `offline-cycles.mjs`: thêm bước kiểm "không chu kỳ nào bị báo chưa in rồi phải bấm lại"
  (OFF-8) và "mỗi chu kỳ in đúng một lần = CYCLES".
- `offline-sign.mjs`: thêm ca máy chủ trả **503** cho yêu cầu hoàn tất lúc có mạng (giả lập bằng
  `page.route` kèm tiêu đề `Date` cùng ngày) → in một tờ A5 từ máy, tự gửi lại cùng UUID, máy chủ
  có đúng một đơn mã trùng; cập nhật kiểm "hàng rào in" thành ba lần in.
- `offline-conflict.mjs`: thêm ca **401 đúng lúc ký** (Rủi ro còn lại 3) → bộ máy chuyển sang ký
  khi mất mạng và in từ máy, không im lặng bỏ qua.

Ba tệp qua `node --check` (cú pháp hợp lệ).

**Không chạy được `pnpm e2e:cycles`:** script npm `stack:up` dùng cú pháp Bash `2>/dev/null`
(hỏng trên PowerShell), và quan trọng hơn, `infra/medplum/setup.mjs` cần **`openssl`** để sinh
khóa ký RSA và tạo `.env` (POSTGRES_PASSWORD/REDIS_PASSWORD). Máy này **không có `openssl`**
(`openssl version` → "not recognized"), nên `setup.mjs` ném lỗi spawn và `docker compose up`
báo thiếu biến bắt buộc:

```
error while interpolating services.postgres.environment.POSTGRES_PASSWORD: required variable POSTGRES_PASSWORD is missing a value: chạy node infra/medplum/setup.mjs trước
```

Docker có sẵn (`docker version` 29.7.2) nhưng stack Medplum dùng chung không khởi tạo được vì
thiếu `openssl` — đúng như "Môi trường" của thiết kế cảnh báo stack này mong manh. Theo yêu cầu,
KHÔNG coi là pass: e2e chưa chạy, các thay đổi e2e vẫn giữ nguyên để chạy ở nơi dựng được stack.

### Kết quả lệnh (chép lại, khỏi phải chạy lại)

```
=== pnpm typecheck ===
packages/fhir-vn-model typecheck: Done
packages/catalogs typecheck: Done
packages/rules typecheck: Done
packages/clinical typecheck: Done
packages/print typecheck: Done
packages/trial typecheck: Done
services/bff typecheck: Done
apps/clinic-web typecheck: Done
=== pnpm test (per package) ===
packages/fhir-vn-model   Tests  45 passed (45)
packages/catalogs        Tests  16 passed (16)
packages/rules           Tests  27 passed (27)
packages/clinical        Tests  83 passed (83)
packages/print           Tests   4 passed (4)
packages/trial           Tests  13 passed (13)
apps/clinic-web          Tests 210 passed (210)   [14 tệp]
services/bff             Tests 119 passed (119)
```

Trước khi sửa (chỉ hai tệp OFF-8, trên mã sản phẩm chưa sửa) — xem `repro-red.txt`:
`Tests  14 failed | 31 passed (45)`.

## Bất biến K và Rủi ro còn lại (xác nhận bằng test đã xanh)

- Cả năm kết quả không-dứt-điểm về một trong ba cách của K:
  - `waiting` → `online` (C1 đẩy mục trước, máy chủ hồi) hoặc `offline` (mục trước lỗi tiếp);
  - `offline` chưa chuyển → `offline`;
  - `retrying` cùng ngày → `offline`; `paused` → `offline`; `held` → `offline` (in lại được).
- Ca K **không** đúng, màn hình báo đúng chữ "CHƯA in" (bài test xác nhận):
  1. Hàng rào ngày A-1 từ chối: `retrying` khác ngày / thiếu `Date` (cả nhánh có mạng lẫn nhánh
     mất mạng thuần); mục giữ nguyên dạng có mạng và vẫn tự gửi lại.
  2. Lỗi kép (kho ghi lỗi lúc chuyển): bài "không in khi chưa lưu bền" → `failed` "CHƯA in".
  3. 401 lúc ký mà kho đóng trước khi kịp chuyển: đo bằng e2e `offline-conflict` (chưa chạy được).
  4. Sập giữa lưu và kết quả: ngoài phạm vi OFF-8, không đóng.

## Tệp đã đổi

Mã sản phẩm: `apps/clinic-web/src/api.ts`, `apps/clinic-web/src/local/ops.ts`,
`apps/clinic-web/src/local/sync.ts`, `apps/clinic-web/src/local/client.ts`.
Kiểm thử & hỗ trợ: `apps/clinic-web/src/local/client.test.ts`,
`apps/clinic-web/src/local/sync.test.ts`, `apps/clinic-web/src/local/fakeBff.ts`.
e2e: `apps/clinic-web/e2e/offline-cycles.mjs`, `apps/clinic-web/e2e/offline-sign.mjs`,
`apps/clinic-web/e2e/offline-conflict.mjs`.
