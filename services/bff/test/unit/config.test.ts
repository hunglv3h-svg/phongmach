import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const S = 'z'.repeat(32);
const realEnv = (over: Record<string, string> = {}) => ({
  AUTH_MODE: 'real',
  SESSION_SECRET: 'a'.repeat(32),
  REFRESH_SECRET: 'b'.repeat(32),
  TOTP_ENC_KEY: 'c'.repeat(32),
  SESSION_STORE_URL: ':memory:',
  ...over,
});

describe('cấu hình', () => {
  it('AUTH_MODE không có default: thiếu ⇒ ném (B6)', () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ AUTH_MODE: 'khong-biet' })).toThrow();
  });

  it('mode demo: chỉ localhost, khóa phiên ngẫu nhiên khi chưa đặt', () => {
    const c = loadConfig({ AUTH_MODE: 'demo' });
    expect(c.host).toBe('127.0.0.1');
    expect(c.mode).toBe('demo');
    expect(c.sessionSecretGenerated).toBe(true);
    expect(c.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({ AUTH_MODE: 'demo' }).sessionSecret).not.toBe(c.sessionSecret);
  });

  it('mode demo đọc SESSION_SECRET và PORT', () => {
    const c = loadConfig({ AUTH_MODE: 'demo', SESSION_SECRET: S, PORT: '9000' });
    expect(c).toMatchObject({ mode: 'demo', port: 9000, sessionSecretGenerated: false });
  });

  it('mode real hợp lệ: đủ khóa ⇒ nạp được, access 15 phút, refresh 7 ngày mặc định', () => {
    const c = loadConfig(realEnv());
    expect(c.mode).toBe('real');
    expect(c.sessionSecretGenerated).toBe(false);
    expect(c.accessTtlMinutes).toBe(15);
    expect(c.refreshTtlDays).toBe(7);
  });

  it('mode real thiếu khóa bắt buộc ⇒ ném, nêu đúng tên khóa (B6)', () => {
    for (const key of ['SESSION_SECRET', 'REFRESH_SECRET', 'TOTP_ENC_KEY', 'SESSION_STORE_URL'] as const) {
      const env = realEnv();
      delete (env as Record<string, string>)[key];
      expect(() => loadConfig(env), key).toThrow(new RegExp(key));
    }
  });

  it('mode real KHÔNG im lặng sinh SESSION_SECRET ngẫu nhiên (B6)', () => {
    const env = realEnv();
    delete (env as Record<string, string>).SESSION_SECRET;
    expect(() => loadConfig(env)).toThrow(/SESSION_SECRET/);
  });

  it('mode real: REFRESH_SECRET phải khác SESSION_SECRET', () => {
    expect(() => loadConfig(realEnv({ REFRESH_SECRET: 'a'.repeat(32) }))).toThrow(/khác SESSION_SECRET/);
  });

  it('từ chối khóa phiên quá ngắn và cổng sai', () => {
    expect(() => loadConfig({ AUTH_MODE: 'demo', SESSION_SECRET: 'ngan' })).toThrow();
    expect(() => loadConfig({ AUTH_MODE: 'demo', PORT: '70000' })).toThrow();
  });
});
