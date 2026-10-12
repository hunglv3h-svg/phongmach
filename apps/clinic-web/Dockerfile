# Image 'web' GỘP nginx (phục vụ dist tĩnh của Vite + SPA fallback + no-cache vỏ app)
# LẪN tiến trình BFF (tsx, nghe 127.0.0.1:8110) trong CÙNG container.
# nginx proxy_pass /api -> http://127.0.0.1:8110. Nhờ cùng network namespace mà
# chốt an toàn "BFF chỉ nghe 127.0.0.1" ở services/bff/src/server.ts KHÔNG cần nới lỏng.
# Build context là GỐC WORKTREE (monorepo):
#   docker build -f apps/clinic-web/Dockerfile -t phongmach-web .

# ---- Stage builder: cài workspace + vite build ra apps/clinic-web/dist ----
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/bff/ ./services/bff/
COPY apps/clinic-web/ ./apps/clinic-web/

RUN pnpm install --frozen-lockfile

# Web gọi '/api' tương đối (apps/clinic-web/src/api.ts) nên KHÔNG cần BFF_URL lúc build.
RUN pnpm --filter @phongmach/clinic-web build

# ---- Stage runtime: nginx + Node 22 (chạy BFF bằng tsx) trong cùng container ----
FROM node:22-bookworm-slim AS runtime

RUN corepack enable && corepack prepare pnpm@12.8.1 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends nginx curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Toàn bộ workspace đã cài node_modules + source BFF (để chạy tsx ở runtime).
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services ./services

# dist tĩnh của Vite vào docroot nginx.
COPY --from=builder /app/apps/clinic-web/dist /usr/share/nginx/html

# Cấu hình nginx + entrypoint.
COPY apps/clinic-web/docker/nginx.conf /etc/nginx/nginx.conf
COPY apps/clinic-web/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DEMO_AUTH=1 \
    HOST=127.0.0.1 \
    PORT=8110

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
