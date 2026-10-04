#!/usr/bin/env node
// Tiêu chí M0-3 (kế hoạch, mục 5.3): tìm bệnh nhân theo 4 số cuối và tên không dấu, đúng và p95 ≤ 200 ms, trên 20.000 bệnh nhân
// của MỘT phòng khám, đo QUA BFF (GET /api/patients/search), không gọi thẳng Medplum như bench.mjs.
//
//   node infra/medplum/experiments/stack-do.mjs up          stack Medplum riêng để đo (cổng 8203, không hạn mức), không đụng stack dev
//   node infra/medplum/experiments/bff-search.mjs           lần đầu: tạo phòng khám đo và nạp 20.000 bệnh nhân; các lần sau: dùng lại, chỉ đo
//   node infra/medplum/experiments/bff-search.mjs --reload  tạo phòng khám đo mới và nạp lại
//
// 1. Nạp: phòng khám đo mới (Project + tài khoản máy), bệnh nhân giả dựng bằng `buildPatient` của @phongmach/fhir-vn-model (có tên
//    không dấu như ứng dụng ghi), gửi theo `batch` có `ifNoneExist` theo clientUuid (chạy lại không trùng), kiểm TỪNG phần tử (F5)
//    rồi đếm lại trong Medplum. Từ chối nạp nếu Medplum còn bật hạn mức (có tiêu đề `RateLimit`): khi đó đang trỏ nhầm vào stack dev.
// 2. Chạy một BFF thật (services/bff/src/server.ts, cổng 8112) trỏ vào phòng khám đo; đăng nhập phiên của một phụ tá.
// 3. Sáu loại truy vấn, mỗi loại BENCH_QUERIES (200) truy vấn khác nhau: 4 số cuối; tên không dấu một từ (tên), hai từ (họ + tên),
//    đủ họ tên; số điện thoại đầy đủ; CCCD. Đo tuần tự (một người dùng, trộn thứ tự các loại) rồi ở BENCH_CONCURRENCY (16) yêu cầu
//    đồng thời. Báo p50, p95, p99. M0-3 tính theo lần chạy tuần tự.
// 4. Tách thời gian: phía khách (đầu-cuối, gọi BFF bằng http.request), BFF tự đo (`responseTime` trong log của Fastify), riêng phần
//    Medplum (gọi đúng hàm `searchPatients` của BFF trong tiến trình này, không qua BFF, không ghi nhật ký; một lần bằng fetch như BFF,
//    một lần bằng http.request), riêng việc ghi nhật ký truy cập (`NdjsonAuditSink`, ghi nối rồi fsync, như BFF làm trước khi trả
//    dữ liệu), và sàn HTTP tới BFF (`/api/health`, bằng http.request và bằng fetch).
// 5. Kiểm tính đúng với dữ liệu gốc đã sinh (xem `evaluate`), kèm một bộ "ca khó" cho 4 số cuối.
//
// Biến môi trường: MEDPLUM_URL (http://localhost:8203), BENCH_PATIENTS (20000), BENCH_QUERIES (200), BENCH_CONCURRENCY (16),
// BENCH_SEED (hạt giống dữ liệu, chỉ dùng khi nạp), BENCH_QUERY_SEED (hạt giống chọn truy vấn), SEARCH_BFF_PORT (8112).
// Tệp sinh ra (bí mật của tài khoản máy, dữ liệu gốc, log, kết quả) nằm ở infra/medplum/experiments/.bff-search/ (đã gitignore).
//
// Chỉ là một điểm dữ liệu: BFF, Medplum, Postgres, Redis và bộ tạo tải chạy chung một máy. Dữ liệu hoàn toàn giả.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import nodeHttp from 'node:http';
import { createConnection } from 'node:net';
import { cpus, release, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.MEDPLUM_URL ??= 'http://localhost:8203';
const { BASE, adminToken, createClinic, http, mintClientToken } = await import('./lib.mjs');

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BFF_DIR = join(ROOT, 'services', 'bff');
const WORK = fileURLToPath(new URL('./.bff-search/', import.meta.url));
const STATE_FILE = join(WORK, 'state.json');
const TRUTH_FILE = join(WORK, 'patients.json');
const TENANTS_FILE = join(WORK, 'tenants.json');
const N = Number(process.env.BENCH_PATIENTS ?? 20_000);
const PER_KIND = Number(process.env.BENCH_QUERIES ?? 200);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 16);
const BFF_PORT = Number(process.env.SEARCH_BFF_PORT ?? 8112);
const BFF = `http://127.0.0.1:${BFF_PORT}`;
/** Số kết quả giao diện nhận (giao diện không gửi `limit`, BFF mặc định 20). */
const LIMIT = 20;
/** Bằng FRAGMENT_FETCH trong services/bff/src/medplum.ts: số kết quả BFF lấy về khi tìm theo đoạn số, trước khi xếp hạng. */
const FRAGMENT_FETCH = 50;
const BATCH = 500;
/**
 * Một batch một lúc. Với 4 batch có `ifNoneExist` chạy song song, Postgres trả 40001 "could not serialize access due to read/write
 * dependencies among transactions" (HTTP 409 ở từng phần tử, `batch` vẫn HTTP 200); gửi lại ngay các phần tử đó, tới lần thứ 5 vẫn 409
 * [Đã đo, 03/10/2026]. Một batch một lúc: 0 lần 409 qua hai lần nạp 20.000.
 */
const BATCHES_IN_FLIGHT = 1;
const SLUG = 'do-tim';
const USER = 'do-tim-phu-ta';

// Mô hình dữ liệu của ứng dụng và lớp truy cập Medplum của BFF là mã TypeScript: nạp qua tsx của services/bff.
const fromBff = createRequire(join(BFF_DIR, 'package.json'));
const tsxApi = await import(pathToFileURL(fromBff.resolve('tsx/esm/api')).href);
(tsxApi.register ?? tsxApi.default.register)();
const importTs = (path) => import(pathToFileURL(path).href);
const model = await importTs(fromBff.resolve('@phongmach/fhir-vn-model'));
const { MedplumClinicStore, MedplumTenants } = await importTs(join(BFF_DIR, 'src', 'medplum.ts'));
const { MedplumClient } = await import(pathToFileURL(join(BFF_DIR, 'node_modules', '@medplum', 'core', 'dist', 'esm', 'index.mjs')).href);
const { NdjsonAuditSink } = await importTs(join(BFF_DIR, 'src', 'audit.ts'));

const say = (msg) => console.log(msg);

/** Thay cho fetch, bằng http.request giữ kết nối: không có sàn khoảng 15 ms mỗi yêu cầu của fetch (undici) trên Windows. */
const agent = new nodeHttp.Agent({ keepAlive: true });
function httpFetch(url, init = {}) {
  const u = new URL(url);
  const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...(init.headers ?? {}) };
  const body = init.body === undefined || init.body === null ? undefined : String(init.body);
  if (body !== undefined) headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = nodeHttp.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method ?? 'GET', headers, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [v].flat()) if (x !== undefined) h.append(k, String(x));
        resolve(new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: h }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

// ------------------------------------------------------------------------------------------------- dữ liệu giả

/** mulberry32: cùng hạt giống ra cùng dữ liệu. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chọn theo trọng số. `items`: [giá trị, trọng số][]. */
function weighted(items) {
  const total = items.reduce((s, [, w]) => s + w, 0);
  const cum = [];
  let acc = 0;
  for (const [v, w] of items) cum.push([v, (acc += w / total)]);
  return (rand) => {
    const x = rand();
    return (cum.find(([, c]) => x < c) ?? cum[cum.length - 1])[0];
  };
}

/** Trọng số kiểu Zipf theo thứ tự trong danh sách (tên phổ biến đứng trước). */
const zipf = (names, s) => weighted(names.map((n, i) => [n, 1 / (i + 1) ** s]));
/**
 * Độ dốc của phân bố tên (tên gọi, từ cuối). 0,5: tên phổ biến nhất khoảng 5% mỗi giới. Bản đầu dùng 0,9 và cho ra "Linh" ở 16% phụ nữ,
 * "Nguyễn Thị Linh" 156 người trên 20.000: quá tập trung so với thực tế, làm phồng số truy vấn "quá 20 người khớp".
 */
const GIVEN_SLOPE = 0.5;

// Tỉ lệ họ gần với phân bố họ người Việt (Nguyễn khoảng một phần ba): đủ để có nhiều người trùng họ tên như ngoài đời.
const FAMILY = weighted([
  ['Nguyễn', 31], ['Trần', 11], ['Lê', 9.5], ['Phạm', 7], ['Hoàng', 4], ['Huỳnh', 3], ['Phan', 4.5], ['Vũ', 2.5], ['Võ', 2.5],
  ['Đặng', 2.1], ['Bùi', 2], ['Đỗ', 1.4], ['Hồ', 1.3], ['Ngô', 1.3], ['Dương', 1], ['Lý', 0.5], ['Đinh', 0.8], ['Trương', 0.8],
  ['Trịnh', 0.6], ['Đoàn', 0.6], ['Đào', 0.5], ['Lương', 0.5], ['Lâm', 0.5], ['Hà', 0.5], ['Mai', 0.4], ['Cao', 0.4], ['Tô', 0.3],
  ['Tạ', 0.3], ['Châu', 0.3], ['Thái', 0.3], ['Lưu', 0.3], ['Quách', 0.2], ['Kiều', 0.2], ['Triệu', 0.2], ['Phùng', 0.2],
  ['Vương', 0.2], ['Chu', 0.2], ['La', 0.1], ['Tăng', 0.1], ['Từ', 0.1], ['Đàm', 0.1], ['Doãn', 0.1], ['Thân', 0.1], ['Nghiêm', 0.1],
  ['Giang', 0.1], ['Khổng', 0.05], ['Lục', 0.05], ['Mạc', 0.05], ['Ông', 0.05], ['Âu', 0.05], ['Lã', 0.05], ['Tiêu', 0.05],
]);
const MIDDLE_MALE = weighted([
  ['Văn', 30], ['Minh', 8], ['Quốc', 6], ['Hữu', 6], ['Đức', 6], ['Thanh', 5], ['Công', 5], ['Đình', 4], ['Ngọc', 3], ['Xuân', 3],
  ['Gia', 3], ['Hoàng', 3], ['Bảo', 3], ['Thành', 3], ['Quang', 3], ['Tấn', 3], ['Tuấn', 2], ['Anh', 2], ['Trung', 2], ['Hải', 2],
  ['Nhật', 2], ['Duy', 2], ['Trọng', 2], ['Thế', 2], ['Đăng', 2], ['Chí', 2], ['Tiến', 1], ['Phúc', 1], ['Mạnh', 1], ['Khánh', 1], ['Hoài', 1],
]);
const MIDDLE_FEMALE = weighted([
  ['Thị', 35], ['Ngọc', 8], ['Thu', 5], ['Thanh', 5], ['Kim', 4], ['Hồng', 4], ['Bảo', 3], ['Phương', 3], ['Mỹ', 3], ['Minh', 3],
  ['Thùy', 3], ['Khánh', 2], ['Hoài', 2], ['Như', 2], ['Bích', 2], ['Thúy', 2], ['Diệu', 1], ['Quỳnh', 1], ['Tường', 1], ['Hải', 1],
  ['Lan', 1], ['Mai', 1], ['Cẩm', 1], ['Yến', 1], ['Huyền', 1], ['Ánh', 1], ['Hà', 1], ['Gia', 1], ['Tuyết', 1], ['Xuân', 1], ['Vân', 1],
]);
const GIVEN_MALE = zipf([
  'Hùng', 'Dũng', 'Tuấn', 'Minh', 'Nam', 'Long', 'Hải', 'Sơn', 'Huy', 'Đức', 'Thành', 'Hoàng', 'Quang', 'Phúc', 'Khang', 'An', 'Bình',
  'Anh', 'Duy', 'Trung', 'Hiếu', 'Cường', 'Thắng', 'Tâm', 'Phong', 'Việt', 'Khoa', 'Tài', 'Hưng', 'Lâm', 'Thịnh', 'Toàn', 'Đạt', 'Tiến',
  'Trí', 'Quân', 'Bảo', 'Vinh', 'Khánh', 'Kiên', 'Nhân', 'Nghĩa', 'Tùng', 'Lộc', 'Phát', 'Tú', 'Thông', 'Hòa', 'Thiện', 'Tín', 'Lợi',
  'Nguyên', 'Khôi', 'Hào', 'Hiệp', 'Hậu', 'Chiến', 'Công', 'Danh', 'Định', 'Đông', 'Giang', 'Hiển', 'Kha', 'Khải', 'Linh', 'Luân',
  'Lực', 'Nhật', 'Phú', 'Phước', 'Quý', 'Quyết', 'Sang', 'Tân', 'Thạch', 'Thái', 'Thuận', 'Trọng', 'Trường', 'Tường', 'Vĩnh', 'Vũ',
  'Vương', 'Vỹ', 'Uy', 'Ân', 'Bách', 'Cảnh', 'Chính', 'Dương', 'Lượng', 'Mạnh', 'Ninh', 'Phi', 'Sỹ', 'Tạo', 'Thanh', 'Thiên', 'Thức',
  'Toản', 'Tráng', 'Tuệ', 'Hoan', 'Hợp', 'Kỳ', 'Lĩnh', 'Nhạc', 'Sinh', 'Thạnh', 'Thụy', 'Trực', 'Vĩ', 'Xuân', 'Đăng', 'Điền', 'Đoàn',
  'Triết', 'Hữu', 'Khiêm', 'Lạc', 'Nhuận', 'Quảng', 'Sáng', 'Tấn', 'Thạc', 'Tuyên', 'Văn', 'Yên', 'Bằng', 'Cương', 'Diệu', 'Đắc',
], GIVEN_SLOPE);
const GIVEN_FEMALE = zipf([
  'Linh', 'Anh', 'Trang', 'Hương', 'Hà', 'Lan', 'Mai', 'Thảo', 'Ngọc', 'Phương', 'Hằng', 'Huyền', 'Nhung', 'Thủy', 'Hạnh', 'Yến', 'Nga',
  'Hoa', 'Quỳnh', 'Nhi', 'Vy', 'Chi', 'My', 'Thu', 'Dung', 'Hiền', 'Ngân', 'Thúy', 'Vân', 'Loan', 'Uyên', 'Trinh', 'Châu', 'Diễm',
  'Hồng', 'Tâm', 'Giang', 'Liên', 'Oanh', 'Tuyết', 'Hòa', 'Thanh', 'Xuân', 'An', 'Ánh', 'Bích', 'Cúc', 'Diệp', 'Diệu', 'Duyên', 'Hân',
  'Huệ', 'Hường', 'Khánh', 'Khuê', 'Kiều', 'Liễu', 'Ly', 'Mỹ', 'Nguyệt', 'Nhàn', 'Như', 'Phượng', 'Quế', 'Quyên', 'Sương', 'Thắm',
  'Thơ', 'Thùy', 'Thư', 'Thương', 'Tiên', 'Trà', 'Trâm', 'Tú', 'Vi', 'Ái', 'Băng', 'Cầm', 'Đào', 'Gấm', 'Hải', 'Hậu', 'Hoài', 'Lài',
  'Lam', 'Lệ', 'Lụa', 'Mến', 'Mơ', 'Nhạn', 'Nương', 'Phấn', 'Sen', 'Thoa', 'Trúc', 'Tươi', 'Xoan', 'Yên', 'Ngà', 'Ngoan', 'Nhiên',
  'Nhớ', 'Thi', 'Thoại', 'Tình', 'Tố', 'Trân', 'Vàng', 'Viên', 'Vui', 'Bình', 'Đan', 'Hiên', 'Kim', 'Lê', 'Minh', 'Nhã', 'Quyền',
], GIVEN_SLOPE);
// Đầu số di động Việt Nam, trọng số gần thị phần các nhà mạng.
const PREFIX = weighted([
  ...['086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'].map((p) => [p, 50 / 12]),
  ...['088', '091', '094', '081', '082', '083', '084', '085'].map((p) => [p, 25 / 8]),
  ...['089', '090', '093', '070', '076', '077', '078', '079'].map((p) => [p, 20 / 8]),
  ...['092', '056', '058', '099', '059'].map((p) => [p, 5 / 5]),
]);
const AGE_BAND = weighted([[[0, 14], 20], [[15, 39], 35], [[40, 64], 30], [[65, 95], 15]]);

/** UUID xác định từ chuỗi (dạng v5) để nạp lại cùng hạt giống không tạo trùng. */
function stableUuid(name) {
  const h = createHash('sha1').update(`phongmach-do-tim:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * Bệnh nhân giả, gần với một phòng mạch: nhiều người trùng họ tên; 12% dùng chung số điện thoại với một người nhà đã có;
 * 3% không có số; người từ 14 tuổi có CCCD ở 75% hồ sơ (CCCD giả có tiền tố 000, mã tỉnh không tồn tại); trẻ em không có CCCD.
 */
function generate(seed, count) {
  const rand = rng(seed);
  const digits = (n) => String(Math.floor(rand() * 10 ** n)).padStart(n, '0');
  const now = Date.now();
  const phones = new Set();
  const cccds = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    const male = rand() < 0.5;
    const middle = male ? MIDDLE_MALE : MIDDLE_FEMALE;
    const words = [FAMILY(rand), middle(rand)];
    if (rand() < (male ? 0.1 : 0.15)) {
      const second = middle(rand);
      if (second !== words[1]) words.push(second);
    }
    words.push((male ? GIVEN_MALE : GIVEN_FEMALE)(rand));
    const [lo, hi] = AGE_BAND(rand);
    const birth = new Date(now - (lo + rand() * (hi - lo + 1)) * 365.25 * 86_400_000);
    const input = { clientUuid: stableUuid(`${seed}:${i}`), fullName: words.join(' '), birthDate: birth.toISOString().slice(0, 10), gender: male ? 'male' : 'female' };
    const r = rand();
    if (r < 0.12 && out.length) {
      const relative = out[Math.floor(rand() * out.length)];
      if (relative.phone) input.phone = relative.phone;
    } else if (r >= 0.15) {
      let phone;
      do phone = PREFIX(rand) + digits(7);
      while (phones.has(phone));
      phones.add(phone);
      input.phone = phone;
    }
    const age = (now - birth.getTime()) / (365.25 * 86_400_000);
    if (age >= 14 && rand() < 0.75) {
      const yy = birth.getUTCFullYear();
      let cccd;
      do cccd = `000${(yy >= 2000 ? 2 : 0) + (male ? 0 : 1)}${String(yy % 100).padStart(2, '0')}${digits(6)}`;
      while (cccds.has(cccd));
      cccds.add(cccd);
      input.cccd = cccd;
    }
    out.push(input);
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------- nạp

async function assertUnlimited() {
  const res = await fetch(`${BASE}/healthcheck`).catch(() => undefined);
  if (!res?.ok) throw new Error(`Medplum không trả lời ở ${BASE}. Bật stack đo: node infra/medplum/experiments/stack-do.mjs up`);
  if (res.headers.get('ratelimit')) {
    throw new Error(`${BASE} còn bật hạn mức FHIR (có tiêu đề RateLimit): đây có vẻ là stack dev. Nạp 20.000 bệnh nhân cần stack đo riêng: node infra/medplum/experiments/stack-do.mjs up`);
  }
}

/**
 * Ngay sau khi nạp hàng loạt, Postgres chưa có thống kê của dữ liệu mới cho tới khi autovacuum chạy ANALYZE (vài chục giây sau).
 * Đo trong khoảng đó thì truy vấn tên nhiều từ chậm gấp 10–20 lần [Đã đo: lần chạy thử 500 bệnh nhân, "nguyen …" 300–400 ms
 * trước ANALYZE, 11–18 ms sau]. Chạy ANALYZE trên Postgres của stack đo trước khi đo.
 */
function analyze() {
  const project = process.env.BENCH_COMPOSE_PROJECT ?? 'phongmach-medplum-do';
  const r = spawnSync('docker', ['compose', '-p', project, 'exec', '-T', 'postgres', 'psql', '-U', 'medplum', '-d', 'medplum', '-c', 'ANALYZE'], { encoding: 'utf8' });
  if (r.status === 0) {
    say(`ANALYZE xong trên Postgres của ${project}.`);
    return true;
  }
  say(`Lưu ý: không chạy được ANALYZE trên ${project} (${(r.stderr || r.error?.message || '').trim().split('\n')[0]}). Số đo ngay sau khi nạp có thể chậm hơn thực tế; chờ autovacuum hoặc tự chạy ANALYZE.`);
  return false;
}

async function load(seed) {
  await assertUnlimited();
  mkdirSync(WORK, { recursive: true });
  rmSync(STATE_FILE, { force: true });
  const admin = await adminToken();
  const clinic = await createClinic(admin, `Phòng khám đo M0-3 (${new Date().toISOString().slice(0, 10)})`);
  const tenant = { slug: SLUG, name: 'Phòng khám đo M0-3 (dữ liệu giả)', projectId: clinic.projectId, clientId: clinic.clientId, secret: clinic.secret };
  writeFileSync(TENANTS_FILE, JSON.stringify({ tenants: [tenant], users: [{ id: USER, name: 'Phụ tá đo M0-3', role: 'assistant', tenant: SLUG }] }, null, 2), { mode: 0o600 });
  say(`Phòng khám đo: Project ${clinic.projectId}. Sinh ${N} bệnh nhân giả (hạt giống ${seed}) bằng buildPatient của @phongmach/fhir-vn-model…`);

  const inputs = generate(seed, N);
  const ids = new Array(N);
  const statuses = {};
  const conflicts = [];
  const t0 = performance.now();
  let next = 0;
  let done = 0;
  async function worker() {
    for (let start = next; start < N; start = next) {
      next = start + BATCH;
      // Chỉ số (trong `inputs`) còn phải gửi. Gửi lại đúng các phần tử bị 409: định danh xác định + ifNoneExist nên không tạo trùng.
      let pending = Array.from({ length: Math.min(BATCH, N - start) }, (_, k) => start + k);
      for (let attempt = 1; pending.length; attempt++) {
        const entry = pending.map((i) => ({
          request: { method: 'POST', url: 'Patient', ifNoneExist: model.clientUuidQuery(inputs[i].clientUuid) },
          resource: model.buildPatient(inputs[i]),
        }));
        const res = await http('POST', '/fhir/R4', { token: clinic.token, body: { resourceType: 'Bundle', type: 'batch', entry } });
        const got = res.json?.entry ?? [];
        // F5: `batch` trả HTTP 200 kể cả khi từng phần tử bên trong lỗi (429, 409, 400…): kiểm từng phần tử.
        if (res.status !== 200 || got.length !== pending.length) throw new Error(`batch từ ${start}: HTTP ${res.status}, ${got.length}/${pending.length} phần tử`);
        const retry = [];
        got.forEach((e, k) => {
          const status = String(e.response?.status ?? '');
          const code = status.slice(0, 3);
          statuses[code] = (statuses[code] ?? 0) + 1;
          if (code === '409' && attempt < 5) {
            if (conflicts.length < 3) conflicts.push(e.response?.outcome?.issue?.[0]?.details?.text ?? e.response?.outcome?.issue?.[0]?.diagnostics ?? status);
            retry.push(pending[k]);
            return;
          }
          if (code !== '201' && code !== '200') throw new Error(`batch từ ${start}, phần tử ${k}: ${status} ${JSON.stringify(e.response?.outcome ?? '').slice(0, 300)}`);
          const id = /^Patient\/([^/]+)/.exec(e.response?.location ?? '')?.[1] ?? e.resource?.id;
          if (!id) throw new Error(`batch từ ${start}, phần tử ${k}: không có id`);
          ids[pending[k]] = id;
        });
        pending = retry;
        if (retry.length) await new Promise((r) => setTimeout(r, 200 * attempt + randomInt(300)));
      }
      done += Math.min(BATCH, N - start);
      if (done % 5000 === 0 || done === N) say(`  ${done}/${N}`);
    }
  }
  await Promise.all(Array.from({ length: BATCHES_IN_FLIGHT }, worker));
  const seconds = (performance.now() - t0) / 1000;

  const count = await http('GET', '/fhir/R4/Patient?_summary=count&_total=accurate', { token: clinic.token });
  const distinct = new Set(ids).size;
  say(`Đã nạp ${N} trong ${seconds.toFixed(1)} s (${(N / seconds).toFixed(0)}/s). Trạng thái từng phần tử, kể cả lần gửi lại: ${JSON.stringify(statuses)}. id khác nhau: ${distinct}. Đếm lại trong Medplum: ${count.json?.total}`);
  if (conflicts.length) say(`  409 (đã gửi lại), ví dụ: ${conflicts.join(' | ')}`);
  if (count.json?.total !== N || distinct !== N) throw new Error(`Đếm lại không khớp: Medplum ${count.json?.total}, id khác nhau ${distinct}, cần ${N}`);

  const truth = inputs.map((input, i) => ({ id: ids[i], fullName: input.fullName, phone: input.phone, cccd: input.cccd }));
  writeFileSync(TRUTH_FILE, JSON.stringify(truth));
  const analyzed = analyze();
  const state = { medplumUrl: BASE, seed, n: N, projectId: clinic.projectId, loadedAt: new Date().toISOString(), loadSeconds: Math.round(seconds), statuses, conflicts, counted: count.json?.total, analyzed };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

// ------------------------------------------------------------------------------------------------- truy vấn

const KINDS = [
  ['phone4', '4 số cuối'],
  ['name1', 'tên không dấu, một từ (tên)'],
  ['name2', 'tên không dấu, hai từ (họ + tên)'],
  ['name3', 'tên không dấu, đủ họ tên'],
  ['phone', 'số điện thoại đầy đủ'],
  ['cccd', 'CCCD'],
];
const LABEL = Object.fromEntries(KINDS);
const words = (p) => model.nameTokens(p.fullName);

function queryFor(kind, p) {
  const w = words(p);
  switch (kind) {
    case 'phone4': return p.phone?.slice(-4);
    case 'name1': return w[w.length - 1];
    case 'name2': return `${w[0]} ${w[w.length - 1]}`;
    case 'name3': return w.join(' ');
    case 'phone': return p.phone;
    case 'cccd': return p.cccd;
  }
}

/** `perKind` truy vấn KHÁC NHAU cho mỗi loại, mỗi truy vấn gắn với một bệnh nhân cần tìm chọn ngẫu nhiên. */
function pickQueries(truth, rand, perKind, kinds = KINDS.map(([k]) => k), filter = () => true) {
  const out = [];
  for (const kind of kinds) {
    const seen = new Set();
    for (let tries = 0; seen.size < perKind && tries < truth.length * 4; tries++) {
      const target = truth[Math.floor(rand() * truth.length)];
      const q = queryFor(kind, target);
      if (!q || seen.has(q) || !filter(kind, q, target)) continue;
      seen.add(q);
      out.push({ kind, q, target: target.id });
    }
    if (seen.size < perKind) say(`  Lưu ý: loại "${LABEL[kind]}" chỉ có ${seen.size} truy vấn khác nhau`);
  }
  return out;
}

function shuffle(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------------------------------------ tính đúng

/**
 * Kiểm một kết quả với dữ liệu gốc. Trả về các cờ:
 *  - found: người cần tìm có trong kết quả;
 *  - ambiguous: số người khớp ĐÚNG TỪNG TỪ (hoặc có số kết thúc bằng 4 số đó) lớn hơn LIMIT, nên giao diện không thể
 *    hiện hết và người cần tìm có thể vắng mặt một cách chính đáng (phụ tá phải gõ thêm);
 *  - orderOk (4 số cuối): mọi người có số KẾT THÚC bằng 4 số đứng trước mọi người chỉ chứa 4 số đó ở giữa;
 *  - complete (4 số cuối): mọi người có số kết thúc bằng 4 số đó đều có trong kết quả (khi không quá LIMIT người);
 *  - precise: mọi kết quả đều khớp truy vấn (tên: mỗi từ là đầu của một từ trong tên; số: chứa/bằng số đã gõ).
 */
function evaluate(query, resultIds, index) {
  const { kind, q, target } = query;
  const results = resultIds.map((id) => index.byId.get(id));
  const found = resultIds.includes(target);
  if (kind === 'phone4') {
    const suffix = index.truth.filter((p) => p.phone?.endsWith(q));
    const contains = index.truth.filter((p) => p.phone?.includes(q)).length;
    const firstMiddle = results.findIndex((p) => !p?.phone?.endsWith(q));
    const orderOk = firstMiddle === -1 || results.slice(firstMiddle).every((p) => !p?.phone?.endsWith(q));
    const complete = suffix.length > LIMIT || suffix.every((p) => resultIds.includes(p.id));
    const precise = results.every((p) => p?.phone?.includes(q));
    return { found, ambiguous: suffix.length > LIMIT, orderOk, complete, precise, matches: suffix.length, contains };
  }
  if (kind === 'phone' || kind === 'cccd') {
    const field = kind === 'phone' ? 'phone' : 'cccd';
    const matches = index.truth.filter((p) => p[field] === q).length;
    return { found, ambiguous: matches > LIMIT, precise: results.every((p) => p?.[field] === q) && resultIds.length === Math.min(matches, LIMIT), matches };
  }
  const tokens = q.split(' ');
  const exact = index.truth.filter((p) => tokens.every((t) => index.words.get(p.id).includes(t))).length;
  const prefix = index.truth.filter((p) => tokens.every((t) => index.words.get(p.id).some((w) => w.startsWith(t)))).length;
  const precise = results.every((p) => p && tokens.every((t) => index.words.get(p.id).some((w) => w.startsWith(t))));
  return { found, ambiguous: exact > LIMIT, precise, matches: exact, prefix };
}

// ---------------------------------------------------------------------------------------------------- đo đạc

const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : NaN);
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1] };
}
const ms = (x) => (Number.isFinite(x) ? `${x.toFixed(x < 10 ? 1 : 0)}` : '–');

/** Chạy `fn` cho từng truy vấn với `concurrency` luồng; trả về [{...query, ms, ...kết quả của fn}] theo thứ tự xong. */
async function run(queries, concurrency, fn) {
  const out = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < queries.length) {
        const query = queries[next++];
        const start = performance.now();
        const result = await fn(query);
        out.push({ ...query, ms: performance.now() - start, ...result });
      }
    })
  );
  return { rows: out, seconds: (performance.now() - t0) / 1000 };
}

const portBusy = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

async function startBff() {
  if (await portBusy(BFF_PORT)) throw new Error(`Cổng ${BFF_PORT} đang do một tiến trình khác giữ. Script không dừng tiến trình lạ: đặt SEARCH_BFF_PORT sang một cổng trống.`);
  const log = join(WORK, 'bff.log');
  const audit = join(WORK, 'audit.ndjson');
  rmSync(audit, { force: true });
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: BFF_DIR,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, DEMO_AUTH: '1', PORT: String(BFF_PORT), MEDPLUM_URL: BASE, TENANTS_FILE, AUDIT_FILE: audit, SESSION_SECRET: randomBytes(32).toString('hex') },
  });
  closeSync(fd);
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`BFF đã thoát (mã ${child.exitCode}); xem ${log}`);
    try {
      if ((await fetch(`${BFF}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return { child, log, audit };
    } catch {
      // chưa lên
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`BFF không sẵn sàng ở ${BFF} sau 60 giây; xem ${log}`);
}

/** `responseTime` mà Fastify tự ghi cho các yêu cầu tìm kiếm, theo thứ tự xong, kể từ dòng `from` của log. */
function serverTimes(log, from) {
  const lines = readFileSync(log, 'utf8').split('\n');
  const paths = new Map();
  const out = [];
  for (const line of lines.slice(from)) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.req?.path) paths.set(e.reqId, e.req.path);
    else if (e.msg === 'request completed' && paths.get(e.reqId) === '/api/patients/search') out.push(e.responseTime);
  }
  return { times: out, lines: lines.length - 1 };
}

// ------------------------------------------------------------------------------------------------------- chạy

async function main() {
  const reload = process.argv.includes('--reload');
  let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : undefined;
  if (state && (state.medplumUrl !== BASE || state.n !== N)) {
    say(`Dữ liệu đo đang có thuộc ${state.medplumUrl} với ${state.n} bệnh nhân; cần ${BASE} với ${N}: nạp lại.`);
    state = undefined;
  }
  if (reload || !state) state = await load(Number(process.env.BENCH_SEED ?? randomInt(2 ** 31)));
  else say(`Dùng lại phòng khám đo Project ${state.projectId} (${state.n} bệnh nhân, nạp lúc ${state.loadedAt}). --reload để nạp lại.`);

  const tenants = JSON.parse(readFileSync(TENANTS_FILE, 'utf8'));
  const truth = JSON.parse(readFileSync(TRUTH_FILE, 'utf8'));
  const counted = await http('GET', '/fhir/R4/Patient?_summary=count&_total=accurate', { token: await mintClientToken(tenants.tenants[0]) });
  if (counted.json?.total !== N) throw new Error(`Phòng khám đo hiện có ${counted.json?.total} bệnh nhân, cần ${N}: chạy lại với --reload`);
  const index = { truth, byId: new Map(truth.map((p) => [p.id, p])), words: new Map(truth.map((p) => [p.id, words(p)])) };

  const querySeed = Number(process.env.BENCH_QUERY_SEED ?? randomInt(2 ** 31));
  const rand = rng(querySeed);
  const queries = pickQueries(truth, rand, PER_KIND);
  // Ca khó của 4 số cuối: 4 số bắt đầu bằng một đầu số di động (ví dụ "0912"), nên rất nhiều số CHỨA chúng ở đầu.
  const hard = pickQueries(truth, rand, 50, ['phone4'], (_kind, q) => /^0[35789]/.test(q));
  const warmup = pickQueries(truth, rand, 5);

  const machine = {
    os: `${osType()} ${release()}`,
    cpu: `${cpus()[0]?.model.trim()} (${cpus().length} luồng)`,
    ramGb: Math.round(totalmem() / 2 ** 30),
    node: process.version,
  };
  say(`\nMáy: ${machine.cpu}, ${machine.ramGb} GB RAM, ${machine.os}, Node ${machine.node}. BFF, Medplum, Postgres, Redis và bộ tạo tải chạy chung máy này.`);
  say(`Hạt giống truy vấn ${querySeed}; ${queries.length} truy vấn (${PER_KIND} mỗi loại), ${hard.length} ca khó cho 4 số cuối.\n`);

  // Phần Medplum: đúng hàm searchPatients của BFF (cùng truy vấn FHIR, cùng xếp hạng), trong tiến trình này, theo hai cách:
  //  - như BFF: MedplumClient gọi bằng fetch của Node (undici). Trên Windows, fetch có sàn khoảng 15 ms mỗi yêu cầu
  //    (máy chủ Node trống: fetch 15,4 ms, http.request 0,16 ms; trong container Linux cùng máy: fetch 1,6 ms) [Đã đo, 03/10/2026];
  //  - cùng MedplumClient nhưng gọi bằng http.request: thời gian của riêng Medplum (gồm chuyển cổng của Docker Desktop).
  const storeFetch = await new MedplumTenants(BASE, tenants.tenants).store(SLUG);
  const t0 = tenants.tenants[0];
  const httpClient = new MedplumClient({ baseUrl: BASE, clientId: t0.clientId, clientSecret: t0.secret, cacheTime: 0, fetch: httpFetch });
  await httpClient.startClientLogin(t0.clientId, t0.secret);
  const storeHttp = new MedplumClinicStore(httpClient);
  const search = (store) => (x) => store.searchPatients(model.classifyQuery(x.q), LIMIT).then((r) => ({ ids: r.map((p) => p.id) }));
  const directFetch = search(storeFetch);
  const directHttp = search(storeHttp);

  const bff = await startBff();
  try {
    const login = await fetch(`${BFF}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: SLUG, userId: USER }) });
    const { token } = await login.json();
    if (!token) throw new Error(`Không đăng nhập được BFF: HTTP ${login.status}`);
    // Phía khách gọi BFF bằng http.request giữ kết nối, KHÔNG bằng fetch: sàn 15 ms của fetch trên Windows là của Node phía khách,
    // trình duyệt không có. (BFF gọi Medplum thì vẫn bằng fetch, như mã sản phẩm.)
    const viaBff = async (x) => {
      const res = await httpFetch(`${BFF}/api/patients/search?q=${encodeURIComponent(x.q)}`, { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json();
      return { status: res.status, intent: body.intent, ids: (body.results ?? []).map((p) => p.id) };
    };

    // Làm nóng: lần gọi đầu đăng nhập tài khoản máy, mở kết nối, JIT. Không tính.
    await run(warmup, 1, viaBff);
    await run(warmup, 1, directFetch);
    await run(warmup, 1, directHttp);
    // Sàn của một lượt HTTP tới BFF: /api/health không xác thực, không gọi Medplum, không ghi nhật ký; bằng http.request và bằng fetch.
    const health = async (get) => stats((await run(Array.from({ length: 200 }, () => ({})), 1, async () => (await (await get(`${BFF}/api/health`)).json(), {}))).rows.map((r) => r.ms));
    const floor = { http: await health(httpFetch), fetch: await health(fetch) };
    let logLine = serverTimes(bff.log, 0).lines;

    say('Tuần tự (một người dùng), qua BFF…');
    const seq = await run(shuffle(queries, rand), 1, viaBff);
    await new Promise((r) => setTimeout(r, 300));
    const seqServer = serverTimes(bff.log, logLine);
    logLine = seqServer.lines;
    say('Tuần tự, riêng phần Medplum (searchPatients của BFF, không HTTP tới BFF, không nhật ký), bằng fetch rồi bằng http.request…');
    const seqDirect = await run(shuffle(queries, rand), 1, directFetch);
    const seqHttp = await run(shuffle(queries, rand), 1, directHttp);
    say(`${CONCURRENCY} yêu cầu đồng thời, qua BFF…`);
    const conc = await run(shuffle(queries, rand), CONCURRENCY, viaBff);
    await new Promise((r) => setTimeout(r, 300));
    const concServer = serverTimes(bff.log, logLine);
    logLine = concServer.lines;
    say(`${CONCURRENCY} đồng thời, riêng phần Medplum…`);
    const concDirect = await run(shuffle(queries, rand), CONCURRENCY, directFetch);
    const concHttp = await run(shuffle(queries, rand), CONCURRENCY, directHttp);
    say('Ca khó của 4 số cuối, qua BFF…');
    const hardRun = await run(hard, 1, viaBff);

    // Nhật ký truy cập: đúng lớp BFF dùng (ghi nối một dòng rồi fsync), trên cùng ổ đĩa, tách khỏi mọi thứ khác.
    const sink = new NdjsonAuditSink(join(WORK, 'audit-bench.ndjson'));
    const entry = (i) => ({ ts: new Date().toISOString(), requestId: randomBytes(16).toString('hex'), tenant: SLUG, userId: USER, userName: 'Phụ tá đo M0-3', role: 'assistant', action: 'search', outcome: 'ok', queryKind: 'name', resultCount: 20, resourceIds: truth.slice(i, i + 20).map((p) => p.id) });
    const auditSeq = await run(Array.from({ length: 500 }, (_, i) => ({ i })), 1, (x) => sink.record(entry(x.i)));
    const auditConc = await run(Array.from({ length: 500 }, (_, i) => ({ i })), CONCURRENCY, (x) => sink.record(entry(x.i)));
    await sink.close();

    // ------------------------------------------------------------------------------------------- báo cáo
    const errors = [...seq.rows, ...conc.rows, ...hardRun.rows].filter((r) => r.status !== 200);
    if (errors.length) say(`\n✗ ${errors.length} yêu cầu không phải HTTP 200 (ví dụ ${errors[0].status} cho loại ${errors[0].kind})`);
    const intentWrong = seq.rows.filter((r) => r.intent !== { phone4: 'phone-fragment', phone: 'phone', cccd: 'cccd' }[r.kind] && !(r.kind.startsWith('name') && r.intent === 'name'));
    if (intentWrong.length) say(`✗ ${intentWrong.length} truy vấn bị BFF hiểu sai loại (ví dụ "${intentWrong[0].kind}" → ${intentWrong[0].intent})`);

    const by = (rows, kind) => rows.filter((r) => r.kind === kind).map((r) => r.ms);
    const table = (title, rows, fetchRows, httpRows, seconds) => {
      say(`\n${title} (${(rows.length / seconds).toFixed(0)} yêu cầu/giây qua BFF). Đơn vị: ms.`);
      say('  loại                                  n    p50    p95    p99    max | Medplum (fetch) p50  p95 | Medplum (http) p50  p95');
      const out = {};
      for (const [kind, label] of [...KINDS, ['all', 'tất cả']]) {
        const pick = (rs) => (kind === 'all' ? rs.map((r) => r.ms) : by(rs, kind));
        const s = stats(pick(rows));
        const d = stats(pick(fetchRows));
        const h = stats(pick(httpRows));
        out[kind] = { bff: s, medplum: d, medplumHttp: h };
        say(`  ${label.padEnd(36)} ${String(s.n).padStart(4)} ${ms(s.p50).padStart(6)} ${ms(s.p95).padStart(6)} ${ms(s.p99).padStart(6)} ${ms(s.max).padStart(6)} | ${ms(d.p50).padStart(19)} ${ms(d.p95).padStart(4)} | ${ms(h.p50).padStart(18)} ${ms(h.p95).padStart(4)}`);
      }
      return out;
    };
    const seqTable = table('Tuần tự (một người dùng)', seq.rows, seqDirect.rows, seqHttp.rows, seq.seconds);
    const concTable = table(`${CONCURRENCY} yêu cầu đồng thời`, conc.rows, concDirect.rows, concHttp.rows, conc.seconds);

    const server = { seq: stats(seqServer.times), conc: stats(concServer.times) };
    const audit = { seq: stats(auditSeq.rows.map((r) => r.ms)), conc: stats(auditConc.rows.map((r) => r.ms)) };
    say('\nTách thời gian, mọi loại gộp lại (ms):');
    say('                                                           p50    p95    p99');
    const line = (label, s) => say(`  ${label.padEnd(55)} ${ms(s.p50).padStart(6)} ${ms(s.p95).padStart(6)} ${ms(s.p99).padStart(6)}`);
    line('sàn HTTP tới BFF: GET /api/health bằng http.request', floor.http);
    line('sàn HTTP tới BFF: GET /api/health bằng fetch', floor.fetch);
    line('tuần tự: phía khách (đầu-cuối)', seqTable.all.bff);
    line(`tuần tự: BFF tự đo (Fastify, ${server.seq.n} dòng log)`, server.seq);
    line('tuần tự: phần Medplum, gọi bằng fetch như BFF', seqTable.all.medplum);
    line('tuần tự: phần Medplum, gọi bằng http.request', seqTable.all.medplumHttp);
    line('tuần tự: ghi nhật ký truy cập (append + fsync)', audit.seq);
    line(`${CONCURRENCY} đồng thời: phía khách`, concTable.all.bff);
    line(`${CONCURRENCY} đồng thời: BFF tự đo (${server.conc.n} dòng log)`, server.conc);
    line(`${CONCURRENCY} đồng thời: phần Medplum, bằng fetch`, concTable.all.medplum);
    line(`${CONCURRENCY} đồng thời: phần Medplum, bằng http.request`, concTable.all.medplumHttp);
    line(`${CONCURRENCY} đồng thời: ghi nhật ký truy cập`, audit.conc);

    // Tính đúng: theo kết quả của lần chạy tuần tự qua BFF; lần chạy đồng thời phải ra cùng tập kết quả.
    say('\nTính đúng (theo dữ liệu gốc):');
    const correctness = {};
    const seqIds = new Map(seq.rows.map((r) => [`${r.kind}|${r.q}`, r.ids.join(',')]));
    const differ = conc.rows.filter((r) => seqIds.get(`${r.kind}|${r.q}`) !== r.ids.join(',')).length;
    for (const [kind, label] of KINDS) {
      const ev = seq.rows.filter((r) => r.kind === kind).map((r) => ({ q: r.q, ...evaluate(r, r.ids, index) }));
      const clear = ev.filter((e) => !e.ambiguous);
      const c = {
        n: ev.length,
        found: ev.filter((e) => e.found).length,
        clear: clear.length,
        clearFound: clear.filter((e) => e.found).length,
        ambiguous: ev.length - clear.length,
        imprecise: ev.filter((e) => !e.precise).length,
        maxMatches: Math.max(...ev.map((e) => e.matches)),
        missedClear: clear.filter((e) => !e.found).map((e) => ({ q: e.q, matches: e.matches, contains: e.contains, prefix: e.prefix })),
      };
      if (kind === 'phone4') {
        c.orderBad = ev.filter((e) => !e.orderOk).length;
        c.incomplete = ev.filter((e) => !e.complete).length;
      }
      correctness[kind] = c;
      const extra = kind === 'phone4' ? `; sai thứ tự ${c.orderBad}; thiếu người có số kết thúc bằng 4 số ${c.incomplete}` : '';
      say(`  ${label.padEnd(36)} tìm thấy ${c.found}/${c.n}; khi không quá ${LIMIT} người khớp: ${c.clearFound}/${c.clear}; quá ${LIMIT} người khớp: ${c.ambiguous} truy vấn (nhiều nhất ${c.maxMatches}); kết quả không khớp truy vấn: ${c.imprecise}${extra}`);
      for (const m of c.missedClear.slice(0, 5)) {
        const why = m.contains !== undefined ? `, ${m.contains} số chứa 4 số đó` : m.prefix !== undefined ? `, ${m.prefix} người có tên bắt đầu bằng từng từ` : '';
        say(`    ✗ không thấy: "${m.q}" (${m.matches} người khớp đúng từng từ${why})`);
      }
    }
    say(`  Lần chạy đồng thời ra kết quả khác lần tuần tự: ${differ}/${conc.rows.length} truy vấn`);
    const hardEv = hardRun.rows.map((r) => ({ q: r.q, ...evaluate(r, r.ids, index) }));
    const hardC = {
      n: hardEv.length,
      found: hardEv.filter((e) => e.found).length,
      incomplete: hardEv.filter((e) => !e.complete).length,
      orderBad: hardEv.filter((e) => !e.orderOk).length,
      overFetch: hardEv.filter((e) => e.contains > FRAGMENT_FETCH).length,
      containsMax: Math.max(...hardEv.map((e) => e.contains)),
      ms: stats(hardRun.rows.map((r) => r.ms)),
    };
    say(`  Ca khó 4 số cuối (bắt đầu bằng đầu số di động): tìm thấy ${hardC.found}/${hardC.n}; thiếu người có số kết thúc bằng 4 số ${hardC.incomplete}; sai thứ tự ${hardC.orderBad}; ${hardC.overFetch} truy vấn có hơn ${FRAGMENT_FETCH} số chứa 4 số đó (nhiều nhất ${hardC.containsMax}); p95 ${ms(hardC.ms.p95)} ms`);
    for (const e of hardEv.filter((x) => !x.found).slice(0, 5)) say(`    ✗ không thấy: "${e.q}" (${e.matches} số kết thúc bằng, ${e.contains} số chứa)`);

    const verdictKinds = ['phone4', 'name1', 'name2', 'name3'];
    const fast = verdictKinds.every((k) => seqTable[k].bff.p95 <= 200);
    const right = verdictKinds.every((k) => correctness[k].clearFound === correctness[k].clear && correctness[k].imprecise === 0) && correctness.phone4.orderBad === 0 && correctness.phone4.incomplete === 0;
    say(`\nM0-3 (tuần tự, 4 số cuối và tên không dấu): p95 ≤ 200 ms ${fast ? 'ĐẠT' : 'KHÔNG ĐẠT'}; đúng ${right ? 'ĐẠT' : 'KHÔNG ĐẠT'} (ca khó in riêng ở trên).`);

    const file = join(WORK, `result-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ machine, medplumUrl: BASE, state, querySeed, perKind: PER_KIND, concurrency: CONCURRENCY, seq: seqTable, conc: concTable, throughput: { seq: seq.rows.length / seq.seconds, conc: conc.rows.length / conc.seconds }, floor, server, audit, correctness, hard: hardC, differ, errors: errors.length, verdict: { fast, right }, rows: { seq: seq.rows, conc: conc.rows, hard: hardRun.rows } }, null, 1));
    say(`Kết quả chi tiết: ${file}`);
  } finally {
    bff.child.kill();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
