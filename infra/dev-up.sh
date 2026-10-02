#!/usr/bin/env bash
# Dựng lại môi trường phát triển từ đầu hoặc đưa nó về trạng thái chạy. Chạy lại nhiều lần được.
# Chạy được trên Linux (sandbox, máy dev) và trên Windows bằng Git Bash + Docker Desktop.
#
#   infra/dev-up.sh            dựng Medplum, nạp dữ liệu demo nếu chưa có, chạy BFF và giao diện (bản dev)
#   infra/dev-up.sh --stop     dừng BFF và giao diện (không dừng Medplum)
#
# Biến môi trường tùy chọn:
#   WEB_PORT          cổng của giao diện. Không đặt: dùng 5173; nếu 5173 đang do tiến trình khác giữ (dự án khác trên cùng máy)
#                     thì tự chọn cổng trống đầu tiên từ 5183 và in ra. Có đặt mà cổng đang bị giữ: dừng và báo.
#                     Script không bao giờ dừng tiến trình không phải do nó chạy.
#   SEED_PATIENTS     số bệnh nhân giả mỗi phòng khám khi nạp lần đầu (mặc định 5; 400 mất vài phút vì hạn mức của Medplum)
#   OUTBOX_BASE_MS, OUTBOX_CAP_MS   rút ngắn thời gian chờ thử lại của hộp thư đi (bài e2e dùng 500 và 2000)
#   DEV_LOG_DIR       nơi ghi log, PID và cổng đang dùng (mặc định /tmp/phongmach-dev; trong Git Bash, /tmp là %TEMP%)
#
# Chỉ dành cho máy dev/sandbox: chạy BFF ở chế độ DEMO_AUTH=1 (không có xác thực thật) trên localhost.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${DEV_LOG_DIR:-/tmp/phongmach-dev}"
WEB_PORT_CHOSEN="${WEB_PORT:-}"
WEB_PORT="${WEB_PORT:-5173}"
BFF_PORT=8110
MEDPLUM="http://localhost:8103"
BFF="http://127.0.0.1:$BFF_PORT"
# Corepack hỏi xác nhận trước khi tải pnpm lần đầu; script này chạy không có người trả lời.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
mkdir -p "$LOGS"
cd "$ROOT"

say() { printf '▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
http() { curl -s -m 3 -o /dev/null -w '%{http_code}' --noproxy '*' "$1" 2>/dev/null; }
# Có tiến trình nào đang nghe ở cổng này trên 127.0.0.1 không (kể cả dịch vụ không phải HTTP).
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# Cổng mà tiến trình vừa dừng của chính script đã giữ (stop_one ghi vào OURS) cần một lúc mới trống: chờ tối đa 10 giây.
# Cổng khác đang bị giữ thì là của tiến trình lạ: trả lời ngay, không chờ.
OURS=""
port_free() {
  port_busy "$1" || return 0
  case " $OURS " in *" $1 "*) ;; *) return 1 ;; esac
  for _ in $(seq 1 10); do sleep 1; port_busy "$1" || return 0; done
  return 1
}

case "$WEB_PORT" in ''|*[!0-9]*) fail "WEB_PORT phải là số cổng, đang là \"$WEB_PORT\"";; esac

# Có setsid (Linux): mỗi dịch vụ là một nhóm tiến trình, dừng cả nhóm.
# Không có setsid (Git Bash trên Windows): node.exe là tiến trình Windows gốc, không theo nhóm tiến trình của MSYS,
# nên dừng cả cây bằng taskkill theo PID Windows của tiến trình đầu chuỗi.
HAS_SETSID=0
command -v setsid >/dev/null 2>&1 && HAS_SETSID=1

# Dừng theo PID đã ghi lại: `pnpm start` sinh tiến trình con nên kill một PID là không đủ,
# và không dùng pkill theo mẫu chữ (đã từng khớp nhầm chính shell đang chạy lệnh).
stop_one() {
  local name="$1" file="$LOGS/$1.pid" pid="" recorded="" winpid=""
  [ -f "$file" ] || return 0
  read -r pid recorded <"$file" || true
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    OURS="$OURS $(cat "$LOGS/$name.port" 2>/dev/null || true)"
    if [ "$HAS_SETSID" = 1 ]; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; say "đã dừng $name (nhóm $pid)"
    else
      winpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
      if [ -n "$recorded" ] && [ "$recorded" != "$winpid" ]; then
        # %TEMP% không bị xóa khi khởi động lại máy: tệp PID cũ có thể trùng số với một tiến trình không liên quan.
        say "bỏ qua tệp PID cũ của $name ($pid không còn là tiến trình script đã chạy)"
      elif [ -n "$winpid" ] && command -v taskkill >/dev/null 2>&1; then
        taskkill //PID "$winpid" //T //F >/dev/null 2>&1; say "đã dừng $name (cây tiến trình Windows $winpid)"
      else
        kill "$pid" 2>/dev/null; say "đã dừng $name ($pid)"
      fi
    fi
  fi
  rm -f "$file" "$LOGS/$name.port"
}

if [ "${1:-}" = "--stop" ]; then
  stop_one bff
  stop_one web
  exit 0
fi

# 0. Dừng BFF và giao diện của lần chạy trước rồi kiểm cổng, trước các bước lâu (cài đặt, nạp dữ liệu).
stop_one bff
stop_one web
# Cổng còn bị giữ sau khi đã dừng tiến trình của chính script thì đó là tiến trình lạ (thường là dự án khác trên cùng máy):
# không dừng nó, không chạy chồng lên nó.
port_free "$BFF_PORT" || fail "Cổng $BFF_PORT (BFF) đang do một tiến trình khác giữ, không phải do script này chạy. Script không dừng tiến trình lạ: tự dừng nó rồi chạy lại."
if ! port_free "$WEB_PORT"; then
  [ -z "$WEB_PORT_CHOSEN" ] || fail "Cổng $WEB_PORT (đặt qua WEB_PORT) đang do một tiến trình khác giữ, không phải do script này chạy. Script không dừng tiến trình lạ: chọn cổng khác."
  taken="$WEB_PORT"
  for p in $(seq 5183 5199); do port_free "$p" && { WEB_PORT="$p"; break; }; done
  [ "$WEB_PORT" != "$taken" ] || fail "Cổng $taken và các cổng 5183–5199 đều đang bị giữ. Đặt WEB_PORT sang một cổng trống."
  say "cổng $taken đang do tiến trình khác giữ (dự án khác?): không đụng tới, giao diện dùng cổng mới $WEB_PORT (đặt WEB_PORT để cố định)"
fi
WEB="http://127.0.0.1:$WEB_PORT"

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
  command -v dockerd >/dev/null 2>&1 || fail "Docker chưa chạy và không có dockerd để tự bật (trên Windows: mở Docker Desktop rồi chạy lại)"
  say "khởi động dockerd (log: $LOGS/dockerd.log)"
  sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  # Sandbox khởi động lại để lại /var/run/docker.pid của dockerd cũ: dockerd mới từ chối chạy. Chỉ xóa khi không còn dockerd nào.
  if [ -f /var/run/docker.pid ] && ! pgrep -x dockerd >/dev/null 2>&1; then rm -f /var/run/docker.pid; fi
  nohup dockerd >"$LOGS/dockerd.log" 2>&1 &
  for _ in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || { tail -20 "$LOGS/dockerd.log"; fail "dockerd không lên"; }
fi

# 3. Medplum (PostgreSQL, Redis, server). setup.mjs chỉ sinh cấu hình và bí mật khi chưa có.
# Bí mật (.env, config/) nằm trong thư mục làm việc và không commit, còn stack và volume thì dùng chung cho cả máy.
# Thư mục làm việc khác (worktree mới) chưa có .env mà sinh mật khẩu mới thì sẽ không khớp volume Postgres đã có:
# stack đang chạy thì dùng lại nguyên trạng; stack đã dừng thì báo, không sinh mật khẩu mới và không xóa volume.
if [ ! -f infra/medplum/.env ] && [ "$(http "$MEDPLUM/healthcheck")" = 200 ]; then
  say "Medplum đang chạy ở $MEDPLUM (dựng từ thư mục khác): dùng lại, không sinh cấu hình mới"
else
  if [ ! -f infra/medplum/.env ]; then
    if docker volume inspect phongmach-medplum_postgres-data >/dev/null 2>&1; then
      fail "Đã có volume Postgres của stack phongmach-medplum nhưng Medplum không chạy và thư mục này chưa có infra/medplum/.env. Nếu container chỉ đang dừng: docker compose -p phongmach-medplum start, rồi chạy lại script. Nếu container đã bị gỡ: chép .env và config/ của infra/medplum từ thư mục đã dựng stack. Không xóa volume khi chưa hỏi chủ dự án."
    fi
    say "sinh cấu hình Medplum"
    node infra/medplum/setup.mjs >/dev/null || fail "setup.mjs lỗi"
  fi
  say "docker compose up (lần đầu mất khoảng 1 phút để chạy migration)"
  docker compose -f infra/medplum/docker-compose.yml up -d >"$LOGS/compose.log" 2>&1 || { tail -20 "$LOGS/compose.log"; fail "compose lỗi"; }
  for _ in $(seq 1 90); do [ "$(http "$MEDPLUM/healthcheck")" = 200 ] && break; sleep 2; done
  [ "$(http "$MEDPLUM/healthcheck")" = 200 ] || fail "Medplum không sẵn sàng sau 3 phút (docker compose -f infra/medplum/docker-compose.yml logs medplum-server)"
fi

# 4. Dữ liệu demo. Chạy lại seed an toàn (không tạo trùng) nhưng mất thời gian, nên chỉ nạp khi chưa có file phòng khám.
if [ ! -f services/bff/.demo-tenants.json ]; then
  say "nạp dữ liệu demo (SEED_PATIENTS=${SEED_PATIENTS:-5})"
  SEED_PATIENTS="${SEED_PATIENTS:-5}" pnpm seed >"$LOGS/seed.log" 2>&1 || { tail -20 "$LOGS/seed.log"; fail "seed lỗi"; }
fi

# 5. BFF và giao diện (bản dev). Mỗi cái một nhóm tiến trình riêng (hoặc một cây tiến trình trên Windows) để dừng gọn.
# Tiến trình con phải bỏ hẳn stdin/stdout/stderr của script này, nếu không nó giữ đầu ống (ví dụ `| tail`) và lệnh gọi script không bao giờ kết thúc.
launch() {
  local name="$1" port="$2" dir="$3"
  shift 3
  if [ "$HAS_SETSID" = 1 ]; then
    ( cd "$dir" || exit 1; exec setsid nohup "$@" >"$LOGS/$name.log" 2>&1 </dev/null ) &
  else
    ( cd "$dir" || exit 1; exec nohup "$@" >"$LOGS/$name.log" 2>&1 </dev/null ) &
  fi
  echo $! >"$LOGS/$name.pid"
  echo "$port" >"$LOGS/$name.port"
}
# Git Bash: ghi thêm PID Windows của tiến trình đầu chuỗi (sau khi chuỗi exec đã yên) để lần dừng sau nhận đúng tiến trình.
note_winpid() {
  local file="$LOGS/$1.pid" pid="" winpid=""
  read -r pid _ <"$file" 2>/dev/null || true
  winpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
  if [ -n "$winpid" ]; then echo "$pid $winpid" >"$file"; fi
}
say "chạy BFF (log: $LOGS/bff.log)"
launch bff "$BFF_PORT" services/bff env DEMO_AUTH=1 ${OUTBOX_BASE_MS:+OUTBOX_BASE_MS=$OUTBOX_BASE_MS} ${OUTBOX_CAP_MS:+OUTBOX_CAP_MS=$OUTBOX_CAP_MS} pnpm start
say "chạy giao diện (log: $LOGS/web.log)"
# --strictPort: cổng bị giữ thì Vite lỗi rõ ràng, không lặng lẽ nhảy sang cổng kế tiếp mà script không biết.
launch web "$WEB_PORT" apps/clinic-web pnpm dev --host 127.0.0.1 --port "$WEB_PORT" --strictPort
for _ in $(seq 1 40); do [ "$(http "$BFF/api/health")" = 200 ] && break; sleep 1; done
for _ in $(seq 1 40); do [ "$(http "$WEB/")" = 200 ] && break; sleep 1; done
if [ "$HAS_SETSID" = 0 ]; then note_winpid bff; note_winpid web; fi
[ "$(http "$BFF/api/health")" = 200 ] || { tail -20 "$LOGS/bff.log"; fail "BFF không lên"; }
[ "$(http "$WEB/")" = 200 ] || { tail -20 "$LOGS/web.log"; fail "giao diện không lên"; }

cat <<EOF

Sẵn sàng:
  Medplum  $MEDPLUM      BFF  $BFF      Giao diện  $WEB
  Đăng nhập demo: chọn phòng khám và người dùng ngay trên màn hình (không có mật khẩu).
  Kiểm thử đầu-cuối:  E2E_URL=$WEB pnpm e2e
  Dừng BFF + giao diện:  infra/dev-up.sh --stop        Log:  $LOGS
EOF
