import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../../src/session.js';

const session = { userId: 'u1', userName: 'Phụ tá', role: 'assistant' as const, tenant: 'a' };

afterEach(() => vi.useRealTimers());

describe('phiên', () => {
  it('ký rồi xác thực lại đúng nội dung', async () => {
    const s = new SessionService('k'.repeat(40), 60);
    expect(await s.verify(await s.sign(session))).toEqual(session);
  });
  it('từ chối token ký bằng khóa khác', async () => {
    const token = await new SessionService('a'.repeat(40), 60).sign(session);
    expect(await new SessionService('b'.repeat(40), 60).verify(token)).toBeUndefined();
  });
  it('từ chối token bị sửa', async () => {
    const s = new SessionService('k'.repeat(40), 60);
    const token = await s.sign(session);
    const [h, p, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), tenant: 'b' })).toString('base64url');
    expect(await s.verify(`${h}.${forged}.${sig}`)).toBeUndefined();
  });
  it('từ chối token hết hạn', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T08:00:00Z'));
    const s = new SessionService('k'.repeat(40), 30);
    const token = await s.sign(session);
    vi.setSystemTime(new Date('2026-10-05T08:31:00Z'));
    expect(await s.verify(token)).toBeUndefined();
  });
  it('từ chối chuỗi rác', async () => {
    expect(await new SessionService('k'.repeat(40), 60).verify('khong-phai-token')).toBeUndefined();
  });
});
