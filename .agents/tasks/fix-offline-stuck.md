# Báo cáo: sửa lỗi chế độ "Mất mạng" không tự thoát khi hết mục chờ

Nhánh: `fix/offline-mode-stuck`. Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\fix-offline-stuck`.
Nền (base): `02c6fc8` (= `origin/main`). Phát hiện 4 (mục 5.9 kế hoạch): "Chế độ Mất mạng không tự thoát khi hết mục chờ".
Nguồn: `.agents/tasks/dieu-tra-che-do-mat-mang.md` (điều tra), `.agents/tasks/phongmach-fix-offline-stuck-2026-10/verification.md` (kiểm chứng), `.agents/tasks/phongmach-fix-offline-stuck-2026-10/review.md` (review — APPROVED).

## 1. Tóm tắt bản sửa

Khi `SyncEngine` tin là mất mạng, nó tự định kỳ thăm dò `GET /api/health` mỗi ~12 giây thay vì chỉ chờ sự kiện `online` của trình duyệt — sự kiện có thể không bao giờ phát trong ca "Wi-Fi còn, máy chủ không tới được". Thăm dò thành công gọi `observe(true)` → `syncNow()`, đưa ứng dụng về "Có mạng" ngay cả khi hàng đợi đã rỗng. Bốn điểm thay đổi:

1. **Thăm dò định kỳ khi mất mạng** trong `sync.ts`: thêm tùy chọn `probe`, `probeMs` (mặc định 12.000 ms), `canProbe`; hàm riêng `armProbe()`/`runProbe()` (kiểm thử được bằng thời gian ảo). Thăm dò DỪNG khi `online === true`, `paused === 'unauthorized'`, `!navigator.onLine`, tab ẩn (`canProbe()===false`), hoặc `stop()`.
2. **Đọc lại `navigator.onLine` ở `visibilitychange`/`focus` và khi engine báo có mạng** (sửa lỗi 3.3 `browserOnline` kẹt false) trong `OfflineProvider.tsx`.
3. **Bỏ khóa nút "Đồng bộ ngay" / "Thử kết nối lại"** ở `SyncBar.tsx` và `SyncPanel.tsx` làm lối thoát tay; `syncNow()` thành async, thăm dò trước khi gửi khi đang offline.
4. **Dọn mâu thuẫn màn hình** ở `Metrics.tsx`/`Gateway.tsx`: cho các lời đọc đi qua `client.call` để một lần tải thành công cũng gỡ cờ online.

### Bất biến giữ nguyên
- Web vẫn 0 import `@medplum/*`; chỉ gọi `/api`. Thăm dò CHỈ `GET /api/health` (không token, không chạm Medplum, không ghi nhật ký) — KHÔNG đổi sang `/api/queue` (sẽ sinh dòng `queue-read` mỗi 12s mỗi máy).
- N3: `observe(true)` chỉ gọi `syncNow()`; `runOnce` vẫn bỏ qua mọi mục ATTENTION — có bài test khẳng định.
- Nhiều tab: thăm dò chỉ chạy ở tab đang hiện (`canProbe`).
- Mọi lần in vẫn qua `printHtml`/`whileLocalStoreQuiet`; e2e dùng `route.abort`, KHÔNG `context.setOffline`, KHÔNG `page.waitForFunction` async; test hẹn giờ dùng thời gian ảo.

## 2. Các tệp đã sửa

| Tệp | Thay đổi |
|---|---|
| `apps/clinic-web/src/local/sync.ts` | Thêm `probe`/`probeMs`/`canProbe`, `probeTimer`, `armProbe()`/`runProbe()`; `armProbe` kích từ `emit` khi `online`/`paused` đổi; `stop()` clear probe timer; `syncNow()` thành async, thăm dò trước khi gửi khi offline. |
| `apps/clinic-web/src/local/OfflineProvider.tsx` | Truyền `probe: () => api.health()`, `canProbe: () => document.visibilityState !== 'hidden'`; đọc lại `navigator.onLine` ở `subscribe`(online), `focus`, `visibilitychange`; gỡ listener trong cleanup. |
| `apps/clinic-web/src/api.ts` | Thêm `api.health` (`GET /api/health`, không token). |
| `apps/clinic-web/src/local/fakeBff.ts` | `GET /api/health → {ok:true}` cho test/offline giả lập. |
| `apps/clinic-web/src/components/SyncBar.tsx` | Bỏ `disabled={!view.online}` ở nút `sync-now`. |
| `apps/clinic-web/src/components/SyncPanel.tsx` | Bỏ `disabled={!view.online}`; đổi nhãn "Thử kết nối lại" khi offline. |
| `apps/clinic-web/src/components/Metrics.tsx` | Các lời đọc qua `client.call`. |
| `apps/clinic-web/src/components/Gateway.tsx` | Các lời đọc qua `client.call` (404 của `simGet` → `status 404 ≠ 0` → `observe(true)`, `.catch` ngoài vẫn nuốt 404). |
| `apps/clinic-web/src/components/sync.test.tsx` | Đảo assertion nút "Đồng bộ ngay" từ "bị khóa" thành "không bị khóa", kèm lý do đổi quyết định. |
| `apps/clinic-web/src/local/sync.test.ts` | Thêm 5 bài thăm dò (hàng đợi rỗng, lỗi-rồi-thành-công, unauthorized/tab ẩn, browserOnline kẹt, N3). |
| `apps/clinic-web/e2e/offline-sign.mjs` | Bước e2e "tự thoát Mất mạng khi hết mục chờ" (`route.abort` + `eventually`). |
| `README.md`, `docs/ke-hoach-trien-khai.md` | Cập nhật trạng thái lỗi. |
| `.agents/tasks/dieu-tra-che-do-mat-mang.md`, `.agents/tasks/phongmach-fix-offline-stuck-2026-10/verification.md` | Báo cáo điều tra + kiểm chứng. |

Full diff: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\fix-offline-stuck" diff 02c6fc8`

## 3. Mutation test — chứng minh ĐỎ khi gỡ biện pháp

Đột biến: trong `apps/clinic-web/src/local/sync.ts`, hàm `armProbe()`, chèn `return;` ngay trước dòng `this.probeTimer = this.clock.setTimeout(...)` (vô hiệu hóa việc hẹn thăm dò).

Lệnh:
```
pnpm --filter @phongmach/clinic-web exec vitest run src/local/sync.test.ts
```

Kết quả (ĐỎ — 4 bài thất bại trong nhóm "thăm dò máy chủ khi mất mạng"), dòng lỗi quan sát được:
```
 ❯ src/local/sync.test.ts (32 tests | 4 failed)
 FAIL ... > hàng đợi RỖNG, mất mạng: đồng hồ ảo trôi → đúng một thăm dò → online lại true (mutation: bỏ thăm dò ⇒ ĐỎ)
   AssertionError: expected false to be true // Object.is equality
 FAIL ... > thăm dò lỗi thì không làm gì và hẹn lại; thành công ở lần sau mới thoát
   AssertionError: expected +0 to be 1 // Object.is equality
 FAIL ... > browserOnline kẹt false mà không có sự kiện `online`: thăm dò vẫn đặt state.online=true ...
   AssertionError: expected false to be true // Object.is equality
 FAIL ... > N3 giữ nguyên: thăm dò → syncNow KHÔNG tự gửi lại hay ghi đè mục đang cần xử lý (ATTENTION)
   AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 28 passed (32)
```

Hoàn nguyên (xóa dòng `return;` đột biến) rồi chạy lại:
```
pnpm --filter @phongmach/clinic-web exec vitest run src/local/sync.test.ts src/components/sync.test.tsx
 Test Files  2 passed (2)
      Tests  43 passed (43)
```
→ Biện pháp an toàn chỉ đáng tin sau khi đã thấy test ĐỎ khi gỡ nó. Đã hoàn nguyên về bản đúng.

Bài N3 (`N3 giữ nguyên…`) dựng chuỗi có mục `open` xung đột 409 (ATTENTION) và mục bị giữ, rồi để thăm dò gọi `observe(true)→syncNow()`: khẳng định mục xung đột KHÔNG bị gửi lại, payload KHÔNG đổi, mục bị giữ KHÔNG được gửi, `bff.completions.size === 0`.

### typecheck / unit test / build (tiền đề)
| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | Xanh. `apps/clinic-web` Done in 9.7s. Exit 0. |
| `pnpm test` | Xanh. clinic-web `Test Files 14 passed (14)`; `src/local/sync.test.ts (32 tests)` (trước 27, thêm 5 bài thăm dò); `src/components/sync.test.tsx` xanh. Exit 0. |
| `pnpm build` | Xanh. `apps/clinic-web` `✓ built in 3.94s`, có `dist/sw.js`, `dist/assets/index-*.js`. Exit 0. |

## 4. Kết quả 4 lệnh e2e (Chromium thật: chrome-headless-shell `chromium_headless_shell-1243`)

Hạ tầng: BFF `127.0.0.1:8110` (`DEMO_AUTH=1`, dùng tệp bí mật đã có của worktree `m0-6-demo-rehearsal` — cùng Medplum localhost:8103, KHÔNG seed lại); bản build + `vite preview` cổng 4173 (`BFF_URL=http://127.0.0.1:8110`). Preview bind `localhost`/IPv6 nên dùng `E2E_URL=http://localhost:4173`. Trước khi chạy: `$env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"` (openssl).

```
pnpm --filter @phongmach/clinic-web e2e            → Đạt 13/13   (smoke)
pnpm --filter @phongmach/clinic-web e2e:visit      → Đạt 25/25
pnpm --filter @phongmach/clinic-web e2e:offline    → Đạt 16/16
pnpm --filter @phongmach/clinic-web e2e:conflict   → Đạt 13/13
```
Mọi bộ Exit 0; bước cuối "không có lỗi nào trong console" đều xanh.

**Bước e2e mới (`offline-sign.mjs`, bước 1)** — "tự thoát Mất mạng khi hết mục chờ": `page.route('**/api/**', route.abort('internetdisconnected'))` (KHÔNG `context.setOffline`), hàng đợi RỖNG (vừa đăng nhập), mở tab Hàng chờ để một lần đọc `/api` lỗi → `offline-badge`; khẳng định `data-pending === '0'`; `page.unroute` (bỏ chặn, KHÔNG đổi `navigator.onLine`, KHÔNG bấm gì); rồi `eventually(() => page.evaluate(async () => …sync-status data-online==='true'…), 30_000)`. KHÔNG dùng `page.waitForFunction` với hàm async. Bước này chạy trên BẢN BUILD (preview). → xanh ("tự thoát Mất mạng… đưa về Có mạng trong ~30s").

## 5. Hạn chế / ghi chú

- **Phối hợp M0-6:** `Metrics.tsx` có thể bị phiên M0-6 chạm. Bản sửa này CHỈ đổi phần đường-gọi-API (bọc qua `client.call`), giữ nguyên phần hiển thị, để giảm xung đột tiềm tàng khi merge. Nếu M0-6 cũng sửa `Metrics.tsx`/`Gateway.tsx` thì cần review phần giao nhau khi hợp nhất.
- **Nhiễu từ phiên khác:** cổng 5173 do một phiên khác giữ (web + Medplum 8103) — KHÔNG đụng. Trong các lần chạy e2e này KHÔNG gặp vết nhiễu 409 / hai-BFF từ phiên khác. (Lưu ý rủi ro vẫn tồn tại nếu chạy đồng thời nhiều BFF trên cùng Medplum.)
- Chưa thử trên máy tính bảng / trình duyệt khác / tắt-bật Wi-Fi thật trên máy Windows (sẽ cắt mạng của chính phiên làm việc) — như báo cáo điều tra đã nêu.
- Tần suất thăm dò 12 giây là mặc định cho demo; `eventually` chờ tới 30 giây nên một chu kỳ thăm dò là đủ.
- Tệp bí mật `.demo-tenants.json` KHÔNG commit (chỉ dùng qua biến môi trường `TENANTS_FILE` lúc chạy e2e).
- Review đã APPROVED; hai issue non-blocking: (1) typo tiêu đề commit "thang do" (dấu rụng); (2) thiếu unit test riêng cho nhánh `syncNow()` bấm-tay-khi-offline (đã phủ gián tiếp qua e2e và 4 unit dùng chung `runProbe`).
