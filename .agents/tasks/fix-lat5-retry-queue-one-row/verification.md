# Kiểm chứng và đột biến (bước verify) — M0-S3.5c

Nhánh `fix/lat5-retry-queue-one-row`, mã đã sửa ở HEAD `bacb88a` (trên `2594997` = các bài đỏ, `a8096d7`, `7461db6`).
Chạy bằng Git Bash, cwd = worktree. Đầu ra thô của mọi lệnh nằm cùng thư mục này (cột "File").

## A. Đột biến

Mỗi đột biến sửa tạm bằng tay, chạy, rồi trả lại bằng `git checkout -- <file>`; sau mỗi lần trả lại `git diff --stat` rỗng.
Số bài là tổng vitest báo "Tests … (N)", bằng đúng tổng khi chưa đột biến (clinic-web 262, clinical 84, bff unit 168, integration 81).

| Đột biến | Sửa tạm | Lệnh | Bài chạy | Bài ĐỎ | File |
|---|---|---|---|---|---|
| **M1** bỏ phần hẹn lại ngay trong `schedule` | `sync.ts`: `.filter((t) => t > since).map((t) => Math.max(t, now))` → `.filter((t) => t > now)` (như mã cũ) | `pnpm --filter @phongmach/clinic-web exec vitest run` | 262 (18 file) | 2: `sync.test.ts > hẹn lượt sau >` "mục thử lại hết thời gian chờ trong lúc một lượt khác đang gửi: được gửi ngay sau lượt đó, không chờ hết chu kỳ 30 giây" (`[30000]` thay cho `[0]`); "mục lỗi tạm ngay trong lượt đang chạy, hết thời gian chờ trước khi lượt đó xong: cũng được gửi ngay sau lượt đó" (gửi 1 lần thay cho 2) | `mutation-M1.txt` |
| **M1b** (thêm) bỏ bộ lọc `> since`: mọi mục chưa xong kéo lượt sau lại gần | `sync.ts`: bỏ `.filter((t) => t > since)` | như trên | 262 | 3: `hẹn lượt sau >` "mục chờ mục trước (mục trước đang thử lại): … không tự chạy lại ngay"; "mục bị giữ (mục trước xung đột): … không tự chạy lại ngay"; "lượt dừng vì lỗi mạng trước khi tới một mục thử lại đã quá hạn từ đầu lượt: … không tự chạy lại ngay" | `mutation-M1b.txt` |
| **M2** bỏ `clientUuid` khỏi phản hồi hàng chờ | `packages/clinical/src/queue.ts` `toQueueItem`: bỏ `...(clientUuid ? { clientUuid } : {})` | `pnpm --filter @phongmach/clinical test` | 84 | 2: "hàng chờ > mục hàng chờ mang clientUuid của lần cấp số (viết thường), kể cả khi lượt đã ký: không lấy nhầm định danh của lần hoàn tất"; "kế hoạch hoàn tất lượt khám > khám không kê đơn: một bước ghi, không có đơn; đóng lượt khám là lời ghi riêng" | `mutation-M2.txt` |
| | | `pnpm --filter @phongmach/bff test` | 168 | 1: `test/unit/clinical.test.ts > hàng chờ > cấp số, gửi lại cùng clientUuid không cấp thêm, và hủy chỉ áp cho lượt đang chờ` | `mutation-M2.txt` |
| | | `pnpm --filter @phongmach/bff test:integration` (Medplum thật) | 81 | 2: "hàng chờ trên Medplum thật > cấp số tăng dần; gửi lại cùng clientUuid không cấp thêm; nhiều lễ tân cùng lúc không trùng số"; "luồng khám đầy đủ … > lượt khám đã đóng: hàng chờ hiện "done"; mở lại không được" | `mutation-M2.txt` |
| | | `infra/dev-up.sh --stop && infra/dev-up.sh` (BFF chạy mã đột biến), `E2E_URL=http://127.0.0.1:5183 pnpm --filter @phongmach/clinic-web e2e:offline` | 13 bước đạt, hỏng ở bước 14 | bước 14: `một lượt khám thì một dòng: dòng của máy chủ và lượt tạm trên máy phải là một` (`2 !== 1`) | `mutation-M2.txt` |
| | | `pnpm --filter @phongmach/clinic-web test` | 262 | 0, đúng dự kiến: `fakeBff.ts` tự gắn `clientUuid`, nên bộ web không thấy M2; M2 được chặn ở clinical, BFF unit, integration và e2e | `mutation-M2.txt` |
| **M3** khớp theo bệnh nhân + ngày thay cho `clientUuid` | `cache.ts` `adoptedVisits`: chỉ mục máy chủ theo `patientId` (mọi mục hàng chờ là của hôm nay), tra bằng `body.patientId` | `pnpm --filter @phongmach/clinic-web exec vitest run` | 262 | 2: `cache.test.ts > … > máy chủ đã có lượt khám mà mục cấp số trên máy chưa xong (mất phản hồi ở cấp số) >` "một người hai lượt trong ngày (cùng bệnh nhân, cùng ngày, clientUuid khác): hai lượt khám, hai dòng, không gộp theo bệnh nhân + ngày"; "máy chủ bản cũ không trả clientUuid: như trước (hai dòng cho tới khi mục cấp số gửi lại xong), không lỗi" | `mutation-M3.txt` |

Không đột biến nào để mọi bài xanh, nên không phải thêm bài. Sau M2 đã khởi động lại BFF + giao diện bằng `infra/dev-up.sh` để chúng chạy lại mã đã sửa.

## B. Các cổng trên mã đã sửa (HEAD `bacb88a`)

| Lệnh | Mã thoát | Kết quả | File |
|---|---|---|---|
| `pnpm typecheck` | 0 | 8 package `typecheck: Done` | `verify-typecheck.txt` |
| `pnpm test` | 0 | **629 bài** xanh: fhir-vn-model 54, catalogs 16, rules 28, clinical 84, print 4, trial 13, clinic-web 262 (18 file), bff unit 168 (13 file) | `verify-test.txt` |
| `pnpm --filter @phongmach/bff test:integration` | 0 | **81/81** (4 file), không gặp 429 | `verify-integration.txt` |
| `pnpm --filter @phongmach/clinic-web build`, `preview` ở 4173, `E2E_URL=http://127.0.0.1:4173 pnpm e2e` (bản build, như CI) | 0 | **70 bước**: smoke 13/13, visit 26/26, offline-sign 17/17 (bước 14 "một dòng" xanh), offline-conflict 14/14 | `verify-e2e-preview.txt` |
| `pnpm e2e:cycles` (ngẫu nhiên) | 0 | hạt giống **1282204695**, 14/14, bước 13 "đúng một dòng … 22 lần mở hàng chờ (4 lần ở chu kỳ mất phản hồi khi cấp số)", 0 mất, 0 trùng | `verify-cycles-random.txt` |
| `E2E_SEED=1393699289 pnpm e2e:cycles` | 0 | 14/14, bước 13: 24 lần mở (6 ở chu kỳ mất phản hồi khi cấp số), 0 mất, 0 trùng | `verify-cycles-1393699289.txt` |
| `E2E_SEED=1256812025 pnpm e2e:cycles` | 0 | 14/14, bước 13: 25 lần mở (7), 0 mất, 0 trùng | `verify-cycles-1256812025.txt` |
| `E2E_SEED=1962719789 pnpm e2e:cycles` | 0 | 14/14, bước 13: 25 lần mở (5), 0 mất, 0 trùng | `verify-cycles-1962719789.txt` |

### Hạt giống của mọi lần chạy `e2e:cycles` trên nhánh này

| Hạt giống | Bước | Kết quả | File |
|---|---|---|---|
| 3218843087 (ngẫu nhiên) | fix-loop | 14/14 | `green-cycles-random.txt` |
| 1282204695 (ngẫu nhiên) | verify | 14/14 | `verify-cycles-random.txt` |
| 1393699289 | verify | 14/14 | `verify-cycles-1393699289.txt` |
| 1256812025 | verify | 14/14 | `verify-cycles-1256812025.txt` |
| 1962719789 | verify | 14/14 | `verify-cycles-1962719789.txt` |

Không có lần chạy đỏ nào.

## Ghi chú

- **Queue.tsx (nguyên nhân C của PR #20):** nút mở hồ sơ phải bấm lại 1 lần ở 3/4 lần chạy (chu kỳ 20 ở 1282204695, chu kỳ 13 ở
  1256812025 và 1962719789), do dòng hàng chờ bị dựng lại. Bài vẫn đạt và bước "một dòng" vẫn xanh, nên không phải chập chờn;
  không tạo `queue-flicker-notes.md`, không sửa `Queue.tsx`.
- **Bản dev Vite:** `pnpm e2e` ở bước này chạy trên bản build (như CI). Bước fix-loop đã ghi `offline-conflict` bước 13 ("401
  đúng lúc ký", OFF-8) đỏ trên bản dev cả với mã chưa sửa (xem `verification-code.md`); không chạy lại ở đây. Nên báo chủ dự án.
- **Giới hạn của kiểm tra trong `e2e:cycles`:** bước 13 đếm dòng một lần mỗi khi mở hàng chờ; dòng thừa xuất hiện sau thời điểm
  đó sẽ không bị bắt. Bước tất định ở `offline-sign` (bước 14) mới là chốt chặn chính (M2 làm nó đỏ). M3 chỉ bị chặn ở
  `cache.test.ts`, vì e2e và `e2e:cycles` chỉ có một lượt khám cho mỗi bệnh nhân.
- **Trạng thái máy:** BFF (8110) + giao diện dev (5183) do `infra/dev-up.sh` của worktree này dựng vẫn chạy mã đã sửa (dừng:
  `infra/dev-up.sh --stop`). Máy chủ preview 4173 của bước này đã dừng. Medplum dùng chung, không đụng.
