#!/usr/bin/env node
// Kiểm thử đầu-cuối luồng ngoại tuyến (M0-S3, lát 3b) trên Chromium thật, ngắt mạng thật bằng `context.setOffline`:
// tìm trong bộ đệm, tạo bệnh nhân và cấp số tạm, gọi vào khám, ký khi mất mạng, in A5 "KÝ KHI MẤT MẠNG", có mạng lại thì đồng bộ
// đúng một đơn; ca mất phản hồi (máy chủ đã ghi, trình duyệt thấy lỗi mạng); đăng xuất khi còn mục chờ.
// Bài 20 chu kỳ ngắt và khôi phục mạng trên phòng khám thử riêng (M0-2) là offline-cycles.mjs.
//
//   cần stack + seed + BFF (DEMO_AUTH=1) + giao diện như e2e:visit
//   pnpm --filter @phongmach/clinic-web e2e:offline
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';
import { OFFLINE_ERRORS, assertOneA5Page, device, eventually, lastPrintHtml, login, prefetched, rawLocalDump, resetDemoQueue, session, setOffline } from './offline-helpers.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173';
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath() });
const problems = [];
// Một máy, có bộ đếm yêu cầu IndexedDB lúc gọi print() (bất biến của hàng rào in, xem offline-helpers.mjs).
// `d.expected`: lỗi tải tài nguyên là điều được chờ đợi trong lúc cố ý ngắt mạng hoặc cắt phản hồi.
const d = await device(browser, 'máy', problems);
const { context, page } = d;

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2)}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${shots}${name}.png` });
const tag = Math.random().toString(36).slice(2, 7);
const NEW_NAME = `Zq Ngoại Tuyến ${tag}`;
const KEEP_NAME = `Zq Giữ Lại ${tag}`;
const SYMPTOMS = `Ho khan về đêm ${tag}`;
const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const cccd = `0011${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const offline = async (on) => {
  await setOffline(d, on);
  if (!on) d.expected = undefined;
};
// Chỉ báo trống (không có mục chờ) thì không có kích thước: chờ theo thuộc tính, không theo hiển thị.
const syncedAll = () => page.locator('[data-testid="sync-status"][data-pending="0"]').waitFor({ state: 'attached', timeout: 30_000 });
async function search(query) {
  await page.getByTestId('tab-reception').click();
  await page.getByTestId('search').fill(query);
  await page.getByTestId('search-status').filter({ hasText: /\d+ kết quả/ }).waitFor();
}
async function signWithTemplate() {
  await page.getByTestId('exam-symptoms').fill(SYMPTOMS);
  await page.getByTestId('dx-search').fill('viem hong');
  await page.getByTestId('dx-search-item').first().waitFor();
  await page.getByTestId('dx-search').press('Enter');
  await page.getByTestId('template').selectOption('viem-hong-cap');
  await page.getByTestId('line').first().waitFor();
  const reasons = page.getByTestId('ack-reason');
  for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill('Đã hỏi bệnh nhân trực tiếp, không dị ứng thuốc');
  await page.getByTestId('sign').click();
}

try {
  await resetDemoQueue(BASE);
  const doctor = await session(BASE, 'noi-tong-quat', 'noi-doctor');

  // ============================================================ Có mạng: cấp số cho An, máy nạp trước hàng chờ
  await login(d, BASE, 'noi-doctor');
  await search('nguyen van an');
  await page.getByTestId('result').filter({ hasText: 'Nguyễn Văn An' }).first().click();
  await page.getByTestId('patient-detail').filter({ hasText: 'Nguyễn Văn An' }).waitFor();
  await page.getByTestId('check-in').click();
  const anNumber = Number(/số (\d+)/.exec(await page.getByTestId('notice').filter({ hasText: /Đã cấp số/ }).innerText())[1]);
  await page.getByTestId('tab-queue').click();
  await page.getByTestId('waiting').getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).waitFor();
  // Nạp trước xong: kho trên máy có bộ đệm bệnh nhân và ảnh chụp hàng chờ.
  await prefetched(page);
  ok(`có mạng: cấp số ${anNumber} cho Nguyễn Văn An; máy đã nạp trước hàng chờ và hồ sơ (bộ đệm mã hóa)`);

  // ============================================================ Mất mạng: tìm trên máy
  await offline(true);
  await page.getByTestId('offline-badge').waitFor();
  await search('nguyen van an');
  const status = await page.getByTestId('search-status').innerText();
  assert.match(status, /Mất mạng: chỉ tìm trong \d+ hồ sơ trên máy này/);
  assert.ok((await page.getByTestId('result').allInnerTexts()).some((t) => t.includes('Nguyễn Văn An')), 'tìm thấy An trong bộ đệm');
  await page.getByTestId('result').filter({ hasText: 'Nguyễn Văn An' }).first().click();
  await page.getByTestId('from-cache').waitFor();
  assert.match(await page.getByTestId('allergies').innerText(), /Penicillin/, 'dị ứng đã nạp trước vẫn hiện khi mất mạng');
  ok(`mất mạng: tìm "nguyen van an" trong bộ đệm ("${status.split('·')[0].trim()}"), mở hồ sơ từ máy, vẫn thấy dị ứng Penicillin`);

  // ============================================================ Mất mạng: tạo bệnh nhân, cấp số tạm
  await search(NEW_NAME);
  await page.getByTestId('new-patient').click();
  await page.getByTestId('f-phone').fill(phone);
  await page.getByTestId('f-cccd').fill(cccd);
  await page.getByTestId('f-birth').fill('1990-05-17');
  await page.getByTestId('f-gender').selectOption('female');
  await page.getByTestId('f-submit').click();
  await page.getByTestId('notice').filter({ hasText: /Mất mạng: đã tạo bệnh nhân trên máy này/ }).waitFor();
  await page.getByTestId('check-in').click();
  const tentativeText = await page.getByTestId('notice').filter({ hasText: /\(tạm\)/ }).innerText();
  const tentative = Number(/số (\d+) \(tạm\)/.exec(tentativeText)[1]);
  assert.ok(tentative > anNumber, `số tạm ${tentative} phải lớn hơn số máy đã biết ${anNumber}`);
  await search(cccd);
  assert.ok((await page.getByTestId('result').allInnerTexts()).some((t) => t.includes(NEW_NAME)), 'người tạo trên máy tìm được bằng CCCD khi mất mạng');
  ok(`mất mạng: tạo "${NEW_NAME}" và cấp số ${String(tentative).padStart(3, '0')} (tạm); tìm lại được bằng CCCD trong bộ đệm`);

  await page.getByTestId('tab-queue').click();
  await page.getByTestId('queue-offline').waitFor();
  const row = page.getByTestId('queue-row').filter({ hasText: NEW_NAME });
  assert.equal(await row.getAttribute('data-tentative'), 'true');
  assert.match(await row.innerText(), /\(tạm\)/);
  assert.equal(await row.getByTestId('cancel').isDisabled(), true, 'hủy lượt cần mạng');
  await page.getByTestId('tab-display').click();
  await page.locator('[data-testid="display-cell"][data-tentative="true"]').first().waitFor();
  assert.ok(!(await page.getByTestId('display').innerText()).includes('Ngoại Tuyến'), 'màn hình chờ không có họ tên');
  await shot('30-offline-display');
  ok('hàng chờ và màn hình chờ khi mất mạng: gộp ảnh chụp với lượt cấp trên máy, số có nhãn "tạm"; nút "Hủy" bị khóa (cần mạng)');

  // ============================================================ Mất mạng: khám và ký
  await page.getByTestId('tab-queue').click();
  await row.getByTestId('call').click();
  await page.getByTestId('visit').waitFor();
  await page.getByTestId('opened-offline').waitFor();
  await page.getByTestId('allergy-unknown').waitFor();
  await page.getByTestId('history-not-loaded').waitFor();
  await page.getByTestId('exam-symptoms').fill(SYMPTOMS);
  await page.getByTestId('dx-search').fill('viem hong');
  await page.getByTestId('dx-search-item').first().waitFor();
  await page.getByTestId('dx-search').press('Enter');
  await page.getByTestId('template').selectOption('viem-hong-cap');
  await page.getByTestId('line').first().waitFor();
  const rules = await page.getByTestId('rule').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));
  assert.ok(rules.includes('allergy-unknown'), `phải đòi xác nhận "chưa rõ dị ứng", có: ${rules}`);
  assert.equal(await page.getByTestId('sign').isDisabled(), true, 'chưa xác nhận thì không ký được');
  await shot('31-offline-visit');
  ok('gọi vào khám khi mất mạng: máy không có dị ứng của người mới nên đòi xác nhận "allergy-unknown"; tiền sử "chưa tải"');

  // Chờ bản nháp lưu xong (IndexedDB ghi bất đồng bộ) trước khi ký, như bài e2e:visit.
  const reasons = page.getByTestId('ack-reason');
  for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill('Đã hỏi bệnh nhân trực tiếp, không dị ứng thuốc');
  await page.locator('[data-testid="draft-saved"][data-dirty="false"]').waitFor();
  const framesBefore = await page.locator('iframe[data-testid="print-frame"]').count();
  await page.getByTestId('sign').click();
  await page.getByTestId('offline-sign-result').waitFor();
  const code = await page.getByTestId('rx-code').innerText();
  assert.match(code, /^PM-\d{6}-[0-9A-Z]{6}$/);
  await page.locator('iframe[data-testid="print-frame"]').nth(framesBefore).waitFor({ state: 'attached' });
  const offlineHtml = await lastPrintHtml(page);
  for (const part of ['KÝ KHI MẤT MẠNG', code, NEW_NAME, 'Amoxicillin', '<svg']) assert.ok(offlineHtml.includes(part), `trang in phải có "${part}"`);
  await assertOneA5Page(context, offlineHtml, `${shots}32-print-a5-offline-signed.png`);
  assert.equal(await page.getByTestId('offline-sync-state').getAttribute('data-status'), 'pending');
  ok(`ký khi mất mạng: mã ${code} sinh ở máy, trang in có nhãn "KÝ KHI MẤT MẠNG", xuất PDF đúng 1 trang A5`);

  const raw = await rawLocalDump(page);
  assert.ok(raw.rows.ops >= 5, `hàng đợi có tạo bệnh nhân, cấp số, mở hồ sơ, ký, ghi nhận in: ${JSON.stringify(raw.rows)}`);
  for (const secret of [NEW_NAME, 'Ngoại Tuyến', phone, cccd, SYMPTOMS, 'Nguyễn Văn An', 'Amoxicillin', 'J02.9', 'Penicillin']) assert.ok(!raw.text.includes(secret), `kho trên máy không được có "${secret}" ở dạng rõ`);
  ok(`đọc thẳng IndexedDB: ${raw.rows.ops} mục chờ và bộ đệm, không có tên, số điện thoại, CCCD, triệu chứng, thuốc ở dạng rõ`);

  // ============================================================ Có mạng lại: đồng bộ, đúng một đơn
  await offline(false);
  await syncedAll();
  await page.locator('[data-testid="offline-sync-state"][data-status="done"]').waitFor();
  const found = (await doctor('GET', `/api/patients/search?q=${encodeURIComponent(NEW_NAME)}`)).results;
  assert.equal(found.length, 1, `đúng một bệnh nhân "${NEW_NAME}" trên máy chủ, thực tế ${found.length}`);
  const visits = (await doctor('GET', `/api/patients/${found[0].id}/visits?limit=10`)).visits;
  assert.equal(visits.length, 1, `đúng một lượt khám, thực tế ${visits.length}`);
  assert.equal(visits[0].prescription.code, code, 'mã đơn trên máy chủ trùng mã đã in');
  assert.ok(visits[0].prescription.acknowledgements.some((a) => a.key === 'allergy-unknown'), 'xác nhận "chưa rõ dị ứng" được lưu cùng đơn');
  const queue = (await doctor('GET', '/api/queue')).items;
  const synced = queue.find((i) => i.patientName === NEW_NAME);
  assert.equal(synced.number, tentative, 'máy chủ giữ số tạm');
  assert.equal(synced.status, 'done');
  assert.ok(!(await page.getByTestId('code-mismatch').count()));
  await shot('33-offline-synced');
  ok(`có mạng lại: tự đồng bộ hết; máy chủ có đúng 1 bệnh nhân, 1 lượt khám, 1 đơn mã ${code}, giữ số ${tentative}`);

  // ============================================================ Mất phản hồi: máy chủ đã ghi, trình duyệt thấy lỗi mạng
  await page.getByTestId('back-to-queue').click();
  const anId = (await doctor('GET', '/api/queue')).items.find((i) => i.patientName === 'Nguyễn Văn An' && i.status === 'waiting').patientId;
  // Đếm lượt khám mới theo id, không theo độ dài danh sách: BFF trả tối đa 50 lượt (mới nhất trước), mà An có thêm lượt khám
  // sau mỗi lần chạy e2e, nên tới lần chạy thứ ~50 độ dài dừng ở 50 và phép đếm cũ luôn ra 0.
  const anVisits = async () => (await doctor('GET', `/api/patients/${anId}/visits?limit=50`)).visits;
  const before = new Set((await anVisits()).map((v) => v.encounterId));
  await page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).filter({ has: page.getByTestId('call') }).getByTestId('call').click();
  await page.getByTestId('visit').waitFor();
  assert.equal(await page.getByTestId('opened-offline').count(), 0, 'mở có mạng');
  let cut = 0;
  await page.route('**/api/visits/*/complete', async (route) => {
    await route.fetch(); // máy chủ nhận và ghi xong
    cut++;
    d.expected = OFFLINE_ERRORS;
    await route.abort('failed'); // nhưng trình duyệt chỉ thấy lỗi mạng
  });
  await signWithTemplate();
  await page.getByTestId('offline-sign-result').waitFor();
  await page.unroute('**/api/visits/*/complete');
  const lostCode = await page.getByTestId('rx-code').innerText();
  assert.equal(cut, 1);
  assert.ok((await lastPrintHtml(page)).includes('KÝ KHI MẤT MẠNG'), 'không nhận được phản hồi thì in từ dữ liệu trên máy');
  // Không bấm gì: bộ hẹn giờ của hàng đợi tự gửi lại sau thời gian chờ.
  await syncedAll();
  d.expected = undefined;
  await page.locator('[data-testid="offline-sync-state"][data-status="done"]').waitFor();
  const added = (await anVisits()).filter((v) => !before.has(v.encounterId));
  assert.equal(added.length, 1, `mất phản hồi rồi gửi lại: đúng 1 lượt khám mới, thực tế ${added.length}`);
  assert.equal(added[0].prescription.code, lostCode, 'gửi lại cùng UUID: máy chủ trả đơn cũ, mã trùng mã đã in');
  ok(`mất phản hồi khi ký (máy chủ đã ghi): in từ máy, gửi lại cùng UUID, máy chủ vẫn chỉ có 1 lượt khám mới, mã ${lostCode} trùng`);

  // Đo trước khi tải lại trang (bộ đếm nằm trong trang): hai lần in ở trên (ký khi mất mạng, mất phản hồi).
  const atPrint = await page.evaluate(() => window.__idb.atPrint);
  assert.equal(atPrint.length, 2, `đo được đúng hai lần in, thực tế ${JSON.stringify(atPrint)}`);
  assert.deepEqual(atPrint, [0, 0], `mọi lần in phải không còn yêu cầu IndexedDB đang dở, thực tế ${JSON.stringify(atPrint)}`);
  ok('hai lần in đều gọi print() khi không còn yêu cầu IndexedDB nào đang dở (hàng rào in)');

  // ============================================================ Đăng xuất khi còn mục chờ (OFF-6)
  await page.getByTestId('back-to-queue').click();
  await offline(true);
  await search(KEEP_NAME);
  await page.getByTestId('new-patient').click();
  await page.getByTestId('f-submit').click();
  await page.getByTestId('notice').filter({ hasText: /Mất mạng: đã tạo/ }).waitFor();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByTestId('logout-dialog').waitFor();
  assert.match(await page.getByTestId('logout-dialog').innerText(), /Còn 1 mục chưa đồng bộ/);
  assert.equal(await page.getByTestId('logout-dialog').getByRole('button', { name: /Hủy|Xóa/ }).count(), 0, 'không có nút hủy dữ liệu chưa đồng bộ');
  await page.getByTestId('logout-keep').click();
  await page.getByTestId('device-pending').waitFor();
  assert.match(await page.getByTestId('device-pending').innerText(), /Máy này còn 1 mục chưa đồng bộ của .*Hà/);
  assert.ok((await rawLocalDump(page)).names.includes('phongmach:noi-tong-quat:noi-doctor'), 'giữ kho đã mã hóa trên máy');
  await shot('34-login-device-pending');
  await context.setOffline(false);
  d.expected = undefined;
  await login(d, BASE, 'noi-doctor');
  // Chỉ báo bắt đầu ở 0 trước khi đếm xong: chờ theo kết quả trên máy chủ (thăm dò có hạn, không ngủ cố định).
  await eventually(async () => (await doctor('GET', `/api/patients/search?q=${encodeURIComponent(KEEP_NAME)}`)).results.length === 1, 'bệnh nhân giữ lại được gửi sau khi đăng nhập lại');
  await syncedAll();
  ok('đăng xuất khi còn mục chờ: hỏi "Chờ đồng bộ" / "Đăng xuất, giữ dữ liệu", không có nút hủy; màn hình đăng nhập báo số mục; đăng nhập lại thì tự gửi');

  // Hết mục chờ: đăng xuất xóa kho như trước.
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
  assert.ok(!(await rawLocalDump(page)).names.includes('phongmach:noi-tong-quat:noi-doctor'), 'không còn mục chờ: đăng xuất xóa kho');
  assert.equal(await page.getByTestId('device-pending').count(), 0);
  ok('hết mục chờ: đăng xuất xóa kho và khóa như trước');

  assert.deepEqual(problems, [], `lỗi trong console:\n${problems.join('\n')}`);
  ok('không có lỗi nào trong console của trình duyệt (ngoài lỗi tải do cố ý ngắt mạng)');
  console.log(`\nĐạt ${step}/${step}. Ảnh chụp: ${shots}`);
} catch (err) {
  await shot('FAILED-offline').catch(() => {});
  console.error('\n✗ Hỏng ở bước', step + 1, '\n', err);
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  try {
    await context.setOffline(false);
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await resetDemoQueue(BASE);
  } catch {
    // bỏ qua
  }
  await browser.close();
}
