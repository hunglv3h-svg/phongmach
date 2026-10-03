#!/usr/bin/env node
// Diễn tập kỹ thuật của phiên thử với bác sĩ (tiêu chí M0-1), trên Chromium thật và một phòng khám diễn tập riêng:
// đi đúng các bước điều phối viên sẽ làm trong buổi thử (lệnh `pnpm trial …` + giao diện), rồi kiểm con số xuất ra.
//
//   1. hai bác sĩ thử, mỗi người một lượt trọn vẹn: 3 ca làm quen rồi 12 ca tính số đo (bác sĩ 1 nội, bác sĩ 2 nhi), mỗi ca đi đúng
//      đường đi ghi trong bộ ca (`steps`); đơn máy chủ lưu phải đúng như phiếu ca ghi;
//   2. một lượt mở rồi bỏ dở, `pnpm trial clear` rồi `clear force`;
//   3. `pnpm trial export`: ca làm quen bị loại, p50 và p90 của từng bác sĩ khớp với số giây màn hình đã hiện sau mỗi lần ký
//      (bài này tự tính phân vị một cách độc lập để đối chiếu), và bảng đối chiếu khớp từng ô với màn hình "Thời gian khám";
//   4. phiếu ca in ra đúng mỗi ca một trang A4.
//
// SỐ ĐO CỦA BÀI NÀY LÀ SỐ CHẠY THỬ KỸ THUẬT (máy bấm), KHÔNG PHẢI SỐ CỦA BÁC SĨ. Bài từ chối chạy trên phiên không phải diễn tập.
//
//   pnpm trial:rehearsal        (ở gốc kho: tự tạo phòng khám diễn tập, BFF 8113, bản build 4176; xem infra/trial.mjs)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:4176';
const TRIAL = process.env.TRIAL ?? '';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORK = process.env.TRIAL_DIR ?? join(ROOT, 'services', 'bff', '.data', 'trial', TRIAL);
if (!TRIAL.startsWith('dien-tap')) throw new Error(`Bài diễn tập chỉ chạy trên phiên có tên bắt đầu bằng "dien-tap" (TRIAL đang là "${TRIAL}"). Chạy bằng "pnpm trial:rehearsal".`);

const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });

const TURNS = [
  { doctor: 'bs1', name: 'Bác sĩ thử 1', specialty: 'noi' },
  { doctor: 'bs2', name: 'Bác sĩ thử 2', specialty: 'nhi' },
];

/** Chạy một lệnh `pnpm trial …` như điều phối viên gõ ở gốc kho; trả về mã thoát và mọi thứ lệnh in ra. */
function tryTrial(...args) {
  const r = spawnSync('pnpm', ['trial', ...args], { cwd: ROOT, env: { ...process.env, TRIAL }, shell: process.platform === 'win32', encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}
function trial(...args) {
  const r = tryTrial(...args);
  if (r.status !== 0) throw new Error(`"pnpm trial ${args.join(' ')}" lỗi (mã ${r.status}):\n${r.output}`);
  return r.output;
}
function plan(turn, warmup) {
  // Lệnh tự ghi vào thư mục của phiên (không truyền đường dẫn qua tham số: đường dẫn có dấu cách bị tách trên Windows).
  trial('plan', turn.doctor, turn.specialty, ...(warmup ? ['warmup'] : []));
  return JSON.parse(readFileSync(join(WORK, `plan-${turn.doctor}-${turn.specialty}${warmup ? '-warmup' : ''}.json`), 'utf8')).cases;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'vi-VN' });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${String(++step).padStart(2)}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${shots}trial-${name}.png` });
const vn = (n) => String(n).replace('.', ',');
/** Phân vị theo hạng gần nhất, tính độc lập với BFF để đối chiếu. */
const nearestRank = (values, p) => [...values].sort((a, b) => a - b)[Math.max(1, Math.ceil((p / 100) * values.length)) - 1];
async function eventually(check, what, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() > until) throw new Error(`hết thời gian chờ: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
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

const SHOT_CASES = new Set(['N03', 'N06', 'P05', 'P10']);
/** Khóa của một phát hiện bắt đầu bằng tên quy tắc, trừ hai quy tắc dùng tên ngắn (packages/rules/src/check.ts). */
const RULE_OF_KEY = { dup: 'duplicate-ingredient', 'paed-form': 'paediatric-form', incomplete: 'incomplete-line' };
const line = (drug) => page.locator(`[data-testid="line"][data-drug="${drug}"]`);
const rule = (id) => page.locator(`[data-testid="rule"][data-rule="${id}"]`);

async function perform(s) {
  switch (s.do) {
    case 'dx':
      await page.getByTestId('dx-search').fill(s.query);
      await page.getByTestId('dx-search-item').first().waitFor();
      await page.getByTestId('dx-search').press('Enter');
      await page.getByTestId('dx-tag').filter({ hasText: s.code }).waitFor();
      return;
    case 'template':
      await page.getByTestId('template').selectOption(s.id);
      await page.getByTestId('line').first().waitFor();
      return;
    case 'repeat':
      await page.getByTestId('repeat').first().click();
      await page.getByTestId('line').first().waitFor();
      return;
    case 'add':
      await page.getByTestId('drug-search').fill(s.query);
      await page.getByTestId('drug-search-item').first().waitFor();
      await page.getByTestId('drug-search').press('Enter');
      await line(s.drug).waitFor();
      return;
    case 'remove':
      await line(s.drug).getByTestId('line-remove').click();
      await line(s.drug).waitFor({ state: 'detached' });
      return;
    case 'set':
      for (const field of ['perDose', 'timesPerDay', 'days']) if (s[field] !== undefined) await line(s.drug).getByTestId(`line-${field}`).fill(s[field]);
      if (s.quantity !== undefined) await line(s.drug).getByTestId('line-quantity').fill(s.quantity);
      return;
    case 'weight':
      await page.getByTestId('vital-weightKg').fill(s.kg);
      return;
    case 'expect':
      await rule(s.rule).first().waitFor();
      return;
    case 'ack':
      for (const input of await rule(s.rule).getByTestId('ack-reason').all()) await input.fill(s.reason);
      return;
  }
}

/** Một lượt khám trên giao diện, từ "Gọi vào khám" tới "Về hàng chờ". Trả về số giây màn hình hiện sau khi ký. */
async function visit(c, thinkMs) {
  await page.getByTestId('tab-queue').click();
  // Hàng chờ tự tải lại mỗi 5 giây; người được gọi tiếp theo phải đúng là ca kế tiếp của kế hoạch.
  const first = page.getByTestId('waiting').getByTestId('queue-row').first();
  await eventually(async () => (await first.count()) > 0 && (await first.innerText()).includes(c.patientName), `ca ${c.id} (${c.patientName}) đứng đầu hàng chờ`);
  await first.getByTestId('call').click();
  await page.getByTestId('visit').waitFor();
  assert.match(await page.locator('.visit-head h1').innerText(), new RegExp(c.patientName));
  assert.equal(await page.getByTestId('exam-reason').inputValue(), c.reason, `${c.id}: lý do khám điền sẵn từ lúc cấp số`);

  for (const [field, value] of Object.entries(c.vitals)) await page.getByTestId(`vital-${field}`).fill(vn(value));
  await page.getByTestId('exam-symptoms').fill(c.story[0]);
  await page.getByTestId('exam-findings').fill(c.findings);
  for (const s of c.steps) {
    await perform(s);
    // Vài ảnh chụp lúc màn hình đang cảnh báo, để người đọc báo cáo thấy bác sĩ sẽ gặp gì.
    if (s.do === 'expect' && SHOT_CASES.has(c.id)) await shot(`${c.id}-${s.rule}`);
  }
  // Thời gian "khám" giả, khác nhau giữa các ca, để p50 khác p90 và phép đối chiếu phân vị có nghĩa. Đây là thứ được đo, không phải
  // một bước chờ điều kiện.
  await page.waitForTimeout(thinkMs);

  await page.locator('[data-testid="sign"]:not([disabled])').waitFor();
  const completed = page.waitForResponse((r) => /\/api\/visits\/.+\/complete$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
  await page.getByTestId('sign').click();
  const res = await completed;
  assert.equal(res.status(), 201, `${c.id}: máy chủ nhận lượt khám`);
  const signed = await res.json();
  assert.deepEqual(signed.visit.diagnoses.map((d) => d.code).sort(), [...c.final.dx].sort(), `${c.id}: chẩn đoán`);
  const lines = signed.prescription.lines;
  assert.deepEqual(lines.map((l) => l.drug), c.final.lines.map((l) => l.drug), `${c.id}: thuốc trong đơn`);
  c.final.lines.forEach((want, i) => {
    for (const field of ['perDose', 'timesPerDay', 'days', 'quantity']) if (want[field] !== undefined) assert.equal(lines[i][field], want[field], `${c.id}: ${want.drug} ${field}`);
  });
  assert.deepEqual(signed.prescription.acknowledgements.map((a) => RULE_OF_KEY[a.key.split(':')[0]] ?? a.key.split(':')[0]).sort(), [...c.final.acks].sort(), `${c.id}: cảnh báo đã xác nhận lưu cùng đơn`);

  await page.getByTestId('sign-result').waitFor();
  const seconds = Number(/\((\d+) giây/.exec(await page.getByTestId('visit-seconds').innerText())[1]);
  assert.equal(seconds, signed.visit.visitSeconds, `${c.id}: số giây trên màn hình là số máy chủ đo`);
  await page.getByTestId('back-to-queue').click();
  return seconds;
}

/** Đọc bảng "Thời gian khám" đang hiện: mỗi dòng thành cùng hình dạng với một nhóm của computeMetrics. */
async function readMetricsTable() {
  const parse = (cells) => {
    const s = (text) => (/\((\d+) giây\)/.exec(text) ? Number(/\((\d+) giây\)/.exec(text)[1]) : undefined);
    const row = { name: cells[0].trim(), visits: Number(cells[1]), excluded: Number(cells[4]), clientMeasured: Number(cells[5]), invalidClock: Number(cells[6]) };
    if (s(cells[2]) !== undefined) row.p50Seconds = s(cells[2]);
    if (s(cells[3]) !== undefined) row.p90Seconds = s(cells[3]);
    return row;
  };
  const doctors = [];
  for (const r of await page.getByTestId('metrics-row').all()) doctors.push(parse(await r.locator('td').allInnerTexts()));
  const { name: _name, ...all } = parse(await page.getByTestId('metrics-total').locator('td').allInnerTexts());
  return { doctors, all };
}
async function openMetricsToday(expectedVisits) {
  await page.getByTestId('tab-metrics').click();
  await page.locator('select[aria-label="Khoảng thời gian"]').selectOption('1');
  // Bảng tải lại khi đổi khoảng: chờ tới khi dòng tổng mang đúng số lượt của hôm nay rồi mới đọc.
  return eventually(async () => {
    if (!(await page.getByTestId('metrics-total').count())) return undefined;
    const table = await readMetricsTable();
    return table.all.visits === expectedVisits ? table : undefined;
  }, `bảng "Thời gian khám" (Hôm nay) có ${expectedVisits} lượt`);
}

try {
  trial('sheets');
  const seen = {};
  let n = 0;

  for (const turn of TURNS) {
    const warm = plan(turn, true);
    const measured = plan(turn, false);
    seen[turn.doctor] = { warm: [], measured: [] };

    assert.match(trial('queue', turn.doctor, turn.specialty, 'warmup'), new RegExp(`Đã xếp ${warm.length} lượt`));
    await login(turn.doctor);
    for (const c of warm) seen[turn.doctor].warm.push(await visit(c, 400));
    ok(`${turn.name}: ${warm.length} ca làm quen (${warm.map((c) => c.id).join(', ')}) đi hết đường đi, ký được`);

    assert.match(trial('queue', turn.doctor, turn.specialty), new RegExp(`Đã xếp ${measured.length} lượt`));
    assert.match(trial('queue', turn.doctor, turn.specialty), /xếp thêm 0 lượt/, 'chạy lại lệnh xếp không cấp số lần hai');
    for (const c of measured) {
      seen[turn.doctor].measured.push(await visit(c, 600 + ((n++ * 37) % 7) * 500));
    }
    ok(`${turn.name}: ${measured.length} ca tính số đo (${measured[0].id}…${measured.at(-1).id}) ký được; đơn máy chủ lưu đúng như phiếu ca ghi; cảnh báo hiện đúng chỗ`);

    if (turn.doctor === 'bs1') {
      // Một lượt mở rồi bỏ dở: không được vào p50/p90, nhưng phải được đếm khi xuất.
      trial('queue', turn.doctor, turn.specialty, 'warmup', 'round=2');
      await page.getByTestId('tab-queue').click();
      const first = page.getByTestId('waiting').getByTestId('queue-row').first();
      await eventually(async () => (await first.count()) > 0 && (await first.innerText()).includes(warm[0].patientName), 'lượt xếp lại đứng đầu hàng chờ');
      await first.getByTestId('call').click();
      await page.getByTestId('visit').waitFor();
      await page.getByTestId('leave-visit').click();
      const kept = trial('clear');
      assert.match(kept, new RegExp(`Đã hủy ${warm.length - 1} lượt đang chờ`));
      assert.match(kept, /Còn 1 lượt ĐANG KHÁM DỞ/);
      // Còn lượt khám dở của bác sĩ 1 thì lệnh xếp cho bác sĩ 2 phải từ chối, không xếp chồng trong im lặng.
      const blocked = tryTrial('queue', 'bs2', 'nhi', 'warmup');
      assert.notEqual(blocked.status, 0, 'lệnh xếp phải dừng khi hàng chờ còn lượt chưa xong của người khác');
      assert.match(blocked.output, /còn 1 lượt chưa xong không thuộc nhóm ca này/);
      assert.match(trial('clear', 'force'), /Đã hủy lượt đang khám dở/);
      ok('một lượt mở rồi bỏ dở: "trial clear" hủy các lượt đang chờ và giữ lượt khám dở; lệnh xếp cho bác sĩ sau bị chặn cho tới khi "clear force"');
    }
    await logout();
  }

  // ================================================================== Xuất số đo
  const out = trial('export', 'days=1', 'name=dien-tap');
  assert.match(out, /SỐ CHẠY THỬ KỸ THUẬT/, 'bản xuất của phiên diễn tập phải đóng nhãn số chạy thử kỹ thuật');
  const report = JSON.parse(readFileSync(join(WORK, 'export', 'dien-tap-tom-tat.json'), 'utf8'));
  assert.equal(report.rehearsal, true);
  const [bs1, bs2, bs3] = report.doctors;
  for (const [turn, d] of [[TURNS[0], bs1], [TURNS[1], bs2]]) {
    const mine = seen[turn.doctor];
    assert.equal(d.name, turn.name);
    assert.equal(d.metrics.visits, mine.measured.length, `${turn.name}: số lượt tính số đo`);
    assert.equal(d.warmupExcluded, mine.warm.length, `${turn.name}: ca làm quen bị loại`);
    assert.equal(d.metrics.p50Seconds, nearestRank(mine.measured, 50), `${turn.name}: p50 khớp số giây màn hình đã hiện sau mỗi lần ký`);
    assert.equal(d.metrics.p90Seconds, nearestRank(mine.measured, 90), `${turn.name}: p90 khớp số giây màn hình đã hiện sau mỗi lần ký`);
    assert.deepEqual([d.metrics.excluded, d.metrics.invalidClock, d.metrics.clientMeasured, d.outsideExcluded], [0, 0, 0, 0]);
    assert.equal(d.enoughVisits, true);
  }
  assert.equal(bs1.abandoned, 1, 'lượt mở rồi bỏ dở của bác sĩ 1 được đếm riêng');
  assert.equal(bs2.abandoned, 0);
  assert.deepEqual([bs3.metrics.visits, bs3.enoughVisits, bs3.p50Ok ?? null], [0, false, null], 'bác sĩ 3 chưa khám: không có số, không coi là đạt');
  const all = [...seen.bs1.measured, ...seen.bs2.measured];
  assert.deepEqual([report.m01.all.visits, report.m01.all.p50Seconds, report.m01.all.p90Seconds], [all.length, nearestRank(all, 50), nearestRank(all, 90)], 'số gộp');
  ok(`xuất số đo: mỗi bác sĩ ${bs1.metrics.visits} lượt tính số đo, ${bs1.warmupExcluded} ca làm quen bị loại, 1 lượt bỏ dở đếm riêng; p50 và p90 khớp phép tính độc lập trên số giây đã hiện sau mỗi lần ký (bs1 ${bs1.metrics.p50Seconds}/${bs1.metrics.p90Seconds} giây, bs2 ${bs2.metrics.p50Seconds}/${bs2.metrics.p90Seconds} giây: số máy bấm, không phải số của bác sĩ)`);

  const csv = readFileSync(join(WORK, 'export', 'dien-tap-luot-kham.csv'), 'utf8').replace(/^﻿/, '').trimEnd().split('\r\n').map((l) => l.split(','));
  const column = (name) => csv[0].indexOf(name);
  const signedRows = csv.slice(1).filter((r) => r[column('ky_luc')] !== '');
  assert.equal(signedRows.length, seen.bs1.warm.length + seen.bs1.measured.length + seen.bs2.warm.length + seen.bs2.measured.length, 'CSV: mỗi lượt đã ký một dòng');
  assert.equal(csv.length - 1 - signedRows.length, 1, 'CSV: lượt bỏ dở có một dòng riêng');
  for (const turn of TURNS) {
    const counted = signedRows.filter((r) => r[column('ma_nguoi_dung')] === turn.doctor && r[column('tinh_vao_phan_vi')] === 'có').map((r) => Number(r[column('giay')]));
    assert.deepEqual(counted.sort((a, b) => a - b), [...seen[turn.doctor].measured].sort((a, b) => a - b), `CSV: số giây từng lượt của ${turn.name}`);
    const warmups = signedRows.filter((r) => r[column('ma_nguoi_dung')] === turn.doctor && r[column('loai_ca')] === 'lam-quen');
    assert.ok(warmups.length === seen[turn.doctor].warm.length && warmups.every((r) => r[column('tinh_vao_phan_vi')] === 'không: ca làm quen'), 'CSV: ca làm quen ghi rõ là bị loại');
  }
  ok(`CSV: ${signedRows.length} lượt đã ký và 1 lượt bỏ dở, mỗi lượt một dòng; số giây từng lượt khớp màn hình; ca làm quen ghi "không: ca làm quen"`);

  // ================================================================== Đối chiếu với màn hình "Thời gian khám"
  const total = signedRows.length;
  await login('dieu-phoi');
  const owner = await openMetricsToday(total);
  assert.deepEqual(owner.doctors, report.screen.doctors, 'bảng của điều phối viên khớp từng ô với bảng đối chiếu trong bản xuất');
  assert.deepEqual(owner.all, report.screen.all, 'dòng "Toàn phòng khám" khớp bản xuất');
  await shot('metrics-owner');
  await logout();
  ok(`màn hình "Thời gian khám" của điều phối viên (Hôm nay) khớp từng ô với bảng đối chiếu của bản xuất: ${owner.doctors.length} bác sĩ, ${total} lượt`);

  for (const turn of TURNS) {
    await login(turn.doctor);
    const own = await openMetricsToday(seen[turn.doctor].warm.length + seen[turn.doctor].measured.length);
    assert.deepEqual(own.doctors, report.screen.doctors.filter((d) => d.name === turn.name), `${turn.name} chỉ thấy số của chính mình, khớp bản xuất`);
    await logout();
  }
  ok('mỗi bác sĩ mở "Thời gian khám" chỉ thấy dòng của mình, cũng khớp bản xuất');

  // ================================================================== Phiếu ca: mỗi ca một trang
  for (const turn of TURNS) {
    const html = readFileSync(join(WORK, '..', 'phieu-ca', `phieu-ca-${turn.specialty}.html`), 'utf8');
    const sheets = html.split('<section class="sheet">').length - 1;
    const printPage = await context.newPage();
    await printPage.setContent(html);
    const pdf = (await printPage.pdf({ preferCSSPageSize: true })).toString('latin1');
    await printPage.close();
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    assert.equal(sheets, 15, `phiếu ca ${turn.specialty}: 3 ca làm quen + 12 ca tính số đo`);
    assert.equal(pages, sheets, `phiếu ca ${turn.specialty}: mỗi ca đúng một trang A4, thực tế ${pages} trang cho ${sheets} ca`);
  }
  ok('phiếu ca in ra: 15 ca mỗi chuyên khoa, mỗi ca đúng một trang A4');

  assert.deepEqual(problems, [], `lỗi trong console:\n${problems.join('\n')}`);
  ok('không có lỗi nào trong console của trình duyệt');
  console.log(`\nĐạt ${step}/${step}. Bản xuất: ${join(WORK, 'export')}. Ảnh chụp: ${shots}`);
  console.log('Các con số ở trên là SỐ CHẠY THỬ KỸ THUẬT (máy bấm), không phải số đo M0-1.');
} catch (err) {
  // Ảnh mang tên phiên: một lần hỏng mà không chụp được (trình duyệt đã đóng) không để lại ảnh của lần chạy khác trông như của lần này.
  const shown = await shot(`FAILED-${TRIAL}`).then(() => true, () => false);
  console.error('\n✗ Hỏng ở bước', step + 1, '\n', err);
  console.error(shown ? `Ảnh lúc hỏng: ${shots}trial-FAILED-${TRIAL}.png` : 'Không chụp được ảnh lúc hỏng: trang hoặc trình duyệt đã đóng.');
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
