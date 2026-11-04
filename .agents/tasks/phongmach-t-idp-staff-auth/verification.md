# T-IDP — Báo cáo kiểm chứng (triển khai)

Môi trường: Windows + pnpm 12.8.1, Node v22.23.2. Worktree `.worktrees/t-idp-design` (nhánh `t-idp-design`).
Stack Medplum 5.2.0 + PostgreSQL 16 + Redis 7 (Docker Compose) đang chạy sẵn trên `localhost:8103` (healthcheck 200).

Phương án đã chốt (chủ dự án xác nhận): **B — IdP riêng UNIGIS**, M0 là IdP tối giản **nhúng trong BFF** theo ranh giới OIDC-ready. Không dựng IdP tách rời ở M0.

## 1. Phụ thuộc mới (pin đúng phiên bản)

- `@node-rs/argon2@2.2.2` — băm mật khẩu Argon2id, bản prebuilt N-API (KHÔNG node-gyp → không lỗi build trên Windows).
- `otpauth@9.5.2` — TOTP RFC 6238 thuần JS (không native).
- `@fastify/cookie@11.1.3` — cookie refresh HttpOnly.
- Kho phiên/refresh: **`node:sqlite`** (có sẵn trong Node ≥ 22.5, không thêm phụ thuộc; là lựa chọn stdlib ổn định nhất cho M0). M1 chuyển Redis chỉ cần giữ interface `SessionStore`.

`pnpm install` → thành công, không có script build nào bị chặn (không cần sửa `allowBuilds`). Argon2/otpauth cài sạch.

## 2. Kết quả từng lệnh (bản khôi phục cuối, mọi mutation đã gỡ)

| Lệnh | Kết quả |
|---|---|
| `pnpm install` | OK (502 gói, esbuild postinstall OK, argon2/otpauth không cần build) |
| `pnpm typecheck` (toàn workspace) | **PASS** — 7 package + bff + web đều `tsc` sạch |
| `pnpm test` (đơn vị toàn workspace) | **PASS** — bff 168, web 234, clinical/catalogs/rules/model/print/trial đều xanh |
| `pnpm --filter @phongmach/bff test:integration` | **PASS** — 4 file, **81** bài trên Medplum thật (gồm `real-auth.test.ts` với B2 + B7) |
| `pnpm --filter @phongmach/clinic-web build` | **PASS** — vite build + PWA (sw.js) OK |
| `pnpm --filter @phongmach/clinic-web e2e:visit` | **PASS** — **26/26** bước trên Chromium (chrome-headless-shell), chạy trên **bản build preview** (khớp CI) |

Chi tiết BFF đơn vị (13 file, 168 bài) gồm các bộ mới: `identity.test.ts` (Argon2id, mã hóa TOTP, vector TOTP, rate-limit, kho phiên consume nguyên tử + replay), `real-auth.test.ts` (B1/B2/B2b/B3/B4/B5/B6 ở mode real), `config.test.ts` (viết lại cho hợp đồng cấu hình B6). Web (16 file, 234 bài) gồm `no-medplum-import.test.ts` (B0).

### Lưu ý F5 (hạn mức đăng nhập Medplum 5/phút/IP)
Khi seed lần đầu gặp một số `429` ở khâu dựng dữ liệu (`SEED_PATIENTS=5`): seed tự chờ 15s rồi gửi lại cùng `clientUuid` và hoàn tất — **không phải lỗi mã**, đúng như cảnh báo F5. Bộ integration chạy một lần qua, không gặp 429.

### Lưu ý khi chạy e2e (môi trường, không phải lỗi mã)
- e2e phải chạy trên **bản build preview**, không phải `vite dev`: bản dev không có một số tài nguyên của PWA và gây 404 trong console (bẫy đã biết của repo; CI dùng build+preview).
- Nhật ký truy cập (giới hạn 50 dòng, mới nhất trước) có thể bị `gateway-send` của hộp thư đi lấp đầy nếu BFF chạy nền lâu giữa nhiều lần e2e với seed nhỏ và `OUTBOX_BASE_MS` thấp. Chạy e2e với BFF mới (audit sạch) + outbox mặc định → bước nhật ký (22) xanh. Đây là tương tác môi trường, không do T-IDP.

## 3. Mutation testing — chứng minh ĐỎ khi gỡ chốt (design §7, bảng B0–B7)

Mỗi mutation được áp tạm, chạy đúng bài liên quan để thấy ĐỎ, rồi khôi phục. Sau khôi phục toàn bộ, `pnpm typecheck && pnpm test` xanh lại (xác nhận ở mục 2).

| # | Chốt | Mutation áp | Bài | Kết quả |
|---|---|---|---|---|
| B0 | Web 0 import `@medplum/*` | Thêm `import type { Patient } from '@medplum/fhirtypes'` vào `format.ts` | web `no-medplum-import.test.ts` | **ĐỎ** (1 failed) → khôi phục xanh |
| B1/B5 | Thu hồi `sid` trên mọi route (gồm route đọc) | Bỏ `if (this.revocation && !isActive(sid)) return undefined` trong `session.ts verify` | bff `real-auth.test.ts -t B5` | **ĐỎ** (3 failed: logout, DELETE sessions, refresh-replay) → khôi phục |
| B2 | Tenant chỉ từ phiên đã ký | Đọc tenant từ `req.query.tenant` trong route search | bff `app.test.ts` + `real-auth.test.ts -t tenant` | **ĐỎ** (2 failed, cả demo lẫn real) → khôi phục |
| B2b | Pre-tenant token KHÔNG mở route dữ liệu | Cho `verify` coi pre-tenant token như phiên (chọn `allow[0]`) | bff `real-auth.test.ts -t B2b` | **ĐỎ** (1 failed) → khôi phục |
| B2b | `select-tenant` chỉ chọn trong `allow` đã ký | Bỏ kiểm `ticket.allow.includes(body.tenant)` | bff `real-auth.test.ts -t select-tenant` | **ĐỎ** (1 failed) → khôi phục |
| B3 | Audit login/denied fail-closed | Đổi `await recordLogin(req,'denied')` thành `recordLogin(...).catch(()=>...)` | bff `real-auth.test.ts -t fail-closed` | **ĐỎ** (1 failed: trả 401 thay vì 500) → khôi phục |
| B3 | Không PII ở login/denied | Thêm `userId: body.loginId` vào entry denied | bff `real-auth.test.ts -t "login/denied không có loginId"` | **ĐỎ** (1 failed) → khôi phục |
| B4 | Forced-enrollment TOTP cho owner/doctor | Bỏ nhánh `enroll` (cấp phiên khi chưa có TOTP) trong `identity.authenticate` | bff `real-auth.test.ts -t "chưa đăng ký TOTP"` | **ĐỎ** (1 failed) → khôi phục |
| B5 | Refresh một-lần, replay ⇒ thu hồi | Bỏ bảng `consumed_refresh`/phát hiện replay trong `sessionStore.consume` | bff `identity.test.ts -t "consume refresh"` | **ĐỎ** (2 failed: replay + song song) → khôi phục |
| B6 | `AUTH_MODE` không có mặc định | Cho `AUTH_MODE` default `'demo'` | bff `config.test.ts` | **ĐỎ** (1 failed) → khôi phục |
| B6 | Hợp đồng cấu hình (khóa bắt buộc ở real) | Bỏ `TOTP_ENC_KEY` khỏi danh sách khóa bắt buộc | bff `config.test.ts -t "thiếu khóa bắt buộc"` | **ĐỎ** (1 failed) → khôi phục |
| B6 | Hai chế độ loại trừ nhau | Đăng ký route demo kể cả ở mode real | bff `real-auth.test.ts -t "chế độ real không có cửa demo"` | **ĐỎ** (1 failed) → khôi phục |
| B7 | Danh tính người ký chốt lúc tạo mục (so participant với `cmd.doctor.userId`), không lấy từ phiên sống | Trong `medplum.ts completeVisit` bỏ vế `enc.participant?.[0]?.individual?.identifier?.value !== cmd.doctor.userId`, chỉ còn kiểm `enc.status !== 'in-progress'` (tức lấy danh tính người ký từ phiên sống) | bff **integration** `real-auth.test.ts -t B7` (Medplum thật) | **ĐỎ** (2 failed: (a) docA2 hoàn tất lượt của docA trả `201` thay vì `409 not-open`; (b) op pre-cutover trả `ok` thay vì `not-open`) → khôi phục xanh |

Ghi chú B2b (defense-in-depth): mfa/pre-tenant token ký bằng `REFRESH_SECRET` còn access ký bằng `SESSION_SECRET`; `verify` dùng khóa access nên tách khóa **tự nó** đã chặn, kiểm `typ:'access'` là lớp bảo vệ thứ hai. Mutation ở trên phá được bất biến (coi pre-tenant như phiên) nên bài B2b là có nghĩa.

B7 (danh tính người ký chốt lúc tạo mục) — **đã có bài integration riêng với RED proof** (sửa theo review vòng 2): cơ chế là so `enc.participant[0].individual.identifier.value !== cmd.doctor.userId` trong `medplum.ts completeVisit`. `real-auth.test.ts` thêm một describe `B7` chạy trên Medplum thật với **xác thực thật** gồm hai bác sĩ cùng tenant `a` (docA, docA2):
- (a) docA mở hồ sơ; **docA2 — phiên hợp lệ, cùng tenant** — gọi `/complete` ⇒ `409 not-open`; đọc lại lượt khám vẫn `in-exam`, participant vẫn `BS. A`; chính docA mới hoàn tất được (`201`). Chứng minh danh tính người ký lấy từ mục (người đã mở), không từ phiên sống lúc gửi.
- (b) dựng lệnh trực tiếp vào store với `doctor.userId: 'demo-pre-cutover'` (giả lập mục tạo trước mốc cắt, mang `userId` thời demo không khớp nhân viên thật) ⇒ `completeVisit` trả `not-open`, lượt khám vẫn mở, participant vẫn docA — không âm thầm ghi dưới danh tính phiên sống (hành vi di trú demo→thật §6(4): từ chối, để mục ở trạng thái cần xử lý).

Lưu ý: bài `clinical.test.ts` (mode demo) chỉ phủ nhánh danh tính **khớp** (open+complete cùng `a-doctor`) và chốt `taken` phía mở; **không** phủ nhánh từ chối lúc hoàn tất — đó là lý do B7 cần bài riêng ở `real-auth.test.ts`. Bộ integration giờ là **4 file, 81 bài** (thêm 2 bài B7).

## 4. Đối chiếu checklist thiết kế §9

- `session.ts`: hai token (access `typ:'access'` ~15′ + refresh opaque một-lần qua kho), `sid`, `mfaToken`/pre-tenant token (`typ:'mfa'`/`'pretenant'`, ký `REFRESH_SECRET`); `verify` kiểm hết hạn + `typ` + thu hồi `sid`; đồng hồ tiêm được (test hết hạn bằng thời gian ảo). ✔
- `sessionStore.ts` (MỚI): SQLite `node:sqlite` qua `SESSION_STORE_URL`; `create/consume/revoke/isActive/sessionInfo/activeSids`; consume nguyên tử (UNIQUE refresh_hash + CAS theo hash hiện hành) + bảng `consumed_refresh` phát hiện replay ⇒ thu hồi `sid`. ✔
- `identity/` (MỚI): `types.ts` (hồ sơ nhân viên + zod), `crypto.ts` (Argon2id OWASP params + AES-256-GCM mã hóa bí mật TOTP bằng `TOTP_ENC_KEY`), `totp.ts` (otpauth, cửa sổ ±1), `rateLimit.ts` (§4.6, thời gian ảo), `connectors.ts` (SMS-OTP mô phỏng-có-nhãn), `index.ts` (`IdentityStore`: authenticate → MFA none/verify/enroll, forced-enrollment owner/doctor, verifyMfaCode, begin/completeEnroll, createStaff/assignRole/list; `StaffClaim` = ranh giới OIDC-ready). ✔
- `audit.ts`: `tenant`/`userId` optional cho `action:'login'`; `record()` đường dữ liệu khẳng định có phiên lúc chạy (NIT-1); `recordLogin()` không dùng `req.session`. ✔
- `app.ts`: route real `POST /api/session` (mật khẩu), `/api/session/mfa`, `/api/session/select-tenant`, `/api/session/refresh`, `/api/session/logout`, `DELETE /api/sessions/:sid` (owner), `GET|POST /api/staff` (owner); `recordLogin` fail-closed nhánh denied; đăng ký route theo `deps.mode` loại trừ; `requireSession` trả `sid` qua `verify` trên mọi route. Demo mode giữ `demo-users` + login không mật khẩu + logout no-op (để giao diện gọi logout thống nhất). ✔
- `config.ts` + `server.ts`: `AUTH_MODE` enum không default; hợp đồng cấu hình (`REFRESH_SECRET`, `TOTP_ENC_KEY`, `SESSION_STORE_URL`, `SESSION_SECRET` bắt buộc ở real, cấm sinh ngẫu nhiên, `REFRESH_SECRET ≠ SESSION_SECRET`); thiếu/sai ⇒ `loadConfig` ném ⇒ exit trước listen; real bind ngoài localhost, demo giữ chốt localhost. ✔ Theo review vòng 2 (non-blocking `staff-file-not-required-real`): `STAFF_FILE` giữ đúng hợp đồng §5.1.1 (không bắt buộc) nhưng `server.ts` thêm **cảnh báo khởi động** khi real mode nạp 0 nhân viên — không im lặng boot với danh sách rỗng (fail-fast spirit), hành vi người dùng không đổi. ✔
- Web: `api.ts` thêm `login/mfa/selectTenant/refresh/logout` (cookie `credentials:'include'`), giữ `demoLogin/demoUsers`, 0 import `@medplum/*`; `Login.tsx` form mật khẩu + bước MFA/enroll + chọn tenant, demo vẫn liệt kê user; `App.tsx` gọi `api.logout` + logout-khi-hết-mục-chờ → destroy (Shell đã có), giữ kho khi còn mục chờ; `Scope.tsx` đăng nhập → REAL + dòng SMS-OTP ở SIMULATED; `DemoBanner.tsx` chỉ hiện theo mode, bỏ "Chưa có xác thực thật" khỏi đường thật. ✔
- NIT: NIT-1 (record() assert) ✔; NIT-5 (pin lib + Argon2 params) ✔; NIT-6 (không log body đăng nhập, redact cookie) ✔; NIT-2 (TOTP tất định cho test) ✔.
- Tài liệu: README "Giới hạn", `docs/ke-hoach-trien-khai.md` §5.6/§5.7/§5.9 + A8 + ma trận T-IDP; `e2e/visit.mjs` bước "Phạm vi" kiểm đăng nhập ở REAL + SMS-OTP ở SIMULATED; `infra/dev-up.sh`, `e2e-cycles.mjs`, `trial.mjs`, `bff-search.mjs` thêm `AUTH_MODE=demo`. ✔

## 5. Bất biến tái chứng minh (design §7)

1. **Tenant từ JWT đã ký, không từ request** — B2 (đơn vị + tích hợp real + demo), B2b (pre-tenant/allow). ✔
2. **Audit trước khi trả, fail-closed, không PII — gồm login/denied tiền-phiên** — B3. ✔
3. **BFF là lớp duy nhất gọi Medplum; web 0 import `@medplum/*`** — B0. ✔

Không có lệnh nào không chạy được ở môi trường này: stack Medplum sẵn sàng nên typecheck/test/integration/e2e đều chạy thật và báo kết quả ở trên.

## 6. Chạy lại khi chốt (finalize) — xác nhận trước commit

Chạy lại trên đúng cây làm việc `.worktrees/t-idp-design` ngay trước khi commit (stack Medplum `phongmach-medplum-*` đang chạy, healthcheck `http://localhost:8103` trả 200; BFF demo ở `127.0.0.1:8110` trả `/api/session/demo-users`):

| Lệnh | Kết quả (lần chạy chốt) |
|---|---|
| `pnpm install` | **PASS** — "Already up to date", 9 workspace project, không script build nào bị chặn |
| `pnpm typecheck` | **PASS** — 7 package + bff + web `tsc` sạch |
| `pnpm test` | **PASS** — bff **168**, web **234**, clinical **83**, print **4**, trial **13** (+ catalogs/rules/model) đều xanh; cảnh báo `node:sqlite` experimental là mong đợi |
| `pnpm --filter @phongmach/bff test:integration` | **PASS** — **4 file, 81 bài** trên Medplum thật (gồm `real-auth.test.ts` B2 + B7); lần này KHÔNG gặp F5 429 |
| `pnpm --filter @phongmach/clinic-web build` | **PASS** — vite build + PWA `sw.js`/`workbox-*.js` sinh ra |
| `pnpm e2e` (visit) | **KHÔNG chạy lại được ở phiên chốt này** — xem ghi chú dưới |

**Ghi chú e2e (trung thực):** bài `e2e:visit` đã được chạy và PASS **26/26** ở lần kiểm chứng trước (mục 2) trên bản build preview và đã được review DUYỆT (`review.json` = APPROVED). Ở phiên chốt này KHÔNG tái chạy được vì: dịch vụ web đang chạy trên cổng 5173 là **vite dev server** của người dùng (không phải build preview — e2e cần preview theo bẫy đã biết của repo), và trình chạy nền của môi trường chốt chặn việc khởi động `vite preview` ở chế độ nền nên không dựng được preview riêng trên cổng trống. KHÔNG dừng tiến trình của người dùng (quy ước cổng của repo). Vì vậy kết quả e2e lấy theo lần chạy trước đã được review xác nhận; không tuyên bố đã tái chạy ở phiên chốt. `pnpm --filter @phongmach/clinic-web build` đã PASS ở phiên chốt nên artefact e2e là hiện hành.

Bất biến tái khẳng định ở phiên chốt: B2 + B7 chạy xanh trong integration thật (tenant chỉ từ JWT đã ký); B0 (web 0 import `@medplum/*`) + B3 (audit fail-closed, không PII) nằm trong `pnpm test` đã PASS.
