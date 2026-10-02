// Việc cần quyền siêu quản trị Medplum: dùng cho seed và kiểm thử tích hợp. KHÔNG dùng trong BFF khi chạy.
import { randomBytes } from 'node:crypto';
import { MedplumClient } from '@medplum/core';
import type { ClientApplication } from '@medplum/fhirtypes';
import type { Tenant } from '../src/tenants.js';

export const MEDPLUM_URL = (process.env['MEDPLUM_URL'] ?? 'http://localhost:8103').replace(/\/$/, '');

export async function adminClient(baseUrl = MEDPLUM_URL): Promise<MedplumClient> {
  const email = process.env['MEDPLUM_ADMIN_EMAIL'] ?? 'admin@example.com';
  const password = process.env['MEDPLUM_ADMIN_PASSWORD'] ?? 'medplum_admin';
  const verifier = randomBytes(32).toString('base64url');
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, scope: 'openid', codeChallenge: verifier, codeChallengeMethod: 'plain' }),
  });
  const code = ((await login.json()) as { code?: string }).code;
  if (!login.ok || !code) {
    throw new Error(`Đăng nhập siêu quản trị thất bại (HTTP ${login.status}). Stack Medplum đã chạy chưa? Đặt MEDPLUM_ADMIN_EMAIL/MEDPLUM_ADMIN_PASSWORD nếu đã đổi mật khẩu mặc định.`);
  }
  const token = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }),
  });
  const accessToken = ((await token.json()) as { access_token?: string }).access_token;
  if (!accessToken) throw new Error('Không lấy được token siêu quản trị');
  const medplum = new MedplumClient({ baseUrl, cacheTime: 0 });
  medplum.setAccessToken(accessToken);
  return medplum;
}

/** Tạo một phòng khám: Project + ClientApplication (tài khoản máy). */
export async function createTenantProject(admin: MedplumClient, slug: string, name: string): Promise<Tenant> {
  const project = await admin.createResource({ resourceType: 'Project', name });
  const client = (await admin.post(`admin/projects/${project.id}/client`, { name: `bff-${slug}` })) as ClientApplication;
  if (!client.id || !client.secret) throw new Error(`Không tạo được tài khoản máy cho ${slug}`);
  return { slug, name, projectId: project.id, clientId: client.id, secret: client.secret };
}

export async function tenantClient(baseUrl: string, t: Tenant): Promise<MedplumClient> {
  const medplum = new MedplumClient({ baseUrl, clientId: t.clientId, clientSecret: t.secret, cacheTime: 0 });
  await medplum.startClientLogin(t.clientId, t.secret);
  return medplum;
}
