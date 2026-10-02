// Hàm trợ giúp dùng chung cho các bài e2e ngoại tuyến (offline-sign, offline-conflict, offline-cycles):
// "máy" có bộ đếm yêu cầu IndexedDB lúc gọi print(), ngắt mạng, thăm dò có hạn, đọc thẳng IndexedDB, kiểm trang in A5.
import assert from 'node:assert/strict';

/** Lỗi console được chờ đợi khi cố ý ngắt mạng hoặc cắt phản hồi. */
export const OFFLINE_ERRORS = /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch|Failed to load resource/;

/**
 * Chạy trong trình duyệt trước mã ứng dụng. Đo bất biến của hàng rào in (F12): không bao giờ gọi print() khi còn yêu cầu IndexedDB
 * đang dở (Chromium bỏ mất sự kiện của yêu cầu đó, làm treo hàng đợi đồng bộ; xem `whileLocalStoreQuiet`). Trang chính đếm yêu cầu
 * IndexedDB đang dở vào `window.__idb.inFlight`; lúc iframe in gọi print() thì ghi con số đó vào `window.__idb.atPrint`.
 *
 * `gate` (tùy chọn): mỗi lần print() còn gửi một yêu cầu ĐỒNG BỘ tới đường dẫn này, kèm con số trên và nguyên văn trang in.
 * Trang đứng yên bên trong print() cho tới khi bài kiểm thử trả lời (xem `device`), nên bài kiểm thử biết chắc tờ đơn nào đã in
 * và có thể cho máy "sập" đúng lúc đó.
 */
function printProbe(gate) {
  if (window === window.top) {
    const state = { inFlight: 0, atPrint: [] };
    window.__idb = state;
    const wrap = (proto, names) => {
      for (const name of names) {
        const orig = proto[name];
        if (typeof orig !== 'function') continue;
        proto[name] = function (...args) {
          const req = orig.apply(this, args);
          state.inFlight++;
          let done = false;
          const finish = () => {
            if (!done) (done = true), state.inFlight--;
          };
          req.addEventListener('success', finish);
          req.addEventListener('error', finish);
          return req;
        };
      }
    };
    const ops = ['get', 'getAll', 'getAllKeys', 'getKey', 'count', 'openCursor', 'openKeyCursor'];
    wrap(IDBObjectStore.prototype, [...ops, 'put', 'add', 'delete', 'clear']);
    wrap(IDBIndex.prototype, ops);
    if (gate) {
      state.report = (html) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', gate, false);
        xhr.send(JSON.stringify({ inFlight: state.inFlight, html }));
      };
    }
  } else {
    const print = window.print;
    window.print = function () {
      try {
        const state = window.top.__idb;
        state.atPrint.push(state.inFlight);
        state.report?.(document.documentElement.outerHTML);
      } catch {
        // khung khác nguồn, hoặc bài kiểm thử không trả lời: không đo
      }
      return print.call(this);
    };
  }
}

/**
 * Một máy: context riêng (IndexedDB, sessionStorage riêng), có bộ đếm của `printProbe`.
 * - `d.expected`: mẫu lỗi console được chờ đợi ở bước đang chạy (cố ý ngắt mạng; máy chủ từ chối 409, 422; phiên hết hạn 401).
 *   Lỗi console khác và lỗi trang được ghi vào `problems`.
 * - `d.completes`: nội dung các yêu cầu hoàn tất lượt khám mà máy đã gửi.
 * - `onPrint({ inFlight, html })` (tùy chọn): được gọi ở mỗi lần print(), trong lúc trang còn đứng yên bên trong print().
 *   Trả về 'crash' thì trang không bao giờ được trả lời: người gọi đóng trang, như máy sập đúng lúc tờ đơn ra.
 */
export async function device(browser, name, problems, { onPrint } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'vi-VN' });
  const gate = onPrint ? '/__e2e/print' : undefined;
  await context.addInitScript(printProbe, gate);
  if (onPrint) {
    await context.route(`**${gate}`, async (route) => {
      const verdict = await onPrint(route.request().postDataJSON());
      if (verdict !== 'crash') await route.fulfill({ status: 204, body: '' });
    });
  }
  const d = { name, context, page: undefined, expected: undefined, completes: [] };
  d.open = async () => {
    const page = await context.newPage();
    page.on('console', (m) => m.type() === 'error' && !d.expected?.test(m.text()) && problems.push(`${name} console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/visits\/[^/]+\/complete$/.test(new URL(r.url()).pathname)) d.completes.push(r.postDataJSON());
    });
    d.page = page;
    return page;
  };
  await d.open();
  return d;
}

/** Phiên gọi thẳng BFF (không qua giao diện), để dựng dữ liệu và kiểm kết quả trên máy chủ. */
export async function session(base, tenant, userId) {
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, userId }) });
  const { token } = await r.json();
  return (method, path, body) =>
    fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((x) => x.json().catch(() => ({})));
}

/**
 * Dọn hàng chờ của phòng khám demo Nội (kể cả sau lần chạy hỏng): hủy người đang chờ, kết thúc lượt đang khám bằng phiên của chính
 * người giữ nó.
 */
export async function resetDemoQueue(base) {
  const assistant = await session(base, 'noi-tong-quat', 'noi-assistant');
  const { items } = await assistant('GET', '/api/queue');
  const holders = new Map();
  for (const i of items ?? []) {
    if (i.status === 'waiting') await assistant('POST', `/api/queue/${i.id}/cancel`);
    if (i.status === 'in-exam' && ['noi-doctor', 'noi-owner'].includes(i.doctorUserId)) {
      if (!holders.has(i.doctorUserId)) holders.set(i.doctorUserId, await session(base, 'noi-tong-quat', i.doctorUserId));
      await holders.get(i.doctorUserId)('POST', `/api/visits/${i.id}/complete`, { clientUuid: crypto.randomUUID(), exam: { vitals: {} }, diagnoses: ['J06.9'] });
    }
  }
}

export async function login(d, base, userId) {
  await d.page.goto(base);
  await d.page.getByTestId(`login-${userId}`).click();
  await d.page.getByTestId('search').waitFor();
}

/** Ngắt hoặc bật lại mạng của một máy, chờ chỉ báo của ứng dụng đổi theo. Ngắt thì lỗi tải tài nguyên là điều được chờ đợi. */
export async function setOffline(d, on) {
  if (on) d.expected = OFFLINE_ERRORS;
  await d.context.setOffline(on);
  await d.page.locator(`[data-testid="sync-status"][data-online="${!on}"]`).waitFor({ state: 'attached' });
}

/** Thăm dò điều kiện tới khi đúng (tối đa `ms`), không ngủ cố định. */
export async function eventually(check, what, ms = 30_000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`hết thời gian chờ: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Máy đã nạp trước hồ sơ của ít nhất `n` người trong hàng chờ (bộ đệm mã hóa) và có ảnh chụp hàng chờ.
 * Thăm dò bằng `evaluate` (có chờ kết quả của hàm async). KHÔNG dùng `page.waitForFunction` với hàm async: nó coi lời hứa trả về
 * là "đúng" và xong ngay, tức là không chờ gì cả [Đã đo, playwright-core 1.63].
 */
export const prefetched = (page, n = 1) =>
  eventually(
    () =>
      page.evaluate(async (min) => {
        const dbs = (await indexedDB.databases()).filter((x) => x.name?.startsWith('phongmach:'));
        if (!dbs.length) return false;
        const db = await new Promise((r) => (indexedDB.open(dbs[0].name).onsuccess = (e) => r(e.target.result)));
        const count = (s) => new Promise((r) => (db.transaction(s).objectStore(s).count().onsuccess = (e) => r(e.target.result)));
        const done = (await count('patients')) >= min && (await count('snapshots')) > 0;
        db.close();
        return done;
      }, n),
    `máy nạp trước hồ sơ của ${n} người trong hàng chờ`
  );

/**
 * Đọc thẳng mọi kho IndexedDB của ứng dụng (không qua mã ứng dụng): tên kho, số dòng từng bảng, mọi byte dưới dạng chữ (`text`)
 * và phần dạng rõ của hàng đợi (`ops`: id, loại thao tác, trạng thái).
 */
export const rawLocalDump = (page) =>
  page.evaluate(async () => {
    const out = { names: [], rows: {}, text: '', ops: [] };
    const decoder = new TextDecoder();
    const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));
    for (const { name } of (await indexedDB.databases()).filter((d) => d.name?.startsWith('phongmach:'))) {
      out.names.push(name);
      const db = await req(indexedDB.open(name));
      for (const store of db.objectStoreNames) {
        const rows = await req(db.transaction(store).objectStore(store).getAll());
        out.rows[store] = (out.rows[store] ?? 0) + rows.length;
        if (store === 'ops') out.ops.push(...rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status })));
        for (const row of rows) for (const v of Object.values(row)) out.text += `${v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? decoder.decode(v) : JSON.stringify(v)}\n`;
      }
      db.close();
    }
    return out;
  });

/** Xuất PDF như khi in: phải đúng một trang khổ A5 (148×210 mm ≈ 419,5×595,3 pt). */
export async function assertOneA5Page(context, html, shotPath) {
  const printPage = await context.newPage();
  try {
    await printPage.setContent(html);
    const pdf = (await printPage.pdf({ preferCSSPageSize: true })).toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    assert.equal(pages, 1, `đơn phải vừa một trang A5, thực tế ${pages}`);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    assert.ok(box && Math.abs(Number(box[1]) - 419.5) < 1.5 && Math.abs(Number(box[2]) - 595.3) < 1.5, `khổ A5, thực tế ${box?.slice(1, 3)}`);
    if (shotPath) await printPage.screenshot({ path: shotPath });
  } finally {
    await printPage.close();
  }
}

export const printFrames = (page) => page.locator('iframe[data-testid="print-frame"]').count();
export const lastPrintHtml = (page) => page.locator('iframe[data-testid="print-frame"]').last().getAttribute('srcdoc');
