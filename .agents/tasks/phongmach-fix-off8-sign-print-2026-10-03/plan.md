# Kế hoạch sửa OFF-8 — "Ký & In" lúc có mạng mà máy chủ chưa nhận ngay

Nguồn thiết kế (đã duyệt): `docs/ke-hoach-trien-khai.md`, mục **"Thiết kế OFF-8"** (~dòng 909) — phương án **A + C1 + A-1**. Kế hoạch này áp đúng thiết kế đó. Mọi đường dẫn là tuyệt đối; cwd của agent KHÔNG phải worktree.

- Worktree (gốc mọi thao tác): `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print`
- Git luôn dùng: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print" ...`
- Môi trường: Windows + PowerShell. Trình chạy: pnpm 12.8.1, Node ≥ 22, Vitest.

## Bất biến K (phải đạt — chép từ thiết kế)

Khi `OfflineClient.complete()` trả về, **không có mục `complete` nào vừa còn tự gửi được, vừa chưa có tờ đơn và chưa có bản đơn in lại được trên máy.** "Ký & In" chỉ kết thúc bằng một trong ba cách:

1. **online** — máy chủ nhận, in qua máy chủ;
2. **offline** — đã lưu bền trên máy ở dạng ký khi mất mạng (`rxTmpId`, bảng `signed`, mục `printed`, xóa bản nháp) trong MỘT giao dịch, rồi mới in từ máy, màn hình chuyển sang kết quả ký;
3. **failed** — không lưu được / máy chủ từ chối: KHÔNG in, hàng đợi không giữ mục `complete` nào tự gửi được của lượt này mà thiếu đơn, màn hình khám còn nguyên và câu báo chứa đúng chữ **"CHƯA in"**.

Fix đạt K bằng cách đưa cả năm kết quả không-dứt-điểm hiện nay (`waiting`, `offline-chưa-chuyển`, `retrying`, `paused`, `held`) qua đúng đường "ký khi mất mạng" (promote trong lúc giữ khóa), trừ các ca "Rủi ro còn lại" (dưới) mà màn hình phải nói rõ "CHƯA in".

## RANH GIỚI CỨNG (KHÔNG được đụng)

- **Idempotent theo `clientUuid`**: mỗi thao tác giữ nguyên một `clientUuid` qua mọi lần gửi lại; promote phải dùng **cùng id, cùng `clientUuid`** — tuyệt đối không sinh UUID mới khi chuyển (`SyncEngine.enqueue` giữ id, `settleFocus` ghi lại cùng id). Không sửa hợp đồng idempotent của BFF.
- **Gói hoàn tất lượt khám chạy lại được**: không đổi payload `complete` theo cách phá tính replay (BFF trả `replayed: true` theo `clientUuid`). Không sửa BFF, không sửa `@phongmach/print`.
- **Hành vi ngoại tuyến thuần**: lỗi này chỉ xảy ra khi ứng dụng coi là CÓ mạng. Đường mất mạng thuần (`!this.online` trong `complete`, và nhánh `offline` đã promote) phải giữ nguyên hành vi — nó dùng CHUNG hàm promote nên sẽ chịu thêm hàng rào ngày A-1 (xem mục rủi ro `retrying`), nhưng không được đổi kết quả của các bài "ký khi mất mạng" hiện có.

## Rủi ro trọng tâm — ca `retrying` (yêu cầu hoàn tất CÓ THỂ đã tới máy chủ)

Lát 3b-1 quyết "không đổi giờ ký sau 503" vì máy chủ có thể đã ghi dở với giờ của nó. Thiết kế chọn **A-1**: vẫn promote (in từ máy) **nhưng chỉ khi an toàn về ngày**:

- Promote mục mà máy chủ đã trả lỗi (status ≠ 0: 5xx/503/429) **chỉ khi** ngày (giờ Việt Nam) của `signedAt` máy khách **trùng** ngày của tiêu đề `Date` trên phản hồi lỗi.
- Khác ngày, hoặc **không đọc được `Date`** → KHÔNG promote, KHÔNG in, trả `failed` với "CHƯA in". Mục giữ nguyên dạng có mạng và vẫn tự gửi lại.
- Lý do: mã đơn tính theo ngày ký (`MedicationRequest.groupIdentifier`, `List.identifier`, `Task.identifier`); ghi dở ngày này rồi ghi nốt ngày khác tạo đơn hai mã — hàng rào ngày chặn đúng ca đó, phần còn lại chỉ lệch vài giây (nhỏ hơn đường gửi lại hiện nay đã có).

## ⚠ ĐIỂM THIẾT KẾ CẦN LƯU Ý (flag — nên làm, không nên bỏ A-1)

Thiết kế tự ghi "**Chưa đo**: tiêu đề `Date` có tới trình duyệt qua proxy Vite và qua bản build hay không". Khi đọc mã xác nhận thêm hai điều làm A-1 có rủi ro triển khai thật:

1. **`apps/clinic-web/src/api.ts` hiện vứt bỏ mọi header của phản hồi lỗi.** `request()` chỉ đọc body JSON rồi ném `ApiError(status, code, message, body)` — không giữ `Date`. Vậy A-1 **bắt buộc** phải mở rộng `ApiError` để mang `serverDate` (hoặc headers) từ `res.headers.get('date')`, nếu không hàng rào ngày không có dữ liệu để so và sẽ **luôn** rơi vào nhánh "không đọc được Date → không in" — tức degrade ca `retrying` về đúng hành vi lỗi hiện nay cho MỌI lần, phá mục tiêu của A-1.
2. **`FakeBff` (`src/local/fakeBff.ts`) chưa phát `Date`.** Helper `json()` chỉ đặt `content-type`. Test A-1 phải tự gắn `Date` vào phản hồi lỗi của BFF giả (thêm tham số/field cho `fault`), nếu không hai biến thể "cùng ngày / khác ngày" không kiểm được.

**Khuyến nghị: GIỮ A-1 đúng thiết kế** (lợi ích thật cho ca 429/503 đã đo 11–26 lần bấm), nhưng coi hai việc trên là bước bắt buộc trong kế hoạch (mục 2 và 7). Nếu khi dựng e2e phát hiện proxy Vite / bản build **không** chuyển `Date` tới trình duyệt (chưa đo được ở unit test), thì **không tự ý đổi hướng**: báo lại trong `findings`/review và đề xuất fallback A-2 cho riêng ca `retrying` (không promote, báo "CHƯA in") — A-2 vẫn thỏa K ở nghĩa "không im lặng". Không chặn các ca còn lại (`waiting`, `offline`, `held`, `paused`) vì chúng không phụ thuộc `Date`.

## Tệp sẽ sửa (đã xác minh bằng đọc mã)

- `apps/clinic-web/src/local/sync.ts` — `SyncEngine`: `settleFocus`, `promote`/`Promote`, kết quả `submit`/`outcome`, C1 (đẩy mục trước), hàng rào ngày A-1.
- `apps/clinic-web/src/local/client.ts` — `OfflineClient.complete` (xử lý kết quả sau `submit`), `openVisit`/`checkIn` (bỏ lần enqueue lại sau `submit`).
- `apps/clinic-web/src/api.ts` — `ApiError` mang `Date` của phản hồi lỗi; `request()` đọc `res.headers.get('date')`.
- `apps/clinic-web/src/local/ops.ts` — nếu cần kiểu cho thông tin "đã tới máy chủ + giờ máy chủ" truyền vào promote.
- Kiểm thử: `apps/clinic-web/src/local/client.test.ts` (nhóm "TÁI HIỆN"), `apps/clinic-web/src/local/sync.test.ts`, `apps/clinic-web/src/local/fakeBff.ts` (hỗ trợ `Date`).
- e2e: `apps/clinic-web/e2e/offline-cycles.mjs`, `apps/clinic-web/e2e/offline-sign.mjs`, `apps/clinic-web/e2e/offline-conflict.mjs`.

Năm kết quả không-dứt-điểm hiện nay và nơi sinh ra (đã xác minh ở `client.ts` `complete()` `switch(out.kind)` và `sync.ts` `outcome()`):
`waiting` (mục trước đang retry, chưa hết chờ), `offline` chưa promote (mạng vừa lại, gửi lại mục trước lỗi mạng đúng lúc), `retrying` (chính `complete` nhận 5xx/503/429), `paused` (401), `held` (mục trước bị từ chối 409/khác). Hiện cả năm trả `kind:'failed'` và `printed === []`.

---

# Kế hoạch (test-first, theo thứ tự phụ thuộc)

> Quy ước verify: lệnh chạy từ worktree. Dùng
> `pnpm --dir "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print" --filter @phongmach/clinic-web test`
> cho test một gói, hoặc chạy `pnpm test` ở gốc worktree. Lọc một file:
> `... --filter @phongmach/clinic-web test -- src/local/client.test.ts`.

- [ ] 1. **(ĐỎ trước) Chuyển 7 bài "TÁI HIỆN" sang kỳ vọng OFF-8 trong `client.test.ts`.**
      Đổi mô tả nhóm khỏi "(chưa sửa)". Theo mục "Kiểm thử và tiêu chí chấp nhận" của thiết kế:
      bài 1 → thêm nhánh C1: mục mở hồ sơ được đẩy ngay khi máy chủ đã hồi, kết quả `online`, không cần bấm lại; biến thể "mục trước lỗi tiếp" → `offline`, in **đúng 1 lần SAU khi** `complete`+`signed`+`printed` đã trong kho và bản nháp đã xóa, đồng bộ xong có đúng 1 completion và 1 dòng printed.
      Bài 2 **bỏ** (không còn đường "bấm lại thì in").
      Bài 3, 5(`paused`), 6(`held`): `offline`, in đúng 1 lần; bài 6 thêm: mục bị `held`, in LẠI được từ danh sách chờ đồng bộ (`reprintSigned`).
      Bài 4(`retrying`): `offline`, in đúng 1 lần, `clientTimes.signedAt` = giờ bấm, 2 yêu cầu cùng `clientUuid`; **thêm 2 biến thể hàng rào ngày**: (a) `Date` phản hồi lỗi khác ngày VN, (b) phản hồi lỗi không có `Date` → cả hai: `failed` chứa "CHƯA in", mục giữ nguyên dạng có mạng (không `rxTmpId`, không `signed`), vẫn tự gửi.
      Bài 7: nhánh mất mạng chịu CÙNG hàng rào ngày (không còn tự ý đổi giờ ký của mục đã tới máy chủ khi khác ngày).
      Files: `apps/clinic-web/src/local/client.test.ts`
      Verify: `pnpm --dir "...\off8-sign-print" --filter @phongmach/clinic-web test -- src/local/client.test.ts` — các bài vừa đổi **ĐỎ** trên mã chưa sửa (chứng minh tái hiện lỗi). Ghi lại output đỏ.

- [ ] 2. **`ApiError` mang `Date` của phản hồi lỗi (nền cho A-1).**
      Thêm trường readonly (vd `serverDate?: string`) vào `ApiError` ở `api.ts`; trong `request()` khi `!res.ok` đọc `res.headers.get('date') ?? undefined` và truyền vào. Cập nhật `classify()` ở `sync.ts` để chép sang `OpError` (thêm field, vd `serverDate`), và `OpError` ở `ops.ts`.
      Hỗ trợ test: trong `fakeBff.ts`, cho `Fault` dạng object nhận thêm `date?: string` và để `json()`/nhánh fault gắn header `date` khi có.
      Files: `apps/clinic-web/src/api.ts`, `apps/clinic-web/src/local/sync.ts` (chỉ `classify`/kiểu `OpError`), `apps/clinic-web/src/local/ops.ts`, `apps/clinic-web/src/local/fakeBff.ts`
      Verify: `pnpm --dir "...\off8-sign-print" --filter @phongmach/clinic-web typecheck` — biên dịch sạch; chạy `src/local/fakeBff` liên quan qua `... test -- src/local/sync.test.ts` không hồi quy (các bài cũ vẫn xanh).

- [ ] 3. **(ĐỎ trước) Bài mới ở `sync.test.ts` cho hành vi engine OFF-8.**
      Viết các bài (đỏ trên engine chưa sửa): (a) `settleFocus`/promote chạy cho mọi kết quả chưa dứt điểm, trong lúc GIỮ KHÓA (hai tab cùng mở không gửi được bản cũ); (b) C1: mục trước (qua mọi bậc deps) của mục đang được chờ kết quả **bỏ qua `nextAt`** trong lượt gửi đó, nhưng **không** đẩy mục của lượt khám khác; (c) mục đã bị máy chủ từ chối (`held`/ATTENTION) **không bao giờ** bị promote; (d) hàng rào ngày: mục đã tới máy chủ (có `error.status ≠ 0` + `serverDate`) chỉ promote khi cùng ngày VN.
      Files: `apps/clinic-web/src/local/sync.test.ts`
      Verify: `... test -- src/local/sync.test.ts` — các bài mới **ĐỎ** trên mã chưa sửa. Ghi lại.

- [ ] 4. **C1 — đẩy mục trước ngay, trong `SyncEngine.runOnce`/quét.**
      Khi một mục đang trong `focus` (đang được người dùng chờ), các mục trước nó (lần theo `deps`, qua mọi bậc, cùng chuỗi lượt khám) được bỏ qua điều kiện `op.meta.nextAt > now` trong lượt gửi đó — giống "Đồng bộ ngay" nhưng chỉ cho chuỗi của mục focus. Không đụng `backoff`/`attempts`. Dựng tập "tổ tiên của focus" từ `deps` trước vòng quét.
      Files: `apps/clinic-web/src/local/sync.ts`
      Verify: `... test -- src/local/sync.test.ts` — bài C1 (3b, 3c) chuyển XANH; các bài engine cũ vẫn xanh.

- [ ] 5. **promote + settleFocus cho MỌI kết quả chưa dứt điểm, kèm hàng rào ngày A-1.**
      Trong `sync.ts`: (a) `settleFocus` chạy promote cho mục còn trong `focus` mà cuối lượt gửi **chưa `done` và chưa ATTENTION**, KHÔNG chỉ khi `networkDown` — kể cả hai lối ra sớm (`paused:'owner'` không phải chủ kho; `paused:'unauthorized'` chờ đăng nhập lại). (b) `Promote` nhận thêm thông tin "máy chủ đã trả lỗi cho mục này chưa" + `serverDate` của lần lỗi, và **được phép từ chối** chuyển (trả về `undefined`/cờ) khi hàng rào ngày không đạt. (c) `outcome()`/`Outcome` cho biết mục đã được chuyển hay chưa (ví dụ giữ cờ `promoted`), để `complete()` biết đã in được hay chưa. Mục ATTENTION (`held`) không bao giờ promote.
      Files: `apps/clinic-web/src/local/sync.ts`
      Verify: `... test -- src/local/sync.test.ts` — toàn bộ bài mục 3 XANH; `... typecheck` sạch.

- [ ] 6. **`OfflineClient.complete` — dùng promote cho mọi kết quả không dứt điểm; `openVisit`/`checkIn` bỏ enqueue lại.**
      Trong `complete()` `switch(out.kind)`: `done`/`rejected` giữ nguyên; mọi kết quả khác → nếu `out` báo **đã chuyển** thì `printOffline(promoted.detail)` trả `offline`; nếu **chưa chuyển** (hàng rào ngày từ chối / `held` / lỗi lưu) trả `failed` với **đúng một câu chứa "CHƯA in"**. `offlinePart()` (promote callback) phải truyền vào `submit`/`promote` để engine chạy nó trong lúc giữ khóa (đã có cơ chế `submit(opId, promoteCb)`), kèm hàng rào ngày. Dùng lại `signedOffline`/`reprintSigned`/màn kết quả ký đã có.
      Trong `openVisit` và `checkIn`: **bỏ** nhánh `if (out.kind !== 'offline') await this.engine.enqueue([... payload ...])` sau `submit` — engine đã promote trong lúc giữ khóa; lần enqueue lại đó còn đặt `nextAt=0` làm mục vừa bị lỗi tạm gửi lại sớm sai (đã đọc mã, là lỗi phụ cần dọn theo thiết kế).
      Files: `apps/clinic-web/src/local/client.ts`
      Verify: `... test -- src/local/client.test.ts` — 7 bài (đã trừ bài 2) ở mục 1 chuyển XANH; nhóm "ký khi mất mạng" và các nhóm khác vẫn xanh.

- [ ] 7. **Đột biến (mutation) — chứng minh bộ test bắt lỗi.**
      Lần lượt áp từng đột biến (tạm thời, rồi hoàn tác), xác nhận **ít nhất một bài đỏ** mỗi lần: chỉ chuyển khi lỗi mạng (hành vi cũ); chuyển ngoài khóa; in trước khi ghi; sinh `clientUuid` mới khi chuyển; lấy giờ ký lúc chuyển thay cho giờ bấm; bỏ hàng rào ngày; C1 đẩy mọi mục (kể cả lượt khác); trả `failed` mà không có chữ "CHƯA in".
      Files: không commit — chỉ ghi kết quả vào `findings`/review.
      Verify: với mỗi đột biến chạy `... test -- src/local/client.test.ts src/local/sync.test.ts` và xác nhận có bài đỏ; sau đó `git -C "...\off8-sign-print" checkout -- <file>` để hoàn tác.

- [ ] 8. **Toàn bộ typecheck + test của repo.**
      Files: không đổi.
      Verify (chạy ở gốc worktree):
      `pnpm --dir "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print" typecheck` → không lỗi;
      sau đó `pnpm --dir "...\off8-sign-print" test` → tất cả gói xanh (kỳ vọng ~ số bài tăng do thêm bài sync + biến thể client; so với mốc "370 kiểm thử đơn vị" trong thiết kế). Nếu lệch, giải thích.

- [ ] 9. **e2e — cập nhật ba bài theo tiêu chí chấp nhận (dựng được stack thì chạy, không thì báo rõ).**
      `offline-cycles.mjs`: đổi phần "đếm số lần Ký & In báo chưa ký" thành **bước kiểm phải = 0**; mỗi chu kỳ đúng một lần in; 11 bước cũ vẫn đạt.
      `offline-sign.mjs`: thêm ca máy chủ trả 503 cho yêu cầu hoàn tất (giả lập bằng `page.route`) → in 1 lần, PDF 1 trang A5, đồng bộ xong đúng 1 đơn, mã trùng mã đã in.
      `offline-conflict.mjs`: thêm ca 401 đúng lúc ký (Rủi ro còn lại 3).
      Files: `apps/clinic-web/e2e/offline-cycles.mjs`, `apps/clinic-web/e2e/offline-sign.mjs`, `apps/clinic-web/e2e/offline-conflict.mjs`
      Verify: thử dựng stack rồi chạy
      `pnpm --dir "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print" e2e:cycles`
      (và nếu chạy được, 100 chu kỳ hạt giống 558698034 + một lần 20 chu kỳ không nâng hạn mức FHIR cho ca 429).
      ⚠ `e2e:cycles` cần **stack Medplum dùng chung** (`pnpm stack:up`, Docker). Nếu stack KHÔNG dựng được trong môi trường này, **KHÔNG** coi là pass: báo trung thực "không dựng được stack, e2e chưa chạy", kèm lý do; vẫn giữ các thay đổi e2e đã viết. Đây là kết cục chấp nhận được theo yêu cầu.

- [ ] 10. **Kiểm K và rủi ro còn lại trong phần tổng kết.**
      Xác nhận bằng test đã xanh: cả năm kết quả về một trong ba cách của K; ghi rõ các ca K **không** đúng và màn hình phải báo "CHƯA in": (1) hàng rào ngày từ chối ca `retrying` khác ngày / thiếu `Date`; (2) lỗi kép (máy chủ chưa nhận + kho ghi lỗi); (3) 401 mà kho đóng trước khi kịp chuyển (đo bằng e2e `offline-conflict`); (4) sập giữa lưu và kết quả (ngoài phạm vi OFF-8, không đóng).
      Files: không đổi.
      Verify: không có lệnh mới; dựa trên mục 8 (và 9 nếu chạy được).

## Verify tổng (đúng chữ theo yêu cầu người dùng)

- `pnpm typecheck` (ở gốc worktree) — không lỗi.
- `pnpm test` (ở gốc worktree) — tất cả xanh; nêu rõ số bài so mốc thiết kế.
- `pnpm e2e:cycles` — chỉ chạy được khi dựng được stack Medplum. Chạy được: báo kết quả 100 chu kỳ (hạt giống 558698034) và 20 chu kỳ ca 429. Không dựng được: **nói rõ**, không tuyên bố thành công.

## Ghi chú cho người triển khai

- Giữ nguyên thứ tự test-first: mục 1 và 3 phải ĐỎ trước khi sửa mã (mục 4–6). Không sửa mã sản phẩm trước khi có bài đỏ tương ứng.
- Commit cục bộ trên nhánh của worktree; **không push**. Dùng `git -C "...\off8-sign-print"`.
- Không sửa BFF, không sửa `@phongmach/print`, không sửa cơ chế idempotent `clientUuid`/gói replay.
