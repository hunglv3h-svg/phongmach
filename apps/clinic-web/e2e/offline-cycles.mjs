#!/usr/bin/env node
// Bài e2e đo tiêu chí M0-2 (kế hoạch, mục 5.3): 20 lần ngắt và khôi phục mạng liên tiếp, 0 bản ghi mất, 0 bản ghi trùng.
// Chromium thật, một máy, một phòng khám thử mới cho mỗi lần chạy. Mỗi chu kỳ một bệnh nhân mới đi hết đường, bác sĩ tự tiếp đón (N5):
// tạo bệnh nhân → cấp số → gọi vào khám → khám → ký và in. Kế hoạch từng chu kỳ sinh từ một hạt giống (cycles-plan.mjs):
//   - ngắt mạng thật (`context.setOffline`) trước một thao tác, bật lại trước một thao tác sau đó;
//   - mất phản hồi ở một thao tác làm lúc có mạng: máy chủ đã ghi, trình duyệt thấy lỗi mạng (`route.fetch()` rồi `route.abort()`);
//   - tải lại trang khi đang mất mạng (vỏ ứng dụng từ service worker: bài này cần bản build, không chạy được trên bản dev);
//   - máy sập đúng lúc tờ đơn ký khi mất mạng được in (trang bị đóng ngay bên trong print(), mất cả phiên đăng nhập).
// Cuối bài đếm bản ghi bằng tài khoản máy của phòng khám thử: mỗi hành động có đúng một bản ghi trên máy chủ.
//
// Chờ theo kết quả trên máy chủ, không theo chỉ báo của giao diện, và không ngủ cố định.
// Lưu ý về Playwright: sau khi tải lại trang lúc đang `setOffline(true)`, `navigator.onLine` trở lại true dù mọi yêu cầu vẫn lỗi,
// và bật mạng lại không phát sự kiện `online` [Đã đo, playwright-core 1.63]. Các chu kỳ có tải lại trang vì thế đi qua ca "trình duyệt
// tưởng có mạng nhưng gọi gì cũng lỗi" (Wi-Fi còn, Internet mất); các chu kỳ khác đi qua ca trình duyệt biết mình mất mạng.
//
//   pnpm e2e:cycles                         (ở gốc kho: tự tạo phòng khám thử, BFF 8111, bản build 4174; xem infra/e2e-cycles.mjs)
//   E2E_SEED=<số> pnpm e2e:cycles           chạy lại đúng kế hoạch của một lần chạy cũ
//   E2E_CYCLES=100 pnpm e2e:cycles          số chu kỳ khác (T6)
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumPath } from './browser.mjs';
import { ACTIONS, EXTRA_DX, WRITES, describe, makePlan, parseSeed } from './cycles-plan.mjs';
import { device, eventually, login, rawLocalDump } from './offline-helpers.mjs';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:4174';
const MEDPLUM = (process.env.MEDPLUM_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const TENANTS_FILE = process.env.CYCLES_TENANTS_FILE ?? fileURLToPath(new URL('../../../services/bff/.data/e2e-cycles/tenants.json', import.meta.url));
const CYCLES = Number(process.env.E2E_CYCLES ?? 20);
const SEED = parseSeed(process.env.E2E_SEED);
/**
 * Bộ máy đồng bộ chờ gửi lại tối đa 60 giây và chạy định kỳ mỗi 30 giây: chờ máy chủ nhận tối đa chừng này.
 * E2E_SYNC_WAIT_MS rút ngắn hạn chờ khi cố ý làm hỏng mã để thử chính bài này (đột biến), cho lần chạy đỏ khỏi kéo dài.
 */
const SYNC_WAIT_MS = Number(process.env.E2E_SYNC_WAIT_MS ?? 100_000);
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });

// Hệ định danh của ứng dụng (packages/fhir-vn-model/src/identifiers.ts).
const SYS = { prescription: 'urn:phongmach:ma-don-noi-bo', visitCode: 'urn:phongmach:luot-kham', queueNumber: 'urn:phongmach:ext:so-thu-tu' };
// Chữ không được nằm ở dạng rõ trong IndexedDB, ngoài dữ liệu của từng bệnh nhân: tên thuốc và mã ICD-10 của các đơn mẫu trong bài.
const CLINICAL_WORDS = ['Amoxicillin', 'Paracetamol', 'Cetirizin', 'Acetylcystein', 'Omeprazol', 'Domperidon', 'Racecadotril', 'J02.9', 'J06.9', 'J20.9', 'K29.7'];

if (!Number.isInteger(CYCLES) || CYCLES < 1) throw new Error(`E2E_CYCLES phải là số nguyên dương, đang là "${process.env.E2E_CYCLES}"`);
const plan = makePlan(SEED, CYCLES);
const pad = (n) => String(n).padStart(String(CYCLES).length, '0');
console.log(`Hạt giống: ${SEED} · ${CYCLES} chu kỳ · chạy lại đúng như cũ: E2E_SEED=${SEED}${CYCLES === 20 ? '' : ` E2E_CYCLES=${CYCLES}`} pnpm e2e:cycles`);

// ---------------------------------------------------------------------------------------------- máy chủ (tài khoản máy)

const tenantsFile = JSON.parse(readFileSync(TENANTS_FILE, 'utf8'));
const tenant = tenantsFile.tenants[0];
const USER = tenantsFile.users.find((u) => u.tenant === tenant.slug && u.role === 'doctor' && u.practitionerId)?.id;
if (tenantsFile.tenants.length !== 1 || !tenant.slug.startsWith('thu-') || !USER) {
  throw new Error(`${TENANTS_FILE} không phải tệp của một phòng khám thử (tạo bằng "pnpm --filter @phongmach/bff e2e:clinic"). Bài này không chạy trên phòng khám demo.`);
}

/** Đọc thẳng Medplum bằng tài khoản máy của phòng khám thử (không qua BFF), theo mẫu hàm `count` của kiểm thử tích hợp. */
async function machineAccount() {
  const res = await fetch(`${MEDPLUM}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: tenant.clientId, client_secret: tenant.secret }),
  });
  const token = (await res.json()).access_token;
  if (!token) throw new Error(`Không đăng nhập được tài khoản máy của phòng khám thử (HTTP ${res.status})`);
  const get = async (path) => {
    const r = await fetch(`${MEDPLUM}/fhir/R4/${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Medplum trả HTTP ${r.status} cho ${path.split('?')[0]}`);
    return r.json();
  };
  return {
    count: async (type, query = '') => (await get(`${type}?_summary=count&_total=accurate${query ? `&${query}` : ''}`)).total ?? -1,
    all: async (type, query = '') => {
      const out = [];
      for (let got = 1000; got === 1000; ) {
        const bundle = await get(`${type}?_count=1000&_offset=${out.length}${query ? `&${query}` : ''}`);
        got = bundle.entry?.length ?? 0;
        out.push(...(bundle.entry ?? []).map((e) => e.resource));
      }
      return out;
    },
  };
}
const server = await machineAccount();

// ---------------------------------------------------------------------------------------------- máy (trình duyệt)

const browser = await chromium.launch({ executablePath: chromiumPath() });
const problems = [];
/** Mọi lần print() của máy, lấy từ chính trang in: mã đơn trên giấy, có nhãn "ký khi mất mạng" hay không, số yêu cầu IndexedDB đang dở. */
const prints = [];
let current;
let onPrinted;
const d = await device(browser, 'máy', problems, {
  onPrint: ({ inFlight, html }) => {
    const print = { cycle: current.index, code: /PM-\d{6}-[0-9A-Z]{6}/.exec(html)?.[0], offline: html.includes('KÝ KHI MẤT MẠNG'), named: html.includes(current.patient.fullName), inFlight };
    prints.push(print);
    // Máy sập đúng lúc in: chỉ với tờ in từ dữ liệu trên máy (máy chủ chưa có gì), mỗi chu kỳ nhiều nhất một lần.
    const crash = current.crash && print.offline && !current.run.crashed;
    if (crash) current.run.crashed = true;
    onPrinted?.(print);
    return crash ? 'crash' : undefined;
  },
});
// Lỗi console được chờ đợi suốt bài: trình duyệt báo yêu cầu không tới được máy chủ (ngắt mạng, cắt phản hồi). Dòng báo đến sau
// khi máy chủ đã ghi xong, nên không bật tắt theo từng chu kỳ. Phản hồi lỗi của máy chủ (4xx, 5xx) thì KHÔNG được chờ đợi ở bất cứ lúc nào.
d.expected = /net::ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Failed to fetch/;
const page = () => d.page;
let offlineNow = false;

let step = 0;
let failed = 0;
/**
 * Một bước kiểm cuối bài: `wrong` rỗng là đạt. Bước hỏng không dừng bài, để phần đếm luôn chạy hết và báo đủ mọi chỗ lệch
 * (kể cả khi một chu kỳ hỏng giữa chừng).
 */
function check(label, wrong) {
  step += 1;
  if (wrong.length) failed += 1;
  console.log(`${wrong.length ? '✗' : '✓'} ${String(step).padStart(2)}. ${label}`);
  for (const line of wrong.slice(0, 15)) console.log(`      ${line}`);
  if (wrong.length > 15) console.log(`      … và ${wrong.length - 15} dòng nữa`);
}
/** Việc sai gặp trong lúc chạy các chu kỳ (chu kỳ hỏng, máy chủ không nhận) và dữ liệu dạng rõ thấy trong IndexedDB. */
const cycleFailures = [];
const leaks = [];
/** Mỗi lần bài mở hàng chờ để vào màn hình khám: số dòng của bệnh nhân chu kỳ đó (phải luôn là 1). */
const queueLooks = [];
const secretsOf = (c) => [c.patient.fullName, c.patient.phone, c.patient.cccd, c.symptoms];

// ---------------------------------------------------------------------------------------------- lỗi mạng

async function cut() {
  await d.context.setOffline(true);
  offlineNow = true;
}

async function restore(c) {
  // Lúc hàng đợi trên máy đầy nhất: đọc thẳng IndexedDB, không được thấy dữ liệu bệnh nhân ở dạng rõ.
  await assertNoPlaintext(c, `chu kỳ ${pad(c.index)}, trước khi bật lại mạng`);
  await d.context.setOffline(false);
  offlineNow = false;
}

const LOST_PATH = { 0: /^\/api\/patients$/, 1: /^\/api\/queue$/, 2: /^\/api\/visits\/[^/]+\/open$/, 4: /^\/api\/visits\/[^/]+\/complete$/ };
/** Mất phản hồi: yêu cầu ghi đầu tiên của thao tác này tới được máy chủ và được ghi, nhưng trình duyệt chỉ thấy lỗi mạng. */
async function loseResponse(c, action) {
  const match = (url) => LOST_PATH[action].test(url.pathname);
  const handler = async (route) => {
    if (route.request().method() !== 'POST' || c.run.lost > 0) return route.fallback();
    // Đang ngắt mạng theo kế hoạch thì yêu cầu không được tới máy chủ (`route.fetch()` đi từ Node, không chịu `setOffline`).
    if (offlineNow) return route.abort('internetdisconnected');
    c.run.lost += 1;
    await route.fetch();
    await route.abort('failed');
  };
  await d.context.route(match, handler);
  c.run.unroute = () => d.context.unroute(match, handler);
}

/** Tải lại trang khi đang mất mạng: vỏ ứng dụng đến từ service worker, phiên còn trong sessionStorage của tab. */
async function reloadOffline(c) {
  await page().reload();
  await page().getByTestId('search').waitFor();
  c.run.reloaded = true;
}

/**
 * Máy sập đúng lúc in: trang đang đứng yên bên trong print() thì bị đóng. Phiên đăng nhập (sessionStorage) mất theo tab, IndexedDB còn.
 * Đăng nhập lại cần mạng (OFF-6), nên nếu đang ngắt thì bật lại ngay tại đây.
 */
async function crashAndReopen() {
  await page().close();
  await d.context.setOffline(false);
  offlineNow = false;
  await d.open();
  await login(d, BASE, USER);
}

/**
 * Sau một chu kỳ hỏng giữa chừng: đưa máy về trạng thái chạy tiếp được (không còn chặn phản hồi, có mạng, trang mới, đăng nhập lại),
 * để các chu kỳ sau vẫn chạy và phần đếm cuối bài cho biết đúng những gì thiếu hay trùng. Hàng đợi trên máy (IndexedDB) giữ nguyên.
 */
async function recover(c) {
  await c.run.unroute?.();
  onPrinted = undefined;
  await crashAndReopen();
}

async function assertNoPlaintext(upTo, when) {
  const raw = await rawLocalDump(page());
  const secrets = [...plan.slice(0, upTo.index).flatMap(secretsOf), ...CLINICAL_WORDS];
  const found = secrets.filter((s) => raw.text.includes(s));
  if (found.length) leaks.push(`${when}: ${found.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------- năm thao tác của một chu kỳ

const notice = (re) => page().getByTestId('notice').filter({ hasText: re });

async function createPatient(c) {
  const p = c.patient;
  await page().getByTestId('tab-reception').click();
  await page().getByTestId('search').fill(p.fullName);
  await page().getByTestId('search-status').filter({ hasText: /\d+ kết quả/ }).waitFor();
  await page().getByTestId('new-patient').click();
  await page().getByTestId('f-phone').fill(p.phone);
  await page().getByTestId('f-cccd').fill(p.cccd);
  await page().getByTestId('f-birth').fill(p.birthDate);
  await page().getByTestId('f-gender').selectOption(p.gender);
  await page().getByTestId('f-submit').click();
  await notice(/Đã tạo bệnh nhân mới|đã tạo bệnh nhân trên máy này/).waitFor();
}

async function checkIn(c) {
  const name = c.patient.fullName;
  const detail = page().getByTestId('patient-detail').filter({ hasText: name });
  if (!(await detail.count())) {
    // Sau khi tải lại trang: tìm lại người vừa tạo (trong bộ đệm trên máy khi mất mạng).
    await page().getByTestId('tab-reception').click();
    await page().getByTestId('search').fill(name);
    await page().getByTestId('result').filter({ hasText: name }).click();
    await detail.waitFor();
  }
  await page().getByTestId('check-in').click();
  const text = await notice(/cấp số \d+/).innerText();
  c.run.number = Number(/cấp số (\d+)/.exec(text)[1]);
  c.run.tentative = /\(tạm\)/.test(text);
}

/** Mở màn hình khám của bệnh nhân chu kỳ này từ hàng chờ: "Gọi vào khám", hoặc "Tiếp tục khám" sau khi tải lại trang. */
async function openVisit(c) {
  await page().getByTestId('tab-queue').click();
  const rows = page().getByTestId('queue-row').filter({ hasText: c.patient.fullName });
  await rows.first().waitFor();
  // Mỗi lượt khám đúng MỘT dòng. Sau một lần mất phản hồi ở "cấp số", máy chủ đã có lượt khám còn mục cấp số trên máy chưa gửi lại:
  // hàng chờ phải nhận ra hai thứ là một (khớp theo clientUuid, xem mergeQueue). Hai dòng cho cùng một bệnh nhân là LỖI: ghi lại để
  // một bước kiểm cuối bài báo đỏ, rồi vẫn bấm nút mà bác sĩ đang khám dở sẽ bấm ("Tiếp tục khám" nếu có, không thì "Gọi vào khám")
  // để chu kỳ chạy hết và phần đếm trên máy chủ vẫn có nghĩa.
  const shown = await rows.count();
  queueLooks.push({ cycle: c.index, at: ACTIONS[c.run.at], rows: shown });
  const resume = rows.getByTestId('continue');
  await ((await resume.count()) ? resume : rows.getByTestId('call')).first().click();
  await page().getByTestId('visit').waitFor();
}
const onVisit = async () => (await page().getByTestId('visit').count()) > 0;

async function fillAcks() {
  const reasons = page().getByTestId('ack-reason');
  for (let i = 0; i < (await reasons.count()); i++) {
    if (!(await reasons.nth(i).inputValue())) await reasons.nth(i).fill('Đã hỏi bệnh nhân trực tiếp, không dị ứng thuốc');
  }
}

async function examine(c) {
  if (!(await onVisit())) await openVisit(c);
  for (const [field, value] of Object.entries(c.vitals)) await page().getByTestId(`vital-${field}`).fill(value);
  await page().getByTestId('exam-symptoms').fill(c.symptoms);
  await page().getByTestId('template').selectOption(c.template);
  await page().getByTestId('line').first().waitFor();
  if (c.extraDx) {
    await page().getByTestId('dx-search').fill(EXTRA_DX.query);
    await page().getByTestId('dx-search-item').first().waitFor();
    await page().getByTestId('dx-search').press('Enter');
    await page().getByTestId('dx-tag').filter({ hasText: EXTRA_DX.code }).waitFor();
  }
  await fillAcks();
  // IndexedDB ghi bất đồng bộ: chờ bản nháp lưu xong, rồi mới được tải lại trang hoặc ký.
  await page().locator('[data-testid="draft-saved"][data-dirty="false"]').waitFor();
}

async function sign(c) {
  if (!(await onVisit())) await openVisit(c);
  // Dữ liệu đã nhập phải còn nguyên trên màn hình (kể cả sau khi tải lại trang giữa lúc khám): đây là số sẽ đối chiếu với máy chủ.
  const shown = { symptoms: await page().getByTestId('exam-symptoms').inputValue(), lines: await page().getByTestId('line').count(), dx: await page().getByTestId('dx-tag').count() };
  const want = { symptoms: c.symptoms, lines: c.expect.medicationRequests, dx: c.expect.conditions };
  if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`bản nháp trước khi ký khác dữ liệu đã nhập: ${JSON.stringify(shown)}, cần ${JSON.stringify(want)}`);
  await fillAcks();
  await page().locator('[data-testid="draft-saved"][data-dirty="false"]').waitFor();
  if (await page().getByTestId('sign').isDisabled()) throw new Error(`không ký được: ${await page().getByTestId('sign-blocked').innerText()}`);

  // Chờ tờ đơn ra (cổng chặn trong print() báo về), không chờ theo màn hình: lúc máy "sập" trang đứng yên và không trả lời.
  const printed = new Promise((resolve) => (onPrinted = resolve));
  const until = Date.now() + SYNC_WAIT_MS;
  for (;;) {
    await page().getByTestId('sign').click();
    const refused = page().getByTestId('sign-error').waitFor({ timeout: SYNC_WAIT_MS }).then(() => 'refused', () => 'nothing');
    const outcome = await Promise.race([printed.then(() => 'printed'), refused]);
    if (outcome === 'printed') break;
    if (outcome === 'nothing') throw new Error('bấm "Ký & In" mà không có tờ in nào và cũng không có thông báo lỗi');
    // Ứng dụng báo chưa ký được (một thao tác trước của lượt khám này còn chờ gửi lại): đã giữ trên máy, CHƯA in.
    // Bấm lại như bác sĩ sẽ làm, mỗi giây một lần; số lần bị từ chối được ghi lại và báo ở cuối bài.
    c.run.signRefused.push(await page().getByTestId('sign-error').innerText());
    if (Date.now() > until) throw new Error(`không ký được sau ${SYNC_WAIT_MS / 1000} giây: ${c.run.signRefused.at(-1)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const print = await printed;
  onPrinted = undefined;
  if (c.run.crashed) return crashAndReopen();
  await page().locator('[data-testid="sign-result"], [data-testid="offline-sign-result"]').waitFor();
  const onScreen = await page().getByTestId('rx-code').innerText();
  if (onScreen !== print.code) throw new Error(`mã đơn trên màn hình (${onScreen}) khác mã trên tờ in (${print.code})`);
}

const STEPS = [createPatient, checkIn, openVisit, examine, sign];

/** Máy chủ đã có lượt khám hoàn tất của bệnh nhân chu kỳ này (tìm theo số điện thoại, mỗi chu kỳ một số riêng). */
async function onServer(c) {
  const ids = (await server.all('Patient', `phone=${c.patient.phone}&_elements=id`)).map((p) => `Patient/${p.id}`);
  return ids.length > 0 && (await server.count('Encounter', `status=finished&subject=${ids.join(',')}`)) > 0;
}

async function runCycle(c) {
  current = c;
  c.run = { lost: 0, signRefused: [] };
  for (let action = 0; action <= ACTIONS.length; action++) {
    c.run.at = action;
    if (action === c.cut) await cut();
    if (action === c.restore) await restore(c);
    if (action === ACTIONS.length) break;
    if (action === c.lost) await loseResponse(c, action);
    await STEPS[action](c);
    if (action === c.reload) await reloadOffline(c);
  }
  // Chờ theo kết quả trên máy chủ. Quá hạn thì ghi lại và đi tiếp: phần đếm cuối bài sẽ cho biết thiếu gì.
  const from = Date.now();
  try {
    await eventually(() => onServer(c), 'máy chủ có lượt khám hoàn tất', SYNC_WAIT_MS);
    c.run.syncedMs = Date.now() - from;
  } catch (err) {
    cycleFailures.push(`chu kỳ ${pad(c.index)}: máy chủ chưa có lượt khám hoàn tất của bệnh nhân này (${err.message})`);
  }
  await c.run.unroute?.();
  const back = page().getByTestId('back-to-queue');
  if (await back.count()) await back.click();
}

// ---------------------------------------------------------------------------------------------- chạy

const started = Date.now();
try {
  // Phòng khám thử phải mới tinh (số đếm cuối bài là số tuyệt đối) và BFF ở E2E_URL phải đang phục vụ đúng phòng khám đó.
  const served = (await (await fetch(`${BASE}/api/session/demo-users`)).json()).tenants.map((t) => t.slug);
  if (served.length !== 1 || served[0] !== tenant.slug) throw new Error(`BFF sau ${BASE} đang phục vụ ${served.join(', ')}, không phải phòng khám thử ${tenant.slug}. Chạy bằng "pnpm e2e:cycles" ở gốc kho.`);
  const before = [await server.count('Patient'), await server.count('Encounter')];
  if (before.some((n) => n !== 0)) throw new Error(`Phòng khám thử ${tenant.slug} đã có dữ liệu (${before.join(', ')}): mỗi lần chạy cần một phòng khám mới ("pnpm e2e:cycles" tự tạo).`);

  // Lần tải đầu có mạng, chờ service worker nắm trang: từ đây tải lại khi mất mạng mới có vỏ ứng dụng.
  await login(d, BASE, USER);
  await eventually(() => page().evaluate(() => !!navigator.serviceWorker?.controller), 'service worker sẵn sàng (bài này cần bản build của giao diện, không chạy trên bản dev)', 20_000);

  for (const c of plan) {
    const from = Date.now();
    try {
      await runCycle(c);
    } catch (err) {
      await page().screenshot({ path: `${shots}FAILED-cycles.png` }).catch(() => {});
      cycleFailures.push(`chu kỳ ${pad(c.index)} hỏng ở thao tác "${ACTIONS[c.run?.at] ?? 'kết thúc chu kỳ'}": ${err.message.split('\n')[0]}`);
      console.log(`✗ chu kỳ ${pad(c.index)} (${describe(c)}):\n`, err);
      c.run.failed = true;
      await recover(c);
      continue;
    }
    const print = prints.findLast((p) => p.cycle === c.index);
    const notes = [
      `số ${String(c.run.number).padStart(3, '0')}${c.run.tentative ? ' (tạm)' : ''}`,
      `đơn ${print?.code}${print?.offline ? ' in từ máy' : ''}`,
      c.run.syncedMs !== undefined ? `máy chủ nhận sau ${(c.run.syncedMs / 1000).toFixed(1)} giây` : 'MÁY CHỦ CHƯA NHẬN',
      ...(c.run.signRefused.length ? [`"Ký & In" bị từ chối ${c.run.signRefused.length} lần trước khi in`] : []),
      ...(queueLooks.some((q) => q.cycle === c.index && q.rows !== 1) ? ['HÀNG CHỜ HIỆN HƠN MỘT DÒNG CHO LƯỢT KHÁM NÀY'] : []),
    ];
    console.log(`· chu kỳ ${pad(c.index)}: ${describe(c)} → ${notes.join(', ')} [${((Date.now() - from) / 1000).toFixed(1)} giây]`);
  }
  const ran = plan.filter((c) => c.run);
  const whole = ran.filter((c) => !c.run.failed);
  console.log(`\nĐã chạy trọn ${whole.length}/${CYCLES} chu kỳ trong ${((Date.now() - started) / 1000).toFixed(0)} giây. Kiểm cuối bài:`);

  // ============================================================ Có mạng, chờ hàng đợi trên máy gửi hết (kể cả các mục ghi nhận in)
  await d.context.setOffline(false);
  await d.context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  let local = { ops: [], rows: {} };
  const drained = await eventually(async () => (local = await rawLocalDump(page())).ops.every((o) => o.status === 'done'), 'hàng đợi trên máy gửi hết', SYNC_WAIT_MS).then(() => true, () => false);

  // ============================================================ Đếm bằng tài khoản máy của phòng khám thử
  check(`cả ${CYCLES} chu kỳ chạy hết, và sau mỗi chu kỳ máy chủ có lượt khám hoàn tất trong ${SYNC_WAIT_MS / 1000} giây kể từ khi có mạng`, [...cycleFailures, ...(ran.length < CYCLES ? [`chỉ chạy được ${ran.length}/${CYCLES} chu kỳ`] : [])]);

  const TYPES = ['Patient', 'Encounter', 'List', 'Task', 'Provenance', 'ClinicalImpression', 'MedicationRequest', 'Condition', 'Observation', 'AllergyIntolerance'];
  const all = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await server.all(t)])));
  const sum = (key) => plan.reduce((n, c) => n + c.expect[key], 0);
  const expected = { Patient: CYCLES, Encounter: CYCLES, List: CYCLES, Task: CYCLES, Provenance: CYCLES, ClinicalImpression: CYCLES, MedicationRequest: sum('medicationRequests'), Condition: sum('conditions'), Observation: sum('observations'), AllergyIntolerance: 0 };
  const off = (types) => types.filter((t) => all[t].length !== expected[t]).map((t) => `${t}: có ${all[t].length}, cần ${expected[t]} (${all[t].length > expected[t] ? 'TRÙNG' : 'MẤT'} ${Math.abs(all[t].length - expected[t])})`);
  console.log(`      máy chủ có/cần: ${TYPES.map((t) => `${t} ${all[t].length}/${expected[t]}`).join(' · ')}`);
  check(`Patient = Encounter = List = Task = Provenance = ClinicalImpression = ${CYCLES}: mỗi bệnh nhân, lượt khám, đơn, chữ ký, việc gửi cổng và nhận định có đúng một bản ghi`, off(['Patient', 'Encounter', 'List', 'Task', 'Provenance', 'ClinicalImpression']));

  const ref = (r, field) => r[field]?.reference;
  const byPhone = new Map();
  for (const p of all.Patient) {
    const phone = p.telecom?.find((t) => t.system === 'phone')?.value;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), p]);
  }
  const visitsOf = (patient) => all.Encounter.filter((e) => ref(e, 'subject') === `Patient/${patient.id}`);
  check('mọi lượt khám ở trạng thái "finished"; bệnh nhân của mỗi chu kỳ có mặt đúng một lần và có đúng một lượt khám', [
    ...all.Encounter.filter((e) => e.status !== 'finished').map((e) => `lượt khám ${e.id} đang ở trạng thái "${e.status}"`),
    ...plan.flatMap((c) => {
      const found = byPhone.get(c.patient.phone) ?? [];
      if (found.length !== 1) return [`chu kỳ ${pad(c.index)}: máy chủ có ${found.length} bệnh nhân mang số điện thoại của chu kỳ này`];
      const visits = visitsOf(found[0]);
      return visits.length === 1 ? [] : [`chu kỳ ${pad(c.index)}: bệnh nhân có ${visits.length} lượt khám`];
    }),
  ]);

  const inVisit = (type, visit) => all[type].filter((r) => ref(r, 'encounter') === `Encounter/${visit.id}`).length;
  check(`MedicationRequest ${expected.MedicationRequest}, Condition ${expected.Condition}, Observation ${expected.Observation}, AllergyIntolerance 0: đúng bằng số đã nhập, ở tổng số và ở từng lượt khám`, [
    ...off(['MedicationRequest', 'Condition', 'Observation', 'AllergyIntolerance']),
    ...plan.flatMap((c) => {
      const visit = (byPhone.get(c.patient.phone) ?? []).flatMap(visitsOf)[0];
      if (!visit) return [];
      const got = { observations: inVisit('Observation', visit), conditions: inVisit('Condition', visit), medicationRequests: inVisit('MedicationRequest', visit) };
      return JSON.stringify(got) === JSON.stringify(c.expect) ? [] : [`chu kỳ ${pad(c.index)}: máy chủ có ${JSON.stringify(got)}, đã nhập ${JSON.stringify(c.expect)}`];
    }),
  ]);

  // Mã lượt khám là <ngày>-<số thứ tự>: mã khác nhau thì số thứ tự trong ngày khác nhau. Phòng khám mới và một máy, nên các số còn phải liền nhau từ 1.
  const visitCodes = all.Encounter.map((e) => e.identifier?.find((i) => i.system === SYS.visitCode)?.value ?? '(không có mã)');
  const numbers = all.Encounter.map((e) => e.extension?.find((x) => x.url === SYS.queueNumber)?.valueInteger).sort((a, b) => a - b);
  const oneDay = new Set(visitCodes.map((v) => v.slice(0, 8))).size === 1;
  check(`${CYCLES} số thứ tự khác nhau${oneDay ? `, liền nhau từ 1 đến ${CYCLES}` : ' (lần chạy vắt qua nửa đêm: so theo từng ngày)'}`, [
    ...(new Set(visitCodes).size === CYCLES && visitCodes.length === CYCLES ? [] : [`mã lượt khám trên máy chủ: ${[...visitCodes].sort().join(', ')}`]),
    ...(oneDay && (numbers.length !== CYCLES || numbers.some((n, i) => n !== i + 1)) ? [`số thứ tự trên máy chủ: ${numbers.join(', ')}`] : []),
  ]);

  const codeOf = (r) => r.identifier?.find((i) => i.system === SYS.prescription)?.value;
  check(`mỗi mã đơn đã in (${prints.length} tờ, trong đó ${prints.filter((p) => p.offline).length} tờ in từ dữ liệu trên máy) có đúng một đơn và một việc gửi cổng trên máy chủ, đúng bệnh nhân; máy chủ không có đơn nào ngoài các tờ đã in`, [
    ...(prints.length === CYCLES ? [] : [`có ${prints.length} lần in, cần ${CYCLES}`]),
    ...(new Set(prints.map((p) => p.code)).size === prints.length ? [] : [`mã đơn trên các tờ in bị lặp: ${prints.map((p) => p.code).join(', ')}`]),
    ...prints.flatMap((p) => {
      const lists = all.List.filter((l) => codeOf(l) === p.code);
      const tasks = all.Task.filter((t) => codeOf(t) === p.code);
      const patient = byPhone.get(plan[p.cycle - 1].patient.phone)?.[0];
      const who = `chu kỳ ${pad(p.cycle)}, tờ in ${p.code}`;
      return [
        ...(p.code && p.named ? [] : [`${who}: tờ in thiếu mã đơn hoặc tên bệnh nhân của chu kỳ`]),
        ...(lists.length === 1 ? [] : [`${who}: máy chủ có ${lists.length} đơn mang mã đã in`]),
        ...(tasks.length === 1 ? [] : [`${who}: máy chủ có ${tasks.length} việc gửi cổng mang mã đã in`]),
        ...(lists.length === 1 && ref(lists[0], 'subject') !== `Patient/${patient?.id}` ? [`${who}: đơn trên máy chủ thuộc bệnh nhân khác`] : []),
      ];
    }),
    ...all.List.filter((l) => !prints.some((p) => p.code === codeOf(l))).map((l) => `máy chủ có đơn ${codeOf(l)} không ứng với tờ in nào`),
  ]);

  // ============================================================ Trên máy
  const status = await page().getByTestId('sync-status').evaluate((e) => ({ pending: e.dataset.pending, attention: e.dataset.attention }));
  const notices = await page().locator('[data-testid="sync-notice"]').allInnerTexts();
  const open = local.ops.filter((o) => o.status !== 'done');
  check(`trên máy không còn mục chờ, mục xung đột hay mục cần xử lý: cả ${local.ops.length} mục của hàng đợi đã xong, chỉ báo ghi 0, không có thông báo nào`, [
    ...(drained ? [] : [`sau ${SYNC_WAIT_MS / 1000} giây có mạng vẫn còn ${open.length} mục chưa xong: ${open.map((o) => `${o.kind}:${o.status}`).join(' ')}`]),
    ...(local.ops.length >= CYCLES * WRITES.length ? [] : [`hàng đợi chỉ có ${local.ops.length} mục, ít hơn ${CYCLES * WRITES.length} thao tác ghi đã làm`]),
    ...(status.pending === '0' && status.attention === '0' ? [] : [`chỉ báo: ${JSON.stringify(status)}`]),
    ...notices.map((n) => `thông báo: ${n.replaceAll('\n', ' ')}`),
  ]);

  if (ran.length) await assertNoPlaintext(ran.at(-1), 'cuối bài');
  check(`đọc thẳng IndexedDB (${Object.entries(local.rows).map(([k, v]) => `${k} ${v}`).join(', ')}) trước mỗi lần bật lại mạng và ở cuối bài: không có tên, số điện thoại, CCCD, triệu chứng, tên thuốc hay mã ICD ở dạng rõ`, leaks);

  check(`hàng rào in (F12): cả ${prints.length} lần gọi print() đều không còn yêu cầu IndexedDB nào đang dở`, prints.filter((p) => p.inFlight !== 0).map((p) => `chu kỳ ${pad(p.cycle)}: ${p.inFlight} yêu cầu đang dở lúc in`));

  // ============================================================ Bài có thật sự gây đủ các lỗi đã định không
  const planned = { lost: whole.filter((c) => c.lost !== undefined), reload: whole.filter((c) => c.reload !== undefined), crash: whole.filter((c) => c.crash) };
  check(
    `${whole.length} lần ngắt và khôi phục mạng; mất phản hồi ${planned.lost.length} lần (${WRITES.map((a) => `${ACTIONS[a]} ${planned.lost.filter((c) => c.lost === a).length}`).join(', ')}); tải lại trang khi mất mạng ${planned.reload.length} lần; máy sập lúc in ${planned.crash.length} lần: mọi lỗi đã định đều thật sự xảy ra`,
    [
      ...planned.lost.filter((c) => c.run.lost !== 1).map((c) => `chu kỳ ${pad(c.index)}: phản hồi của "${ACTIONS[c.lost]}" bị cắt ${c.run.lost} lần, cần 1`),
      ...planned.reload.filter((c) => !c.run.reloaded).map((c) => `chu kỳ ${pad(c.index)}: chưa tải lại trang`),
      ...planned.crash.filter((c) => !c.run.crashed).map((c) => `chu kỳ ${pad(c.index)}: máy chưa sập lúc in`),
    ]
  );

  const lostCheckIns = queueLooks.filter((q) => plan[q.cycle - 1].lost === 1).length;
  check(
    `hàng chờ trên máy hiện đúng một dòng cho mỗi lượt khám ở cả ${queueLooks.length} lần mở hàng chờ để vào khám (${lostCheckIns} lần ở chu kỳ mất phản hồi khi cấp số)`,
    queueLooks.filter((q) => q.rows !== 1).map((q) => `chu kỳ ${pad(q.cycle)}, trước "${q.at}": ${q.rows} dòng cho cùng một bệnh nhân (dòng của máy chủ và dòng tạm trên máy)`)
  );

  check('không có lỗi nào trong console của trình duyệt, kể cả phản hồi lỗi của máy chủ (chỉ trừ lỗi không tới được máy chủ do cố ý ngắt mạng và cắt phản hồi)', problems);

  const waits = ran.map((c) => c.run.syncedMs).filter((ms) => ms !== undefined).sort((a, b) => a - b);
  const sec = (ms) => (ms / 1000).toFixed(1);
  const slow = ran.filter((c) => c.run.syncedMs > 10_000);
  const refused = ran.filter((c) => c.run.signRefused.length);
  console.log(`\nThời gian chạy: ${((Date.now() - started) / 1000).toFixed(0)} giây.${waits.length ? ` Máy chủ nhận lượt khám sau khi có mạng: trung vị ${sec(waits[Math.floor((waits.length - 1) / 2)])} giây, lâu nhất ${sec(waits.at(-1))} giây.` : ''}`);
  if (slow.length) console.log(`Chờ máy chủ nhận trên 10 giây ở ${slow.length} chu kỳ: ${slow.map((c) => `${pad(c.index)} (${sec(c.run.syncedMs)} giây)`).join(', ')}.`);
  if (refused.length) console.log(`"Ký & In" báo chưa ký được, phải bấm lại, ở ${refused.length} chu kỳ: ${refused.map((c) => `${pad(c.index)} (${c.run.signRefused.length} lần)`).join(', ')}. Câu báo: "${refused[0].run.signRefused[0]}"`);
  if (failed) {
    console.error(`\n✗ M0-2 KHÔNG đạt với hạt giống ${SEED}: ${failed}/${step} bước kiểm sai.`);
    await page().screenshot({ path: `${shots}FAILED-cycles-end.png` }).catch(() => {});
    process.exitCode = 1;
  } else {
    console.log(`\nĐạt ${step}/${step}. M0-2 với hạt giống ${SEED}: ${CYCLES} chu kỳ ngắt và khôi phục mạng, 0 bản ghi mất, 0 bản ghi trùng.`);
  }
} catch (err) {
  await page().screenshot({ path: `${shots}FAILED-cycles.png` }).catch(() => {});
  console.error(`\n✗ Bài hỏng (hạt giống ${SEED}):\n`, err);
  if (problems.length) console.error('Console:', problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
