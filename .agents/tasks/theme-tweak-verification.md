# Theme tweak — ghi chú kiểm chứng

Hai thay đổi theo yêu cầu chủ sản phẩm, chỉ chạm giao diện (clinic-web):

1. **Bỏ chế độ "Theo hệ thống"** — chỉ còn Sáng / Tối.
2. **Chuyển nút Sáng/Tối lên góc trên bên phải** (dải nhãn "BẢN TRÌNH DIỄN M0"), ra khỏi cột điều hướng bên trái.

## File đã sửa

- `apps/clinic-web/src/theme.ts` — `ThemeMode` = `'light' | 'dark'`. Bỏ hẳn `matchMedia` + đăng ký/sự kiện `change` + `resolveTheme`. `readStoredMode()`: chỉ `'light'` → sáng; mọi giá trị khác (vắng, cũ `'system'`, lạ, localStorage lỗi) → `'dark'`. Mặc định tối.
- `apps/clinic-web/src/components/ThemeToggle.tsx` — chỉ hai nút, `data-testid` `theme-light` / `theme-dark`; bỏ `theme-system`.
- `apps/clinic-web/index.html` — script chống nháy hai chế độ: `localStorage 'phongmach.theme' === 'light'` thì sáng, ngược lại (kể cả vắng/cũ `'system'`) tối.
- `apps/clinic-web/src/components/DemoBanner.tsx` — gắn `<ThemeToggle />` vào trong dải nhãn; chữ nhãn bọc trong `.demo-banner-text`.
- `apps/clinic-web/src/components/Shell.tsx` — gỡ `<ThemeToggle />` và import khỏi cột điều hướng (`.topbar`).
- `apps/clinic-web/src/styles.css` — `.demo-banner` thành flex, nút đẩy phải (`margin-left:auto`), `flex-wrap` để không che chữ khi màn hẹp; `.theme-opt` lấy màu theo mực của dải (`--warn-ink`) nên đủ tương phản ở CẢ hai chủ đề; bỏ biến thể `.topbar .theme-opt` không còn dùng.
- `apps/clinic-web/src/components/Scope.tsx` — cập nhật mô tả tính năng ("Sáng / Tối ở góc trên bên phải").
- `apps/clinic-web/src/theme.test.ts`, `apps/clinic-web/src/components/theme-toggle.test.tsx` — cập nhật sang mô hình hai chế độ; thêm test di trú `'system'` → dark và mặc định dark.

## Lệnh đã chạy (Windows + Git Bash, trong worktree) và kết quả

- `pnpm typecheck` → **PASS** (exit 0; mọi package gồm clinic-web + bff).
- `pnpm test` → **PASS** (toàn repo: 11 test file BFF/packages = 131 test; clinic-web chạy riêng `pnpm --filter @phongmach/clinic-web test` = 17 test file, 244 test, exit 0).
- `pnpm --filter @phongmach/clinic-web build` → **PASS** (exit 0; chỉ còn cảnh báo kích thước chunk > 500 kB có sẵn từ trước, không phải lỗi). PWA `generateSW` sinh `dist/sw.js` bình thường.

## Bảo đảm DOM/logic đã kiểm (test jsdom trong `theme-toggle.test.tsx`, `theme.test.ts`)

- (a) Chỉ hai nút render với nhãn "Sáng"/"Tối"; không còn `theme-system`.
- (b) Chọn Sáng → `data-theme="light"`, chọn Tối → `data-theme="dark"` trên `<html>`.
- (c) Lựa chọn còn qua lần tải lại (lưu/đọc lại `localStorage 'phongmach.theme'`).
- (d) Giá trị `'system'` có sẵn trong localStorage → quy về tối, không lỗi, không trống.
- (e) Lần chạy đầu không có giá trị → tối.
- (f) Nút nằm trong dải nhãn trên (DemoBanner), không còn trong cột điều hướng — xác nhận qua `Shell.tsx` (đã gỡ), `DemoBanner.tsx` + `.demo-banner` flex `margin-left:auto` trong `styles.css`, và kịch bản chống nháy hai chế độ xuất hiện trong `dist/index.html` sau build.

## KHÔNG cần dựng lại Docker

Giao diện do Vite phục vụ (dev / `build` + `preview`). Docker Compose chỉ chạy PostgreSQL / Redis / Medplum (backend). Thay đổi này thuần giao diện, không chạm backend ⇒ **không cần build lại Docker image**. Để xem bản mới: `pnpm --filter @phongmach/clinic-web build && pnpm --filter @phongmach/clinic-web preview` (http://127.0.0.1:4173).

## Bất biến giữ nguyên

- clinic-web vẫn không import `@medplum/*` (thay đổi không chạm lớp API).
- Không thêm phụ thuộc chạy thật — chỉ React + DOM thuần.
- Nhãn trung thực "BẢN TRÌNH DIỄN M0 … Mô phỏng …" vẫn hiển thị đầy đủ ở cả hai chủ đề; màn hẹp cho nút xuống dòng, không che chữ (giữ bất biến nhãn mô phỏng).
