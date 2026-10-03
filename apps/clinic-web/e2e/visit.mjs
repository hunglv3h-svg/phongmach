#!/usr/bin/env node
// Kiểm thử giao diện đầu-cuối của M0-S2 trên Chromium thật: hàng chờ, khám một trang, kê đơn có cảnh báo,
// ký & in A5, liên thông (cổng mô phỏng chèn lỗi, tự thử lại), số đo thời gian, cách ly, nhật ký.
//
//   pnpm seed            (tạo dữ liệu demo, gồm dị ứng, tiền sử và các lượt khám cũ)
//   pnpm dev:bff         (DEMO_AUTH=1; đặt OUTBOX_BASE_MS=500 OUTBOX_CAP_MS=2000 để bước thử lại nhanh)
//   pnpm dev:web
//   pnpm --filter @phongmach/clinic-web e2e:visit
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:5173';
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'vi-VN' });
const page = await context.newPage();
const problems = [];
// Khi cố ý ngắt mạng, trình duyệt ghi lỗi tải tài nguyên vào console: đó là điều được chờ đợi, không phải lỗi ứng dụng.
let offline = false;
const expectedOffline = (text) => offline && /ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(text);
page.on('console', (m) => m.type() === 'error' && !expectedOffline(m.text()) && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2)}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${shots}${name}.png` });
const resultsSettled = () => page.getByTestId('search-status').filter({ hasText: /\d+ kết quả/ }).waitFor();
const token = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('phongmach.auth')).token);
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : undefined, text: await res.text().catch(() => '') };
};

/** Dọn dấu vết của lần chạy trước (kể cả lần hỏng giữa chừng): hủy người đang chờ, kết thúc lượt đang khám, để kịch bản chạy lại được. */
async function resetQueue() {
  const as = async (tenant, userId) => {
    const r = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, userId }) });
    const { token } = await r.json();
    return (method, path, body) => fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((x) => x.json().catch(() => ({})));
  };
  const assistant = await as('noi-tong-quat', 'noi-assistant');
  const doctor = await as('noi-tong-quat', 'noi-doctor');
  const { items } = await assistant('GET', '/api/queue');
  for (const i of items) {
    if (i.status === 'waiting') await assistant('POST', `/api/queue/${i.id}/cancel`);
    if (i.status === 'in-exam' && i.doctorUserId === 'noi-doctor') {
      await doctor('POST', `/api/visits/${i.id}/complete`, { clientUuid: crypto.randomUUID(), exam: { vitals: {} }, diagnoses: ['J06.9'] });
    }
  }
}

async function login(userId) {
  await page.goto(BASE);
  await page.getByTestId(`login-${userId}`).click();
  await page.getByTestId('search').waitFor();
}
async function logout() {
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.getByRole('heading', { name: /Chọn phòng khám/ }).waitFor();
}
async function openPatient(query, name) {
  await page.getByTestId('tab-reception').click();
  await page.getByTestId('search').fill(query);
  await resultsSettled();
  await page.getByTestId('result').filter({ hasText: name }).first().click();
  await page.getByTestId('patient-detail').filter({ hasText: name }).waitFor();
}
async function checkIn(reason, priority = 'normal') {
  await page.getByTestId('priority').selectOption(priority);
  await page.getByTestId('reason').fill(reason);
  await page.getByTestId('check-in').click();
  await page.getByTestId('notice').filter({ hasText: /Đã cấp số/ }).waitFor();
  return /số (\d+)/.exec(await page.getByTestId('notice').innerText())[1];
}
async function callPatient(name) {
  await page.getByTestId('tab-queue').click();
  const row = page.getByTestId('queue-row').filter({ hasText: name }).filter({ has: page.getByTestId('call') }).first();
  await row.getByTestId('call').click();
  await page.getByTestId('visit').waitFor();
}
async function pickDiagnosis(query) {
  await page.getByTestId('dx-search').fill(query);
  await page.getByTestId('dx-search-item').first().waitFor();
  await page.getByTestId('dx-search').press('Enter');
}
const pendingState = () => page.getByTestId('gateway-status').getAttribute('data-status');
/** Đọc thẳng mọi kho IndexedDB của ứng dụng trong trình duyệt (không qua mã ứng dụng): tên kho, số bản ghi từng bảng, mọi byte dưới dạng chữ. */
const rawLocalDump = () =>
  page.evaluate(async () => {
    const out = { names: [], rows: {}, keys: 0, text: '' };
    const decoder = new TextDecoder();
    const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));
    for (const { name } of (await indexedDB.databases()).filter((d) => d.name?.startsWith('phongmach:'))) {
      out.names.push(name);
      const db = await req(indexedDB.open(name));
      for (const store of db.objectStoreNames) {
        const rows = await req(db.transaction(store).objectStore(store).getAll());
        out.rows[store] = (out.rows[store] ?? 0) + rows.length;
        if (store === 'meta') out.keys += rows.filter((r) => r.k === 'key').length;
        for (const row of rows) for (const v of Object.values(row)) out.text += `${v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? decoder.decode(v) : JSON.stringify(v)}\n`;
      }
      db.close();
    }
    return out;
  });
/** Xuất PDF như khi in: phải đúng một trang khổ A5 (148×210 mm ≈ 419,5×595,3 pt). */
async function assertOneA5Page(html, name) {
  const printPage = await context.newPage();
  try {
    await printPage.setContent(html);
    const pdf = (await printPage.pdf({ preferCSSPageSize: true })).toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    assert.equal(pages, 1, `đơn phải vừa một trang A5, thực tế ${pages}`);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    assert.ok(box && Math.abs(Number(box[1]) - 419.5) < 1.5 && Math.abs(Number(box[2]) - 595.3) < 1.5, `khổ A5, thực tế ${box?.slice(1, 3)}`);
    await printPage.screenshot({ path: `${shots}${name}.png` });
  } finally {
    await printPage.close();
  }
}

try {
  await resetQueue();
  // ================================================================== Tiếp đón: cấp số
  await login('noi-assistant');
  await openPatient('nguyen van an', 'Nguyễn Văn An');
  assert.match(await page.getByTestId('allergies').innerText(), /Penicillin/, 'bệnh nhân demo có dị ứng penicillin');
  const anNumber = await checkIn('Đau họng 2 ngày');
  ok(`phụ tá tìm "nguyen van an", thấy dị ứng Penicillin đã ghi, cấp số ${anNumber}`);

  await openPatient('tran thi', 'Trần Thị Bình');
  const binhNumber = await checkIn('Hắt hơi, ngạt mũi', 'appointment');
  await page.getByTestId('tab-queue').click();
  await page.getByTestId('queue-row').first().waitFor();
  const waiting = await page.getByTestId('waiting').getByTestId('queue-row').allInnerTexts();
  assert.ok(waiting.findIndex((t) => t.includes('Trần Thị Bình')) < waiting.findIndex((t) => t.includes('Nguyễn Văn An')), 'người đã hẹn được gọi trước dù đến sau');
  assert.equal(await page.getByTestId('call').count(), 0, 'phụ tá không có nút "Gọi vào khám"');
  await shot('10-queue-assistant');
  ok(`hàng chờ: số ${binhNumber} (đã hẹn) đứng trước số ${anNumber} (thường); phụ tá không có nút gọi vào khám`);

  await page.getByTestId('tab-display').click();
  await page.getByTestId('display-cell').first().waitFor();
  const board = await page.getByTestId('display').innerText();
  assert.match(board, /N\.V\.A/);
  assert.ok(!/Nguyễn|Trần/.test(board), 'màn hình chờ không được có họ tên đầy đủ');
  await shot('11-display');
  ok('màn hình chờ chỉ hiện số thứ tự và chữ cái đầu (N.V.A), không có họ tên');

  // ================================================================== Bác sĩ khám bệnh nhân có dị ứng
  await logout();
  await login('noi-doctor');
  await callPatient('Nguyễn Văn An');
  assert.match(await page.getByTestId('visit-timer').innerText(), /\d+:\d\d/);
  assert.match(await page.getByTestId('allergies').innerText(), /Penicillin/);
  assert.match(await page.getByTestId('history').innerText(), /Tăng huyết áp/);
  assert.ok((await page.getByTestId('prev-visit').count()) >= 2, 'ít nhất hai lượt khám cũ (dữ liệu demo)');
  assert.equal(await page.getByTestId('exam-reason').inputValue(), 'Đau họng 2 ngày', 'lý do khám lấy từ lúc cấp số');
  ok('bác sĩ gọi vào khám: đồng hồ chạy, thấy dị ứng, tiền sử, các lượt khám cũ; lý do khám điền sẵn');

  await page.getByTestId('vital-temperatureC').fill('38,5');
  await page.getByTestId('vital-pulse').fill('96');
  await page.getByTestId('vital-weightKg').fill('68');
  await page.getByTestId('exam-symptoms').fill('Đau họng, sốt nhẹ, không ho');
  await page.getByTestId('exam-findings').fill('Họng đỏ, amiđan không to');
  await pickDiagnosis('viem hong'); // gõ tắt không dấu, chọn bằng bàn phím
  assert.match(await page.getByTestId('dx-selected').innerText(), /J02\.9/);
  await page.getByTestId('vital-pulse').fill('chín mươi');
  assert.equal(await page.getByTestId('vital-pulse').getAttribute('aria-invalid'), 'true');
  await page.getByTestId('vital-pulse').fill('96');
  ok('gõ tắt "viem hong" chọn bằng bàn phím ra J02.9; sinh hiệu sai (chữ) bị đánh dấu, dấu phẩy "38,5" được hiểu');

  // Bản nháp nằm trong kho mã hóa trên máy (IndexedDB): chờ lưu xong rồi đọc thẳng kho như người mở tệp của trình duyệt.
  await page.locator('[data-testid="draft-saved"][data-dirty="false"][data-persistent="true"]').waitFor();
  const raw = await rawLocalDump();
  assert.ok(raw.names.includes('phongmach:noi-tong-quat:noi-doctor'), `có kho của bác sĩ, thực tế ${raw.names}`);
  assert.ok(raw.rows.drafts >= 1 && raw.keys === 1, `kho có bản nháp và đúng một khóa: ${JSON.stringify(raw)}`);
  for (const secret of ['Đau họng, sốt nhẹ, không ho', 'Họng đỏ', 'J02.9', 'Nguyễn Văn An', 'symptoms']) assert.ok(!raw.text.includes(secret), `kho trên máy không được có "${secret}" ở dạng rõ`);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('phongmach.draft.'))), [], 'không còn bản nháp trong sessionStorage');
  ok('bản nháp lưu trong IndexedDB đã mã hóa: đọc thẳng kho không thấy triệu chứng, chẩn đoán, tên; sessionStorage không còn bản nháp');

  // Mô phỏng tải lại trang giữa chừng: bản nháp phải còn.
  await page.reload();
  await page.getByTestId('tab-queue').click();
  await page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).getByTestId('continue').click();
  await page.getByTestId('visit').waitFor();
  assert.equal(await page.getByTestId('exam-symptoms').inputValue(), 'Đau họng, sốt nhẹ, không ho');
  assert.match(await page.getByTestId('dx-selected').innerText(), /J02\.9/);
  await page.waitForTimeout(1300);
  assert.doesNotMatch(await page.getByTestId('visit-timer').innerText(), /\n0:00$/, 'đồng hồ phiên khám phải chạy tiếp từ lúc mở hồ sơ, không về 0 sau khi tải lại');
  ok('tải lại trang giữa chừng: "Tiếp tục khám" khôi phục bản nháp (triệu chứng, chẩn đoán)');

  // Đơn mẫu có amoxicillin: cảnh báo dị ứng; thêm paracetamol hai dạng: cảnh báo trùng hoạt chất
  await page.getByTestId('template').selectOption('viem-hong-cap');
  await page.getByTestId('line').first().waitFor();
  await page.getByTestId('drug-search').fill('paracetamol 250');
  await page.getByTestId('drug-search-item').first().waitFor();
  await page.getByTestId('drug-search').press('Enter');
  // Chọn dòng theo mã thuốc: lời cảnh báo trùng hoạt chất nhắc tên thuốc kia nên không thể lọc theo chữ.
  const sachet = page.locator('[data-testid=line][data-drug="PARACETAMOL-250-MG-GOI"]');
  await sachet.getByTestId('line-perDose').fill('1');
  await sachet.getByTestId('line-timesPerDay').fill('3');
  await sachet.getByTestId('line-days').fill('3');
  // Thuốc dùng khi cần: số lượng phải do bác sĩ nhập; chưa nhập thì là lỗi chặn ký (không phải cảnh báo xác nhận được).
  assert.ok((await page.getByTestId('rule').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')))).includes('incomplete-line'), 'thiếu số lượng thuốc dùng khi cần phải bị chặn');
  await sachet.getByTestId('line-quantity').fill('9');
  const rules = await page.getByTestId('rule').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));
  assert.ok(rules.includes('allergy'), `cảnh báo dị ứng, có: ${rules}`);
  assert.ok(rules.includes('duplicate-ingredient'), `cảnh báo trùng hoạt chất, có: ${rules}`);
  assert.equal(await page.getByTestId('sign').isDisabled(), true, 'chưa xác nhận thì không ký được');
  assert.match(await page.getByTestId('sign-blocked').innerText(), /cảnh báo chưa xác nhận/);
  await shot('12-visit-warnings');
  ok('đơn mẫu viêm họng: cảnh báo dị ứng penicillin và trùng paracetamol; nút "Ký & In" bị khóa cho đến khi xác nhận');

  const reasons = page.getByTestId('ack-reason');
  assert.ok((await reasons.count()) >= 2);
  await reasons.nth(0).fill('ok'); // quá ngắn
  assert.equal(await page.getByTestId('sign').isDisabled(), true, 'lý do quá ngắn không đủ');
  for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill('Đã dùng nhiều lần, dung nạp tốt');
  assert.equal(await page.getByTestId('sign').isDisabled(), false);
  ok('nhập lý do vẫn kê (lý do 2 ký tự không đủ) thì mở khóa "Ký & In"');

  // Ký bằng bấm đúp: chỉ một đơn
  // Đếm lượt khám mới theo id, không theo độ dài danh sách: BFF trả tối đa 50 lượt (mới nhất trước), mà bệnh nhân demo
  // có thêm lượt khám sau mỗi lần chạy e2e, nên tới lần chạy thứ ~50 độ dài dừng ở 50 và phép đếm cũ luôn ra 0.
  const visitIds = async () => (await api('GET', `/api/patients/${await patientIdOf()}/visits?limit=50`)).json.visits.map((v) => v.encounterId);
  const before = new Set(await visitIds());
  const completed = page.waitForResponse((r) => /\/api\/visits\/.+\/complete/.test(r.url()) && r.request().method() === 'POST');
  await page.getByTestId('sign').dblclick();
  const res = await completed;
  assert.equal(res.status(), 201);
  const signed = await res.json();
  await page.getByTestId('sign-result').waitFor();
  assert.match(await page.getByTestId('rx-code').innerText(), /^PM-\d{6}-[0-9A-Z]{6}$/);
  assert.equal(signed.prescription.acknowledgements.length >= 2, true, 'lý do xác nhận được lưu cùng đơn');
  const added = (await visitIds()).filter((id) => !before.has(id));
  assert.equal(added.length, 1, `bấm đúp không tạo hai lượt khám, thực tế ${added.length} lượt mới`);
  const seconds = Number(/\((\d+) giây/.exec(await page.getByTestId('visit-seconds').innerText())[1]);
  assert.ok(seconds >= 1, 'đồng hồ phiên khám do server đo');
  await shot('13-sign-result');
  ok(`ký & in (bấm đúp): đúng 1 lượt khám mới, mã đơn ${signed.prescription.code}, phiên khám ${seconds} giây, lý do xác nhận được lưu`);

  // In A5: iframe in có mã QR, vừa một trang A5
  const frame = page.frameLocator('iframe[data-testid="print-frame"]');
  await frame.locator('svg').first().waitFor({ state: 'attached' });
  const printed = await frame.locator('body').innerText();
  assert.ok(printed.includes(signed.prescription.code) && printed.includes('BẢN MÔ PHỎNG') && printed.includes('Nguyễn Văn An'));
  const html = (await api('GET', `/api/prescriptions/${signed.prescription.id}/print`)).text;
  await assertOneA5Page(html, '14-print-a5');
  ok('in A5: có mã QR (SVG), mã đơn, nhãn mô phỏng; xuất PDF đúng 1 trang khổ A5');

  // Mất mạng ngay sau khi ký: "In lại đơn" dựng trang in ngay trong trình duyệt từ dữ liệu trên máy, cùng mẫu với BFF.
  const framesBefore = await page.locator('iframe[data-testid="print-frame"]').count();
  offline = true;
  await context.setOffline(true);
  await page.getByTestId('reprint').click();
  await page.getByTestId('printed-locally').waitFor();
  const localHtml = await page.locator('iframe[data-testid="print-frame"]').nth(framesBefore).getAttribute('srcdoc');
  await context.setOffline(false);
  offline = false;
  // Dòng cuối (trạng thái liên thông) được phép khác: lúc này đơn có thể đã "Đã gửi"; bản in từ máy ghi rõ có thể chưa cập nhật.
  const gatewayLine = /<div class="row" style="font:8pt sans-serif;margin-top:2mm">.*?<\/div>/s;
  assert.match(localHtml, gatewayLine);
  assert.match(localHtml.match(gatewayLine)[0], /In khi mất mạng từ dữ liệu trên máy/);
  const compared = html.replace(gatewayLine, '');
  for (const part of ['<svg', signed.prescription.code, 'Nguyễn Văn An', 'Amoxicillin', '<b>Tuổi:</b>']) assert.ok(compared.includes(part), `phần đem so phải có "${part}"`);
  assert.equal(localHtml.replace(gatewayLine, ''), compared, 'trang in dựng ở trình duyệt phải giống từng ký tự trang do BFF dựng (trừ dòng liên thông)');
  await assertOneA5Page(localHtml, '14b-print-a5-local');
  ok('mất mạng, "In lại đơn": in từ dữ liệu trên máy, giống từng ký tự bản BFF (trừ dòng liên thông), PDF đúng 1 trang A5');

  // Liên thông: cổng đang chạy nên đơn sang "Đã gửi"
  await page.getByTestId('gateway-status').filter({ hasText: 'Đã gửi' }).waitFor({ timeout: 20_000 });
  assert.match(await page.getByTestId('gateway-status').innerText(), /SIM-[0-9A-F]{10}/);
  ok('liên thông: đơn tự chuyển "Đã ký" → "Đã gửi" kèm mã quốc gia (cổng mô phỏng)');

  // ================================================================== Kê lại một nút + lỗi cổng + tự thử lại
  await page.getByTestId('back-to-queue').click();
  await page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).filter({ hasText: 'Đã xong' }).first().waitFor();
  await page.getByTestId('tab-gateway').click();
  await page.getByTestId('sim-panel').waitFor();
  assert.match(await page.getByTestId('sim-panel').innerText(), /MÔ PHỎNG/);
  await page.getByTestId('sim-down').click();
  await page.getByTestId('sim-state').filter({ hasText: 'mất kết nối' }).waitFor();
  ok('mở "Liên thông": bảng điều khiển có nhãn MÔ PHỎNG; chèn lỗi "Mất kết nối cổng"');

  await page.getByTestId('tab-queue').click();
  await callPatient('Trần Thị Bình');
  assert.match(await page.getByTestId('allergies').innerText(), /kháng viêm/, 'Bình dị ứng NSAID');
  await page.getByTestId('repeat').first().click(); // kê lại: MỘT nút
  await page.getByTestId('line').first().waitFor();
  assert.match(await page.getByTestId('dx-selected').innerText(), /J30\.4/);
  assert.match(await page.getByTestId('line').first().innerText(), /Cetirizin/);
  assert.equal(await page.getByTestId('line').first().getByTestId('line-days').inputValue(), '14');
  assert.equal(await page.getByTestId('rules-ok').count(), 1, 'đơn kê lại không có cảnh báo');
  await page.getByTestId('exam-symptoms').fill('Hắt hơi từng cơn, ngạt mũi');
  assert.equal(await page.getByTestId('sign').isDisabled(), false);
  ok('"Kê lại đơn này" một nút: điền thuốc (cetirizin 14 ngày), chẩn đoán J30.4; không cảnh báo; ký được ngay');

  await page.getByTestId('sign').click();
  await page.getByTestId('sign-result').waitFor();
  await page.getByTestId('gateway-status').filter({ hasText: 'Chờ gửi lại' }).waitFor({ timeout: 20_000 });
  const retryText = await page.getByTestId('gateway-status').innerText();
  assert.match(retryText, /không phản hồi/);
  await shot('15-gateway-retry');
  ok('cổng mất kết nối: đơn đã ký vẫn lưu, hiện "Chờ gửi lại" kèm lý do (không mất đơn)');

  await page.getByTestId('back-to-queue').click();
  await page.getByTestId('tab-gateway').click();
  await page.getByTestId('pending-row').first().waitFor();
  assert.ok(['retry', 'signed', 'sending'].includes(await page.getByTestId('pending-row').first().getAttribute('data-status')));
  await shot('16-pending');
  await page.getByTestId('sim-up').click();
  await page.getByTestId('pending-empty').waitFor({ timeout: 60_000 });
  ok('"Đơn chưa gửi được" liệt kê đơn; bật lại cổng thì đơn TỰ gửi được (không bấm gì), danh sách trống');

  // ================================================================== Số đo, nhật ký, cách ly
  await logout();
  assert.ok(!(await rawLocalDump()).names.includes('phongmach:noi-tong-quat:noi-doctor'), 'đăng xuất phải xóa kho trên máy của bác sĩ');
  ok('bác sĩ đăng xuất: kho trên máy (bản nháp và khóa) bị xóa');
  await login('noi-owner');
  await page.getByTestId('tab-metrics').click();
  await page.getByTestId('metrics-row').first().waitFor();
  const metrics = await page.getByTestId('metrics-table').innerText();
  assert.match(metrics, /Lê Thị Thu Hà|Lê Thu Hà|BS\./);
  assert.match(metrics, /giây/);
  await shot('17-metrics');
  ok('chủ phòng khám xem thời gian khám theo bác sĩ (p50/p90 so với mục tiêu 60/120 giây)');

  await page.getByTestId('tab-audit').click();
  await page.getByTestId('audit-table').waitFor();
  const audit = await page.getByTestId('audit-table').innerText();
  for (const label of ['Cho vào hàng chờ', 'Mở hồ sơ khám', 'Kết thúc khám / ký đơn', 'In đơn thuốc', 'Gửi đơn lên cổng', 'Chỉnh cổng mô phỏng']) assert.ok(audit.includes(label), `thiếu "${label}" trong nhật ký`);
  for (const secret of ['Nguyễn Văn An', 'Trần Thị Bình', 'Amoxicillin', 'Cetirizin', 'J02', 'Đau họng']) assert.ok(!audit.includes(secret), `nhật ký không được chứa "${secret}"`);
  await shot('18-audit');
  ok('nhật ký truy cập có đủ hành động mới (cấp số, mở hồ sơ, ký đơn, in, gửi cổng, chỉnh cổng) và không chứa tên bệnh nhân, thuốc, chẩn đoán');

  await logout();
  await login('nhi-owner');
  await page.getByTestId('tab-queue').click();
  await page.getByTestId('tab-queue').click();
  await page.waitForTimeout(500);
  const nhiQueue = await page.locator('main').innerText();
  assert.ok(!nhiQueue.includes('Nguyễn Văn An') && !nhiQueue.includes('Trần Thị Bình'), 'phòng khám Nhi không thấy hàng chờ của phòng khám Nội');
  await page.getByTestId('tab-gateway').click();
  await page.getByTestId('pending-empty').waitFor();
  assert.match(await page.getByTestId('sim-state').innerText(), /đang chạy/, 'cổng của Nhi không bị ảnh hưởng khi Nội chèn lỗi');
  ok('cách ly: Nhi không thấy hàng chờ của Nội; cổng mô phỏng của Nhi độc lập với Nội');

  await logout();
  await login('noi-doctor');
  await page.getByTestId('tab-scope').click();
  const scope = await page.getByTestId('scope').innerText();
  for (const label of ['Đã làm thật', 'Mô phỏng', 'Chưa làm ở M0', 'Chữ ký số', 'Cổng đơn thuốc quốc gia', 'Ngoại tuyến']) assert.ok(scope.includes(label), `trang phạm vi thiếu "${label}"`);
  // M0-5 theo cả hai chiều: mục nào nằm ở khối nào mới là điều phải đúng, không chỉ là có chữ đó ở đâu trên trang.
  const scopeBlock = async (name) => (await page.getByTestId('scope').locator(`section[aria-label="${name}"] li`).allInnerTexts()).map((t) => t.trim());
  const real = await scopeBlock('Đã làm thật');
  const simulated = await scopeBlock('Mô phỏng (có nhãn trên màn hình)');
  const missing = await scopeBlock('Chưa làm ở M0');
  const offlineReal = real.filter((t) => /ngoại tuyến/i.test(t));
  assert.equal(offlineReal.length, 1, `khối "Đã làm thật" phải có đúng một dòng ngoại tuyến, thực tế ${offlineReal.length}`);
  for (const part of [/mất mạng vẫn/, /cấp số tạm/, /khám/, /in đơn/, /đồng bộ/, /không mất, không trùng/]) assert.match(offlineReal[0], part, 'dòng ngoại tuyến ở "Đã làm thật" phải nói đúng cái đã làm');
  assert.ok(real.some((t) => /trên máy/.test(t) && /mã hóa/.test(t)), 'khối "Đã làm thật" phải nói dữ liệu trên máy được mã hóa');
  assert.ok(!simulated.some((t) => /ngoại tuyến/i.test(t)), 'ngoại tuyến không phải phần mô phỏng');
  // Khối "Chưa làm" chỉ được nhắc tới ngoại tuyến để nêu phần còn thiếu, và phải nêu đủ các phần đó.
  const offlineMissing = missing.filter((t) => /ngoại tuyến/i.test(t));
  for (const t of offlineMissing) assert.match(t, /phần chưa có/, `khối "Chưa làm ở M0" không được ghi ngoại tuyến là chưa làm: "${t}"`);
  for (const gap of [/hai máy/, /xung đột/, /ký số và gửi cổng/, /toàn bộ danh sách bệnh nhân/, /mã PIN/]) assert.ok(offlineMissing.some((t) => gap.test(t)), `khối "Chưa làm ở M0" thiếu giới hạn của ngoại tuyến: ${gap}`);
  // Dải nhãn ở đầu mọi màn hình phải nói cùng một điều với trang này.
  const banner = (await page.locator('.demo-banner').innerText()).split('·').map((t) => t.trim());
  const bannerSimulated = banner.find((t) => t.startsWith('Mô phỏng')) ?? '';
  const bannerMissing = banner.find((t) => t.startsWith('Chưa có:')) ?? '';
  assert.ok(bannerSimulated && bannerMissing, `dải nhãn thiếu phần "Mô phỏng" hoặc "Chưa có:": ${banner.join(' | ')}`);
  assert.ok(!/ngoại tuyến/i.test(bannerMissing), 'dải nhãn không được ghi ngoại tuyến là chưa có');
  assert.equal(/zalo/i.test(bannerSimulated), simulated.some((t) => /zalo/i.test(t)), 'dải nhãn và trang "Phạm vi" phải xếp Zalo vào cùng một nhóm (mô phỏng hay không)');
  assert.equal(/zalo/i.test(bannerMissing), !simulated.some((t) => /zalo/i.test(t)), 'Zalo chưa có phần mô phỏng thì dải nhãn phải ghi là chưa có');
  await shot('20-scope');
  ok('trang "Phạm vi": ngoại tuyến nằm ở "Đã làm thật", phần còn thiếu của nó nằm ở "Chưa làm ở M0"; dải nhãn khớp với trang (tiêu chí M0-5)');

  // ================================================================== Máy tính bảng ngang
  await logout();
  await login('noi-doctor');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByTestId('tab-reception').click();
  await openPatient('nguyen van an', 'Nguyễn Văn An');
  await checkIn('Tái khám');
  await callPatient('Nguyễn Văn An');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, 'không cuộn ngang ở 1024×768');
  await shot('19-visit-tablet-landscape');
  await page.getByTestId('leave-visit').click(); // lượt này được dọn ở cuối (resetQueue)
  ok('máy tính bảng ngang 1024×768: màn hình khám không cuộn ngang');

  assert.deepEqual(problems, [], `lỗi trong console:\n${problems.join('\n')}`);
  ok('không có lỗi nào trong console của trình duyệt');
  console.log(`\nĐạt ${step}/${step}. Ảnh chụp: ${shots}`);
} catch (err) {
  await shot('FAILED-visit').catch(() => {});
  console.error('\n✗ Hỏng ở bước', step + 1, '\n', err);
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  // Trả cổng mô phỏng về trạng thái chạy và dọn hàng chờ, kể cả khi kịch bản hỏng giữa chừng.
  try {
    await context.setOffline(false);
    await resetQueue();
    await logout().catch(() => {});
    await login('noi-doctor');
    await api('POST', '/api/sim/gateway', { mode: 'up', failNext: 0 });
  } catch {
    // bỏ qua
  }
  await browser.close();
}

async function patientIdOf() {
  // Bệnh nhân của lượt khám đang mở: lấy từ ngữ cảnh đã tải trong lần gọi mở hồ sơ gần nhất.
  const queue = (await api('GET', '/api/queue')).json.items;
  const mine = queue.find((i) => i.status === 'in-exam' && i.patientName === 'Nguyễn Văn An') ?? queue.find((i) => i.patientName === 'Nguyễn Văn An');
  return mine.patientId;
}
