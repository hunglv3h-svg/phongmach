# Chạy e2e cho OFF-8 — kết quả thật (lần này dựng được stack)

Môi trường: Windows + PowerShell (pwsh). Làm thẳng trên nhánh `main` tại commit
`d589343` (OFF-8 đã merge). KHÔNG sửa mã sản phẩm, KHÔNG sửa test, KHÔNG commit.
Chỉ sinh các tệp cục bộ không commit (`.env`/khóa đã có sẵn từ trước; phòng khám thử
trong `services/bff/.data/e2e-cycles/`).

Hai tệp log đầy đủ (đã lưu, không commit):
- `.agents/tasks/phongmach-fix-off8-sign-print-2026-10-03/e2e-20.log` (20 chu kỳ)
- `.agents/tasks/phongmach-fix-off8-sign-print-2026-10-03/e2e-100.log` và `…/e2e-100b.log`
  (100 chu kỳ, hạt giống 558698034, chạy hai lần)

---

## Tóm tắt một dòng

- **Rủi ro tiêu đề `Date` qua proxy: VẪN CÒN BỎ NGỎ** (không phải "đã kiểm", cũng không
  phải "phát hiện lỗi"): bộ e2e dựng được và chạy, nhưng đường cắt-phản-hồi của nó tạo ra
  **lỗi mạng (status 0)**, nên nhánh đọc `res.headers.get('date')` từ một **phản hồi lỗi
  thật của máy chủ** (status ≠ 0) KHÔNG được e2e chạm tới. Chỉ unit test (mock Date) phủ
  nhánh này.
- **Kết quả e2e đầu bài:** 20 chu kỳ **ĐẠT 13/13** (0 mất, 0 trùng). 100 chu kỳ (hạt giống
  558698034) **KHÔNG đạt 7/13 ở CẢ HAI lần** — nhưng mọi lỗi là **timeout thao tác giao diện
  ở bước "cấp số"** do stack dùng chung chậm dưới tải 100 chu kỳ, **KHÔNG phải lỗi OFF-8** và
  **không có bản ghi nào bị TRÙNG** (chỉ MẤT đúng các chu kỳ không hoàn tất).

---

## 1. openssl có được giải quyết không?

**Không cần dùng tới, nhưng đã xác minh có sẵn.** Lý do: stack Medplum **đã chạy sẵn** từ
trước (các container up 13 giờ, `postgres:true`, `redis:true`), và `.env` +
`config/medplum.config.json` **đã tồn tại**. Nên không phải chạy `setup.mjs`, không phải sinh
khóa RSA → **không cần openssl cho lần chạy này**.

Dù vậy đã định vị openssl phòng khi cần: Git có kèm `C:\Program Files\Git\usr\bin\openssl.exe`
(OpenSSL 3.5.7). Chỉ cần đưa thư mục đó vào PATH là `setup.mjs` chạy được. (Nhánh `bash` mặc
định trên PATH là `C:\Windows\system32\bash.exe` = WSL, không phải Git Bash; Git Bash thật ở
`C:\Program Files\Git\usr\bin\bash.exe`.)

> Chủ ý KHÔNG chạy `setup.mjs --force`: `--force` sẽ ghi đè `.env`/`config` và làm **hỏng quyền
> vào volume Postgres cũ** (chính `setup.mjs` cảnh báo điều này). Stack đang khỏe nên để nguyên.

## 2. setup.mjs có chạy được không?

Không chạy (và không cần) — xem mục 1. Stack đã lên sẵn và khỏe nên bỏ qua bước này một cách
có chủ đích, không phải vì nghẽn.

## 3. Stack có lên khỏe không?

**Có, đã khỏe từ trước.**
- `docker compose ps`: `phongmach-medplum-{medplum-server,postgres,redis}` đều Up (postgres,
  redis "healthy").
- `GET http://localhost:8103/healthcheck` →
  `{"ok":true,"version":"5.2.0-8b7e513","platform":"linux","postgres":true,"redis":true,
  "redisInstances":{"default":true}}`.
- pnpm = 12.8.1 (đúng bản ghim), Node = v22.23.2, Docker = 29.7.2.
- Trình duyệt: `chromium_headless_shell-1243` có sẵn trong cache Playwright; đặt `CHROMIUM_PATH`
  trỏ tới `chrome-headless-shell.exe` theo đúng `browser.mjs` (Windows chỉ dùng headless shell).
- Đã chạy `pnpm install --frozen-lockfile` (node_modules trước đó chưa cài).

## 4. `pnpm e2e:cycles` có chạy trọn không, và pass/fail chính xác

Chạy được tới cùng (không còn nghẽn môi trường như lần trước). Ba lần chạy:

| Lần | Lệnh | Chu kỳ chạy trọn | Kết quả bước kiểm | Mã thoát |
|---|---|---|---|---|
| A | `pnpm e2e:cycles` (mặc định 20, hạt giống ngẫu nhiên 1572923276) | **20/20** | **ĐẠT 13/13** | 0 |
| B | `E2E_CYCLES=100 E2E_SEED=558698034 CYCLES_SKIP_BUILD=1 pnpm e2e:cycles` | 98/100 | **KHÔNG đạt 7/13** | 1 |
| C | như B (chạy lại sau khi để stack nghỉ 90 giây) | 96/100 | **KHÔNG đạt 7/13** | 1 |

Diễn giải thành thật: lần 20 chu kỳ **chạy và ĐẠT**. Lần 100 chu kỳ **chạy và KHÔNG đạt**,
nhưng không-đạt ở đây là do giao diện bị timeout dưới tải, không phải do logic OFF-8 (xem mục 5).

## 5. Trích dòng e2e quan trọng (đếm chu kỳ, xử lý mất-phản-hồi, khẳng định OFF-8, số bản ghi cuối)

### 5a. Lần 20 chu kỳ (ĐẠT) — `e2e-20.log`

```
Hạt giống: 1572923276 · 20 chu kỳ
Đã chạy trọn 20/20 chu kỳ trong 48 giây. Kiểm cuối bài:
✓  1. cả 20 chu kỳ chạy hết, và sau mỗi chu kỳ máy chủ có lượt khám hoàn tất trong 100 giây
✓  2. không chu kỳ nào bị "Ký & In" báo chưa in được rồi phải bấm lại (OFF-8)
✓  3. mỗi chu kỳ in đúng một lần (tổng 20/20)
      máy chủ có/cần: Patient 20/20 · Encounter 20/20 · List 20/20 · Task 20/20 ·
      Provenance 20/20 · ClinicalImpression 20/20 · MedicationRequest 55/55 ·
      Condition 29/29 · Observation 50/50 · AllergyIntolerance 0/0
✓  8. mỗi mã đơn đã in (20 tờ, trong đó 13 tờ in từ dữ liệu trên máy) có đúng một đơn …
✓ 12. mất phản hồi 16 lần (tạo bệnh nhân 4, cấp số 4, gọi vào khám 4, ký và in 4); tải lại
      trang khi mất mạng 7 lần; máy sập lúc in 4 lần: mọi lỗi đã định đều thật sự xảy ra
Đạt 13/13. M0-2 với hạt giống 1572923276: 20 chu kỳ ngắt và khôi phục mạng, 0 bản ghi mất,
0 bản ghi trùng.
```

Điểm cốt lõi của OFF-8: **13/20 tờ đơn "in từ máy"** (bao gồm ca ký lúc giao diện coi là có
mạng mà thao tác trước còn chờ) → in ra ngay, **không có "lưu nhưng không in"**, và check #2
(OFF-8) xanh: **không chu kỳ nào bị báo "chưa in" rồi phải bấm lại**.

### 5b. Lần 100 chu kỳ (KHÔNG đạt — nhưng không phải lỗi OFF-8) — `e2e-100.log` / `e2e-100b.log`

Khẳng định OFF-8 **vẫn XANH** ở cả hai lần:

```
✓  2. không chu kỳ nào bị "Ký & In" báo chưa in được rồi phải bấm lại (OFF-8)
```

Nguồn gốc không-đạt — timeout giao diện ở bước "cấp số", kèm một chu kỳ máy chủ phản hồi rất
chậm ngay trước đó (dấu hiệu stack bị dồn tải / có thể chạm hạn mức điểm FHIR 50.000/phút của
tài khoản máy — đúng rủi ro F5 mà `scripts/e2e-clinic.ts` ghi chú):

```
· chu kỳ 063: … máy chủ nhận sau 32.9 giây [36.1 giây]        ← bình thường median 0.1 giây
✗ chu kỳ 064 (… tải lại trang sau "tạo bệnh nhân"):
 locator.click: Timeout 30000ms exceeded.
  - waiting for getByTestId('result').filter({ hasText: '…' })   ← nghẽn ở màn hình tiếp đón
✗ chu kỳ 093 … locator.click: Timeout 30000ms exceeded.
```

Hệ quả dây chuyền (các bước đếm bản ghi) — **toàn bộ là MẤT (thiếu), KHÔNG có TRÙNG**:

```
✗  1. chu kỳ 064 hỏng ở thao tác "cấp số": locator.click: Timeout 30000ms exceeded.
      chu kỳ 093 hỏng ở thao tác "cấp số": locator.click: Timeout 30000ms exceeded.
✗  3. mỗi chu kỳ in đúng một lần (tổng 98/100)
      Patient 100/100 · Encounter 98/100 · List 98/100 · Task 98/100 · Provenance 98/100 ·
      ClinicalImpression 98/100 · MedicationRequest 251/256 · Condition 134/137 ·
      Observation 262/268 · AllergyIntolerance 0/0
✗  4. Encounter: có 98, cần 100 (MẤT 2) … (List/Task/Provenance/ClinicalImpression đều MẤT 2)
✗  5. chu kỳ 064: bệnh nhân có 0 lượt khám; chu kỳ 093: bệnh nhân có 0 lượt khám
```

Và các bước về **tính toàn vẹn vẫn XANH**:

```
✓  9. trên máy không còn mục chờ, mục xung đột hay mục cần xử lý: cả 457 mục đã xong
✓ 10. đọc thẳng IndexedDB … không có tên, SĐT, CCCD, triệu chứng, tên thuốc hay mã ICD dạng rõ
✓ 11. hàng rào in (F12): cả 98 lần gọi print() đều không còn yêu cầu IndexedDB nào đang dở
✓ 12. mất phản hồi 79 lần … tải lại trang khi mất mạng 37 lần; máy sập lúc in 14 lần
✓ 13. không có lỗi nào trong console của trình duyệt (ngoài lỗi mạng do cố ý cắt)
```

Lần C lặp lại y hệt: check #2 (OFF-8) xanh; các bước MẤT (Encounter 98, List/Task/Provenance/
ClinicalImpression 96) — **không có bất kỳ "TRÙNG" nào** trong cả hai log.

**Kết luận mục 5:** OFF-8 không gây mất/trùng bản ghi, và không để lại ngõ cụt "lưu nhưng không
in". Hai (rồi bốn) chu kỳ "thiếu" ở bài 100 là do **giao diện timeout khi stack chậm**, lỗi
nằm ở độ bền của stack dùng chung dưới tải, không phải ở bản vá OFF-8.

## 6. Câu trả lời về tiêu đề `Date` qua proxy (kèm bằng chứng)

**Trạng thái: VẪN CÒN BỎ NGỎ (chưa kiểm được end-to-end; cũng chưa phát hiện là lỗi).**

Bằng chứng từ mã + cách bộ e2e tạo lỗi:
- Hàng rào ngày A-1 nằm ở `apps/clinic-web/src/api.ts`: khi phản hồi lỗi, đọc
  `res.headers.get('date')` và nhét vào `ApiError.serverDate`. `sync.ts` (`dateFenceAllows`)
  **chỉ** so ngày khi `error.status !== 0` **và** có `clientSignedAt`; nếu `error.serverDate`
  rỗng thì **chặn** (trả "CHƯA in").
- Nhưng đường "mất phản hồi" của bộ e2e (`apps/clinic-web/e2e/offline-cycles.mjs`,
  `loseResponse`) làm: `route.fetch()` rồi `route.abort('failed')`. Trình duyệt vì thế thấy
  **lỗi mạng (status 0)**, không phải một **phản hồi lỗi HTTP có tiêu đề `Date`**. Ở nhánh
  `status === 0`, `dateFenceAllows` trả `true` ngay (dòng "if (!error || error.status === 0)
  return true"), nên **việc đọc `Date` từ phản hồi lỗi thật không hề được chạm tới**.
- Do đó, nhánh then chốt "`Date` của phản hồi 429/503 thật có sống sót qua proxy Vite / bản
  build production hay không" **chỉ có unit test (mock Date) phủ**, bộ e2e chạy ở đây **không**
  tạo ra một phản hồi 4xx/5xx thật mang `Date` để đi hết qua `vite preview` → BFF → trình duyệt.

Vì không bắt được một 429/503 thật mang `Date` chạy xuyên proxy tới trình duyệt trong các lần
chạy này, **không thể tuyên bố ĐÃ KIỂM**. Cũng không có dấu hiệu nào cho thấy nó HỎNG (không ca
nào rơi vào ngõ cụt, không mất/trùng). Nên trạng thái đúng là **BỎ NGỎ**.

> Gợi ý để đóng rủi ro trước 13/11 (ngoài phạm vi bước này, không tự ý sửa): thêm một ca e2e
> dùng `page.route` trả **429 thật kèm tiêu đề `Date`** (cùng ngày và khác ngày) cho yêu cầu
> hoàn tất lúc có mạng — đúng như `offline-sign.mjs` mô tả trong `verification.md` — và chạy nó
> qua bản build + proxy để xác nhận `Date` sống sót. Ba tệp e2e đó đã được mô tả ở lần trước
> nhưng không nằm trong `pnpm e2e:cycles`.

## 7. Hạn mức đăng nhập (5 lần/phút) có bị chạm không, xử lý thế nào?

Có để ý và chủ động tránh. Mỗi lần `pnpm e2e:cycles` gọi `scripts/e2e-clinic.ts` → đăng nhập
siêu quản trị Medplum một lần (`admin@example.com`). Trước khi chạy, đã thử đăng nhập một lần
để xác nhận thông tin đăng nhập (HTTP 200). Giữa các lần chạy đã **chờ 65–90 giây** để cửa sổ
hạn mức 5/phút trôi qua. **Không lần nào bị khóa đăng nhập** — mọi lần tạo phòng khám thử đều
thành công ("Đã tạo phòng khám thử thu-…"). Lỗi 7/13 ở bài 100 **không** liên quan đăng nhập.

## 8. Bước nào không hoàn tất được trong môi trường này, vì sao

- **Nhánh `Date` qua proxy end-to-end**: không hoàn tất được bằng `pnpm e2e:cycles` vì harness
  này tạo lỗi mạng (status 0), không tạo phản hồi lỗi HTTP mang `Date`. Đây là giới hạn của
  bộ e2e đang có, không phải nghẽn hạ tầng. (Xem mục 6.)
- **Bài 100 chu kỳ**: chạy tới cùng nhưng không đạt do giao diện timeout khi stack dùng chung
  chậm (một máy, Medplum chung). Đây là độ bền của stack dưới tải, không phải lỗi OFF-8.
  Bài 20 chu kỳ trên cùng stack thì xanh hoàn toàn.

---

## Kết luận cho câu hỏi chính (rủi ro chưa kiểm trước demo 13/11)

Bản vá OFF-8 **không** để lại ngõ cụt "lưu nhưng không in": trong bài 20 chu kỳ (ĐẠT 13/13) và
cả hai bài 100 chu kỳ, khẳng định OFF-8 (check #2) đều XANH và nhiều tờ đơn được "in từ máy"
ngay khi ký lúc giao diện coi là có mạng mà thao tác trước còn chờ; **0 bản ghi trùng** ở mọi
lần. Tuy nhiên **rủi ro "`Date` sống sót qua proxy/production" VẪN CÒN BỎ NGỎ** vì bộ e2e hiện
có không tạo ra phản hồi lỗi HTTP thật mang `Date` — chỉ unit test mock mới phủ nhánh đó.
