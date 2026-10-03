#!/usr/bin/env node
// Chạy ứng dụng cho phiên thử với bác sĩ (tiêu chí M0-1) trên một phòng khám thử riêng, không đụng hai phòng khám demo:
// một BFF riêng (tệp phòng khám và tệp nhật ký riêng) và bản build của giao diện trỏ /api tới BFF đó.
//
//   pnpm trial:up            buổi thử thật: phiên `m0-1`, BFF ở cổng 8112, giao diện ở http://127.0.0.1:4175; chạy tới khi bấm Ctrl+C
//   pnpm trial:rehearsal     diễn tập kỹ thuật: tạo một phòng khám diễn tập MỚI, BFF 8113, giao diện 4176, chạy bài
//                            apps/clinic-web/e2e/trial-rehearsal.mjs (hai bác sĩ đi trọn lượt, xuất số đo, so với màn hình) rồi dừng
//
// Cần stack Medplum đang chạy. Script chỉ dừng tiến trình do chính nó chạy; cổng đang có tiến trình khác giữ thì dừng và báo.
// Biến môi trường: TRIAL (tên phiên), TRIAL_BFF_PORT, TRIAL_WEB_PORT, TRIAL_SKIP_BUILD=1 (dùng apps/clinic-web/dist đang có),
// MEDPLUM_URL, CHROMIUM_PATH. Xem docs/phien-thu-bac-si.md.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'up' && mode !== 'rehearsal') {
  console.error('Dùng: node infra/trial.mjs up | rehearsal');
  process.exit(2);
}
const rehearsal = mode === 'rehearsal';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BFF_DIR = join(ROOT, 'services', 'bff');
const WEB_DIR = join(ROOT, 'apps', 'clinic-web');
// Diễn tập: mỗi lần một phòng khám mới, để số đếm cuối bài là số tuyệt đối. Buổi thử thật: luôn là phiên `m0-1` (dùng lại).
const TRIAL = process.env.TRIAL ?? (rehearsal ? `dien-tap-${Date.now().toString(36)}` : 'm0-1');
if (rehearsal && !TRIAL.startsWith('dien-tap')) {
  console.error(`✗ Bài diễn tập chỉ chạy trên phiên có tên bắt đầu bằng "dien-tap", không chạy trên "${TRIAL}".`);
  process.exit(2);
}
const WORK = join(BFF_DIR, '.data', 'trial', TRIAL);
const BFF_PORT = Number(process.env.TRIAL_BFF_PORT ?? (rehearsal ? 8113 : 8112));
const WEB_PORT = Number(process.env.TRIAL_WEB_PORT ?? (rehearsal ? 4176 : 4175));
const BFF = `http://127.0.0.1:${BFF_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const env = { ...process.env, TRIAL };
// pnpm trên Windows là tệp .cmd: phải gọi qua shell. Hai tiến trình chạy lâu thì gọi thẳng node (một tiến trình, dừng gọn trên mọi hệ điều hành).
const SHELL = process.platform === 'win32';

const say = (msg) => console.log(`▶ ${msg}`);
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

function run(what, args) {
  const r = spawnSync('pnpm', args, { cwd: ROOT, stdio: 'inherit', shell: SHELL, env });
  if (r.status !== 0) fail(`${what} lỗi (mã ${r.status})`);
}

function launch(name, cwd, args, extra) {
  const log = join(WORK, `${name}.log`);
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', fd, fd] });
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

mkdirSync(WORK, { recursive: true });
for (const [port, name] of [[BFF_PORT, 'TRIAL_BFF_PORT'], [WEB_PORT, 'TRIAL_WEB_PORT']]) {
  if (await portBusy(port)) fail(`Cổng ${port} đang do một tiến trình khác giữ. Script không dừng tiến trình lạ: đặt ${name} sang một cổng trống.`);
}

say(`phiên "${TRIAL}"${rehearsal ? ' (DIỄN TẬP KỸ THUẬT: số đo của phiên này không phải số của bác sĩ)' : ''}`);
run('tạo hoặc dùng lại phòng khám thử', ['trial', 'setup']);
if (process.env.TRIAL_SKIP_BUILD === '1') say('bỏ qua build (TRIAL_SKIP_BUILD=1): dùng apps/clinic-web/dist đang có');
else run('build giao diện', ['--filter', '@phongmach/clinic-web', 'build']);

const bff = launch('bff', BFF_DIR, ['--import', 'tsx', 'src/server.ts'], { DEMO_AUTH: '1', PORT: String(BFF_PORT), TENANTS_FILE: join(WORK, 'tenants.json'), AUDIT_FILE: join(WORK, 'audit.ndjson') });
const web = launch('web', WEB_DIR, [join('node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { BFF_URL: BFF });
await ready(`${BFF}/api/health`, bff, 'BFF của phiên thử');
await ready(`${WEB}/`, web, 'bản build của giao diện');

if (rehearsal) {
  say(`BFF ${BFF} và giao diện ${WEB} sẵn sàng (log: ${WORK})`);
  const test = spawn(process.execPath, [join(WEB_DIR, 'e2e', 'trial-rehearsal.mjs')], { cwd: WEB_DIR, env: { ...env, E2E_URL: WEB, TRIAL_DIR: WORK }, stdio: 'inherit' });
  children.push(test);
  const code = await new Promise((resolve) => test.on('exit', (c) => resolve(c ?? 1)));
  if (code !== 0) fail(`bài diễn tập đỏ (mã ${code}); log của BFF và giao diện ở ${WORK}`);
  stopAll();
} else {
  console.log(`
Phiên thử "${TRIAL}" đang chạy.
  Giao diện:   ${WEB}     (mở bằng trình duyệt trên CHÍNH MÁY NÀY; BFF chỉ nghe trên localhost)
  Đăng nhập:   Bác sĩ thử 1, 2, 3 · Phụ tá · Điều phối viên (xem "Thời gian khám" của cả ba bác sĩ)
  Lệnh (mở một cửa sổ Git Bash khác, ở gốc kho):
    pnpm trial queue bs1 noi warmup     xếp 3 ca làm quen cho bác sĩ thử 1 (nội); "nhi" cho nhi
    pnpm trial queue bs1 noi            xếp 12 ca tính số đo
    pnpm trial clear                    dọn hàng chờ sau lượt của một bác sĩ
    pnpm trial export                   xuất CSV và bảng tóm tắt
  Log: ${WORK}
Bấm Ctrl+C để dừng BFF và giao diện (dữ liệu trong Medplum giữ nguyên, chạy lại lệnh này để tiếp tục).`);
  // Một trong hai tiến trình tự thoát giữa buổi thử thì báo ngay, không để điều phối viên đoán.
  const dead = await Promise.race([bff, web].map(({ child, log }) => new Promise((resolve) => child.on('exit', (code) => resolve({ code, log })))));
  fail(`một tiến trình của phiên thử đã thoát (mã ${dead.code})`, [dead.log]);
}
