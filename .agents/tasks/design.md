# Thiết kế: làm dày dữ liệu demo PHONGMACH (Trục 1)

Nhánh `feat/demo-rich-seed`, worktree `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data`.

## 1. Tổng quan

Bản demo Docker đã chạy đúng nhưng mỏng: mỗi phòng khám chỉ có 20 bệnh nhân, 3 (nội) và 1 (nhi) lượt
khám cũ, hàng chờ hôm nay TRỐNG, trang "Thời gian khám" không có số, "Nhật ký truy cập" gần như trắng.
Thiết kế này làm dày dữ liệu bằng cách **chỉ** sửa hai tệp: `services/bff/scripts/seed-demo.ts` và
`infra/demo/docker-compose.yml`. Không đụng UI, không đụng BFF, không đụng danh mục, không đụng stack
Medplum đang chạy.

Cách làm: giữ nguyên kiến trúc hiện có của seed (mảng `CLINICS` khai báo dữ liệu, mọi lời ghi đi qua
`MedplumClinicStore` — cùng đường ghi với ứng dụng thật, mọi khóa sinh từ `stableUuid` nên chạy lại
không trùng) và **mở rộng dữ liệu khai báo** cùng hai bổ sung nhỏ về cơ chế:

1. thêm một mảng mới `today` cho mỗi phòng khám: "sân khấu sống" của NGÀY SEED CHẠY (hàng chờ đang
   chờ / đã hẹn / cấp cứu / đang khám / đã xong), khóa xác định có kèm `vnDay(now)` nên mỗi ngày dựng
   lại một hàng chờ mới và chạy lại trong cùng ngày thì không tạo thêm;
2. kiểm tra trước khi ghi (pre-flight) toàn bộ kịch bản: mã thuốc, mã ICD-10, chỉ số bệnh nhân, trùng
   khóa, liều/số lượng giải được — sai thì dừng trong 50 ms thay vì chết giữa buổi seed 5 phút.

Ngăn xếp công nghệ **chốt** (không có lựa chọn nào khác sau khi thiết kế được duyệt): TypeScript chạy
bằng `tsx` trong container `node:22-bookworm-slim`, `@medplum/core` 5.2.0, dữ liệu lâm sàng dựng qua
`@phongmach/clinical` + `@phongmach/catalogs` + `@phongmach/fhir-vn-model` (đã có trong monorepo),
Docker Compose project `phongmach-demo`. Không thêm thư viện mới, không thêm service mới.

## 2. Phạm vi và các bất biến phải giữ

| Hạng mục | Quyết định |
|---|---|
| Tệp được sửa | `services/bff/scripts/seed-demo.ts`, `infra/demo/docker-compose.yml`, tài liệu trong `.agents/tasks/` |
| Tệp KHÔNG được sửa | mọi thứ trong `apps/`, `packages/`, `services/bff/src/`, `infra/medplum/` |
| Stack Medplum | chỉ đọc trạng thái (`docker ps`). KHÔNG `down`, `down -v`, `up --force-recreate`, không xóa volume. Ba container `phongmach-medplum-*` phải giữ nguyên container id trước/sau |
| Nhãn mô phỏng | giữ nguyên: dữ liệu giả, chữ ký mô phỏng (`EXTENSIONS.simulated`), cổng liên thông mô phỏng, danh mục minh họa chưa duyệt y khoa (`CATALOG_NOTICE`) |
| CCCD giả | 12 chữ số, luôn bắt đầu `000` (mã tỉnh không tồn tại). Chỉ người từ 14 tuổi mới có CCCD |
| Chạy lại | mọi tài nguyên tạo có điều kiện theo `stableUuid`; chạy `up -d` nhiều lần không sinh bản trùng |
| Web không gọi thẳng Medplum | không đổi: `web` chỉ biết `/api`, BFF nghe `127.0.0.1:8110` trong cùng container |
| Bí mật không vào git | `.demo-tenants.json` nằm trong volume `demo-tenants`, không trong repo; `.gitignore` đã loại `services/bff/.demo-tenants.json` và `services/bff/.data/`; `infra/medplum/.env` do `infra/medplum/.gitignore` loại (đã kiểm: `git check-ignore` xác nhận, tệp hiện không tồn tại) |

**Không nằm trong phạm vi (và lý do):**

- **Địa chỉ bệnh nhân.** Yêu cầu ban đầu có nói "mỗi ca khác ngày sinh / điện thoại / địa chỉ".
  `NewPatientInput` (`packages/fhir-vn-model/src/patient.ts`) chỉ có `fullName, phone, cccd, birthDate,
  gender`; thêm địa chỉ phải sửa `packages/fhir-vn-model` + UI, tức ra ngoài phạm vi. Vì vậy các ca
  trùng tên được phân biệt bằng **ngày sinh + số điện thoại + CCCD** (ba trường UI đang hiện ở kết quả
  tìm). Ghi nhận để backlog.
- **Thêm bác sĩ mới cho phòng Nhi.** `reuseExisting()` dùng lại `.demo-tenants.json` đã có trong volume
  và KHÔNG bổ sung người dùng mới; thêm `users` vào `CLINICS` sẽ làm `file.users.find(...)!` trả
  `undefined` và seed chết trên tenant đã tạo. Giữ nguyên 5 người dùng demo hiện có; bảng "Thời gian
  khám" của phòng Nhi vì vậy có 1 dòng bác sĩ + dòng tổng. Thay vào đó thiết kế **thêm một bộ kiểm tra
  rõ lỗi** (mục 12) để lần sau ai thêm người dùng sẽ thấy thông báo tiếng Việt thay vì `TypeError`.
- **Kiểm thử đơn vị cho bộ kiểm tra kịch bản.** Thêm tệp test nằm ngoài phạm vi hai tệp được phép sửa;
  bù lại pre-flight chạy ở mỗi lần seed và có thể chạy riêng bằng `SEED_DRY_RUN=1` (mục 12).

## 3. Quyết định 1 — SEED_PATIENTS và cách đo thời gian

`infra/demo/docker-compose.yml` đổi `SEED_PATIENTS: "20"` thành:

```yaml
SEED_PATIENTS: "${SEED_PATIENTS:-300}"
```

Giữ cấu hình qua env: `$env:SEED_PATIENTS="150"; docker compose -p phongmach-demo -f infra/demo/docker-compose.yml up -d`
vẫn đổi được mà không sửa tệp. Mặc định **300 bệnh nhân mỗi phòng khám** (600 tổng).

**Ước lượng thời gian.** Căn cứ, kèm **đúng nhãn độ tin** của `docs/ke-hoach-trien-khai.md` (không nâng
cấp độ tin của con số suy ra):

- hạn mức FHIR mặc định 50.000 điểm/phút/người dùng ≈ 500 lần ghi/phút — mục 2, F5: `[Đã đọc mã]` cấu
  hình, `[Đã đo]` lần 429;
- "1.000 lần ghi mất 2 phút 14 giây" ≈ 7,5 lần ghi/giây — mục 5.5 **[Đã đo]**;
- **một lượt khám đi hết đường tốn ≈ 2.500 điểm** (≈ 17 lần ghi + 8 lần tìm) ⇒ ≈ 20 lượt khám mỗi phút
  qua một tài khoản máy — phát hiện 1 của phiên thử M0-1, **[Phân tích, từ mã]**; phần **[Đã đo]** của
  cùng phát hiện là lần 429 ở chu kỳ 17–18 với log `_consumedPoints 50011, limit 50000`;
- ⇒ **≈ 5–6 giây mỗi lượt khám** là con số **suy ra** từ hai dòng trên, không phải số đo.

| Giai đoạn | Chi phí | Ước lượng |
|---|---|---|
| Bệnh nhân (2 phòng × 300, gửi theo `batch` 100) + ghi bổ sung khóa tìm | ~600 ghi | 80–120 giây |
| Dị ứng + tiền sử (15 dị ứng + 17 tiền sử mới) | ~32 ghi | 15–25 giây |
| Lượt khám lịch sử (32 nội + 22 nhi) | 54 × ≈ 2.500 điểm | 4,5–5,5 phút |
| **Chờ hạn mức bắt buộc** của giai đoạn lượt khám (34 lượt phòng Nội, 24 phòng Nhi, mỗi phòng một tài khoản máy riêng nên hai hạn mức FHIR tách biệt — nhưng **chung một PostgreSQL**, xem thang lùi bậc 1) | 1–2 lần chờ 15 giây mỗi phòng | 30–90 giây |
| Sân khấu hôm nay (12 lượt: 4 hoàn tất, 2 đang khám, 6 chỉ cấp số) | ~110 ghi | 30–40 giây |
| **Tổng (lần chạy nguội)** | — | **≈ 6,5 – 9 phút** |

Hai lưu ý cho người triển khai:

1. **Bệnh nhân không phải phần tốn thời gian nhất.** Lượt khám chiếm ~70 % thời gian, và hạ
   `SEED_PATIENTS` **không xóa** bệnh nhân đã tạo ở lần seed trước (tạo có điều kiện không bao giờ
   xóa) nên `Patient._total` sẽ không giảm — chỉ số lượng tạo **mới** giảm.
2. Tổng ước lượng nằm sát ngưỡng 8 phút của yêu cầu, nên **phải đo thật** rồi quyết định, không phỏng
   đoán. Seed in mốc thời gian từng giai đoạn (mục 4.5).

**Thang lùi về, xếp theo đúng thứ tự áp dụng** (nếu lần chạy nguội đo được > 8 phút):

| Bậc | Việc làm | Tiết kiệm | Giá phải trả |
|---|---|---|---|
| **0** | **Đã cân nhắc và BỎ:** nâng hạn mức FHIR của tenant demo — `Project.systemSetting` tên `userFhirQuota` lên 500.000 điểm/phút, đúng cách đã dùng thật ở phiên thử M0-1 (`docs/ke-hoach-trien-khai.md`, mục chuẩn bị M0-1, điểm 3) | gần như xóa sạch thời gian chờ hạn mức (30–90 giây) và mọi lần 429 | **hai lý do bỏ:** (a) phải `PUT` vào `Project` của tenant demo qua API quản trị ⇒ thêm mã ngoài hai tệp được phép sửa, hoặc một lệnh tay không nằm trong compose ⇒ vỡ bất biến phạm vi; (b) số đo thời gian seed khi đó **không còn phản ánh môi trường mặc định**, mà đó mới là con số chủ dự án cần để biết demo dựng lại mất bao lâu trên máy khác. Nếu chủ dự án muốn, đây là việc của T-QUOTA, không phải của trục này |
| 1 | ~~Chạy **hai phòng khám song song** ở giai đoạn lâm sàng (`Promise.all` trên hai `ClinicSpec`)~~ — **ĐÃ THỬ VÀ ĐÃ BỎ, xem ô bên phải** | — | **Lý lẽ "hai `ClientApplication` ⇒ hai hạn mức tách biệt" đúng về HẠN MỨC nhưng sai về TRANH CHẤP CƠ SỞ DỮ LIỆU:** hai tenant dùng **chung một PostgreSQL**, nên hai luồng tạo-có-điều-kiện song song đụng cùng bảng ở mức `serializable` và sinh xung đột 40001 thường trực (F13). Bản `Promise.all` làm seed **chết ở giây thứ 7,66** (`trial1-verification.md` mục 10.4) ⇒ chưa từng có con số thời gian nào để biện minh cho nó. Đã đổi về **tuần tự** và đo thật: **2 phút 38 giây** lần chạy nguội — dư xa ngưỡng 8 phút, nên bậc 1 **không cần thiết** |
| 2 | Cắt lượt khám **từ CUỐI** mảng `visits` của mỗi phòng — tuyệt đối không xóa/chèn giữa mảng vì khóa tính theo chỉ số (mục 4.3) | ~5–6 giây mỗi lượt bỏ đi | xem đoạn "giá thật của bậc 2" ngay dưới bảng |
| 3 | `SEED_PATIENTS=200`, vẫn > 8 phút thì `SEED_PATIENTS=150` | ~27–55 giây | dân số mỏng hơn; trên tenant đã seed thì `_total` **không** giảm |

**Giá thật của bậc 2 (đã sửa theo review).** Các mục mới của mảng `visits` được **xếp theo `daysAgo`
tăng dần** (bảng 7.1 và 7.2), nên mục cuối mảng *thật sự* là lượt cũ nhất và cắt từ cuối bỏ đúng chiều
sâu lịch sử, **không** bỏ dữ liệu của khoảng kiểm chứng:

- Phòng Nội: cắt từ cuối bỏ lần lượt idx 34 (`daysAgo` 240), 33 (200), 32 (180)… Khoảng **14 ngày** dùng
  để kiểm chứng (mục 9) là idx 3–21, nên **cắt tối đa 13 mục** vẫn giữ nguyên bảng p50/p90.
- Phòng Nhi: idx 1–12 nằm trong 14 ngày ⇒ **cắt tối đa 10 mục**.
- Cần cắt sâu hơn hai mức đó thì **chuyển sang bậc 3** chứ không cắt tiếp, vì cắt vào idx 3–21 (Nội) /
  1–12 (Nhi) sẽ làm mọi con số ở mục 9 và mọi ngưỡng Metrics ở mục 15 sai.
- Ràng buộc kèm theo: **ai thêm mục mới sau này phải thêm vào cuối** (bất biến khóa theo chỉ số, mục
  4.3) nên thứ tự "tăng dần theo `daysAgo`" sẽ bị phá ngay lần thêm sau. Vì vậy trước khi áp bậc 2,
  **đọc `daysAgo` của các mục cuối** để biết mình đang bỏ cái gì, đừng tin vào thứ tự.

**KẾT QUẢ THỰC TẾ — không dùng bậc nào.** Seed chạy **tuần tự** (`for (const spec of CLINICS) await …`)
đo được **2 phút 38 giây** lần nguội và **39 giây** lần chạy lại, với `SEED_PATIENTS=300` nguyên vẹn
(`trial1-verification.md` mục 11). Thang lùi 1/2/3 ở trên **chỉ là phương án dự phòng chưa dùng**; bậc 1
còn bị gạch vì chính nó là nguồn xung đột giao dịch. Ai muốn mở lại đường song song thì phải **đo trước**
và phải giữ đường thử lại 40001 trong `runBatch`.

## 4. Quyết định 2 — mô hình dữ liệu trong `seed-demo.ts`

### 4.1 Kiểu dữ liệu mở rộng

`ClinicSpec` giữ nguyên các trường `slug, name, kind, users, story, allergies, history, visits` và
thêm `today`. `StoryVisit` **thêm** `hour`, `minute`, `seconds` và **bỏ** bốn trường chữ:

```ts
interface StoryVisit {
  patient: number;          // chỉ số trong `story` của phòng khám (không đổi nghĩa)
  daysAgo: number;
  /** Giờ VN (0–23) của lượt khám. Mặc định 9. Để các lượt cùng ngày không trùng giờ. */
  hour?: number;
  /** Phút VN (0–59). Mặc định 0. */
  minute?: number;
  doctor: string;
  specialty: 'noi' | 'nhi';
  dx: string[];             // mã ICD-10; mã ĐẦU TIÊN quyết định bộ chữ (mục 7.4)
  lines: LineInput[];
  vitals: VitalsInput;      // kiểu THẬT của @phongmach/clinical, không phải Record<string, number>
  /** Thời lượng phiên khám (giây) để trang "Thời gian khám" có p50/p90 phân tán. Mặc định 75. */
  seconds?: number;
}
```

**Bỏ hẳn bốn trường `reason/symptoms/findings/advice` khỏi `StoryVisit`** (so với bản sửa 2): chúng được
**dẫn xuất** từ `dx[0]` + chỉ số lượt qua bảng `NARRATIVE` (mục 7.4), nên để chúng là trường khai báo
tùy chọn chính là cái đã làm review finding 2 đúng: người code có thể bỏ trống `advice` mà vẫn "đúng
thiết kế". Nay không còn chỗ để bỏ trống: `narrative(specialty, dx[0], index)` **luôn** trả về cả bốn,
và `validateScenario` báo lỗi nếu `NARRATIVE` thiếu dòng cho một mã được dùng.

**Không có cửa ghi đè.** Đã cân nhắc thêm một trường `narrative?: Partial<Narrative>` để ghi đè bộ chữ
của một lượt cá biệt và **bỏ**: nó mở lại đúng lỗ mà finding 2 chỉ ra (một trường tùy chọn ảnh hưởng tới
chữ in trên đơn), và khi cần một bộ chữ khác thì thêm một **biến thể** vào `NARRATIVE` (mục 7.4) là
đường duy nhất — vừa dùng lại được cho lượt khác, vừa có `validateScenario` soát.

Hàng chờ của ngày seed chạy dùng **kiểu phân biệt theo `state`** (union), không dùng một interface có
nhiều trường tùy chọn. Lý do: chỉ cách này mới để trình biên dịch bắt được "lượt `done` thiếu `exam`" —
với `exam?: …` thì bỏ trống là hợp lệ về kiểu và lỗi chỉ lộ ra lúc `completeVisit` nhận `undefined`
(đúng finding 3 của review). Đồng thời nó làm `openedMinutesAgo` **không tồn tại** ở `waiting`/`done`,
nên không cần quy tắc runtime nào để cấm:

```ts
/** Hàng chờ của NGÀY SEED CHẠY. Mốc thời gian tương đối theo `now`, không bao giờ hardcode ngày. */
type Priority = 'normal' | 'appointment' | 'urgent';

interface TodayBase {
  patient: number;          // chỉ số trong `story`
  /** Đến cách đây bao nhiêu phút (so với lúc seed chạy). 1…600. */
  minutesAgo: number;
  priority: Priority;
  reason: string;           // lý do đến, hiện ở cột "Lý do" của hàng chờ
}

/** Phần khám + đơn của lượt đã ký; cùng hình dạng với phần tương ứng của StoryVisit. */
type TodayExam = Pick<StoryVisit, 'dx' | 'lines' | 'vitals' | 'seconds'>;

type TodayVisit =
  /** 'waiting' = chỉ cấp số, chưa ai gọi vào khám. */
  | (TodayBase & { state: 'waiting' })
  /** 'in-exam' = đã gọi vào khám, chưa ký. `openedMinutesAgo` CHỈ có nghĩa ở đây (mục 4.2). */
  | (TodayBase & { state: 'in-exam'; doctor: string; openedMinutesAgo?: number })
  /** 'done' = đã ký xong: `exam` BẮT BUỘC, trình biên dịch bắt nếu thiếu. */
  | (TodayBase & { state: 'done'; doctor: string; exam: TodayExam });
```

`reason` của lượt `today` được khai báo tay (vì nó là câu phụ tá gõ lúc cấp số, thấy ngay trên hàng chờ
— xem cột "Lý do đến" của bảng 8.1/8.2); còn `symptoms/findings/advice` của lượt `done` thì **vẫn dẫn
xuất** từ `exam.dx[0]` như lượt lịch sử.

### 4.2 Cách tạo (dùng đúng API của kho, không viết FHIR tay)

| Việc | Lời gọi | Ghi chú |
|---|---|---|
| Bệnh nhân | `buildPatient` + `executeBatch` POST `Patient` kèm `ifNoneExist=clientUuidQuery(uuid)` | giữ nguyên mã hiện có |
| Dị ứng | `store.addAllergy(patientId, { clientUuid, kind, value }, now)` | giữ nguyên |
| Tiền sử | `store.addHistory(patientId, { clientUuid, text }, now)` | giữ nguyên |
| Cấp số | `store.checkIn({ clientUuid, patientId, specialty, priority, reason }, at)` | `at` vừa là `now` vừa là giờ đến; `day = vnDay(at)` nên đánh số theo đúng ngày của lượt. **Lượt lịch sử**: `priority: 'normal'` (như mã hiện tại) và `reason = narrative(specialty, dx, i).reason` — `StoryVisit` không còn trường `reason` (mục 4.1). **Lượt `today`**: `priority` và `reason` khai báo tay trong bảng 8.1/8.2 |
| Gọi vào khám | `store.openVisit(encounterId, doctor, <mốc mở>)` | KHÔNG truyền tham số `openedAt` **thứ tư** → `examOpenedSource` = `server`, số đo vào cột thường (không phải "Đo ở máy khám"). Mốc mở = tham số **thứ ba**; chọn mốc nào: xem quy tắc chốt ngay dưới |
| Hoàn tất | `store.completeVisit({ clientUuid, encounterId, doctor, now: at + seconds*1000, exam, diagnoses, prescription })` | `seconds` = hiệu `now − examOpened` → chính là số giây trang Metrics hiện. `exam = { reason, symptoms, findings, vitals }` với ba trường chữ lấy từ `narrative(...)` (mục 7.4) và `vitals` khai báo tay; `prescription = { code, lines, advice: n.advice, followUpDays: n.followUpDays, acks: [], digestBase64 }` |
| Mã đơn | `makePrescriptionCode(vnDay(at), sha256(clientUuid))` | giữ nguyên, xác định theo clientUuid |

`doctor` lấy từ `file.users` theo `id` (`practitionerId` có với bác sĩ). `priority` phải thuộc
`PRIORITIES` = `normal | appointment | urgent`; `specialty` phải trùng `kind` của phòng khám
(`adult → 'noi'`, `pediatric → 'nhi'`) — không trộn chuyên khoa giữa hai phòng.

**Quy tắc CHỐT về mốc mở hồ sơ (sửa theo review finding 1).** Đã đọc lại ba chỗ: `markCalled`
(`packages/clinical/src/queue.ts`) ghi `EXTENSIONS.examOpened = (openedAt ?? now).toISOString()` và chỉ
gắn `examOpenedSource = 'client'` **khi** có tham số thứ tư; `completeVisit`
(`services/bff/src/medplum.ts`) đọc lại `examOpened` rồi gọi `measureVisit`; `measureVisit`
(`packages/clinical/src/clientTime.ts`) nhánh `source === 'server'` tính
`seconds = Math.max(0, round((now − opened)/1000))`. Hệ quả: **giờ ký phải SAU giờ mở**, nếu không số đo
thành 0 và toàn bộ bảng p50/p90 ở mục 9 sai. Vì vậy:

| Loại lượt | Mốc truyền cho `openVisit` (tham số thứ 3) | `completeVisit.now` | `seconds` đo được |
|---|---|---|---|
| Lượt lịch sử (`visits`) | `at` = giờ đến (ngày+giờ VN của lượt) | `at + seconds × 1000` | đúng bằng `seconds` khai báo |
| `today.state === 'done'` | `at` = `max(now − minutesAgo × 60.000, 00:05 giờ VN)` — **cùng mốc với `checkIn`** | `at + exam.seconds × 1000` | đúng bằng `exam.seconds` |
| `today.state === 'in-exam'` | `openedAt = now − (openedMinutesAgo ?? ⌈minutesAgo/2⌉) × 60.000`, kẹp `≤ now` | **không gọi `completeVisit`** | — (lượt chưa ký, không vào số đo) |
| `today.state === 'waiting'` | **không gọi `openVisit`** | — | — |

```ts
// Lượt lịch sử và lượt `done`: mở hồ sơ ĐÚNG lúc đến ⇒ seconds = đúng số khai báo.
const opened = await withQuotaRetry(what, () => store.openVisit(enc.id, doctor, at));
// … completeVisit({ …, now: new Date(at.getTime() + seconds * 1000) })

// CHỈ lượt 'in-exam': mốc mở muộn hơn giờ đến (bệnh nhân chờ rồi mới được gọi vào), và KHÔNG ký.
const openedAt = new Date(Math.min(now.getTime() - (v.openedMinutesAgo ?? Math.ceil(v.minutesAgo / 2)) * 60_000, now.getTime()));
await withQuotaRetry(what, () => store.openVisit(enc.id, doctor, openedAt));
```

Hai hệ quả phải nhớ: (1) mốc mở của lượt `done` **không** dùng `openedMinutesAgo` — trường đó không tồn
tại trên nhánh `done` của union (mục 4.1) nên không có cách viết sai; (2) với lượt `in-exam`, giao diện
hiện "đang khám từ N phút" tính từ `calledAt` = `examOpened` = `openedAt`, nên con số "mở cách đây 3
phút" ở bảng 8.1/8.2 là `openedMinutesAgo: 3`, không phải `minutesAgo`.

### 4.3 Khóa xác định (bất biến quan trọng nhất)

| Loại | Khóa `stableUuid(...)` | Phụ thuộc ngày? |
|---|---|---|
| Bệnh nhân kịch bản | `${slug}:story:${index}` | không |
| Bệnh nhân sinh ngẫu nhiên | `${slug}:${i}` | không |
| Dị ứng | `${slug}:allergy:${index}` | không |
| Tiền sử | `${slug}:history:${index}` | không |
| Lượt khám lịch sử | `${slug}:visit:${index}:in` và `:done` | không |
| **Sân khấu hôm nay** | `${slug}:today:${vnDay(now)}:${index}:in` cho mọi lượt, thêm `…:${index}:done` chỉ với lượt `state: 'done'` (lượt `waiting`/`in-exam` không có khóa `:done` vì không gọi `completeVisit`) | **có** |

Hai hệ quả phải viết thành chú thích in đậm trong mã:

1. **CHỈ ĐƯỢC THÊM VÀO CUỐI** các mảng `story`, `allergies`, `history`, `visits`; không chèn giữa,
   không đổi thứ tự, không xóa giữa. Khóa tính theo chỉ số: chèn giữa sẽ đổi khóa của mọi mục sau nó và
   sinh bản trùng trên tenant đã seed. (Phương án khóa chuỗi tường minh `key?: string` đã được cân
   nhắc và **bỏ**: ba mảng hiện có đã mang khóa theo chỉ số trên tenant đang chạy, đổi hệ khóa sẽ tạo
   bản trùng ngay lần seed kế tiếp — cái giá lớn hơn lợi ích.)
2. **Sửa nội dung một mục đã có không có tác dụng** trên tenant đã seed (tạo có điều kiện thấy khóa cũ
   thì bỏ qua, không cập nhật). Muốn thêm dữ liệu thì thêm mục mới.

Vì khóa của hàng chờ hôm nay có `vnDay(now)`: chạy lại trong cùng ngày không tạo thêm gì. Đường chạy
lại là **ba đường tách biệt**, phải viết đúng từng đường (đã đối chiếu `services/bff/src/medplum.ts`):

| Loại lượt | Chạy lại thấy gì | Seed làm gì |
|---|---|---|
| `waiting` (chỉ cấp số) | `checkIn` thấy `clientUuid` đã có → `{ created: false }` | dừng ở đó, không gọi gì thêm |
| `in-exam` | Encounter còn `in-progress` và do **cùng `userId`** giữ → `openVisit` trả `{ kind: 'ok' }`, không ghi gì | dừng ở đó |
| `done` và **mọi lượt lịch sử** | Encounter đã `finished` ⇒ `openVisit` trả **`{ kind: 'closed' }`** (dòng `if (enc.status === 'finished' …) return { kind: 'closed' }`) | **bỏ qua `closed`, đi tiếp `completeVisit` cùng `clientUuid`**: `wasCompletedBy` nhận ra lần hoàn tất cũ và trả `{ kind: 'ok', replayed: true }` mà không ghi gì (phép kiểm `wasCompletedBy` nằm **trước** phép kiểm trạng thái trong `completeVisit`) |

`kind: 'closed'` vì vậy là **đường chạy lại bình thường**, không phải bất biến bị vỡ — mã seed hiện tại
chạy lại được chính vì nó bỏ qua kết quả của `openVisit`. Thiết kế giữ nguyên tính chất đó, chỉ thêm
phân biệt `taken`/`not-found` (mục 12.2). Sang ngày sau, `up -d` lại (seed chạy lại)
sẽ dựng hàng chờ mới cho ngày mới.

**Hai thứ tích tụ lại theo ngày — không phải lỗi dữ liệu, phải ghi rõ để người sau không đi sửa** (vế
thứ hai thêm theo review finding 9):

1. Hàng chờ của những ngày trước còn **3 Encounter `arrived`** mỗi phòng mỗi ngày (ba lượt `waiting`).
   `listQueue(day)` lọc theo ngày nên hàng chờ hôm nay không thấy chúng.
2. Mỗi ngày seed chạy còn để lại **1 Encounter `in-progress`** mỗi phòng (lượt `in-exam`) **không bao
   giờ được đóng**: ngày sau không ai ký nó, và seed của ngày sau dùng khóa `vnDay(now)` mới nên không
   quay lại lượt cũ. Vô hại với cả ba đường đọc: `listQueue(day)` lọc theo ngày; `finishedVisits` chỉ
   lấy `status=finished` nên không vào số đo Metrics; `patientVisits` cũng chỉ lấy `finished` nên lịch
   sử khám của bệnh nhân không hiện lượt dở. Chi phí thật duy nhất: sau N ngày demo có N lượt dở trong
   CSDL. Nếu muốn dọn thì dùng màn "Hủy lượt" trên giao diện — **không** thuộc phạm vi seed.

### 4.4 Mốc thời gian

- Lượt lịch sử: ngày = `vnDay(now − daysAgo ngày)`, giờ = `hour:minute` theo giờ VN, dựng bằng
  `new Date(\`${day}T${hh}:${mm}:00+07:00\`)`. Không phụ thuộc TZ của container (container chạy UTC).
- Lượt hôm nay: `at = now − minutesAgo×60.000 ms` — luôn trong quá khứ gần, không bao giờ ở tương lai
  (hàng chờ sẽ hiện "chờ N phút" đúng), **nhưng phải kẹp vào trong ngày VN**:

  ```ts
  // checkIn đánh ngày theo vnDay(arrived) với arrived = at, còn khóa stableUuid mang vnDay(now).
  // Nếu seed chạy trong khoảng 00:00–01:00 giờ VN, at = now − 55 phút rơi sang NGÀY HÔM TRƯỚC
  // ⇒ listQueue(vnDay(now)) không thấy lượt đó và hàng chờ thiếu người. Vì vậy kẹp mốc đến:
  const floor = Date.parse(`${vnDay(now)}T00:05:00+07:00`);
  const at = new Date(Math.max(now.getTime() - minutesAgo * 60_000, floor));
  ```

  Quy ước: mọi lượt của mảng `today` dùng mốc `at` đã kẹp này; nếu seed chạy sát nửa đêm VN thì nhiều
  lượt dồn về `00:05` — hàng chờ vẫn đủ người và đúng ngày, chỉ mất khoảng cách thời gian giữa các
  lượt. Đây là đánh đổi có chủ ý (thà sân khấu dày mà giờ sát nhau hơn là hàng chờ trống).
- `completeVisit.now = at + seconds×1000`. Với lượt hôm nay, `minutesAgo` phải lớn hơn
  `seconds/60 + 1` để giờ ký không vượt quá hiện tại (và sau khi kẹp mốc, giờ ký vẫn ≤ `now` vì
  `seconds` tối đa 120 giây ≪ 5 phút).

### 4.5 Đo thời gian và nhật ký tiến độ

Seed in theo giai đoạn, mỗi dòng có số giây (một chữ số thập phân):

```
noi-tong-quat: 300 bệnh nhân (82,4 giây), 11 dị ứng + 11 tiền sử (14,1 giây),
               32 lượt khám cũ (95,7 giây), 6 lượt hôm nay: 3 chờ, 1 đang khám, 2 đã xong (12,8 giây)
...
Tổng thời gian seed: 4 phút 51 giây
```

Dòng tổng là con số đưa vào `trial1-verification.md`, và phải ghi rõ **đó là lần chạy nào**:

- **Lần chạy nguội** (lần đầu sau khi đổi mã): tạo mới gần như toàn bộ dữ liệu ⇒ đây là con số dùng để
  so với ngưỡng 8–10 phút và để quyết định có lùi về hay không. Lưu ý trên tenant demo **dùng lại**,
  17 bệnh nhân sinh ngẫu nhiên + 4 lượt khám cũ của lần seed trước đã tồn tại và bị bỏ qua, nên lần
  "nguội" này vẫn nhẹ hơn một tenant hoàn toàn trắng.
- **Lần chạy lại** (chạy `up -d` lần hai trong cùng ngày): gần như không ghi gì, chỉ đọc để xác nhận
  khóa đã có ⇒ nhanh hơn hẳn. Ghi riêng con số này làm **bằng chứng của tính chạy-lại-được**, không
  trộn với con số trên.

## 5. Bệnh nhân kịch bản (`story`)

Chỉ **thêm vào cuối**. Tuổi tính theo 09/10/2026 (ngày viết thiết kế).

### 5.1 Phòng Nội tổng quát (`noi-tong-quat`) — thêm 12, tổng 15

| idx | Họ tên (lưu đúng như viết) | Điện thoại | CCCD | Ngày sinh | Tuổi | GT | Vai trò trong demo |
|---|---|---|---|---|---|---|---|
| 0 | Nguyễn Văn An | 0912345678 | 000123456789 | 1985-03-15 | 41 | nam | đã có. THA, dị ứng penicillin |
| 1 | Nguyễn Văn Ân | 0903115678 | 000987654321 | 1991-11-02 | 34 | nam | đã có. gần trùng tên với idx 0 |
| 2 | Trần Thị Bình | 0987665678 | 000555444333 | 1972-08-20 | 54 | nữ | đã có. viêm mũi dị ứng |
| 3 | **Nguyen Van An** (không dấu) | 0913451234 | 000112233445 | 1979-07-04 | 47 | nam | **trùng tên hoàn toàn với idx 0 nhưng nhập không dấu** |
| 4 | Nguyễn Văn Ánh | 0918881234 | 000223344556 | 1996-02-29 | 30 | nam | gần trùng (Ánh/An/Ân) |
| 5 | Nguyễn Vân Anh | 0938881234 | 000334455667 | 1990-05-12 | 36 | nữ | "Vân" bỏ dấu thành "van" → vẫn ra khi tìm "nguyen van" |
| 6 | Nguyễn Thị An | 0909991234 | 000445566778 | 1968-09-30 | 58 | nữ | ra khi tìm "nguyen an", KHÔNG ra khi tìm "nguyen van" (chứng minh độ chính xác) |
| 7 | Nguyễn Văn Anh | 0977771234 | 000556677889 | 2001-12-01 | 24 | nam | trùng cụm "nguyễn văn" |
| 8 | Trần Văn An | 0966661234 | 000667788990 | 1983-04-18 | 43 | nam | cùng "văn an", khác họ. Hen phế quản |
| 9 | Phạm Văn An | 0944335678 | 000778899001 | 1958-11-11 | 67 | nam | cùng "văn an"; đuôi 5678 như idx 0 → demo "an 5678" |
| 10 | Võ Thị Kim Chi | 0905557788 | 000889900112 | 1965-06-05 | 61 | nữ | THA + ĐTĐ typ 2, 7 lượt khám trải 6 tháng |
| 11 | Hoàng Minh Tuấn | 0912227788 | 000990011223 | 1977-01-23 | 49 | nam | rối loạn lipid + gút |
| 12 | Đỗ Thị Hạnh | 0988447788 | 000101112131 | 1949-03-08 | 77 | nữ | thoái hóa khớp, bệnh nhân cao tuổi |
| 13 | Bùi Quốc Thắng | 0933117788 | 000121314151 | 1988-08-08 | 38 | nam | bệnh dạ dày, đau nửa đầu |
| 14 | Lý Thị Thu Hiền | 0977229999 | 000131415161 | 1994-10-10 | 32 | nữ | dị ứng NSAID, mày đay |

Cụm 4 số cuối để demo tìm theo đuôi điện thoại: **1234** → idx 3,4,5,6,7,8 (6 người);
**5678** → idx 0,1,2,9 (4 người); **7788** → idx 10,11,12,13 (4 người).

### 5.2 Phòng Nhi (`nhi`) — thêm 9, tổng 11

Không ai có CCCD (đều dưới 14 tuổi — quy tắc `cccdMinAgeYears: 14`). Điện thoại là của người đưa trẻ đi khám.

| idx | Họ tên | Điện thoại | Ngày sinh | Tuổi | GT | Vai trò trong demo |
|---|---|---|---|---|---|---|
| 0 | Lê Minh Khang | 0934567890 | 2021-06-10 | 5 | nam | đã có |
| 1 | Đặng Bảo Ngọc | 0976543210 | 2019-01-25 | 7 | nữ | đã có. dị ứng cephalosporin |
| 2 | Nguyễn Văn Khoa | 0911112345 | 2018-03-12 | 8 | nam | cụm "nguyễn văn" trong phòng Nhi |
| 3 | Nguyễn Văn Khôi | 0922222345 | 2016-07-22 | 10 | nam | gần trùng với idx 2 |
| 4 | Nguyễn Vân Khanh | 0933332345 | 2020-09-09 | 6 | nữ | bỏ dấu → "nguyen van khanh" |
| 5 | Trần Minh Khang | 0944442345 | 2017-11-30 | 8 | nam | cùng "minh khang" với idx 0, khác họ |
| 6 | **Lê Minh Khang** | 0955552345 | 2016-02-14 | 10 | nam | **trùng tên hoàn toàn với idx 0** (khác 5 tuổi) |
| 7 | Phạm Bảo Ngọc | 0966662345 | 2022-04-01 | 4 | nữ | cùng "bảo ngọc" với idx 1 |
| 8 | **Đặng Bảo Ngọc** | 0912343210 | 2015-12-05 | 10 | nữ | **trùng tên hoàn toàn với idx 1**, và cùng 4 số cuối `3210` |
| 9 | Hoàng Gia Bảo | 0977772345 | 2023-08-19 | 3 | nam | trẻ nhỏ nhất, dùng dạng giọt/gói |
| 10 | Vũ Ngọc Diệp | 0988882345 | 2016-05-06 | 10 | nữ | cận thị, viêm kết mạc |

Cụm 4 số cuối: **2345** → idx 2,3,4,5,6,7,9,10 (8 người); **3210** → idx 1,8 (2 người).

Ghi chú tuổi: nhóm sinh 2015–2016 sẽ bước qua 14 tuổi vào 2029–2030, lúc đó quy tắc CCCD sẽ chặn kê
đơn cho các cháu này. Dữ liệu demo cần làm mới trước mốc đó (ghi vào tài liệu kiểm chứng, không xử lý
trong lần này).

### 5.3 Kết quả tìm kiếm mong đợi (dùng để kiểm chứng)

Cách đọc bảng (đã đối chiếu `searchPatients` trong `services/bff/src/medplum.ts`): nhánh `name` chạy
**hai** truy vấn — `_tag` khóa từng từ (AND **mọi** từ, khớp đúng từ) và `name` của Medplum (AND mọi từ
nhưng khớp theo **đầu từ**, nên `an` bắt cả "Anh"/"Ánh"). Kết quả là hợp hai tập, nhóm khớp-đúng-từ xếp
trước (`rankByNameWords`). Vì AND mọi từ, một ca **thiếu** một từ trong truy vấn thì **không** ra.

**Cách đọc cột "Kết quả mong đợi": đó là tập PHẢI CÓ MẶT, không phải tập đóng.** Nhánh `name` của
Medplum khớp theo **đầu từ**, nên mọi hàng còn có thể kèm thêm ca khác (ca kịch bản khớp đầu từ — cột
cuối liệt kê sẵn — và ca sinh ngẫu nhiên). Kiểm chứng ở mục 15 vì vậy dùng `≥` kèm danh sách phải có
mặt; một ca "lạ" xuất hiện trong kết quả **không** phải lỗi.

| Gõ vào ô tìm | Ý định `classifyQuery` | Phải có mặt | Lọt thêm qua nhánh đầu từ |
|---|---|---|---|
| `nguyen van` | `name` (nguyen, van) | ≥ 6 ca kịch bản phòng Nội: idx 0, 1, 3, 4, 7 khớp đúng cả hai từ, idx 5 ("Vân" bỏ dấu = "van") cũng khớp đúng | ca sinh ngẫu nhiên có cụm "nguyễn … văn/vân". **Không** có idx 6 (Nguyễn **Thị** An), 8, 9 (họ Trần/Phạm) ở cả hai nhánh |
| `nguyen van an` | `name` (nguyen, van, an) | idx 0, 1, 3 khớp đúng cả ba từ ("An" và "Ân" bỏ dấu đều là "an") | idx 4 (Ánh → "an…"), **idx 5** (Nguyễn Vân **Anh**: nguyen ✓, van ✓, "anh" bắt đầu bằng "an" ✓), 7 (Anh) — phân biệt bằng ngày sinh/điện thoại/CCCD |
| `nguyen an` | `name` (nguyen, an) | khớp đúng cả hai từ, xếp trước: idx 0, 1, 3, 6 | idx 4, 5, 7. **Không** có idx 8, 9 — hai ca này họ Trần/Phạm nên thiếu từ `nguyen` |
| `van an` | `name` (van, an) | idx 0, 1, 3, 8, 9 — **đây** mới là truy vấn chứng minh "cùng tên khác họ" của idx 8 (Trần Văn An) và idx 9 (Phạm Văn An) | **idx 4, 5, 7** (Ánh / Vân Anh / Văn Anh đều khớp "van" đúng từ và "an" theo đầu từ) |
| `1234` | `phone-fragment` | 6 ca kịch bản (idx 3–8) ở nhóm đầu vì nhánh khóa "4 số cuối" xếp trước nhánh `phone:contains` | ca sinh ngẫu nhiên **chứa** "1234" ở giữa số — đúng thiết kế, không phải lỗi |
| `an 1234` | `name+number` | khớp đúng từ + đuôi số, xếp trước: idx 3, 6, 8 | nhánh đầu từ (đã lọc lại đuôi thật): idx 4, 5, 7 |
| `0912345678` | `phone` | đúng 1 ca (idx 0) | — (khớp cả số, không có nhánh đầu từ) |
| `000123456789` | `cccd` | đúng 1 ca (idx 0) | — |
| `le minh khang` (phòng Nhi) | `name` | 2 ca trùng tên hoàn toàn (idx 0, 6) | **Không** có idx 5 (Trần Minh Khang — thiếu từ `le`) ở cả hai nhánh |
| `2345` (phòng Nhi) | `phone-fragment` | 8 ca kịch bản (idx 2,3,4,5,6,7,9,10) ở nhóm đầu | ca sinh ngẫu nhiên chứa "2345" |

## 6. Dị ứng và tiền sử

Tất cả đi qua `store.addAllergy` / `store.addHistory`. `kind: 'class'` dùng mã trong `ALLERGY_CLASSES`;
`kind: 'ingredient'` dùng đúng chuỗi hoạt chất có trong `INGREDIENTS` (sinh từ `DRUGS`).

**Nguyên tắc nhất quán dữ liệu:** không có đơn thuốc nào trong dữ liệu seed được chứa thuốc xung đột với
dị ứng đã ghi của chính bệnh nhân đó. (Seed đi qua `store` nên không chạy bộ quy tắc; nếu để xung đột,
lúc demo mở lại hồ sơ cũ và bấm "kê lại" sẽ bị chặn một cách khó hiểu.) Cảnh báo dị ứng được trình diễn
**trực tiếp** bằng cách bác sĩ thêm thuốc xung đột trên sân khấu, không bằng dữ liệu bẩn.

### 6.1 Dị ứng — phòng Nội (thêm 9, tổng 11)

| idx mục | Bệnh nhân | kind | value | Ghi chú kiểm tra chéo |
|---|---|---|---|---|
| 0 | 0 Nguyễn Văn An | class | `penicillin` | đã có → mọi đơn của idx 0 dùng azithromycin, không amoxicillin |
| 1 | 2 Trần Thị Bình | class | `nsaid` | đã có → đơn của idx 2 chỉ kháng histamin/kháng sinh |
| 2 | 1 Nguyễn Văn Ân | ingredient | `sulfamethoxazol` | |
| 3 | 3 Nguyen Van An | class | `nsaid` | đơn của idx 3 không có NSAID |
| 4 | 5 Nguyễn Vân Anh | class | `quinolone` | đơn NK tiết niệu dùng fosfomycin, không ciprofloxacin |
| 5 | 6 Nguyễn Thị An | ingredient | `azithromycin` | |
| 6 | 9 Phạm Văn An | class | `sulfonamide` | |
| 7 | 10 Võ Thị Kim Chi | class | `macrolide` | |
| 8 | 12 Đỗ Thị Hạnh | class | `salicylate` | đơn của bà dùng meloxicam (NSAID khác nhóm salicylat) |
| 9 | 13 Bùi Quốc Thắng | class | `tetracycline` | |
| 10 | 14 Lý Thị Thu Hiền | class | `nsaid` | |

### 6.2 Dị ứng — phòng Nhi (thêm 6, tổng 7)

| idx mục | Bệnh nhân | kind | value | Ghi chú |
|---|---|---|---|---|
| 0 | 1 Đặng Bảo Ngọc (2019) | class | `cephalosporin` | đã có → đơn của cháu dùng amoxicillin, không cefixim |
| 1 | 2 Nguyễn Văn Khoa | ingredient | `ibuprofen` | đơn hạ sốt dùng paracetamol |
| 2 | 3 Nguyễn Văn Khôi | class | `nsaid` | |
| 3 | 5 Trần Minh Khang | class | `penicillin` | đơn của cháu không có beta-lactam |
| 4 | 8 Đặng Bảo Ngọc (2015) | ingredient | `amoxicillin` | |
| 5 | 9 Hoàng Gia Bảo | class | `cephalosporin` | |
| 6 | 10 Vũ Ngọc Diệp | class | `sulfonamide` | |

### 6.3 Tiền sử — phòng Nội (thêm 10, tổng 12)

| idx mục | Bệnh nhân | Nội dung (≤ 300 ký tự) |
|---|---|---|
| 0 | 0 | đã có: "Tăng huyết áp 3 năm, đang dùng amlodipin" |
| 1 | 2 | đã có: "Viêm mũi dị ứng theo mùa" |
| 2 | 3 | "Hút thuốc 10 điếu/ngày, chưa bỏ được" |
| 3 | 5 | "Hai lần nhiễm khuẩn tiết niệu trong năm nay" |
| 4 | 6 | "Thoái hóa cột sống cổ, đau tái phát khi làm việc máy tính lâu" |
| 5 | 8 | "Hen phế quản từ nhỏ, dùng salbutamol khi lên cơn" |
| 6 | 9 | "Đái tháo đường typ 2 10 năm, tăng huyết áp; đã bỏ thuốc lá 5 năm" |
| 7 | 10 | "Tăng huyết áp 8 năm; đái tháo đường typ 2 phát hiện 2021, đang dùng metformin" |
| 8 | 11 | "Rối loạn lipid máu; cơn gút cấp khoảng 2 lần mỗi năm" |
| 9 | 12 | "Thoái hóa khớp gối hai bên; đau thắt lưng tái phát nhiều năm" |
| 10 | 13 | "Viêm dạ dày HP dương tính, đã điều trị diệt HP năm 2023" |
| 11 | 14 | "Viêm mũi dị ứng quanh năm, mày đay tái phát" |

### 6.4 Tiền sử — phòng Nhi (thêm 7, tổng 8)

| idx mục | Bệnh nhân | Nội dung |
|---|---|---|
| 0 | 0 | đã có: "Sinh đủ tháng, tiêm chủng đủ theo lịch" |
| 1 | 1 | "Viêm amidan tái đi tái lại khoảng 4 lần mỗi năm" |
| 2 | 3 | "Viêm mũi dị ứng theo mùa; bố có hen phế quản" |
| 3 | 5 | "Viêm da cơ địa từ 6 tháng tuổi, bùng phát khi trời lạnh" |
| 4 | 6 | "Hen phế quản bậc nhẹ, theo dõi từ năm 2024" |
| 5 | 8 | "Thiếu máu thiếu sắt, đã bổ sung sắt 3 tháng" |
| 6 | 9 | "Sinh non 35 tuần, cân nặng lúc sinh 2,3 kg" |
| 7 | 10 | "Cận thị 1,5 D hai mắt, đeo kính từ năm 2025" |

## 7. Lượt khám cũ (`visits`) — mã ICD-10 và thuốc đều lấy từ `packages/catalogs`

Mọi mã trong hai bảng dưới đây đã đối chiếu với `packages/catalogs/src/icd10.ts` và
`packages/catalogs/src/drugs.ts` (mã thuốc = `drugCode(tên)`, đã liệt kê bằng máy — 101 mã). Không có mã
nào tự bịa. Cột "giây" là `seconds` của lượt, dùng để tính p50/p90 (mục 9).

**Thứ tự mảng: `daysAgo` TĂNG DẦN** (sửa theo review finding 4). Mục cuối mảng vì vậy *thật sự* là lượt
cũ nhất, nên bậc 2 của thang lùi (mục 3) cắt từ cuối là bỏ đúng chiều sâu lịch sử chứ không bỏ dữ liệu
của khoảng 14/30 ngày. Thứ tự này **chỉ** là tiện lợi một lần: bất biến "chỉ thêm vào cuối" (mục 4.3)
mạnh hơn nó, nên lần thêm dữ liệu sau sẽ phá thứ tự — trước khi cắt, đọc `daysAgo` của các mục cuối.

Cột `reason/symptoms/findings/advice` **không** có trong bảng vì chúng được dẫn xuất từ mã ICD-10 đầu
tiên + chỉ số lượt (mục 7.4). Cột "giây" là `seconds` của lượt, dùng để tính p50/p90 (mục 9).

### 7.1 Phòng Nội tổng quát — thêm 32 lượt (idx 3–34), tổng 35

| idx | BN | daysAgo | giờ | Bác sĩ | ICD-10 | Đơn thuốc (mã danh mục) | giây |
|---|---|---|---|---|---|---|---|
| 3 | 2 | 1 | 08:45 | noi-doctor | J30.4, Z76.0 | CETIRIZIN-10-MG (14 ngày) | 38 |
| 4 | 1 | 2 | 15:40 | noi-owner | N39.0 | CEFIXIM-200-MG | 56 |
| 5 | 9 | 2 | 10:40 | noi-doctor | E11.9, I10 | METFORMIN-850-MG; LOSARTAN-50-MG; ATORVASTATIN-20-MG | 116 |
| 6 | 8 | 3 | 08:55 | noi-owner | J45.9 | SALBUTAMOL-100-MCG-LIEU-BINH-XIT; MONTELUKAST-10-MG (30 ngày) | 70 |
| 7 | 14 | 3 | 11:20 | noi-doctor | J30.4, Z76.0 | MONTELUKAST-10-MG; FEXOFENADIN-180-MG (14 ngày) | 52 |
| 8 | 5 | 4 | 16:20 | noi-owner | N30.0 | FOSFOMYCIN-3-G | 41 |
| 9 | 0 | 5 | 09:05 | noi-doctor | I10, Z76.0 | AMLODIPIN-5-MG; ATORVASTATIN-20-MG | 47 |
| 10 | 7 | 6 | 17:05 | noi-doctor | L70.0 | ADAPALEN-0-1-GEL; BENZOYL-PEROXID-2-5-GEL; DOXYCYCLIN-100-MG (14 ngày) | 92 |
| 11 | 12 | 6 | 09:50 | noi-owner | M17.9, Z76.0 | GLUCOSAMIN-500-MG; CALCI-CARBONAT-VITAMIN-D3 | 104 |
| 12 | 4 | 7 | 11:00 | noi-doctor | K30 | OMEPRAZOL-20-MG; SIMETHICON-40-MG | 61 |
| 13 | 13 | 8 | 14:35 | noi-doctor | K21.9 | ESOMEPRAZOL-40-MG; DOMPERIDON-10-MG | 44 |
| 14 | 2 | 9 | 10:15 | noi-doctor | J01.9 | CEFUROXIM-500-MG; ACETYLCYSTEIN-200-MG; NATRI-CLORID-0-9-NHO-MUI | 76 |
| 15 | 6 | 10 | 09:30 | noi-doctor | M54.2 | MELOXICAM-7-5-MG; EPERISON-50-MG; OMEPRAZOL-20-MG (5 ngày) | 64 |
| 16 | 10 | 10 | 08:30 | noi-owner | I10, E11.9, Z76.0 | AMLODIPIN-5-MG; METFORMIN-500-MG; ATORVASTATIN-20-MG | 84 |
| 17 | 3 | 11 | 14:10 | noi-owner | J06.9 | PARACETAMOL-500-MG; CETIRIZIN-10-MG; NATRI-CLORID-0-9-NHO-MUI | 50 |
| 18 | 13 | 11 | 10:05 | noi-owner | G43.9 | FLUNARIZIN-5-MG; PARACETAMOL-500-MG | 58 |
| 19 | 11 | 12 | 15:10 | noi-doctor | E78.5, Z76.0 | ATORVASTATIN-20-MG; ALLOPURINOL-300-MG | 148 |
| 20 | 0 | 13 | 08:20 | noi-doctor | J02.9 | AZITHROMYCIN-500-MG; PARACETAMOL-500-MG | 54 |
| 21 | 12 | 13 | 16:45 | noi-doctor | M54.5 | MELOXICAM-7-5-MG; EPERISON-50-MG; OMEPRAZOL-20-MG (5 ngày) | **1920** (phiên bỏ dở) |
| 22 | 1 | 20 | 17:15 | noi-owner | A09 | ORESOL-MUOI-BU-NUOC; RACECADOTRIL-100-MG (3 ngày); MEN-VI-SINH-LACTOBACILLUS | 53 |
| 23 | 14 | 25 | 11:35 | noi-doctor | L50.9 | DESLORATADIN-5-MG; HYDROCORTISON-1-KEM | 62 |
| 24 | 10 | 30 | 08:40 | noi-doctor | I10, E11.9 | AMLODIPIN-5-MG; METFORMIN-500-MG | 46 |
| 25 | 10 | 60 | 09:15 | noi-owner | I10, E11.9, Z76.0 | AMLODIPIN-5-MG; METFORMIN-500-MG; ATORVASTATIN-20-MG | 53 |
| 26 | 10 | 90 | 08:25 | noi-doctor | I10, E11.9 | AMLODIPIN-5-MG; METFORMIN-500-MG | 62 |
| 27 | 11 | 95 | 16:00 | noi-doctor | M10.9 | ETORICOXIB-60-MG; OMEPRAZOL-20-MG (5 ngày) | 113 |
| 28 | 14 | 110 | 10:50 | noi-doctor | J30.4 | FEXOFENADIN-180-MG; NATRI-CLORID-0-9-NHO-MUI | 46 |
| 29 | 10 | 120 | 10:30 | noi-owner | I10, Z76.0 | AMLODIPIN-5-MG; METFORMIN-500-MG; ATORVASTATIN-20-MG | 71 |
| 30 | 10 | 150 | 09:00 | noi-doctor | I10, E11.9 | AMLODIPIN-5-MG; METFORMIN-500-MG | 88 |
| 31 | 13 | 160 | 15:25 | noi-owner | K29.7 | OMEPRAZOL-20-MG; DOMPERIDON-10-MG; NHOM-HYDROXYD-MAGNESI-HYDROXYD | 79 |
| 32 | 10 | 180 | 11:10 | noi-owner | I10 | AMLODIPIN-5-MG | 97 |
| 33 | 12 | 200 | 09:40 | noi-doctor | M17.9 | MELOXICAM-7-5-MG; OMEPRAZOL-20-MG (5 ngày); GLUCOSAMIN-500-MG | 67 |
| 34 | 11 | 240 | 14:50 | noi-owner | E78.5, M10.9 | ATORVASTATIN-20-MG; ALLOPURINOL-300-MG | 59 |

Chuyên khoa bệnh lý được trải rộng: hô hấp (J02.9, J01.9, J06.9, J30.4, J45.9), tim mạch – chuyển hóa
(I10, E11.9, E78.5, M10.9), tiêu hóa (K30, K21.9, K29.7, A09), cơ xương khớp (M54.2, M54.5, M17.9),
tiết niệu (N39.0, N30.0), da liễu (L70.0, L50.9), thần kinh (G43.9), cấp lại đơn (Z76.0).

Khoảng **14 ngày** của trang Metrics (mục 9) = idx **3–21**; khoảng 30 ngày thêm idx 22–24.

### 7.2 Phòng Nhi — thêm 22 lượt (idx 1–22), tổng 23. Bác sĩ: `nhi-owner`

| idx | BN | Tuổi | daysAgo | giờ | ICD-10 | Đơn thuốc (mã danh mục) | giây |
|---|---|---|---|---|---|---|---|
| 1 | 10 | 10 | 2 | 11:30 | H10.9 | TOBRAMYCIN-0-3-NHO-MAT; NATRI-CLORID-0-9-NHO-MAT | 105 |
| 2 | 8 | 10 | 3 | 16:10 | R50.9 | PARACETAMOL-250-MG-GOI; ORESOL-MUOI-BU-NUOC | 56 |
| 3 | 5 | 8 | 4 | 15:30 | K59.0 | LACTULOSE-10-G-15-ML; MEN-VI-SINH-LACTOBACILLUS | 63 |
| 4 | 0 | 5 | 5 | 08:30 | B34.9 | PARACETAMOL-150-MG-GOI; ORESOL-MUOI-BU-NUOC | 45 |
| 5 | 3 | 10 | 6 | 14:15 | J30.4 | LORATADIN-10-MG (10 ngày); NATRI-CLORID-0-9-NHO-MUI | 48 |
| 6 | 7 | 4 | 7 | 10:05 | J06.9 | NATRI-CLORID-0-9-NHO-MUI; PARACETAMOL-150-MG-GOI | 51 |
| 7 | 6 | 10 | 8 | 09:45 | J45.9 | SALBUTAMOL-2-MG-5-ML-SIRO; MONTELUKAST-10-MG (30 ngày) | 90 |
| 8 | 2 | 8 | 9 | 10:25 | J02.9 | CEFIXIM-100-MG-GOI; PARACETAMOL-250-MG-GOI | 59 |
| 9 | 9 | 3 | 10 | 08:15 | A09 | ORESOL-MUOI-BU-NUOC; KEM-10-MG; RACECADOTRIL-30-MG-GOI | 70 |
| 10 | 1 | 7 | 11 | 09:10 | A09 | ORESOL-MUOI-BU-NUOC; KEM-10-MG; MEN-VI-SINH-LACTOBACILLUS | 53 |
| 11 | 3 | 10 | 12 | 17:00 | J03.9 | AMOXICILLIN-250-MG-GOI; PARACETAMOL-250-MG-GOI | **1920** (phiên bỏ dở) |
| 12 | 4 | 6 | 13 | 08:50 | J00 | NATRI-CLORID-0-9-NHO-MUI; PARACETAMOL-250-MG-GOI | 40 |
| 13 | 0 | 5 | 20 | 09:25 | J20.9 | PARACETAMOL-150-MG-GOI; ACETYLCYSTEIN-200-MG | 58 |
| 14 | 7 | 4 | 25 | 16:30 | K00.7 | PARACETAMOL-150-MG-GOI | 44 |
| 15 | 4 | 6 | 30 | 11:15 | J05.0 | BUDESONID-0-5-MG-2-ML-KHI-DUNG; PARACETAMOL-250-MG-GOI | 83 |
| 16 | 2 | 8 | 40 | 15:05 | H66.9 | AMOXICILLIN-250-MG-GOI; PARACETAMOL-250-MG-GOI | 74 |
| 17 | 9 | 3 | 45 | 08:10 | E55.9 | VITAMIN-D3-400-IU-GIOT | 52 |
| 18 | 1 | 7 | 60 | 10:40 | J03.9 | AMOXICILLIN-250-MG-GOI; PARACETAMOL-250-MG-GOI | 66 |
| 19 | 3 | 10 | 75 | 08:35 | B08.4 | PARACETAMOL-250-MG-GOI; ORESOL-MUOI-BU-NUOC | 49 |
| 20 | 6 | 10 | 90 | 09:55 | A08.4 | ORESOL-MUOI-BU-NUOC; KEM-10-MG; MEN-VI-SINH-LACTOBACILLUS | 55 |
| 21 | 5 | 8 | 120 | 14:45 | L20.9 | HYDROCORTISON-1-KEM; DESLORATADIN-5-MG (10 ngày) | 61 |
| 22 | 8 | 10 | 150 | 10:20 | D50.9 | SAT-FUMARAT-ACID-FOLIC; VITAMIN-C-500-MG | 72 |

Khoảng **14 ngày** = idx **1–12**; khoảng 30 ngày thêm idx 13–15.

### 7.3 Liều, số lượng và cách dùng — quy tắc bắt buộc của mỗi dòng thuốc

`resolveLine(drug, input)` phải trả về **cách dùng không rỗng** và (trừ thuốc kem/nhỏ/xịt đã có
`quantity` nhập tay) **số lượng xác định**.

**Chốt cơ chế trước đã — liều mặc định của danh mục KHÔNG tự áp vào dòng thuốc.** Đã đọc
`packages/catalogs/src/instruction.ts`: `buildInstruction` chỉ lấy `timing` từ `drug.defaults`, còn
`perDose`/`timesPerDay`/`days` đọc **từ `line.*`**; `computeQuantity` cũng vậy. Nơi duy nhất trong repo
hợp nhất `drug.defaults` vào dòng thuốc là **giao diện** (`apps/clinic-web/src/visit/draft.ts` →
`lineFromDrug`). Vì vậy viết `{ drug: 'AMLODIPIN-5-MG' }` sẽ cho `instruction: ''` và **không có**
`quantity` ⇒ bộ kiểm tra kịch bản (mục 12.1) báo lỗi ~50 dòng và `exit 1`; nếu bỏ bộ kiểm tra thì đơn
in ra không có cách dùng lẫn số lượng và quy tắc `incomplete-line` (severity `block`) chặn luôn thao
tác "kê lại" lúc demo.

Quy tắc: **mọi dòng thuốc của seed đi qua một hàm hợp nhất duy nhất** trong `seed-demo.ts`:

```ts
/**
 * Liều mặc định của danh mục KHÔNG tự áp vào dòng thuốc: resolveLine chỉ đọc line.* (chỉ `timing`
 * lấy từ drug.defaults). Vì vậy mọi dòng thuốc của seed phải đi qua hàm này.
 */
function line(code: string, over: Partial<Omit<LineInput, 'drug'>> = {}): LineInput {
  const drug = getDrug(code);
  if (!drug) throw new Error(`Thuốc demo không có trong danh mục: ${code}`);
  const d = drug.defaults;
  return {
    drug: code,
    ...(d.perDose !== undefined ? { perDose: d.perDose } : {}),
    ...(d.timesPerDay !== undefined ? { timesPerDay: d.timesPerDay } : {}),
    ...(d.days !== undefined ? { days: d.days } : {}),
    ...over,
  };
}
```

Nhờ đó mọi ô "Đơn thuốc" trong bảng 7.1, 7.2, 8.1, 8.2 đọc được **nguyên văn** thành lời gọi:
`line('AMLODIPIN-5-MG')`, `line('OMEPRAZOL-20-MG', { days: 5 })`, `line('CETIRIZIN-10-MG', { days: 14 })` —
chú thích "(N ngày)" trong bảng chính là `{ days: N }`, phần còn lại lấy từ `defaults`.

- Thuốc có `defaults` đủ (`perDose + timesPerDay + days`) → `line('MÃ')` là đủ: hàm trên lấy cả ba
  trường từ `defaults` rồi `resolveLine` sinh cách dùng + số lượng. Áp dụng cho phần lớn thuốc người lớn.
- Thuốc `asNeeded` (PARACETAMOL-500-MG, PARACETAMOL-150/250-MG-GOI, ORESOL, SALBUTAMOL bình xịt) →
  bắt buộc `perDose` + `quantity` + `instruction` viết tay (vì `asNeeded` không có `timesPerDay`, và
  nhiều loại là `manualQuantity`). Mẫu:
  - `line('PARACETAMOL-500-MG', { perDose: 1, quantity: 10, instruction: 'Uống 1 viên mỗi lần khi sốt hoặc đau, cách nhau ít nhất 4–6 giờ, tối đa 4 viên/ngày' })`
  - `line('PARACETAMOL-150-MG-GOI', { perDose: 1, quantity: 6, instruction: 'Uống 1 gói mỗi lần khi sốt trên 38,5 độ, cách nhau ít nhất 4–6 giờ' })`
  - `line('PARACETAMOL-250-MG-GOI', { … quantity: 8 … })` — như trên
  - `line('ORESOL-MUOI-BU-NUOC', { perDose: 1, quantity: 10, instruction: 'Pha 1 gói với lượng nước theo hướng dẫn trên gói, uống sau mỗi lần đi ngoài phân lỏng' })`
  - `line('SALBUTAMOL-100-MCG-LIEU-BINH-XIT', { perDose: 2, quantity: 1, instruction: 'Xịt 2 nhát khi khó thở, tối đa 4 lần/ngày' })`
- Thuốc dạng trẻ em để trống `perDose` trong danh mục (AMOXICILLIN-250-MG-GOI, CEFIXIM-100-MG-GOI,
  RACECADOTRIL-30-MG-GOI, KEM-10-MG) → `line('MÃ', { perDose: 1 })`; `timesPerDay`/`days` đã được hàm
  lấy từ `defaults`, số lượng tự tính `perDose × timesPerDay × days`.
- Thuốc `manualQuantity` không có liều (kem, gel, nhỏ mắt/mũi/tai, siro) → bắt buộc `quantity` +
  `instruction`. Mẫu: `NATRI-CLORID-0-9-NHO-MUI` `{ quantity: 1, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' }`;
  `SALBUTAMOL-2-MG-5-ML-SIRO` `{ quantity: 1, instruction: 'Uống 5 ml mỗi lần khi ho, khó thở, tối đa 3 lần/ngày' }`;
  `VITAMIN-D3-400-IU-GIOT` `{ quantity: 1, instruction: 'Nhỏ 1 giọt vào miệng mỗi ngày, buổi sáng' }`;
  `TOBRAMYCIN-0-3-NHO-MAT` / `NATRI-CLORID-0-9-NHO-MAT` `{ quantity: 1, instruction: 'Nhỏ 1 giọt mỗi mắt, 4 lần/ngày' }`;
  các loại kem/gel `{ quantity: 1, instruction: 'Bôi lớp mỏng lên vùng da bệnh, 2 lần/ngày' }`.
- `days` không được vượt `maxDays` của bộ quy tắc: 30 ngày với bệnh thường, 90 ngày nếu chẩn đoán có
  cờ `chronic` (I10, E11.9, E78.5, M10.9, M17.9, J45.9, Z76.0…). Mọi dòng trong hai bảng trên đều ≤ 30
  ngày nên luôn hợp lệ.
- Trẻ dưới 6 tuổi (BN nhi idx 0, 7, 9): chỉ dùng dạng gói/siro/giọt hoặc thuốc có cờ `paediatric`
  (KEM-10-MG có cờ này) — tránh phát sinh cảnh báo `paediatric-form` khi bác sĩ bấm "kê lại".

### 7.4 `reason` / `symptoms` / `findings` / **`advice`** — bảng tra `NARRATIVE`, chốt từng mã

Bốn trường chữ của lượt khám **không** phải trường khai báo của `StoryVisit` (mục 4.1) mà được dẫn xuất
từ bảng tra dưới đây. Lý do đưa cả `advice` (lời dặn) vào đây là review finding 2: khi `advice?` còn là
trường tùy chọn, người code có thể để trống cả **54 lượt lịch sử + 4 lượt `done`** mà vẫn "đúng thiết
kế" và vẫn qua pre-flight, trong khi yêu cầu gốc
đòi "đơn thuốc nhiều dòng với thuốc có thật trong catalog, **lời dặn**" và 4 lượt đang có trong seed
hiện tại đều **có** lời dặn. Nay không còn chỗ để bỏ trống.

**`advice` đi vào đâu trong FHIR** (đã đọc mã, không suy đoán): `advice` là trường của
`PrescriptionToSign` (`packages/clinical/src/visit.ts`), `planCompletion` ghi nó thành
`List.note[0].text` và `followUpDays` thành `extension[EXTENSIONS.followUpDays].valueInteger`; đường đọc
`toPrescriptionSummary` trả chúng về `PrescriptionSummary.advice` / `.followUpDays`, là chỗ giao diện in
trên đơn và hiện ở "Lịch sử khám". Hệ quả: **lời dặn chỉ được lưu khi lượt có đơn thuốc.** Mọi lượt
trong bảng 7.1/7.2/8.1/8.2 đều có đơn, nên không có lượt nào mất lời dặn; `validateScenario` chốt điều
này thành một quy tắc (mục 12.1) để lần sau ai thêm một lượt "chỉ khám, không kê" sẽ thấy lỗi rõ.

```ts
interface Narrative { reason: string; symptoms: string; findings: string; advice: string; followUpDays?: number }

/**
 * Bảng tra: CHUYÊN KHOA → mã ICD-10 chính của lượt → danh sách biến thể.
 * Tách theo chuyên khoa vì cùng một mã có bộ chữ khác nhau ở người lớn và ở trẻ em (J02.9, J06.9,
 * J30.4, J45.9, A09 đều dùng cho cả hai phòng): dùng chung một bộ sẽ cho ra bệnh án nhi mang câu khám
 * của người lớn.
 * Nhiều biến thể vì mã dùng lại nhiều lần (I10 làm mã chính 10 lần, trong đó 6 lần cho CÙNG một bệnh
 * nhân — review finding 7): một bộ chữ duy nhất làm màn "Lịch sử khám" của chính ca trình diễn trông
 * như copy-paste.
 */
const NARRATIVE: Record<'noi' | 'nhi', Record<string, Narrative[]>> = { noi: { … }, nhi: { … } };

/** Chọn biến thể theo chỉ số lượt: xác định, chạy lại ra cùng kết quả, và kiểm được bằng tay. */
function narrative(specialty: 'noi' | 'nhi', dx: string[], index: number): Narrative {
  const variants = NARRATIVE[specialty][dx[0]!];
  if (!variants?.length) throw new Error(`Chưa có bộ chữ mẫu cho mã ${dx[0]} (${specialty})`); // validateScenario bắt trước
  const n = variants[index % variants.length]!;
  // Z76.0 (cấp lại đơn) KHÔNG bao giờ là mã đầu tiên; nó chỉ thêm hậu tố vào lý do khám.
  return dx.includes('Z76.0') ? { ...n, reason: `${n.reason}, xin cấp lại đơn` } : n;
}
```

`index` là chỉ số của lượt trong mảng của chính nó (`visits` hoặc `today`), nên bộ chữ của một lượt
đổi khi mảng được xếp lại — không sao, vì nó chỉ là chữ, không phải khóa. Kiểm tra bằng tay: 8 lượt
I10 của phòng Nội nằm ở idx 9, 16, 24, 25, 26, 29, 30, 32 ⇒ `index % 3` = 0, 1, 0, 1, 2, 2, 0, 2 ⇒ ba
biến thể đều xuất hiện và sáu lượt của bệnh nhân idx 10 (24, 25, 26, 29, 30, 32) nhận 0, 1, 2, 2, 0, 2.

#### 7.4.1 Bảng `NARRATIVE.noi` — 21 mã, 27 biến thể

Cột "TK" = `followUpDays` (để trống = không ghi). Mọi `advice` ≤ 300 ký tự, `reason` ≤ 300 ký tự (trần
thật của `completeBody.exam.reason` trong `services/bff/src/routes/clinical.ts` là 300; trần của
`prescription.advice` là **1000** — thiết kế tự chốt 300 cho gọn tờ đơn, chặt hơn trần của tuyến API).

| Mã | # | `reason` | `symptoms` | `findings` | `advice` | TK |
|---|---|---|---|---|---|---|
| I10 | 0 | Tái khám huyết áp | Không đau đầu, không chóng mặt; uống thuốc đều | Tim đều, không tiếng thổi; phổi trong, không phù | Uống thuốc đều mỗi sáng, giảm muối dưới 5 g/ngày, đo huyết áp tại nhà 2 lần/tuần và ghi lại. | 30 |
| I10 | 1 | Tái khám huyết áp định kỳ | Thỉnh thoảng nặng đầu buổi chiều, ngủ kém | Tim đều, mạch rõ hai bên; không phù chi dưới | Duy trì thuốc, đi bộ 30 phút mỗi ngày, hạn chế rượu bia. Mang sổ đo huyết áp lần sau. | 30 |
| I10 | 2 | Hết thuốc huyết áp, xin khám lại | Không triệu chứng; đã hết thuốc 3 ngày | Tim đều, phổi trong; cân nặng không đổi | Không tự bỏ thuốc khi thấy huyết áp bình thường; tái khám trước khi hết thuốc. | 30 |
| E11.9 | 0 | Tái khám đái tháo đường | Khát nước ít hơn, không hạ đường huyết; ăn theo chế độ | Không loét bàn chân, mạch mu chân rõ hai bên | Uống metformin sau ăn, thử đường huyết đói mỗi tuần, khám mắt và bàn chân mỗi năm. | 30 |
| E78.5 | 0 | Tái khám rối loạn lipid máu | Không đau cơ, không mệt khi dùng thuốc | Không u mỡ dưới da, gan không to | Uống statin buổi tối, giảm mỡ động vật và nội tạng, tập thể dục 150 phút mỗi tuần. | 90 |
| E78.5 | 1 | Khám lại mỡ máu và gút | Không đau khớp đợt này; ăn nhiều đạm dịp lễ | Khớp bàn ngón chân không sưng nóng | Hạn chế bia, thịt đỏ và hải sản; uống đủ 2 lít nước mỗi ngày. | 90 |
| M10.9 | 0 | Đau sưng khớp bàn ngón chân | Đau dữ dội về đêm, sưng đỏ ngón chân cái 2 ngày | Khớp bàn ngón I sưng nóng đỏ, hạn chế vận động | Nghỉ, kê cao chân, chườm mát; tránh bia và hải sản. Khám lại nếu đau quá 3 ngày. | 7 |
| J02.9 | 0 | Đau họng, sốt 2 ngày | Đau rát họng khi nuốt, sốt về chiều | Họng đỏ, amidan không mủ; hạch góc hàm nhỏ | Uống nhiều nước ấm, nghỉ ngơi. Tái khám nếu sốt quá 3 ngày hoặc khó thở. | |
| J01.9 | 0 | Ngạt mũi, đau vùng mặt 5 ngày | Chảy mũi đặc, đau nặng vùng gò má, giảm mùi | Ấn đau điểm xoang hàm hai bên, niêm mạc mũi phù nề | Rửa mũi bằng nước muối 3 lần/ngày; uống hết kháng sinh dù đã đỡ. | 7 |
| J06.9 | 0 | Sổ mũi, ho 3 ngày | Sổ mũi, ho khan, người gai lạnh | Họng hơi đỏ, phổi thông khí đều hai bên | Giữ ấm, uống nhiều nước. Tái khám nếu sốt cao hoặc ho nhiều hơn. | |
| J30.4 | 0 | Hắt hơi, ngạt mũi từng cơn | Hắt hơi buổi sáng, chảy mũi trong, ngứa mắt | Niêm mạc mũi nhợt, phù nề; không mủ | Tránh bụi và phấn hoa, giặt vỏ gối hằng tuần, dùng thuốc đủ đợt. | 14 |
| J30.4 | 1 | Viêm mũi dị ứng tái phát | Ngạt mũi về đêm, ngủ không sâu, ho húng hắng | Cuốn mũi dưới phù hai bên, không lệch vách ngăn | Rửa mũi nước muối trước khi ngủ, không nằm điều hòa dưới 26 độ. | 14 |
| J30.4 | 2 | Ngứa mũi, chảy nước mũi khi đổi thời tiết | Hắt hơi thành cơn, mất ngủ nhẹ | Niêm mạc mũi nhợt hai bên, không hạch | Giữ ấm khi ra ngoài sáng sớm; dùng thuốc đúng liều, không tự tăng liều. | 14 |
| J45.9 | 0 | Khó thở khi gắng sức, ho đêm | Ho về đêm, khò khè khi leo cầu thang | Phổi ran rít rải rác hai bên, không co kéo | Mang theo thuốc cắt cơn và xịt đúng kỹ thuật; tránh khói thuốc, bụi. | 30 |
| K30 | 0 | Đầy bụng, khó tiêu sau ăn | Đầy hơi, ợ hơi, nhanh no; không sụt cân | Bụng mềm, không điểm đau khu trú | Ăn chậm, chia nhỏ bữa, tránh rượu bia và đồ chiên. Khám lại nếu sụt cân hoặc nôn. | 14 |
| K21.9 | 0 | Nóng rát sau xương ức, ợ chua | Ợ chua về đêm, rát sau xương ức sau ăn | Bụng mềm, ấn đau nhẹ thượng vị | Uống thuốc trước ăn 30 phút, không ăn trong 3 giờ trước khi ngủ, gối cao đầu. | 14 |
| K29.7 | 0 | Đau thượng vị kéo dài | Đau âm ỉ thượng vị, đỡ sau ăn; không nôn ra máu | Ấn đau thượng vị, gan lách không to | Ăn đúng giờ, bỏ rượu bia, tránh thuốc giảm đau NSAID. Khám lại nếu đau tăng. | 14 |
| A09 | 0 | Đi ngoài phân lỏng 2 ngày | Đi ngoài 4–5 lần/ngày, đau quặn bụng, không sốt cao | Bụng mềm, không phản ứng thành bụng; không dấu mất nước | Uống oresol sau mỗi lần đi ngoài, ăn cháo loãng. Khám ngay nếu phân có máu. | 3 |
| M54.2 | 0 | Đau mỏi vai cổ | Đau mỏi vai cổ lan xuống bả vai, tăng khi ngồi lâu | Co cứng cơ thang hai bên, không yếu chi | Đổi tư thế mỗi 45 phút, tập giãn cổ; uống thuốc dạ dày cùng thuốc giảm đau. | 14 |
| M54.5 | 0 | Đau vùng thắt lưng | Đau thắt lưng sau khi bê nặng, không tê chân | Ấn đau cạnh sống L4–L5, nghiệm pháp Lasegue âm tính | Tránh bê nặng và cúi gập người; chườm ấm, đi lại nhẹ. Khám lại nếu tê hoặc yếu chân. | 10 |
| M17.9 | 0 | Đau khớp gối hai bên | Đau khi lên xuống cầu thang, cứng khớp buổi sáng | Khớp gối lục cục khi vận động, không sưng nóng | Giảm cân, tránh ngồi xổm và leo cầu thang nhiều; tập cơ đùi mỗi ngày. | 30 |
| M17.9 | 1 | Khám lại khớp gối | Đau giảm hơn lần trước, đi bộ được 15 phút | Gối không tràn dịch, biên độ gấp hạn chế nhẹ | Duy trì bài tập cơ đùi; dùng thuốc giảm đau khi cần, uống kèm thuốc dạ dày. | 30 |
| G43.9 | 0 | Đau nửa đầu từng cơn | Đau nửa đầu mạch đập, sợ sáng, buồn nôn | Không dấu thần kinh khu trú, đáy mắt không phù gai | Ngủ đủ giờ, tránh bỏ bữa và ánh sáng chói; ghi sổ các cơn đau để lần sau xem. | 30 |
| N39.0 | 0 | Đi tiểu buốt, tiểu nhiều lần | Tiểu buốt, tiểu gấp, không sốt rét run | Không đau hố thận, ấn đau nhẹ hạ vị | Uống 2 lít nước mỗi ngày, uống hết kháng sinh. Khám ngay nếu sốt hoặc đau lưng. | 7 |
| N30.0 | 0 | Tiểu buốt một ngày nay | Tiểu buốt cuối bãi, nước tiểu đục | Ấn đau hạ vị, không đau hố thận | Uống nhiều nước, không nhịn tiểu. Khám lại nếu còn buốt sau 3 ngày. | 5 |
| L70.0 | 0 | Mụn vùng mặt nhiều lên | Mụn viêm hai bên má và trán, nặng hơn khi thức khuya | Nhiều sẩn viêm và mụn đầu đen vùng chữ T, không sẹo lồi | Rửa mặt dịu nhẹ 2 lần/ngày, bôi đúng vùng, tránh nắng; thuốc uống sau ăn. | 30 |
| L50.9 | 0 | Nổi mày đay toàn thân | Sẩn phù ngứa nhiều về đêm, không khó thở | Sẩn phù rải rác thân mình, không phù môi mắt | Tránh thức ăn lạ và thuốc giảm đau NSAID. Đi cấp cứu nếu sưng môi, khó thở. | 7 |

#### 7.4.2 Bảng `NARRATIVE.nhi` — 20 mã, 23 biến thể

| Mã | # | `reason` | `symptoms` | `findings` | `advice` | TK |
|---|---|---|---|---|---|---|
| B34.9 | 0 | Sốt 2 ngày, ho | Sốt 38–38,5 độ, ho khan, ăn kém hơn | Họng đỏ nhẹ, phổi không ran, không ban | Hạ sốt khi trên 38,5 độ, uống nhiều nước. Khám lại nếu sốt quá 3 ngày hoặc thở nhanh. | 3 |
| A09 | 0 | Đi ngoài phân lỏng 2 ngày | Đi ngoài 5–6 lần/ngày, nôn 1 lần, trẻ vẫn chơi | Môi còn ướt, mắt không trũng; bụng mềm | Pha oresol đúng tỷ lệ, cho uống sau mỗi lần đi ngoài; vẫn cho ăn, không bỏ bữa. | 2 |
| A09 | 1 | Tiêu chảy, đau bụng | Phân lỏng nhiều nước, đau quặn từng cơn, không sốt cao | Không dấu mất nước, bụng không chướng | Uống oresol, tránh nước ngọt có ga. Khám ngay nếu nôn liên tục hoặc đi tiểu ít. | 2 |
| A09 | 2 | Đi ngoài nhiều lần từ hôm qua | Phân lỏng 4 lần, trẻ còn ăn uống được | Trẻ tỉnh, da đàn hồi tốt, không sốt | Tiếp tục ăn uống bình thường kèm oresol; rửa tay trước khi cho trẻ ăn. | 2 |
| A08.4 | 0 | Nôn và đi ngoài từ tối qua | Nôn 3 lần, phân lỏng nhiều nước, sốt nhẹ | Không dấu mất nước, bụng mềm, không chướng | Cho uống oresol từng thìa nhỏ, chờ 10 phút sau nôn. Khám lại nếu nôn liên tục. | 2 |
| J02.9 | 0 | Đau họng, sốt | Đau họng khi ăn, sốt 38,5 độ, quấy | Họng đỏ, amidan to không mủ; hạch cổ nhỏ | Uống hết kháng sinh dù đã đỡ; cho ăn mềm, uống nhiều nước. | 3 |
| J03.9 | 0 | Sốt cao, đau họng 2 ngày | Sốt 39 độ, đau họng nhiều, ăn kém | Amidan to đỏ, có mủ trắng; hạch góc hàm đau | Uống kháng sinh đủ 7 ngày, hạ sốt khi trên 38,5 độ. Khám lại nếu sau 48 giờ chưa hạ sốt. | 3 |
| J03.9 | 1 | Viêm amidan tái phát | Đau họng, hơi thở nặng mùi, ngủ ngáy | Amidan quá phát hai bên, không nhiều mủ | Uống đủ đợt kháng sinh; ghi lại số đợt viêm trong năm để bác sĩ xem xét. | 7 |
| J00 | 0 | Chảy mũi, ho nhẹ | Chảy mũi trong, ho húng hắng, không sốt | Niêm mạc mũi nề nhẹ, phổi trong | Nhỏ nước muối và hút mũi trước khi ăn và khi ngủ. Không cần kháng sinh. | |
| J06.9 | 0 | Ho, sổ mũi 3 ngày | Ho, sổ mũi, sốt nhẹ, ăn kém hơn | Họng đỏ, phổi không ran, không co kéo | Cho trẻ uống nhiều nước, hạ sốt khi trên 38,5 độ. Khám lại nếu thở nhanh hoặc bỏ bú. | 3 |
| J20.9 | 0 | Ho nhiều 4 ngày | Ho có đờm, ho nhiều về đêm, không khó thở | Phổi ran ẩm rải rác, không rút lõm lồng ngực | Vỗ rung nhẹ sau khi dậy, uống nhiều nước ấm. Khám ngay nếu thở nhanh hoặc tím môi. | 3 |
| J05.0 | 0 | Khàn tiếng, ho ông ổng về đêm | Ho như tiếng sủa, khàn tiếng, thở rít khi quấy | Thở rít thanh quản khi gắng sức, không rút lõm lúc nghỉ | Giữ không khí ẩm, đừng để trẻ quấy khóc nhiều. Đi cấp cứu nếu thở rít lúc nằm yên. | 2 |
| J30.4 | 0 | Hắt hơi, ngạt mũi buổi sáng | Hắt hơi từng cơn, chảy mũi trong, ngứa mắt | Niêm mạc mũi nhợt, phù nề hai bên | Rửa mũi nước muối hằng ngày, giặt vỏ gối mỗi tuần, tránh thú nhồi bông. | 14 |
| J45.9 | 0 | Khám lại hen, ho đêm | Ho về đêm, khò khè khi chạy nhảy | Phổi ran rít nhẹ hai bên, không co kéo | Dùng thuốc phòng mỗi ngày dù không có cơn; mang thuốc cắt cơn khi đi học. | 30 |
| R50.9 | 0 | Sốt một ngày, chưa rõ nguyên nhân | Sốt 38,8 độ, không ho, không đi ngoài lỏng | Họng không đỏ, phổi trong, không ban, không cứng cổ | Theo dõi sát, hạ sốt và bù nước. Khám lại trong 24 giờ nếu còn sốt hoặc nổi ban. | 1 |
| K59.0 | 0 | Đi ngoài khó, 3 ngày một lần | Phân khô cứng, đau khi đi, sợ đi ngoài | Bụng mềm, sờ thấy khối phân hố chậu trái | Tăng rau và nước, tập đi ngoài sau bữa sáng; không tự dùng thuốc nhuận kéo dài. | 14 |
| K00.7 | 0 | Quấy, chảy nước dãi nhiều | Quấy về đêm, hay cho tay vào miệng, ăn kém | Nướu vùng răng sắp mọc nề đỏ, không ổ mủ | Cho trẻ gặm vòng mát; hạ sốt khi trên 38,5 độ. Không bôi thuốc tê lên nướu. | |
| H10.9 | 0 | Mắt đỏ, nhiều dử | Mắt đỏ hai bên, dử dính mi buổi sáng, không đau nhức | Kết mạc cương tụ, giác mạc trong, không giảm thị lực | Lau mắt bằng gạc sạch riêng từng mắt, không dùng chung khăn; nghỉ học 3 ngày. | 3 |
| H66.9 | 0 | Đau tai, sốt sau đợt cảm | Đau tai phải, quấy đêm, nghe kém hơn | Màng nhĩ đỏ, phồng nhẹ, không chảy dịch | Uống đủ đợt kháng sinh, không nhỏ gì vào tai. Khám lại nếu tai chảy dịch. | 7 |
| B08.4 | 0 | Loét miệng, nổi ban tay chân | Ăn kém vì đau miệng, sốt nhẹ, ban ở tay chân | Vài nốt loét niêm mạc miệng, ban dạng nước lòng bàn tay chân | Cho ăn nguội và mềm, uống nhiều nước. Đi cấp cứu nếu giật mình chới với, nôn nhiều, sốt cao khó hạ. | 2 |
| L20.9 | 0 | Khô, ngứa da vùng khoeo | Ngứa nhiều về đêm, trẻ cào xước da | Da khô, mảng đỏ bong vảy vùng khoeo và khuỷu; không bội nhiễm | Dưỡng ẩm 2 lần/ngày sau tắm, tắm nước ấm vừa, mặc cotton; bôi thuốc đúng đợt. | 14 |
| D50.9 | 0 | Da xanh, hay mệt | Mệt khi chạy nhảy, ăn ít thịt, kém tập trung | Da lòng bàn tay nhợt, gan lách không to | Uống sắt lúc đói kèm nước cam, không uống cùng sữa; ăn thêm thịt đỏ và rau xanh. | 30 |
| E55.9 | 0 | Khám sức khỏe, ra mồ hôi đêm nhiều | Ra mồ hôi đầu khi ngủ, ngủ không sâu; ít ra nắng | Thóp đã kín, không biến dạng xương; cân nặng theo tuổi bình thường | Cho trẻ ra nắng sớm 15 phút mỗi ngày, nhỏ vitamin D đúng liều mỗi sáng. | 30 |

**Z76.0 không có dòng riêng** vì nó không bao giờ là mã đầu tiên: nó chỉ thêm hậu tố ", xin cấp lại
đơn" vào `reason` (xem hàm `narrative`). `validateScenario` báo lỗi nếu `dx[0] === 'Z76.0'`.

Bộ kiểm tra kịch bản (mục 12.1) báo lỗi nếu một mã ICD-10 làm mã đầu tiên của một lượt mà bảng của
đúng chuyên khoa đó chưa có dòng — đó là cách bảo đảm quy tắc được áp đủ, thay vì tin vào sự cẩn thận.

### 7.5 Sinh hiệu (`vitals`)

`cleanVitals` **không bắt buộc** trường nào: nó chỉ chặn số ngoài khoảng, và với huyết áp thì đòi có
**cả** tâm thu lẫn tâm trương, tâm thu > tâm trương. Quy tắc "trẻ < 12 tuổi phải có `weightKg`" là
quy tắc của `@phongmach/rules` với severity **`ack`** (nhắc, không chặn) và seed đi qua `store` nên
không chạy bộ quy tắc — nghĩa là ràng buộc dưới đây **chỉ tồn tại nếu bộ kiểm tra kịch bản tự áp**.
Thiết kế chọn áp, để demo không hiện câu nhắc "chưa có cân nặng" khi bác sĩ mở lại hồ sơ cũ.

Giá trị dùng cho từng lượt (bộ kiểm tra kịch bản soát đúng các khoảng này):

| Nhóm | Trường ghi | Giá trị / khoảng |
|---|---|---|
| Người lớn, bệnh thường | temperatureC, pulse, systolic, diastolic, weightKg | 36,4–38,8 °C; mạch 62–96; HA 108–132 / 68–84; cân 48–82 kg |
| Người lớn, THA/ĐTĐ (lượt có I10 hoặc E11.9 **ở bất kỳ vị trí** trong `dx`) | như trên | HA 135–158 / 85–96 (phù hợp chẩn đoán) |
| Trẻ em (mọi lượt phòng Nhi) | temperatureC, pulse, weightKg (seed **luôn ghi** weightKg) | cân theo tuổi: 3 t: 14; 4 t: 16; 5 t: 17,5; 6 t: 20; 7 t: 22; 8 t: 25; 10 t: 32 kg. Mạch 3–5 t: 100–120; 6–10 t: 84–104 |
| Trẻ em | **không ghi** systolic/diastolic | tránh làm nhiễu bảng sinh hiệu nhi; `cleanVitals` không đòi huyết áp nên bỏ trống là hợp lệ |

**Quy tắc chốt cho `respiratoryRate` và `spo2`** (thay cho câu "thường thêm…" mà review finding 8 nói
đúng là không kiểm được): quyết theo **mã đầu tiên** của `dx`, không theo cảm nhận.

| Điều kiện trên `dx[0]` | Phòng Nhi ghi | Phòng Nội ghi |
|---|---|---|
| Mã bắt đầu bằng `J` (hô hấp) hoặc `R50.9` (sốt) | **cả** `respiratoryRate` **và** `spo2` | chỉ `spo2` |
| Mọi mã khác | **không** ghi cả hai | không ghi cả hai |

Khoảng giá trị: nhịp thở 3–5 tuổi 24–30, 6–10 tuổi 18–24, người lớn không ghi; `spo2` 95–99 %.
Áp vào dữ liệu: phòng Nhi ghi hai trường này ở idx 2, 5, 6, 7, 8, 11, 12, 13, 15, 18 (và lượt `today`
idx 0, mã J06.9); phòng Nội ghi `spo2` ở idx 3, 6, 7, 14, 17, 20 và 28. `validateScenario` soát **đúng
chiều cả hai**: thiếu khi quy tắc đòi là lỗi, có khi quy tắc không đòi cũng là lỗi — nếu không, "quy
tắc" lại thành lời khuyên.

Mỗi lượt lấy một giá trị **cố định** trong khoảng (viết thẳng trong mảng, không sinh ngẫu nhiên) để
dữ liệu xác định và đối chiếu lại được.

## 8. Sân khấu sống của NGÀY SEED CHẠY (`today`)

Mục tiêu: khách vừa mở "Hàng chờ" và "Màn hình chờ" là thấy có người, có đủ các trạng thái; trang
"Thời gian khám" chọn "Hôm nay" cũng có số.

Mỗi dòng dưới đây là **một nhánh cụ thể** của union `TodayVisit` (mục 4.1): cột "Trạng thái" quyết định
dòng đó có những trường nào. `exam` (gồm `dx`, `lines`, `vitals`, `seconds`) chỉ có ở nhánh `done` và là
**bắt buộc** ở đó; `openedMinutesAgo` chỉ có ở nhánh `in-exam`; `doctor` không có ở nhánh `waiting`.

### 8.1 Phòng Nội tổng quát (6 lượt)

| idx | BN | `minutesAgo` | `priority` | `state` | `doctor` | `reason` (lý do đến) | `exam`: ICD-10 / đơn thuốc | `exam.seconds` |
|---|---|---|---|---|---|---|---|---|
| 0 | 10 Võ Thị Kim Chi | 55 | appointment | done | noi-doctor | Tái khám huyết áp và đường huyết | I10, E11.9, Z76.0 / AMLODIPIN-5-MG; METFORMIN-500-MG; ATORVASTATIN-20-MG | 57 |
| 1 | 0 Nguyễn Văn An | 40 | normal | done | noi-owner | Tái khám huyết áp | I10 / AMLODIPIN-5-MG | 110 |
| 2 | 3 Nguyen Van An | 22 | normal | **in-exam**, `openedMinutesAgo: 3` | noi-doctor | Ho, đau họng 2 ngày | — (nhánh `in-exam` không có `exam`; bác sĩ đang khám dở) | — |
| 3 | 6 Nguyễn Thị An | 15 | **appointment** | waiting | — | Đau vai cổ, đã hẹn sáng nay | — | — |
| 4 | 8 Trần Văn An | 9 | normal | waiting | — | Khó thở nhẹ khi gắng sức | — | — |
| 5 | 12 Đỗ Thị Hạnh | 4 | **urgent** | waiting | — | Đau ngực, mệt nhiều | — | — |

### 8.2 Phòng Nhi (6 lượt)

| idx | BN | `minutesAgo` | `priority` | `state` | `reason` (lý do đến) | `exam`: ICD-10 / đơn thuốc | `exam.seconds` |
|---|---|---|---|---|---|---|---|
| 0 | 1 Đặng Bảo Ngọc (2019) | 50 | appointment | done | Tái khám ho, sổ mũi | J06.9 / NATRI-CLORID-0-9-NHO-MUI; PARACETAMOL-250-MG-GOI | 78 |
| 1 | 9 Hoàng Gia Bảo | 35 | normal | done | Đi ngoài phân lỏng 2 ngày | A09 / ORESOL-MUOI-BU-NUOC; KEM-10-MG; MEN-VI-SINH-LACTOBACILLUS | 120 |
| 2 | 0 Lê Minh Khang (2021) | 18 | normal | **in-exam**, `openedMinutesAgo: 3` | Sốt 2 ngày, ho | — | — |
| 3 | 6 Lê Minh Khang (2016) | 12 | **appointment** | waiting | Khám lại hen, đã hẹn | — | — |
| 4 | 7 Phạm Bảo Ngọc | 6 | normal | waiting | Quấy, chảy nước mũi | — | — |
| 5 | 4 Nguyễn Vân Khanh | 3 | **urgent** | waiting | Sốt cao 39,5 độ, nôn | — | — |

`doctor` của hai lượt không-`waiting` phòng Nhi là `nhi-owner` (phòng chỉ có một bác sĩ).

**Mốc thời gian của ba nhánh** (áp dụng quy tắc chốt ở mục 4.2, viết ra đây để đối chiếu nhanh):

| Nhánh | `checkIn` | `openVisit` | `completeVisit` |
|---|---|---|---|
| `done` | `at = max(now − minutesAgo·60s, 00:05 VN)` | cùng `at` ⇒ `examOpened = at` | `now = at + exam.seconds·1000` ⇒ số đo = `exam.seconds` |
| `in-exam` | cùng `at` như trên | `now − openedMinutesAgo·60s` (= 3 phút trước) | **không gọi** |
| `waiting` | cùng `at` như trên | **không gọi** | **không gọi** |

`minutesAgo` của hai lượt `done` (55 và 40 phút) đều lớn hơn `seconds/60 + 1` (≈ 2 và 2,8 phút) nên giờ
ký luôn ở quá khứ — đó chính là quy tắc mà `validateScenario` kiểm (mục 12.1).

### 8.3 Hệ quả trên giao diện (không sửa UI, chỉ nêu để kiểm chứng)

- `GET /api/queue` trả 6 lượt mỗi phòng; `sortQueue` xếp: đang khám (1) → đang chờ theo thứ tự
  **urgent → appointment → normal** (3) → đã xong (2).
- `GET /api/display` (Màn hình chờ) có `inExam` 1 mục và `waiting` 3 mục ⇒ **không trống**.
- Phòng Nhi còn cho thấy hai cháu **trùng tên hoàn toàn** cùng xuất hiện trong hàng chờ (idx 0 đang
  khám, idx 6 đang chờ) — đúng tình huống phụ tá phải phân biệt bằng tuổi/điện thoại.
- Lượt `in-exam` do chính tài khoản demo chính (`noi-doctor`, `nhi-owner`) giữ, nên người trình diễn
  đăng nhập đúng tài khoản đó là khám tiếp được ngay (không bị "hồ sơ đang do người khác khám").
- Lượt `in-exam` nếu được ký trong lúc demo sẽ có thời lượng vài phút; vì p90 tính theo **hạng**
  (hạng 18/20) nên một giá trị lớn lọt vào cuối dãy không làm đổi p90.

## 9. Trang "Thời gian khám": p50/p90 ra số nào

`computeMetrics` dùng phân vị **hạng gần nhất** (`percentile`): p50 = phần tử thứ `ceil(0,5×n)`,
p90 = phần tử thứ `ceil(0,9×n)`. Phiên > 30 phút bị loại khỏi phân vị nhưng được đếm ở cột "Phiên bị
loại". Khoảng mặc định của trang là **14 ngày**.

Phòng Nội, khoảng 14 ngày: 19 lượt lịch sử (idx 3–21, `daysAgo` 1–13) trừ 1 lượt bị loại = 18, cộng
2 lượt `done` của hôm nay = **20 lượt tính số đo**, cộng 1 lượt bị loại (idx 21, 1920 giây):

```
sắp xếp: 38 41 44 47 50 52 54 56 57 58 61 64 70 76 84 92 104 110 116 148
p50 = phần tử thứ 10 = 58 giây   (≤ 60 → nhãn xanh)
p90 = phần tử thứ 18 = 110 giây  (≤ 120 → nhãn xanh)
BS. Lê Thị Thu Hà (noi-doctor), 12 lượt: p50 = 57, p90 = 116   (+1 phiên bị loại)
BS. Trần Quốc Hưng (noi-owner), 8 lượt:  p50 = 58, p90 = 110
```

Phòng Nhi, khoảng 14 ngày: 12 lượt lịch sử (idx 1–12) trừ 1 lượt bị loại (idx 11) = 11, cộng 2 lượt
`done` của hôm nay = **13 lượt**:

```
sắp xếp: 40 45 48 51 53 56 59 63 70 78 90 105 120
p50 = phần tử thứ 7  = 59 giây
p90 = phần tử thứ 12 = 105 giây
BS. Phạm Thanh Mai (nhi-owner): p50 = 59, p90 = 105 (+1 phiên bị loại)
```

Chọn "Hôm nay": phòng Nội p50 = 57 / p90 = 110; phòng Nhi p50 = 78 / p90 = 120. Chọn "30 ngày": thêm
idx 22–24 (Nội) và idx 13–15 (Nhi), `daysAgo` 20–30, nên con số nhúc nhích nhẹ, vẫn trong mục tiêu —
**nhưng** khoảng 30 ngày còn
chịu ảnh hưởng của 4 lượt khám cũ đã seed từ lần trước: mốc thời gian của chúng **cố định** tại thời
điểm seed lần đầu (không phải 45/40/35/30 ngày trước hôm nay), nên chúng đang hoặc sắp rơi ra ngoài
mọi khoảng. Khoảng 14 ngày — khoảng mặc định của trang và là khoảng dùng để kiểm chứng — **không** bị
ảnh hưởng vì 20 lượt của nó đều do thiết kế này tạo mới.

Hai điểm có chủ ý: (1) mỗi phòng có **đúng một** phiên bỏ dở > 30 phút để cột "Phiên bị loại" có số
khác 0 — minh họa đúng cách hệ thống không giấu dữ liệu; (2) không có lượt nào `source = client` nên
cột "Đo ở máy khám" và "Giờ không hợp lý" bằng 0 (seed không giả lập mất mạng; đó là việc của kịch bản
demo trực tiếp).

## 10. "Nhật ký truy cập" có nhiều dòng — bằng dòng THẬT, không bịa

Nhật ký do BFF ghi vào tệp NDJSON (`AUDIT_FILE`, mặc định `services/bff/.data/audit.ndjson`), **không**
nằm trong Medplum. Seed chạy ở container khác nên **không thể** và **không nên** ghi thẳng vào nhật ký:
bịa dòng nhật ký truy cập là làm giả bằng chứng kiểm toán, dù chỉ để demo.

Cơ chế thật đã có sẵn và đủ: mỗi đơn thuốc seed tạo ra sinh một `Task` gửi cổng liên thông đến hạn ngay.
Khi container `web` khởi động, `startOutboxWorker` (20 việc mỗi 2 giây) gửi hết và **ghi một dòng nhật
ký `gateway-send` cho mỗi lần gửi** (`services/bff/src/outbox.ts`, vai `system`, tên "Hộp thư đi").
Với thiết kế này: phòng Nội ~35 đơn, phòng Nhi ~23 đơn ⇒ **~35 và ~23 dòng nhật ký thật** chỉ sau vài
giây web chạy, chưa tính dòng `login`, `search`, `queue-read`, `metrics-read` phát sinh khi người dùng
bấm. Trang Nhật ký lấy 50 dòng mới nhất ⇒ đầy trang.

Một bổ sung **một dòng** trong compose để số dòng này không mất khi container web được dựng lại:

```yaml
AUDIT_FILE: /demo/audit.ndjson     # trong service `web`
```

`/demo` là volume `demo-tenants` đã mount sẵn ở cả hai service. Lý do: nhật ký nằm trong lớp ghi của
container sẽ mất mỗi lần `up --build`, và các `Task` đã gửi xong không gửi lại nên nhật ký sẽ trắng lại
— đúng về mặt dữ liệu nhưng làm màn Nhật ký trống khi demo. Nhật ký theo thiết kế **không chứa dữ liệu
bệnh nhân** (chỉ loại truy vấn, số kết quả, id tài nguyên) nên đưa ra volume không làm lộ thêm gì; tệp
vẫn chỉ nằm trong volume Docker, không vào repo.

Ghi nhận thật thà trong tài liệu kiểm chứng: sau khi hộp thư đi gửi xong, màn "Liên thông" (đơn chờ
gửi) **trống**, vì `pendingPrescriptions` chỉ lấy `Task` ở trạng thái `requested/on-hold/in-progress/
failed`. Đó là hành vi đúng; màn này đầy lên khi bác sĩ ký đơn mới trong lúc demo (và có thể dùng công
tắc mô phỏng lỗi cổng để cho thấy đường thất bại — không thuộc phạm vi seed).

## 11. Thay đổi `infra/demo/docker-compose.yml`

Chỉ **hai** dòng (một dòng sửa, một dòng thêm), không thêm/bớt service, không đụng cấu hình mạng:

```yaml
  seed:
    environment:
      SEED_PATIENTS: "${SEED_PATIENTS:-300}"     # thay cho "20"
  web:
    environment:
      AUDIT_FILE: /demo/audit.ndjson             # thêm: nhật ký sống qua các lần dựng lại container
```

Không đổi: `MEDPLUM_URL: http://host.docker.internal:8103` (nối vào Medplum ĐANG CHẠY, không định nghĩa
lại backend), `restart: "no"` của `seed`, `depends_on: seed: service_completed_successfully` của `web`,
cổng `8081:80`, `SESSION_SECRET` cố định cho demo, healthcheck.

Hệ quả cần ghi trong README bằng lời (không bắt buộc sửa tệp): muốn dựng lại sân khấu "hôm nay" cho một
ngày mới, chạy lại `docker compose -p phongmach-demo -f infra/demo/docker-compose.yml up -d` (seed chạy
lại, tạo hàng chờ của ngày mới, không tạo trùng dữ liệu cũ).

## 12. Kiểm tra đầu vào và xử lý lỗi — cụ thể từng phép có thể hỏng

### 12.1 Kiểm tra trước khi ghi (pre-flight), chạy đầu `main()`

Hàm `validateScenario(): string[]` (thuần, không gọi mạng) soát toàn bộ `CLINICS` và trả về danh sách
lỗi. Có lỗi → in từng dòng ra `stderr` và `process.exit(1)` **trước khi** kết nối Medplum. Lý do: một ký
tự sai trong mã thuốc hiện tại chỉ lộ ra sau 4 phút seed, giữa lúc đã ghi nửa dữ liệu.

Cột **"Áp dụng cho"** là phần sửa theo review finding 3: các quy tắc về `dx/lines/vitals/seconds` chỉ áp
cho lượt **có khám**, nếu áp nguyên văn vào mọi mục của `today` thì chính 6 lượt `waiting` và 2 lượt
`in-exam` của thiết kế bị bộ kiểm tra từ chối. Viết tắt: **SV** = `StoryVisit` (mảng `visits`),
**T:done / T:in-exam / T:waiting** = ba nhánh của `today`.

| Dữ liệu vào | Áp dụng cho | Bắt buộc? | Kiểu / giới hạn | Hỏng thì sao |
|---|---|---|---|---|
| `drug` của mọi dòng thuốc | SV, T:done | bắt buộc | phải có trong `DRUGS` (`getDrug`) | lỗi: `"nhi/visit 7 dòng 1: thuốc không có trong danh mục: X"` |
| liều/số lượng mỗi dòng | SV, T:done | bắt buộc | `resolveLine` phải cho `instruction` khác rỗng và (nếu không `manualQuantity`) `quantity` xác định | lỗi: `"… dòng 2: thiếu liều hoặc số lượng (cách dùng rỗng)"` |
| `lines` | SV, T:done | bắt buộc, ≥ 1 dòng | ≤ 20 dòng (trần của tuyến API) | lỗi: `"… không có dòng thuốc nào — lời dặn sẽ không được lưu"` (xem mục 7.4) |
| `days` của một dòng | SV, T:done | tùy chọn | ≤ 30, hoặc ≤ 90 nếu một chẩn đoán của lượt có `chronic` | lỗi nêu rõ số ngày và trần |
| `dx` | SV, T:done | bắt buộc, ≥ 1 mã | mọi mã phải có trong `ICD10` (`getIcd10`); `dx[0] !== 'Z76.0'` | lỗi: `"… mã ICD-10 không có trong danh mục: X"` / `"… Z76.0 không được là mã đầu tiên"` |
| `NARRATIVE[specialty][dx[0]]` | SV, T:done | bắt buộc | phải có ≥ 1 biến thể cho **đúng chuyên khoa** của phòng khám (mục 7.4) | lỗi: `"noi-tong-quat/visit 12: chưa có bộ chữ mẫu cho mã K30 (noi)"` |
| `advice` dẫn xuất | SV, T:done | **bắt buộc** | chuỗi khác rỗng sau `trim()`, ≤ 300 ký tự | lỗi: `"noi-tong-quat/visit 12: thiếu lời dặn"` |
| `followUpDays` dẫn xuất | SV, T:done | tùy chọn | nếu có thì số nguyên 1…365 (khớp `completeBody.prescription.followUpDays`) | lỗi nêu giá trị và khoảng |
| `reason` dẫn xuất | SV, T:done | bắt buộc | khác rỗng, ≤ 300 ký tự (trần `completeBody.exam.reason`) | lỗi |
| `seconds` | SV, T:done | tùy chọn (mặc định 75) | số nguyên 1…3600 | lỗi |
| `vitals` | SV, T:done | bắt buộc | gọi thử `cleanVitals` → bắt `DomainError`; **cộng ràng buộc riêng của seed**: trẻ < 12 tuổi phải có `weightKg`; trẻ không được có huyết áp; `respiratoryRate`/`spo2` có mặt **đúng và chỉ đúng** khi quy tắc mục 7.5 đòi | lỗi kèm thông điệp của `cleanVitals`, hoặc `"nhi/visit 3: mã K59.0 không phải hô hấp nhưng có spo2"` |
| `exam` | **T:done** | bắt buộc | trình biên dịch đã bắt (nhánh `done` của union, mục 4.1); pre-flight chỉ còn soát nội dung | — (không còn đường để thiếu) |
| `doctor` | SV, T:done, T:in-exam | bắt buộc | phải khớp một `users[].id` của chính phòng khám và người đó phải có `practitioner: true` | lỗi: `"… bác sĩ 'x' không có trong danh sách người dùng của phòng khám"` |
| `openedMinutesAgo` | **T:in-exam** | tùy chọn (mặc định `⌈minutesAgo/2⌉`) | 1 … `minutesAgo` | lỗi: `"… mở hồ sơ trước cả giờ đến"`. Ở nhánh khác trường này **không tồn tại** nên không cần luật |
| `patient` (chỉ số) | SV, mọi nhánh `today` | bắt buộc | `0 ≤ patient < story.length` | lỗi: `"… trỏ tới bệnh nhân không tồn tại"` |
| `minutesAgo` | mọi nhánh `today` | bắt buộc | 1…600; với T:done thêm điều kiện `minutesAgo > seconds/60 + 1` | lỗi: `"… giờ ký sẽ ở tương lai"` |
| `priority` | mọi nhánh `today` | bắt buộc | thuộc `PRIORITIES` = `normal \| appointment \| urgent` | lỗi |
| `reason` khai báo tay | mọi nhánh `today` | bắt buộc | khác rỗng, ≤ 200 ký tự (trần `checkInBody.reason`) | lỗi |
| `specialty` | SV | bắt buộc | `'noi'` nếu `kind === 'adult'`, `'nhi'` nếu `pediatric` | lỗi |
| tuổi so với chẩn đoán | SV, T:done | — | phòng Nhi: bệnh nhân < 14 tuổi; phòng Nội: ≥ 18 tuổi (xem hàng `birthDate`) | lỗi |
| `PATIENTS_PER_CLINIC` vs `story.length` | cả phòng khám | — | nếu `SEED_PATIENTS` nhỏ hơn số ca kịch bản thì `generatePatients` (`while (out.length < count)`) vẫn tạo đủ `story.length` người | **cảnh báo** (không chặn): `"SEED_PATIENTS=10 nhỏ hơn 15 ca kịch bản — sẽ tạo 15 bệnh nhân"` |
| `story[].phone` | `story` | bắt buộc | `normalizePhone` phải nhận; không trùng nhau trong cùng phòng khám | lỗi |
| `story[].cccd` | `story` | bắt buộc nếu ≥ 14 tuổi, cấm nếu < 14 | 12 chữ số, bắt đầu `000`, không trùng | lỗi |
| `story[].fullName` | `story` | bắt buộc | `parseFullName` phải nhận (≥ 2 từ) | lỗi |
| `story[].birthDate` | `story` | bắt buộc | `YYYY-MM-DD`, không ở tương lai; tuổi khớp `kind` (nhi < 14, người lớn ≥ 18) | lỗi |
| `allergies[].value` | `allergies` | bắt buộc | `kind: 'class'` ⇒ có trong `ALLERGY_CLASSES`; `kind: 'ingredient'` ⇒ có trong `INGREDIENTS` | lỗi |
| nhất quán dị ứng ↔ đơn | SV, T:done | — | không dòng thuốc nào của bệnh nhân xung đột với dị ứng của chính người đó, theo đúng ngữ nghĩa `checkPrescription` (`class` → `drug.classes`, `ingredient` → `drug.ingredients`) — mục 6 | lỗi: `"nhi/visit 16 dòng 1: AMOXICILLIN-250-MG-GOI xung đột dị ứng 'amoxicillin' của bệnh nhân 2"` |
| `history[].text` | `history` | bắt buộc | khác rỗng, ≤ 300 ký tự (trần `historyBody.text`) | lỗi |
| khóa `stableUuid` | tất cả | — | tập khóa sinh ra phải không trùng nhau | lỗi: `"khóa demo bị trùng: …"` |

Chạy riêng được: `SEED_DRY_RUN=1` → chỉ chạy `validateScenario()`, in thống kê một dòng mỗi phòng
(`noi-tong-quat: 15 bệnh nhân kịch bản, 35 lượt khám cũ, 6 lượt hôm nay, 11 dị ứng, 12 tiền sử` và
`nhi: 11 bệnh nhân kịch bản, 23 lượt khám cũ, 6 lượt hôm nay, 7 dị ứng, 8 tiền sử`) rồi `exit 0`,
**không kết nối Medplum**. Hai dòng này cũng là cách nhận ra image đã được build lại hay chưa
(mục 15). Đây là cách kiểm thử nhanh duy nhất có được trong phạm vi cho phép (xem mục 14).

### 12.2 Lỗi khi ghi

| Phép | Điều kiện hỏng | Chữa được? | Người gọi nhận gì | Ghi log |
|---|---|---|---|---|
| Đăng nhập siêu quản trị (`adminClient`) | Medplum chưa chạy / không tới được `http://host.docker.internal:8103`, sai mật khẩu | không | thoát mã 1 kèm thông điệp sẵn có | `console.error` một dòng |
| `createTenantProject` | lỗi HTTP | không | thoát mã 1 | một dòng |
| `executeBatch` tạo bệnh nhân | phần tử 429 (hạn mức) | **có** | chờ 15 giây, gửi lại đúng các phần tử bị từ chối, tối đa 8 lượt (mã hiện có) | `"hạn mức FHIR: chờ 15s rồi gửi lại N phần tử"` |
| `executeBatch` tạo bệnh nhân | phần tử lỗi khác (4xx/5xx) | không | `throw` → thoát mã 1 | thông điệp có mã trạng thái |
| `backfillSearchKeys` | 429 / 412 / xung đột giao dịch | **có** | đã có vòng thử lại riêng | in tiến độ mỗi 1.000 hồ sơ |
| `addAllergy`, `addHistory`, `checkIn`, `openVisit`, `completeVisit` | **429 hạn mức** (hay gặp ở mốc 300 bệnh nhân + 60 lượt) | **có** | bọc trong `withQuotaRetry(what, fn)` mới: thấy `OperationOutcomeError` có `outcome.id === 'too-many-requests'` → chờ 15 giây, thử lại, tối đa 8 lần (cùng cách `backfill-search-keys.ts` đang làm) | `"hạn mức FHIR khi <what>: chờ 15s rồi thử lại"` |
| `checkIn` | bệnh nhân không tìm thấy (trả `undefined`) | không | `throw new Error('Không cho vào hàng chờ được: …')` | — |
| `checkIn` | `BusyError` (giành số hết lượt) | **có** | `withQuotaRetry` cũng bắt `BusyError` → thử lại tối đa 8 lần (seed là tiến trình duy nhất ghi nên tình huống này gần như không xảy ra) | một dòng |
| `openVisit` | `kind: 'taken'` (lượt do người khác giữ — chỉ xảy ra nếu có người bấm vào demo đúng lúc seed chạy) | không | `throw` kèm tên lượt và tên người đang giữ | — |
| `openVisit` | `kind: 'closed'` — **đường chạy lại bình thường** (mục 4.3): sau lần seed đầu, mọi lượt lịch sử và lượt `done` có Encounter `finished` nên lần chạy sau luôn nhận `closed` | — | **đi tiếp** `completeVisit` cùng `clientUuid`; `wasCompletedBy` trả `{ kind: 'ok', replayed: true }` | không in gì (không phải lỗi) |
| `openVisit` | `kind: 'not-found'` | không | `throw`: không đọc được lượt vừa cấp số | — |
| `completeVisit` | `kind: 'incomplete'` (ghi dở: một phần tử của gói bị từ chối) | **có** | **chờ 15 giây rồi gửi lại cùng `clientUuid`**, tối đa 8 lượt — xem `completeWithQuotaRetry` dưới đây; hết lượt mới `throw` | `"<what>: ghi dở (429,429) — chờ 15s rồi gửi lại cùng clientUuid"` |
| `completeVisit` | `kind: 'not-found' / 'not-open' / 'already-closed'` | không | `throw` kèm `slug`, chỉ số lượt và `kind` (`already-closed` = khóa `:done` đã đổi so với lần seed trước ⇒ ai đó sửa mảng giữa) | — |
| Ghi `.demo-tenants.json` | lỗi đĩa | không | `throw` → thoát mã 1 | — |

**Vì sao `incomplete` phải tự chờ:** `writeAll` và `retryOnConflict` chỉ thử lại **xung đột giao dịch**
(`isConflictEntry` = HTTP 409 **và** mã PostgreSQL `40001` — xem `services/bff/src/conflict.ts`). Một
phần tử bị **429** không phải xung đột ⇒ rơi vào `failedEntries` ⇒ `completeVisit` trả `incomplete`. Mà
429 ở giai đoạn lượt khám là chuyện **thường trực**, không phải ngoại lệ: một lượt ≈ 2.500 điểm
**[Phân tích, từ mã]** (lần 429 ở chu kỳ 17–18 với log `_consumedPoints 50011, limit 50000` mới là phần
**[Đã đo]** — xem mục 3), hạn mức 50.000 điểm/phút/người dùng ⇒ ~20 lượt mỗi phút; seed tạo 34 lượt (Nội) và 24 lượt (Nhi)
liên tục qua **một** tài khoản máy mỗi phòng. Thử lại **không chờ** sẽ nằm trọn trong cùng phút bị khóa
⇒ cả ba lần đều 429 ⇒ seed chết giữa buổi nạp. Đường ghi một lượt vì vậy viết đúng như sau:

```ts
const QUOTA_BACKOFF_MS = 15_000;   // cùng con số với scripts/backfill-search-keys.ts
const MAX_ATTEMPTS = 8;            // đã có sẵn trong seed-demo.ts

/** Chờ hạn mức cho CẢ hai kiểu 429: ném ra ngoài (withQuotaRetry) và nằm trong gói (kind 'incomplete'). */
async function completeWithQuotaRetry(store: ClinicStore, cmd: CompleteCommand, what: string) {
  for (let attempt = 1; ; attempt++) {
    const r = await withQuotaRetry(what, () => store.completeVisit(cmd)); // bắt OperationOutcomeError id 'too-many-requests'
    if (r.kind !== 'incomplete') return r;
    if (attempt >= MAX_ATTEMPTS) throw new Error(`${what}: còn ghi dở sau ${attempt} lần gửi lại`);
    console.log(`  ${what}: ghi dở (${r.failed.map((f) => f.status).join(',')}) — chờ 15s rồi gửi lại cùng clientUuid`);
    await new Promise((res) => setTimeout(res, QUOTA_BACKOFF_MS));
  }
}

// Một lượt khám (lịch sử hoặc 'done' của hôm nay):
const checkedIn = await withQuotaRetry(what, () => store.checkIn({ clientUuid: inKey, … }, at));
if (!checkedIn) throw new Error(`${what}: không cho vào hàng chờ được (bệnh nhân không tìm thấy)`);
const opened = await withQuotaRetry(what, () => store.openVisit(checkedIn.item.id, doctor, at));
switch (opened.kind) {
  case 'ok':
    break;
  case 'closed':
    break; // ĐÚNG đường chạy lại: lượt đã hoàn tất từ lần seed trước. Đi tiếp, completeVisit sẽ trả replayed.
  case 'taken':
    throw new Error(`${what}: hồ sơ đang do ${opened.doctorName ?? 'người khác'} khám — đóng lượt đó rồi chạy lại seed`);
  case 'not-found':
    throw new Error(`${what}: không đọc được lượt khám vừa cấp số`);
}
const result = await completeWithQuotaRetry(store, { clientUuid: doneKey, … }, what);
if (result.kind !== 'ok') throw new Error(`${what}: ${result.kind}`);
```

Nguyên tắc chung: seed **thoát mã khác 0** khi không ghi trọn vẹn, để `depends_on:
service_completed_successfully` giữ `web` không khởi động với dữ liệu nửa vời — hành vi hiện tại, giữ
nguyên. Mọi lỗi in **một dòng tiếng Việt** có đủ `slug` + loại mục + chỉ số để biết sửa ở đâu; không
in cả đối tượng lỗi (quy tắc không PII trong log).

### 12.3 Hạn chế môi trường phải ghi rõ, không được tuyên bố thành công giả

Đính chính một giả định dễ nhầm: **seed không cần Internet.** Đã đọc
`services/bff/scripts/medplum-admin.ts`: `createTenantProject` chỉ tạo `Project` + `ClientApplication`
qua `admin/projects/:id/client` — seed **không tạo người dùng Medplum nào**, nên đường
`api.pwnedpasswords.com` (F2, chỉ chạy khi đặt/đổi mật khẩu người dùng) **không** nằm trên đường đi của
seed. Phụ thuộc Internet thật là **kiểm tra phiên bản lúc Medplum server khởi động** (F7), mà stack
Medplum đã chạy sẵn và không được recreate. Seed chỉ cần tới được `http://host.docker.internal:8103`.

Nếu vẫn gặp lỗi mạng khi chạy kiểm chứng: ghi **nguyên văn** lỗi và kết luận "chưa kiểm chứng được"
vào `trial1-verification.md`, không ghi là thành công.

## 13. Bất biến và tính chạy lại — bảng đối chiếu

| Bất biến | Cách thiết kế bảo đảm |
|---|---|
| Chạy lại không trùng | mọi tạo mới đi qua `ifNoneExist` / `createResourceIfNoneExist` với khóa `stableUuid` (mục 4.3); `completeVisit` nhận ra `wasCompletedBy` và trả `replayed` |
| Hàng chờ hôm nay làm mới mỗi ngày | khóa có `vnDay(now)`; trong cùng ngày chạy lại là bất biến |
| Dữ liệu là giả | 100% tên, số điện thoại, CCCD sinh ra trong tệp seed; CCCD luôn tiền tố `000` |
| Danh mục minh họa | seed chỉ **đọc** `@phongmach/catalogs`, không thêm mã mới; `CATALOG_NOTICE` giữ nguyên |
| Chữ ký mô phỏng | đi qua `planCompletion` → `Provenance` có `EXTENSIONS.simulated = true` |
| Web không gọi thẳng Medplum | không đổi kiến trúc container; BFF vẫn nghe `127.0.0.1:8110` |
| Không recreate Medplum | không có lệnh nào tác động tới project `phongmach-medplum`; kiểm bằng `docker ps` trước/sau |
| Bí mật không vào git | `git status` phải chỉ thấy `seed-demo.ts`, `docker-compose.yml`, tài liệu; `.demo-tenants.json` và `audit.ndjson` nằm trong volume |
| Chỉ sửa 2 tệp mã | kiểm bằng `git diff --name-only` |

**Phạm vi commit — chốt (theo review finding 11).** `git status --short` trong worktree hiện chỉ hiện
`?? .agents/`: thư mục này **chưa** được git theo dõi, nên nó sẽ chỉ vào commit nếu ta `git add` tường
minh. Yêu cầu gốc viết "commit các thay đổi (`seed-demo.ts`, `infra/demo/docker-compose.yml`)". Quyết
định: **commit cả `.agents/tasks/*.md`** (thiết kế, review, tài liệu kiểm chứng) trong cùng commit, và
nói rõ trong thông điệp commit, vì ba tệp đó là bằng chứng kiểm chứng mà chính yêu cầu gốc đòi phải ghi
(`trial1-verification.md`) — để lại ngoài git thì chủ dự án review nhánh sẽ không thấy chúng. Cụ thể:

```powershell
git add services/bff/scripts/seed-demo.ts infra/demo/docker-compose.yml .agents/tasks
git status --short      # phải CHỈ có 4 đường dẫn trên, không có .demo-tenants.json / .data / .env
```

Không `git add -A`. Không commit `node_modules`, `.demo-tenants.json`, `services/bff/.data/`,
`infra/medplum/.env` (cả ba đã được `.gitignore` loại — đã kiểm bằng `git check-ignore -v`).

## 14. Khả năng kiểm thử

| Kiểm được bằng gì | Nội dung |
|---|---|
| **Biên dịch** (`pnpm typecheck`) | **Bắt được** (nhờ union phân biệt theo `state`, mục 4.1): thiếu `exam` ở lượt `state: 'done'`; thiếu `doctor` ở `done`/`in-exam`; đặt `openedMinutesAgo` hay `exam` vào `waiting`; sai tên trường của `LineInput`, `VitalsInput`, `CompleteCommand`, `PrescriptionToSign`. **Không bắt được** (phải dựa vào chạy khô): mã thuốc/ICD-10 sai (đều là `string`), `vitals` ngoài khoảng, `minutesAgo` nhỏ hơn `seconds`, trùng khóa, thiếu dòng `NARRATIVE`. Bản sửa 2 của tài liệu từng nói typecheck bắt được "thiếu `exam`" **khi `exam?` còn là tùy chọn** — câu đó sai, review finding 3 đúng; nay nó đúng chỉ vì kiểu đã đổi |
| **Chạy khô** (`SEED_DRY_RUN=1`) | toàn bộ bảng mục 12.1: mã thuốc, mã ICD-10, liều/số lượng, trùng khóa, tuổi/CCCD, giờ của lượt hôm nay. Không cần Medplum, chạy < 1 giây |
| **Tích hợp thật** (Docker) | seed thoát 0, `web` healthy, các truy vấn qua cổng 8081 ở mục 15 |
| **Chạy lại** | seed hai lần trong cùng ngày: lần hai phải in đúng cùng số bệnh nhân/lượt khám, `Patient._total` không tăng, và đi đúng ba đường chạy lại ở mục 4.3 (trong đó `openVisit` trả `closed` cho mọi lượt đã hoàn tất — **không** được coi là lỗi). Thời gian lần hai ghi riêng (mục 4.5) |
| Không kiểm được trong phạm vi này | kiểm thử đơn vị cho `validateScenario` (phải thêm tệp trong `services/bff/test/unit`, ngoài phạm vi). Ghi backlog: tách `validateScenario` ra tệp riêng để lần sau viết test không phải sửa seed |

Thiết kế cố ý để **toàn bộ phần dễ sai là dữ liệu khai báo thuần**, kiểm được bằng một hàm thuần không
cần mạng — đó là lý do chọn pre-flight thay vì "cứ chạy rồi xem log".

**Ghi nhận phạm vi để chủ dự án không bất ngờ:** nhiệm vụ chỉ yêu cầu làm dày dữ liệu, nhưng
`validateScenario` + `SEED_DRY_RUN` là một khối mã **mới** đáng kể trong `seed-demo.ts` (≈ 15 nhóm quy
tắc), nên diff sẽ lớn hơn "thêm dữ liệu". Lý do giữ: một ký tự sai trong mã thuốc hoặc một dòng thuốc
thiếu liều (mục 7.3) hiện chỉ lộ ra sau 5–9 phút seed, giữa lúc đã ghi nửa dữ liệu; pre-flight bắt
trong 50 ms. Nó nằm trong tệp được phép sửa nên không phá bất biến phạm vi. Backlog đã ghi: tách ra
tệp riêng.

## 15. Lệnh kiểm chứng (cho bước sau, chạy Docker thật)

```powershell
$W = "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\trial1-seed-data"
# 0. Chụp container id của Medplum TRƯỚC
docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
# 1. Kiểu
pnpm -C $W typecheck
# 2. Chạy khô bộ kiểm tra kịch bản (không cần Medplum).
#    BẮT BUỘC có --build: `docker compose run` KHÔNG build lại khi image đã tồn tại, mà máy này đã dựng
#    demo trước đó nên image phongmach-demo-seed đang mang seed-demo.ts CŨ ⇒ không có --build là kiểm mã cũ.
#    (Đã kiểm trên máy: `docker compose run --help` có --build; Compose v2.22+ hỗ trợ.)
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" run --rm --build -e SEED_DRY_RUN=1 seed
#    Đường thay thế nếu Compose không có `run --build` (ghi rõ đã dùng đường nào trong tài liệu kiểm chứng):
#    $env:SEED_DRY_RUN="1"; pnpm -C $W --filter @phongmach/bff exec tsx scripts/seed-demo.ts
# 3. Dựng demo và ĐO thời gian seed (đây là LẦN CHẠY NGUỘI — con số so với ngưỡng 8 phút)
Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d --build }
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" logs seed    # lấy dòng "Tổng thời gian seed"
docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" ps
# 4. Kiểm qua cổng 8081
curl.exe -s http://localhost:8081/api/session/demo-users
$t = (curl.exe -s -X POST http://localhost:8081/api/session -H "content-type: application/json" `
      -d '{"tenant":"noi-tong-quat","userId":"noi-owner"}' | ConvertFrom-Json).token
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/patients/search?q=nguyen%20van&limit=20"
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/patients/search?q=1234"
curl.exe -s -H "authorization: Bearer $t" http://localhost:8081/api/queue
curl.exe -s -H "authorization: Bearer $t" http://localhost:8081/api/display
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/metrics/visits?days=14"
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/metrics/visits?days=1"
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/audit?limit=50"
# lấy id một bệnh nhân kịch bản rồi xem lịch sử / dị ứng / tiền sử
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/patients/<id>/visits?limit=10"
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/patients/<id>/allergies"
curl.exe -s -H "authorization: Bearer $t" "http://localhost:8081/api/patients/<id>/medical-history"
# 5. Chạy lại seed để chứng minh tính chạy-lại-được và ĐO riêng thời gian lần hai
Measure-Command { docker compose -p phongmach-demo -f "$W\infra\demo\docker-compose.yml" up -d }
# 6. Chụp lại container id của Medplum SAU — phải giống hệt bước 0
docker ps --filter "name=phongmach-medplum" --format "{{.ID}} {{.Names}} {{.Status}}"
```

Ngưỡng đạt. **Nguyên tắc: dùng "≥ kèm danh sách phải có mặt", không dùng đẳng thức** — tenant demo là
tenant dùng lại, có 300 bệnh nhân sinh ngẫu nhiên mỗi phòng, và bản demo được cố ý để chạy sau kiểm
chứng, nên mọi đại lượng đếm đều có nguồn nhiễu hợp lệ. Đẳng thức sẽ sinh báo đỏ giả.

| Kiểm | Đạt khi |
|---|---|
| Bản chạy khô (bước 2) | in đúng số mục của thiết kế: **15 bệnh nhân kịch bản, 35 lượt khám cũ, 6 lượt hôm nay, 11 dị ứng, 12 tiền sử** (phòng Nội) — nếu in số của bản cũ (3 / 3 / 0 / 2 / 2) thì image **chưa** được build lại, làm lại bước 2 |
| `/api/session/demo-users` | `tenants` có đúng 2 phòng khám, 5 người dùng |
| `search?q=nguyen van` | ≥ 6 kết quả ở phòng Nội, trong đó có cả bản có dấu và bản không dấu, phân biệt được bằng ngày sinh/điện thoại |
| `search?q=1234` | ≥ 6 kết quả; 6 số kịch bản (0913451234, 0918881234, 0938881234, 0909991234, 0977771234, 0966661234) nằm ở **nhóm đầu** (nhánh khóa "4 số cuối" xếp trước `phone:contains`). Có ca sinh ngẫu nhiên chứa "1234" ở giữa là **bình thường** |
| `search?q=van an` | ≥ 5 kết quả, có mặt đủ Nguyễn Văn An, Nguyễn Văn Ân, Nguyen Van An, Trần Văn An, Phạm Văn An |
| `/api/queue` | ≥ 6 lượt, trong đó có **đúng 6 lượt do seed tạo**; ≥ 1 `in-exam`, ≥ 3 `waiting` xếp theo urgent → appointment → normal, ≥ 2 `done` |
| `/api/display` | `inExam` ≥ 1 mục, `waiting` ≥ 3 mục (màn hình chờ không trống) |
| `/api/metrics/visits?days=14` | `all.visits` ≥ 20 (Nội) / ≥ 13 (Nhi); `excluded` ≥ 1; `p50Seconds` ≤ 60 và `p90Seconds` ≤ 120; phòng Nội có 2 dòng bác sĩ. Đăng nhập `noi-owner` (chỉ `owner` thấy mọi bác sĩ) |
| `/api/audit?limit=50` | ≥ 20 dòng, có dòng `gateway-send` của "Hộp thư đi" |
| `patients/<id>/visits` | bệnh nhân idx 10 phòng Nội có ≥ 8 lượt, mỗi lượt có chẩn đoán + đơn thuốc nhiều dòng |
| **Lời dặn** (cùng phản hồi trên) | **mọi** lượt trả về có `prescription.advice` khác rỗng; ≥ 1 lượt có `prescription.followUpDays`. Kiểm nhanh: `… \| ConvertFrom-Json \| %{ $_.prescription.advice }` không có dòng trống |
| **Lịch sử không bị copy-paste** (cùng phản hồi trên) | trong 8 lượt của bệnh nhân idx 10, trường `reason` có **≥ 2 giá trị khác nhau** (ba biến thể I10 của mục 7.4) |
| Chạy lại (bước 5) | seed exit 0, `Patient._total` không tăng, thời gian lần hai ghi riêng trong tài liệu kiểm chứng |
| Medplum | 3 container cùng id, vẫn `Up`, không `Restarting` |
| Dọn dẹp | **không** `down -v`; để demo chạy |

## 16. Rủi ro đã biết và cách xử

| Rủi ro | Mức | Cách xử |
|---|---|---|
| Seed lâu hơn 8–10 phút | **đã loại trừ bằng số đo** (2 phút 38 giây tuần tự, mục 3) | không dùng bậc nào của thang lùi; thang lùi giữ lại làm dự phòng nếu ai nâng khối lượng dữ liệu lên nữa. Bậc 1 (song song) **đã bị gạch** — nó là nguồn xung đột giao dịch |
| 429 giữa chừng làm seed chết | **cao** (≈ 20 lượt/phút, seed tạo 34 + 24 lượt) | `withQuotaRetry` cho mọi phép ghi lẻ **và** `completeWithQuotaRetry` cho `kind: 'incomplete'` — 429 nằm trong gói không được `writeAll` thử lại (mục 12.2). **Đã chạy thật:** 4 lần chờ 15 giây ở `noi-tong-quat/visit 14` và 4 lần ở `nhi/visit 8`, seed vẫn exit 0 |
| **Xung đột giao dịch 40001 trong gói `batch` làm seed chết** (F13) | **đã xảy ra thật, đã sửa** | `runBatch` coi mục `409` mang mã `40001` là gửi lại được, chờ ngẫu nhiên tăng dần bằng đúng `backoff` + `isConflictEntry` của `services/bff/src/conflict.ts` (6 lần, gốc 200 ms), **vẫn soát từng mục** của phản hồi (F11). Cộng với việc chạy hai phòng **tuần tự** để không tự tạo tranh chấp |
| Số liệu kiểm chứng đo trên tenant demo **dùng lại** | trung bình | mọi ngưỡng ở mục 15 là **ngưỡng dưới** kèm danh sách phải có mặt, không phải đẳng thức; ghi rõ điều này trong `trial1-verification.md` |
| Có người đang bấm demo lúc seed chạy lại | thấp | `openVisit` trả `taken` → seed `throw` với thông điệp rõ; chạy lại sau khi người đó đóng lượt. (`closed` thì **không** phải lỗi, xem mục 4.3) |
| Seed chạy trong khoảng 00:00–01:00 giờ VN | thấp | kẹp mốc đến về `00:05` cùng ngày VN (mục 4.4), hàng chờ vẫn đúng ngày |
| Hàng chờ "hôm nay" cũ còn trạng thái `arrived` ở các ngày trước | thấp | `listQueue` lọc theo ngày nên không ảnh hưởng; ghi nhận trong tài liệu kiểm chứng |
| **Mỗi ngày seed chạy để lại 1 Encounter `in-progress` mỗi phòng, không bao giờ được đóng** (lượt `in-exam`) | thấp | vô hại với cả ba đường đọc (`listQueue` lọc ngày; `finishedVisits` và `patientVisits` chỉ lấy `status=finished`) nên không vào số đo Metrics lẫn lịch sử khám. Ghi vào mục 4.3 **và** vào tài liệu kiểm chứng để người sau không coi là lỗi dữ liệu; muốn dọn thì dùng màn "Hủy lượt" trên giao diện |
| Đơn thuốc cũ 180 ngày bị cổng mô phỏng gửi "hôm nay" | thấp | chấp nhận cho demo; nêu rõ trong tài liệu kiểm chứng rằng mốc gửi là lúc hộp thư đi chạy lần đầu |
| Nhóm bệnh nhân nhi sinh 2015–2016 sẽ vượt 14 tuổi vào 2029 | thấp | ghi nhận; làm mới dữ liệu demo trước mốc đó |
| Ai đó chèn mục vào giữa mảng `story`/`visits` sau này | trung bình | chú thích in đậm "CHỈ THÊM VÀO CUỐI" ngay trên từng mảng + `validateScenario` phát hiện trùng khóa (không phát hiện được lệch chỉ số, nên chú thích là tuyến đầu) |

## 17. Phản hồi các finding của review (bản sửa 3)

Review vòng này: `CHANGES_REQUESTED` — 0 HIGH, **4 MEDIUM**, **7 NIT**. **Cả 11 finding đều đã xử**;
không finding nào bị dồn vào backlog hay bị bác bỏ. Như hai vòng trước, tôi mở lại mã nguồn để xác nhận
từng khẳng định của review trước khi sửa, và lần này tìm thấy **một chỗ review nói chưa chính xác**
(ghi ở cuối mục).

### 17.1 Bốn finding MEDIUM

| # | Vấn đề review nêu | Đã sửa ở đâu | Đã xác nhận bằng mã nào |
|---|---|---|---|
| 1 | Không nói rõ mốc nào vào `openVisit` cho lượt `in-exam` / `done`; đọc theo mục 4.1 thì giờ ký nằm **trước** giờ mở ⇒ `measureVisit` trả 0 giây và cả bảng p50/p90 sai | **Mục 4.2**: thêm khối "Quy tắc CHỐT về mốc mở hồ sơ" — bảng bốn loại lượt × ba mốc, kèm mã mẫu. Lượt lịch sử và `done` dùng `openVisit(enc.id, doctor, at)` với `at` = giờ đến và `completeVisit.now = at + seconds·1000`; **chỉ** `in-exam` dùng `now − openedMinutesAgo` và **không** gọi `completeVisit`. **Mục 8**: thêm bảng "Mốc thời gian của ba nhánh". **Mục 4.1**: `openedMinutesAgo` chuyển vào nhánh `in-exam` của union nên nó **không tồn tại** ở `waiting`/`done` — mạnh hơn một luật runtime | `markCalled` (`packages/clinical/src/queue.ts`): `examOpened = (openedAt ?? now).toISOString()`, `examOpenedSource = 'client'` **chỉ khi** có tham số thứ tư; `completeVisit` (`services/bff/src/medplum.ts`) đọc lại `examOpened` rồi gọi `measureVisit`; `measureVisit` (`clientTime.ts`) nhánh `source === 'server'`: `seconds = Math.max(0, round((now − opened)/1000))` |
| 2 | `advice` / `followUpDays` không được chốt ở bất kỳ mục nào ⇒ người code có thể để trống cả 58 lượt mà vẫn "đúng thiết kế", trong khi yêu cầu gốc đòi "lời dặn" và 4 lượt hiện có **đều** có | **Mục 4.1**: **bỏ hẳn** `reason/symptoms/findings/advice` khỏi `StoryVisit` — không còn trường tùy chọn để bỏ trống. **Mục 7.4**: viết ra **toàn bộ bảng `NARRATIVE`** (21 mã / 27 biến thể cho Nội, 20 mã / 23 biến thể cho Nhi), mỗi dòng có đủ `reason/symptoms/findings/advice` (+ `followUpDays`), và nêu rõ `advice` đi vào `List.note[0].text` nên **chỉ được lưu khi lượt có đơn**. **Mục 12.1**: thêm 4 hàng — `advice` bắt buộc khác rỗng ≤ 300 ký tự với thông điệp `"noi-tong-quat/visit 12: thiếu lời dặn"`, `followUpDays` 1…365, `reason` ≤ 300, và `lines` ≥ 1 dòng (nếu không có đơn thì lời dặn sẽ im lặng bị mất) | `PrescriptionToSign.advice/followUpDays` (`packages/clinical/src/visit.ts`); `planCompletion` ghi `note: [{ text: rx.advice.trim() }]` và `extension[EXTENSIONS.followUpDays].valueInteger`; `toPrescriptionSummary` đọc ngược đúng hai chỗ đó; `completeBody.prescription.followUpDays = z.number().int().min(1).max(365)` (`services/bff/src/routes/clinical.ts`) |
| 3 | (a) mục 14 nói typecheck bắt được "thiếu `exam` cho lượt `done`" — sai, vì `exam?` là tùy chọn; (b) các hàng bắt buộc của 12.1 không phân nhánh theo `state` nên **chính dữ liệu của thiết kế bị từ chối** | **Mục 4.1**: `TodayVisit` thành **union phân biệt theo `state`** (ba nhánh `waiting` / `in-exam` / `done`), `exam` và `doctor` **bắt buộc** đúng chỗ. **Mục 12.1**: bảng thêm cột **"Áp dụng cho"** (SV / T:done / T:in-exam / T:waiting) cho từng hàng. **Mục 14**: hàng "Biên dịch" viết lại thành hai danh sách *bắt được* / *không bắt được*, kèm câu thừa nhận bản sửa 2 đã nói sai | `CompleteCommand.exam: ExamInput` là **bắt buộc** (`services/bff/src/store.ts`) ⇒ truyền `undefined` là lỗi kiểu ngay tại lời gọi, nhưng chỉ khi mảng dữ liệu không cho phép thiếu — union mới bảo đảm điều đó |
| 4 | "các lượt cũ nhất xếp ở cuối" không đúng với bảng 7.1/7.2: Nội mục cuối là `daysAgo` 25, lượt cũ nhất (240) nằm giữa mảng ⇒ cắt từ cuối bỏ đúng lớp dữ liệu của khoảng 30 ngày | Chọn **phương án sạch hơn** mà review gợi ý: **xếp lại toàn bộ mục mới theo `daysAgo` tăng dần** (bảng 7.1 idx 3–34, bảng 7.2 idx 1–22 được đánh số lại) nên mục cuối *thật sự* là lượt cũ nhất. Kèm **mục 3**, khối "Giá thật của bậc 2": cắt tối đa **13 mục (Nội) / 10 mục (Nhi)**, sâu hơn thì chuyển bậc 3; và cảnh báo rằng bất biến "chỉ thêm vào cuối" sẽ phá thứ tự này ở lần thêm dữ liệu sau, nên **đọc `daysAgo` của các mục cuối trước khi cắt**, đừng tin thứ tự | Xếp lại là an toàn vì đoạn idx ≥ 3 (Nội) và ≥ 1 (Nhi) **chưa seed lần nào** (`CLINICS` hiện có 3 lượt Nội và 1 lượt Nhi); tôi đã tính lại tay toàn bộ mục 9 sau khi đổi số: Nội 20 lượt ⇒ p50 = 58 / p90 = 110, `noi-doctor` 12 lượt ⇒ 57/116, `noi-owner` 8 lượt ⇒ 58/110; Nhi 13 lượt ⇒ 59/105. **Mọi con số của mục 9 không đổi** |

### 17.2 Bảy finding NIT

| # | Vấn đề | Đã sửa ở đâu |
|---|---|---|
| 5 | Bảng 5.3 bỏ sót các ca lọt qua nhánh "khớp đầu từ" (`nguyen van an` còn ra idx 5; `van an` còn ra idx 4, 5, 7) | **Mục 5.3**: bảng đổi thành 4 cột, thêm cột **"Lọt thêm qua nhánh đầu từ"** cho **mọi** hàng, và một đoạn mở đầu nói rõ: cột "Phải có mặt" là tập **phải có mặt**, không phải tập đóng; một ca "lạ" trong kết quả không phải lỗi |
| 6 | Nhãn `[Đã đo]` gán sai cho con số 2.500 điểm/lượt | **Mục 3**: thay đoạn căn cứ bằng danh sách 4 gạch đầu dòng, mỗi dòng mang **đúng** nhãn của tài liệu gốc (`[Đã đọc mã]` cho cấu hình hạn mức, `[Đã đo]` cho "1.000 lần ghi mất 2 phút 14 giây" và cho lần 429 ở chu kỳ 17–18 với `_consumedPoints 50011`, **`[Phân tích, từ mã]`** cho 2.500 điểm/lượt), và nói rõ "≈ 5–6 giây mỗi lượt" là con số **suy ra**. **Mục 12.2**: sửa cùng một nhãn |
| 7 | `NARRATIVE` dùng chung làm 7 lượt I10 của cùng một bệnh nhân giống nhau từng chữ | **Mục 7.4**: `NARRATIVE` nhận **mảng biến thể**, chọn bằng `variants[index % variants.length]`. I10 (Nội) có **3 biến thể**; J30.4 (Nội), A09 (Nhi) 3; E78.5, M17.9 (Nội), J03.9 (Nhi) 2. Có tính tay sẵn trong tài liệu: 8 lượt I10 ở idx 9, 16, 24, 25, 26, 29, 30, 32 ⇒ biến thể 0, 1, 0, 1, 2, 2, 0, 2. **Mục 15**: thêm một hàng ngưỡng kiểm đúng điều này (8 lượt của bệnh nhân idx 10 phải có ≥ 2 giá trị `reason` khác nhau) |
| 8 | "thường thêm `respiratoryRate` và `spo2`" không kiểm được | **Mục 7.5**: thay bằng **bảng quy tắc theo `dx[0]`** — mã bắt đầu bằng `J` hoặc `R50.9`: phòng Nhi ghi **cả hai**, phòng Nội ghi **chỉ** `spo2`; mọi mã khác **không** ghi. Liệt kê sẵn các idx áp dụng (Nhi 2, 5, 6, 7, 8, 11, 12, 13, 15, 18; Nội 3, 6, 7, 14, 17, 20, 28) và yêu cầu `validateScenario` soát **hai chiều** (thiếu là lỗi, thừa cũng là lỗi) |
| 9 | Thiếu vế "mỗi ngày seed để lại 1 Encounter `in-progress` mỗi phòng, không bao giờ đóng" | **Mục 4.3**: đoạn "Hai thứ tích tụ lại theo ngày" liệt kê cả hai (3 `arrived` + 1 `in-progress` mỗi phòng mỗi ngày) kèm lý do vô hại với **cả ba** đường đọc. **Mục 16**: thêm một hàng rủi ro riêng, có chỉ dẫn ghi vào tài liệu kiểm chứng |
| 10 | Không nêu phương án nâng `userFhirQuota` và lý do bỏ | **Mục 3**: thêm **bậc 0 "Đã cân nhắc và BỎ"** vào đầu thang lùi, nêu đúng nguồn (`docs/ke-hoach-trien-khai.md`, chuẩn bị phiên thử M0-1, điểm 3: nâng `Project.systemSetting`/`userFhirQuota` lên 500.000 điểm/phút) và **hai** lý do bỏ: vượt phạm vi hai tệp, và làm số đo thời gian seed không còn phản ánh môi trường mặc định. **Mục 16**: nhắc lại trong ô "Cách xử" |
| 11 | `.agents/` chưa được git theo dõi; phạm vi commit chưa chốt | **Mục 13**: thêm khối "Phạm vi commit — chốt": commit **cả** `.agents/tasks/*.md` cùng hai tệp mã, nêu lý do (tài liệu kiểm chứng là thứ chính yêu cầu gốc đòi), kèm lệnh `git add` tường minh bốn đường dẫn và lệnh `git status --short` để soát, cấm `git add -A` |

### 17.3 Một chỗ review nói chưa chính xác (đã đối chiếu mã)

Finding 2 của review đề nghị trần `advice` là "≤ 300 ký tự (khớp `visitBody` trong
`services/bff/src/routes/clinical.ts`)". Mở mã ra thì **không có** schema tên `visitBody`; schema đúng là
`completeBody`, và trong đó `prescription.advice = z.string().max(1000)` — trần thật là **1000**, không
phải 300. (Trần 300 là của `exam.reason`, và `historyBody.text`; `checkInBody.reason` là 200.)
Thiết kế **vẫn chọn 300** cho `advice` nhưng nói rõ đó là **trần tự đặt của seed** cho gọn tờ đơn, chặt
hơn trần của tuyến API — chứ không phải "khớp tuyến API". `followUpDays` 1…365 thì review đúng.

### 17.4 Những giả định vẫn chưa kiểm chứng được ở bước này

Giữ nguyên danh sách của review, đây là việc của bước chạy Docker thật và phải ghi vào
`trial1-verification.md`:

- tổng thời gian seed thật (ước lượng 6,5–9 phút, nằm sát ngưỡng 8 phút) và bậc lùi đã phải dùng;
- số lần 429 thật và tổng thời gian chờ hạn mức;
- số dòng nhật ký `gateway-send` thật (thiết kế ghi ~35 / ~23; tính theo số đơn **mới** thì vào khoảng
  34 và 24 vì 4 đơn của lần seed trước đã `completed` nên không gửi lại);
- việc `--build` thật sự làm image seed mang mã mới (mục 15 có hàng ngưỡng riêng cho việc này);
- việc 3 container `phongmach-medplum` giữ **nguyên** container id;
- rủi ro rất nhỏ (~1/10⁶) một trong 17 bệnh nhân sinh ngẫu nhiên của lần seed trước trùng số điện thoại
  với một ca kịch bản mới — `validateScenario` chỉ soát trùng trong phạm vi `story`. Ghi nhận, không xử.

Phạm vi vẫn đúng hai tệp mã được phép sửa (`services/bff/scripts/seed-demo.ts`,
`infra/demo/docker-compose.yml`) cộng tài liệu trong `.agents/tasks/`.
