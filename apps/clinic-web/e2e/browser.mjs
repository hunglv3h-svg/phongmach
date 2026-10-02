// Tìm Chromium để chạy kiểm thử giao diện. Ưu tiên biến môi trường CHROMIUM_PATH, rồi bản Playwright đã tải về máy
// (PLAYWRIGHT_BROWSERS_PATH nếu có đặt, không thì thư mục mặc định của từng hệ điều hành).
// Không bao giờ tự tìm Chrome của hệ thống: nó mở vào phiên Chrome của người dùng. Muốn dùng thì đặt CHROMIUM_PATH (như CI).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Mỗi dòng: tiền tố thư mục của Playwright (theo sau là "-<số bản>"), rồi các vị trí tệp chạy bên trong, bố cục cũ và mới.
const LINUX = [
  ['chromium', [['chrome-linux', 'chrome'], ['chrome-linux64', 'chrome']]],
  ['chromium_headless_shell', [['chrome-headless-shell-linux64', 'chrome-headless-shell'], ['chrome-linux', 'headless_shell']]],
];
// Windows chỉ dùng chrome-headless-shell: chrome.exe đầy đủ của Playwright bị chặn trên máy dev ("spawn UNKNOWN").
const WINDOWS = [
  ['chromium_headless_shell', [['chrome-headless-shell-win64', 'chrome-headless-shell.exe'], ['chrome-win', 'headless_shell.exe']]],
];

function browserRoots(env, platform, home) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return [env.PLAYWRIGHT_BROWSERS_PATH];
  if (platform === 'win32') return [join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright')];
  return ['/opt/pw-browsers', join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright')];
}

/** Tham số chỉ để kiểm thử; khi chạy thật gọi không tham số. */
export function chromiumPath({ env = process.env, platform = process.platform, home = homedir(), exists = existsSync, list = readdirSync } = {}) {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  const roots = browserRoots(env, platform, home);
  for (const root of roots) {
    if (!exists(root)) continue;
    const dirs = list(root);
    for (const [prefix, layouts] of platform === 'win32' ? WINDOWS : LINUX) {
      const versions = dirs
        .map((d) => new RegExp(`^${prefix}-(\\d+)$`).exec(d))
        .filter(Boolean)
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      for (const [dir] of versions) {
        for (const layout of layouts) {
          const bin = join(root, dir, ...layout);
          if (exists(bin)) return bin;
        }
      }
    }
  }
  throw new Error(
    `Không tìm thấy Chromium của Playwright (đã tìm trong: ${roots.join(', ')}). Đặt CHROMIUM_PATH, hoặc cài bằng ` +
      '"pnpm --filter @phongmach/clinic-web exec playwright-core install chromium-headless-shell".',
  );
}
