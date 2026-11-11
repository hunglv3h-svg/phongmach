# Kiểm chứng mã (fix-loop, lượt 1) — M0-S3.5c

Không có `review.json` ⇒ lượt 1: làm cả hai bản sửa trên mã hiện tại (không cherry-pick).

## Commit (trên `2594997` = các bài đỏ)

| Commit | Nội dung |
|---|---|
| `a8096d7` | fix(sync): `SyncEngine.schedule(ops, browserOffline, since)`; `runOnce` truyền `now` (mốc xét tới hạn). Hẹn `max(nextAt, now)` cho mục có `nextAt > since`; mục `nextAt <= since` (lượt vừa rồi đã xét mà không gửi) không kéo lượt sau lại gần. |
| `7461db6` | fix(bff): `checkInUuidOf` + `toQueueItem` thêm đúng một trường `clientUuid` (bỏ qua `<uuid>:complete`). Không đụng `audit.ts`, `routes/clinical.ts`, `medplum.ts`. |
| `bacb88a` | fix(web): `cache.ts` `localVisitId`, `adoptedVisits` (khớp theo `clientUuid` không phân biệt hoa thường, bỏ qua mục cấp số đã kết thúc theo `isTerminal`), `mergeQueue` dùng `serverIdOf = ids ?? adopted`; `client.ts` `saveSnapshot` ghi ánh xạ vào bảng `ids` có sẵn trong cùng `commit` với ảnh chụp (chỉ khi `pendingCount() > 0`), `checkIn` dùng dòng của máy chủ nếu ảnh chụp về trước phản hồi. |

Không đổi: lược đồ IndexedDB (không tăng version Dexie), ý nghĩa `clientUuid`, cách cấp số, gói hoàn tất, `settleFocus`, hàng rào in, `Queue.tsx`, `store.ts`, `ops.ts`. Giao diện vẫn 0 import `@medplum/*`. `api.ts` không cần sửa (dùng type `QueueItem` từ `@phongmach/clinical`).

## Đã chạy (Git Bash, cwd = worktree; đầu ra đầy đủ trong các file `green-*.txt` cùng thư mục)

| Lệnh | Kết quả | File |
|---|---|---|
| `pnpm typecheck` | xanh, 8 package | `green-unit.txt` |
| `pnpm test` | xanh, **629 bài** chạy thật: fhir-vn-model 54, catalogs 16, rules 28, clinical 84, print 4, trial 13, clinic-web 262 (18 file), bff unit 168 (13 file) | `green-unit.txt` |
| `pnpm --filter @phongmach/bff test:integration` (Medplum thật, BFF chưa khởi động lại không ảnh hưởng: bài tự dựng BFF trong tiến trình) | xanh, **81/81** (4 file); trước khi sửa 2 đỏ / 79 (`red-bug2-integration.txt`) | `green-integration.txt` |
| `infra/dev-up.sh` rồi `E2E_URL=http://127.0.0.1:5183 pnpm e2e` (bản dev Vite) | smoke 13/13, visit 26/26, offline-sign **17/17 (bước 14 mới "một dòng" xanh)**, offline-conflict hỏng ở bước 13 (xem dưới) | `green-e2e.txt` |
| `pnpm --filter @phongmach/clinic-web build` + `preview`, `E2E_URL=http://localhost:4173 pnpm e2e` (bản build, như CI) | xanh toàn bộ, **70 bước** (13 + 26 + 17 + 14), gồm offline-sign bước 14 và offline-conflict bước 13 | `green-e2e-preview.txt` |
| `pnpm e2e:cycles` (hạt giống ngẫu nhiên **3218843087**) | **14/14**, gồm bước mới 13: "đúng một dòng cho mỗi lượt khám ở cả 26 lần mở hàng chờ (6 lần ở chu kỳ mất phản hồi khi cấp số)"; 0 mất, 0 trùng | `green-cycles-random.txt` |

Chưa chạy (thuộc bước `verify`): `e2e:cycles` với `E2E_SEED=1393699289`, `1256812025`, `1962719789`; các đột biến M1/M1b/M2/M3.

## offline-conflict bước 13 đỏ trên bản dev — có sẵn trên mã chưa sửa, không do thay đổi này

Bước 13 ("401 đúng lúc ký (OFF-8)") hết thời gian chờ in trên **bản dev Vite** (`5183`): 3/4 lần với mã đã sửa. Để tách nguyên nhân,
đã tạm đưa `sync.ts`, `cache.ts`, `client.ts` về bản chưa sửa (`git checkout 2594997 -- …`, rồi trả lại bằng `git checkout HEAD -- …`,
cây sạch sau đó) và chạy lại `e2e:conflict` trên bản dev: **đỏ 2/2, đúng bước 13, cùng thông điệp**. Trên bản build (`preview`, như CI)
bước này xanh. Ảnh chụp: màn hình đăng nhập "Phiên đã hết hạn… 1 mục", không có tờ in, tức cuộc đua đã ghi ở chú thích của bài
(401 làm giao diện đăng xuất và đóng kho; bản dev chậm hơn nên kho có thể đóng trước khi mục kịp chuyển sang dạng ngoại tuyến).
Đường 401 không đi qua phần đã sửa: `schedule` thoát sớm khi `paused`. Không sửa ở đây (ngoài phạm vi); nên báo chủ dự án.

## Queue.tsx (nguyên nhân C của PR #20)

Không làm bài mới chập chờn: offline-sign bước 14 xanh trên cả bản dev và bản build. Ở `e2e:cycles` 3218843087 có 1 lần nút mở hồ sơ
phải bấm lại (chu kỳ 14, dòng hàng chờ dựng lại), bài vẫn đạt và bước "một dòng" vẫn xanh. Không cần `queue-flicker-notes.md`.

## Trạng thái máy

BFF (8110) + giao diện dev (5183) do `infra/dev-up.sh` của worktree này dựng vẫn đang chạy, phục vụ mã đã sửa (dừng: `infra/dev-up.sh --stop`).
Máy chủ preview 4173 tôi dựng đã dừng. Medplum dùng chung, không đụng.
