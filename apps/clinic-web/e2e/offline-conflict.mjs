#!/usr/bin/env node
// Kiểm thử đầu-cuối lát 4 của M0-S3 trên Chromium thật, HAI MÁY (hai context, mỗi máy một IndexedDB riêng), ngắt mạng thật:
//   409  bác sĩ mất mạng mở một lượt khám đã nạp trước rồi ký; chủ phòng khám mở cùng lượt đó ở máy kia. Có mạng lại: danh sách chờ
//        đồng bộ báo xung đột, mục ký bị giữ, máy chủ không nhận lần hoàn tất nào của bác sĩ, in lại vẫn được, không có nút xóa hay hủy.
//   401  hết phiên: màn hình đăng nhập báo "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục".
//   422  bác sĩ mất mạng ký đơn có amoxicillin; phụ tá ở máy kia ghi dị ứng penicillin. Có mạng lại: danh sách hiện cảnh báo dị ứng,
//        bác sĩ ghi lý do rồi gửi lại; máy chủ có đúng một lượt khám, đơn lưu kèm lý do, đúng 2 yêu cầu mang clientUuid đó.
//
//   cần stack + seed + BFF (DEMO_AUTH=1) + giao diện như e2e:visit
//   pnpm --filter @phongmach/clinic-web e2e:conflict
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';
import { device, eventually, lastPrintHtml, login, prefetched, printFrames, rawLocalDump, resetDemoQueue, session, setOffline } from './offline-helpers.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173';
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath() });
const problems = [];
const devices = [];

/** Một máy: context riêng (IndexedDB, sessionStorage riêng), có bộ đếm yêu cầu IndexedDB lúc gọi print() và sổ ghi các yêu cầu hoàn tất (offline-helpers.mjs). */
async function newDevice(name) {
  const d = await device(browser, name, problems);
  devices.push(d);
  return d;
}

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2)}. ${msg}`);
const tag = Math.random().toString(36).slice(2, 7);
const CONFLICT_NAME = `Zq Xung Đột ${tag}`;
const ALLERGY_NAME = `Zq Dị Ứng ${tag}`;
const SYMPTOMS = `Đau họng ba ngày ${tag}`;
const REASON = `Đã gọi bệnh nhân ${tag}: từng dùng amoxicillin, không phản ứng`;
const OWNER = 'BS. Trần Quốc Hưng';
const pad3 = (n) => String(n).padStart(3, '0');
const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

const status = (d, attrs) => d.page.locator(`[data-testid="sync-status"]${Object.entries(attrs).map(([k, v]) => `[data-${k}="${v}"]`).join('')}`).waitFor({ state: 'attached', timeout: 30_000 });
const rowsOf = (d) => d.page.getByTestId('sync-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-kind'), e.getAttribute('data-status')]));

/** Gọi vào khám khi mất mạng một người đã nạp trước, kê đơn mẫu viêm họng (có amoxicillin), ký. Trả về mã đơn đã in. */
async function signOffline(d, name) {
  const { page } = d;
  await page.getByTestId('tab-queue').click();
  await page.getByTestId('queue-offline').waitFor();
  await page.getByTestId('queue-row').filter({ hasText: name }).getByTestId('call').click();
  await page.getByTestId('visit').waitFor();
  await page.getByTestId('opened-offline').waitFor();
  assert.equal(await page.getByTestId('allergy-unknown').count(), 0, 'hồ sơ đã nạp trước: máy có dữ liệu dị ứng (chưa ghi nhận dị ứng nào)');
  await page.getByTestId('exam-symptoms').fill(SYMPTOMS);
  await page.getByTestId('dx-search').fill('viem hong');
  await page.getByTestId('dx-search-item').first().waitFor();
  await page.getByTestId('dx-search').press('Enter');
  await page.getByTestId('template').selectOption('viem-hong-cap');
  await page.getByTestId('line').first().waitFor();
  const reasons = page.getByTestId('ack-reason');
  for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill('Đã hỏi bệnh nhân trực tiếp');
  // IndexedDB ghi bất đồng bộ: chờ bản nháp lưu xong rồi mới ký.
  await page.locator('[data-testid="draft-saved"][data-dirty="false"]').waitFor();
  const before = await printFrames(d.page);
  await page.getByTestId('sign').click();
  await page.getByTestId('offline-sign-result').waitFor();
  await page.locator('iframe[data-testid="print-frame"]').nth(before).waitFor({ state: 'attached' });
  const code = await page.getByTestId('rx-code').innerText();
  assert.match(code, /^PM-\d{6}-[0-9A-Z]{6}$/);
  const html = await lastPrintHtml(d.page);
  for (const part of ['KÝ KHI MẤT MẠNG', code, name, 'Amoxicillin']) assert.ok(html.includes(part), `trang in phải có "${part}"`);
  return code;
}

try {
  await resetDemoQueue(BASE);
  const assistant = await session(BASE, 'noi-tong-quat', 'noi-assistant');
  const doctor = await session(BASE, 'noi-tong-quat', 'noi-doctor');

  // Hai bệnh nhân thử, có CCCD và ngày sinh (để đơn không bị chặn vì thiếu CCCD), chưa ghi nhận dị ứng; cả hai đã được cấp số.
  const made = {};
  for (const name of [CONFLICT_NAME, ALLERGY_NAME]) {
    const { patient } = await assistant('POST', '/api/patients', { clientUuid: crypto.randomUUID(), fullName: name, phone: `09${digits(8)}`, cccd: `0011${digits(8)}`, birthDate: '1988-03-12', gender: 'male' });
    assert.ok(patient?.id, `tạo được bệnh nhân thử ${name}`);
    const { item } = await assistant('POST', '/api/queue', { clientUuid: crypto.randomUUID(), patientId: patient.id, specialty: 'noi', priority: 'normal', reason: 'Đau họng' });
    made[name] = { patientId: patient.id, visitId: item.id, number: item.number };
  }
  const conflict = made[CONFLICT_NAME];
  const allergy = made[ALLERGY_NAME];

  // ================================================================================================== 409: xung đột
  const A = await newDevice('máy bác sĩ');
  const B = await newDevice('máy kia');
  await login(A, BASE, 'noi-doctor');
  await A.page.getByTestId('tab-queue').click();
  await A.page.getByTestId('waiting').getByTestId('queue-row').filter({ hasText: CONFLICT_NAME }).waitFor();
  await prefetched(A.page, 2);
  await setOffline(A, true);
  const conflictCode = await signOffline(A, CONFLICT_NAME);
  assert.equal(await A.page.getByTestId('offline-sync-state').getAttribute('data-status'), 'pending');
  ok(`máy bác sĩ mất mạng: mở lượt ${pad3(conflict.number)} đã nạp trước (có dữ liệu dị ứng), ký và in đơn ${conflictCode} từ máy`);

  await login(B, BASE, 'noi-owner');
  await B.page.getByTestId('tab-queue').click();
  await B.page.getByTestId('queue-row').filter({ hasText: CONFLICT_NAME }).getByTestId('call').click();
  await B.page.getByTestId('visit').waitFor();
  assert.equal(await B.page.getByTestId('opened-offline').count(), 0, 'máy kia mở có mạng');
  ok('máy kia (chủ phòng khám, có mạng) gọi cùng lượt đó vào khám trong lúc bác sĩ mất mạng');

  A.expected = /status of 409|ERR_INTERNET_DISCONNECTED|Failed to fetch/;
  await setOffline(A, false);
  await status(A, { pending: 3, attention: 3 });
  await A.page.locator('[data-testid="offline-sync-state"][data-status="held"]').waitFor();
  await A.page.getByTestId('sync-conflict').waitFor();
  const notice = A.page.locator('[data-testid="sync-notice"][data-kind="conflict"]');
  await notice.waitFor();
  const noticeText = await notice.innerText();
  assert.ok(noticeText.includes(`Lượt khám ${pad3(conflict.number)} đã do ${OWNER}`), `thông báo nêu số lượt khám và tên người giữ: ${noticeText}`);
  assert.match(noticeText, /mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống/);
  assert.equal(await A.page.locator('[data-testid="sync-notice"]').count(), 1, 'mục bị giữ không có thông báo riêng');
  ok('bác sĩ có mạng lại: thông báo xung đột đúng câu của OFF-7, kèm số lượt khám và tên người đã mở; màn hình kết quả ghi "bị giữ"');

  await A.page.getByTestId('attention-badge').click();
  const list = A.page.getByTestId('sync-list');
  await list.waitFor();
  assert.deepEqual(await rowsOf(A), [['open', 'conflict'], ['complete', 'held'], ['printed', 'held']]);
  const openRow = list.locator('[data-testid="sync-row"][data-kind="open"]');
  const completeRow = list.locator('[data-testid="sync-row"][data-kind="complete"]');
  assert.ok((await openRow.getByTestId('sync-row-conflict').innerText()).includes(`Lượt khám ${pad3(conflict.number)} đã do ${OWNER}`));
  assert.match(await openRow.getByTestId('sync-row-error').innerText(), /HTTP 409.*Hồ sơ đang do/);
  const heldText = await completeRow.innerText();
  assert.ok(heldText.includes(`Bị giữ: mục «Mở hồ sơ khám · ${CONFLICT_NAME} · số ${pad3(conflict.number)}» đang xung đột`), `mục ký ghi rõ bị giữ vì mục nào: ${heldText}`);
  assert.ok(heldText.includes(CONFLICT_NAME) && heldText.includes(conflictCode), 'dòng có tên bệnh nhân và mã đơn');
  // Không có nút xóa hay hủy: mọi nút trong danh sách thuộc đúng tập đã chốt.
  const buttonIds = await list.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  assert.deepEqual([...new Set(buttonIds)].sort(), ['sync-list-close', 'sync-list-now', 'sync-reprint'], `các nút của danh sách: ${buttonIds}`);
  assert.equal(await list.getByRole('button', { name: /Xóa|Hủy|Bỏ|Gỡ/ }).count(), 0, 'không có nút xóa hay hủy mục chưa đồng bộ');
  await A.page.screenshot({ path: `${shots}40-sync-list-conflict.png` });
  ok('danh sách chờ đồng bộ: mục mở hồ sơ "xung đột" (kèm lỗi 409 của máy chủ), mục ký và ghi nhận in "bị giữ vì mục mở hồ sơ"; không có nút xóa hay hủy');

  // "Đồng bộ ngay" rồi in lại: lần in lại thêm một mục ghi nhận in, tức bộ máy đã chạy tiếp SAU lần "Đồng bộ ngay" đó.
  await list.getByTestId('sync-list-now').click();
  const before = await printFrames(A.page);
  await completeRow.getByTestId('sync-reprint').click();
  await completeRow.getByTestId('sync-reprinted').waitFor();
  await status(A, { pending: 4, attention: 4 });
  assert.equal(await printFrames(A.page), before + 1, 'in lại mở đúng một trang in');
  const reprintHtml = await lastPrintHtml(A.page);
  for (const part of ['KÝ KHI MẤT MẠNG', conflictCode, CONFLICT_NAME, 'Amoxicillin']) assert.ok(reprintHtml.includes(part), `trang in lại phải có "${part}"`);
  assert.deepEqual(await rowsOf(A), [['open', 'conflict'], ['complete', 'held'], ['printed', 'held'], ['printed', 'held']], 'xung đột không tự gửi lại, không tự biến mất');
  assert.equal(A.completes.length, 0, 'máy bác sĩ không gửi lần hoàn tất nào');
  const onServer = (await doctor('GET', '/api/queue')).items.find((i) => i.id === conflict.visitId);
  assert.equal(onServer.status, 'in-exam');
  assert.equal(onServer.doctorUserId, 'noi-owner', 'lượt khám vẫn do chủ phòng khám giữ, không bị ghi đè');
  const conflictVisits = (await doctor('GET', `/api/patients/${conflict.patientId}/visits?limit=10`)).visits ?? [];
  assert.ok(!conflictVisits.some((v) => v.prescription?.code === conflictCode), 'máy chủ không có đơn của bác sĩ cho lượt này');
  ok('"Đồng bộ ngay" không gửi lại mục xung đột; in lại từ máy vẫn được (nhãn "KÝ KHI MẤT MẠNG"); máy chủ không nhận lần hoàn tất nào của bác sĩ');

  // Màn hình chờ (đặt nơi công cộng) không hiện thông báo có họ tên bệnh nhân; huy hiệu thì vẫn còn.
  await list.getByTestId('sync-list-close').click();
  await A.page.getByTestId('tab-display').click();
  await A.page.getByTestId('display').waitFor();
  assert.equal(await A.page.locator('[data-testid="sync-notice"]').count(), 0, 'màn hình chờ không hiện thông báo đồng bộ');
  assert.ok(!(await A.page.getByTestId('display').innerText()).includes('Xung Đột'), 'màn hình chờ không có họ tên');
  await A.page.getByTestId('attention-badge').waitFor();
  await A.page.getByTestId('tab-queue').click();
  // Tắt thông báo: thông báo mất, huy hiệu "cần xử lý" vẫn còn.
  await notice.waitFor();
  await notice.getByTestId('sync-notice-dismiss').click();
  assert.equal(await A.page.locator('[data-testid="sync-notice"]').count(), 0);
  assert.match(await A.page.getByTestId('attention-badge').innerText(), /4 cần xử lý/);
  const raw409 = await rawLocalDump(A.page);
  assert.ok(raw409.rows.ops >= 4, `hàng đợi còn nguyên: ${JSON.stringify(raw409.rows)}`);
  for (const secret of [CONFLICT_NAME, 'Xung Đột', ALLERGY_NAME, SYMPTOMS, 'Amoxicillin', 'J02.9', 'Hồ sơ đang do', 'Trần Quốc Hưng']) assert.ok(!raw409.text.includes(secret), `kho trên máy không được có "${secret}" ở dạng rõ`);
  // Tải lại trang: các mục vẫn còn (đếm lại từ kho), thông báo đã tắt không hiện lại, huy hiệu vẫn còn.
  assert.deepEqual(await A.page.evaluate(() => window.__idb.atPrint), [0, 0], 'hai lần in (ký, in lại) đều không còn yêu cầu IndexedDB đang dở');
  await A.page.reload();
  await status(A, { pending: 4, attention: 4 });
  await A.page.getByTestId('attention-badge').waitFor();
  assert.equal(await A.page.locator('[data-testid="sync-notice"]').count(), 0);
  ok('màn hình chờ không hiện thông báo có họ tên; tắt thông báo không tắt được huy hiệu "4 cần xử lý"; tải lại trang các mục vẫn còn; IndexedDB không có tên bệnh nhân, thuốc hay thông điệp lỗi ở dạng rõ');

  // ================================================================================================== 401: hết phiên
  A.expected = /status of 401/;
  await A.page.route('**/api/queue', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }));
  await A.page.getByTestId('tab-queue').click();
  await A.page.getByTestId('session-expired').waitFor();
  await A.page.unroute('**/api/queue');
  await eventually(async () => /đồng bộ 4 mục/.test(await A.page.getByTestId('session-expired').innerText()), 'màn hình đăng nhập đếm xong số mục');
  assert.match(await A.page.getByTestId('session-expired').innerText(), /^Phiên đã hết hạn: đăng nhập lại để đồng bộ 4 mục/);
  assert.match(await A.page.getByTestId('device-pending').innerText(), /Máy này còn 4 mục chưa đồng bộ của .*Hà/);
  await A.page.screenshot({ path: `${shots}41-login-session-expired.png` });
  A.expected = undefined;
  await A.page.getByTestId('login-noi-doctor').click();
  await status(A, { pending: 4, attention: 4 });
  assert.equal(A.completes.length, 0, 'đăng nhập lại cũng không gửi mục bị giữ');
  ok('hết phiên (401): màn hình đăng nhập báo "Phiên đã hết hạn: đăng nhập lại để đồng bộ 4 mục" và "Máy này còn 4 mục…"; đăng nhập lại thì các mục còn nguyên');
  await A.context.close();

  // ================================================================================================== 422: dị ứng mới
  const C = await newDevice('máy bác sĩ thứ hai');
  await login(C, BASE, 'noi-doctor');
  await C.page.getByTestId('tab-queue').click();
  await C.page.getByTestId('waiting').getByTestId('queue-row').filter({ hasText: ALLERGY_NAME }).waitFor();
  await prefetched(C.page, 2);
  await setOffline(C, true);
  const allergyCode = await signOffline(C, ALLERGY_NAME);
  ok(`máy bác sĩ (kho mới) mất mạng: ký đơn ${allergyCode} có amoxicillin cho người chưa ghi nhận dị ứng`);

  await B.page.getByRole('button', { name: 'Đăng xuất' }).click();
  await B.page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
  await login(B, BASE, 'noi-assistant');
  await B.page.getByTestId('search').fill(ALLERGY_NAME);
  await B.page.getByTestId('search-status').filter({ hasText: /\d+ kết quả/ }).waitFor();
  await B.page.getByTestId('result').filter({ hasText: ALLERGY_NAME }).first().click();
  await B.page.getByTestId('patient-detail').filter({ hasText: ALLERGY_NAME }).waitFor();
  await B.page.getByTestId('allergy-class').selectOption('penicillin');
  await B.page.getByTestId('allergy').filter({ hasText: 'Penicillin' }).waitFor();
  ok('phụ tá ở máy kia ghi dị ứng Penicillin cho bệnh nhân đó trong lúc bác sĩ mất mạng');

  C.expected = /status of 422|ERR_INTERNET_DISCONNECTED|Failed to fetch/;
  await setOffline(C, false);
  await status(C, { pending: 2, attention: 2 });
  await C.page.locator('[data-testid="offline-sync-state"][data-status="rules"]').waitFor();
  const rulesNotice = C.page.locator('[data-testid="sync-notice"][data-kind="rules"]');
  await rulesNotice.waitFor();
  assert.ok((await rulesNotice.innerText()).includes(`Đơn ${allergyCode} của ${ALLERGY_NAME} đã in nhưng CHƯA lưu lên máy chủ`));
  await rulesNotice.getByTestId('sync-notice-open').click();
  const list2 = C.page.getByTestId('sync-list');
  await list2.waitFor();
  assert.deepEqual(await rowsOf(C), [['complete', 'rules'], ['printed', 'held']]);
  const rulesRow = list2.locator('[data-testid="sync-row"][data-kind="complete"]');
  const findings = await rulesRow.getByTestId('sync-finding').allInnerTexts();
  assert.ok(findings.length >= 1 && findings.every((f) => /dị ứng Penicillin/.test(f)) && findings.some((f) => /Amoxicillin/.test(f)), `cảnh báo dị ứng của máy chủ: ${findings}`);
  assert.match(await rulesRow.getByTestId('sync-row-rules').innerText(), /đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc/);
  const raw422 = await rawLocalDump(C.page);
  for (const secret of [ALLERGY_NAME, 'Dị Ứng', SYMPTOMS, 'Amoxicillin', 'Penicillin', 'dị ứng', 'J02.9']) assert.ok(!raw422.text.includes(secret), `kho trên máy không được có "${secret}" ở dạng rõ`);
  await C.page.screenshot({ path: `${shots}42-sync-list-rules.png` });
  ok('bác sĩ có mạng lại: máy chủ từ chối (422); thông báo và danh sách hiện cảnh báo dị ứng Penicillin của máy chủ, ghi rõ "đơn đã in: liên hệ bệnh nhân"; kho vẫn không có dạng rõ');

  const submit = rulesRow.getByTestId('sync-ack-submit');
  const inputs = rulesRow.getByTestId('sync-ack-reason');
  assert.equal(await inputs.count(), findings.length, 'mỗi phát hiện một ô lý do');
  assert.equal(await submit.isDisabled(), true, 'chưa ghi lý do thì chưa gửi lại được');
  for (let i = 0; i < findings.length; i++) await inputs.nth(i).fill('abc');
  assert.equal(await submit.isDisabled(), true, 'lý do ngắn hơn 5 ký tự thì chưa gửi lại được');
  assert.equal(C.completes.length, 1, 'trước khi xác nhận: đúng một yêu cầu hoàn tất (bị 422)');
  for (let i = 0; i < findings.length; i++) await inputs.nth(i).fill(REASON);
  await submit.click();
  await status(C, { pending: 0, attention: 0 });
  await list2.getByTestId('sync-list-empty').waitFor();
  await C.page.locator('[data-testid="offline-sync-state"][data-status="done"]').waitFor();
  C.expected = undefined;

  assert.equal(C.completes.length, 2, `đúng 2 yêu cầu hoàn tất, thực tế ${C.completes.length}`);
  assert.equal(C.completes[0].clientUuid, C.completes[1].clientUuid, 'xác nhận gửi lại CÙNG clientUuid');
  const sentKeys = (r) => r.prescription.acknowledgements.map((a) => a.key);
  assert.ok(!sentKeys(C.completes[0]).some((k) => k.startsWith('allergy:')) && sentKeys(C.completes[1]).some((k) => k.startsWith('allergy:class:penicillin')), 'lần gửi lại mang xác nhận dị ứng');
  const visits = (await doctor('GET', `/api/patients/${allergy.patientId}/visits?limit=10`)).visits;
  assert.equal(visits.length, 1, `máy chủ có đúng một lượt khám, thực tế ${visits.length}`);
  assert.equal(visits[0].prescription.code, allergyCode, 'mã đơn trên máy chủ trùng mã đã in');
  const saved = visits[0].prescription.acknowledgements.filter((a) => a.key.startsWith('allergy:class:penicillin'));
  assert.ok(saved.length >= 1 && saved.every((a) => a.reason === REASON), `đơn lưu kèm lý do xác nhận: ${JSON.stringify(visits[0].prescription.acknowledgements)}`);
  assert.equal((await doctor('GET', '/api/queue')).items.find((i) => i.id === allergy.visitId).status, 'done');
  assert.equal(await C.page.locator('[data-testid="sync-notice"]').count(), 0, 'xử lý xong thì thông báo tự hết');
  assert.equal(await C.page.getByTestId('attention-badge').count(), 0);
  assert.ok(!(await rawLocalDump(C.page)).text.includes(REASON), 'lý do xác nhận cũng không nằm ở dạng rõ trong kho');
  assert.deepEqual(await C.page.evaluate(() => window.__idb.atPrint), [0]);
  await C.page.screenshot({ path: `${shots}43-sync-list-acknowledged.png` });
  ok(`ghi lý do rồi "Xác nhận và gửi lại": đúng 2 yêu cầu cùng clientUuid; máy chủ có đúng 1 lượt khám, đơn ${allergyCode} lưu kèm lý do; danh sách và huy hiệu về 0`);

  assert.deepEqual(problems, [], `lỗi trong console:\n${problems.join('\n')}`);
  ok('không có lỗi nào trong console của hai máy (ngoài lỗi tải do cố ý ngắt mạng và các phản hồi 409, 422, 401 được chờ đợi)');
  console.log(`\nĐạt ${step}/${step}. Ảnh chụp: ${shots}`);
} catch (err) {
  for (const d of devices) await d.page.screenshot({ path: `${shots}FAILED-conflict-${devices.indexOf(d)}.png` }).catch(() => {});
  console.error('\n✗ Hỏng ở bước', step + 1, '\n', err);
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  try {
    await resetDemoQueue(BASE);
  } catch {
    // bỏ qua
  }
  await browser.close();
}
