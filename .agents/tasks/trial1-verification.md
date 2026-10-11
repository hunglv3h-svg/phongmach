# Kiểm chứng Trục 1 — làm dày dữ liệu demo PHONGMACH

Nhánh `feat/demo-rich-seed`, worktree `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data`
(viết tắt `$W` trong các lệnh dưới đây). Tài liệu này ghi **lệnh đã chạy + output then chốt**; mục nào
chưa chạy được thì ghi rõ "**chưa kiểm chứng**", không tuyên bố thành công giả.

Trạng thái: **vòng hiện thực 1 đã xong phần không cần Docker** (kiểu, chạy khô, cấu hình compose,
kiểm thử đơn vị). **Phần tích hợp Docker thật chưa chạy** — xem mục 6; nó là một bước riêng sau khi
review mã.

## 1. Phạm vi đã sửa

| Tệp | Thay đổi |
|---|---|
| `services/bff/scripts/seed-demo.ts` | làm dày dữ liệu + bộ kiểm tra kịch bản `validateScenario` + `SEED_DRY_RUN` + chờ hạn mức + sân khấu "hôm nay" |
| `infra/demo/docker-compose.yml` | `SEED_PATIENTS: "${SEED_PATIENTS:-300}"` (thay `"20"`) và thêm `AUDIT_FILE: /demo/audit.ndjson` cho service `web` |
| `.agents/tasks/trial1-verification.md` | tệp này |

`.gitignore` **không phải sửa** (xem mục 2). Không đụng `apps/**`, `packages/**` (kể cả
`packages/catalogs`), `services/bff/src/**`, `infra/medplum/**`.

```
> git -C $W diff --stat
 infra/demo/docker-compose.yml     |  12 +++++-
 services/bff/scripts/seed-demo.ts | 1541 insertions(+), 99 deletions(-)
```

## 2. Lệnh đã chạy và kết quả

Tất cả chạy trên Windows + PowerShell, cwd là workspace gốc, mọi lệnh dùng đường dẫn tuyệt đối.

| # | Lệnh | Kết quả |
|---|---|---|
| 1 | `pnpm --dir $W install --frozen-lockfile` | `Done in 9.6s using pnpm v12.8.1` (worktree chưa có `node_modules`) |
| 2 | `pnpm --dir $W typecheck` (**trên mã chưa sửa**, làm mốc so sánh) | 8/8 gói `Done`, exit 0 |
| 3 | `pnpm --dir $W --filter @phongmach/bff typecheck` (sau khi sửa) | `tsc -p tsconfig.json`, exit 0 |
| 4 | `pnpm --dir $W typecheck` (**toàn monorepo, sau khi sửa**) | 8/8 gói `Done`, exit 0 |
| 5 | `$env:SEED_DRY_RUN="1"; pnpm --dir $W --filter @phongmach/bff exec tsx scripts/seed-demo.ts` | exit 0, in đúng hai dòng thống kê (dưới) |
| 6 | **Phép thử ngược** của mục 5 (xem mục 3) | exit 1 kèm thông điệp đúng chỗ sai |
| 7 | `docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" config` | exit 0, in `SEED_PATIENTS: "300"` và `AUDIT_FILE: /demo/audit.ndjson` |
| 8 | `git -C $W check-ignore -v services/bff/.demo-tenants.json services/bff/.data/x infra/medplum/.env` | exit 0 cho cả ba (xem dưới) |
| 9 | `pnpm --dir $W --filter @phongmach/bff test` | `Test Files 10 passed (10)`, `Tests 128 passed (128)`, exit 0 |
| 10 | `git -C $W status --short` | chỉ `M infra/demo/docker-compose.yml`, `M services/bff/scripts/seed-demo.ts`, `?? .agents/` |

Chạy khô (lệnh 5) — **đây cũng là cách nhận ra image đã build lại hay chưa**:

```
noi-tong-quat: 15 bệnh nhân kịch bản, 35 lượt khám cũ, 6 lượt hôm nay, 11 dị ứng, 12 tiền sử
nhi: 11 bệnh nhân kịch bản, 23 lượt khám cũ, 6 lượt hôm nay, 7 dị ứng, 8 tiền sử
SEED_DRY_RUN=1: chỉ chạy bộ kiểm tra kịch bản, không nối Medplum.
```

Bí mật không vào git (lệnh 8):

```
.gitignore:8:services/bff/.demo-tenants.json    services/bff/.demo-tenants.json
.gitignore:9:services/bff/.data/                services/bff/.data/x
infra/medplum/.gitignore:2:.env                 infra/medplum/.env
```

⇒ cả ba đường dẫn bí mật đều đã bị loại, **không thêm entry nào vào `.gitignore`**.

**Reviewer không cần chạy lại `pnpm typecheck`**: lệnh 3 và 4 ở trên đã xanh sau khi mã đạt trạng thái
cuối (không sửa gì thêm sau lệnh 9).

## 3. Finding 1 (HIGH) — đã chọn **phương án A**, có bằng chứng

**Việc đã làm:** thêm `spo2: 98` vào `vitals` của `noi-tong-quat` visits **idx 0** (J06.9) và **idx 2**
(J30.4), thêm `respiratoryRate: 28` vào `nhi` visits **idx 0** (J06.9); hai danh sách idx của quy tắc
mục 7.5 chốt thành **Nội 0, 2, 3, 6, 7, 14, 17, 20, 28** và **Nhi 0, 2, 5, 6, 7, 8, 11, 12, 13, 15, 18**
(đúng tập các lượt có `dx[0]` bắt đầu bằng `J` hoặc là `R50.9`, đã đếm lại bằng tay trên cả 58 lượt).

**Vì sao A chứ không B** (B = miễn quy tắc cho các mục cũ, Nội `index >= 3` / Nhi `index >= 1`):

1. A giữ quy tắc soát hai chiều áp cho **toàn bộ** `CLINICS`; B biến quy tắc thành lời khuyên cho một
   phần dữ liệu — đúng cái mà finding 8 của vòng review trước đã bắt.
2. Sửa nội dung một mục **đã** seed là vô hại: tạo có điều kiện thấy khóa `…:visit:0:done` đã có thì bỏ
   qua, không cập nhật ⇒ không có rủi ro nào trên tenant demo đang chạy.
3. Trên tenant trắng, dữ liệu ra nhất quán với quy tắc.

**Bằng chứng quy tắc thật sự chạy (không phải "đọc code thấy ổn"):**

- Chạy khô trên mã cuối: `validateScenario` trả **0 lỗi**, exit **0** (lệnh 5 ở mục 2) ⇒ không có
  `process.exit(1)`, nên container `seed` sẽ không chặn `web` qua
  `depends_on: service_completed_successfully`.
- **Phép thử ngược** (lệnh 6): tạm bỏ `spo2: 98` khỏi `noi-tong-quat` visits idx 0 rồi chạy khô:

  ```
  noi-tong-quat/visit 0: mã J06.9 là hô hấp/sốt nhưng không có spo2
  Bộ kiểm tra kịch bản tìm thấy 1 lỗi — chưa ghi gì vào Medplum.
  EXIT=1
  ```

  Sau đó tệp được hoàn nguyên và chạy khô lại ⇒ exit 0. Nghĩa là quy tắc có hiệu lực thật, và mức
  "0 lỗi" ở trên không phải do bộ kiểm tra bị vô hiệu.

## 4. Ba finding MEDIUM

### Finding 2 — **phương án B**

`reason` chỉ còn ở hai nhánh `waiting` và `in-exam` của union `TodayVisit`; nhánh `done` **không có**
trường `reason` và dùng thẳng `narrative(specialty, exam.dx, index).reason` cho **cả** `checkIn` lẫn
`exam`. Lý do: `planCompletion` ghi `Encounter.reasonCode` = `exam.reason`
(`packages/clinical/src/visit.ts`, khối `closed`), nên câu khai tay của lượt `done` không bao giờ hiển
thị. B để **trình biên dịch** chặn thay vì thêm một luật runtime soát một đẳng thức trùng lặp.
**Hệ quả:** cột "Lý do đến" của 4 dòng `done` trong bảng 8.1/8.2 của `design.md` chỉ là chú giải, không
nhập vào mã.

### Finding 3 — thang lùi, quy trình đã chốt

- **Bậc 1 đã áp ngay từ lần chạy nguội đầu tiên**: `main()` chạy hai phòng khám **song song**
  (`Promise.all(CLINICS.map(seedOneClinic))`). Hai tenant = hai `Project` + hai `ClientApplication` ⇒
  **hai hạn mức tách biệt**. Bậc 1 không làm nghèo dữ liệu nên không có lý do chờ đo mới áp.
- Quyết định bậc 2/3 **bằng mốc từng giai đoạn mà seed in ra**, không bằng một lần đo tổng thứ hai. Seed
  in mỗi phòng một dòng gộp: `<slug>: N bệnh nhân (X,X giây), N dị ứng + N tiền sử (X,X giây), N lượt
  khám cũ (X,X giây), N lượt hôm nay: a chờ, b đang khám, c đã xong (X,X giây)` và một dòng
  `Tổng thời gian seed: M phút S giây`. Ngưỡng: giai đoạn "lượt khám cũ" của một phòng > **4 phút**,
  hoặc tổng > **8 phút**.
- **Bậc lùi 2/3 chỉ có tác dụng trên tenant trắng.** Trên tenant demo hiện tại, mọi tài nguyên của lần
  chạy trước **đã được ghi** và tạo có điều kiện không ghi lại, nên cắt mảng dữ liệu **không xóa gì và
  không tiết kiệm gì**; vì vậy nếu vượt ngưỡng thì ghi **số thật + khuyến nghị cho lần dựng trên tenant
  trắng**, không áp bậc 2/3 lên tenant demo. Muốn có số của tenant trắng thì phải dùng slug mới — ngoài
  phạm vi lần này.

### Finding 4 — `exam.seconds` phòng Nhi

Hai lượt `done` hôm nay của phòng Nhi: idx 0 = **52** giây (không phải 78), idx 1 = **88** (không phải
120). Số đo mong đợi (tính lại tay theo `percentile` hạng gần nhất, `rank = ceil(p/100 × n)` trong
`packages/clinical/src/time.ts`):

| Khung | Phòng | n | p50 | p90 |
|---|---|---|---|---|
| 14 ngày | Nội (idx 3–21, bỏ idx 21 khỏi phân vị, + 2 `done`) | 20 | **58** | **110** |
| 14 ngày | `noi-doctor` / `noi-owner` | 12 / 8 | 57 / 58 | 116 / 110 |
| 14 ngày | Nhi (idx 1–12, bỏ idx 11, + 2 `done`) | 13 | **56** | **90** |
| Hôm nay | Nội / Nhi | 2 / 2 | 57 / **52** | 110 / **88** |

Dãy đã sắp của Nhi khung 14 ngày: `40 45 48 51 52 53 56 59 63 70 88 90 105` ⇒ p50 = phần tử thứ 7 = 56,
p90 = phần tử thứ 12 = 90. Kiểm chéo ngày thứ 2 và thứ 3 (mỗi ngày seed thêm 2 lượt `done` mỗi phòng):
p50 Nhi vẫn **56**, p50 Nội vẫn **58** ⇒ cả hai dưới `TARGET_P50_SECONDS = 60`.

## 5. Tám finding NIT

| # | Đã làm |
|---|---|
| 5 | Chú thích trong mã ghi đúng: **bảy** lượt lịch sử I10 của BN idx 10 là idx 16, 24, 25, 26, 29, 30, 32 ⇒ biến thể 1, 0, 1, 2, 2, 0, 2; cộng 1 lượt `done` hôm nay = 8 lượt. Dãy 8 lượt I10 (9, 16, 24, 25, 26, 29, 30, 32) ⇒ 0, 1, 0, 1, 2, 2, 0, 2 |
| 6 | Thông điệp xung đột dị ứng dựng **từ biến**: `` `${at} dòng ${n+1}: ${drug.code} xung đột dị ứng '${allergy.value}' của bệnh nhân ${patient}` `` — không hardcode ví dụ nào (dữ liệu hiện **không** có xung đột; chạy khô xác nhận) |
| 7 | Biến thể I10 #2 có `reason` = **"Hết thuốc huyết áp"**; hậu tố Z76.0 vẫn cộng ⇒ visits idx 29 ra "Hết thuốc huyết áp, xin cấp lại đơn" (không còn câu lặp) |
| 8 | Kẹp **hai đầu** cả `at` lẫn `openedAt`: `clamp(ms, lower) = new Date(Math.min(Math.max(ms, lower), now))` với `lower` = `floor` (00:05 giờ VN của `vnDay(now)`) cho `at`, và `lower` = `at` cho `openedAt` |
| 9 | Khối chú thích **"BA THỨ TÍCH TỤ LẠI THEO NGÀY"** có trong mã (ngay trên `seedClinical`) và trong mục 7 của tệp này |
| 10 | Bằng chứng chạy-lại-được sẽ dùng **đường chắc chắn** `docker compose … run --rm seed` + `logs --timestamps seed` (lệnh ở mục 6) |
| 11 | Một cách đếm duy nhất, dùng ở mọi chỗ: **58 lượt đi hết đường** = 54 lượt lịch sử **mới** (32 Nội + 22 Nhi) + 4 lượt `done` hôm nay; **cộng 8 lượt chỉ cấp số / chỉ mở hồ sơ** (6 `waiting` + 2 `in-exam`); **cộng 4 lượt lịch sử cũ** chạy lại không ghi gì (3 Nội + 1 Nhi đã có từ lần seed trước) |
| 12 | `weightKg` khai trong hai bảng hằng `WEIGHT_NOI` / `WEIGHT_NHI` (khóa = chỉ số `story`) nên ràng buộc "lệch ≤ 10 % trong 30 ngày" thỏa **theo cấu trúc**; các trường sinh hiệu khác là hằng viết thẳng trong mảng; `validateScenario` vẫn soát cả ba: khoảng giá trị, hai chiều `respiratoryRate`/`spo2`, và lệch cân ≤ 10 % |

## 6. Phần tích hợp Docker — **CHƯA CHẠY** (bước riêng)

Lý do: vòng này chỉ hiện thực + cổng chất lượng không cần Docker; việc dựng demo thật và đo thời gian
seed là một bước kiểm chứng riêng sau khi mã được review. **Chưa có** con số thời gian seed thật, chưa
có kết quả truy vấn qua cổng 8081, chưa có bằng chứng Medplum không recreate. Không được coi mục này là
đã đạt.

Thứ tự lệnh phải chạy (luôn đủ `-p phongmach-demo -f "$W\infra\demo\docker-compose.yml"`):

```powershell
$W = "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data"
# 0. BẤT BIẾN: chụp container id Medplum TRƯỚC (chỉ đọc)
docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
# 1. Chạy khô TRONG IMAGE MỚI — PHẢI có --build, không thì đang kiểm mã CŨ
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm --build -e SEED_DRY_RUN=1 seed
# 2. LẦN CHẠY NGUỘI: dựng demo và ĐO
Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d --build }
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs seed     # lấy mốc từng giai đoạn + dòng "Tổng thời gian seed"
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" ps
# 3. Kiểm qua cổng 8081 (bảng ngưỡng dưới)
# 4. (finding 10) chạy lại seed bằng ĐƯỜNG CHẮC CHẮN + mốc thời gian log
Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm seed }
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs --timestamps seed | Select-Object -Last 20
# 5. BẤT BIẾN: chụp lại container id Medplum SAU — phải GIỐNG HỆT bước 0
docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
```

Ngưỡng đạt — dùng "≥ kèm danh sách phải có mặt", **không** dùng đẳng thức (tenant demo là tenant dùng
lại, có bệnh nhân sinh ngẫu nhiên):

| Kiểm | Đạt khi |
|---|---|
| Chạy khô (bước 1) | in `15 / 35 / 6 / 11 / 12` (Nội) và `11 / 23 / 6 / 7 / 8` (Nhi). Ra `3 / 3 / 0 / 2 / 2` nghĩa là image **chưa** build lại |
| `seed` | container thoát **0**; `web` **healthy** |
| `/api/session/demo-users` | 2 tenant, 5 người dùng |
| `search?q=nguyen van` | ≥ 6 ca phòng Nội, có cả bản có dấu và **"Nguyen Van An"** không dấu |
| `search?q=van an` | ≥ 5 ca: Nguyễn Văn An, Nguyễn Văn Ân, Nguyen Van An, Trần Văn An, Phạm Văn An |
| `search?q=1234` | ≥ 6 ca; 6 số kịch bản (0913451234, 0918881234, 0938881234, 0909991234, 0977771234, 0966661234) ở **nhóm đầu** |
| `/api/queue` | ≥ 6 lượt mỗi phòng; ≥ 1 `in-exam`, ≥ 3 `waiting` xếp urgent → appointment → normal, ≥ 2 `done` |
| `/api/display` | `inExam` ≥ 1, `waiting` ≥ 3 (màn hình chờ **không trống**) |
| `/api/metrics/visits?days=14` | Nội `all.visits` ≥ 20, p50 ≈ 58 ≤ 60, p90 ≈ 110 ≤ 120, `excluded` ≥ 1, 2 dòng bác sĩ; Nhi ≥ 13, p50 ≈ 56, p90 ≈ 90 |
| `/api/metrics/visits?days=1` | Nội ≈ 57 / 110; Nhi ≈ **52 / 88** |
| `/api/audit?limit=50` | ≥ 20 dòng, có `gateway-send` của "Hộp thư đi" |
| `patients/<id>/visits` (BN idx 10 Nội) | ≥ 8 lượt, mỗi lượt có chẩn đoán + đơn nhiều dòng + `prescription.advice` khác rỗng; ≥ 1 lượt có `followUpDays`; ≥ 2 giá trị `reason` khác nhau |
| Chạy lại (bước 4) | seed thoát 0, `Patient._total` **không tăng**, thời gian lần hai ghi **riêng** |
| **Medplum** | 3 container **cùng container id**, vẫn `Up`, không `Restarting` |
| Dọn dẹp | **KHÔNG** `down`, **KHÔNG** `down -v`; để demo chạy |

Phải ghi khi chạy: thời gian lần nguội + **mốc từng giai đoạn**, thời gian lần chạy lại (ghi riêng), số
lần 429 và tổng thời gian chờ hạn mức, và nếu có lỗi mạng/hạn chế nào thì ghi **nguyên văn** kèm kết
luận "chưa kiểm chứng được".

## 7. Ba thứ tích tụ lại theo ngày (finding 9) — không phải lỗi dữ liệu

Mỗi ngày seed chạy để lại, **mỗi phòng**:

1. **3 Encounter `arrived`** (ba lượt `waiting`). `listQueue(day)` lọc theo ngày nên hàng chờ hôm nay
   không thấy chúng.
2. **1 Encounter `in-progress`** (lượt `in-exam`) **không bao giờ được đóng**: ngày sau không ai ký nó
   và khóa của seed ngày sau mang `vnDay(now)` mới. Vô hại với cả ba đường đọc (`listQueue` lọc theo
   ngày; `finishedVisits` và `patientVisits` chỉ lấy `finished`). Muốn dọn thì dùng màn "Hủy lượt" trên
   giao diện — không thuộc phạm vi seed.
3. **2 lượt `done`**: chúng `finished` nên **đi vào** `finishedVisits` (số đo Metrics khung 14/30 ngày)
   **và** `patientVisits` (lịch sử khám của ca trình diễn dài thêm 1 lượt mỗi ngày). Đây là nguồn của
   finding 4 — vì vậy `exam.seconds` của hai lượt đó phải nằm quanh trung vị, xem mục 4.

Ghi chú thật thà khác: các đơn thuốc cũ do seed tạo được **cổng mô phỏng gửi "hôm nay"** (worker hộp thư
đi gửi ngay khi `web` khởi động), nên dòng nhật ký `gateway-send` mang mốc hôm nay dù đơn thuộc lượt khám
cũ; và sau khi hộp thư đi gửi xong, màn "Liên thông" (đơn chờ gửi) **trống** — đó là **hành vi đúng**
(`pendingPrescriptions` chỉ lấy `Task` ở `requested/on-hold/in-progress/failed`), màn này đầy lên khi bác
sĩ ký đơn mới trong lúc demo.

## 8. Những chỗ đã đối chiếu mã và **không** làm theo review/thiết kế

1. **Trần `advice` không phải 300 ký tự.** `services/bff/src/routes/clinical.ts` dòng 73:
   `advice: z.string().max(1000)`. Trần 300 là của `exam.reason` (dòng 51) và `historyBody.text`
   (dòng 85); `checkInBody.reason` là 200 (dòng 39). Vì vậy mã ghi rõ `ADVICE_MAX = 300` là **trần tự
   đặt của seed cho gọn tờ đơn, chặt hơn trần 1000 của tuyến API** — không ghi "khớp API".
2. **Khoảng mạch / nhịp thở của trẻ soát theo BAO HÌNH, không theo từng nhóm tuổi.** Thiết kế mục 7.5
   chốt mạch 3–5 t: 100–120 và 6–10 t: 84–104; nhịp thở 3–5 t: 24–30 và 6–10 t: 18–24. Giá trị trong
   dữ liệu **được chọn đúng theo nhóm tuổi tại thời điểm viết**, nhưng `validateScenario` soát bao hình
   (mạch 84–120, nhịp thở 18–30) vì tuổi tính từ `birthDate` nên **trôi theo lịch**: một phép kiểm theo
   nhóm tuổi sẽ biến seed thành bom hẹn giờ — ngày một cháu bước qua mốc 6 tuổi là `validateScenario`
   thoát 1 và demo chết. Quy tắc **có mặt / không có mặt** của `respiratoryRate`/`spo2` vẫn soát hai
   chiều đúng như finding 1 đòi. Nhiệt độ của trẻ: thiết kế không chốt khoảng, seed tự chốt 36,4–39,5 °C.
3. **Con số p50/p90 phòng Nhi ở mục 9 của `design.md` đã lạc hậu** (59/105 và "Hôm nay" 78/120): chúng
   là số trước finding 4. Số đúng nằm ở mục 4 của tệp này (56/90 và 52/88). `design.md` được giữ nguyên
   làm hồ sơ, không sửa.

## 9. Khoảng trống đã biết (không chặn)

- **Không thêm bác sĩ mới cho phòng Nhi**: `reuseExisting()` dùng lại `.demo-tenants.json` và không bổ
  sung người dùng, nên thêm vào `CLINICS.users` sẽ làm seed chết trên tenant đã tạo. `validateScenario`
  không bắt được việc này (nó chỉ soát `CLINICS`), nhưng `doctorOf()` đã ném **thông điệp tiếng Việt rõ
  ràng** thay vì `TypeError`. Hệ quả: bảng "Thời gian khám" phòng Nhi có 1 dòng bác sĩ + dòng tổng.
- **Không có địa chỉ bệnh nhân** (`NewPatientInput` không có trường đó): ca trùng tên phân biệt bằng
  ngày sinh + điện thoại + CCCD.
- **Không có kiểm thử đơn vị cho `validateScenario`** (phải thêm tệp trong `services/bff/test/unit`,
  ngoài phạm vi hai tệp). Bù bằng `SEED_DRY_RUN` + phép thử ngược ở mục 3. Backlog: tách
  `validateScenario` ra tệp riêng.
- Nhóm bệnh nhân nhi sinh 2015–2016 vượt 14 tuổi vào 2029–2030 ⇒ `validateScenario` sẽ báo lỗi
  ("làm mới dữ liệu demo") và quy tắc CCCD sẽ chặn kê đơn. Ghi nhận, làm mới dữ liệu trước mốc đó.
- Rủi ro rất nhỏ: một trong các hồ sơ sinh ngẫu nhiên của lần seed trước trùng số điện thoại với một ca
  kịch bản mới (`validateScenario` chỉ soát trùng trong phạm vi `story`). Ghi nhận, không xử.
