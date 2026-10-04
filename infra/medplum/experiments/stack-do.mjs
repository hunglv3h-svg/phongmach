#!/usr/bin/env node
// Stack Medplum RIÊNG để đo (không giới hạn hạn mức), chạy song song với stack dev mà không đụng tới nó:
// tên dự án Compose khác (`phongmach-medplum-do`, nên volume và mạng khác), cổng khác (mặc định 8203),
// bí mật và cấu hình nằm ở infra/medplum/experiments/.stack-do/ (đã gitignore). Cùng docker-compose.yml và cùng image với stack dev.
//
//   node infra/medplum/experiments/stack-do.mjs up        tạo cấu hình (lần đầu) và bật stack đo, chờ tới khi healthy
//   node infra/medplum/experiments/stack-do.mjs down      dừng stack đo, GIỮ dữ liệu (lần sau `up` dùng lại, không phải nạp lại)
//   node infra/medplum/experiments/stack-do.mjs destroy   dừng và xóa volume của stack đo (chỉ của `phongmach-medplum-do`)
//
// Biến môi trường: DO_MEDPLUM_PORT (8203). Cổng đang bị tiến trình khác giữ thì script dừng và báo, không dừng tiến trình đó.
// Mọi lệnh compose ở đây đều mang `-p phongmach-medplum-do`: không lệnh nào chạm vào stack dev (`phongmach-medplum`, cổng 8103).
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'phongmach-medplum-do';
const PORT = Number(process.env.DO_MEDPLUM_PORT ?? 8203);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const STACK_DIR = join(HERE, '.stack-do');
const COMPOSE_FILE = join(HERE, '..', 'docker-compose.yml');
const SETUP = join(HERE, '..', 'setup.mjs');
const URL_ = `http://localhost:${PORT}`;

const compose = (...args) => {
  const r = spawnSync('docker', ['compose', '-p', PROJECT, '--project-directory', STACK_DIR, '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ docker compose ${args.join(' ')} lỗi (mã ${r.status})`);
    process.exit(1);
  }
};

const portBusy = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

async function healthy() {
  try {
    return (await fetch(`${URL_}/healthcheck`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const command = process.argv[2];
if (command === 'up') {
  if (!existsSync(join(STACK_DIR, '.env'))) {
    const r = spawnSync(process.execPath, [SETUP, '--no-rate-limits', '--dir', STACK_DIR], { stdio: 'inherit', env: { ...process.env, MEDPLUM_PORT: String(PORT) } });
    if (r.status !== 0) process.exit(1);
  }
  const running = spawnSync('docker', ['compose', '-p', PROJECT, 'ps', '-q', 'medplum-server'], { encoding: 'utf8' }).stdout.trim();
  if (!running && (await portBusy(PORT))) {
    console.error(`✗ Cổng ${PORT} đang do một tiến trình khác giữ. Script không dừng tiến trình lạ: đặt DO_MEDPLUM_PORT sang một cổng trống rồi xóa ${STACK_DIR} để sinh lại cấu hình.`);
    process.exit(1);
  }
  compose('up', '-d');
  const started = Date.now();
  while (!(await healthy())) {
    if (Date.now() - started > 180_000) {
      console.error(`✗ Stack đo chưa healthy ở ${URL_} sau 3 phút: docker compose -p ${PROJECT} logs medplum-server`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`Stack đo sẵn sàng: ${URL_} (dự án Compose ${PROJECT}, hạn mức FHIR tắt). Dùng: MEDPLUM_URL=${URL_}`);
} else if (command === 'down') {
  compose('down');
} else if (command === 'destroy') {
  compose('down', '-v');
  rmSync(STACK_DIR, { recursive: true, force: true });
  console.log(`Đã xóa stack đo ${PROJECT} (volume và cấu hình). Stack dev phongmach-medplum không bị đụng tới.`);
} else {
  console.error('Dùng: node infra/medplum/experiments/stack-do.mjs up | down | destroy');
  process.exit(1);
}
