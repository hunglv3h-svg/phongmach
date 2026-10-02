#!/usr/bin/env node
// Chạy trọn bài e2e 20 chu kỳ ngắt và khôi phục mạng (tiêu chí M0-2) trên một phòng khám thử riêng, không đụng hai phòng khám demo:
//   1. tạo một phòng khám thử mới (services/bff/scripts/e2e-clinic.ts), ghi tệp phòng khám tạm ở services/bff/.data/e2e-cycles/;
//   2. build giao diện (bỏ qua khi CYCLES_SKIP_BUILD=1, ví dụ CI đã build ở bước trước);
//   3. chạy một BFF riêng (cổng 8111, tệp phòng khám tạm, tệp nhật ký riêng) và bản build của giao diện ở cổng 4174 trỏ /api tới BFF đó;
//   4. chạy apps/clinic-web/e2e/offline-cycles.mjs;
//   5. dừng hai tiến trình vừa chạy. Script chỉ dừng tiến trình do chính nó chạy.
//
//   pnpm e2e:cycles                      (cần stack Medplum đang chạy; không cần BFF hay giao diện demo)
//   E2E_SEED=12345 pnpm e2e:cycles       chạy lại đúng một lần chạy cũ (hạt giống in ở đầu bài)
//   E2E_CYCLES=100 pnpm e2e:cycles       số chu kỳ khác (T6)
//
// Biến môi trường khác: CYCLES_BFF_PORT (8111), CYCLES_WEB_PORT (4174), MEDPLUM_URL, CHROMIUM_PATH.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BFF_DIR = join(ROOT, 'services', 'bff');
const WEB_DIR = join(ROOT, 'apps', 'clinic-web');
const WORK = join(BFF_DIR, '.data', 'e2e-cycles');
const BFF_PORT = Number(process.env.CYCLES_BFF_PORT ?? 8111);
const WEB_PORT = Number(process.env.CYCLES_WEB_PORT ?? 4174);
const BFF = `http://127.0.0.1:${BFF_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const TENANTS_FILE = join(WORK, 'tenants.json');
// pnpm trên Windows là tệp .cmd: phải gọi qua shell. Hai tiến trình chạy lâu thì gọi thẳng node (một tiến trình, dừng gọn trên mọi hệ điều hành).
const SHELL = process.platform === 'win32';

const say = (msg) => console.log(`▶ ${msg}`);
const seconds = (from) => `${((Date.now() - from) / 1000).toFixed(1)} giây`;
const children = [];
const stopAll = () => {
  for (const c of children) if (c.exitCode === null) c.kill();
};

function fail(msg, logs = []) {
  console.error(`✗ ${msg}`);
  for (const file of logs) {
    try {
      console.error(`--- ${file} (40 dòng cuối)\n${readFileSync(file, 'utf8').split('\n').slice(-40).join('\n')}`);
    } catch {
      // chưa có log
    }
  }
  stopAll();
  process.exit(1);
}

const portBusy = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

function run(what, args, options = {}) {
  const started = Date.now();
  const r = spawnSync('pnpm', args, { cwd: ROOT, stdio: 'inherit', shell: SHELL, ...options });
  if (r.status !== 0) fail(`${what} lỗi (mã ${r.status})`);
  say(`${what}: ${seconds(started)}`);
}

function launch(name, cwd, args, env) {
  const log = join(WORK, `${name}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.push(child);
  return { child, log };
}

async function ready(url, { child, log }, what) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) fail(`${what} đã thoát (mã ${child.exitCode})`, [log]);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      // chưa lên
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`${what} không sẵn sàng ở ${url} sau 60 giây`, [log]);
}

process.on('SIGINT', () => (stopAll(), process.exit(130)));
process.on('SIGTERM', () => (stopAll(), process.exit(143)));

const total = Date.now();
mkdirSync(WORK, { recursive: true });
// Cổng đang có tiến trình khác giữ thì không dừng nó và không chạy chồng lên nó.
for (const [port, name] of [[BFF_PORT, 'CYCLES_BFF_PORT'], [WEB_PORT, 'CYCLES_WEB_PORT']]) {
  if (await portBusy(port)) fail(`Cổng ${port} đang do một tiến trình khác giữ. Script không dừng tiến trình lạ: đặt ${name} sang một cổng trống.`);
}

run('tạo phòng khám thử', ['--filter', '@phongmach/bff', 'e2e:clinic'], { env: { ...process.env, TENANTS_FILE } });
if (process.env.CYCLES_SKIP_BUILD === '1') say('bỏ qua build (CYCLES_SKIP_BUILD=1): dùng apps/clinic-web/dist đang có');
else run('build giao diện', ['--filter', '@phongmach/clinic-web', 'build']);

const started = Date.now();
const bff = launch('bff', BFF_DIR, ['--import', 'tsx', 'src/server.ts'], { DEMO_AUTH: '1', PORT: String(BFF_PORT), TENANTS_FILE, AUDIT_FILE: join(WORK, 'audit.ndjson') });
const web = launch('web', WEB_DIR, [join('node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { BFF_URL: BFF });
await ready(`${BFF}/api/health`, bff, 'BFF của bài kiểm thử');
await ready(`${WEB}/`, web, 'bản build của giao diện');
say(`BFF ${BFF} và giao diện ${WEB} sẵn sàng: ${seconds(started)} (log: ${WORK})`);

const testStarted = Date.now();
const test = spawn(process.execPath, [join(WEB_DIR, 'e2e', 'offline-cycles.mjs')], { cwd: WEB_DIR, env: { ...process.env, E2E_URL: WEB, CYCLES_TENANTS_FILE: TENANTS_FILE }, stdio: 'inherit' });
children.push(test);
const code = await new Promise((resolve) => test.on('exit', (c) => resolve(c ?? 1)));
say(`bài 20 chu kỳ: ${seconds(testStarted)}; cả lần chạy: ${seconds(total)}`);
if (code !== 0) fail(`bài kiểm thử đỏ (mã ${code}); log của BFF và giao diện ở ${WORK}`);
stopAll();
