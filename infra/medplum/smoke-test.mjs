#!/usr/bin/env node
// Smoke test cho backend Medplum của dự án PHONGMACH.
// Kiểm tra những cam kết của tài liệu v2.0 mà tầng lõi phải đáp ứng được ngay,
// không chỉ "server có chạy".
//
//   node infra/medplum/smoke-test.mjs [baseUrl]      (mặc định http://localhost:8103)
//
// Yêu cầu Node >= 18 (fetch có sẵn). Không cần cài thêm gói nào.
// Script tạo 2 project (phòng khám A, B) trên server đang chạy, mỗi project có một
// ClientApplication (tài khoản máy) — đúng cách lớp "Việt Nam hóa" sẽ gọi Medplum.
// Cần quyền siêu quản trị để tạo project; mặc định dùng tài khoản của bản cài mới,
// hoặc đặt MEDPLUM_ADMIN_EMAIL / MEDPLUM_ADMIN_PASSWORD.
// Chỉ chạy trên môi trường dev/thử nghiệm.

import { randomBytes, randomUUID } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://localhost:8103').replace(/\/$/, '');
const results = [];

// ok: true = đạt, false = không đạt, 'warn' = cần chú ý nhưng không làm hỏng kết quả
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok === 'warn' ? 'WARN' : ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${name}${detail ? '  —  ' + detail : ''}`);
}

async function http(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['content-type'] = path.startsWith('/fhir') ? 'application/fhir+json' : 'application/json';
    payload = JSON.stringify(body);
  }
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const ms = performance.now() - t0;
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, ms };
}

const ADMIN_EMAIL = process.env.MEDPLUM_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.MEDPLUM_ADMIN_PASSWORD ?? 'medplum_admin';

async function superAdminToken() {
  const verifier = randomBytes(32).toString('base64url');
  const login = await http('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, scope: 'openid', codeChallenge: verifier, codeChallengeMethod: 'plain' },
  });
  if (login.status !== 200 || !login.json?.code) throw new Error(`đăng nhập siêu quản trị: ${login.status} ${login.text}`);
  const token = await http('POST', '/oauth2/token', {
    form: { grant_type: 'authorization_code', code: login.json.code, code_verifier: verifier },
  });
  if (token.status !== 200) throw new Error(`token siêu quản trị: ${token.status} ${token.text}`);
  return token.json.access_token;
}

// Tạo một phòng khám = một Project + một ClientApplication, trả về token client_credentials.
async function provisionClinic(adminToken, label) {
  const project = await http('POST', '/fhir/R4/Project', { token: adminToken, body: { resourceType: 'Project', name: `Phong kham ${label}` } });
  if (project.status !== 201) throw new Error(`tạo project ${label}: ${project.status} ${project.text}`);
  const client = await http('POST', `/admin/projects/${project.json.id}/client`, { token: adminToken, body: { name: `svc-${label}` } });
  if (client.status !== 201) throw new Error(`tạo client ${label}: ${client.status} ${client.text}`);
  const token = await http('POST', '/oauth2/token', {
    form: { grant_type: 'client_credentials', client_id: client.json.id, client_secret: client.json.secret },
  });
  if (token.status !== 200) throw new Error(`token ${label}: ${token.status} ${token.text}`);
  return { token: token.json.access_token, projectId: project.json.id };
}

async function main() {
  // 1. Sức khỏe hạ tầng
  const hc = await http('GET', '/healthcheck');
  record('healthcheck: postgres + redis', hc.status === 200 && hc.json?.postgres && hc.json?.redis, `v${hc.json?.version}`);

  const meta = await http('GET', '/fhir/R4/metadata');
  record(
    'FHIR R4 CapabilityStatement',
    meta.status === 200 && meta.json?.fhirVersion === '4.0.1',
    `${meta.json?.rest?.[0]?.resource?.length ?? 0} loại tài nguyên`
  );

  // 2. Hai phòng khám độc lập
  const admin = await superAdminToken();
  const A = await provisionClinic(admin, 'clinicA');
  const B = await provisionClinic(admin, 'clinicB');
  record('tạo 2 phòng khám (2 project + 2 tài khoản máy)', Boolean(A.token && B.token && A.projectId !== B.projectId));

  // Tự đăng ký người dùng. Bản cấu hình của dự án tắt nó (registerEnabled=false). Nếu bật, lưu ý:
  // Medplum luôn gọi api.pwnedpasswords.com (HIBP) để kiểm tra mật khẩu bị lộ mỗi lần tạo user /
  // đặt mật khẩu và KHÔNG có công tắc cấu hình — mạng không ra được host đó thì thao tác thất bại.
  const reg = await http('POST', '/auth/newuser', {
    body: { firstName: 'Reg', lastName: 'Probe', email: `reg-${randomBytes(4).toString('hex')}@phongmach.test`, password: randomBytes(12).toString('base64url') + 'aA1!', codeChallenge: 'x', codeChallengeMethod: 'plain' },
  });
  const regMsg = reg.json?.issue?.[0]?.details?.text ?? reg.text.slice(0, 80);
  record(
    'tự đăng ký người dùng',
    reg.status === 200 || regMsg === 'Registration is disabled' ? true : 'warn',
    reg.status === 200 ? 'đang BẬT' : regMsg === 'Registration is disabled' ? 'đã tắt (registerEnabled=false)' : `HTTP ${reg.status} — ${regMsg} (kiểm tra egress tới api.pwnedpasswords.com)`
  );

  // 3. Mô hình dữ liệu cho phòng mạch Việt Nam
  const cccd = `0${Math.floor(Math.random() * 1e11)}`.padEnd(12, '0').slice(0, 12);
  const patientRes = await http('POST', '/fhir/R4/Patient', {
    token: A.token,
    body: {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:phongmach:cccd', value: cccd }],
      name: [{ family: 'Nguyễn', given: ['Văn', 'An'] }],
      telecom: [{ system: 'phone', value: '0912345678' }],
      birthDate: '1985-03-15',
      gender: 'male',
    },
  });
  record('tạo Patient (CCCD, tên tiếng Việt)', patientRes.status === 201, `${patientRes.ms.toFixed(0)} ms`);
  const patient = patientRes.json;

  const encounter = await http('POST', '/fhir/R4/Encounter', {
    token: A.token,
    body: {
      resourceType: 'Encounter',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: { reference: `Patient/${patient.id}` },
    },
  });
  const cond = await http('POST', '/fhir/R4/Condition', {
    token: A.token,
    body: {
      resourceType: 'Condition',
      subject: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.json?.id}` },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'J00', display: 'Viêm mũi họng cấp' }] },
    },
  });
  const rx = await http('POST', '/fhir/R4/MedicationRequest', {
    token: A.token,
    body: {
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.json?.id}` },
      identifier: [{ system: 'urn:phongmach:ma-don-thuoc-quoc-gia', value: randomUUID() }],
      medicationCodeableConcept: { text: 'Paracetamol 500mg' },
      dosageInstruction: [{ text: '1 viên x 3 lần/ngày x 5 ngày' }],
    },
  });
  record(
    'tạo Encounter + Condition(ICD-10) + MedicationRequest',
    [encounter, cond, rx].every((r) => r.status === 201)
  );

  // 4. Ngân sách tốc độ của tài liệu: tìm bệnh nhân < 0,2 s; mở hồ sơ < 0,4 s
  //    (chỉ là kiểm tra thô trên 1 máy, 1 người dùng; KHÔNG thay cho kiểm tra tải ở Giai đoạn 0)
  const lastFour = await http('GET', `/fhir/R4/Patient?phone=0912345678`, { token: A.token });
  record('tìm bệnh nhân theo số điện thoại', lastFour.status === 200 && lastFour.json?.entry?.length === 1, `${lastFour.ms.toFixed(0)} ms`);
  const byCccd = await http('GET', `/fhir/R4/Patient?identifier=urn:phongmach:cccd|${cccd}`, { token: A.token });
  record('tìm bệnh nhân theo CCCD', byCccd.status === 200 && byCccd.json?.entry?.length === 1, `${byCccd.ms.toFixed(0)} ms`);
  const open = await http('GET', `/fhir/R4/Patient/${patient.id}/$everything`, { token: A.token });
  record('mở toàn bộ hồ sơ ($everything)', open.status === 200, `${open.ms.toFixed(0)} ms, ${open.json?.entry?.length ?? 0} tài nguyên`);

  // 5. Cách ly dữ liệu giữa các phòng khám ("mỗi phòng khám là một ngăn riêng")
  const crossRead = await http('GET', `/fhir/R4/Patient/${patient.id}`, { token: B.token });
  record('phòng khám B KHÔNG đọc được bệnh nhân của A', crossRead.status === 404 || crossRead.status === 403, `HTTP ${crossRead.status}`);
  const crossSearch = await http('GET', `/fhir/R4/Patient?phone=0912345678`, { token: B.token });
  record('phòng khám B KHÔNG tìm thấy bệnh nhân của A', crossSearch.status === 200 && (crossSearch.json?.entry?.length ?? 0) === 0);
  const crossWrite = await http('PUT', `/fhir/R4/Patient/${patient.id}`, {
    token: B.token,
    body: { ...patient, gender: 'female' },
  });
  record('phòng khám B KHÔNG sửa được bệnh nhân của A', [403, 404].includes(crossWrite.status), `HTTP ${crossWrite.status}`);

  // 6. Nhật ký truy cập: tài liệu cam kết "mọi lần xem hồ sơ đều được ghi lại".
  //    Medplum sinh AuditEvent cho đọc/ghi nhưng mặc định chỉ ghi vào log; muốn LƯU thành
  //    tài nguyên phải đặt "saveAuditEvents": true trong cấu hình server.
  await http('GET', `/fhir/R4/Patient/${patient.id}`, { token: A.token });
  await new Promise((r) => setTimeout(r, 1500));
  const audit = await http('GET', `/fhir/R4/AuditEvent?entity=Patient/${patient.id}&_count=50`, { token: A.token });
  const subtypes = (audit.json?.entry ?? []).flatMap((e) => (e.resource?.subtype ?? []).map((st) => st.code));
  record(
    'AuditEvent được LƯU cho thao tác đọc hồ sơ',
    subtypes.includes('read') ? true : false,
    subtypes.includes('read') ? `${subtypes.length} sự kiện (${[...new Set(subtypes)].join(', ')})` : 'không có — đặt "saveAuditEvents": true trong medplum.config.json'
  );
  // Tìm kiếm trả về danh sách bệnh nhân nhưng (quan sát trên 5.2.0) không sinh AuditEvent nào được lưu.
  await http('GET', `/fhir/R4/Patient?phone=0912345678`, { token: A.token });
  await new Promise((r) => setTimeout(r, 1500));
  const afterSearch = await http('GET', `/fhir/R4/AuditEvent?subtype=search&_count=5`, { token: A.token });
  record(
    'AuditEvent cho thao tác TÌM KIẾM',
    (afterSearch.json?.entry?.length ?? 0) > 0 ? true : 'warn',
    (afterSearch.json?.entry?.length ?? 0) > 0 ? 'có' : 'không được lưu — nếu cần nhật ký truy cập cho danh sách, phải ghi ở lớp dịch vụ'
  );

  // 7. Lịch sử phiên bản (nền tảng cho "khóa sau ký")
  const update = await http('PUT', `/fhir/R4/Patient/${patient.id}`, { token: A.token, body: { ...patient, gender: 'other' } });
  const history = await http('GET', `/fhir/R4/Patient/${patient.id}/_history`, { token: A.token });
  record('lịch sử phiên bản tài nguyên (_history)', update.status === 200 && (history.json?.entry?.length ?? 0) >= 2);

  // 8. Tài khoản siêu quản trị mặc định của bản cài mới (admin@example.com / medplum_admin).
  //    Nếu script vừa đăng nhập bằng đúng thông tin mặc định thì tài khoản đó đang hoạt động — không cần thử lại.
  //    (Đăng nhập bị giới hạn 5 lần/phút, HTTP 429 KHÔNG chứng minh tài khoản đã bị vô hiệu.)
  const usingDefaults = ADMIN_EMAIL === 'admin@example.com' && ADMIN_PASSWORD === 'medplum_admin';
  let defaultStatus = 200;
  if (!usingDefaults) {
    const probe = await http('POST', '/auth/login', {
      body: { email: 'admin@example.com', password: 'medplum_admin', scope: 'openid', codeChallenge: 'x', codeChallengeMethod: 'plain' },
    });
    defaultStatus = probe.status;
  }
  record(
    'tài khoản siêu quản trị mặc định đã bị vô hiệu',
    defaultStatus === 200 ? false : defaultStatus === 400 ? true : 'warn',
    defaultStatus === 200
      ? 'admin@example.com / medplum_admin ĐANG HOẠT ĐỘNG — phải đổi mật khẩu trước khi mở ra mạng'
      : defaultStatus === 400
        ? 'đăng nhập bị từ chối'
        : `không xác định được (HTTP ${defaultStatus})`
  );

  const failed = results.filter((r) => r.ok === false);
  const warned = results.filter((r) => r.ok === 'warn');
  console.log(`\n${results.length - failed.length - warned.length}/${results.length} đạt, ${warned.length} cảnh báo, ${failed.length} không đạt`);
  if (failed.length) {
    console.log('Không đạt:\n' + failed.map((f) => `  - ${f.name}${f.detail ? ': ' + f.detail : ''}`).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test lỗi:', err);
  process.exit(2);
});
