// Hàm dùng chung cho các script thử nghiệm. Chỉ dùng cho dev/thử nghiệm.
import { randomBytes } from 'node:crypto';

export const BASE = (process.env.MEDPLUM_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.MEDPLUM_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.MEDPLUM_ADMIN_PASSWORD ?? 'medplum_admin';

export async function http(method, path, { token, body, form, raw, contentType, headers } = {}) {
  const h = { ...(headers ?? {}) };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    h['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (raw !== undefined) {
    h['content-type'] = contentType ?? 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    h['content-type'] = path.startsWith('/fhir') ? 'application/fhir+json' : 'application/json';
    payload = JSON.stringify(body);
  }
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, ms: performance.now() - t0, headers: Object.fromEntries(res.headers) };
}

// Đăng nhập siêu quản trị. Đăng nhập bị giới hạn 5 lần/phút theo IP, nên gọi một lần mỗi script.
export async function adminToken() {
  const verifier = randomBytes(32).toString('base64url');
  const login = await http('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, scope: 'openid', codeChallenge: verifier, codeChallengeMethod: 'plain' },
  });
  if (login.status !== 200 || !login.json?.code) throw new Error(`đăng nhập siêu quản trị: ${login.status} ${login.text.slice(0, 200)}`);
  const token = await http('POST', '/oauth2/token', {
    form: { grant_type: 'authorization_code', code: login.json.code, code_verifier: verifier },
  });
  if (token.status !== 200) throw new Error(`token siêu quản trị: ${token.status}`);
  return token.json.access_token;
}

export async function mintClientToken(client) {
  const res = await http('POST', '/oauth2/token', {
    form: { grant_type: 'client_credentials', client_id: client.clientId, client_secret: client.secret },
  });
  if (res.status !== 200) throw new Error(`token client ${client.clientId}: ${res.status}`);
  return res.json.access_token;
}

// Một phòng khám = một Project + một ClientApplication.
export async function createClinic(adminTok, name) {
  const t0 = performance.now();
  const project = await http('POST', '/fhir/R4/Project', { token: adminTok, body: { resourceType: 'Project', name } });
  if (project.status !== 201) throw new Error(`tạo project: ${project.status} ${project.text.slice(0, 200)}`);
  const client = await http('POST', `/admin/projects/${project.json.id}/client`, { token: adminTok, body: { name: 'svc' } });
  if (client.status !== 201) throw new Error(`tạo client: ${client.status} ${client.text.slice(0, 200)}`);
  const clinic = { projectId: project.json.id, clientId: client.json.id, secret: client.json.secret };
  clinic.token = await mintClientToken(clinic);
  clinic.provisionMs = performance.now() - t0;
  return clinic;
}
