# BFF (Fastify) chạy TypeScript trực tiếp bằng tsx — KHÔNG build ra dist.
# Vì runtime cần tsx (devDependency), image CÀI CẢ devDependencies (không dùng --prod).
# Build context là GỐC WORKTREE (monorepo), build bằng:
#   docker build -f services/bff/Dockerfile -t phongmach-bff .
FROM node:22-bookworm-slim

# pnpm qua corepack, ghim đúng phiên bản của monorepo.
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /app

# Chép manifest workspace trước để tận dụng cache lớp cài đặt.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/bff/ ./services/bff/
# --frozen-lockfile đòi MỌI importer trong lockfile có mặt. apps/clinic-web là một
# workspace project; chỉ cần manifest của nó (KHÔNG cần source) để pnpm giải workspace.
COPY apps/clinic-web/package.json ./apps/clinic-web/package.json

# Cài CẢ devDependencies: runtime BFF chạy tsx (devDependency).
RUN pnpm install --frozen-lockfile

ENV HOST=127.0.0.1 \
    PORT=8110 \
    DEMO_AUTH=1

# scripts.start = "tsx src/server.ts"
CMD ["pnpm", "--filter", "@phongmach/bff", "start"]
