import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('cấu hình', () => {
  it('mặc định an toàn: chỉ localhost, demo tắt, khóa phiên ngẫu nhiên', () => {
    const c = loadConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.demoAuth).toBe(false);
    expect(c.sessionSecretGenerated).toBe(true);
    expect(c.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({}).sessionSecret).not.toBe(c.sessionSecret);
  });
  it('đọc DEMO_AUTH và SESSION_SECRET', () => {
    const c = loadConfig({ DEMO_AUTH: '1', SESSION_SECRET: 'z'.repeat(32), PORT: '9000' });
    expect(c).toMatchObject({ demoAuth: true, port: 9000, sessionSecretGenerated: false });
  });
  it('từ chối khóa phiên quá ngắn và cổng sai', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'ngan' })).toThrow();
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
    expect(() => loadConfig({ DEMO_AUTH: 'yes' })).toThrow();
  });
});
