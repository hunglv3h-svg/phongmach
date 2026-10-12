# Rà soát: dựng lại tiền đề cho khối OFF-8 trong e2e `offline-sign.mjs` (bước 11)

Bản sửa (`55d0854`, nhánh `feat/docker-demo-off8-search-p2`) chạm **đúng một tệp bài kiểm thử**
(`apps/clinic-web/e2e/offline-sign.mjs`, +12 / −1), không sửa một dòng mã sản phẩm nào. Nó chữa hai
khuyết điểm của khối OFF-8: khối "mất phản hồi" ở trên đã hoàn tất lượt khám của Nguyễn Văn An nên
dòng của An chuyển `done` (mất nút "Gọi vào khám") và màn hình còn đứng ở trang kết quả ký, nên
locator theo tên chờ 30 s rồi hết giờ; ngoài ra lỗi console 503 do chính bài test dựng ra chưa được
khai báo nên phép kiểm console cuối bài sẽ đỏ. Cách chữa: bấm "Về hàng chờ", cấp số mới cho **đúng**
An qua `POST /api/queue` theo `patientId`, rồi bấm `call` trên dòng chọn theo `data-number`; đặt
`d.expected = /status of 503/` trong đúng khối rồi trả về `undefined`.

Toàn bộ khẳng định của bước 11 (`busy === 1`, trang in có "KÝ KHI MẤT MẠNG", `added503.length === 1`,
`added503[0].prescription.code === busyCode`) và bước 12 (`atPrint = [0,0,0]`) giữ nguyên; không
`sleep`, không nới timeout, không `page.waitForFunction` với hàm async.

**Watch for:** job e2e của CI **vẫn đỏ** sau bản sửa này — ở `e2e:conflict` bước 12 (401 đúng lúc
ký), một khuyết điểm có từ trước, ngoài diff, cần quyết định sản phẩm riêng (confirmed, nhật ký CI
run 38241747644); phép thử ngược N6 (sinh `clientUuid` mới khi gửi lại) bị bỏ nên cặp khẳng định
"không trùng bản ghi" của bước 11 chưa được chứng minh là biết đỏ (confirmed, ghi rõ lý do trong
bằng chứng); bằng chứng kiểm chứng còn ở dạng chưa theo dõi bởi git (`?? .agents/`, confirmed).

**Verdict**: APPROVED

## Nhìn tổng thể

Kết luận "lỗi ở BÀI TEST" khớp với mã đã sửa và với bằng chứng. `Queue.tsx:84` chỉ dựng nút `call`
khi `i.status === 'waiting'`, và lượt số 30 của An đã bị bước 10 đưa về `done`, nên locator cũ không
thể có phần tử để bấm — không phải nhất quán trễ. Bản sửa chỉ dựng lại tiền đề đó, không đụng
`src/local/sync.ts`, `src/api.ts` hay bất kỳ tệp sản phẩm nào, nên các bất biến (BFF là lớp duy nhất
gọi Medplum, F11 kiểm `failedEntries`, in qua `printHtml`/`whileLocalStoreQuiet`, N2/N3) không bị
chạm tới.

Phép kiểm không bị làm yếu. Mọi assertion của bước 11 và 12 còn nguyên, timeout để mặc định, chờ
bằng auto-wait của Playwright trên đúng điều kiện (dòng có số đó, có nút gọi) thay vì ngủ cố định.
Chỗ nới duy nhất là `d.expected = /status of 503/` — hẹp theo mẫu, trả về `undefined` ngay sau
`syncedAll()`, đúng cơ chế mà `offline-conflict.mjs` đã dùng cho 409/422/401.

Phép thử ngược thuyết phục: 5 đột biến, mỗi cái ĐỎ ở một chỗ khác nhau và đúng chỗ. N1 (hoàn nguyên
toàn bộ bản sửa) tái hiện **trùng khít** lỗi CI — cùng locator, cùng dòng 230, cùng `TimeoutError`;
N2 và N3 tách riêng hai điều kiện cần (điều hướng, tiền đề "An đang chờ"), trong đó N3 còn phơi ra lý
do thật sự không được lọc theo tên (bấm sang người cùng tên khác → 409); N4 (lùi tiêu đề `date` của
503 về hôm qua) đỏ ở `offline-sign-result` chứ không ở locator hàng chờ, chứng minh bước 11 thật sự
đi qua nhánh OFF-8; N5 (đột biến **mã sản phẩm** `settleFocus` về hành vi trước OFF-8) đỏ ở bước 11,
chứng minh bước 11 là phép kiểm hồi quy thật của OFF-8 chứ không phải bài test rỗng. Hoàn nguyên có
xác nhận bằng `git status --short` và lượt chạy lại 15/15.

Bằng chứng mạnh nhất không phải lượt chạy trên Windows mà là CI thật (run 38241747644): bước
`e2e:offline` **success**, `e2e:visit` cũng success — xác nhận hai vết đỏ `e2e:visit` tại chỗ (409 ở
bước 10, bước 17 `gateway-status`) đúng là nhiễu của môi trường dùng chung hai BFF trên một Medplum,
không phải hồi quy.

Phạm vi còn hở: job e2e của CI vẫn đỏ ở `e2e:conflict` bước 12. Đây là khuyết điểm có từ trước bản
sửa (bài và mã OFF-8 đều vào từ `d589343`, đã nằm trong `main`), nguyên nhân đã truy tới
`api.ts:123` → `App.tsx:26` đưa ngay về màn hình đăng nhập khi 401 nên bác sĩ không thấy tờ đơn;
bằng chứng còn kèm đo thật cho thấy dữ liệu **không mất, mã đơn không đổi, in lại được** sau khi
đăng nhập lại. Việc này cần một quyết định A/B của chủ dự án, không phải việc của bản sửa này —
nhưng ai đọc "CI đã xanh" cần biết job e2e tổng thể chưa xanh.

<details>
<summary>Issues (4)</summary>

1. **Job e2e CI vẫn đỏ ở `e2e:conflict` bước 12** (ngoài diff, confirmed) — 401 đúng lúc ký đẩy
   người dùng về màn hình đăng nhập trước khi tờ đơn ra. Cần quyết định A (in trước rồi mới về đăng
   nhập) hoặc B (giữ hành vi, sửa kỳ vọng bước 12 + ghi vào README "Giới hạn" + thêm một dòng chữ ở
   màn hình đăng nhập về việc in lại). Không thuộc trách nhiệm bản sửa này.
2. **Thiếu phép thử ngược cho cặp khẳng định "không trùng bản ghi"** (confirmed) — N6 (sinh
   `clientUuid` mới khi gửi lại) bị bỏ, nên `added503.length === 1` và so mã đơn chưa được chứng
   minh là biết đỏ. Lý do bỏ đã ghi rõ (tiết kiệm lượt chạy, tránh thêm bản ghi vào tenant demo
   dùng chung). Nên chạy N6 khi có tenant thử riêng.
3. **Bằng chứng kiểm chứng chưa được git theo dõi** (confirmed: `git status` chỉ có
   `?? .agents/`) — `off8-diagnosis.md`, `ci-fix-off8-e2e.md`, `review.md` chỉ tồn tại trong
   worktree. Nếu muốn giữ dấu vết cho người review PR thì commit hoặc dán phần then chốt vào mô tả
   PR #17.
4. **`d.expected` không được trả về `undefined` trên nhánh lỗi** (confirmed, mức rất thấp) — nếu
   khối 503 hỏng giữa đường thì cờ còn treo. Hiện vô hại vì bài test nhảy vào `catch` và dừng; chỉ
   đáng lưu ý nếu sau này có bước nào chạy tiếp sau khối đó trong tình huống lỗi.

</details>

<details>
<summary>Details</summary>

### Tiền đề của khối OFF-8 và lý do chọn `patientId` + `data-number`

Dòng cũ lọc theo tên rồi lọc tiếp theo "có nút `call`" nên khi An ở trạng thái `done` thì tập lọc
rỗng và `click()` chờ tới hết 30 s — chính xác lỗi CI. Mã mới dựng lại tiền đề theo đúng thứ tự mà
vỏ ứng dụng cần:

```js
await page.getByTestId('back-to-queue').click();
const again = await doctor('POST', '/api/queue', { clientUuid: crypto.randomUUID(), patientId: anId, specialty: 'noi' });
assert.equal(again.item?.status, 'waiting', `cấp số lại cho An phải ra lượt đang chờ: ${JSON.stringify(again)}`);
await page.locator(`[data-testid="queue-row"][data-number="${again.item.number}"]`).getByTestId('call').click();
```

Đã đối chiếu với mã sản phẩm: `Queue.tsx:65` gắn `data-number={i.number}` trên mọi `queue-row`, nên
locator hợp lệ; `Queue.tsx:84` chỉ dựng `call` khi `waiting`, nên nếu tiền đề sai thì bước 11 vẫn
đỏ chứ không âm thầm qua. Hợp đồng `POST /api/queue` khớp `checkInBody`
(`services/bff/src/routes/clinical.ts:34-42`: `clientUuid`, `patientId`, `specialty`, `priority`
mặc định `normal`) và trả `{ item, created }` (dòng 111-128). `assert.equal(again.item?.status, …)`
biến mọi hỏng hóc ở khâu dựng dữ liệu thành thông điệp đọc được kèm nguyên văn phản hồi, thay vì
một `TimeoutError` trên locator — đúng chỗ đã làm mất 30 s của lần chẩn đoán.

Chọn theo `patientId` thay vì tên không phải chuyện khẩu vị: N3 cho thấy lọc theo tên bấm sang một
người **cùng tên khác** trong hàng chờ demo (có cả "Nguyen Van An" không dấu) và đỏ bằng 409 ở chỗ
không liên quan. Số hàng chờ là duy nhất trong ngày nên locator theo `data-number` không vướng chế
độ strict.

### Mức độ nới của `d.expected`

Cửa sổ nới chạy từ trước `page.route` tới sau `syncedAll()`, và trong cửa sổ đó mẫu 503 thay thế
hoàn toàn `OFFLINE_ERRORS` của khối trước — tức là hẹp hơn, không rộng hơn: một lỗi
`Failed to load resource` không phải 503 trong cửa sổ này vẫn làm bước 15 đỏ. Bộ lọc ở
`offline-helpers.mjs` (`!d.expected?.test(m.text())`) chỉ loại đúng thông điệp khớp mẫu, không tắt
cả việc thu lỗi, nên `pageerror` và mọi lỗi console khác vẫn vào `problems`.

### Vì sao đây không phải lỗi mã sản phẩm

Bước 11 chưa bao giờ chạy tới chỗ dựng 503 (`busy` còn 0, `signWithTemplate()` chưa gọi) nên không
có cơ sở nào buộc tội mã OFF-8 cho lần hỏng này. Điểm quan trọng hơn: sau khi tiền đề được dựng
lại, bước 11 **đi tới** và **xanh** trên CI thật, còn N5 chứng minh nó đỏ khi mã OFF-8 bị trả về
hành vi cũ. Nghĩa là các khẳng định của OFF-8 (in một tờ từ máy, tự gửi lại cùng UUID, đúng 1 lượt
khám mới, mã trùng) lần đầu tiên thật sự được e2e bảo vệ, không chỉ "không còn đỏ".

</details>

<details>
<summary>Tệp đã đổi</summary>

- `apps/clinic-web/e2e/offline-sign.mjs` — dựng lại tiền đề khối OFF-8 (về hàng chờ, cấp số lại cho
  An theo `patientId`, bấm `call` theo `data-number`) và khai báo lỗi console 503 do bài test dựng
  ra.

Diff đầy đủ: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ci-fix-off8-e2e" diff main`.
Bằng chứng kiểm chứng: `.agents/tasks/ci-fix-off8-e2e.md` (lệnh, output 15/15, 5 phép thử ngược, CI
run 38241747644), chẩn đoán: `.agents/tasks/off8-diagnosis.md`.

</details>
