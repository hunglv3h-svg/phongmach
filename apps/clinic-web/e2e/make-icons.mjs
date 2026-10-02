// Sinh biểu tượng PWA (PNG) từ một SVG đơn giản bằng Chromium. Chạy một lần khi đổi biểu tượng:
//   node e2e/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';

const out = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(out, { recursive: true });
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f766e"/>
  <rect x="216" y="104" width="80" height="304" rx="20" fill="#fff"/>
  <rect x="104" y="216" width="304" height="80" rx="20" fill="#fff"/>
</svg>`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `${out}icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('Đã tạo public/icons/icon-192.png và icon-512.png');
