# Kế hoạch hiện thực: làm dày dữ liệu demo PHONGMACH (Trục 1)

Nguồn: `.agents/tasks/design.md` (bản sửa 3) + `.agents/tasks/design-review.json` / `design-review.md`
(verdict `CHANGES_REQUESTED`: 1 HIGH + 3 MEDIUM + 8 NIT). **Cả 12 finding là yêu cầu bắt buộc của bước
hiện thực**; mục "Bản đồ finding" dưới đây chốt cách chữa từng cái và bước nào xử nó.

Worktree (dùng lại, **không** `git worktree add`), nhánh `feat/demo-rich-seed`:

```
d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data
```

Đặt một biến cho gọn và **luôn dùng đường dẫn tuyệt đối** (cwd mặc định của mỗi bước là workspace gốc,
không phải worktree):

```powershell
$W = "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data"
```

## Phạm vi được sửa (tuyệt đối không ra ngoài)

| Được sửa | Không được sửa |
|---|---|
| `services/bff/scripts/seed-demo.ts` | `apps/**`, `packages/**` (kể cả `packages/catalogs`) |
| `infra/demo/docker-compose.yml` (đúng 2 dòng) | `services/bff/src/**` (bất biến BFF) |
| `.agents/tasks/plan.md`, `.agents/tasks/trial1-verification.md` | `infra/medplum/**` |
| `.gitignore` — **chỉ** nếu phát hiện entry bí mật còn thiếu | `design.md`, `design-review.*` (giữ nguyên làm hồ sơ; mọi con số đã đính chính nằm trong tệp này) |

## Bất biến phải giữ (soát lại ở từng bước)

1. **Xác định + chạy lại không trùng**: `rng` = mulberry32 theo `spec.slug`; mọi tài nguyên mới tạo
   **có điều kiện** theo `stableUuid(...)`. Mọi loại mục mới phải có khóa xác định (bảng khóa ở bước 6).
2. **Chỉ thêm vào CUỐI** các mảng `story`, `allergies`, `history`, `visits` — khóa tính theo chỉ số;
   chèn/xóa/đảo giữa mảng sẽ sinh bản trùng trên tenant đã seed. Viết chú thích in đậm ngay trên mỗi mảng.
3. **Ghi qua kho, không viết FHIR tay**: `store.addAllergy`, `store.addHistory`, `store.checkIn`,
   `store.openVisit`, `store.completeVisit` (`MedplumClinicStore`). Chỉ `Patient` đi `executeBatch`
   (mã hiện có, giữ nguyên).
4. Nhãn mô phỏng (`EXTENSIONS.simulated` qua `planCompletion`), CCCD giả **12 chữ số tiền tố `000`**
   (chỉ người ≥ 14 tuổi), danh mục minh họa chưa duyệt y khoa — seed chỉ **đọc** `@phongmach/catalogs`.
5. Web **không** gọi thẳng Medplum (không đụng cấu hình mạng/service trong compose).
6. Không commit bí mật: `.demo-tenants.json` và `audit.ndjson` nằm trong volume `demo-tenants`.
7. **BẤT BIẾN TUYỆT ĐỐI VỀ MEDPLUM**: project `phongmach-medplum` (3 container) **chỉ đọc** bằng
   `docker ps`. Không `down`, `down -v`, `restart`, `up --force-recreate`, không xóa volume. Mọi lệnh
   compose của demo phải có đủ `-p phongmach-demo -f "$W\infra\demo\docker-compose.yml"`.
8. Chỉ dùng **mã thuốc / ICD-10 có thật** trong `packages/catalogs`. Không bịa mã.

## Bản đồ 12 finding → cách chữa đã chốt → bước

| # | Mức | Cách chữa **đã chốt** (lý do) | Bước |
|---|---|---|---|
| 1 | **HIGH** | **Phương án A**: thêm `spo2: 98` vào `vitals` của `noi-tong-quat` visits **idx 0** và **idx 2**, thêm `respiratoryRate: 28` vào `nhi` visits **idx 0**; chốt hai danh sách idx của quy tắc 7.5 thành **Nội 0, 2, 3, 6, 7, 14, 17, 20, 28** và **Nhi 0, 2, 5, 6, 7, 8, 11, 12, 13, 15, 18**. *Lý do chọn A chứ không B:* (a) giữ quy tắc soát hai chiều áp cho **toàn bộ** `CLINICS` — phương án B (miễn các mục cũ) biến quy tắc thành lời khuyên cho một phần dữ liệu, đúng cái mà finding 8 của vòng trước đã bắt; (b) sửa nội dung mục **đã** seed là **vô hại**: tạo-có-điều-kiện thấy khóa `…:visit:0:done` đã có thì bỏ qua, không cập nhật (design mục 4.3), nên không có rủi ro nào trên tenant demo; (c) trên tenant trắng, dữ liệu ra nhất quán với quy tắc. | **1** |
| 2 | MEDIUM | **Phương án B**: `reason` chuyển xuống **chỉ** hai nhánh `waiting` và `in-exam` của union `TodayVisit`; nhánh `done` **không có** `reason` và dùng thẳng `narrative(specialty, exam.dx, index).reason` cho **cả** `checkIn` lẫn `exam`. *Lý do:* `planCompletion` ghi `reasonCode` = `exam.reason` (`packages/clinical/src/visit.ts`, biến `reason` ở khối `closed`), nên câu khai báo tay của lượt `done` **không bao giờ hiển thị**. B để trình biên dịch chặn, cùng tinh thần với cách union xử `exam`/`openedMinutesAgo`; A chỉ thêm một luật runtime soát một đẳng thức trùng lặp. **Hệ quả:** cột "Lý do đến" của **4 dòng `done`** trong bảng 8.1/8.2 của design chỉ là chú giải, **không** nhập vào mã. | **6**, 12 |
| 3 | MEDIUM | Quy trình chốt: (a) áp **bậc 1 (hai phòng khám chạy song song) ngay từ lần chạy nguội đầu tiên** — không làm nghèo dữ liệu; (b) quyết định bậc 2/3 bằng **mốc từng giai đoạn** seed in ra, ngưỡng: giai đoạn "lượt khám cũ" của một phòng > **4 phút** hoặc tổng > **8 phút**; (c) khi vượt ngưỡng thì **ghi nhận số thật + khuyến nghị** cho lần dựng trên tenant trắng, **không** áp bậc 2/3 lên tenant demo (dữ liệu đã ghi, cắt mảng không bớt được gì); (d) ghi vào `trial1-verification.md` câu "bậc lùi chỉ có tác dụng trên tenant trắng"; con số tenant trắng cần slug mới ⇒ ngoài phạm vi. | **8**, 16 |
| 4 | MEDIUM | `exam.seconds` của hai lượt `done` phòng Nhi: idx 0 **78 → 52**, idx 1 **120 → 88**. Con số mục 9 của phòng Nhi đổi theo (đã tính lại tay, xem bảng "Số đo mong đợi" ở bước 12): 14 ngày **p50 = 56 / p90 = 90**; "Hôm nay" **p50 = 52 / p90 = 88**. Ngưỡng mục 15 dùng con số mới. | **12**, 16 |
| 5 | NIT | Chú thích trong mã viết đúng: **bảy** lượt lịch sử I10 của bệnh nhân idx 10 là idx **16, 24, 25, 26, 29, 30, 32** ⇒ biến thể `1, 0, 1, 2, 2, 0, 2`; cộng 1 lượt `done` hôm nay = **8 lượt** (đúng ngưỡng mục 15). Riêng dãy 8 lượt I10 `9, 16, 24, 25, 26, 29, 30, 32` ⇒ `0, 1, 0, 1, 2, 2, 0, 2` thì đã đúng. | **3**, 10 |
| 6 | NIT | Thông điệp lỗi mẫu của `validateScenario` viết **trung tính**, dựng từ biến: `` `${slug}/visit ${i} dòng ${n}: ${code} xung đột dị ứng '${value}' của bệnh nhân ${p}` `` — không hardcode ví dụ cụ thể nào (dữ liệu hiện **không** có xung đột nào; review đã soát cả 58 lượt). | **7** |
| 7 | NIT | `reason` của biến thể **I10 #2** đổi thành **"Hết thuốc huyết áp"** (bỏ ", xin khám lại"). *Lý do chọn cách này chứ không cách "cho `narrative()` bỏ hậu tố khi reason đã chứa chữ thuốc/đơn":* sửa dữ liệu là một thay đổi nhìn thấy được, còn thêm luật ngầm trong hàm thì lần sau không ai đoán được. Hậu tố Z76.0 vẫn cộng như cũ ⇒ idx 29 ra "Hết thuốc huyết áp, xin cấp lại đơn". | **3** |
| 8 | NIT | Kẹp **hai đầu** cả `at` lẫn `openedAt`: `at = new Date(Math.min(Math.max(now - minutesAgo*60_000, floor), now))` với `floor` = mốc 00:05 giờ VN của `vnDay(now)`; `openedAt = new Date(Math.min(Math.max(now - openedMin*60_000, at.getTime()), now))`. | **6** |
| 9 | NIT | Chú thích trong mã + một mục trong `trial1-verification.md`: mỗi ngày seed chạy để lại **3 thứ** tích tụ mỗi phòng — 3 Encounter `arrived`, 1 Encounter `in-progress` (không bao giờ đóng), và **2 lượt `done`** (`status=finished` nên **đi vào** `finishedVisits` của Metrics 14/30 ngày **và** `patientVisits`). Đây là nguồn của finding 4; không phải lỗi dữ liệu. | **6**, 16 |
| 10 | NIT | Bằng chứng chạy-lại-được dùng **đường chắc chắn**: `docker compose … run --rm seed` (bọc `Measure-Command`) + `logs --timestamps seed | Select-Object -Last 20`; ghi rõ đã dùng đường nào và mốc thời gian dòng log. | **16** |
| 11 | NIT | Một cách đếm duy nhất, dùng trong mọi bảng/ước lượng/tài liệu: **58 lượt đi hết đường** = 54 lượt lịch sử **mới** (32 Nội + 22 Nhi) + 4 lượt `done` hôm nay; **cộng 8 lượt chỉ cấp số / chỉ mở hồ sơ** (6 `waiting` + 2 `in-exam`); **cộng 4 lượt lịch sử cũ** chạy lại không ghi gì. | **8**, 16 |
| 12 | NIT | Chốt giá trị `vitals`, không giao khoảng: (a) **`weightKg` khai trong một bảng hằng theo bệnh nhân** (`WEIGHT_NOI` / `WEIGHT_NHI`, khóa = chỉ số `story`) và mọi lượt của người đó dùng đúng giá trị đó ⇒ ràng buộc "lệch ≤ 10 %" thỏa theo cấu trúc; (b) `temperatureC / pulse / systolic / diastolic / respiratoryRate / spo2` viết **hằng thẳng trong mảng** cho từng lượt, lấy trong khoảng mục 7.5; (c) `validateScenario` soát khoảng, soát hai chiều `respiratoryRate`/`spo2`, **và** soát `weightKg` của cùng một bệnh nhân lệch ≤ 10 % giữa các lượt trong 30 ngày. | **7**, 9–12 |

### Hai chỗ review nói chưa chính xác — đã đối chiếu mã, **làm theo mã**

1. **Trần `advice` không phải 300.** `services/bff/src/routes/clinical.ts` dòng 73:
   `advice: z.string().max(1000)`. Trần 300 là của `exam.reason` (dòng 51) và `historyBody.text`
   (dòng 85); `checkInBody.reason` là 200 (dòng 39); `followUpDays` là `int 1…365` (dòng 74); `lines`
   tối đa **20** dòng (dòng 72). ⇒ `validateScenario` soát `advice ≤ 300` như **trần tự đặt của seed**
   (cho gọn tờ đơn), và chú thích phải ghi rõ "chặt hơn trần 1000 của tuyến API", không ghi "khớp API".
2. **`respiratoryRate` người lớn.** Quy tắc 7.5 nói phòng Nội chỉ ghi `spo2`; `cleanVitals`
   (`packages/clinical/src/vitals.ts`) không đòi trường nào, nên để trống là hợp lệ — giữ đúng quy tắc,
   soát hai chiều (lượt Nội có `respiratoryRate` là **lỗi**).

---

# Các bước hiện thực

Mỗi bước phải để repo ở trạng thái **biên dịch được**. Lệnh kiểm nhanh dùng ở gần hết các bước:

```powershell
pnpm -C "$W" --filter @phongmach/bff typecheck     # nhanh (chỉ gói bff; tsconfig include cả scripts/)
pnpm -C "$W" typecheck                              # toàn monorepo (pnpm -r typecheck), chạy ở các mốc
```

- [ ] 0. **Cài phụ thuộc cho worktree.** Worktree **chưa có** `node_modules` (đã kiểm: cả
      `$W\node_modules` và `$W\services\bff\node_modules` đều không tồn tại), nên mọi lệnh
      `pnpm typecheck` / `tsx` sẽ hỏng nếu bỏ bước này. Store của pnpm đã ấm (repo gốc có
      `node_modules`) nên cài nhanh và không cần mạng nhiều.
      Files: — (không sửa tệp nào; chỉ tạo `node_modules/`, đã được `.gitignore` loại)
      Verify: `pnpm -C "$W" install --frozen-lockfile` thoát 0; `pnpm -C "$W" typecheck` **xanh trên mã
      chưa sửa** (mốc so sánh); `git -C "$W" status --short` vẫn chỉ `?? .agents/`.

- [ ] 1. **(FINDING 1 — HIGH, BLOCKER) Bổ sung 3 trường sinh hiệu còn thiếu vào các lượt đã có.**
      Sửa đúng ba dòng `vitals` của mảng `visits` hiện tại, **không** đổi gì khác trong ba mục đó:
      `seed-demo.ts` dòng **82** (`noi-tong-quat` visits[0], J06.9) thêm `spo2: 98`; dòng **97**
      (visits[2], J30.4) thêm `spo2: 98`; dòng **120** (`nhi` visits[0], J06.9) thêm
      `respiratoryRate: 28`. Thêm ngay cạnh một chú thích một dòng: *"spo2/respiratoryRate ở đây là
      để thỏa quy tắc soát hai chiều mục 7.5 — phương án A của review finding 1; sửa nội dung mục đã
      seed không có tác dụng trên tenant cũ nên an toàn."*
      Vì sao bước đầu: nếu không sửa, `validateScenario` (bước 7) trả lỗi và `process.exit(1)`
      **trước khi ghi gì** ⇒ container `seed` khác 0 ⇒ `depends_on: service_completed_successfully`
      giữ `web` không khởi động ⇒ demo chết.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" --filter @phongmach/bff typecheck` xanh; đọc lại 3 dòng và đối chiếu danh
      sách idx đã chốt (Nội 0, 2, 3, 6, 7, 14, 17, 20, 28 / Nhi 0, 2, 5, 6, 7, 8, 11, 12, 13, 15, 18).

- [ ] 2. **Hàm hợp nhất dòng thuốc `line()` và chuyển 4 lượt hiện có sang dùng nó.**
      Thêm `function line(code: string, over: Partial<Omit<LineInput, 'drug'>> = {}): LineInput` đúng
      như design mục 7.3: lấy `perDose`/`timesPerDay`/`days` từ `getDrug(code)!.defaults` rồi cho
      `over` ghi đè; `getDrug` trả `undefined` thì `throw` thông điệp tiếng Việt. Chú thích bắt buộc:
      *liều mặc định của danh mục KHÔNG tự áp vào dòng thuốc* — `buildInstruction`/`computeQuantity`
      (`packages/catalogs/src/instruction.ts`) chỉ đọc `line.*`, chỉ `timing` lấy từ `drug.defaults`;
      nơi duy nhất hợp nhất `defaults` là giao diện (`apps/clinic-web/src/visit/draft.ts`).
      Chuyển 7 dòng thuốc của 4 lượt hiện có sang `line(...)` (giữ **nguyên** kết quả: các dòng
      `asNeeded`/`manualQuantity` vẫn truyền `perDose`/`quantity`/`instruction` tay như hiện tại).
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" --filter @phongmach/bff typecheck` xanh.

- [ ] 3. **(FINDING 5, 7) Bảng `NARRATIVE` + hàm `narrative()`.**
      Thêm `interface Narrative { reason; symptoms; findings; advice; followUpDays? }` và
      `const NARRATIVE: Record<'noi' | 'nhi', Record<string, Narrative[]>>` chép **nguyên văn** bảng
      7.4.1 (21 mã / 27 biến thể) và 7.4.2 (20 mã / 23 biến thể) của design, với **một sửa đổi**:
      `reason` của biến thể **I10 #2** = `"Hết thuốc huyết áp"` (finding 7).
      `function narrative(specialty, dx: string[], index: number): Narrative` chọn
      `variants[index % variants.length]`, `throw` nếu thiếu dòng, và cộng hậu tố `", xin cấp lại đơn"`
      vào `reason` khi `dx.includes('Z76.0')`. Chú thích đếm biến thể viết đúng theo finding 5
      (bảy lượt lịch sử I10 của BN idx 10: idx 16, 24, 25, 26, 29, 30, 32 ⇒ 1, 0, 1, 2, 2, 0, 2).
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" --filter @phongmach/bff typecheck` xanh (bảng chưa được dùng — đúng, bước 4
      mới nối vào).

- [ ] 4. **Đổi kiểu `StoryVisit` và nối `narrative()` vào `seedClinical`.**
      `StoryVisit` (dòng 28–43): `vitals` đổi từ `Record<string, number>` sang **`VitalsInput`** (import
      kiểu từ `@phongmach/clinical`); **thêm** `hour?: number`, `minute?: number`, `seconds?: number`;
      **bỏ hẳn** `reason`, `symptoms`, `findings`, `advice`, `followUpDays`.
      Trong `seedClinical` (dòng 269–323): mốc lượt lịch sử dựng theo **giờ VN tường minh** — lấy
      `day = vnDay(now - daysAgo ngày)` rồi `new Date(day + "T" + hh + ":" + mm + ":00+07:00")` với
      `hh/mm` từ `hour ?? 9` / `minute ?? 0` (chuỗi có hậu tố `+07:00` nên không phụ thuộc TZ của
      container, vốn chạy UTC); `const n = narrative(v.specialty, v.dx, i)`;
      `checkIn({ …, priority: 'normal', reason: n.reason }, at)`; `openVisit(enc.id, doctor, at)`
      (**ba** tham số ⇒ `examOpenedSource = 'server'`; đã đọc `markCalled`,
      `packages/clinical/src/queue.ts` dòng 137–138: `examOpened = (openedAt ?? now)`, chỉ gắn
      `'client'` khi có tham số thứ tư); `completeVisit({ …, now: new Date(at.getTime() + (v.seconds ?? 75) * 1000),
      exam: { reason: n.reason, symptoms: n.symptoms, findings: n.findings, vitals: v.vitals },
      prescription: { …, advice: n.advice, followUpDays: n.followUpDays } })`.
      Bỏ bốn trường chữ khỏi 4 mục `visits` hiện có; thêm `hour`/`minute`/`seconds` cho chúng (gợi ý:
      giữ `seconds: 75` để không đổi số đo của 4 lượt đã ghi — mốc của chúng đã cố định trong CSDL,
      đổi cũng không có tác dụng).
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` (toàn monorepo) xanh.

- [ ] 5. **Chờ hạn mức: `withQuotaRetry` + `completeWithQuotaRetry` + hàm ghi một lượt dùng chung.**
      Theo đúng mẫu của `services/bff/scripts/backfill-search-keys.ts` (`OperationOutcomeError` với
      `outcome.id === 'too-many-requests'`, chờ `BACKOFF_MS = 15_000`, `MAX_ATTEMPTS = 8` — hai hằng
      này **đã có** trong `seed-demo.ts` dòng 25–26): `withQuotaRetry(what, fn)` bắt cả
      `too-many-requests` **và** `BusyError`; `completeWithQuotaRetry(store, cmd, what)` thêm vòng chờ
      cho `kind: 'incomplete'` (429 nằm **trong gói** không được `writeAll`/`retryOnConflict` thử lại
      vì chúng chỉ thử lại xung đột giao dịch 409 + `40001`).
      Gom đường ghi một lượt vào **một hàm** `runFullVisit(...)` dùng cho cả lượt lịch sử và lượt
      `done`: `checkIn` → `openVisit` → `switch (opened.kind)` với `'ok'` và **`'closed'` đều đi tiếp**
      (chú thích: `closed` là **đường chạy lại bình thường**, `wasCompletedBy` được kiểm **trước** kiểm
      trạng thái trong `completeVisit` nên trả `{ kind: 'ok', replayed: true }` mà không ghi gì),
      `'taken'`/`'not-found'` thì `throw` thông điệp tiếng Việt có `slug` + chỉ số lượt.
      Bọc `addAllergy`/`addHistory` trong `withQuotaRetry`.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" --filter @phongmach/bff typecheck` xanh.

- [ ] 6. **(FINDING 2, 8, 9) Union `TodayVisit`, `ClinicSpec.today` và giai đoạn "sân khấu hôm nay".**
      Thêm kiểu đúng như design mục 4.1, **với finding 2 phương án B**:

      ```ts
      interface TodayBase { patient: number; minutesAgo: number; priority: QueuePriority }
      type TodayExam = Pick<StoryVisit, 'dx' | 'lines' | 'vitals' | 'seconds'>;
      type TodayVisit =
        | (TodayBase & { state: 'waiting'; reason: string })
        | (TodayBase & { state: 'in-exam'; reason: string; doctor: string; openedMinutesAgo?: number })
        | (TodayBase & { state: 'done'; doctor: string; exam: TodayExam });   // KHÔNG có `reason`
      ```

      `ClinicSpec` thêm `today: TodayVisit[]`; khai `today: []` cho cả hai phòng ở bước này (dữ liệu
      vào ở bước 12) để build luôn xanh.
      Trong `seedClinical`, thêm giai đoạn `today` sau giai đoạn `visits`:
      - `floor` = `Date.parse` của chuỗi `vnDay(now) + "T00:05:00+07:00"`, rồi
        `const at = new Date(Math.min(Math.max(now.getTime() - t.minutesAgo * 60_000, floor), now.getTime()))`
        — **kẹp hai đầu** (finding 8);
      - khóa: `stableUuid` của chuỗi `<slug>:today:<vnDay(now)>:<i>:in` cho mọi nhánh, và
        `<slug>:today:<vnDay(now)>:<i>:done` **chỉ** nhánh `done`;
      - `waiting`: chỉ `checkIn({ …, priority: t.priority, reason: t.reason }, at)`, không gọi gì thêm;
      - `in-exam`: `checkIn(…)` rồi
        `openVisit(enc.id, doctor, new Date(Math.min(Math.max(now.getTime() - (t.openedMinutesAgo ?? Math.ceil(t.minutesAgo / 2)) * 60_000, at.getTime()), now.getTime())))`
        — kẹp hai đầu (finding 8), **không** `completeVisit`;
      - `done`: `const n = narrative(specialty, t.exam.dx, i)` rồi `runFullVisit` với
        `checkIn.reason = n.reason` **và** `exam.reason = n.reason`, `priority: t.priority`,
        `openVisit(..., at)`, `completeVisit.now = at + (t.exam.seconds ?? 75) * 1000`
        (finding 2 phương án B: nhánh `done` không có trường `reason` nên không có cách viết sai).
      Thêm khối chú thích **"Ba thứ tích tụ lại theo ngày"** (finding 9) ngay trên giai đoạn này:
      3 Encounter `arrived` + 1 `in-progress` (không bao giờ đóng) + **2 lượt `done`** mỗi phòng mỗi
      ngày; hai cái đầu vô hại (`listQueue` lọc theo ngày, `finishedVisits`/`patientVisits` chỉ lấy
      `finished`), cái thứ ba **đi vào** số đo Metrics và lịch sử khám — là nguồn của finding 4.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh.

- [ ] 7. **(FINDING 6, 12) `validateScenario()` + `SEED_DRY_RUN`.**
      Hàm **thuần, không gọi mạng**, trả `string[]`; gọi ở **dòng đầu** `main()` — **trước**
      `reuseExisting()` — có lỗi thì in từng dòng ra `stderr` rồi `process.exit(1)`.
      Hiện thực đủ các hàng của design mục 12.1, có phân nhánh theo cột "Áp dụng cho"
      (SV / T:done / T:in-exam / T:waiting), trong đó bắt buộc có:
      `getDrug` tồn tại cho mọi mã; `resolveLine` cho `instruction` khác rỗng và (nếu không
      `manualQuantity`) có `quantity`; `lines` 1…20 dòng; `days ≤ 30` (hoặc ≤ 90 khi một chẩn đoán có
      cờ `chronic`); `getIcd10` tồn tại cho mọi mã và `dx[0] !== 'Z76.0'`;
      `NARRATIVE[specialty][dx[0]]` có ≥ 1 biến thể; `advice` khác rỗng và **≤ 300 ký tự** (chú thích
      rõ: trần tự đặt của seed, **chặt hơn** trần 1000 của `completeBody.prescription.advice`);
      `reason ≤ 300`; `followUpDays` nguyên 1…365; `seconds` nguyên 1…3600; `cleanVitals` không ném
      `DomainError`; **quy tắc sinh hiệu**: trẻ < 12 tuổi phải có `weightKg`, trẻ **không** được có
      huyết áp, `respiratoryRate`/`spo2` có mặt **đúng và chỉ đúng** khi `dx[0]` bắt đầu `J` hoặc là
      `R50.9` (Nhi: cả hai; Nội: **chỉ** `spo2`, có `respiratoryRate` là lỗi); **khoảng** của mục 7.5;
      **(finding 12)** `weightKg` của cùng một bệnh nhân lệch ≤ 10 % giữa các lượt trong 30 ngày;
      `doctor` khớp `users[].id` của chính phòng khám **và** có `practitioner: true`;
      `openedMinutesAgo` trong 1…`minutesAgo`; `patient` trong `[0, story.length)`;
      `minutesAgo` 1…600 và với `done` thì `> seconds/60 + 1`; `priority ∈ PRIORITIES`;
      `reason` khai tay (hai nhánh `waiting`/`in-exam`) khác rỗng ≤ 200; `specialty` khớp `kind`;
      tuổi khớp `kind` (Nhi < 14, Nội ≥ 18); `phone` qua `normalizePhone` và không trùng trong phòng;
      `cccd` 12 chữ số tiền tố `000`, bắt buộc nếu ≥ 14 tuổi và **cấm** nếu < 14, không trùng;
      `fullName` qua `parseFullName`; `birthDate` `YYYY-MM-DD` không ở tương lai;
      `allergies[].value` thuộc `ALLERGY_CLASSES` (class) / `INGREDIENTS` (ingredient);
      **nhất quán dị ứng ↔ đơn** theo ngữ nghĩa `checkPrescription` (`class` → `drug.classes`,
      `ingredient` → `drug.ingredients`) với **thông điệp dựng từ biến** (finding 6, không hardcode ví
      dụ); `history[].text` khác rỗng ≤ 300; **tập khóa `stableUuid` không trùng nhau**.
      Một **cảnh báo** (không chặn) khi `PATIENTS_PER_CLINIC < story.length`.
      `SEED_DRY_RUN=1` ⇒ chỉ chạy `validateScenario()`, in một dòng thống kê mỗi phòng
      (`<slug>: N bệnh nhân kịch bản, N lượt khám cũ, N lượt hôm nay, N dị ứng, N tiền sử`) rồi
      `exit 0`, **không** kết nối Medplum, **không** đọc/ghi `TENANTS_FILE`.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; `$env:SEED_DRY_RUN="1"; pnpm -C "$W" --filter @phongmach/bff exec tsx scripts/seed-demo.ts; Remove-Item Env:SEED_DRY_RUN`
      → thoát 0, in `noi-tong-quat: 3 bệnh nhân kịch bản, 3 lượt khám cũ, 0 lượt hôm nay, 2 dị ứng, 2 tiền sử`
      và dòng tương ứng của `nhi` (dữ liệu dày vào ở bước 9–12).

- [ ] 8. **(FINDING 3, 11) Mốc thời gian từng giai đoạn + chạy hai phòng khám song song (bậc 1).**
      In mỗi giai đoạn kèm số giây một chữ số thập phân (bệnh nhân / dị ứng + tiền sử / lượt khám cũ /
      sân khấu hôm nay) và một dòng `Tổng thời gian seed: X phút Y giây`.
      `main()` chạy **hai phòng song song** bằng `Promise.all` trên `CLINICS` (hai tenant = hai
      `ClientApplication` thuộc hai `Project` ⇒ **hai hạn mức tách biệt**), **gom log theo phòng** rồi
      in một lần khi phòng đó xong để log không xen nhau. Giữ nguyên: `reuseExisting()` /
      `createTenants()` / ghi `.demo-tenants.json` chạy **tuần tự trước**; `process.exit(1)` khi lỗi.
      Chú thích ghi cách đếm duy nhất (finding 11): *58 lượt đi hết đường (54 lịch sử mới + 4 `done`
      hôm nay) + 8 lượt chỉ cấp số/chỉ mở hồ sơ + 4 lượt lịch sử cũ chạy lại không ghi*.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; dry-run (bước 7) vẫn thoát 0 và in đủ hai dòng thống kê.

- [ ] 9. **(FINDING 12) Dữ liệu: bệnh nhân `story`, dị ứng, tiền sử — chỉ THÊM VÀO CUỐI.**
      Chép đúng bảng 5.1 (Nội: thêm idx 3–14, tổng 15), 5.2 (Nhi: thêm idx 2–10, tổng 11), 6.1 (Nội:
      thêm mục dị ứng 2–10, tổng 11), 6.2 (Nhi: thêm 1–6, tổng 7), 6.3 (Nội tiền sử: thêm 2–11, tổng
      12), 6.4 (Nhi: thêm 1–7, tổng 8) của design. Giữ y nguyên tên có dấu / không dấu
      (idx 3 Nội là **"Nguyen Van An"** không dấu — chủ ý), số điện thoại, CCCD, ngày sinh.
      Thêm hai bảng hằng `WEIGHT_NOI` / `WEIGHT_NHI` (khóa = chỉ số `story`, giá trị `weightKg`) theo
      finding 12; Nhi lấy theo tuổi: 3 t → 14; 4 t → 16; 5 t → 17,5; 6 t → 20; 7 t → 22; 8 t → 25;
      10 t → 32 kg (khớp `weightKg: 17.5` của lượt nhi đã có). Chú thích in đậm **"CHỈ THÊM VÀO CUỐI"**
      trên từng mảng.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; dry-run in `noi-tong-quat: 15 bệnh nhân kịch bản, …, 11 dị
      ứng, 12 tiền sử` và `nhi: 11 bệnh nhân kịch bản, …, 7 dị ứng, 8 tiền sử`, thoát 0 (không lỗi
      trùng số điện thoại / CCCD / tuổi).

- [ ] 10. **Dữ liệu: 32 lượt khám cũ phòng Nội (idx 3–34).**
      Chép bảng 7.1: `patient`, `daysAgo`, `hour`/`minute` (từ cột "giờ"), `doctor`, `dx`, `lines`
      (đọc nguyên văn ô "Đơn thuốc" thành `line('MÃ')` / `line('MÃ', { days: N })`; các thuốc
      `asNeeded` và `manualQuantity` theo đúng 4 nhóm mẫu của mục 7.3), `seconds` (cột "giây", idx 21
      là **1920** — phiên bỏ dở có chủ ý), `vitals` hằng thẳng với `weightKg` lấy từ `WEIGHT_NOI`.
      Giữ **thứ tự `daysAgo` tăng dần** và chỉ thêm vào cuối. Lượt có `I10` hoặc `E11.9` ở **bất kỳ**
      vị trí trong `dx`: huyết áp 135–158 / 85–96. `spo2` **chỉ** ở idx 3, 6, 7, 14, 17, 20, 28.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; dry-run thoát 0 và in `noi-tong-quat: …, 35 lượt khám cũ, …`.

- [ ] 11. **Dữ liệu: 22 lượt khám cũ phòng Nhi (idx 1–22).**
      Chép bảng 7.2 (bác sĩ luôn `nhi-owner`, `specialty: 'nhi'`), idx 11 `seconds: 1920`.
      `respiratoryRate` **và** `spo2` **chỉ** ở idx 2, 5, 6, 7, 8, 11, 12, 13, 15, 18 (nhịp thở 3–5 t:
      24–30; 6–10 t: 18–24; `spo2` 95–99). **Không** ghi huyết áp cho trẻ. `weightKg` từ `WEIGHT_NHI`.
      Trẻ < 6 tuổi (BN idx 0, 7, 9) chỉ dùng dạng gói/siro/giọt hoặc thuốc có cờ `paediatric`.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; dry-run thoát 0 và in `nhi: …, 23 lượt khám cũ, …`.

- [ ] 12. **(FINDING 2, 4) Dữ liệu: sân khấu hôm nay — 6 lượt mỗi phòng.**
      Chép bảng 8.1 và 8.2 vào `today`, **với finding 4**: `exam.seconds` của Nhi idx 0 = **52**
      (không phải 78) và idx 1 = **88** (không phải 120). Bốn dòng `done` **không** khai `reason`
      (finding 2 phương án B — cột "Lý do đến" của 4 dòng đó trong design chỉ là chú giải); hai dòng
      `in-exam` có `openedMinutesAgo: 3`; mỗi phòng 3 dòng `waiting` với `priority` lần lượt
      `appointment` / `normal` / `urgent`. `doctor` của Nhi là `nhi-owner`.
      Số đo mong đợi sau bước này (đã tính lại tay bằng `percentile` hạng gần nhất
      `rank = ceil(p/100 × n)` của `packages/clinical/src/time.ts`):

      | Khung | Phòng | n | p50 | p90 |
      |---|---|---|---|---|
      | 14 ngày | Nội (idx 3–21, bỏ idx 21 khỏi phân vị, + 2 `done`) | 20 | **58** | **110** |
      | 14 ngày | `noi-doctor` / `noi-owner` | 12 / 8 | 57 / 58 | 116 / 110 |
      | 14 ngày | Nhi (idx 1–12, bỏ idx 11, + 2 `done`) | 13 | **56** | **90** |
      | Hôm nay | Nội / Nhi | 2 / 2 | 57 / **52** | 110 / **88** |

      Kiểm chéo ngày thứ 2 và thứ 3 (mỗi ngày seed thêm 2 lượt `done` mỗi phòng): p50 Nhi vẫn **56**,
      p50 Nội vẫn **58** ⇒ cả hai dưới `TARGET_P50_SECONDS = 60`.
      Files: `services/bff/scripts/seed-demo.ts`
      Verify: `pnpm -C "$W" typecheck` xanh; dry-run in **đúng**
      `noi-tong-quat: 15 bệnh nhân kịch bản, 35 lượt khám cũ, 6 lượt hôm nay, 11 dị ứng, 12 tiền sử`
      và `nhi: 11 bệnh nhân kịch bản, 23 lượt khám cũ, 6 lượt hôm nay, 7 dị ứng, 8 tiền sử`, thoát 0.

- [ ] 13. **Compose: `SEED_PATIENTS` 300 cấu hình được + `AUDIT_FILE` ra volume.**
      `infra/demo/docker-compose.yml`: dòng **23** `SEED_PATIENTS: "20"` → `SEED_PATIENTS: "${SEED_PATIENTS:-300}"`;
      thêm **một** dòng vào `environment` của service `web`: `AUDIT_FILE: /demo/audit.ndjson`
      (`/demo` là volume `demo-tenants` đã mount ở cả hai service; nhật ký không chứa dữ liệu bệnh
      nhân nên đưa ra volume không lộ thêm gì, và nó sống qua các lần `up --build`).
      **Không** đổi: `MEDPLUM_URL: http://host.docker.internal:8103`, `restart: "no"` của `seed`,
      `depends_on … service_completed_successfully`, cổng `8081:80`, `SESSION_SECRET`, healthcheck,
      không thêm/bớt service.
      Files: `infra/demo/docker-compose.yml`
      Verify: `docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" config` thoát 0 và
      in `SEED_PATIENTS: "300"` + `AUDIT_FILE: /demo/audit.ndjson`; `git -C "$W" diff --stat` chỉ hiện
      2 tệp mã.

- [ ] 14. **Soát `.gitignore` (ngoại lệ duy nhất được tự sửa).**
      Chạy `git -C "$W" check-ignore -v services/bff/.demo-tenants.json services/bff/.data/x infra/medplum/.env`
      — kỳ vọng: hai cái đầu khớp `.gitignore` dòng 8–9, cái thứ ba khớp `infra/medplum/.gitignore`.
      **Chỉ khi** một đường dẫn bí mật không bị loại thì thêm entry tương ứng; nếu đủ cả thì **không
      sửa gì** và ghi kết quả vào tài liệu kiểm chứng. Không thêm `.agents/` vào `.gitignore` (design
      mục 13 đã chốt commit `.agents/tasks/*.md`).
      Files: `.gitignore` (chỉ nếu thiếu entry)
      Verify: lệnh `check-ignore` trên thoát 0 cho cả ba đường dẫn; `git -C "$W" status --short` không
      hiện tệp bí mật nào.

- [ ] 15. **Cổng chất lượng trước khi chạy Docker.**
      Files: — (không sửa tệp)
      Verify: `pnpm -C "$W" typecheck` **xanh toàn monorepo**;
      `pnpm -C "$W" --filter @phongmach/bff test` (vitest `test/unit`) xanh — không có test cho seed
      nhưng xác nhận không có hồi quy ở gói đã đụng kiểu;
      dry-run in đúng hai dòng thống kê của bước 12 và thoát 0.

- [ ] 16. **Kiểm chứng tích hợp thật bằng Docker + viết `trial1-verification.md`.**
      Thứ tự lệnh (PowerShell, **luôn đủ `-p phongmach-demo -f "$W\infra\demo\docker-compose.yml"`**):

      ```powershell
      # 0. BẤT BIẾN: chụp container id Medplum TRƯỚC (chỉ đọc)
      docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
      # 1. Chạy khô trong image mới — PHẢI có --build, không thì đang kiểm mã CŨ
      docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm --build -e SEED_DRY_RUN=1 seed
      # 2. LẦN CHẠY NGUỘI: dựng demo và ĐO
      Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d --build }
      docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs seed
      docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" ps
      # 3. Kiểm qua cổng 8081 (xem bảng ngưỡng dưới)
      # 4. (FINDING 10) chạy lại seed bằng ĐƯỜNG CHẮC CHẮN + mốc thời gian log
      Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm seed }
      docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs --timestamps seed | Select-Object -Last 20
      # 5. BẤT BIẾN: chụp lại container id Medplum SAU — phải GIỐNG HỆT bước 0
      docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
      ```

      Ngưỡng đạt — **dùng "≥ kèm danh sách phải có mặt", không dùng đẳng thức** (tenant demo là tenant
      dùng lại, có bệnh nhân sinh ngẫu nhiên):

      | Kiểm | Đạt khi |
      |---|---|
      | Chạy khô (bước 1) | in `15 / 35 / 6 / 11 / 12` (Nội) và `11 / 23 / 6 / 7 / 8` (Nhi). Nếu ra `3 / 3 / 0 / 2 / 2` thì image **chưa** build lại |
      | `seed` | container thoát **0**; `web` **healthy** |
      | `/api/session/demo-users` | 2 tenant, 5 người dùng |
      | `search?q=nguyen van` | ≥ 6 ca phòng Nội, có cả bản có dấu và **"Nguyen Van An"** không dấu, phân biệt được bằng ngày sinh / điện thoại / CCCD |
      | `search?q=van an` | ≥ 5 ca, có đủ Nguyễn Văn An, Nguyễn Văn Ân, Nguyen Van An, Trần Văn An, Phạm Văn An |
      | `search?q=1234` | ≥ 6 ca; 6 số kịch bản (0913451234, 0918881234, 0938881234, 0909991234, 0977771234, 0966661234) ở **nhóm đầu** |
      | `/api/queue` | ≥ 6 lượt mỗi phòng; ≥ 1 `in-exam`, ≥ 3 `waiting` xếp urgent → appointment → normal, ≥ 2 `done` |
      | `/api/display` | `inExam` ≥ 1, `waiting` ≥ 3 (màn hình chờ **không trống**) |
      | `/api/metrics/visits?days=14` (đăng nhập `noi-owner` / `nhi-owner`) | Nội `all.visits` ≥ 20, p50 ≈ **58** ≤ 60, p90 ≈ **110** ≤ 120, `excluded` ≥ 1, có 2 dòng bác sĩ; Nhi ≥ 13, p50 ≈ **56**, p90 ≈ **90** |
      | `/api/metrics/visits?days=1` | Nội ≈ 57 / 110; Nhi ≈ **52 / 88** (finding 4) |
      | `/api/audit?limit=50` | ≥ 20 dòng, có `gateway-send` của "Hộp thư đi" |
      | `patients/<id>/visits` (BN idx 10 Nội) | ≥ 8 lượt, mỗi lượt có chẩn đoán + đơn nhiều dòng; **mọi** lượt có `prescription.advice` khác rỗng; ≥ 1 lượt có `followUpDays`; trong 8 lượt có **≥ 2** giá trị `reason` khác nhau (biến thể I10) |
      | `patients/<id>/allergies` + `/medical-history` | ≥ 1 mục mỗi loại ở các BN đã khai |
      | Chạy lại (bước 4) | seed thoát 0, `Patient._total` **không tăng**, thời gian lần hai ghi **riêng** |
      | **Medplum** | 3 container **cùng container id**, vẫn `Up`, không `Restarting` |
      | Dọn dẹp | **KHÔNG** `down`, **KHÔNG** `down -v`; để demo chạy |

      Ghi vào `.agents/tasks/trial1-verification.md`: lệnh đã chạy + output then chốt; **thời gian seed
      lần chạy nguội + mốc từng giai đoạn + thời gian lần chạy lại (ghi riêng)**; số lần 429 và tổng
      thời gian chờ hạn mức; **(finding 3)** kết luận về thang lùi — đã áp **bậc 1** ngay từ đầu, và câu
      "bậc 2/3 **chỉ có tác dụng trên tenant trắng**; trên tenant demo hiện tại dữ liệu đã ghi và không
      bị bớt đi", kèm khuyến nghị nếu giai đoạn lượt khám > 4 phút hoặc tổng > 8 phút;
      **(finding 11)** cách đếm duy nhất (58 + 8 + 4); **(finding 9)** ba thứ tích tụ theo ngày;
      **(finding 10)** đã dùng đường `run --rm seed` và mốc thời gian dòng log; xác nhận
      **Medplum không recreate** (dán hai lần `docker ps`); ghi chú đơn thuốc cũ được cổng mô phỏng gửi
      "hôm nay"; màn "Liên thông" trống sau khi hộp thư đi gửi xong là **đúng hành vi**; và nếu có lỗi
      mạng/hạn chế nào thì ghi **nguyên văn** + kết luận "chưa kiểm chứng được" — **không tuyên bố
      thành công giả**.
      Files: `.agents/tasks/trial1-verification.md`
      Verify: mọi hàng của bảng trên đạt, hoặc được ghi lại kèm số thật và lý do không đạt.

- [ ] 17. **Commit trên nhánh `feat/demo-rich-seed` — không merge, không push.**
      ```powershell
      git -C "$W" add services/bff/scripts/seed-demo.ts infra/demo/docker-compose.yml .agents/tasks
      git -C "$W" status --short      # PHẢI chỉ có các đường dẫn trên
      ```
      Không `git add -A`. Không commit `node_modules`, `.demo-tenants.json`, `services/bff/.data/`,
      `infra/medplum/.env`. Thông điệp commit nêu: SEED_PATIENTS 300, 15 + 11 bệnh nhân kịch bản,
      35 + 23 lượt khám cũ, sân khấu hôm nay 6 + 6 lượt, pre-flight `validateScenario` +
      `SEED_DRY_RUN`, và lý do kèm `.agents/tasks/*.md` (bằng chứng kiểm chứng).
      Files: — (chỉ git)
      Verify: `git -C "$W" show --stat HEAD` chỉ liệt kê `services/bff/scripts/seed-demo.ts`,
      `infra/demo/docker-compose.yml`, các tệp `.agents/tasks/*.md` (và `.gitignore` nếu bước 14 phải
      sửa); `git -C "$W" log --oneline -1` trên nhánh `feat/demo-rich-seed`; `git -C "$W" status` sạch;
      **không** có `git push`, **không** có merge vào `main`.

---

# Danh sách tự xác minh (chạy trước khi báo xong)

**Phạm vi và bất biến**

- [ ] `git -C "$W" diff --name-only` **chỉ** có `services/bff/scripts/seed-demo.ts`,
      `infra/demo/docker-compose.yml` (+ `.gitignore` nếu bước 14 thực sự thiếu entry).
- [ ] Không có tệp nào trong `apps/`, `packages/`, `services/bff/src/`, `infra/medplum/` bị sửa.
- [ ] `docker ps` trước/sau cho **cùng 3 container id** của `phongmach-medplum`, vẫn `Up`.
- [ ] Không chạy `down`, `down -v`, `--force-recreate`, `volume rm` với bất kỳ project nào.
- [ ] Mọi mã thuốc / ICD-10 mới đều qua `getDrug`/`getIcd10` trong pre-flight ⇒ không có mã bịa.
- [ ] Mọi mục mới của `story`/`allergies`/`history`/`visits` nằm **ở cuối** mảng; không chèn/xóa/đảo.
- [ ] Mọi tài nguyên mới có khóa `stableUuid`; khóa của `today` có `vnDay(now)`; pre-flight soát trùng khóa.
- [ ] Không ghi FHIR tay: chỉ `store.*` (và `executeBatch` cho `Patient` như mã cũ).
- [ ] CCCD mọi ca kịch bản: 12 chữ số, tiền tố `000`, chỉ người ≥ 14 tuổi.

**12 finding**

- [ ] 1: `spo2` có ở `noi` visits 0 và 2; `respiratoryRate` có ở `nhi` visits 0; dry-run **không** báo lỗi sinh hiệu.
- [ ] 2: nhánh `done` của `TodayVisit` **không có** trường `reason`; `checkIn.reason` của lượt `done` = `narrative(...).reason`.
- [ ] 3: seed in mốc từng giai đoạn; hai phòng chạy song song; kết luận thang lùi đã ghi vào tài liệu kiểm chứng.
- [ ] 4: `nhi` today `seconds` = 52 và 88; `/api/metrics/visits?days=1` của Nhi ra ≈ 52 / 88; `days=14` ra ≈ 56 / 90.
- [ ] 5: chú thích đếm **bảy** lượt lịch sử I10 của BN idx 10 (16, 24, 25, 26, 29, 30, 32).
- [ ] 6: thông điệp xung đột dị ứng dựng từ biến, không hardcode ví dụ.
- [ ] 7: biến thể I10 #2 có `reason` = "Hết thuốc huyết áp"; idx 29 ra "Hết thuốc huyết áp, xin cấp lại đơn".
- [ ] 8: cả `at` và `openedAt` đều kẹp **hai đầu** (`floor` ≤ … ≤ `now`, và `openedAt ≥ at`).
- [ ] 9: chú thích "Ba thứ tích tụ lại theo ngày" có trong mã **và** trong tài liệu kiểm chứng.
- [ ] 10: đã dùng `run --rm seed` + `logs --timestamps` làm bằng chứng chạy lại, có dán mốc thời gian.
- [ ] 11: tài liệu dùng **một** cách đếm: 58 lượt đi hết đường + 8 lượt cấp số/mở hồ sơ + 4 lượt cũ chạy lại.
- [ ] 12: `weightKg` lấy từ `WEIGHT_NOI`/`WEIGHT_NHI`; các trường sinh hiệu khác là hằng thẳng; pre-flight soát khoảng + hai chiều `rr`/`spo2` + lệch cân ≤ 10 %.

**Chất lượng và dữ liệu demo**

- [ ] `pnpm -C "$W" typecheck` xanh; `pnpm -C "$W" --filter @phongmach/bff test` xanh.
- [ ] `SEED_DRY_RUN=1` in `15 / 35 / 6 / 11 / 12` và `11 / 23 / 6 / 7 / 8`, thoát 0, **không** nối Medplum.
- [ ] Container `seed` thoát 0; `web` healthy; `http://localhost:8081` mở được.
- [ ] Hàng chờ hôm nay **không trống** ở cả hai phòng, có đủ `waiting` / `appointment` / `urgent` / `in-exam` / `done`.
- [ ] Trang "Thời gian khám" có p50/p90 ra số và nhãn p50 ≤ 60 giây; cột "Phiên bị loại" ≥ 1.
- [ ] "Nhật ký truy cập" ≥ 20 dòng, có `gateway-send`.
- [ ] Tìm "nguyen van" ra nhiều kết quả và phân biệt được ca trùng tên; tìm theo 4 số cuối hoạt động.
- [ ] Một BN story có **lịch sử khám + đơn nhiều dòng + lời dặn + dị ứng + tiền sử**.
- [ ] Thời gian seed lần nguội đã đo và ghi; nếu > 8 phút thì đã ghi số thật + khuyến nghị (không áp bậc 2/3 lên tenant demo).
- [ ] `git status --short` không hiện `.demo-tenants.json`, `services/bff/.data/`, `infra/medplum/.env`, `node_modules`.

# Khoảng trống đã biết (giả định, không chặn)

- **Không thêm bác sĩ mới cho phòng Nhi.** `reuseExisting()` dùng lại `.demo-tenants.json` và không bổ
  sung người dùng; thêm vào `CLINICS.users` sẽ làm `file.users.find(...)!` trả `undefined` và seed chết
  trên tenant đã tạo. ⇒ bảng "Thời gian khám" phòng Nhi có 1 dòng bác sĩ + dòng tổng. Giả định: chấp
  nhận cho demo. (Có thể thêm **một phép kiểm rõ lỗi** tiếng Việt trong `validateScenario` để lần sau
  ai thêm `users` thấy thông báo thay vì `TypeError` — nên làm, rẻ.)
- **Không có địa chỉ bệnh nhân** (`NewPatientInput` không có trường đó; thêm phải sửa
  `packages/fhir-vn-model` + UI ⇒ ngoài phạm vi). Ca trùng tên phân biệt bằng **ngày sinh + điện thoại
  + CCCD**.
- **Không có kiểm thử đơn vị cho `validateScenario`** (phải thêm tệp trong `services/bff/test/unit`,
  ngoài phạm vi hai tệp). Bù bằng `SEED_DRY_RUN`. Backlog: tách `validateScenario` ra tệp riêng.
- Nhóm BN nhi sinh 2015–2016 vượt 14 tuổi vào 2029–2030 ⇒ quy tắc CCCD sẽ chặn kê đơn; ghi nhận, làm
  mới dữ liệu demo trước mốc đó.
- Rủi ro rất nhỏ: một trong 17 hồ sơ sinh ngẫu nhiên của lần seed trước trùng số điện thoại với một ca
  kịch bản mới (`validateScenario` chỉ soát trùng trong phạm vi `story`). Ghi nhận, không xử.
