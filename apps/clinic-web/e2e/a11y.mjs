#!/usr/bin/env node
// Quét truy cập (axe-core, WCAG 2.2 AA) trên các màn hình chính, cả giao diện sáng và tối, máy bàn và điện thoại.
//
//   pnpm dev:bff   (DEMO_AUTH=1, sau khi chạy "pnpm seed")
//   pnpm dev:web
//   pnpm --filter @phongmach/clinic-web e2e:a11y        (mặc định http://127.0.0.1:5173)
//
// Thoát với mã 1 nếu còn bất kỳ lỗi nào. Chỉ đọc: không tạo bệnh nhân hay lượt khám.
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
const browser = await chromium.launch({ executablePath: chromiumPath() });
const failures = [];
let scans = 0;

async function scan(page, label) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  scans += 1;
  for (const v of r.violations) {
    failures.push(`${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} nút, vd ${v.nodes[0].target.join(' ')})`);
  }
  console.log(`${r.violations.length === 0 ? '✓' : '✗'} ${label}: ${r.violations.length} lỗi`);
}

const profiles = [
  ['máy bàn sáng', { viewport: { width: 1280, height: 860 }, colorScheme: 'light' }],
  ['máy bàn tối', { viewport: { width: 1280, height: 860 }, colorScheme: 'dark' }],
  ['điện thoại', { viewport: { width: 390, height: 844 }, colorScheme: 'light' }],
];

for (const [name, opts] of profiles) {
  const context = await browser.newContext({ ...opts, locale: 'vi-VN' });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
  await scan(page, `${name} / đăng nhập`);
  await page.getByTestId('login-noi-owner').click();
  await page.getByTestId('search').waitFor();
  await scan(page, `${name} / tiếp đón`);
  const phone = opts.viewport.width < 760;
  for (const [id, label] of [['queue', 'hàng chờ'], ['display', 'màn hình chờ'], ['gateway', 'liên thông'], ['metrics', 'thời gian khám'], ['audit', 'nhật ký'], ['scope', 'phạm vi']]) {
    // Trên điện thoại, mục phụ nằm sau nút "Thêm".
    const more = ['gateway', 'metrics', 'audit', 'scope'].includes(id);
    if (phone && more && (await page.getByTestId('tab-more').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('tab-more').click();
    await page.getByTestId(`tab-${id}`).click();
    if (phone && more && (await page.getByTestId('tab-more').getAttribute('aria-expanded')) === 'true') await page.getByTestId('tab-more').click();
    await page.waitForTimeout(300);
    await scan(page, `${name} / ${label}`);
  }
  await context.close();
}
await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} lỗi truy cập:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nĐạt: ${scans} lượt quét, 0 lỗi.`);
