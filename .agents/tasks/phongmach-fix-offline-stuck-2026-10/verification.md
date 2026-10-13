# Kiểm chứng: sửa chế độ "Mất mạng" không tự thoát khi hết mục chờ

Nhánh: `fix/offline-mode-stuck`. Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\fix-offline-stuck`.
Nguồn chính: `.agents/tasks/dieu-tra-che-do-mat-mang.md` (báo cáo điều tra, mục 5). Ngày chạy: 2026-10-13 (giờ máy), Windows + Git Bash/pwsh.

> Người review KHÔNG chạy lại các bộ test này. Dưới đây ghi CHÍNH XÁC lệnh đã chạy và kết quả quan sát được.

## 1. Bản sửa (đúng 4 điểm theo mục 5 báo cáo)

1. **Thăm dò định kỳ khi mất mạng.** `apps/clinic-web/src/local/sync.ts`: thêm tùy chọn `probe`, `probeMs` (mặc định 12.000 ms), `canProbe` cho `SyncEngine`; hàm riêng `armProbe()`/`runProbe()` (test được bằng thời gian ảo). Khi `online === false`: mỗi ~12 giây gọi `probe()` (= `GET /api/health`); thành công → `observe(true)` (tự gọi `syncNow()`); lỗi → không làm gì, hẹn lại. DỪNG khi `online === true`, khi `paused === 'unauthorized'`, khi `!navigator.onLine` (sự kiện `online` lo được), khi tab ẩn (`canProbe()===false`), khi `stop()`. `apps/clinic-web/src/local/OfflineProvider.tsx` truyền `probe: () => api.health()` và `canProbe: () => document.visibilityState !== 'hidden'`. Thêm `api.health` vào `apps/clinic-web/src/api.ts` (`GET /api/health`, không token).
2. **Đọc lại `navigator.onLine` ở `visibilitychange`/`focus` và khi bộ máy báo có mạng lại** (sửa lỗi 3.3) trong `OfflineProvider.tsx`: `browserOnline` không còn chỉ phụ thuộc hai sự kiện `online`/`offline`.
3. **Bỏ khóa nút "Đồng bộ ngay".** `apps/clinic-web/src/components/SyncPanel.tsx`: bỏ `disabled={!view.online}`, nhãn đổi thành "Thử kết nối lại" khi mất mạng; nút gọi `actions.syncNow()` → `SyncEngine.syncNow()` nay thăm dò trước khi gửi khi đang mất mạng. `apps/clinic-web/src/components/SyncBar.tsx`: bỏ `disabled={!view.online}` ở nút `sync-now`. Bài test `apps/clinic-web/src/components/sync.test.tsx` trước KHẲNG ĐỊNH nút bị khóa khi mất mạng — đã sửa thành khẳng định KHÔNG bị khóa, ghi rõ lý do đổi quyết định trong chú thích bài test và commit.
4. **Dọn mâu thuẫn ở `Metrics.tsx`/`Gateway.tsx`:** cho tải số qua `client.call(() => api.…)` để lời gọi thành công gỡ cờ online (và lỗi mạng cũng được tính). Chỉ sửa phần đường-gọi-API, giữ nguyên phần hiển thị (phối hợp với phiên M0-6 có thể chạm `Metrics.tsx`).

### Bất biến giữ nguyên
- Web vẫn 0 import `@medplum/*`; chỉ gọi `/api`. Thăm dò CHỈ `GET /api/health` (không token, không chạm Medplum, không ghi nhật ký) — KHÔNG đổi sang `/api/queue`.
- N3: `observe(true)` chỉ gọi `syncNow()`; `runOnce` vẫn bỏ qua mọi mục ATTENTION — có bài test khẳng định (xem mục 3, bài N3).
- Nhiều tab: thăm dò chỉ chạy ở tab đang hiện (`canProbe`).

## 2. Lệnh kiểm chứng và kết quả (chạy thật trong worktree)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | **Xanh.** Mọi package qua `tsc`; `apps/clinic-web` Done in 9.7s. Exit 0. |
| `pnpm test` | **Xanh.** 10 project có test, tổng kết `Test Files 14 passed (14)` cho clinic-web; `src/local/sync.test.ts (32 tests)` (trước 27, thêm 5 bài thăm dò), `src/components/sync.test.tsx` xanh. Toàn repo Exit 0. |
| `pnpm build` | **Xanh.** `apps/clinic-web` `✓ built in 3.94s`, `dist/sw.js`, `dist/assets/index-*.js`. Exit 0. |

## 3. Mutation testing — ĐỎ khi gỡ biện pháp thăm dò, rồi hoàn nguyên

Đột biến: trong `apps/clinic-web/src/local/sync.ts`, hàm `armProbe()`, chèn `return;` ngay trước dòng `this.probeTimer = this.clock.setTimeout(...)` (vô hiệu hóa việc hẹn thăm dò).

Lệnh:
```
pnpm --filter @phongmach/clinic-web exec vitest run src/local/sync.test.ts
```

Kết quả (ĐỎ, 4 bài thất bại trong nhóm "thăm dò máy chủ khi mất mạng"):
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
→ Bài thăm dò chỉ đáng tin sau khi đã thấy nó ĐỎ khi gỡ biện pháp. Đã hoàn nguyên về bản đúng.

Bài N3 (`N3 giữ nguyên…`) dựng chuỗi có mục `open` xung đột 409 (ATTENTION) và mục bị giữ, rồi để thăm dò gọi `observe(true)→syncNow()`: khẳng định mục xung đột KHÔNG bị gửi lại, payload KHÔNG đổi, mục bị giữ KHÔNG được gửi, `bff.completions.size === 0`.

## 4. e2e (Chromium thật: chrome-headless-shell của Playwright `chromium_headless_shell-1243`)

Hạ tầng: BFF ở `127.0.0.1:8110` (`DEMO_AUTH=1`, `TENANTS_FILE` trỏ tới tệp bí mật đã có của worktree `m0-6-demo-rehearsal` — cùng Medplum localhost:8103, KHÔNG seed lại), bản build + `vite preview` ở cổng 4173 (`BFF_URL=http://127.0.0.1:8110`). Preview bind vào `localhost`/IPv6 nên dùng `E2E_URL=http://localhost:4173`. Trước khi chạy: `$env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"` (openssl).

Lệnh và kết quả:
```
pnpm --filter @phongmach/clinic-web e2e            → Đạt 13/13   (smoke)
pnpm --filter @phongmach/clinic-web e2e:visit      → Đạt 25/25
pnpm --filter @phongmach/clinic-web e2e:offline    → Đạt 16/16
pnpm --filter @phongmach/clinic-web e2e:conflict   → Đạt 13/13
```
Mọi bộ Exit 0, bước cuối "không có lỗi nào trong console" đều xanh.

**Bước e2e mới (offline-sign.mjs, bước 1):** "tự thoát Mất mạng khi hết mục chờ": `page.route('**/api/**', route.abort('internetdisconnected'))` (KHÔNG `context.setOffline`), hàng đợi RỖNG (vừa đăng nhập), mở tab Hàng chờ để một lần đọc `/api` lỗi → `offline-badge`; khẳng định `data-pending === '0'`; `page.unroute` (bỏ chặn, KHÔNG đổi `navigator.onLine`, KHÔNG bấm gì); rồi `eventually(() => page.evaluate(async () => …sync-status data-online==='true'…), 30_000)`. KHÔNG dùng `page.waitForFunction` với hàm async. Bước này chạy trên BẢN BUILD (preview). → xanh ("tự thoát Mất mạng… đưa về Có mạng trong ~30s").

Nhiễu từ phiên khác: cổng 5173 do một phiên khác giữ (web+8103) — KHÔNG đụng; không gặp vết 409/hai-BFF trong các lần chạy này.

## 5. Bất biến môi trường (xác nhận cuối)

`docker ps --filter name=phongmach-medplum` trước và sau khi chạy e2e — 3 container GIỮ NGUYÊN id, vẫn `Up`:
```
6bdd98a57bb8 medplum/medplum-server:5.2.0   Up 23 hours
396bce70e6ed postgres:16                    Up 23 hours (healthy)
75c24bc8cbaf redis:7                        Up 23 hours (healthy)
```
KHÔNG chạy `docker compose up/down/down -v`, KHÔNG đụng volume, CHỈ `docker ps`.

Dọn tiến trình tạm theo PID bằng `Stop-Process -Id` (BFF 8110, preview 4173), KHÔNG `pkill -f` theo mẫu chữ. Sau khi dọn: cổng 8110 và 4173 không còn listener.

## 6. Hạn chế / ghi chú

- Chưa thử trên máy tính bảng / trình duyệt khác / tắt-bật Wi-Fi thật trên máy Windows (sẽ cắt mạng của chính phiên làm việc) — như báo cáo điều tra đã nêu.
- Tần suất thăm dò 12 giây là mặc định cho demo; `eventually` chờ tới 30 giây nên một chu kỳ thăm dò là đủ.
- Tệp bí mật `.demo-tenants.json` KHÔNG commit (chỉ dùng qua biến môi trường `TENANTS_FILE` lúc chạy e2e).
