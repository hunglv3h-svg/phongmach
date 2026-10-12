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
> mạng; hạt giống `1393699289` từng làm đỏ bước này trong CI (chu kỳ 16: quy tắc `no-cccd` chặn ký
> khi hồ sơ mở bằng bản dự phòng). Tiêu chí chỉ được coi là đạt bền vững khi bài xanh với n hạt
> giống khác nhau, trong đó có `1393699289`.

Quyết định câu chữ thuộc chủ dự án; bước này chỉ đề xuất.
