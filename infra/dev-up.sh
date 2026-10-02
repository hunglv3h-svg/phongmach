#!/usr/bin/env bash
# Dựng lại môi trường phát triển từ đầu hoặc đưa nó về trạng thái chạy. Chạy lại nhiều lần được.
#
#   infra/dev-up.sh            dựng Medplum, nạp dữ liệu demo nếu chưa có, chạy BFF và giao diện (bản dev)
#   infra/dev-up.sh --stop     dừng BFF và giao diện (không dừng Medplum)
#
# Biến môi trường tùy chọn:
#   SEED_PATIENTS     số bệnh nhân giả mỗi phòng khám khi nạp lần đầu (mặc định 5; 400 mất vài phút vì hạn mức của Medplum)
#   OUTBOX_BASE_MS, OUTBOX_CAP_MS   rút ngắn thời gian chờ thử lại của hộp thư đi (bài e2e dùng 500 và 2000)
#   DEV_LOG_DIR       nơi ghi log (mặc định /tmp/phongmach-dev)
#
# Chỉ dành cho máy dev/sandbox: chạy BFF ở chế độ DEMO_AUTH=1 (không có xác thực thật) trên localhost.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${DEV_LOG_DIR:-/tmp/phongmach-dev}"
MEDPLUM="http://localhost:8103"
BFF="http://127.0.0.1:8110"
WEB="http://127.0.0.1:5173"
mkdir -p "$LOGS"
cd "$ROOT"

say() { printf '▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
http() { curl -s -m 3 -o /dev/null -w '%{http_code}' --noproxy '*' "$1" 2>/dev/null; }

# Dừng theo nhóm tiến trình đã ghi lại: `pnpm start` sinh tiến trình con nên kill một PID là không đủ,
# và không dùng pkill theo mẫu chữ (đã từng khớp nhầm chính shell đang chạy lệnh).
stop_one() {
  local name="$1" file="$LOGS/$1.pid"
  [ -f "$file" ] || return 0
  local pid; pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; say "đã dừng $name (nhóm $pid)"; fi
  rm -f "$file"
}

if [ "${1:-}" = "--stop" ]; then
  stop_one bff
  stop_one web
  exit 0
fi

# 1. pnpm và phụ thuộc. Lưu ý: shim corepack của pnpm hỏng trong sandbox này nên cài pnpm trực tiếp bằng npm.
if ! command -v pnpm >/dev/null 2>&1; then
  say "cài pnpm (npm i -g pnpm@12)"
  npm i -g pnpm@12 >/dev/null 2>&1 || fail "Không cài được pnpm"
fi
if [ ! -d node_modules ]; then
  say "pnpm install"
  pnpm install --frozen-lockfile >"$LOGS/install.log" 2>&1 || { tail -20 "$LOGS/install.log"; fail "pnpm install lỗi"; }
fi

# 2. Docker. Ở máy dev thường docker đã chạy; trong sandbox không có systemd nên phải tự bật dockerd.
if ! docker info >/dev/null 2>&1; then
  command -v dockerd >/dev/null 2>&1 || fail "Không có docker/dockerd"
  say "khởi động dockerd (log: $LOGS/dockerd.log)"
  sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  nohup dockerd >"$LOGS/dockerd.log" 2>&1 &
  for _ in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || { tail -20 "$LOGS/dockerd.log"; fail "dockerd không lên"; }
fi

# 3. Medplum (PostgreSQL, Redis, server). setup.mjs chỉ sinh cấu hình và bí mật khi chưa có.
[ -f infra/medplum/.env ] || { say "sinh cấu hình Medplum"; node infra/medplum/setup.mjs >/dev/null || fail "setup.mjs lỗi"; }
say "docker compose up (lần đầu mất khoảng 1 phút để chạy migration)"
docker compose -f infra/medplum/docker-compose.yml up -d >"$LOGS/compose.log" 2>&1 || { tail -20 "$LOGS/compose.log"; fail "compose lỗi"; }
for _ in $(seq 1 90); do [ "$(http "$MEDPLUM/healthcheck")" = 200 ] && break; sleep 2; done
[ "$(http "$MEDPLUM/healthcheck")" = 200 ] || fail "Medplum không sẵn sàng sau 3 phút (docker compose -f infra/medplum/docker-compose.yml logs medplum-server)"

# 4. Dữ liệu demo. Chạy lại seed an toàn (không tạo trùng) nhưng mất thời gian, nên chỉ nạp khi chưa có file phòng khám.
if [ ! -f services/bff/.demo-tenants.json ]; then
  say "nạp dữ liệu demo (SEED_PATIENTS=${SEED_PATIENTS:-5})"
  SEED_PATIENTS="${SEED_PATIENTS:-5}" pnpm seed >"$LOGS/seed.log" 2>&1 || { tail -20 "$LOGS/seed.log"; fail "seed lỗi"; }
fi

# 5. BFF và giao diện (bản dev). Mỗi cái một nhóm tiến trình riêng để dừng gọn.
# Tiến trình con phải bỏ hẳn stdin/stdout/stderr của script này, nếu không nó giữ đầu ống (ví dụ `| tail`) và lệnh gọi script không bao giờ kết thúc.
launch() {
  local name="$1" dir="$2"
  shift 2
  ( cd "$dir" || exit 1; exec setsid nohup "$@" >"$LOGS/$name.log" 2>&1 </dev/null ) &
  echo $! >"$LOGS/$name.pid"
}
stop_one bff
stop_one web
say "chạy BFF (log: $LOGS/bff.log)"
launch bff services/bff env DEMO_AUTH=1 ${OUTBOX_BASE_MS:+OUTBOX_BASE_MS=$OUTBOX_BASE_MS} ${OUTBOX_CAP_MS:+OUTBOX_CAP_MS=$OUTBOX_CAP_MS} pnpm start
say "chạy giao diện (log: $LOGS/web.log)"
launch web . pnpm dev:web
for _ in $(seq 1 40); do [ "$(http "$BFF/api/health")" = 200 ] && break; sleep 1; done
for _ in $(seq 1 40); do [ "$(http "$WEB/")" = 200 ] && break; sleep 1; done
[ "$(http "$BFF/api/health")" = 200 ] || { tail -20 "$LOGS/bff.log"; fail "BFF không lên"; }
[ "$(http "$WEB/")" = 200 ] || { tail -20 "$LOGS/web.log"; fail "giao diện không lên"; }

cat <<EOF

Sẵn sàng:
  Medplum  $MEDPLUM      BFF  $BFF      Giao diện  $WEB
  Đăng nhập demo: chọn phòng khám và người dùng ngay trên màn hình (không có mật khẩu).
  Kiểm thử đầu-cuối:  pnpm e2e        Dừng BFF + giao diện:  infra/dev-up.sh --stop
EOF
