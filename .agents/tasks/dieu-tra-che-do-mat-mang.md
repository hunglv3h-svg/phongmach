# Điều tra: chế độ "Mất mạng" không tự thoát khi hết mục chờ

Phạm vi: CHỈ ĐỌC. Không sửa mã, không commit, không tạo nhánh/worktree, không đụng stack Medplum.
Mã điều tra: repo gốc `d:\My Documents D\UNIGIS\PM\phongmach`, nhánh `main`, HEAD `ca11f77`.
Ngày: 2026-10-05 (giờ máy), demo Docker `phongmach-demo` ở `http://localhost:8081`.

---

## 1. Kết luận một câu

**Lỗi CÒN TỒN TẠI và đã TÁI HIỆN ĐƯỢC trên bản demo Docker đang chạy**: sau một lần gọi máy chủ lỗi mạng mà trình duyệt vẫn tưởng mình có mạng (`navigator.onLine === true`, không có sự kiện `offline`), ứng dụng vào chế độ "Mất mạng" và — khi hàng đợi đồng bộ không còn mục nào — **không bao giờ tự thoát**: trong 90 giây sau khi mạng đã hồi hoàn toàn, trang **không gửi một yêu cầu `/api` nào** (0 yêu cầu), chỉ báo vẫn là "Mất mạng", và **không có nút nào bấm được để thoát** (nút "Đồng bộ ngay" bị khóa vì ứng dụng tin là đang mất mạng). Chỉ F5 (tải lại trang) mới thoát — mất 5 ms.

---

## 2. "Chế độ Mất mạng" trong mã là gì

Không có cờ bật tay cho người trình diễn. Đây là **trạng thái suy ra**, là phép AND của hai nguồn:

`apps/clinic-web/src/local/OfflineProvider.tsx:67`
```ts
const value = useMemo(() => ({ client, sync, online: sync.online && browserOnline }), [client, sync, browserOnline]);
```

**Nguồn A — `browserOnline`** (`OfflineProvider.tsx:37`, bộ xử lý sự kiện ở `43-52`): khởi tạo bằng `navigator.onLine !== false`, sau đó CHỈ đổi theo hai sự kiện `window` là `online`/`offline`. Không có chỗ nào đọc lại `navigator.onLine` sau đó.

**Nguồn B — `sync.online`**, tức `SyncEngine.state.online` (`apps/clinic-web/src/local/sync.ts`):
- khởi tạo `this.current.online = this.isOnline()` (`sync.ts:180`), `isOnline` mặc định là `navigator.onLine !== false`;
- chuyển **false** khi: `observe(false)` do một lời gọi đọc qua `OfflineClient.call` gặp `ApiError.status === 0` (`client.ts:101-107`, `sync.ts:265`); hoặc một mục trong hàng đợi gửi bị `verdict === 'network'` (`sync.ts` trong `runOnce`); hoặc đầu `runOnce` thấy `!isOnline()`;
- chuyển **true** chỉ khi: `observe(true)` (một lời gọi máy chủ qua `client.call` thành công), một mục trong hàng đợi gửi **thành công** (`emit({ online: true, ... })` trong `runOnce`), một phản hồi lỗi khác lỗi-mạng (4xx/5xx thật), hoặc `wake()` do sự kiện `online` của trình duyệt.

Chữ trên màn hình: `apps/clinic-web/src/components/SyncBar.tsx:11` — `online ? "Có mạng" : "Mất mạng"` (`data-testid="offline-badge"`), cùng `data-online` trên `[data-testid="sync-status"]`.

Khi cờ này false, **mọi đường đọc đều tự khóa**, nên không còn ai thăm dò máy chủ:
- `components/Queue.tsx:17` — `online ? client.refreshQueue(signal) : Promise.resolve(undefined)`;
- `local/OfflineProvider.tsx:55` — vòng nạp trước 30 giây: `client.online ? client.refreshQueue(...) : undefined`;
- `components/Reception.tsx:68` — `if (!online) return await searchLocal();`;
- `components/Display.tsx:37`, `components/PatientDetail.tsx:34`, `visit/SignResult.tsx:34` — cùng kiểu.

Và hai nút bấm tay duy nhất cũng bị khóa đúng lúc cần nhất:
- `SyncBar.tsx:21` — nút "Đồng bộ ngay" **chỉ hiện khi `pending > 0`** và `disabled={!view.online}`;
- `SyncPanel.tsx:125` — nút "Đồng bộ ngay" trong danh sách "Chờ đồng bộ": `disabled={!view.online}`.

Mấu chốt của lỗi nằm ở `sync.ts`, hàm `schedule` (`sync.ts:522-531`):
```ts
const open = ops.filter((o) => o.meta.status === 'pending' || o.meta.status === 'retry');
if (open.length === 0) return;      // sync.ts:526 — hết mục chờ ⇒ KHÔNG hẹn lượt chạy nào nữa
```
Hết mục chờ thì bộ máy đồng bộ không còn được gọi lại, nên không còn nguồn nào có thể đặt `online = true`. Đây đúng là câu "**không tự thoát khi hết mục chờ**": khi CÒN mục chờ, chu kỳ 30 giây/thời gian chờ gửi lại sẽ gửi lại, một lần thành công là thoát; khi HẾT mục chờ, không còn gì chạy.

### "Tự thoát" đúng ra phải xảy ra ở đâu, có mã nào định làm chưa?

Chưa bao giờ có. Không có hàm thăm dò (`ping`/`health`) nào ở phía giao diện, không có bộ hẹn giờ nào chạy khi `online === false`. `git log -- apps/clinic-web/src/local/OfflineProvider.tsx` chỉ có **đúng một** commit (`270604a`, lát M0-S3.3b-2) — tệp chưa từng được sửa sau khi viết; `sync.ts` có 4 commit, commit mới nhất `d589343` là OFF-8 (ký & in), không liên quan. Cơ chế thoát duy nhất được thiết kế là sự kiện `online` của trình duyệt (`OfflineProvider.tsx:43-47`) — mà sự kiện này **không bao giờ phát** trong đúng ca gây lỗi, vì trình duyệt chưa từng coi mình là mất mạng.

Lỗi này đã được ghi đúng bản chất trong tài liệu dự án: `docs/ke-hoach-trien-khai.md:889` (mục 5.9, "Phát hiện trong lúc làm, chưa sửa", phát hiện 4) và `README.md:187` ("chế độ 'Mất mạng' không tự thoát khi không còn mục chờ"). Tài liệu ghi `[Đã đọc mã; chưa đo riêng]` — **báo cáo này bổ sung phần đo**.

---

## 3. Bằng chứng

### 3.1 Tái hiện trên demo Docker thật (Chromium thật, cổng 8081)

Cách dựng ca lỗi: đăng nhập demo `noi-doctor`, mở màn Hàng chờ, rồi **cắt mọi yêu cầu `/api` ở tầng mạng** (`context.route(... route.abort('internetdisconnected'))`). Cách này mô phỏng đúng ca "Wi-Fi còn, Internet/máy chủ mất": `navigator.onLine` vẫn `true`, không có sự kiện `offline`/`online` nào. Hàng đợi đồng bộ rỗng (kho mới, chỉ đọc, không tạo bệnh nhân / không cấp số / không ký — **không ghi gì vào phòng khám demo**).

Nhật ký lần chạy 1 (chờ 90 giây sau khi mạng hồi):

```
03:21:58  đã đăng nhập noi-doctor: {"online":"true","pending":"counting","badge":"Có mạng"}
03:21:58  mở màn Hàng chờ:          {"online":"true","pending":"0","badge":"Có mạng"}
03:22:03  cắt /api → Mất mạng sau 5093 ms: {"online":"false","pending":"0","navOnline":true,"badge":"Mất mạng","syncNowButton":"không có"}
03:22:03  danh sách Chờ đồng bộ: {"empty":true,"listNow":"có, bị khóa"}
03:23:33  BỎ cắt /api: tự về Có mạng? false (sau 90439 ms); {"online":"false","navOnline":true,"badge":"Mất mạng"}
03:23:33  số yêu cầu /api trang gửi trong 90439 ms sau khi mạng hồi: 0
03:23:33  thăm dò tay từ trang: GET /api/health → 200
03:23:33  chỉ báo sau thăm dò tay: {"online":"false","badge":"Mất mạng"}
03:23:33  tải lại trang: về Có mạng? true (sau 5 ms)
```

Bốn điều đáng ghi:
1. Vào "Mất mạng" rất nhanh (5,1 giây — đúng chu kỳ 5 giây của màn Hàng chờ).
2. Sau khi mạng hồi: **0 yêu cầu `/api` trong 90 giây**. Không phải "thoát chậm" mà là **không có cơ chế thoát**.
3. `GET /api/health` từ chính trang đó trả **200** → mạng và BFF hoàn toàn bình thường; trạng thái "Mất mạng" chỉ là cờ của ứng dụng (và lời gọi tay này cũng không làm cờ đổi, vì nó không đi qua `OfflineClient.call`).
4. Lối ra duy nhất là F5 (5 ms), vì provider dựng lại và đọc lại `navigator.onLine`.

### 3.2 Hệ quả phụ đã đo: màn hình tự mâu thuẫn

Lần chạy 2 (cùng cách dựng, rồi bấm sang các màn khác trong lúc đang kẹt):

```
03:24:33  mạng đã hồi, chỉ báo:                 {"online":"false","badge":"Mất mạng"}
03:24:37  màn "Thời gian khám":                 {"online":"false","badge":"Mất mạng","needsNetworkNote":true,"metricsTable":true,"metricsRows":1}
03:24:41  màn "Liên thông":                     {"online":"false","badge":"Mất mạng","needsNetworkNote":true}
03:24:49  quay lại Hàng chờ (chờ thêm 8 giây):  {"online":"false","badge":"Mất mạng"}
```

Màn "Thời gian khám" (`components/Metrics.tsx:14`) gọi `api.metrics` **không qua** `OfflineClient.call` và **không bị khóa theo `online`**, nên nó lấy được số thật của máy chủ **đồng thời** vẫn hiện dòng "Cần mạng: số đo do máy chủ tính" và thanh trên vẫn "Mất mạng". Tức là trên cùng một màn hình có cả bảng số p50/p90 vừa tải về lẫn lời báo mất mạng. Màn "Liên thông" cũng tương tự (`components/Gateway.tsx:40-41`). Hai màn này lấy được dữ liệu nhưng **không** gọi `observe(true)` nên không gỡ được cờ.

### 3.3 Lỗi thứ hai, cùng họ, chưa thấy ghi ở đâu (chỉ đọc mã, chưa đo)

`browserOnline` trong `OfflineProvider.tsx` chỉ đổi theo sự kiện. Nếu trình duyệt phát `offline` mà **không** phát `online` lúc hồi mạng (Playwright 1.63 đúng như vậy sau khi reload lúc `setOffline(true)`; trên máy thật có thể gặp khi máy ngủ/thức hoặc driver Wi-Fi quái tính), thì `browserOnline` nằm `false` **vĩnh viễn**: bộ máy đồng bộ vẫn gửi được (vì `isOnline()` đọc `navigator.onLine` sống, đang là `true`), hàng đợi vẫn cạn dần, mục chờ về 0 — nhưng huy hiệu vẫn "Mất mạng" và mọi đường đọc vẫn bị khóa. Đây là biến thể thứ hai của đúng câu mô tả "hết mục chờ mà không thoát", và nó không được tài liệu nào ghi.

### 3.4 Đây KHÔNG phải hành vi cố ý theo N3

N3 ("không âm thầm") nói về **mục trong hàng đợi**: mục "cần xử lý" không được tự bỏ, không tự ghi đè. Cờ `online` là chuyện **có gọi tới máy chủ được hay không**, không phải chuyện hàng đợi. Trong ca đã đo, hàng đợi **rỗng** (`sync-list-empty`, `pending=0`, `attention=0`) nên không có gì để giữ: không có xung đột, không có mục chờ xác nhận. Thoát khỏi "Mất mạng" trong ca này không làm mất mát hay ghi đè bất cứ thứ gì. Mã cũng có sẵn chỗ phân biệt "hết mục chờ" với "còn mục cần xử lý": `SyncState.attention` và `ATTENTION` trong `local/deps.ts` — nên bản sửa đúng đắn vẫn giữ được N3.

---

## 4. Tác động đến buổi trình diễn 13/11

**Phụ thuộc vào cách người trình diễn ngắt mạng** — đây là điểm then chốt:

| Cách ngắt mạng trong demo | Trình duyệt có phát `offline`? | Có tự thoát khi hết mục chờ? |
|---|---|---|
| Tắt Wi-Fi / rút cáp mạng của máy trình diễn | Có (`navigator.onLine=false`) | **Có** — bật lại phát `online` → `wake()` → "Có mạng" ngay |
| Dừng container BFF/demo, chặn cổng, Wi-Fi còn nhưng Internet mất, captive portal | **Không** | **KHÔNG** — kẹt "Mất mạng" như mục 3.1 |
| DevTools → Network → Offline | Có (Chrome đặt `navigator.onLine=false`) | Có |

Nên nếu kịch bản demo ngắt mạng bằng cách **tắt Wi-Fi** thì nhịp mất mạng → có mạng lại **không bị đứt**, vì bật Wi-Fi lại phát sự kiện `online`. Rủi ro thật nằm ở:

1. **Trình diễn bằng cách tắt dịch vụ** (dừng container, chặn cổng) hoặc máy demo đi qua Wi-Fi hội trường chập chờn (còn liên kết Wi-Fi, mất Internet) → sau nhịp "có mạng lại", ứng dụng **vẫn hiện "Mất mạng"**, Hàng chờ đứng ở ảnh chụp cũ, tìm kiếm chỉ tìm trên máy, và **không có nút nào bấm để thoát**. Người trình diễn phải F5 giữa buổi. Mất mạch demo, và tệ hơn là nó xảy ra **đúng ở phần "ngoại tuyến" đang được đem ra khoe**.
2. **Một cú chập mạng ngẫu nhiên nào đó trong buổi** (Wi-Fi hội trường rớt một gói, BFF trả `status 0` một lần) trong lúc hàng đợi rỗng là đủ để khóa ứng dụng vào "Mất mạng" suốt phần còn lại của buổi, dù mạng đã ổn. Vào trạng thái này chỉ mất ~5 giây và không cần ai làm gì.
3. **Màn hình tự mâu thuẫn** (mục 3.2): nhà đầu tư nhìn thấy "Mất mạng" cạnh bảng số p50/p90 vừa tải về. Khó giải thích, và đi ngược nguyên tắc trình diễn trung thực.
4. Không có nguy cơ mất/trùng bản ghi trên máy chủ: đúng như README ghi. Thiệt hại là niềm tin và mạch demo, không phải dữ liệu.

Mức độ: **trung bình–cao về rủi ro sân khấu, thấp về rủi ro dữ liệu**. Cách giảm rủi ro không cần sửa mã: quy định trong kịch bản demo rằng nhịp ngắt mạng **phải** làm bằng tắt Wi-Fi (hoặc DevTools Offline), không bao giờ bằng cách dừng container; và người trình diễn biết F5 là cách thoát.

---

## 5. Phác thảo cách sửa (KHÔNG hiện thực trong bước này)

Ý tưởng: **khi ứng dụng tin là mất mạng, chính nó phải định kỳ thăm dò máy chủ**, thay vì chờ một sự kiện có thể không bao giờ đến.

1. **Thêm thăm dò định kỳ lúc đang mất mạng** — `apps/clinic-web/src/local/OfflineProvider.tsx` (hoặc một hàm `probe()` mới trong `local/sync.ts` để kiểm thử được bằng thời gian ảo). Khi `online === false`: mỗi 10–15 giây gọi `GET /api/health` (đã có sẵn, `services/bff/src/app.ts:111`, không cần token, **không ghi nhật ký truy cập**, không PII); thành công → `client.engine.observe(true)` (hàm này đã tự gọi `syncNow()`); lỗi → không làm gì. Dừng thăm dò khi `online === true`, khi tab bị ẩn (`document.hidden`) và khi `navigator.onLine === false` (lúc đó sự kiện `online` đã đủ, khỏi tốn pin).
2. **Đừng tin sự kiện `online` là nguồn duy nhất cho `browserOnline`** (sửa lỗi 3.3): đọc lại `navigator.onLine` ở mỗi lần thăm dò và ở `visibilitychange`/`focus`, thay vì chỉ trong hai bộ xử lý sự kiện.
3. **Cho bấm tay để thoát**: bỏ `disabled={!view.online}` ở nút "Đồng bộ ngay" của `SyncPanel.tsx:125` (hoặc thêm nút "Thử kết nối lại" luôn hiện khi đang mất mạng). Nút đó nên gọi thăm dò + `syncNow()`. Hiện tại đúng lúc người dùng cần nhất thì nút bị khóa.
4. **Dọn chỗ mâu thuẫn ở `Metrics.tsx` / `Gateway.tsx`**: cho chúng đi qua `client.call` để lời gọi thành công cũng gỡ được cờ (và lời gọi thất bại cũng được tính), hoặc khóa chúng theo `online` cho nhất quán. Chọn đường `client.call` thì chính các màn này cũng trở thành nguồn thoát.

**Rủi ro của bản sửa, phải cân nhắc khi làm:**
- Đừng để thăm dò sinh dòng nhật ký truy cập hay tải thêm cho Medplum: `/api/health` không chạm Medplum và không ghi nhật ký — nhưng nếu ai đó đổi sang thăm dò bằng `/api/queue` thì sẽ sinh dòng `queue-read` mỗi 10 giây cho mỗi máy. Không làm thế.
- Giữ N3: `observe(true)` chỉ gọi `syncNow()`, mà `runOnce` đã bỏ qua mọi mục trong `ATTENTION` (`local/deps.ts`), nên mục xung đột/chờ xác nhận không bị tự gửi lại hay ghi đè. Cần một bài test khẳng định điều này không đổi.
- Đừng thăm dò khi phiên đã hết hạn (`sync.paused === 'unauthorized'`) để không che mất câu "Phiên đã hết hạn".
- Nhiều tab: nên để thăm dò chạy ở tab đang hiện (`document.hidden === false`), tránh N tab × 1 yêu cầu/10 giây.
- Tần suất: 10–15 giây là đủ cho demo; ngắn hơn thì tốn, dài hơn thì vẫn "đứt mạch".

**Kiểm chứng đề nghị (theo văn hóa đột biến của dự án):**
- Unit (thời gian ảo, không `sleep`): sau `observe(false)` với hàng đợi **rỗng**, cho đồng hồ ảo trôi → có đúng một thăm dò → `state.online === true`. Đột biến: bỏ thăm dò ⇒ bài phải ĐỎ.
- Unit: `browserOnline` nằm false mà không có sự kiện `online` ⇒ sau thăm dò, chỉ báo vẫn về "Có mạng" (lỗi 3.3).
- e2e: thêm một bước dùng **`route.abort('internetdisconnected')`** (KHÔNG dùng `context.setOffline`, vì nó đi đường sự kiện trình duyệt đã được che) với hàng đợi rỗng, bỏ chặn, rồi `eventually(() => page.evaluate(...))` chờ `[data-testid="sync-status"][data-online="true"]` trong ~30 giây. Nhớ bẫy đã biết: **không** dùng `page.waitForFunction` với hàm `async`.

---

## 6. Tình trạng test che lỗi

**Không có test nào che ca này** — và lý do rất cụ thể:

- Mọi bài e2e ngoại tuyến ngắt mạng bằng `context.setOffline(true)` (`e2e/offline-helpers.mjs:128`, `offline-sign.mjs`, `offline-conflict.mjs`, `offline-cycles.mjs`, `visit.mjs:291`). Cách này **đặt `navigator.onLine = false` và phát sự kiện `offline`** — tức là đi đường "trình duyệt biết mình mất mạng", không phải đường gây lỗi ("trình duyệt tưởng có mạng nhưng gọi gì cũng lỗi").
- `setOffline(d, false)` có chờ `[data-testid="sync-status"][data-online="true"]` (`offline-helpers.mjs:132`) — nghĩa là **có** kiểm việc thoát. Nhưng ở mọi chỗ gọi nó, hàng đợi **đang còn mục chờ** (vừa tạo bệnh nhân / cấp số tạm / ký khi mất mạng / ghi nhận in lại). Khi còn mục chờ, bộ máy đồng bộ còn được hẹn chạy (`schedule` không trả về sớm), một lần gửi thành công là `emit({ online: true })` → bài xanh. Đúng cái đường mà lỗi **không** nằm trên.
- `apps/clinic-web/src/local/sync.test.ts` có bài cho `online: false → true`, nhưng luôn qua `e.wake()` (mô phỏng sự kiện `online`) hoặc qua một mục gửi lại thành công — lại vẫn là hai đường đã hoạt động.
- `apps/clinic-web/src/components/sync.test.tsx` chỉ dựng HTML tĩnh từ `IndicatorView` cho sẵn; nó còn **khẳng định** nút "Đồng bộ ngay" bị khóa khi mất mạng ("…'Đồng bộ ngay' bị khóa khi mất mạng"). Tức là hành vi khóa nút hiện đang được test **bảo vệ**; nếu sửa theo mục 5.3 thì phải sửa cả bài test đó và ghi rõ lý do đổi quyết định.
- Bẫy Playwright 1.63 đã ghi trong `docs/ke-hoach-trien-khai.md` (sau reload lúc `setOffline(true)` thì `navigator.onLine` về `true` và bật mạng lại **không** phát `online`) chính là lý do các bài e2e *gần như* chạm vào lỗi — nhưng các chu kỳ đó luôn còn mục chờ, nên vẫn hội tụ qua đường gửi lại.

Nói gọn: test xanh vì chúng chỉ đi qua hai lối thoát đang hoạt động (sự kiện `online`, gửi lại thành công). Lỗi nằm ở lối thoát thứ ba — "không còn gì để gửi, mà trình duyệt cũng chẳng báo gì" — chưa có bài nào đi vào.

---

## 7. Đã kiểm gì / Chưa kiểm được gì

**Đã kiểm (đo thật):**
- Đọc toàn bộ lớp ngoại tuyến của giao diện trên `main`@`ca11f77`: `local/{OfflineProvider.tsx,sync.ts,client.ts,syncList.ts,cache.ts}`, `components/{SyncBar,SyncPanel,Shell,Queue,Display,Metrics,Gateway,AuditLog}.tsx`, `hooks.ts`.
- `git log` của `OfflineProvider.tsx` (1 commit, `270604a`) và `sync.ts` (4 commit, mới nhất `d589343` = OFF-8) → không có commit nào sửa lỗi này.
- Tái hiện 2 lần trên Chromium thật (`chrome-headless-shell` của Playwright) với demo Docker ở `http://localhost:8081`: vào "Mất mạng" sau 5,1–5,3 giây; **0 yêu cầu `/api` trong 90,4 giây** sau khi mạng hồi; `GET /api/health` → 200 từ chính trang đó; F5 thoát trong 5 ms; nút "Đồng bộ ngay" của danh sách "có, bị khóa", nút ở thanh trên "không có" (vì `pending = 0`).
- Đo hệ quả phụ: màn "Thời gian khám" lấy được bảng số (1 dòng) **trong lúc** vẫn hiện "Cần mạng" và huy hiệu "Mất mạng".
- Hai script thăm dò là tệp **tạm**, đã **xóa** sau khi chạy; `git status` sau đó chỉ còn các mục chưa theo dõi vốn đã có từ trước (`.agents/`, `.worktrees/`, `docs/prompts/`, `package-lock.json`). Không sửa mã sản phẩm, không commit.
- Bất biến môi trường: `docker ps` cho thấy 3 container `phongmach-medplum` giữ nguyên id `6bdd98a57bb8` / `396bce70e6ed` / `75c24bc8cbaf`, vẫn `Up`. Không chạy `docker compose` cho project đó.

**Chưa kiểm được / cố ý không làm:**
- **Không chạy `pnpm typecheck` / `pnpm test` / `pnpm e2e`**: không cần cho câu hỏi "lỗi còn hay hết", và `pnpm e2e` sẽ ghi vào phòng khám demo. Vì vậy báo cáo này **không** khẳng định gì về trạng thái xanh/đỏ hiện tại của bộ kiểm thử.
- **Không thử ca "tắt Wi-Fi thật"** trên máy Windows này (sẽ cắt mạng của chính phiên làm việc). Kết luận ở bảng mục 4 cho ca đó dựa trên **đọc mã** (`OfflineProvider.tsx:43-47` có xử lý sự kiện `online` → `wake()` → `refreshQueue()`), **chưa đo**.
- **Không đo ca 3.3** (`offline` phát mà `online` không phát): chỉ đọc mã. Để đo cần giả sự kiện ở tầng trình duyệt — chưa làm.
- Không thử trên trình duyệt khác (Edge/Firefox/Safari iPad) và không thử ca `online` event của Windows sau khi ngủ/thức.
- **Không viết thao tác ghi nào vào hai phòng khám demo** (không tạo bệnh nhân, không cấp số, không ký), nên **chưa đo** nhánh "có mục chờ thì tự thoát" trên demo — nhánh đó đã được các bài e2e có sẵn che và cơ chế đã rõ qua đọc mã.
- Lưu ý trung thực: hai lần chạy thăm dò **có** sinh dòng nhật ký `queue-read` cho phòng khám `noi-tong-quat` (màn Hàng chờ tải trong vài giây) và một phiên đăng nhập demo. Không đổi hàng chờ, không đổi lượt khám nào.
- Giả định mặc định vẫn là "chủ dự án thấy thứ ta không thấy": mô tả gốc một câu khớp với đúng cơ chế đã đo ở đây, nhưng nếu chủ dự án từng gặp nó **sau khi tắt/bật Wi-Fi thật** (tức sự kiện `online` có phát mà vẫn kẹt) thì đó là biến thể 3.3, cần đo thêm trước khi sửa.
