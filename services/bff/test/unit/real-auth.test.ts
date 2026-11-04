import { describe, expect, it } from 'vitest';
import { MemoryAuditSink, type AuditSink } from '../../src/audit.js';
import { captureLogs } from './helpers.js';
import { KNOWN_TOTP_SECRET, makeReal, refreshCookie, totpCode } from './real-helpers.js';

const UUID = '3f2b8d1e-6c4a-4f0e-9a57-2d1c8b7e5a10';
const PASS = 'm@tKhauRatManh123';

const staff = (over: Partial<Parameters<typeof makeReal>[0]> = {}): Parameters<typeof makeReal>[0] => ({
  staff: [
    { userId: 'ass', loginId: '0900000001', name: 'Phụ tá', role: 'assistant', tenants: ['a'], password: PASS },
    { userId: 'doc', loginId: '0900000002', name: 'BS. A', role: 'doctor', tenants: ['a'], password: PASS, totp: 'known' },
    { userId: 'own', loginId: '0900000003', name: 'Chủ A', role: 'owner', tenants: ['a'], password: PASS, totp: 'known' },
    { userId: 'multi', loginId: '0900000004', name: 'BS. Đa', role: 'doctor', tenants: ['a', 'b'], password: PASS, totp: 'known' },
    { userId: 'newdoc', loginId: '0900000005', name: 'BS. Mới', role: 'doctor', tenants: ['a'], password: PASS }, // chưa TOTP
  ],
  ...over,
});

describe('B6 — chế độ real không có cửa demo', () => {
  it('route demo không tồn tại; login không-mật-khẩu không mở được', async () => {
    const { app } = await makeReal(staff());
    expect((await app.inject({ method: 'GET', url: '/api/session/demo-users' })).statusCode).toBe(404);
    // POST /api/session kiểu demo {tenant,userId} ở mode real: thiếu loginId/password ⇒ 400 (không lộ user).
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { tenant: 'a', userId: 'own' } });
    expect([400, 401]).toContain(res.statusCode);
    expect(res.body).not.toContain('demo');
  });
});

describe('B1 — thiếu phiên hợp lệ bị chặn ở mọi route', () => {
  it('không token / token rác → 401, không chạm store', async () => {
    const { app, requested } = await makeReal(staff());
    for (const url of ['/api/patients/search?q=x', `/api/patients/${UUID}`, '/api/audit']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer rac' } })).statusCode).toBe(401);
    }
    expect(requested).toEqual([]);
  });
});

async function loginAssistant(app: Awaited<ReturnType<typeof makeReal>>['app']) {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001', password: PASS } });
  return { token: res.json().token as string, refresh: refreshCookie(res)! };
}

async function loginOwner(app: Awaited<ReturnType<typeof makeReal>>['app'], now: Date) {
  const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000003', password: PASS } });
  expect(first.json().mfaRequired).toBe(true);
  const mfaToken = first.json().mfaToken as string;
  const res = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken, code: totpCode(KNOWN_TOTP_SECRET, now) } });
  return { token: res.json().token as string, refresh: refreshCookie(res)!, res };
}

describe('B4 — TOTP bắt buộc owner/doctor, forced-enrollment gate', () => {
  it('assistant không bắt MFA: cấp phiên ngay', async () => {
    const { app } = await makeReal(staff());
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001', password: PASS } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('owner đã có TOTP: mfaToken KHÔNG mở route dữ liệu; chỉ sau /mfa mới có access', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000003', password: PASS } });
    expect(first.json()).toMatchObject({ mfaRequired: true });
    const mfaToken = first.json().mfaToken as string;
    // mfaToken dùng như access ⇒ 401
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${mfaToken}` } })).statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken, code: totpCode(KNOWN_TOTP_SECRET, now) } });
    expect(good.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${good.json().token}` } })).statusCode).toBe(200);
  });

  it('doctor chưa đăng ký TOTP: enroll gate; token enroll không mở route dữ liệu tới khi xác minh', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000005', password: PASS } });
    expect(first.json()).toMatchObject({ enrollMfa: true });
    const { mfaToken, secret } = first.json();
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${mfaToken}` } })).statusCode).toBe(401);
    // hoàn tất enroll bằng mã đúng từ secret trả về
    const done = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken, code: totpCode(secret, now), secret } });
    expect(done.statusCode).toBe(200);
    expect(done.json().token).toBeTruthy();
  });

  it('mã TOTP sai → 401', async () => {
    const { app } = await makeReal(staff());
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000003', password: PASS } });
    const res = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken: first.json().mfaToken, code: '000000' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('B2b — pre-tenant token và select-tenant', () => {
  it('nhiều tenant: trả chooseTenant + pretenantToken (không cấp access)', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000004', password: PASS } });
    const mfa = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken: first.json().mfaToken, code: totpCode(KNOWN_TOTP_SECRET, now) } });
    expect(mfa.json().token).toBeUndefined();
    expect(mfa.json().pretenantToken).toBeTruthy();
    expect(mfa.json().chooseTenant.map((t: { slug: string }) => t.slug).sort()).toEqual(['a', 'b']);
  });

  it('pre-tenant token KHÔNG mở route dữ liệu (401)', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000004', password: PASS } });
    const mfa = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken: first.json().mfaToken, code: totpCode(KNOWN_TOTP_SECRET, now) } });
    const pre = mfa.json().pretenantToken as string;
    expect((await app.inject({ method: 'GET', url: '/api/patients/search?q=x', headers: { authorization: `Bearer ${pre}` } })).statusCode).toBe(401);
  });

  it('select-tenant: tenant ∈ allow cấp phiên; tenant ∉ allow → 403 kể cả khi nhồi thêm vào body', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const first = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000004', password: PASS } });
    const mfa = await app.inject({ method: 'POST', url: '/api/session/mfa', payload: { mfaToken: first.json().mfaToken, code: totpCode(KNOWN_TOTP_SECRET, now) } });
    const pre = mfa.json().pretenantToken as string;
    const ok = await app.inject({ method: 'POST', url: '/api/session/select-tenant', payload: { pretenantToken: pre, tenant: 'a' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tenant.slug).toBe('a');
    const bad = await app.inject({ method: 'POST', url: '/api/session/select-tenant', payload: { pretenantToken: pre, tenant: 'zzz' } });
    expect(bad.statusCode).toBe(403);
  });
});

describe('B2 — tenant chỉ từ phiên; nhồi tenant vào request bị bỏ qua', () => {
  it('phiên tenant a: ?tenant=b và x-tenant:b vẫn chỉ hỏi store a', async () => {
    const { app, requested } = await makeReal(staff());
    const { token } = await loginAssistant(app);
    await app.inject({ method: 'GET', url: '/api/patients/search?q=x&tenant=b', headers: { authorization: `Bearer ${token}`, 'x-tenant': 'b' } });
    expect(requested).toEqual(['a']);
  });
});

describe('B3 — audit login/denied fail-closed, không PII', () => {
  it('mật khẩu sai: entry login/denied không có loginId/password; login/ok có userId+tenant', async () => {
    const audit = new MemoryAuditSink();
    const { app } = await makeReal({ ...staff(), audit });
    await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001', password: 'SAI' } });
    await loginAssistant(app);
    const denied = audit.entries.find((e) => e.action === 'login' && e.outcome === 'denied');
    const ok = audit.entries.find((e) => e.action === 'login' && e.outcome === 'ok');
    expect(denied).toBeTruthy();
    expect(denied!.userId).toBeUndefined();
    expect(denied!.tenant).toBeUndefined();
    expect(ok).toMatchObject({ userId: 'ass', tenant: 'a' });
    const text = JSON.stringify(audit.entries);
    for (const secret of ['0900000001', 'SAI', PASS]) expect(text).not.toContain(secret);
  });

  it('sink ném khi ghi login/denied ⇒ 500, KHÔNG trả 401 (fail-closed)', async () => {
    const inner = new MemoryAuditSink();
    let failing = true;
    const audit: AuditSink = {
      record: async (e) => {
        if (failing && e.action === 'login') throw new Error('đĩa đầy');
        return inner.record(e);
      },
      recent: (t, l) => inner.recent(t, l),
      close: () => inner.close(),
    };
    const { app } = await makeReal({ ...staff(), audit });
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001', password: 'SAI' } });
    expect(res.statusCode).toBe(500);
    expect(res.statusCode).not.toBe(401);
    void failing;
  });

  it('không PII trong log kể cả khi body sai (400): không lộ password/loginId/OTP', async () => {
    const logs = captureLogs();
    const { app } = await makeReal({ ...staff(), logStream: logs.stream });
    await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001' } }); // thiếu password → 400
    await app.inject({ method: 'POST', url: '/api/session', payload: { loginId: '0900000001', password: 'secretpw999' } });
    const text = logs.text();
    for (const secret of ['secretpw999', '0900000001', PASS]) expect(text).not.toContain(secret);
  });
});

describe('B5 — thu hồi/hết hạn chặn mọi route; refresh một-lần (thời gian ảo)', () => {
  it('logout thu hồi sid ⇒ route ĐỌC /api/patients/:id và /api/audit đều 401', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const { token } = await loginOwner(app, now);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/session/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    // Sau logout, cùng access token (chưa hết hạn) bị từ chối trên route ĐỌC.
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/patients/${UUID}`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('access hết hạn → 401 (thời gian ảo, không sleep)', async () => {
    let t = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), accessTtlMinutes: 15, now: () => t });
    const { token } = await loginOwner(app, t);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    t = new Date(t.getTime() + 16 * 60_000);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('DELETE /api/sessions/:sid (owner) thu hồi phiên người khác', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app, sessionStore } = await makeReal({ ...staff(), now: () => now });
    const victim = await loginAssistant(app);
    const sid = sessionStore.activeSids('ass')[0]!;
    const { token: ownerToken } = await loginOwner(app, now);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${sid}`, headers: { authorization: `Bearer ${ownerToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/patients/search?q=x', headers: { authorization: `Bearer ${victim.token}` } })).statusCode).toBe(401);
  });

  it('refresh xoay cookie; dùng lại refresh cũ → 401 refresh-replayed + sid thu hồi', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const { refresh, token } = await loginAssistant(app);
    const r1 = await app.inject({ method: 'POST', url: '/api/session/refresh', cookies: { pm_refresh: refresh } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().token).toBeTruthy();
    const r2 = await app.inject({ method: 'POST', url: '/api/session/refresh', cookies: { pm_refresh: refresh } });
    expect(r2.statusCode).toBe(401);
    expect(r2.json().error).toBe('refresh-replayed');
    // sid bị thu hồi ⇒ access cũ cũng bị chặn.
    expect((await app.inject({ method: 'GET', url: '/api/patients/search?q=x', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });
});

describe('quản trị owner tạo nhân viên', () => {
  it('owner tạo được; assistant bị 403', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const { app } = await makeReal({ ...staff(), now: () => now });
    const { token: ownerToken } = await loginOwner(app, now);
    const created = await app.inject({
      method: 'POST',
      url: '/api/staff',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { userId: 'new1', loginId: '0911111111', name: 'NV Mới', role: 'assistant', tenants: ['a'], password: 'mkManh12345' },
    });
    expect(created.statusCode).toBe(201);
    const { token: assistantToken } = await loginAssistant(app);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/staff',
      headers: { authorization: `Bearer ${assistantToken}` },
      payload: { userId: 'new2', loginId: '0922222222', name: 'x', role: 'assistant', tenants: ['a'], password: 'mkManh12345' },
    });
    expect(denied.statusCode).toBe(403);
  });
});
