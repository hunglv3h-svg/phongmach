#!/usr/bin/env bash
# Khởi động BFF (tsx, nghe 127.0.0.1:8110) rồi nginx trong CÙNG container.
# BFF đọc env HOST/PORT/MEDPLUM_URL/TENANTS_FILE/DEMO_AUTH do compose truyền.
set -euo pipefail

cd /app

bff_pid=""
nginx_pid=""

shutdown() {
  # Dừng gọn khi nhận SIGTERM/SIGINT.
  [ -n "$nginx_pid" ] && kill "$nginx_pid" 2>/dev/null || true
  [ -n "$bff_pid" ] && kill "$bff_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap shutdown SIGTERM SIGINT

# BFF nền.
pnpm --filter @phongmach/bff start &
bff_pid=$!

# Chờ /api/health sẵn sàng. Nếu BFF thoát (ví dụ chốt an toàn chặn), log rõ và thoát khác 0.
echo "entrypoint: chờ BFF sẵn sàng tại http://127.0.0.1:8110/api/health ..."
for i in $(seq 1 60); do
  if ! kill -0 "$bff_pid" 2>/dev/null; then
    echo "entrypoint: BFF đã thoát trước khi sẵn sàng (có thể do chốt an toàn hoặc cấu hình sai). Dừng." >&2
    wait "$bff_pid" 2>/dev/null || true
    exit 1
  fi
  if curl -fsS http://127.0.0.1:8110/api/health >/dev/null 2>&1; then
    echo "entrypoint: BFF đã sẵn sàng."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "entrypoint: hết thời gian chờ BFF sẵn sàng. Dừng." >&2
    kill "$bff_pid" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# nginx chạy nền để entrypoint còn giám sát tiến trình BFF; cả hai cùng namespace.
nginx -g "daemon off;" &
nginx_pid=$!

# Nếu BFF hoặc nginx thoát, kéo theo dừng cả hai và trả mã thoát tương ứng.
set +e
wait -n "$bff_pid" "$nginx_pid"
code=$?
echo "entrypoint: một tiến trình đã thoát (mã $code), đang dừng tiến trình còn lại." >&2
shutdown
