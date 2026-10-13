# Kế hoạch triển khai: Demo Docker "một lệnh" cho PHONGMACH

Worktree tuyệt đối (mọi file/build/chạy nhắm vào đây):
`d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\docker-demo`
TUYỆT ĐỐI KHÔNG đụng `.worktrees/p2-search-correctness`.

## Căn cứ đã đọc (không đoán)

- `package.json` gốc: `packageManager pnpm@12.8.1`, `engines.node >=22`, `type: module`. Script thật: `seed = pnpm --filter @phongmach/bff seed`, `stack:up/down` thao tác stack Medplum.
- `pnpm-workspace.yaml`: `packages/*`, `services/*`, `apps/*`; `allowBuilds.esbuild: true`.
- `tsconfig.base.json`: `noEmit: true`, `module/moduleResolution: NodeNext`, `verbatimModuleSyntax: true`. ⇒ **không có bước emit TS cho BFF**.
- Workspace packages (`packages/clinical/package.json`, `packages/catalogs/package.json`, …): `exports["."] = ./src/index.ts` (cả `types` lẫn `default`), `type: module`. ⇒ các gói được dùng **trực tiếp dưới dạng TS source** qua `tsx`, không build ra `dist`.
- `services/bff/package.json`: `start = tsx src/server.ts`, `dev = tsx watch src/server.ts`, `seed = tsx scripts/seed-demo.ts`. Phụ thuộc workspace `@phongmach/{catalogs,clinical,fhir-vn-model,print,rules}` + `@medplum/core`, `@medplum/fhirtypes`, `fastify`, `jose`, `zod`. devDeps gồm `tsx`, `typescript`, `@phongmach/trial`. ⇒ **runtime BFF chạy bằng `tsx`**, cần `tsx` có mặt (devDependency) → image cài cả dev deps.
- `services/bff/src/config.ts`: đọc env `HOST` (mặc định `127.0.0.1`), `PORT` (8110), `MEDPLUM_URL` (mặc định `http://localhost:8103`), `TENANTS_FILE` (mặc định `services/bff/.demo-tenants.json`), `AUDIT_FILE` (`services/bff/.data/audit.ndjson`), `SESSION_SECRET` (>=32 ký tự, không có thì sinh ngẫu nhiên — phiên mất khi restart), `DEMO_AUTH` (`0/1`), `SIMULATE_GATEWAY` (`0/1`, mặc định `1`), `LOG_LEVEL`.
- `services/bff/src/server.ts`: **chốt an toàn** — nếu `DEMO_AUTH!=1` thì `process.exit(1)`; và nếu `host !== '127.0.0.1' && host !== 'localhost'` thì `process.exit(1)` với thông điệp "Chế độ demo … chỉ được lắng nghe trên localhost". Có `/api/health → {ok:true}` (trong `app.ts`). Bắt SIGINT/SIGTERM để shutdown.
- `services/bff/src/app.ts`: route health = `GET /api/health`. Hook `onSend` đặt `cache-control: no-store` cho mọi phản hồi API. Log đã lọc query-string (không PII).
- `services/bff/scripts/seed-demo.ts`: `SEED_PATIENTS` (mặc định 400), `TENANTS_FILE` (ghi/đọc `.demo-tenants.json`), **idempotent**: `reuseExisting()` đọc file cũ, đăng nhập lại từng tenant; nếu còn dùng được thì tái dùng, nếu không thì `createTenants()`. Tạo bệnh nhân bằng conditional-create theo UUID xác định (`ifNoneExist`) → không trùng. Backoff 429 có sẵn (`runBatch`). Ghi file mode `0o600`.
- `services/bff/scripts/medplum-admin.ts`: `MEDPLUM_URL = env MEDPLUM_URL ?? http://localhost:8103`. Dùng `MEDPLUM_ADMIN_EMAIL` (mặc định `admin@example.com`) / `MEDPLUM_ADMIN_PASSWORD` (mặc định `medplum_admin`) để đăng nhập siêu quản trị → tạo Project + ClientApplication cho mỗi tenant. Client login bằng clientId/secret.
- `apps/clinic-web/vite.config.ts`: đọc env `BFF_URL` (mặc định `http://127.0.0.1:8110`) và `PREVIEW_PORT` (4173). PWA Workbox: `navigateFallback: '/index.html'`, `navigateFallbackDenylist: [/^\/api\//]`, `globPatterns: ['**/*.{js,css,html,png}']` ⇒ **SW không cache `/api`**, chỉ cache vỏ app. `server.proxy['/api'] = BFF_URL`.
- `apps/clinic-web/src/api.ts`: web gọi `fetch` tới đường dẫn tương đối `/api/...` (ví dụ `/api/session/demo-users`, `/api/session`, `/api/patients/search`). KHÔNG import `@medplum/*`.
- `apps/clinic-web/package.json`: `build = tsc -p tsconfig.json && vite build`. Output Vite mặc định `apps/clinic-web/dist`.
- `.gitignore`: đã bỏ qua `services/bff/.demo-tenants.json`, `services/bff/.data/`, `node_modules/`, `dist/`.
- `infra/medplum/docker-compose.yml`: `name: phongmach-medplum`; services `init-data`, `postgres` (16), `redis` (7), `medplum-server` (`medplum/medplum-server:5.2.0`, publish `${MEDPLUM_PORT:-8103}:8103`); volumes `postgres-data`, `medplum-data`; cần `.env` (POSTGRES_PASSWORD, REDIS_PASSWORD, MEDPLUM_PORT) do `setup.mjs` sinh.
- `infra/medplum/config/medplum.config.json`: `baseUrl/issuer/audience = http://localhost:8103/`, `registerEnabled:false`, `saveAuditEvents:true`.

### Trạng thái runtime đã kiểm chứng bằng Docker (không phải đọc code)

- `docker compose ls`: project **`phongmach-medplum` đang `running(3)`**, config files = compose của **repo gốc** `D:\…\phongmach\infra\medplum\docker-compose.yml` + một override từ `.claude\worktrees\…`. Network: `phongmach-medplum_default`.
- `docker ps`: `phongmach-medplum-medplum-server-1` publish `0.0.0.0:8103->8103`. **Cổng host 8080 ĐANG BẬN** (`ttchgis-demo-api`). 5173/5174/5176/5177 cũng bận (dự án ttchgis).
- `GET http://localhost:8103/healthcheck` → `{"ok":true,…,"postgres":true,"redis":true}` (khỏe).
- Cổng host trống đã đo: **8110 free, 8081 free, 8088 free** (8080 BUSY, 5317/5341 free).
- `docker run --add-host=host.docker.internal:host-gateway curl … http://host.docker.internal:8103/healthcheck` → trả `{"ok":true,…}`. ⇒ **container anh em gọi Medplum qua `host.docker.internal:8103` CHẠY ĐƯỢC** trên máy này.

## QUYẾT ĐỊNH (a) vs (b): chọn (b) — compose demo là project RIÊNG, BFF nối Medplum qua `host.docker.internal:8103`

Lý do dựa trên cách compose Medplum đang chạy:
1. Medplum đang chạy được khởi động từ **tập file compose của repo gốc + một override `.claude`** (thấy trong `docker compose ls`). Muốn "gia nhập đúng project" (cách a) phải chạy `docker compose -p phongmach-medplum` với **đúng cùng tập file đó**. Nếu dùng tập file khác (compose của worktree + compose demo), Docker sẽ coi đây là định nghĩa mới của project và **recreate/converge** các service Medplum — vi phạm bất biến "KHÔNG down/recreate/xóa volume Medplum".
2. `host.docker.internal:8103` đã kiểm chứng là tới được Medplum từ container anh em ⇒ (b) không cần đụng vào project Medplum.
3. (b) cô lập hoàn toàn: `docker compose -p phongmach-demo -f infra/demo/docker-compose.yml down` chỉ gỡ BFF+web, không bao giờ chạm Medplum.

Rủi ro CẦN KIỂM CHỨNG KHI CHẠY DOCKER (không được bỏ qua chỉ bằng đọc code):
- **Issuer/audience Medplum = `http://localhost:8103/`.** Seed và BFF nối qua `host.docker.internal:8103`. Đăng nhập siêu quản trị (`/auth/login` → `/oauth2/token`) và client-credentials login (`startClientLogin`) phải vẫn hoạt động khi base URL là `host.docker.internal` thay vì `localhost`. ⇒ **cần kiểm chứng seed chạy thành công trong container**; nếu Medplum từ chối vì host khác, phương án dự phòng ghi trong README (xem FEAT) là trỏ `MEDPLUM_URL` tới đúng tên/host mà Medplum chấp nhận, hoặc dùng mạng external của project Medplum.
- **Chốt localhost của BFF** (`server.ts` exit nếu host ≠ localhost): KHÔNG được nới lỏng (bất biến an toàn gắn với `DEMO_AUTH=1`). ⇒ BFF phải bind `127.0.0.1:8110`, nên **nginx phải proxy tới BFF trong CÙNG network namespace**. Giải pháp: chạy **nginx + BFF trong CÙNG một container** (web image), nginx `proxy_pass http://127.0.0.1:8110`. Đây là điểm thiết kế chính, CẦN KIỂM CHỨNG khi chạy Docker.
- **pnpm trong Docker** (corepack, `allowBuilds.esbuild`, workspace symlink): CẦN KIỂM CHỨNG `pnpm install` + chạy `tsx` thành công trong image Node 22.
- **SW không cache `/api`**: đã có trong `vite.config.ts`; nginx phải trả `no-cache` cho `index.html`, `sw.js`/`service-worker` và `manifest`. CẦN KIỂM CHỨNG bằng header thực tế.

### Hệ quả thiết kế container (chốt localhost ⇒ gộp nginx + BFF)

Vì BFF chỉ chịu nghe `127.0.0.1`, nginx của web KHÔNG thể proxy sang BFF ở container khác (loopback không chia sẻ giữa container). Hai lựa chọn, kế hoạch chọn **A**:

- **A (chọn): một container "web" chạy cả BFF (tsx, 127.0.0.1:8110) lẫn nginx (0.0.0.0:80).** nginx `proxy_pass http://127.0.0.1:8110/api`. BFF giữ nguyên chốt an toàn. Chỉ cổng web (80) được publish ra host. Dùng một tiến trình quản (ví dụ script khởi động chạy BFF nền rồi `nginx -g 'daemon off;'`, hoặc `s6`/`tini` + wrapper). Seed vẫn là service riêng.
- B (loại): sửa `server.ts` cho phép `0.0.0.0` — **loại**, vì nới lỏng bất biến an toàn.

> Nếu khi kiểm chứng Docker, phương án A lộ vấn đề (ví dụ cần hai image tách biệt theo yêu cầu review), phương án lùi là **vẫn giữ chốt localhost** bằng cách cho nginx và BFF share network namespace qua `network_mode: "service:bff"` trong compose (hai service, chung namespace ⇒ nginx thấy `127.0.0.1:8110`). Ghi rõ lựa chọn cuối trong README.

## Cổng host

- Web (nginx): **8081** (8080 đã BẬN — đo thực tế; task yêu cầu 8080 nhưng phải tránh cổng bận). Ghi rõ trong README lý do đổi 8080→8081.
- BFF: KHÔNG publish ra host (chỉ nội bộ container). Nếu cần soi, map tạm `8110` (đang free).
- Không đụng 8103/5317/5341/5432/6379.

## Truyền `.demo-tenants.json` từ seed sang BFF

- Named volume dùng chung `demo-tenants` mount vào **cùng đường dẫn** ở cả service `seed` và container BFF.
- Đặt `TENANTS_FILE=/demo/.demo-tenants.json` (env) cho CẢ seed và BFF, mount `demo-tenants:/demo`. Seed ghi `0o600` vào đó; BFF đọc.
- `SEED_PATIENTS=20` (nhỏ, qua env) cho nhanh.
- Idempotent: nếu volume đã có `.demo-tenants.json` và tenant còn dùng được, seed tái dùng (đã xác nhận trong code). Service `seed` đặt `restart: "no"`, BFF `depends_on: seed: condition: service_completed_successfully`.

---

## Các bước (theo thứ tự phụ thuộc)

- [ ] 1. Tạo Dockerfile BFF (dùng chung cho image web gộp) `services/bff/Dockerfile`.
      Base `node:22-bookworm-slim`; bật corepack `pnpm@12.8.1`. Copy toàn monorepo cần cho workspace (root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `packages/*`, `services/bff`), chạy `pnpm install --frozen-lockfile` (cài CẢ devDeps vì runtime cần `tsx`). Entry mặc định: `pnpm --filter @phongmach/bff start` với `HOST=127.0.0.1 PORT=8110 DEMO_AUTH=1`. Thêm `.dockerignore` loại `node_modules`, `dist`, `.data`, `.demo-tenants.json`, `.worktrees`.
      Files: `services/bff/Dockerfile`, `services/bff/.dockerignore` (hoặc `.dockerignore` ở gốc worktree với scope đúng).
      Verify: `docker build -f services/bff/Dockerfile -t phongmach-bff .` thành công; `docker run --rm phongmach-bff node -e "require('tsx')"` không lỗi (tsx có mặt). CẦN KIỂM CHỨNG pnpm install trong Docker.

- [ ] 2. Tạo Dockerfile web (multi-stage: builder Vite → runtime nginx GỘP BFF) `apps/clinic-web/Dockerfile`.
      Stage builder: Node 22 + pnpm, `pnpm install --frozen-lockfile`, `BFF_URL` không cần ở build (web gọi `/api` tương đối), chạy `pnpm --filter @phongmach/clinic-web build` → `apps/clinic-web/dist`. Stage runtime: image chứa nginx + Node 22 + tsx + source BFF + workspace deps (gộp theo quyết định A), copy `dist` vào docroot nginx, copy `nginx.conf`, copy entrypoint. Entry chạy BFF nền (127.0.0.1:8110, DEMO_AUTH=1) rồi `nginx -g 'daemon off;'`.
      Files: `apps/clinic-web/Dockerfile`, `apps/clinic-web/docker/nginx.conf`, `apps/clinic-web/docker/entrypoint.sh`.
      Verify: `docker build -f apps/clinic-web/Dockerfile -t phongmach-web .` thành công.

- [ ] 3. Viết `nginx.conf`: SPA fallback `try_files $uri /index.html`; `proxy_pass http://127.0.0.1:8110` cho `location /api/` (giữ nguyên path, truyền header); `location = /index.html`, `location = /sw.js` (và tên SW thực của vite-plugin-pwa) + `manifest.webmanifest` trả `Cache-Control: no-cache`; asset có hash cache dài. KHÔNG proxy/caching cho `/api`.
      Files: `apps/clinic-web/docker/nginx.conf`.
      Verify: sau khi `up`, `curl -I http://localhost:8081/` và `curl -I http://localhost:8081/sw.js` cho thấy header no-cache đúng; `curl http://localhost:8081/api/health` → `{"ok":true}`. CẦN KIỂM CHỨNG tên file SW thực trong `dist`.

- [ ] 4. Tạo `infra/demo/docker-compose.yml` — project RIÊNG (phương án b).
      Service `seed`: build từ `services/bff/Dockerfile`, `command` chạy `pnpm --filter @phongmach/bff seed`, env `MEDPLUM_URL=http://host.docker.internal:8103`, `TENANTS_FILE=/demo/.demo-tenants.json`, `SEED_PATIENTS=20`, `MEDPLUM_ADMIN_EMAIL/PASSWORD` (mặc định), `restart: "no"`, `extra_hosts: ["host.docker.internal:host-gateway"]`, mount `demo-tenants:/demo`. Service `web` (image gộp BFF+nginx): `depends_on: seed: service_completed_successfully`; env BFF `MEDPLUM_URL=http://host.docker.internal:8103`, `TENANTS_FILE=/demo/.demo-tenants.json`, `DEMO_AUTH=1`, `HOST=127.0.0.1`, `PORT=8110`; mount `demo-tenants:/demo` (đọc); `ports: ["8081:80"]`; `extra_hosts: host-gateway`; `healthcheck` gọi `http://127.0.0.1:8110/api/health`. Volume `demo-tenants`. Ghi `name: phongmach-demo`.
      Files: `infra/demo/docker-compose.yml`.
      Verify: `docker compose -p phongmach-demo -f infra/demo/docker-compose.yml config` hợp lệ.

- [ ] 5. Dựng thực tế và kiểm chứng end-to-end (KHÔNG đụng Medplum).
      Chạy `docker compose -p phongmach-demo -f infra/demo/docker-compose.yml up -d --build`. Xác nhận `docker compose ls` vẫn thấy `phongmach-medplum running(3)` KHÔNG đổi (không recreate). Seed completed (log có "Đã ghi …/.demo-tenants.json" và danh sách người dùng demo). `curl http://localhost:8081/api/session/demo-users` trả tenants. Mở trình duyệt `http://localhost:8081`, đăng nhập một người dùng demo, tìm bệnh nhân.
      Files: (không) — kiểm chứng.
      Verify: web truy cập được; `/api/health` ok; `docker compose -p phongmach-medplum …` KHÔNG bị recreate (so `docker ps` id container Medplum trước/sau). CẦN KIỂM CHỨNG seed login qua host.docker.internal.

- [ ] 6. Cập nhật `README.md` mục mới "## Demo bằng Docker" (tiếng Việt, giọng khớp README).
      Nội dung: lệnh một dòng (`docker compose -p phongmach-demo -f infra/demo/docker-compose.yml up -d --build`); nêu rõ **tái dùng Medplum đang chạy, KHÔNG dựng lại backend**; địa chỉ web `http://localhost:8081` (ghi lý do đổi từ 8080 do cổng bận); tài khoản/tenant demo để đăng nhập (ví dụ tenant `noi-tong-quat` / user `noi-assistant`, `noi-doctor`, `noi-owner`; tenant `nhi` / `nhi-owner`, `nhi-assistant`); cách xem log (`docker compose -p phongmach-demo logs -f`); cách DỪNG CHỈ BFF+web (`docker compose -p phongmach-demo -f infra/demo/docker-compose.yml down`) và nhấn mạnh KHÔNG đụng Medplum; ghi chú container cần Internet khi seed (Medplum gọi `api.pwnedpasswords.com` + version check); cách lấy/tạo `.demo-tenants.json` (seed tự sinh vào volume `demo-tenants`, idempotent); phương án dự phòng nếu seed/BFF không login được qua `host.docker.internal` (đổi `MEDPLUM_URL`).
      Files: `README.md`.
      Verify: đọc lại mục mới; các lệnh khớp đúng tên project/file/cổng ở các bước trên.

## Bất biến an toàn phải giữ (nhắc lại cho người thực thi)

- KHÔNG `down`/`recreate`/`down -v` project `phongmach-medplum`. Ghim image 5.2.0/16/7.
- BFF là lớp DUY NHẤT gọi Medplum; web KHÔNG thêm import `@medplum/*`.
- SW chỉ cache vỏ app, KHÔNG cache `/api`; `index.html`/SW/manifest no-cache.
- Không PII trong log; giữ nhãn mô phỏng (ký số, cổng đơn thuốc, Zalo).
- Giữ chốt an toàn `server.ts` (BFF chỉ nghe localhost); đạt mục tiêu bằng cách gộp nginx+BFF cùng namespace, KHÔNG nới lỏng chốt.

## Checklist kiểm chứng Docker thực tế

1. `docker compose -p phongmach-demo -f infra/demo/docker-compose.yml up -d --build` thành công.
2. `phongmach-medplum` vẫn `running(3)`, id container Medplum KHÔNG đổi trước/sau.
3. Seed hoàn tất (exit 0), `.demo-tenants.json` xuất hiện trong volume `demo-tenants`.
4. `curl http://localhost:8081/api/health` → `{"ok":true}`.
5. `curl http://localhost:8081/api/session/demo-users` → có 2 tenant demo.
6. `curl -I http://localhost:8081/sw.js` và `/` có `Cache-Control: no-cache`; asset hash cache dài.
7. `curl -I http://localhost:8081/api/...` KHÔNG có header cho phép cache (BFF đặt `no-store`).
8. Mở `http://localhost:8081`, đăng nhập user demo, tìm "nguyen van an", thấy cảnh báo dị ứng.
9. `docker compose -p phongmach-demo … down` chỉ gỡ web+seed+volume demo, Medplum nguyên vẹn.
