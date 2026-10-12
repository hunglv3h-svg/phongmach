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

## 6. Phần tích hợp Docker — **ĐÃ CHẠY THẬT, KẾT QUẢ: THẤT BẠI** (xem mục 10)

> **Cập nhật:** bước này **đã chạy thật trên Docker** và **KHÔNG ĐẠT**. `seed` thoát **exit 1** vì
> `runBatch` không thử lại mục bị **409 + PostgreSQL 40001** (xung đột giao dịch `serializable`).
> Nhật ký nguyên văn, nguyên nhân gốc và trạng thái từng phần ở **mục 10**. Bảng ngưỡng ở mục 6 dưới
> đây giữ nguyên làm kế hoạch; **đa số ngưỡng chưa kiểm được** vì seed chết trước giai đoạn lâm sàng.

Lý do (ghi lúc chưa chạy): vòng này chỉ hiện thực + cổng chất lượng không cần Docker; việc dựng demo thật và đo thời gian
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

---

# 10. KIỂM CHỨNG DOCKER THẬT — KẾT LUẬN: **THẤT BẠI (fail-closed)**

Chạy ngày **12/10/2026** (giờ container UTC trong log, tức trưa 12/10 giờ VN). Môi trường: Windows +
Docker Desktop + PowerShell. `$W` = `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data`.

**Một câu:** `pnpm typecheck` xanh và `validateScenario` chạy đúng (0 lỗi, không `exit(1)`), nhưng
container `seed` **thoát exit 1** sau **7,7 giây** vì `runBatch` **ném lỗi khi gặp mục batch bị HTTP 409
kèm mã PostgreSQL 40001** (xung đột giao dịch `serializable`). Giai đoạn lâm sàng (dị ứng, tiền sử, lượt
khám cũ, sân khấu hàng chờ hôm nay) **chưa bao giờ chạy**. Vì vậy **không đo được thời gian seed**,
**không có sân khấu hàng chờ**, **Metrics rỗng**, và **không có bằng chứng chạy-lại-được**.

## 10.1 Bảng kết quả từng điều kiện fail-closed

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | `docker ps` TRƯỚC: ghi container id Medplum | ✅ **ĐẠT** (mục 10.2) |
| 2 | `pnpm -C $W typecheck` xanh | ✅ **ĐẠT** — 8/8 gói `Done`, `EXITCODE=0` |
| 3a | `validateScenario` **không** `exit(1)` | ✅ **ĐẠT** — in đúng hai dòng thống kê mới, 0 lỗi |
| 3b | `seed` thoát **exit 0** | ❌ **KHÔNG ĐẠT** — `Exited (1)`, lỗi `Phần tử batch lỗi: 409` |
| 3c | `web` healthy | ⚠️ **ĐẠT nhưng KHÔNG hợp lệ** — chỉ healthy sau khi tôi khởi động riêng bằng `--no-deps`; qua đường `depends_on` bình thường thì `web` **không bao giờ khởi động** |
| 4a | Thời gian seed thực tế | ❌ **KHÔNG ĐO ĐƯỢC** — seed chết ở giai đoạn bệnh nhân |
| 4b | Bằng chứng chạy lần hai không tạo trùng | ❌ **KHÔNG CÓ** — không có lần chạy nào thành công để so |
| 5a | `/api/session/demo-users` trả 2 tenant | ✅ **ĐẠT** (mục 10.5) |
| 5b | Tìm `nguyen van` ra nhiều kết quả phân biệt được | ✅ **ĐẠT** — 9 kết quả (mục 10.5) |
| 5c | Tìm theo 4 số cuối điện thoại | ✅ **ĐẠT** — `q=1234` → 8 kết quả, `intent=phone-fragment` |
| 5d | BN story có lịch sử khám + đơn + dị ứng | ⚠️ **ĐẠT bằng DỮ LIỆU CŨ** — chỉ 2 lượt của lần seed trước, **không** phải 8 lượt của bản mới |
| 5e | Hàng chờ hôm nay có ca ở **cả 2** tenant | ❌ **KHÔNG ĐẠT** — `items: []` ở cả hai phòng |
| 5f | Metrics có p50/p90 khác rỗng | ❌ **KHÔNG ĐẠT** — `all.visits: 0`, `doctors: []` |
| 5g | Nhật ký truy cập có dòng | ✅ **ĐẠT** — 12 dòng (phần lớn do chính các lệnh kiểm chứng này sinh ra) |
| 6 | Medplum **giữ nguyên** container id, vẫn running | ✅ **ĐẠT** (mục 10.2) |
| 7 | Không `down`, không `down -v`, không đụng volume Medplum | ✅ **ĐẠT** |

`SEED_PATIENTS` cuối cùng: **giữ 300**, không hạ. Lý do: seed chết sau 7,7 giây vì lỗi xung đột giao
dịch, **không** vì chậm — hạ số bệnh nhân không chữa được lỗi này (thậm chí còn che mất nó vì ít batch
hơn thì ít khả năng đụng xung đột). Thang lùi 150/200 trong thiết kế dành cho trường hợp **quá chậm**,
không phải trường hợp này.

## 10.2 BẤT BIẾN MEDPLUM — ĐẠT, container id giữ nguyên

Ba container `phongmach-medplum` **trước đó đã Exited (0) suốt 32 giờ** (thoát sạch, không crash) và
được **chủ dự án khởi động lại bằng `docker start`** ngay trước lượt kiểm chứng này — **không** phải
chúng chạy liên tục từ trước. Tôi **chỉ đọc** trạng thái bằng `docker ps`, không chạy lệnh nào tác động
lên project `phongmach-medplum`.

```
TRƯỚC (docker ps -a --filter "name=phongmach")
6bdd98a57bb8  phongmach-medplum-medplum-server-1  medplum/medplum-server:5.2.0  Up About a minute
396bce70e6ed  phongmach-medplum-postgres-1        postgres:16                   Up About a minute (healthy)
75c24bc8cbaf  phongmach-medplum-redis-1           redis:7                       Up About a minute (healthy)

SAU (docker ps --filter "name=phongmach-medplum")
6bdd98a57bb8  phongmach-medplum-medplum-server-1  Up 8 minutes
396bce70e6ed  phongmach-medplum-postgres-1        Up 8 minutes (healthy)
75c24bc8cbaf  phongmach-medplum-redis-1           Up 8 minutes (healthy)
```

⇒ **Đúng ba container id**, không recreate, vẫn `Up`, không `Restarting`. Healthcheck trước và sau đều:

```
{"ok":true,"version":"5.2.0-8b7e513","platform":"linux","runtime":"v24.18.1",
 "postgres":true,"redis":true,"redisInstances":{"default":true}}
```

## 10.3 Lệnh đã chạy nguyên văn + output then chốt

### Bước 2 — typecheck: XANH

```
> pnpm -C "$W" typecheck
packages/fhir-vn-model typecheck: Done     packages/catalogs typecheck: Done
packages/rules typecheck: Done             packages/clinical typecheck: Done
packages/print typecheck: Done             packages/trial typecheck: Done
services/bff typecheck: Done               apps/clinic-web typecheck: Done
EXITCODE=0
```

### Bước 3 — dựng demo: seed THẤT BẠI

```
> Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d --build }
 Image phongmach-demo-seed Built
 Image phongmach-demo-web Built
 Container phongmach-demo-seed-1 Recreated
 Container phongmach-demo-web-1 Recreated
 Container phongmach-demo-seed-1 Started
 Container phongmach-demo-seed-1 Waiting
 Container phongmach-demo-seed-1 Error service "seed" didn't complete successfully: exit 1
service "seed" didn't complete successfully: exit 1
=== TONG THOI GIAN up -d --build: 82.6 giay ===
```

```
> docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" ps -a
phongmach-demo-seed-1  Exited (1) 5 minutes ago  exit=1
phongmach-demo-web-1   Up 2 minutes (healthy)    exit=0
```

### Nhật ký seed có mốc thời gian — **bằng chứng image ĐÃ build lại**

```
> docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs --timestamps seed
seed-1 | 2026-10-12T02:50:38.232Z $ tsx scripts/seed-demo.ts
seed-1 | 2026-10-12T02:50:40.016Z noi-tong-quat: 15 bệnh nhân kịch bản, 35 lượt khám cũ, 6 lượt hôm nay, 11 dị ứng, 12 tiền sử
seed-1 | 2026-10-12T02:50:40.017Z nhi: 11 bệnh nhân kịch bản, 23 lượt khám cũ, 6 lượt hôm nay, 7 dị ứng, 8 tiền sử
seed-1 | 2026-10-12T02:50:40.190Z Dùng lại các phòng khám demo đã có.
seed-1 | 2026-10-12T02:50:45.891Z Phần tử batch lỗi: 409
seed-1 | 2026-10-12T02:50:45.918Z [ELIFECYCLE] Command failed with exit code 1.
seed-1 | 2026-10-12T02:50:45.920Z Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL
seed-1 | 2026-10-12T02:50:45.920Z   × "pnpm recursive run" failed in /app/services/bff
```

Hai dòng thống kê in ra **`15 / 35 / 6 / 11 / 12` và `11 / 23 / 6 / 7 / 8`** — đúng bộ số của bản mới
(bản cũ ra `3 / 3 / 0 / 2 / 2`) ⇒ **image đã build lại đúng mã của nhánh `feat/demo-rich-seed`**, và
`validateScenario` đã chạy thật với **0 lỗi**, **không** `process.exit(1)`. Điều kiện 3a đạt.

**Thời gian tới lúc chết: 02:50:38,23 → 02:50:45,89 = 7,66 giây.** Trong đó khoảng 1,8 giây là
`validateScenario` + nạp mã, 0,17 giây đăng nhập lại hai tenant, **5,7 giây** ở giai đoạn ghi bệnh nhân
trước khi gặp 409.

## 10.4 NGUYÊN NHÂN GỐC — 409 là xung đột giao dịch 40001, `runBatch` không thử lại

Nhật ký của **chính Medplum** (`docker logs 6bdd98a57bb8`) nói thẳng, cùng mốc giây với lúc seed chết:

```
{"level":"WARN","timestamp":"2026-10-12T02:50:45.872Z","msg":"Error processing batch",
 "bundleType":"batch",
 "errors":["could not serialize access due to read/write dependencies among transactions",
           "could not serialize access due to read/write dependencies among transactions",
           "could not serialize access due to read/write dependencies among transactions"],
 "totalErrors":3,"projectId":"8c1cff34-a76d-4798-b70c-1cbfe55eed4c", ...}
```

và trước đó hàng loạt dòng Medplum tự thử lại rồi bỏ:

```
{"msg":"Retrying transaction","attempt":0,"transactionAttempts":3,"serializable":true,"delayMs":47,...}
{"msg":"Retrying transaction","attempt":1,"transactionAttempts":3,"serializable":true,"delayMs":90,...}
{"msg":"Transaction failed final attempt","attempt":2,"transactionAttempts":3,"serializable":true,...}
```

`could not serialize access due to read/write dependencies among transactions` **chính là
`serialization_failure` mã `40001`** của PostgreSQL. Medplum tự thử 3 lần (gốc 50 ms) rồi trả **409
`conflict`** cho **từng mục** trong gói.

Đây **đúng y** tình huống F13 mà repo đã có sẵn công cụ xử lý — `services/bff/src/conflict.ts`:

```ts
/** Mục của một gói bị từ chối vì xung đột giao dịch (409 mang mã 40001): mục đó không được ghi,
 *  gửi lại là an toàn. Trong gói, Medplum báo xung đột riêng từng mục (HTTP 200) và vẫn chạy
 *  các mục sau (F11, F13). */
export const isConflictEntry = (failed) =>
  Number.parseInt(failed.status, 10) === 409 && failed.code === SERIALIZATION_FAILURE;
```

Nhưng `runBatch` trong `services/bff/scripts/seed-demo.ts` (dòng ~1574) **chỉ** thử lại 429 và **ném**
với mọi mã khác, kể cả 409/40001:

```ts
const status = String(e.response?.status ?? '');
if (status.startsWith('2')) return;
if (!status.startsWith('429')) throw new Error(`Phần tử batch lỗi: ${status}`);   // ← 409 chết ở đây
failed.push(pending[i]!);
```

**Vì sao lỗi này chỉ lộ ra bây giờ, không lộ ở lần seed 20 bệnh nhân:** bản mới chạy **hai phòng khám
song song** (`Promise.all(CLINICS.map(seedOneClinic))` — "bậc 1" của finding 3) và mỗi phòng ghi
**300** bệnh nhân theo lô `BATCH = 100`. Hai luồng ghi đồng thời vào cùng một PostgreSQL ở mức
`serializable`, cộng các bảng tra cứu dùng chung, nên 40001 là **chuyện thường trực** chứ không phải
ngoại lệ — đúng như chú thích của chính tác giả đã viết về 429. Với 20 bệnh nhân / một lô / tuần tự thì
gần như không bao giờ đụng.

Mâu thuẫn nội tại trong cùng tệp: `completeWithQuotaRetry` có chú thích nhắc đúng `conflict.ts` và
"HTTP 409 + mã PostgreSQL 40001", tức tác giả **biết** cơ chế này, nhưng đường ghi bệnh nhân theo lô
lại không áp dụng.

### Hướng sửa đề nghị (chưa làm — ngoài phạm vi bước kiểm chứng)

1. Trong `runBatch`, coi mục `409` + mã `40001` là **thử lại được** như 429: dùng `isConflictEntry`
   của `services/bff/src/conflict.ts` (đọc `e.response.outcome` để lấy mã), chờ giật ngẫu nhiên
   (`backoff`) chứ không chờ cứng 15 giây như nhánh 429.
2. Giữ `throw` cho mọi 409 **không** mang mã 40001 (đúng tinh thần `isTransactionConflict`: chỉ thử lại
   xung đột giao dịch thật).
3. Cân nhắc giảm tranh chấp: hạ `BATCH` ở giai đoạn bệnh nhân, hoặc **bỏ song song hai phòng** ở giai
   đoạn ghi bệnh nhân (giữ song song ở giai đoạn sau). Lưu ý: đây chỉ là giảm xác suất, **không thay
   thế** được mục 1 — phải có đường thử lại.
4. Sau khi sửa: chạy lại trọn bộ mục 6, lúc đó mới đo được thời gian seed và chứng minh chạy-lại-được.

## 10.5 Trạng thái dữ liệu THỰC TẾ sau lần chạy (số thật lấy từ API)

Đăng nhập thật qua `POST /api/session` (`{"tenant":"noi-tong-quat","userId":"noi-owner"}`) rồi gọi API
bằng `Authorization: Bearer <token>`.

**`/api/session/demo-users` — ĐẠT, 2 tenant / 5 người dùng:**

```json
{"demo":true,"tenants":[
 {"slug":"noi-tong-quat","name":"Phòng khám Nội tổng quát (demo)","users":[
   {"id":"noi-owner","name":"BS. Trần Quốc Hưng (chủ phòng khám)","role":"owner"},
   {"id":"noi-doctor","name":"BS. Lê Thị Thu Hà","role":"doctor"},
   {"id":"noi-assistant","name":"Phụ tá Nguyễn Thị Lan","role":"assistant"}]},
 {"slug":"nhi","name":"Phòng khám Nhi (demo)","users":[
   {"id":"nhi-owner","name":"BS. Phạm Thanh Mai (chủ phòng khám)","role":"owner"},
   {"id":"nhi-assistant","name":"Phụ tá Võ Thị Hạnh","role":"assistant"}]}]}
```

**Tìm bệnh nhân — ĐẠT, và đây là phần dữ liệu mới ĐÃ ghi được:**

```
q='nguyen van'  intent=name  soKetQua=9  hasMore=False
    Nguyễn Văn Tuấn | 2005-07-13 | 0999686189
    Nguyễn Văn Hùng | 1944-01-08 | 0927171364
    Nguyễn Văn An   | 1985-03-15 | 0912345678
    Nguyễn Văn Ánh  | 1996-02-29 | 0918881234
    Nguyễn Văn Bình | 1991-10-06 | 0990523183
    Nguyễn Văn Anh  | 1990-05-12 | 0938881234     ← "Vân Anh", khác "Văn Anh"

q='van an'      intent=name  soKetQua=8  hasMore=False
    Nguyễn Văn An   | 1985-03-15 | 0912345678
    Phạm Văn An     | 1958-11-11 | 0944335678
    Nguyen Van An   | 1979-07-04 | 0913451234     ← KHÔNG DẤU, phân biệt được
    Trần Văn An     | 1983-04-18 | 0966661234
    Nguyễn Văn Ân   | 1991-11-02 | 0903115678     ← dấu mũ
    Nguyễn Văn Ánh  | 1996-02-29 | 0918881234

q='1234'        intent=phone-fragment  soKetQua=8  hasMore=False
    Nguyễn Văn Ánh | 0918881234    Nguyễn Thị An  | 0909991234
    Nguyễn Văn Anh | 0938881234    Nguyen Van An  | 0913451234
    Trần Văn An    | 0966661234    Nguyễn Văn Anh | 0977771234
```

⇒ Các ca trùng/gần trùng tên và 6 số điện thoại cùng đuôi `1234` của kịch bản **đã có trong Medplum**,
**phân biệt được nhau** bằng ngày sinh + điện thoại. Ba điểm demo tìm kiếm (5b, 5c) **đạt**.

**Hàng chờ hôm nay — KHÔNG ĐẠT, rỗng ở cả hai phòng:**

```
> GET /api/queue  (noi-tong-quat)   {"day":"2026-10-12","items":[]}
> GET /api/queue  (nhi)             {"day":"2026-10-12","items":[]}
```

**Metrics — KHÔNG ĐẠT, rỗng:**

```
> GET /api/metrics/visits?days=14  (noi-tong-quat)
{"from":"2026-09-29","to":"2026-10-12","targetP50Seconds":60,"targetP90Seconds":120,
 "excludedLongerThanSeconds":1800,"truncated":false,"doctors":[],
 "all":{"visits":0,"excluded":0,"clientMeasured":0,"invalidClock":0}}
```

**Bệnh nhân story — chỉ có DỮ LIỆU CŨ (2 lượt, không phải 8):** `Nguyễn Văn An / 1985-03-15 /
0912345678`, id `29542098-…`:

```
visits: 2 lượt — 2026-09-04 (I10, đơn 1 dòng AMLODIPIN-5-MG, advice, followUpDays 30)
                 2026-08-25 (J06.9, đơn 2 dòng PARACETAMOL-500-MG + CETIRIZIN-10-MG, advice)
allergies: 1 — class 'penicillin', recordedAt 2026-10-09
history:   1 — "Tăng huyết áp 3 năm, đang dùng amlodipin", recordedAt 2026-10-09
```

`recordedAt 2026-10-09` và cả hai lượt nằm **ngoài** khung 14 ngày ⇒ đúng là dữ liệu của **lần seed
trước** (2 ngày trước, thời `SEED_PATIENTS=20`), **không** phải của bản mới. Vì vậy điều kiện 5d chỉ
"đạt" trên dữ liệu cũ, **không chứng minh được** phần làm dày.

**Nhật ký truy cập:** `GET /api/audit?limit=50` → **12 dòng**. Phần lớn do chính các lệnh kiểm chứng
này sinh (`login`, `search`, `read`, `history-read`, `note-read`), **không** phải 20+ dòng từ dữ liệu
seed như ngưỡng đòi.

**Số thật, nói thẳng:** không đếm được tổng `Patient` vì tuyến API không có endpoint đếm và seed — chỗ
duy nhất in `Patient._total` — chết trước khi tới dòng đó. Chỉ khẳng định được: **các bệnh nhân story
của bản mới đã được ghi**, còn **0 lượt khám mới, 0 dị ứng mới, 0 tiền sử mới, 0 ca hàng chờ**.

## 10.6 Tác động phụ đã gây ra và đã khắc phục

`up -d --build` **recreate** cả `phongmach-demo-seed-1` và `phongmach-demo-web-1`. Vì `seed` thoát 1,
ràng buộc `depends_on: service_completed_successfully` làm `web` **không được khởi động** ⇒ demo ở
`http://localhost:8081` **chết** (`curl` trả `EXIT=7` connection refused), trong khi trước lúc kiểm
chứng nó đang `Up 2 days (healthy)`.

Đã khôi phục bằng một lệnh **không phá hủy**, và đây cũng là cách duy nhất gọi được API để lấy số thật:

```
> docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d --no-deps web
 Container phongmach-demo-web-1 Started
> ... ps   →   phongmach-demo-web-1  Up 25 seconds (healthy)
```

Cổng 8081 hiện **đang chạy** trên dữ liệu **lai**: bệnh nhân mới (đã ghi) + lâm sàng cũ. Volume
`demo-tenants` (chứa `.demo-tenants.json` và `audit.ndjson`) **không bị xóa**; **không** chạy `down`,
**không** `down -v`. Không đụng gì tới project `phongmach-medplum`.

## 10.7 Hạn chế / chưa kiểm chứng được — ghi trung thực

1. **Thời gian seed thực tế: KHÔNG CÓ.** Seed chết sau 7,66 giây ở giai đoạn ghi bệnh nhân. Con số
   82,6 giây là thời gian `up -d --build` (chủ yếu là build image), **không phải** thời gian seed. Vì
   vậy cũng **không quyết được** nên giữ 300 hay hạ 150/200 — thang lùi của finding 3 chưa có dữ liệu
   để kích hoạt.
2. **Bằng chứng chạy-lại-được (finding 10): KHÔNG CÓ.** Chưa chạy `run --rm seed` lần hai vì lần một
   đã thất bại — chạy lại chỉ lặp lại cùng lỗi, không chứng minh được "không tạo trùng". Tính
   idempotent vẫn **chỉ** được xác nhận bằng đọc mã ở mục 3/5 của tệp này, **chưa** bằng Docker thật.
3. **Sân khấu hàng chờ, Metrics p50/p90, lịch sử 8 lượt của BN I10, `/api/display`,
   `/api/prescriptions/pending`: chưa kiểm chứng được** — toàn bộ phụ thuộc giai đoạn `seedClinical`
   chưa chạy.
4. **Hạn mức 429 và `withQuotaRetry` / `completeWithQuotaRetry`: chưa kiểm chứng được.** Medplum có
   ghi `High rate limit consumption` (`used: 18260 / limit: 50000`) nhưng **chưa** 429 thật, nên đường
   chờ-rồi-gửi-lại chưa được chạy qua.
5. **Mạng ra Internet: không phải nguyên nhân thất bại.** Lần seed này **dùng lại** tenant đã có
   (`Dùng lại các phòng khám demo đã có.`) nên **không tạo user mới** ⇒ **không gọi**
   `api.pwnedpasswords.com`. Vì vậy **chưa kiểm chứng được** đường tạo tenant mới có bị chặn mạng hay
   không. Lỗi 409 là lỗi cơ sở dữ liệu nội bộ, hoàn toàn không liên quan mạng ngoài.
6. **`web` healthy không tính là đạt theo đường bình thường.** Nó chỉ healthy nhờ `--no-deps`; luồng
   `up -d --build` chuẩn vẫn để `web` không khởi động.
7. **Trạng thái Medplum trước lượt này không liên tục**: ba container đã Exited (0) 32 giờ và được
   `docker start` lại ngay trước khi kiểm chứng. Dữ liệu còn nguyên, nhưng không được đọc mục 10.2 như
   thể chúng chạy suốt.
