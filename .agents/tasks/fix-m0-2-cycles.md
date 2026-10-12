# M0-2 `e2e:cycles` đỏ ở chu kỳ 16 — báo cáo điều tra

Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\fix-m0-2-cycles`
Nhánh: `fix/m0-2-cycles-sign-blocked` (tạo từ `main`, HEAD `56a5207`)
Kế hoạch sửa: `.agents/tasks/plan.md` (cùng thư mục)

Bước này **chỉ điều tra**: không sửa mã sản phẩm, không sửa bài test.

Môi trường tại chỗ: Windows + PowerShell, `chrome-headless-shell` của Playwright
(`chromium_headless_shell-1243`), `openssl` thêm vào PATH từ `C:\Program Files\Git\usr\bin`,
Medplum dùng chung ở `localhost:8103` (3 container `6bdd98a57bb8`, `396bce70e6ed`, `75c24bc8cbaf`
giữ nguyên suốt quá trình, chỉ `docker ps` để đọc). Mọi lần chạy đều là **bản build** (preview),
mỗi lần một phòng khám thử mới do `pnpm e2e:cycles` tự tạo — không đụng hai phòng khám demo.

---

## 1. Tái hiện trước khi sửa

### 1.1 Chạy đúng hạt giống của lần đỏ, trên đúng commit của lần đỏ

```powershell
# d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\fix-m0-2-cycles  (56a5207)
$env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"
$env:E2E_SEED="1393699289"; $env:CYCLES_WEB_PORT="4184"; $env:CYCLES_BFF_PORT="8121"
pnpm e2e:cycles
```

Kết quả: **KHÔNG tái hiện được — XANH.**

```
Hạt giống: 1393699289 · 20 chu kỳ
· chu kỳ 16: ngắt trước "cấp số", bật lại trước "khám"; mất phản hồi ở "tạo bệnh nhân";
             tải lại trang sau "gọi vào khám" → số 016 (tạm), đơn PM-261012-40MK8Q,
             máy chủ nhận sau 0.0 giây [2.0 giây]
Đã chạy trọn 20/20 chu kỳ trong 49 giây.
Đạt 13/13. M0-2 với hạt giống 1393699289: 20 chu kỳ ngắt và khôi phục mạng,
0 bản ghi mất, 0 bản ghi trùng.
```

Kế hoạch từng chu kỳ khớp CI từng chữ (cùng hạt giống ⇒ cùng kế hoạch, `makePlan` là hàm thuần),
nên khác biệt không nằm ở dữ liệu sinh ra mà ở **môi trường/thời điểm**.

### 1.2 Siết chặt phép thử: chạy riêng hình dạng của chu kỳ 16, 12 lần

Chu kỳ 16 của hạt giống 1393699289 có hình dạng `{cut:1, restore:3, lost:0, reload:2}`.
Tìm hạt giống cho `E2E_CYCLES=1` ra đúng hình dạng đó: `8` (và `9, 74, 101, 110`).

```powershell
$env:E2E_CYCLES="1"; $env:E2E_SEED="8"; $env:CYCLES_SKIP_BUILD="1"
1..12 | % { pnpm e2e:cycles }     # 12 lần, cách nhau 15 giây
```

Kết quả: **12/12 XANH** (mỗi lần ~20 giây, mỗi lần một phòng khám thử mới).
Dòng chạy đúng hình dạng cần: `ngắt trước "cấp số", bật lại trước "khám"; mất phản hồi ở
"tạo bệnh nhân"; tải lại trang sau "gọi vào khám"`.

### 1.3 Khác biệt môi trường (ghi rõ, không suy diễn thêm)

| | CI (đỏ) | Tại chỗ (xanh) |
|---|---|---|
| Hệ điều hành / trình duyệt | Linux, `/usr/bin/google-chrome` | Windows, `chrome-headless-shell` |
| Thời gian 20 chu kỳ | 30 giây (33 giây cả bài) | 49 giây (51 giây cả bài) |
| Kết quả hạt giống 1393699289 | 6/13 bước kiểm sai, chu kỳ 16 hỏng | 13/13, 20/20 |

Hệ quả: lỗi **phụ thuộc thời điểm (đua)**, hạt giống chỉ quyết định *chu kỳ nào* có hình dạng
dễ trúng. Cùng hạt giống 1393699289 cho hai kết quả khác nhau ở hai môi trường, nên không được
kết luận "hạt giống xấu" là đủ, và càng không được ghim hạt giống.

---

## 2. Phép thử phân biệt ở `4013df1`

```powershell
git -C "…\phongmach" worktree add .worktrees/probe-4013df1 --detach 4013df1
# .worktrees\probe-4013df1
$env:E2E_SEED="1393699289"; $env:CYCLES_WEB_PORT="4194"; $env:CYCLES_BFF_PORT="8131"
pnpm e2e:cycles
```

Kết quả: **XANH — `Đạt 11/11`, 20/20 chu kỳ, 48.7 giây** (ở `4013df1` bài có 11 bước kiểm;
13 bước là của HEAD).

Một chi tiết đáng ghi: ở `4013df1`, **đúng chu kỳ 16** là chu kỳ duy nhất gặp triệu chứng OFF-8 cũ:

```
"Ký & In" báo chưa ký được, phải bấm lại, ở 1 chu kỳ: 16 (1 lần).
Câu báo: "Mất kết nối. Đã giữ trên máy và sẽ tự gửi khi có mạng; đơn sẽ không bị lưu trùng."
```

Tức hình dạng của chu kỳ 16 (mất phản hồi ở "tạo bệnh nhân" → ngắt mạng → mở hồ sơ khi mất mạng
→ tải lại trang → bật mạng lại rồi ký) vẫn luôn là chỗ căng nhất của đường ký; `d589343`/`c5940ba`
đã xử lý phần OFF-8 của nó (bước kiểm 2 ở HEAD), nhưng không sinh ra lỗi mới mà bài đang báo.

### 2.1 Vì cả hai commit đều xanh tại chỗ, lấy thêm dữ liệu từ CI (nơi lỗi thật sự xảy ra)

| Nơi chạy | Commit | Hạt giống | Kết quả | Run |
|---|---|---|---|---|
| CI | `56a5207` (main) | 1393699289 | **ĐỎ**, 6/13, chu kỳ 16 không ký được | 38252273087 |
| CI | `93421a5` (= main + 3 commit chỉ chạm seed demo) | 4015508734 | XANH 13/13 | 38253286203 |
| CI | `4013df1` | (ngẫu nhiên) | XANH | 37212073457 |
| CI | `fcd2904` (03/10, **trước** `4013df1`) | 940959941 | **ĐỎ** cùng bước M0-2 nhưng **triệu chứng khác**: `chu kỳ 17 hỏng ở "cấp số": locator.click Timeout 30000ms`, 6/11 | 37108599406 |
| Tại chỗ | `56a5207` | 1393699289 | XANH 13/13 | §1.1 |
| Tại chỗ | `4013df1` | 1393699289 | XANH 11/11 | §2 |

Tuổi của mã gây lỗi (xem §3): `offlineOpen` và bản dự phòng của nó có từ `270604a` (02/10,
M0-S3.3b-2), quy tắc `no-cccd` mức `block` có từ `576a1be` (02/10) — **cả hai đều trước `4013df1`**.
`git show d589343 -- apps/clinic-web/src/local/client.ts` cho thấy nhánh "gửi ngay không xong →
`offlineOpen`" đã có trước commit đó (chỉ đổi cách chuyển mục sang dạng ngoại tuyến).

**Kết luận phép thử phân biệt: lỗi TIỀM ẨN, không phải hồi quy của PR #16/#17.**
Bước M0-2 trong CI đã từng đỏ trước cả `4013df1` (triệu chứng khác, cùng tính chất đua).
Không khoanh vùng tiếp `ca11f77` → `c5940ba` vì không có gì để khoanh: không commit nào trong
dải đó tạo ra đường mã gây chặn ký.

---

## 3. Quy tắc nào chặn ký

Không đoán: lần chạy đỏ của CI có tải lên artifact `e2e-screenshots`, trong đó có
`FAILED-cycles.png` — ảnh chụp đúng lúc bài hỏng ở chu kỳ 16.

```powershell
gh run download 38252273087 -n e2e-screenshots -D "$env:TEMP\ci-shots"
```

Ảnh cho thấy, ở ô "Cảnh báo (2)" của màn hình khám:

> **Không thể ký:** Bệnh nhân chưa có số CCCD (bắt buộc trên đơn thuốc liên thông).

và nút `Ký & In` bị khóa, dưới nút ghi `Chưa thể ký: 1 lỗi không thể ký.`

Dữ liệu trên ảnh khớp chu kỳ 16: sinh hiệu 36,6 / 126 / 82 / 61,5; triệu chứng
"Triệu chứng của chu kỳ 016: ho, đau họng"; chẩn đoán `J20.9`; 2 dòng thuốc
(Acetylcystein 200 mg, Paracetamol 500 mg); chỉ báo đồng bộ ghi **"Có mạng · Đã đồng bộ hết"**.
`FAILED-cycles-end.png` cho thấy hàng chờ còn số 016 "Zc Bình Vinh · 70 tuổi · Đang khám".

### 3.1 Quy tắc, dẫn tệp/dòng

- Chặn: **`no-cccd`** — `packages/rules/src/check.ts:103`
  (`if (cfg.requireCccd !== 'off' && !ctx.patient.hasCccd && age !== undefined && age >= cfg.cccdMinAgeYears)`),
  mức lấy từ `DEFAULT_RULES_CONFIG.requireCccd = 'block'` (`packages/rules/src/types.ts:76`),
  áp dụng từ `cccdMinAgeYears = 14` (`types.ts:77`); bệnh nhân chu kỳ 16 sinh 1956 → 70 tuổi.
- Cảnh báo thứ hai trong cùng ô (ô ghi "(2)") là **`allergy-unknown`** —
  `check.ts:89` (mức `ack`, bài test tự điền lý do nên không chặn).
- Thông điệp "1 lỗi không thể ký" dựng ở `apps/clinic-web/src/visit/Visit.tsx:113-116`
  (`verdict.blocking.length` = 1) — nên đúng **một** phát hiện mức `block`.

### 3.2 Loại trừ giả thuyết "trùng hoạt chất"

- `duplicate-ingredient` có mức **`ack`** (`check.ts:66`), không bao giờ sinh ra "lỗi không thể ký".
- Đơn mẫu `viem-phe-quan-cap` (`packages/catalogs/src/templates.ts:39-49`) gồm
  Acetylcystein 200 mg + Paracetamol 500 mg: khác hoạt chất, đủ liều/số lượng
  (`drugs.ts:80` có mặc định `perDose 1, timesPerDay 3, days 5`), số ngày 5 và 10 < 30
  ⇒ không có `max-days`, không `incomplete-line`, không `unknown-drug`.

### 3.3 Vì sao `no-cccd` lại nổ, dù bài có điền CCCD

`hasCccd` ở giao diện = `!!ctx.patient.cccdMasked` (`apps/clinic-web/src/visit/draft.ts:161`).
Nên lúc ký, bản tóm tắt bệnh nhân của lượt khám **không có `cccdMasked`**.
Chỗ duy nhất trong mã sinh ra bản tóm tắt thiếu `cccdMasked` mà vẫn có `birthDate` là bản
**dự phòng khi mở hồ sơ không thấy bệnh nhân trong bộ đệm**:

```ts
// apps/clinic-web/src/local/client.ts:359
const patient: PatientSummary = cached?.patient ?? { id: item.patientId, fullName: item.patientName, ...(item.birthDate ? { birthDate: item.birthDate } : {}) };
// :367
return { context, openedAt, offline: true, allergiesKnown: cached?.allergies !== undefined, … };
```

Hai dấu hiệu trên ảnh khớp đúng nhánh này và chỉ nhánh này:

1. `no-cccd` ⇒ `cached?.patient` không có (dùng bản dựng từ dòng hàng chờ: có tên + ngày sinh,
   không có CCCD);
2. cảnh báo thứ hai `allergy-unknown` ⇒ `cached?.allergies === undefined` (`client.ts:367`).

Nếu bộ đệm có hồ sơ (dù là hồ sơ tạo trên máy khi mất mạng) thì bản tóm tắt đó **có** `cccdMasked`
— chứng minh bằng chính lần chạy CI đó: **chu kỳ 13** cùng kiểu "mất phản hồi ở tạo bệnh nhân +
mở hồ sơ khi mất mạng" nhưng **không tải lại trang** đã ký bình thường. Chu kỳ 16 khác chu kỳ 13
đúng một việc: **tải lại trang khi mất mạng** (`reload: 2`).

Vậy: lúc "Gọi/Tiếp tục khám" sau khi tải lại trang và vừa có mạng lại, `cachedPatient(item.patientId)`
trả `undefined` (dù hồ sơ này do chính máy đó tạo ra vài giây trước), nên lượt khám mở bằng hồ sơ
cụt → quy tắc `no-cccd` chặn ký → bài hỏng. **Cơ chế chính xác của lần tra bộ đệm trượt chưa được
chứng minh**; đó là việc đầu tiên của kế hoạch sửa (tái hiện xác định ở mức kiểm thử đơn vị), không
được sửa mò.

---

## 4. Kết luận nguyên nhân

**(b) Mã sản phẩm.** Căn cứ:

- **Không phải (a) bộ sinh dữ liệu của bài test.** Đơn của chu kỳ 16 hoàn toàn hợp lệ: hai hoạt chất
  khác nhau, đủ liều và số lượng, 5 và 10 ngày (< 30), bệnh nhân đã điền CCCD giả tiền tố `000` ở
  biểu mẫu và máy chủ **có** CCCD đó (các chu kỳ khác cùng bệnh nhân kiểu đó ký được).
  Quy tắc chặn không "làm đúng việc" ở đây: nó chặn vì *máy không biết*, chứ không vì *bệnh nhân
  không có*.
- **Không phải (c) giả định của bài test.** Bài giả định mỗi chu kỳ ký được — đúng: một lượt khám mở
  khi mất mạng, trên máy vừa tiếp đón chính bệnh nhân đó, phải ký và in được (đó là chính tiêu chí
  ngoại tuyến M0-2/OFF-*).
- **Là (b), gồm hai khuyết điểm nối nhau:**
  - **B1 — quy tắc coi "không biết" là "không có".** `no-cccd` chặn cứng dựa trên
    `!!patient.cccdMasked` của *bản ghi trên máy*. Khi mở hồ sơ bằng bản dự phòng, máy không có dữ
    liệu CCCD; kết luận "Bệnh nhân chưa có số CCCD" là **sai sự thật** và bác sĩ **không có cách
    chữa khi mất mạng** (gợi ý trên màn hình là "Bổ sung ở màn hình Tiếp đón rồi mở lại hồ sơ" —
    việc cần mạng). Đây đúng là lỗi mà kho mã đã tự cấm với dị ứng: *"Không được coi 'không biết'
    là 'không dị ứng'"* (`packages/rules/src/types.ts`, quy tắc `allergy-unknown`). CCCD phải theo
    cùng nguyên tắc: **`ack` kèm lý do**, không phải `block`. An toàn vẫn giữ vì BFF chạy lại quy
    tắc khi ký bằng bản ghi của máy chủ (`services/bff/src/routes/clinical.ts:202-213`, dòng 206
    dùng `!!context.patient.cccdMasked` của máy chủ).
  - **B2 — lần tra bộ đệm bệnh nhân trượt** sau khi tải lại trang khi mất mạng rồi có mạng lại,
    làm bản dự phòng bị dùng dù hồ sơ (kèm CCCD và dị ứng) có trên máy. Mất CCCD chỉ là hậu quả
    thấy được; bác sĩ còn mất cả dị ứng, tiền sử, lịch sử khám của bệnh nhân đang ngồi trước mặt.

Lỗi không gây mất hay trùng bản ghi trên máy chủ: các bước kiểm 9 và 11 vẫn xanh trong lần CI đỏ
(hàng đợi trên máy sạch, hàng rào in F12 nguyên), mọi con số "MẤT 1/2/3" chỉ là hậu quả của một
chu kỳ không hoàn thành.

---

## 5. Hạt giống để người sau chạy lại

| Hạt giống | Commit | Kết quả đã biết |
|---|---|---|
| `1393699289` | `56a5207` | ĐỎ trong CI (run 38252273087); XANH tại chỗ (Windows) |
| `1393699289` | `4013df1` | XANH tại chỗ (phép thử phân biệt) |
| `4015508734` | `93421a5` | XANH trong CI (run 38253286203) |
| `940959941` | `fcd2904` | ĐỎ trong CI (run 37108599406) — triệu chứng khác (timeout ở "cấp số") |
| `8` (`E2E_CYCLES=1`) | `56a5207` | XANH 12/12 — hạt giống cho đúng hình dạng chu kỳ 16 |

Kế hoạch sửa còn yêu cầu ≥3 hạt giống ngẫu nhiên mới, ghi lại từng số.

---

## 6. Đề xuất nói lại khẳng định "M0-2 đạt" (KHÔNG tự sửa tài liệu)

`docs/ke-hoach-trien-khai.md` nên nói đúng mức, ví dụ:

> M0-2 đã đạt **trên các hạt giống đã chạy** (ghi rõ danh sách hạt giống và nơi chạy). Bài sinh kế
> hoạch từ một hạt giống ngẫu nhiên mỗi lần chạy, nên một lần xanh chỉ chứng nhận *một* tổ hợp lỗi
> mạng. Ba lỗi tiềm ẩn khác nhau đã làm đỏ bước này (chi tiết §7): quy tắc `no-cccd` chặn ký khi hồ
> sơ mở bằng bản dự phòng; người vừa tiếp đón khi mất mạng biến mất khỏi ô tìm ngay khi có mạng lại;
> dòng hàng chờ bị dựng lại liên tục làm không bấm được nút mở hồ sơ. Cả ba đã sửa và đã có phép thử
> ngược. Tiêu chí chỉ được coi là đạt bền vững khi bài xanh với n hạt giống khác nhau trên **cả
> Linux (CI) và Windows**, trong đó có `1393699289`, `1256812025` và `1962719789`.

Quyết định câu chữ thuộc chủ dự án; bước này chỉ đề xuất.

---

# PHẦN 2 — BẢN SỬA (bước sau của cùng nhiệm vụ)

Nền: nhánh đã **rebase lên `origin/main` (`02c6fc8`)** trước khi sửa, theo bước 0 của kế hoạch.
Xung đột duy nhất là `.agents/tasks/plan.md` (trên `origin/main` là kế hoạch của PR #19 đã merge):
giữ lại bản của `origin/main` và đổi tên kế hoạch của nhiệm vụ này thành
`.agents/tasks/plan-m0-2-cycles.md`, không xoá nội dung của ai.

## 7. Ba nguyên nhân, không phải một

Chạy lại bài với **hạt giống ngẫu nhiên** (điều mà phần điều tra chưa làm) cho thấy M0-2 có **ba**
lỗi tiềm ẩn độc lập, đều **phụ thuộc thời điểm** (cùng hạt giống cho cả xanh lẫn đỏ ở hai lần chạy
khác nhau), nên không hạt giống nào "xấu" và ghim hạt giống chẳng giải quyết gì.

### 7.1 Nguyên nhân A — `no-cccd` chặn ký khi hồ sơ mở bằng bản dự phòng (lần CI đỏ 38252273087)

Đúng như §3–§4 đã chẩn đoán, gồm hai khuyết điểm nối nhau, sửa thành **hai lớp độc lập**:

- **B1 (quy tắc).** `packages/rules`: thêm `cccdKnown?: boolean` vào `RuleContext` (mặc định `true`)
  và quy tắc mới **`cccd-unknown` mức `ack`** — "Máy chưa có dữ liệu CCCD của bệnh nhân này (mở hồ
  sơ khi mất mạng): đối chiếu CCCD trên giấy tờ của bệnh nhân trước khi ký." Khi `cccdKnown === false`
  thì phát `cccd-unknown` thay cho `no-cccd`; `no-cccd` **giữ nguyên mức `block`** cho trường hợp máy
  có dữ liệu và bệnh nhân thật sự chưa có CCCD. Cùng nguyên tắc kho mã đã áp cho `allergy-unknown`:
  không được coi "không biết" là "không có".
- **B2 (mã sản phẩm).** `offlineOpen` không được bỏ rơi dữ liệu máy **đang có**: khi tra bộ đệm theo
  id trượt, dựng lại bản tóm tắt từ mục **"tạo bệnh nhân" còn trong hàng đợi trên máy**
  (`OfflineClient.queuedPatient`) — bệnh nhân do chính máy này tiếp đón thì CCCD, ngày sinh, giới mà
  nhân viên đã nhập vẫn nằm trong hàng đợi. Chỉ đọc kho trên máy, không đoán dữ liệu không có.
- `Opened` thêm `cccdKnown`; `evaluate` và `Visit.tsx` dẫn cờ đó xuống quy tắc. Hai câu trên màn hình
  không còn nói sai: hiện **"CCCD chưa tải về máy"** thay cho "chưa có CCCD", và gợi ý "Bổ sung ở màn
  hình Tiếp đón" (việc cần mạng) chỉ hiện khi máy thật sự biết là chưa có.

**Máy chủ vẫn là chốt chặn thật, không đổi một dòng:** `services/bff/src/routes/clinical.ts:206`
chạy lại quy tắc bằng `hasCccd: !!context.patient.cccdMasked` của **bản ghi máy chủ** và **không
nhận** cờ `cccdKnown` từ client, nên xác nhận `cccd-unknown` của máy khách không bao giờ cứu được
một bệnh nhân thật sự chưa có CCCD (phép thử ngược 3 ở §9).

### 7.2 Nguyên nhân B — người vừa tiếp đón khi mất mạng biến mất khỏi ô tìm ngay khi có mạng lại

Triệu chứng: `locator.click: Timeout 30000ms` ở thao tác **"cấp số"**, đúng triệu chứng của lần CI
đỏ 37108599406 (`fcd2904`). Tái hiện tại chỗ với hạt giống `1962719789`, chu kỳ 04 (ngắt trước "tạo
bệnh nhân", bật lại trước "cấp số", tải lại trang sau "tạo bệnh nhân").

Nguyên nhân là **mã sản phẩm**: `Reception.tsx` khi có mạng chỉ gọi `api.search` của máy chủ. Hồ sơ
vừa tạo khi mất mạng còn mang id tạm và máy chủ chưa nhận ⇒ ô tìm trả **0 kết quả**, dù hồ sơ nằm
ngay trên máy. Người vừa được tiếp đón không ai thấy để cấp số — trái N3 ("không âm thầm") và OFF-4.

Bản sửa: `OfflineClient.searchOnline()` trả kết quả của máy chủ **nối thêm** các hồ sơ trên máy mà
mục "tạo bệnh nhân" của chúng chưa xong; danh sách "chưa gửi" được đọc **trước** khi gọi máy chủ (để
mục vừa gửi xong đúng lúc đó không rơi vào khe hở giữa hai lần đọc) rồi lọc trùng theo id máy chủ.
`Reception.tsx` dùng hàm này và hiện nhãn **"chưa đồng bộ"** (`data-testid="result-unsynced"`) trên
các dòng đó: không để người dùng tưởng hồ sơ đã lên máy chủ.

### 7.3 Nguyên nhân C — dòng hàng chờ bị dựng lại đúng lúc bấm nút mở hồ sơ

Triệu chứng: `locator.click: Timeout 30000ms` ở **"ký và in"**, call log ghi
`element was detached from the DOM, retrying` suốt 30 giây cho nút `call` của dòng hàng chờ. Tái hiện
với hạt giống `1256812025`, chu kỳ 13.

Nguyên nhân: màn Hàng chờ tự tải lại 5 giây một lần **và** gộp lại mỗi khi `sync.version` đổi (bộ máy
đồng bộ tăng số này ở mỗi lần ghi kho). Trong lúc hàng đợi đang được gửi hết, dòng bị dựng lại liên
tục và còn **đổi khu vực** giữa "đang khám" và "đang chờ", nên thẻ nút mà Playwright đang giữ rời
khỏi DOM; cơ chế tự thử lại của Playwright bám vào thẻ cũ nên bị bỏ đói.

Bản sửa **ở bài test, không nới phép kiểm**: `openVisit` **tìm lại nút ở từng lần thử** trong đúng
hạn 30 giây cũ (mỗi lần bấm hạn 2 giây). Thao tác vẫn buộc phải thành công trong 30 giây; chỉ không
còn đòi dòng đứng yên suốt cả lần bấm. Số lần phải thử lại được **đếm và in ra** ở ghi chú từng chu
kỳ và ở phần tổng kết, nên hiện tượng churn không bị che: ví dụ dòng thật của một lần chạy xanh —
`Nút mở hồ sơ trên hàng chờ phải thử bấm lại … ở 1 chu kỳ: 13 (1 lần).`

> **Việc còn lại (đề xuất, chưa làm):** churn được xử lý ở bài test chứ **không** ở gốc. Nên có một
> việc riêng cho `apps/clinic-web/src/components/Queue.tsx`: dòng không nên nhảy khu vực khi trạng
> thái dao động giữa ảnh chụp máy chủ và mục chưa đồng bộ, và `usePoll` không nên đặt lại dữ liệu mỗi
> lần cờ `online` lật. Đây là thay đổi giao diện nên không gộp vào bản sửa này.

### 7.4 Bài e2e nói rõ hơn khi hỏng (không yếu đi)

- `sign()` khi nút bị khóa nay in kèm danh sách quy tắc: `[block:no-cccd, ack:allergy-unknown]` —
  không phải tải ảnh chụp của CI về mới biết quy tắc nào chặn.
- `fillAcks()` ghi lý do **đúng với từng quy tắc** (`allergy-unknown` và `cccd-unknown` có câu riêng)
  thay vì một câu về dị ứng dùng cho mọi phát hiện. Vẫn không có lối tắt "bỏ qua tất cả".

## 8. Danh sách tệp đã sửa

| Tệp | Việc |
|---|---|
| `packages/rules/src/types.ts` | `cccdKnown` trong `RuleContext`, `'cccd-unknown'` trong `RuleId` |
| `packages/rules/src/check.ts` | phát `cccd-unknown` (ack) thay `no-cccd` (block) khi `cccdKnown === false` |
| `packages/rules/test/rules.test.ts` | bài mới cho `cccd-unknown` + khẳng định hành vi `no-cccd` cũ không đổi |
| `apps/clinic-web/src/local/client.ts` | `queuedPatient()`, `Opened.cccdKnown`, `searchOnline()`, `unsyncedMatches()` |
| `apps/clinic-web/src/visit/draft.ts` | `evaluate` nhận và truyền `cccdKnown` |
| `apps/clinic-web/src/visit/Visit.tsx` | truyền `opened.cccdKnown`; hai câu trên màn hình không nói sai |
| `apps/clinic-web/src/components/Reception.tsx` | dùng `searchOnline`, nhãn "chưa đồng bộ" |
| `apps/clinic-web/src/local/fakeBff.ts` | máy chủ giả trả `cccdMasked` như BFF thật; thêm `/api/patients/search` |
| `apps/clinic-web/src/local/client.test.ts` | 4 bài mới (3 cho nguyên nhân A, 1 cho nguyên nhân B) |
| `apps/clinic-web/e2e/offline-cycles.mjs` | nêu tên quy tắc khi không ký được; lý do ack theo quy tắc; bấm lại nút hàng chờ + đếm |
| `services/bff/test/unit/clinical.test.ts` | bài mới: máy chủ vẫn chặn `no-cccd` dù client xác nhận `cccd-unknown` |
| `packages/trial/src/sheets.ts` | nhãn tiếng Việt cho quy tắc mới (`Record<RuleId, string>` nên bắt buộc) |

Không sửa `services/bff/src/**` (chốt chặn CCCD đã đúng), không sửa `docs/ke-hoach-trien-khai.md`.

## 9. Phép thử ngược (mutation): mỗi biện pháp đều được chứng minh đỏ khi gỡ

| # | Gỡ gì | Bài nào ĐỎ | Dòng lỗi quan sát được |
|---|---|---|---|
| 1 | `queuedPatient()` (lớp B2) | `client.test.ts` › "bộ đệm bệnh nhân tra trượt…" | `AssertionError: expected false to be true` (`cccdKnown`) |
| 2 | `ctx.cccdKnown === false` → `false` trong `check.ts` (lớp B1) | `client.test.ts` › "máy không có gì về bệnh nhân này…" | `expected [ 'no-cccd', 'allergy-unknown' ] to include 'cccd-unknown'` |
| 3 | `hasCccd: !!context.patient.cccdMasked` → `true` ở BFF | `bff` unit › "CCCD: máy chủ luôn tự đọc bản ghi…" (và bài CCCD cũ) | `expected [ 201, undefined ] to deeply equal [ 422, 'rules-not-satisfied' ]` |
| 4 | phần nối thêm của `searchOnline` (nguyên nhân B) | `client.test.ts` › "người vừa tiếp đón mà máy chủ chưa nhận…" | `expected [] to deeply equal [ Array(1) ]` |
| 5 | **buộc `offlineOpen` luôn dùng bản dự phòng + `cccdKnown: true`** (= đúng hành vi trước khi sửa) | `E2E_SEED=8 E2E_CYCLES=1 pnpm e2e:cycles` | **ĐỎ 7/13**, bước kiểm 1: `chu kỳ 1 hỏng ở thao tác "ký và in": không ký được: Chưa thể ký: 1 lỗi không thể ký. [block:no-cccd, ack:allergy-unknown]` — **đúng hai phát hiện trên ảnh `FAILED-cycles.png` của lần CI đỏ** |
| 6 | giữ nguyên "buộc dùng bản dự phòng" nhưng **bật lại** lớp B1 | cùng lệnh trên | **XANH 13/13** — chứng minh chính B1 là cái mở được nút ký, và hồ sơ mở bằng bản dự phòng vẫn ký được (có xác nhận kèm lý do) |

Phép thử 5 là mắt khâu mà phần điều tra chưa chứng minh được: nó dựng lại **đúng** lần CI đỏ một cách
xác định, từ triệu chứng đã quan sát (bộ đệm tra trượt) thay vì phải tái hiện được cuộc đua.
Mọi đột biến đều đã hoàn nguyên; `git status` cuối cùng chỉ còn 12 tệp ở §8.

## 10. Kết quả chạy thật (bản build, Windows, `chrome-headless-shell`)

Cổng dùng riêng để không đụng phiên khác: `CYCLES_WEB_PORT=4184`, `CYCLES_BFF_PORT=8121`.
Mỗi lần chạy tự tạo một phòng khám thử mới (`thu-…`), không chạm hai phòng khám demo.

### 10.1 `pnpm e2e:cycles` — 9 lần chạy liên tiếp, 7 hạt giống khác nhau, tất cả **Đạt 13/13, 20/20 chu kỳ**

| Hạt giống | Khi nào | Kết quả |
|---|---|---|
| `1393699289` (hạt giống của lần CI đỏ) | sau bản sửa A | **Đạt 13/13**, 20/20, 41 giây |
| `1393699289` | sau cả ba bản sửa | **Đạt 13/13**, 20/20 |
| `1256812025` | **trước** bản sửa B/C | ĐỎ 6/13 — chu kỳ 13 hỏng ở "ký và in" (nguyên nhân C) |
| `1256812025` ×3 | sau bản sửa | **Đạt 13/13** cả ba lần (một lần cần 1 lần bấm lại ở chu kỳ 13 — có in ra) |
| `1962719789` | **trước** bản sửa B/C | ĐỎ — chu kỳ 04 hỏng ở "cấp số" (nguyên nhân B) |
| `1962719789` ×2 | sau bản sửa | **Đạt 13/13** cả hai lần |
| `3021384584` (ngẫu nhiên) | sau bản sửa | **Đạt 13/13** (1 lần bấm lại ở chu kỳ 05) |
| `293352907` (ngẫu nhiên) | sau bản sửa | **Đạt 13/13** |
| `2196728713` (ngẫu nhiên) | sau bản sửa | **Đạt 13/13** (1 lần bấm lại ở chu kỳ 13) |
| `3034364866` (ngẫu nhiên) | sau bản sửa | **Đạt 13/13** |
| `2327464172` (ngẫu nhiên) | sau bản sửa | **Đạt 13/13** |

Dòng kết luận của lần chạy với hạt giống của CI:

```
Đạt 13/13. M0-2 với hạt giống 1393699289: 20 chu kỳ ngắt và khôi phục mạng,
0 bản ghi mất, 0 bản ghi trùng.
máy chủ có/cần: Patient 20/20 · Encounter 20/20 · List 20/20 · Task 20/20 · Provenance 20/20
             · ClinicalImpression 20/20 · MedicationRequest 56/56 · Condition 27/27
             · Observation 51/51 · AllergyIntolerance 0/0
```

Chạy lại y nguyên: `E2E_SEED=<số> CYCLES_WEB_PORT=4184 CYCLES_BFF_PORT=8121 pnpm e2e:cycles`.

### 10.2 Toàn kho

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | **xanh** (9 package) |
| `pnpm test` | **xanh** — 543 bài: rules 28, clinic-web 217, bff 129, clinical 83, catalogs 54, fhir-vn-model 16, print 4, trial 13 |
| `pnpm build` | **xanh** (có cảnh báo chunk > 500 kB như cũ) |
| `pnpm --filter @phongmach/bff test:integration` | **xanh** 76/76 (Medplum thật) |
| `pnpm --filter @phongmach/clinic-web e2e` (smoke) | **Đạt 13/13** |
| `pnpm --filter @phongmach/clinic-web e2e:visit` | **Đạt 25/25** (gồm bước kiểm trang "Phạm vi") |
| `pnpm --filter @phongmach/clinic-web e2e:offline` | **Đạt 15/15** |
| `pnpm --filter @phongmach/clinic-web e2e:conflict` | **Đạt 13/13** |

Bốn bài e2e trên chạy với BFF `DEMO_AUTH=1` ở `127.0.0.1:8110` và bản build xem trước ở
`localhost:4173` (`E2E_URL=http://localhost:4173`; cổng 5173 của phiên khác KHÔNG bị đụng tới).
Hai tiến trình đó đã được kết thúc sau khi chạy xong; không còn gì nghe ở 4173/8110/4184/8121.

### 10.3 Medplum không bị recreate (bất biến)

`docker ps --filter name=phongmach-medplum` trước và sau toàn bộ quá trình:

```
6bdd98a57bb8 phongmach-medplum-medplum-server-1 Up 12 hours
396bce70e6ed phongmach-medplum-postgres-1        Up 12 hours (healthy)
75c24bc8cbaf phongmach-medplum-redis-1           Up 12 hours (healthy)
```

Cùng ba container id, vẫn `Up`. Chỉ dùng `docker ps` để đọc; không `up`, không `down`, không đụng
volume, không chạm compose của stack dùng chung.

## 11. Hạn chế (ghi rõ, không tuyên bố quá)

1. **Cơ chế của lần tra bộ đệm trượt (B2) vẫn chưa chứng minh được.** Bài đơn vị tiêm đúng *triệu
   chứng* đã quan sát trong CI (`cachedPatient` trả `undefined`) chứ không tái hiện được *cuộc đua*
   sinh ra nó; 12+ lần chạy hình dạng chu kỳ 16 tại chỗ đều xanh. Bản sửa vì thế là **hai lớp độc
   lập** để triệu chứng đó trở thành vô hại (phép thử ngược 5 và 6), không phải một bản sửa trúng
   đích cuộc đua. Nếu sau này còn thấy hồ sơ mở bằng bản dự phòng trong CI, dấu hiệu sẽ là dòng
   `[ack:cccd-unknown, ack:allergy-unknown]` trong ghi chú chu kỳ, không còn là bài đỏ.
2. **Churn của màn Hàng chờ (nguyên nhân C) chỉ được xử lý ở bài test.** Xem đề xuất ở §7.3. Bác sĩ
   thật bấm nút đúng lúc dòng bị dựng lại vẫn có thể bấm trượt một lần.
3. **Chỉ chạy trên Windows + `chrome-headless-shell`.** CI là Linux + `google-chrome` và chạy nhanh
   hơn (30 giây so với 41–75 giây). Cả ba lỗi chỉ lộ ra khi máy bị tải, nên **CI vẫn là nơi phán
   quyết**; 9 lần xanh tại chỗ không thay cho CI.
4. **Hạt giống ngẫu nhiên mỗi lần chạy.** Xanh với 7 hạt giống không chứng minh cho mọi hạt giống;
   đó là lý do §6 đề nghị nói lại khẳng định trong tài liệu kế hoạch.
5. **Môi trường dùng chung.** Để chạy được 4 bài e2e còn lại, worktree này đã chạy `SEED_PATIENTS=5
   pnpm seed` (sinh ra `services/bff/.demo-tenants.json`, không commit) — việc này **chạm hai phòng
   khám demo** như mọi lần `pnpm e2e` vẫn làm; seed là idempotent theo `clientUuid` nên không tạo
   bản ghi trùng, nhưng hàng chờ và nhật ký của phòng khám demo có thêm dữ liệu của lần chạy e2e.
   Bài `e2e:cycles` thì không: nó tự tạo phòng khám thử riêng.
6. Không gặp 429 (hạn mức đăng nhập Medplum) trong lần làm việc này.

## 12. Điều KHÔNG làm (giữ nguyên sức mạnh phép kiểm)

Số chu kỳ vẫn 20; vẫn đủ 13 bước kiểm, không bước nào bị xoá, ghép hay nới ngưỡng; không ghim hạt
giống; không `sleep`; không bỏ qua chu kỳ hỏng; "không ký được" vẫn là bài đỏ. Bài test chỉ được
thêm sức: nêu tên quy tắc chặn, lý do xác nhận đúng theo quy tắc, và đếm số lần phải bấm lại.
