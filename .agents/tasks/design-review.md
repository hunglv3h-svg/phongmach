# Review thiết kế: làm dày dữ liệu demo PHONGMACH (bản sửa 3)

Tài liệu được review: `.agents/tasks/design.md` (worktree `.worktrees/trial1-seed-data`, nhánh
`feat/demo-rich-seed`). Review đọc tài liệu **không mang theo ngữ cảnh đã sinh ra nó**, và mở mã nguồn
để kiểm từng khẳng định thay vì tin tài liệu.

**Verdict: CHANGES_REQUESTED** — 1 HIGH, 3 MEDIUM, 8 NIT.

Nhận xét chung trước khi vào danh sách: đây là một thiết kế chặt. Toàn bộ 101 mã thuốc và mã ICD-10
dùng trong bảng 7.1/7.2/8.1/8.2 đều **có thật** trong `packages/catalogs` (đã đối chiếu từng mã, xem
mục "Giả định đã kiểm chứng"); các con số p50/p90 ở mục 9 tôi **tính lại tay** và khớp đến từng giây;
chữ ký `store.checkIn` / `openVisit` / `completeVisit` được dùng đúng; hàng chờ "hôm nay" tương đối theo
`vnDay(now)` chứ không hardcode; mọi khóa đều qua `stableUuid`. Các finding dưới đây là những chỗ còn
lại — trong đó finding 1 làm seed **thoát mã 1 trước khi ghi gì**, nên phải sửa trước khi code.

---

## 1. HIGH — Quy tắc `respiratoryRate`/`spo2` "soát hai chiều" của mục 7.5 từ chối chính 3 lượt khám đã có trong seed hiện tại

**Ở đâu.** Mục 7.5, bảng "Quy tắc chốt cho `respiratoryRate` và `spo2`" + câu
"`validateScenario` soát **đúng chiều cả hai**: thiếu khi quy tắc đòi là lỗi, có khi quy tắc không đòi
cũng là lỗi"; và dòng "Áp vào dữ liệu: phòng Nhi ghi hai trường này ở idx 2, 5, 6, 7, 8, 11, 12, 13,
15, 18 … phòng Nội ghi `spo2` ở idx 3, 6, 7, 14, 17, 20 và 28".

**Vấn đề.** Danh sách idx đó **bỏ sót các mục đã có sẵn trong `CLINICS`** (`services/bff/scripts/seed-demo.ts`,
mục `visits` hiện tại — thiết kế giữ nguyên chúng ở idx 0–2 của Nội và idx 0 của Nhi theo bất biến "chỉ
thêm vào cuối"):

| Mục đã có | `dx[0]` | `vitals` hiện tại trong mã | Quy tắc 7.5 đòi | Kết quả |
|---|---|---|---|---|
| `noi-tong-quat` idx 0 | `J06.9` | `temperatureC, pulse, systolic, diastolic, weightKg` — **không có `spo2`** | người lớn + mã `J…` ⇒ **phải có `spo2`** | lỗi "thiếu spo2" |
| `noi-tong-quat` idx 2 | `J30.4` | như trên, **không có `spo2`** | **phải có `spo2`** | lỗi "thiếu spo2" |
| `nhi` idx 0 | `J06.9` | `temperatureC, pulse, spo2, weightKg` — **không có `respiratoryRate`** | nhi + mã `J…` ⇒ **phải có cả hai** | lỗi "thiếu respiratoryRate" |

`validateScenario` chạy đầu `main()` và `process.exit(1)` khi có lỗi (mục 12.1), nên một bản hiện thực
**đúng theo thiết kế** sẽ không ghi được gì cả: seed chết trong 50 ms, `depends_on:
service_completed_successfully` giữ `web` không khởi động, demo không dựng được. Đây không phải lỗi dữ
liệu mới mà là lỗi của chính quy tắc: tài liệu viết quy tắc cho dữ liệu mới rồi áp nó lên toàn bộ
`CLINICS`.

**Cách sửa (chọn một, viết rõ vào mục 7.5).**

Phương án A (khuyến nghị — giữ quy tắc mạnh, bổ sung ba trường vào các mục cũ). Sửa nội dung mục cũ
**không có tác dụng** trên tenant đã seed (chính mục 4.3 đã nói) nên đây là thay đổi an toàn, chỉ để
qua pre-flight và để lần seed trên tenant trắng ra dữ liệu nhất quán:

```ts
// noi-tong-quat, visits[0]  (J06.9)
vitals: { temperatureC: 36.8, pulse: 78, systolic: 128, diastolic: 82, spo2: 98, weightKg: 68 },
// noi-tong-quat, visits[2]  (J30.4)
vitals: { temperatureC: 36.6, pulse: 72, systolic: 118, diastolic: 76, spo2: 98, weightKg: 54 },
// nhi, visits[0]  (J06.9)
vitals: { temperatureC: 38.2, pulse: 110, respiratoryRate: 28, spo2: 98, weightKg: 17.5 },
```

và đổi hai danh sách idx của mục 7.5 thành: Nội `0, 2, 3, 6, 7, 14, 17, 20, 28`; Nhi
`0, 2, 5, 6, 7, 8, 11, 12, 13, 15, 18`.

Phương án B (yếu hơn). Giới hạn quy tắc hai chiều vào các mục **mới** (`index >= 3` với Nội,
`index >= 1` với Nhi) và nói thẳng trong mục 12.1 rằng các mục cũ được miễn — nhưng khi đó pre-flight
mất tính "quy tắc", quay lại thành lời khuyên cho một phần dữ liệu.

---

## 2. MEDIUM — `reason` khai báo tay của lượt `today` bị `planCompletion` ghi đè ở các lượt `done`

**Ở đâu.** Mục 4.1 (đoạn cuối: "`reason` của lượt `today` được khai báo tay (vì nó là câu phụ tá gõ lúc
cấp số, **thấy ngay trên hàng chờ** — xem cột 'Lý do đến' của bảng 8.1/8.2)") và cột `reason` của bảng
8.1/8.2.

**Vấn đề (đã đối chiếu mã).** `planCompletion` (`packages/clinical/src/visit.ts`) dựng Encounter đã đóng
bằng:

```ts
const reason = input.exam.reason?.trim();
const closed: Encounter = { ...encounter, status: 'finished', …, ...(reason ? { reasonCode: [{ text: reason }] } : {}) };
```

tức `reasonCode` **bị thay** bằng `exam.reason`. Và `exam.reason` theo mục 4.2 lấy từ
`narrative(specialty, dx[0], index).reason`. `toQueueItem` (`packages/clinical/src/queue.ts`) lại đọc
đúng `e.reasonCode[0].text` cho cột "Lý do", còn `toVisitSummary` cũng đọc từ đó cho màn "Lịch sử khám".

Hệ quả: với **4 lượt `done`** (8.1 idx 0, 1 và 8.2 idx 0, 1), câu khai báo tay ("Tái khám huyết áp và
đường huyết", "Đi ngoài phân lỏng 2 ngày"…) chỉ tồn tại trong khoảng thời gian giữa `checkIn` và
`completeVisit` — tức **không bao giờ nhìn thấy được**; hàng chờ sẽ hiện câu của `NARRATIVE` (ví dụ
"Tái khám huyết áp định kỳ, xin cấp lại đơn"). Lý do mà mục 4.1 đưa ra để giữ `reason` là trường khai
báo **không đúng** cho nhánh `done`.

**Cách sửa (chọn một, và sửa cả câu giải thích ở mục 4.1).**

- A: giữ `reason` ở `TodayBase` nhưng **chốt bằng quy tắc**: với nhánh `done`, `reason` khai báo phải
  **bằng đúng** `narrative(specialty, exam.dx, index).reason`, và `validateScenario` soát đẳng thức đó
  (nếu không thì người đọc bảng 8.1 sẽ tin một câu không bao giờ xuất hiện). Bảng 8.1/8.2 sửa lại cột
  `reason` của 4 dòng `done` cho khớp bộ chữ.
- B: chuyển `reason` xuống hai nhánh `waiting` và `in-exam` của union (chỗ nó thật sự hiển thị), nhánh
  `done` **không có** `reason` và dùng thẳng `narrative(...).reason` cho cả `checkIn` lẫn `exam`.
  Phương án này cùng tinh thần với cách mục 4.1 đã xử lý `openedMinutesAgo` và `exam`: để trình biên
  dịch không cho viết sai.

---

## 3. MEDIUM — "Thang lùi về" của mục 3 không đo lại được: bậc 1/2/3 không tiết kiệm gì trên tenant đã seed

**Ở đâu.** Mục 3 ("Thang lùi về… nếu lần chạy nguội đo được > 8 phút"), mục 4.5 (lần chạy nguội / lần
chạy lại), mục 16 (ô "Cách xử" của rủi ro "Seed lâu hơn 8–10 phút").

**Vấn đề.** Quy trình quyết định mà thiết kế đặt ra là: chạy nguội → đo tổng → nếu > 8 phút thì áp bậc
1, rồi 2, rồi 3. Nhưng mọi tài nguyên của lần chạy nguội **đã được ghi** và tạo-có-điều-kiện không bao
giờ ghi lại (mục 4.3). Vì vậy sau lần chạy nguội:

- **bậc 2** (cắt 13 lượt cuối của Nội / 10 của Nhi) không xóa gì: 13 lượt đó đã nằm trong CSDL, lần sau
  chỉ bị bỏ qua. Tiết kiệm **0 giây** trên tenant này, và dữ liệu demo **không** mỏng đi;
- **bậc 3** (`SEED_PATIENTS` 300 → 200) cũng vậy — thiết kế đã nói đúng điều này ở lưu ý 1 của mục 3
  ("`Patient._total` sẽ không giảm") nhưng không nối nó lại với thang lùi;
- **bậc 1** (hai phòng song song) có tiết kiệm thật, nhưng đo lại trên tenant đã seed sẽ ra con số của
  **lần chạy lại** (gần như không ghi gì) nên không chứng minh được điều gì.

Nói cách khác: con số dùng để so với ngưỡng 8 phút chỉ lấy được **một lần duy nhất**, và sau lần đó mọi
bậc lùi đều không kiểm chứng được trên cùng cái tenant. Hiện tài liệu không nói ra điều này, nên bước
kiểm chứng sẽ đi vào một vòng lặp vô nghĩa (đo lại → 40 giây → "đã đạt ngưỡng").

**Cách sửa.** Viết thành quy trình chốt trong mục 3:

1. Áp **bậc 1 (song song hai phòng khám) ngay từ lần chạy nguội đầu tiên** — nó không làm nghèo dữ liệu
   nên không có lý do gì để đợi.
2. Quyết định có cần bậc 2/3 **bằng mốc thời gian từng giai đoạn** mà seed in ra (mục 4.5), không bằng
   một lần đo tổng thứ hai. Ngưỡng cụ thể: nếu giai đoạn "lượt khám cũ" của một phòng vượt **4 phút**,
   hoặc tổng vượt 8 phút, thì **ghi nhận con số thật + khuyến nghị bậc 2/3 cho lần dựng trên máy khác**
   (tenant trắng) thay vì áp ngay trên tenant đã seed.
3. Ghi vào `trial1-verification.md`: tổng của lần chạy nguội, các mốc từng giai đoạn, số lần 429, và câu
   kết luận "bậc lùi X **chỉ có tác dụng trên tenant trắng**; trên tenant demo hiện tại dữ liệu đã được
   ghi và không bị bớt đi".
4. Nếu chủ dự án muốn một con số cho tenant trắng: nêu rõ rằng việc đó cần **slug mới** (ví dụ
   `SEED_PATIENTS` cho hai slug khác) — và đó **ngoài phạm vi** lần này.

---

## 4. MEDIUM — Hai lượt `done` của phòng Nhi được chọn `seconds` cao hơn trung vị, làm p50 vượt mục tiêu 60 giây ngay từ ngày seed thứ hai (và ở khung "Hôm nay" thì vượt ngay từ ngày đầu)

**Ở đâu.** Bảng 8.2 (`exam.seconds` = **78** và **120**), mục 9 ("Chọn 'Hôm nay': … phòng Nhi p50 = 78 /
p90 = 120"), và ngưỡng đạt ở mục 15 ("`p50Seconds` ≤ 60 và `p90Seconds` ≤ 120").

**Vấn đề (tính lại bằng `percentile` thật trong `packages/clinical/src/time.ts`,
`rank = ceil(p/100 × n)`).**

- Khung **"Hôm nay"** của phòng Nhi chỉ có hai giá trị 78 và 120 ⇒ p50 = **78 > 60** và p90 = **120**,
  đúng sát trần. `TARGET_P50_SECONDS = 60` (`services/bff/src/metrics.ts`) nên nhãn p50 của trang "Thời
  gian khám" ở khung Hôm nay **không xanh**. Yêu cầu gốc đòi "p50/p90 đẹp"; mục 9 ghi con số 78 mà không
  nói nó vượt mục tiêu.
- Khung **14 ngày** đúng 59/105 ở **ngày seed đầu tiên**, nhưng mỗi ngày seed chạy lại thêm 2 lượt
  `done` nữa vào khung (đây là thứ tích tụ thứ ba mà mục 4.3 chưa kể, xem NIT 9). Ngày thứ hai, dãy Nhi
  thành `40 45 48 51 53 56 59 63 70 78 78 90 105 120 120` (n = 15) ⇒ rank p50 = `ceil(7,5)` = 8 ⇒
  **p50 = 63 > 60**. Ngưỡng "p50Seconds ≤ 60" của mục 15 vì vậy **đỏ** nếu kiểm chứng (hoặc buổi demo)
  diễn ra sang ngày thứ hai kể từ lần seed đầu.
  (Phòng Nội không bị: 57 nằm ngay dưới trung vị 58 nên p50 giữ 58 qua nhiều ngày — tôi đã tính tới
  ngày thứ ba.)

**Cách sửa.** Đổi `exam.seconds` của hai lượt `done` phòng Nhi xuống **dưới** trung vị lịch sử của
phòng đó (trung vị 11 lượt Nhi trong 14 ngày là 56–59 giây):

| Bảng 8.2 | `exam.seconds` hiện tại | Đổi thành |
|---|---|---|
| idx 0 — Đặng Bảo Ngọc (2019), J06.9 | 78 | **52** |
| idx 1 — Hoàng Gia Bảo, A09 | 120 | **88** |

Kiểm lại với bộ số mới: khung 14 ngày ngày 1 ⇒ `40 45 48 51 52 53 56 59 63 70 88 90 105` (n = 13),
p50 = `ceil(6,5)` = 7 ⇒ **56**, p90 = `ceil(11,7)` = 12 ⇒ **90**; ngày 2 (n = 15) p50 = **56**; ngày 3
(n = 17) p50 = **56**. Khung "Hôm nay" ⇒ p50 = **52**, p90 = **88** — cả hai xanh.
Sau khi đổi, **phải cập nhật mọi con số của mục 9 cho phòng Nhi** (dãy đã sắp, p50/p90 của
`nhi-owner`, dòng "Chọn Hôm nay") và hàng ngưỡng tương ứng ở mục 15.

---

## 5. NIT — Mục 7.4 đếm sai số lượt I10 của bệnh nhân idx 10 (bỏ sót idx 16)

Mục 7.4 viết "sáu lượt của bệnh nhân idx 10 (24, 25, 26, 29, 30, 32) nhận 0, 1, 2, 2, 0, 2". Nhưng
bảng 7.1 idx **16** cũng là bệnh nhân 10 với `dx[0] = I10` (`I10, E11.9, Z76.0`), nên là **bảy** lượt
lịch sử (16, 24, 25, 26, 29, 30, 32) + 1 lượt `done` hôm nay = 8 — đúng bằng con số "8 lượt" mà mục 15
dùng làm ngưỡng. Bản thân bảng biến thể `0, 1, 0, 1, 2, 2, 0, 2` cho idx `9, 16, 24, 25, 26, 29, 30, 32`
thì **đúng** (`index % 3`). Sửa câu chữ thành "bảy lượt lịch sử của bệnh nhân idx 10 (16, 24, 25, 26,
29, 30, 32) nhận 1, 0, 1, 2, 2, 0, 2".

## 6. NIT — Thông điệp lỗi mẫu ở mục 12.1 mô tả một xung đột dị ứng không tồn tại trong dữ liệu

Hàng "nhất quán dị ứng ↔ đơn" lấy ví dụ:
`"nhi/visit 16 dòng 1: AMOXICILLIN-250-MG-GOI xung đột dị ứng 'amoxicillin' của bệnh nhân 2"`.
Nhưng theo mục 6.2, bệnh nhân nhi **2** (Nguyễn Văn Khoa) dị ứng **`ibuprofen`**, còn người dị ứng
`amoxicillin` là bệnh nhân **8** (Đặng Bảo Ngọc 2015) — và hai lượt của bệnh nhân 8 (idx 2, 22) không có
amoxicillin. Tôi đã soát **toàn bộ** 58 lượt × dị ứng của chính bệnh nhân đó theo đúng ngữ nghĩa
`checkPrescription` (`class` → `drug.classes`, `ingredient` → `drug.ingredients`): **không có xung đột
nào** — dữ liệu sạch, chỉ ví dụ là sai. Đổi ví dụ thành một thông điệp trung tính, ví dụ
`"nhi/visit N dòng 1: <MÃ> xung đột dị ứng '<giá trị>' của bệnh nhân <i>"`, để người sau không đi tìm
một lỗi không có.

## 7. NIT — Hậu tố Z76.0 cộng vào biến thể I10 #2 ra câu lặp

`narrative()` thêm ", xin cấp lại đơn" vào `reason` khi `dx` chứa `Z76.0`. Lượt 7.1 idx 29
(`I10, Z76.0`, `index % 3 = 2`) vì vậy có `reason` = "Hết thuốc huyết áp, xin khám lại**, xin cấp lại
đơn**" — lặp ý và đọc không tự nhiên trên tờ đơn. Sửa `reason` của biến thể I10 #2 thành "Hết thuốc
thuốc huyết áp" → gọn lại là **"Hết thuốc huyết áp"**, hoặc cho `narrative()` bỏ hậu tố khi `reason` đã
chứa chữ "thuốc"/"đơn" (quy tắc này phải viết ra, đừng để người code tự đoán).

## 8. NIT — Kẹp mốc `00:05` của mục 4.4 có thể đẩy `at` vào tương lai, và `openedAt` của `in-exam` không được kẹp

Mục 4.4 dùng `at = max(now − minutesAgo·60.000, Date.parse(`${vnDay(now)}T00:05:00+07:00`))`. Nếu seed
chạy trong khoảng **00:00–00:05 giờ VN**, `floor > now` nên `at` nằm ở **tương lai** (hàng chờ hiện
"chờ −3 phút", `period.start` ở tương lai). Cùng lúc đó, `openedAt` của nhánh `in-exam` chỉ bị kẹp
`≤ now`, không kẹp `≥ floor`, nên nó có thể rơi sang **ngày VN hôm trước** trong khi `checkIn` đã được
đánh vào hôm nay. Cả hai đều vô hại với số đo (`measureVisit` nhánh `server` chỉ lấy `now − opened`)
nhưng nên chốt một dòng:

```ts
const floor = Date.parse(`${vnDay(now)}T00:05:00+07:00`);
const at = new Date(Math.min(Math.max(now.getTime() - minutesAgo * 60_000, floor), now.getTime()));
// in-exam: kẹp cả hai đầu
const openedAt = new Date(Math.min(Math.max(now.getTime() - openedMin * 60_000, at.getTime()), now.getTime()));
```

## 9. NIT — Mục 4.3 kể hai thứ tích tụ theo ngày, còn thiếu thứ ba

Ngoài 3 Encounter `arrived` và 1 Encounter `in-progress` mỗi phòng mỗi ngày, mỗi ngày seed chạy còn để
lại **2 lượt `done` mỗi phòng** — chúng là `status=finished` nên **đi vào** `finishedVisits` (số đo
Metrics của khung 14/30 ngày) **và** `patientVisits` (lịch sử khám của Võ Thị Kim Chi, Nguyễn Văn An,
Đặng Bảo Ngọc, Hoàng Gia Bảo dài thêm 1 lượt mỗi ngày). Đây chính là nguồn của finding 4. Thêm nó vào
đoạn "Hai thứ tích tụ lại theo ngày" (đổi tên thành "Ba thứ…") và vào bảng rủi ro mục 16.

## 10. NIT — Bước 5 của mục 15 có thể không chạy lại seed thật

`docker compose -p phongmach-demo -f … up -d` khi cấu hình **không đổi** và container `seed` đã exit 0
thì tùy phiên bản Compose có thể coi `service_completed_successfully` là đã thỏa và **không chạy lại**
— khi đó "bằng chứng của tính chạy-lại-được" (mục 4.5, mục 14) không có gì. Thêm đường chắc chắn vào
mục 15 kèm cách tự kiểm:

```powershell
# chạy lại seed một cách tường minh (KHÔNG đụng Medplum, KHÔNG down -v)
Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm seed }
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs --timestamps seed | Select-Object -Last 15
```

và ghi rõ trong tài liệu kiểm chứng đã dùng đường nào, cùng mốc thời gian dòng log để chứng minh seed
**thật sự** chạy lần hai.

## 11. NIT — Bảng chi phí thời gian ở mục 3 đếm trùng 4 lượt `done` của hôm nay

Hàng "Lượt khám lịch sử" ghi "(32 nội + 22 nhi)" = 54; hàng "Chờ hạn mức" lại tính "34 lượt phòng Nội,
24 phòng Nhi" = 58 (tức đã gộp 2+2 lượt `done` của hôm nay); rồi hàng "Sân khấu hôm nay (12 lượt: 4
hoàn tất, …)" đếm 4 lượt đó **lần nữa**. Tổng 6,5–9 phút vì vậy không nhất quán về cách đếm. Chốt một
cách đếm: "58 lượt đi hết đường (54 lịch sử + 4 `done` hôm nay) + 8 lượt chỉ cấp số/chỉ mở hồ sơ" rồi
tính lại các ô.

## 12. NIT — Mục 7.5 chốt khoảng nhưng không chốt giá trị: ~58 lượt × tới 7 trường sinh hiệu vẫn do người code tự đặt

Thiết kế viết ra **đầy đủ** bảng `NARRATIVE` (50 biến thể) và từng dòng thuốc, nhưng `vitals` chỉ có
khoảng + quy tắc hiện/không hiện. Tôi **không** coi đây là lỗ hổng chặn code (khoảng đã rõ, quy tắc
hiện/không hiện đã chốt hai chiều, `cleanVitals` + `validateScenario` chặn số sai, và `vitals` không ảnh
hưởng tới p50/p90), nhưng nó là chỗ duy nhất tài liệu giao lại ~400 con số cho người code. Nếu muốn dữ
liệu đối chiếu lại được từng lượt, thêm một cột `vitals` rút gọn vào bảng 7.1/7.2/8.1/8.2 (dạng
`36,8 / 78 / 128-82 / 68`); nếu không, thêm một câu trong 7.5: "giá trị cụ thể do người hiện thực chọn
trong khoảng, phải là hằng viết thẳng trong mảng, và một bệnh nhân nên giữ `weightKg` gần như không đổi
giữa các lượt gần nhau" (ràng buộc cuối hiện chưa có, nên cùng một người có thể nặng 48 kg hôm nay và
82 kg tuần trước mà vẫn qua pre-flight).

---

# Giả định đã kiểm chứng (mở mã, không tin tài liệu)

Danh mục và mã:

- **Toàn bộ mã thuốc** trong bảng 7.1, 7.2, 8.1, 8.2 tồn tại trong `packages/catalogs/src/drugs.ts`.
  Tôi tính `drugCode(name)` thủ công cho từng mã: `PARACETAMOL-500-MG`, `PARACETAMOL-150-MG-GOI`,
  `PARACETAMOL-250-MG-GOI`, `MELOXICAM-7-5-MG`, `ETORICOXIB-60-MG`, `AMOXICILLIN-250-MG-GOI`,
  `CEFUROXIM-500-MG`, `CEFIXIM-200-MG`, `CEFIXIM-100-MG-GOI`, `AZITHROMYCIN-500-MG`,
  `DOXYCYCLIN-100-MG`, `FOSFOMYCIN-3-G`, `CETIRIZIN-10-MG`, `LORATADIN-10-MG`, `FEXOFENADIN-180-MG`,
  `DESLORATADIN-5-MG`, `MONTELUKAST-10-MG`, `SALBUTAMOL-100-MCG-LIEU-BINH-XIT`,
  `SALBUTAMOL-2-MG-5-ML-SIRO`, `BUDESONID-0-5-MG-2-ML-KHI-DUNG`, `ACETYLCYSTEIN-200-MG`,
  `NATRI-CLORID-0-9-NHO-MUI`, `NATRI-CLORID-0-9-NHO-MAT`, `TOBRAMYCIN-0-3-NHO-MAT`, `OMEPRAZOL-20-MG`,
  `ESOMEPRAZOL-40-MG`, `DOMPERIDON-10-MG`, `ORESOL-MUOI-BU-NUOC`, `KEM-10-MG`, `RACECADOTRIL-100-MG`,
  `RACECADOTRIL-30-MG-GOI`, `LACTULOSE-10-G-15-ML`, `SIMETHICON-40-MG`, `MEN-VI-SINH-LACTOBACILLUS`,
  `NHOM-HYDROXYD-MAGNESI-HYDROXYD`, `AMLODIPIN-5-MG`, `LOSARTAN-50-MG`, `ATORVASTATIN-20-MG`,
  `METFORMIN-500-MG`, `METFORMIN-850-MG`, `ALLOPURINOL-300-MG`, `VITAMIN-C-500-MG`,
  `VITAMIN-D3-400-IU-GIOT`, `SAT-FUMARAT-ACID-FOLIC`, `CALCI-CARBONAT-VITAMIN-D3`, `FLUNARIZIN-5-MG`,
  `EPERISON-50-MG`, `GLUCOSAMIN-500-MG`, `HYDROCORTISON-1-KEM`, `BENZOYL-PEROXID-2-5-GEL`,
  `ADAPALEN-0-1-GEL` — **khớp 100 %, không có mã bịa**.
- **Toàn bộ mã ICD-10** (41 mã khác nhau, 21 ở Nội + 20 ở Nhi) tồn tại trong
  `packages/catalogs/src/icd10.ts`; cờ `chronic` đúng với các mã thiết kế gọi là mạn (`I10`, `E11.9`,
  `E78.5`, `M10.9`, `M17.9`, `J45.9`, `Z76.0`).
- **Mọi `dx[0]` đều có dòng trong `NARRATIVE`** của đúng chuyên khoa — kể cả `dx[0]` của 4 lượt đã có
  sẵn trong seed (`J06.9`, `I10`, `J30.4` ở Nội; `J06.9` ở Nhi). Số biến thể khai báo (noi 21 mã / 27
  biến thể, nhi 20 mã / 23 biến thể) đếm lại **đúng**.
- **Mọi nhóm dị ứng** (`penicillin`, `cephalosporin`, `nsaid`, `salicylate`, `sulfonamide`, `macrolide`,
  `quinolone`, `tetracycline`) có trong `ALLERGY_CLASSES`; mọi hoạt chất (`sulfamethoxazol`,
  `azithromycin`, `ibuprofen`, `amoxicillin`) có trong `INGREDIENTS`.
- **Không có đơn nào xung đột dị ứng của chính bệnh nhân** theo đúng ngữ nghĩa `checkPrescription`
  (soát cả 58 lượt). Đặc biệt đúng ở hai chỗ dễ sai: dị ứng `cephalosporin` của bệnh nhân nhi 1 **không**
  xung đột `AMOXICILLIN-250-MG-GOI` (classes `penicillin`+`beta-lactam`, không có `cephalosporin`), và
  dị ứng `salicylate` của bệnh nhân Nội 12 **không** xung đột `MELOXICAM-7-5-MG` (classes chỉ `nsaid`).
- **Không có dòng thuốc nào trùng hoạt chất** trong cùng một đơn (quy tắc `duplicate-ingredient`,
  severity `ack`) — tôi soát từng đơn.
- **`maxDays`**: `DEFAULT_RULES_CONFIG` = `{ maxDays: 30, maxDaysChronic: 90, cccdMinAgeYears: 14,
  weightRequiredUnderYears: 12, paediatricFormUnderYears: 6 }` — đúng như mục 7.3/12.1 nói. Mọi `days`
  trong hai bảng ≤ 30 nên luôn hợp lệ.
- **Quy tắc `paediatric-form`** chỉ nổ khi `route === 'uong' && unit === 'viên' && !paediatric`. Ba trẻ
  dưới 6 tuổi (nhi idx 0, 7, 9) chỉ được kê gói/siro/giọt hoặc `KEM-10-MG` (có cờ `paediatric`) —
  **đúng**; `ORESOL` đơn vị "gói" nên cũng không nổ.
- **Mục 7.3 nói đúng ở điểm cốt lõi**: `buildInstruction`/`computeQuantity`
  (`packages/catalogs/src/instruction.ts`) **chỉ** đọc `line.*`, duy nhất `timing` lấy từ
  `drug.defaults`; nơi hợp nhất `drug.defaults` vào dòng là giao diện (`lineFromDrug`). Hàm `line()` của
  thiết kế là cần thiết, và tôi đã kiểm **từng mã** trong 4 bảng rơi vào đúng một trong 4 nhóm mà 7.3
  liệt kê (defaults đủ / `asNeeded` / dạng trẻ em thiếu `perDose` / `manualQuantity` không có liều).

Chữ ký và hành vi kho (`store`):

- `checkIn(input, now, options?)`: `const arrived = options.arrivedAt ?? now; const day = vnDay(arrived)`
  — truyền `at` làm **tham số thứ hai** đúng như mục 4.2 nói: vừa là giờ đến (`period.start`) vừa quyết
  định ngày đánh số. Đã có `clientUuid` ⇒ trả `{ created: false }` mà không ghi.
- `openVisit(encounterId, doctor, now, openedAt?)`: `markCalled` ghi
  `examOpened = (openedAt ?? now)` và chỉ gắn `examOpenedSource = 'client'` **khi** có tham số thứ tư ⇒
  truyền mốc ở **tham số thứ ba** cho ra `source = 'server'`, đúng mục 4.2. `finished|cancelled` ⇒
  `closed`; `in-progress` do **cùng `userId`** ⇒ `{ kind: 'ok' }` **không ghi gì**; khác `userId` ⇒
  `taken`.
- `completeVisit(cmd)`: phép kiểm `wasCompletedBy` nằm **trước** phép kiểm trạng thái ⇒ ba đường chạy
  lại ở mục 4.3 là **đúng**, kể cả việc đi tiếp sau `closed`. `wasCompletedBy` so
  `identifier` `"<clientUuid>:complete"` trên Encounter đã `finished`.
- `measureVisit` nhánh `server`: `seconds = max(0, round((now − opened)/1000))` ⇒ "giờ ký phải SAU giờ
  mở" là ràng buộc thật; bảng mốc thời gian của mục 4.2/8 cho đúng `seconds` khai báo. Gửi lại khi
  `incomplete` với cùng `cmd.now` cố định giữ `seconds` không đổi.
- `CompleteCommand.exam: ExamInput` là **bắt buộc**; `ExamInput.vitals: VitalsInput` bắt buộc,
  `reason/symptoms/findings` tùy chọn. `VitalsInput` có đúng 8 trường thiết kế dùng.
- `cleanVitals`: không bắt buộc trường nào; chặn số ngoài khoảng; đòi **cả** tâm thu và tâm trương; tâm
  thu > tâm trương. Mọi khoảng mục 7.5 đề xuất nằm trong khoảng hợp lệ.
- `addAllergy` kiểm `kind: 'class'` phải thuộc `ALLERGY_CLASSES` (ném `DomainError`) nhưng **không**
  kiểm `ingredient` — nên hàng tương ứng của mục 12.1 là cần thiết, không trùng lặp.
  `buildHistoryItem` tự chặn > 300 ký tự.
- `advice` → `List.note[0].text` **chỉ khi** `rx.advice?.trim()` khác rỗng và **chỉ khi lượt có đơn**;
  `followUpDays` → `extension[EXTENSIONS.followUpDays].valueInteger`. `toPrescriptionSummary` đọc ngược
  đúng hai chỗ đó. Mục 7.4 nói đúng.
- `BusyError` ném từ `checkIn` khi hết vòng giành số; `writeAll`/`retryOnConflict` chỉ thử lại **xung
  đột giao dịch** (HTTP 409 + mã `40001`), nên 429 nằm trong gói **thật sự** rơi vào
  `kind: 'incomplete'` — lập luận của mục 12.2 đúng. Mẫu `withQuotaRetry` khớp với
  `scripts/backfill-search-keys.ts`: `OperationOutcomeError` → `outcome.id === 'too-many-requests'`,
  `QUOTA_BACKOFF_MS = 15_000`, `MAX_ATTEMPTS = 8` (cả hai hằng đều đã có trong `seed-demo.ts`).

Tìm kiếm (mục 5.3):

- `classifyQuery` phân loại đúng như bảng: `nguyen van` → `name`; `1234` → `phone-fragment`
  (`MIN_FRAGMENT = 3`); `an 1234` → `name+number`; `0912345678` → `phone`; `000123456789` → `cccd`.
- Nhánh `name` chạy **hai** truy vấn: `_tag` khóa từng từ (AND, khớp đúng từ) và `name` của Medplum (AND,
  khớp **đầu từ**), hợp nhất, nhóm khớp-đúng xếp trước (`rankByNameWords`). `foldName` bỏ dấu + chữ
  thường nên "Vân" → `van` và "Ân" → `an`: các suy luận của bảng 5.3 **đúng từng dòng** (tôi kiểm lại
  cả cột "Lọt thêm qua nhánh đầu từ").
- Khóa tìm: `searchKeys` ghi từng từ tên không dấu + **4 số cuối** của mỗi số điện thoại; `phoneSuffixTagQuery`
  với đoạn ≥ 4 chữ số tìm theo đúng 4 số cuối. Các cụm "1234 / 5678 / 7788 / 2345 / 3210" của mục 5.1,
  5.2 tôi đếm lại **khớp** (6/4/4 và 8/2 người), và **không có số điện thoại nào trùng nhau** trong cùng
  phòng khám; 15 số CCCD đều 12 chữ số, đều bắt đầu `000`, không trùng.
- `generatePatients` khởi tạo `usedPhones` từ `spec.story` nên số sinh ngẫu nhiên không đụng số kịch
  bản; thêm bệnh nhân vào `story` **không** phá tính xác định của 17 hồ sơ ngẫu nhiên đã tạo (cùng
  `stableUuid(`${slug}:${i}`)`, cùng dòng `rand()`).
- `searchQuery`: `limit` mặc định 20, tối đa 50 ⇒ `?limit=20` của mục 15 hợp lệ.

Số đo và các con số của mục 9:

- `percentile` = hạng gần nhất, `rank = max(1, ceil(p/100 × n))`; `MAX_COUNTED_SECONDS = 30 × 60` loại
  phiên > 30 phút ra khỏi phân vị nhưng **đếm** ở `excluded`; `TARGET_P50 = 60`, `TARGET_P90 = 120`.
- `metricsQuery.days` mặc định **14**, `from = addDays(to, -(days - 1))` ⇒ khung 14 ngày = hôm nay +
  13 ngày trước ⇒ `daysAgo` 1–13 nằm trong khung, `daysAgo` 20 nằm ngoài: chia khoảng của mục 7.1/7.2
  (Nội idx 3–21, Nhi idx 1–12) **đúng**.
- Tôi **tính lại tay toàn bộ** mục 9 và khớp từng giá trị: Nội 20 lượt ⇒ dãy đã sắp đúng như tài liệu,
  p50 = 58 (hạng 10), p90 = 110 (hạng 18); `noi-doctor` 12 lượt ⇒ 57/116; `noi-owner` 8 lượt ⇒ 58/110;
  Nhi 13 lượt ⇒ 59/105. "Hôm nay" Nội 57/110. (Riêng "Hôm nay" Nhi 78/120 — xem finding 4.)
- `finishedVisits(from, 1000)` lọc `status=finished` + `date ge <đầu ngày from>`, `_count = 1001` ⇒
  không bị cắt với ~58 lượt. 4 lượt đã seed lần trước (`daysAgo` 30–45 tính từ lần seed đó) luôn nằm
  ngoài khung 14 ngày.
- `/api/metrics/visits`: `role === 'owner'` thấy mọi bác sĩ, bác sĩ chỉ thấy của mình ⇒ mục 15 đúng khi
  yêu cầu đăng nhập `noi-owner`.
- Phòng Nhi chỉ có 1 bác sĩ (`nhi-owner`) vì `reuseExisting()` không bổ sung người dùng — và lý do mục 2
  đưa ra là **đúng**: `seedClinical` dùng `file.users.find((u) => u.id === v.doctor)!` nên thêm `users`
  mới vào `CLINICS` sẽ ném `TypeError` trên tenant đã tạo.

Nhật ký, hàng chờ, hạ tầng:

- `AUDIT_FILE` là biến môi trường thật (`services/bff/src/config.ts`, mặc định
  `services/bff/.data/audit.ndjson`); `NdjsonAuditSink` `mkdirSync` thư mục cha rồi mở `append`;
  `recent()` lọc theo `tenant`. `/api/audit` **chỉ** cho `owner`, `limit` mặc định 50, tối đa 200.
- **Cả hai image chạy bằng root** (không có `USER` trong `services/bff/Dockerfile` và
  `apps/clinic-web/Dockerfile`) ⇒ `web` ghi được `/demo/audit.ndjson` trên volume `demo-tenants` mà
  `seed` đang dùng: thay đổi một dòng ở mục 11 **khả thi**.
- `startOutboxWorker` chạy mỗi `OUTBOX_POLL_MS = 2000` ms, `batch = 20`, ghi **một dòng
  `gateway-send`** mỗi lần gửi với `userId: 'system'`, `userName: 'Hộp thư đi'`, `role: 'system'`;
  `SIMULATE_GATEWAY` mặc định `'1'` và `SimulatedGateway` mặc định `mode: 'up'` ⇒ các lần gửi thành
  công. `buildSendTask` đặt `nextAttempt = now` (giờ ký) ⇒ mọi Task đến hạn ngay. Với ~58 đơn: ~3 vòng
  ≈ 6 giây. Mục 10 **đúng**.
- `pendingPrescriptions` chỉ lấy Task `requested,on-hold,in-progress,failed` ⇒ màn "Liên thông" trống
  sau khi gửi xong: ghi nhận của mục 10 **đúng**.
- `/api/queue` và `/api/display` đều dùng `vnDay(ctx.now())`; `/api/display` nằm trong phạm vi có
  `requireSession` nên vẫn cần token. `sortQueue`: đang khám → đang chờ (`urgent` → `appointment` →
  `normal`) → xong/hủy. `listQueue(day)` lọc theo ngày ⇒ hàng chờ các ngày trước không lẫn vào.
- `infra/demo/docker-compose.yml` hiện đúng `SEED_PATIENTS: "20"`, volume `demo-tenants` mount `/demo`
  ở **cả hai** service, `MEDPLUM_URL: http://host.docker.internal:8103`, `restart: "no"`,
  `service_completed_successfully`, `8081:80`.
- `.gitignore`: `git check-ignore -v` xác nhận `services/bff/.demo-tenants.json` (dòng 8),
  `services/bff/.data/` (dòng 9), `infra/medplum/.env` (`infra/medplum/.gitignore` dòng 2).
  `git status --short` trong worktree hiện **chỉ** `?? .agents/`; nhánh hiện tại đúng
  `feat/demo-rich-seed`.
- `pnpm typecheck` ở gốc = `pnpm -r typecheck`; `services/bff/tsconfig.json` có
  `"include": ["src", "scripts", "test"]` ⇒ **`scripts/seed-demo.ts` thật sự được kiểm kiểu**, nên lập
  luận của mục 14 đứng. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: **false**` (các spread có điều kiện trong hàm `line()` vì vậy không bắt
  buộc, chỉ vô hại).
- `docker compose version` trên máy này = **v5.5.0** ⇒ `docker compose run --build` có thật, bước 2 của
  mục 15 chạy được.
- Mục 12.3 **đúng và là một đính chính có giá trị**: `createTenantProject`
  (`services/bff/scripts/medplum-admin.ts`) chỉ tạo `Project` + `ClientApplication` qua
  `admin/projects/:id/client`, **không tạo người dùng Medplum nào**, nên đường `api.pwnedpasswords.com`
  không nằm trên đường đi của seed (trái với giả định trong yêu cầu gốc).
- Các căn cứ hạn mức ở mục 3 khớp **nguyên văn và đúng nhãn độ tin** với `docs/ke-hoach-trien-khai.md`:
  dòng 205 (F5, 50.000 điểm/phút/người dùng ≈ 500 ghi/phút, project gấp 10, `[Đã đọc mã]` + `[Đã đo]`
  429), dòng 454 (1.000 ghi = 2 phút 14 giây), dòng 886 (≈ 2.500 điểm/lượt `[Phân tích, từ mã]`, 429 ở
  chu kỳ 17–18, `_consumedPoints 50011, limit 50000` `[Đã đo]`), dòng 879 (nâng `userFhirQuota` lên
  500.000 ở phiên thử M0-1). Vì hạn mức tính **theo người dùng** và hai phòng khám là hai
  `ClientApplication` thuộc hai `Project` khác nhau, lập luận "hai hạn mức tách biệt" của bậc 1 là đúng.
- `makePrescriptionCode` sinh hậu tố 6 ký tự trên bảng chữ 32 ⇒ khả năng trùng mã đơn trong cùng ngày
  không đáng kể (các cặp lượt cùng ngày trong bảng 7.1/7.2 vì vậy an toàn).
- Thứ tự `daysAgo` **tăng dần** của bảng 7.1 (1…240) và 7.2 (2…150) đúng; "cắt tối đa 13 mục (Nội) /
  10 mục (Nhi)" đúng (idx 34→22 và 22→13), vẫn giữ nguyên khoảng kiểm chứng idx 3–21 / 1–12.
- Tuổi của 15 + 11 bệnh nhân kịch bản khớp `kind` của phòng khám (Nội ≥ 18, Nhi < 14) tính theo ngày
  hôm nay (2026-10-10, lệch một ngày so với mốc 09/10/2026 của tài liệu — không ảnh hưởng ca nào).

---

# Giả định chưa kiểm chứng hoặc đã sai

**Đã sai (và thành finding):**

1. "Quy tắc `respiratoryRate`/`spo2` soát hai chiều" + danh sách idx áp dụng — **sai** vì bỏ sót 3 mục
   đã có sẵn trong `CLINICS`, làm pre-flight từ chối chính dữ liệu của thiết kế → finding 1 (HIGH).
2. "`reason` của lượt `today` … thấy ngay trên hàng chờ" — **sai với 4 lượt `done`**:
   `planCompletion` ghi đè `Encounter.reasonCode` bằng `exam.reason` → finding 2.
3. "Thang lùi về … nếu lần chạy nguội đo được > 8 phút thì áp bậc 1/2/3" — **không khả thi để kiểm
   chứng** trên tenant đã seed (bậc 2 và 3 không bớt dữ liệu đã ghi, đo lại chỉ ra con số của lần chạy
   lại) → finding 3.
4. Mục 9 "phòng Nhi p50 = 59" + ngưỡng mục 15 "p50 ≤ 60" — **chỉ đúng ở ngày seed đầu tiên**; sang ngày
   thứ hai p50 Nhi = 63 vì hai lượt `done` 78/120 nằm trên trung vị → finding 4.
5. "sáu lượt I10 của bệnh nhân idx 10" — thực tế **bảy** lượt lịch sử → finding 5.
6. Thông điệp lỗi mẫu "nhi/visit 16 … xung đột dị ứng 'amoxicillin' của bệnh nhân 2" — mô tả xung đột
   **không tồn tại** trong dữ liệu → finding 6.
7. Mục 4.3 "**Hai** thứ tích tụ lại theo ngày" — thiếu thứ ba (2 lượt `done`/phòng/ngày vào số đo
   Metrics và lịch sử khám) → finding 9.

**Chưa kiểm chứng được ở bước review tài liệu (phải để bước chạy Docker thật trả lời, và phải ghi vào
`trial1-verification.md`):**

- Tổng thời gian seed thật của lần chạy nguội (ước lượng 6,5–9 phút, **sát ngưỡng 8 phút**) và các mốc
  từng giai đoạn; số lần 429 thật và tổng thời gian chờ hạn mức.
- `SEED_PATIENTS=300` có thực sự không đụng trần `totalFhirQuota` của project (500.000 điểm/phút) khi
  chạy **hai phòng song song** ở bậc 1 — hai phòng là hai project nên theo mã là không, nhưng chưa đo.
- Số dòng nhật ký `gateway-send` thật (thiết kế ghi ~35 / ~23; theo số đơn **mới** thì ~34 / ~24 vì 4
  đơn của lần seed trước đã `completed`).
- `docker compose up -d` ở bước 5 có **thật sự** chạy lại service `seed` đã exit 0 hay không (xem
  finding 10).
- `--build` có thật sự làm image `phongmach-demo-seed` mang mã mới (mục 15 đã có hàng ngưỡng riêng: dòng
  chạy khô phải in 15 / 35 / 6 / 11 / 12 chứ không phải 3 / 3 / 0 / 2 / 2).
- Ba container `phongmach-medplum` giữ **nguyên** container id trước/sau.
- Rủi ro rất nhỏ một trong 17 hồ sơ sinh ngẫu nhiên của lần seed trước trùng số điện thoại với một ca
  kịch bản mới (`validateScenario` chỉ soát trùng trong phạm vi `story`); kèm theo đó, nếu trùng thật
  thì vòng `do…while (usedPhones.has(phone))` sẽ lệch dòng `rand()` và đổi dữ liệu của các hồ sơ ngẫu
  nhiên **chưa** tạo — vô hại về tính chạy-lại-được (khóa theo `${slug}:${i}` không đổi) nhưng nên biết.
