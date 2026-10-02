// Tìm Chromium để chạy kiểm thử giao diện. Ưu tiên biến môi trường CHROMIUM_PATH, rồi bản có sẵn trong môi trường.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const bin = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('Không tìm thấy Chromium. Đặt CHROMIUM_PATH hoặc cài bằng "npx playwright install chromium".');
}
