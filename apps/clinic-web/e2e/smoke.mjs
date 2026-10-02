#!/usr/bin/env node
// Kiểm thử giao diện đầu-cuối trên Chromium thật, theo kịch bản tiếp đón của M0-S1.
//
//   pnpm dev:bff   (DEMO_AUTH=1, sau khi chạy "pnpm seed")
//   pnpm dev:web
//   pnpm --filter @phongmach/clinic-web e2e            (mặc định http://127.0.0.1:5173)
//
// Ảnh chụp màn hình nằm ở e2e/screenshots/ (đã gitignore). Thoát với mã 1 nếu có bước hỏng
// hoặc trang in ra lỗi trong console.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173';
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const letters = (n) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('');
const FAMILY = `Zq${letters(5)}`;
const PHONE = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'vi-VN' });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2)}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${shots}${name}.png` });
const resultNames = () => page.getByTestId('result').locator('.result-name').allTextContents();
// Trạng thái chỉ hiện "N kết quả" khi kết quả khớp đúng truy vấn đang gõ (không phải kết quả cũ).
const resultsSettled = () => page.getByTestId('search-status').filter({ hasText: /\d+ kết quả/ }).waitFor();

async function login(userId) {
  await page.goto(BASE);
  await page.getByTestId(`login-${userId}`).click();
  await page.getByTestId('search').waitFor();
}
async function logout() {
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
}

try {
  // 1. Màn hình đăng nhập demo
  await page.goto(BASE);
  await page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
  assert.match(await page.locator('.demo-banner').innerText(), /BẢN TRÌNH DIỄN/);
  assert.equal(await page.locator('.card h2').count(), 2);
  await shot('01-login');
  ok('đăng nhập demo: hiện biểu ngữ "bản trình diễn" và hai phòng khám');

  // 2. Phụ tá không thấy nhật ký truy cập
  await login('noi-assistant');
  assert.match(await page.getByTestId('whoami').innerText(), /Phụ tá/);
  assert.equal(await page.getByRole('button', { name: 'Nhật ký truy cập' }).count(), 0);
  ok('phụ tá đăng nhập, không thấy mục "Nhật ký truy cập"');

  // 3. Tên không dấu ra cả "An" và "Ân"; đo từ lúc gõ đến lúc có kết quả
  const t0 = Date.now();
  await page.getByTestId('search').pressSequentially('nguyen van an', { delay: 20 });
  await resultsSettled();
  const dt = Date.now() - t0;
  const names = await resultNames();
  assert.ok(names.includes('Nguyễn Văn An') && names.includes('Nguyễn Văn Ân'), `kết quả: ${names.join(', ')}`);
  await shot('02-search-name');
  ok(`gõ "nguyen van an" ra cả "Nguyễn Văn An" và "Nguyễn Văn Ân" (${dt} ms kể cả 13 phím gõ cách 20 ms)`);

  // 4. 4 số cuối
  // Đặt con trỏ chuột yên trên vị trí sẽ là hàng thứ 3 của danh sách (và không di chuyển nữa).
  await page.mouse.move(200, 380);
  await page.getByTestId('search').fill('5678');
  await resultsSettled();
  assert.match(await page.getByTestId('search-status').innerText(), /4 số cuối điện thoại/);
  const phones = await page.getByTestId('result').locator('.result-meta').allTextContents();
  assert.ok(phones[0].startsWith('09') && phones[0].split(' · ')[0].endsWith('5678'), `đầu danh sách: ${phones[0]}`);
  await shot('03-search-last4');
  ok(`gõ "5678" hiểu là 4 số cuối; ${phones.length} kết quả, số kết thúc bằng 5678 xếp trước`);

  // 5. Bàn phím: mũi tên + Enter mở hồ sơ
  const listed = await resultNames();
  await page.getByTestId('search').press('ArrowDown');
  await page.getByTestId('search').press('Enter');
  await page.getByTestId('patient-detail').waitFor();
  assert.equal(await page.getByTestId('patient-detail').locator('h2').innerText(), listed[1], 'ArrowDown + Enter phải mở đúng hàng thứ 2, dù chuột đang nằm yên trên hàng 3');
  assert.match(await page.getByTestId('patient-detail').innerText(), /CCCD/);
  await shot('04-detail');
  ok('chuột nằm yên trên hàng 3, ArrowDown + Enter vẫn mở đúng hàng 2; CCCD đã che');

  // 5b. An toàn: bấm Enter khi kết quả MỚI chưa về không được mở hồ sơ của kết quả CŨ
  const before = await page.getByTestId('patient-detail').locator('h2').innerText();
  await page.route('**/api/patients/search*', async (route) => {
    await new Promise((r) => setTimeout(r, 800)); // làm chậm máy chủ để tạo đúng khoảng trống nguy hiểm
    await route.continue();
  });
  await page.getByTestId('search').fill('tran thi');
  // Kết quả cũ ("5678") vẫn đang hiện (mờ). Chọn mục KHÁC với hồ sơ đang mở rồi bấm Enter:
  // nếu giao diện cho chọn kết quả cũ thì hồ sơ đang mở sẽ đổi sang người khác.
  await page.getByTestId('search').press('ArrowUp');
  await page.getByTestId('search').press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('patient-detail').locator('h2').innerText(), before, 'Enter không được mở hồ sơ từ kết quả cũ');
  assert.equal(await page.getByTestId('result').first().isDisabled(), true, 'kết quả cũ phải bị vô hiệu hóa');
  await shot('04b-stale-results');
  await resultsSettled();
  await page.unroute('**/api/patients/search*');
  ok('bấm Enter khi kết quả mới chưa về: không mở nhầm hồ sơ cũ; kết quả cũ bị mờ và vô hiệu hóa');

  // 6. Tạo bệnh nhân mới, kiểm tra dữ liệu sai, bấm đúp không tạo trùng
  await page.getByTestId('search').fill(FAMILY);
  await page.getByTestId('new-patient').click();
  assert.equal(await page.getByTestId('f-name').inputValue(), FAMILY, 'ô họ tên được điền sẵn từ ô tìm kiếm');
  await page.getByTestId('f-name').fill(`${FAMILY} Thị Lan`);
  await page.getByTestId('f-phone').fill('123');
  await page.getByTestId('f-submit').click();
  assert.match(await page.getByTestId('form-error').innerText(), /Số điện thoại không hợp lệ/);
  await shot('05-form-error');
  ok('số điện thoại sai bị chặn ngay trên máy, có thông báo tiếng Việt');
  await page.getByTestId('f-phone').fill(PHONE);
  await page.getByTestId('f-cccd').fill('000999888777');
  await page.getByTestId('f-birth').fill('1990-05-20');
  await page.getByTestId('f-gender').selectOption('female');
  await page.getByTestId('f-submit').dblclick();
  await page.getByTestId('notice').waitFor();
  assert.match(await page.getByTestId('notice').innerText(), /Đã tạo bệnh nhân mới/);
  assert.match(await page.getByTestId('patient-detail').innerText(), new RegExp(`${FAMILY} Thị Lan`));
  ok('tạo bệnh nhân mới (bấm đúp), mở hồ sơ ngay');
  await page.getByTestId('search').fill(`${FAMILY.toLowerCase()} thi lan`);
  await resultsSettled();
  assert.equal((await resultNames()).length, 1, 'bấm đúp không được tạo hai bệnh nhân');
  ok('tìm bằng tên không dấu thấy đúng 1 bệnh nhân vừa tạo (không trùng)');

  // 7. Nhật ký truy cập: chủ phòng khám thấy, không chứa nội dung tìm kiếm
  await logout();
  await login('noi-owner');
  await page.getByRole('button', { name: 'Nhật ký truy cập' }).click();
  await page.getByTestId('audit-table').waitFor();
  const audit = await page.getByTestId('audit-table').innerText();
  for (const label of ['Tìm bệnh nhân', 'Mở hồ sơ', 'Tạo bệnh nhân', 'Đăng nhập']) assert.ok(audit.includes(label), `thiếu "${label}" trong nhật ký`);
  assert.ok(!audit.toLowerCase().includes(FAMILY.toLowerCase()) && !audit.includes(PHONE), 'nhật ký không được chứa nội dung tìm kiếm');
  await shot('06-audit');
  ok('chủ phòng khám xem nhật ký: có đăng nhập, tìm, mở hồ sơ, tạo; không lộ nội dung tìm kiếm');

  // 8. Cách ly: phòng khám Nhi không thấy bệnh nhân của phòng khám Nội
  await logout();
  await login('nhi-owner');
  await page.getByTestId('search').fill(FAMILY.toLowerCase());
  await resultsSettled();
  assert.equal((await resultNames()).length, 0);
  await page.getByTestId('search').fill(PHONE);
  await resultsSettled();
  assert.equal((await resultNames()).length, 0);
  await shot('07-isolation');
  ok('phòng khám Nhi tìm tên và số điện thoại của bệnh nhân bên Nội: 0 kết quả');

  // 9. Máy tính bảng dọc
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByTestId('search').fill('tran thi');
  await resultsSettled();
  await shot('08-tablet-portrait');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, 'không được cuộn ngang trên máy tính bảng dọc');
  ok('máy tính bảng dọc 768×1024: không cuộn ngang');

  assert.deepEqual(problems, [], `lỗi trong console:\n${problems.join('\n')}`);
  ok('không có lỗi nào trong console của trình duyệt');
  console.log(`\nĐạt ${step}/${step}. Ảnh chụp: ${shots}`);
} catch (err) {
  await shot('FAILED').catch(() => {});
  console.error('\n✗ Hỏng ở bước', step + 1, '\n', err);
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
