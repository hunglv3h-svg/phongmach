import { describe, expect, it } from 'vitest';
import { MemoryAuditSink, type AuditSink } from '../../src/audit.js';
import { captureLogs, login, makeApp } from './helpers.js';

const UUID = '3f2b8d1e-6c4a-4f0e-9a57-2d1c8b7e5a10';

describe('xác thực', () => {
  it('chặn mọi đường /api/patients và /api/audit khi chưa đăng nhập', async () => {
    const { app } = makeApp();
    for (const url of ['/api/patients/search?q=nguyen', `/api/patients/${UUID}`, '/api/audit']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/patients', payload: {} })).statusCode).toBe(401);
  });
  it('từ chối token sai và đăng nhập sai người dùng', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: 'Bearer rac' } });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/session', payload: { tenant: 'a', userId: 'b-owner' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/session', payload: { tenant: 'a' } })).statusCode).toBe(400);
  });
  it('danh sách người dùng demo không lộ bí mật', async () => {
    const { app } = makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/session/demo-users' })).body;
    expect(body).not.toContain('"secret"');
    expect(body).not.toContain('clientId');
    expect(body).toContain('a-owner');
  });
});

describe('phòng khám lấy từ phiên, không từ tham số', () => {
  it('kho được hỏi theo phòng khám của phiên, bỏ qua mọi tham số tenant', async () => {
    const { app, requested } = makeApp();
    const tokenB = await login(app, 'b', 'b-owner');
    await app.inject({ method: 'GET', url: '/api/patients/search?q=nguyen&tenant=a', headers: { authorization: `Bearer ${tokenB}`, 'x-tenant': 'a' } });
    expect(requested).toEqual(['b']);
  });
  it('bệnh nhân của phòng khám A không đọc được từ phòng khám B', async () => {
    const { app } = makeApp();
    const tokenA = await login(app, 'a', 'a-assistant');
    const created = await app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${tokenA}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '0912345678' } });
    const id = created.json().patient.id as string;
    const tokenB = await login(app, 'b', 'b-owner');
    expect((await app.inject({ method: 'GET', url: `/api/patients/${id}`, headers: { authorization: `Bearer ${tokenB}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/patients/${id}`, headers: { authorization: `Bearer ${tokenA}` } })).statusCode).toBe(200);
  });
});

describe('tạo bệnh nhân', () => {
  it('gửi lại cùng clientUuid trả 200 và không tạo thêm', async () => {
    const { app, stores } = makeApp();
    const token = await login(app, 'a', 'a-assistant');
    const post = () => app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An' } });
    const first = await post();
    const second = await post();
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(first.json().patient.id).toBe(second.json().patient.id);
    expect(stores.get('a')!.patients.size).toBe(1);
  });
  it('trả 400 khi sai dạng và 422 khi sai nghiệp vụ', async () => {
    const { app } = makeApp();
    const token = await login(app, 'a', 'a-assistant');
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: payload as object });
    expect((await post({ fullName: 'Nguyễn Văn An' })).statusCode).toBe(400); // thiếu clientUuid
    expect((await post({ clientUuid: 'khong-phai-uuid', fullName: 'Nguyễn Văn An' })).statusCode).toBe(400);
    expect((await post({ clientUuid: UUID, fullName: 'x'.repeat(200) })).statusCode).toBe(400);
  });
  it('id không phải UUID thì 404 chứ không chuyển tiếp xuống Medplum', async () => {
    const { app, requested } = makeApp();
    const token = await login(app, 'a', 'a-assistant');
    const res = await app.inject({ method: 'GET', url: '/api/patients/..%2F..%2FProject', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
    expect(requested).toEqual([]);
  });
});

describe('nhật ký truy cập', () => {
  it('ghi loại truy vấn, số kết quả và id, không ghi nội dung tìm kiếm', async () => {
    const audit = new MemoryAuditSink();
    const { app } = makeApp({ audit });
    const token = await login(app, 'a', 'a-assistant');
    await app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '0912345678' } });
    await app.inject({ method: 'GET', url: '/api/patients/search?q=0912345678', headers: { authorization: `Bearer ${token}` } });
    expect(audit.entries.map((e) => e.action)).toEqual(['login', 'create', 'search']);
    const search = audit.entries[2]!;
    expect(search).toMatchObject({ queryKind: 'phone', resultCount: 1, tenant: 'a', userId: 'a-assistant', userName: 'Phụ tá A', outcome: 'ok' });
    expect(JSON.stringify(audit.entries)).not.toContain('0912345678');
    expect(JSON.stringify(audit.entries)).not.toContain('Nguyễn');
  });
  it('chỉ chủ phòng khám xem được; bị từ chối cũng được ghi', async () => {
    const audit = new MemoryAuditSink();
    const { app } = makeApp({ audit });
    const assistant = await login(app, 'a', 'a-assistant');
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${assistant}` } })).statusCode).toBe(403);
    expect(audit.entries.at(-1)).toMatchObject({ action: 'audit-read', outcome: 'denied', userId: 'a-assistant' });
    const owner = await login(app, 'a', 'a-owner');
    const ok = await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${owner}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().entries.every((e: { tenant: string }) => e.tenant === 'a')).toBe(true);
  });
  it('nhật ký của phòng khám khác không lộ ra', async () => {
    const { app } = makeApp();
    const ownerB = await login(app, 'b', 'b-owner');
    const ownerA = await login(app, 'a', 'a-owner');
    await app.inject({ method: 'GET', url: '/api/patients/search?q=nguyen', headers: { authorization: `Bearer ${ownerA}` } });
    const res = await app.inject({ method: 'GET', url: '/api/audit', headers: { authorization: `Bearer ${ownerB}` } });
    expect(res.json().entries.every((e: { tenant: string }) => e.tenant === 'b')).toBe(true);
  });
  it('ghi nhật ký lỗi thì yêu cầu lỗi và không trả dữ liệu bệnh nhân (fail-closed)', async () => {
    let failing = false;
    const inner = new MemoryAuditSink();
    const audit: AuditSink = {
      record: async (e) => {
        if (failing) throw new Error('đĩa đầy');
        return inner.record(e);
      },
      recent: (t, l) => inner.recent(t, l),
      close: () => inner.close(),
    };
    const { app } = makeApp({ audit });
    const token = await login(app, 'a', 'a-assistant');
    await app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '0912345678' } });
    failing = true;
    const res = await app.inject({ method: 'GET', url: '/api/patients/search?q=0912345678', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('Nguyễn');
    expect(res.body).not.toContain('0912345678');
  });
});

describe('log không chứa dữ liệu cá nhân', () => {
  it('không có chuỗi truy vấn, token hay tên trong log', async () => {
    const logs = captureLogs();
    const { app } = makeApp({ logStream: logs.stream });
    const token = await login(app, 'a', 'a-assistant');
    await app.inject({ method: 'POST', url: '/api/patients', headers: { authorization: `Bearer ${token}` }, payload: { clientUuid: UUID, fullName: 'Nguyễn Văn An', phone: '0912345678', cccd: '001234567890' } });
    await app.inject({ method: 'GET', url: '/api/patients/search?q=0912345678', headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'GET', url: '/api/patients/search?q=nguyen%20van%20an', headers: { authorization: `Bearer ${token}` } });
    const text = logs.text();
    expect(text).toContain('/api/patients/search');
    for (const secret of ['0912345678', '001234567890', 'nguyen', 'Nguyễn', token, 'Bearer']) expect(text).not.toContain(secret);
  });
});
