import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, safeEqual } from '../../src/identity/crypto.js';
import { generateTotp, verifyTotp } from '../../src/identity/totp.js';
import { LoginRateLimiter } from '../../src/identity/rateLimit.js';
import { SqliteSessionStore } from '../../src/sessionStore.js';

describe('băm mật khẩu Argon2id', () => {
  it('băm rồi xác thực đúng; mật khẩu sai thất bại', async () => {
    const h = await hashPassword('m@tKhauManh123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'm@tKhauManh123')).toBe(true);
    expect(await verifyPassword(h, 'sai')).toBe(false);
  });
  it('từ chối mật khẩu rỗng', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    const h = await hashPassword('x');
    expect(await verifyPassword(h, '')).toBe(false);
  });
});

describe('mã hóa bí mật TOTP', () => {
  it('mã hóa rồi giải mã lại đúng; IV khác nhau mỗi lần', () => {
    const key = 'k'.repeat(40);
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b); // IV ngẫu nhiên
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(b, key)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('giải mã bằng khóa khác thất bại', () => {
    const enc = encryptSecret('secret', 'k'.repeat(40));
    expect(() => decryptSecret(enc, 'x'.repeat(40))).toThrow();
  });
});

describe('TOTP RFC 6238', () => {
  // Vector chuẩn RFC 6238, bí mật ASCII "12345678901234567890" (SHA1, 8 chữ số). Thư viện mặc định 6 chữ số
  // nên ta kiểm tính nhất quán sinh/kiểm tại cùng thời điểm + cửa sổ ±1 bước, không sleep.
  const secret = 'JBSWY3DPEHPK3PXP';
  it('mã sinh ra tự xác thực tại cùng thời điểm', () => {
    const t = new Date('2026-10-05T08:00:00Z');
    const code = generateTotp(secret, t);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, t)).toBe(true);
  });
  it('cửa sổ ±1 bước (30s) chấp nhận; ngoài cửa sổ từ chối', () => {
    const t = new Date('2026-10-05T08:00:00Z');
    const code = generateTotp(secret, t);
    expect(verifyTotp(secret, code, new Date(t.getTime() + 30_000))).toBe(true); // +1 bước
    expect(verifyTotp(secret, code, new Date(t.getTime() + 120_000))).toBe(false); // +4 bước
  });
  it('mã sai bị từ chối', () => {
    expect(verifyTotp(secret, '000000', new Date('2026-10-05T08:00:00Z'))).toBe(false);
  });
});

describe('safeEqual', () => {
  it('so khớp đúng/sai, độ dài khác → false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('giới hạn tốc độ đăng nhập (§4.6, thời gian ảo)', () => {
  it('chặn sau N lần thất bại trong cửa sổ; hết cửa sổ thì mở lại', () => {
    const rl = new LoginRateLimiter(3, 60_000);
    const key = 'u1|1.2.3.4';
    let t = 0;
    expect(rl.isLocked(key, t)).toBe(false);
    rl.recordFailure(key, t);
    rl.recordFailure(key, (t += 1000));
    expect(rl.isLocked(key, t)).toBe(false);
    rl.recordFailure(key, (t += 1000)); // lần thứ 3 → khóa
    expect(rl.isLocked(key, t)).toBe(true);
    expect(rl.isLocked(key, t + 59_000)).toBe(true);
    expect(rl.isLocked(key, t + 61_000)).toBe(false); // hết cửa sổ
  });
  it('đăng nhập thành công xóa bộ đếm', () => {
    const rl = new LoginRateLimiter(2, 60_000);
    rl.recordFailure('k', 0);
    rl.recordSuccess('k');
    rl.recordFailure('k', 1000);
    expect(rl.isLocked('k', 1000)).toBe(false);
  });
});

describe('kho phiên SQLite: consume refresh một-lần (B5 nguyên tử)', () => {
  const mk = () => new SqliteSessionStore(':memory:');
  const now = 1_000_000;
  const ttl = 7 * 24 * 60 * 60 * 1000;

  it('consume xoay refresh; dùng lại refresh cũ → replay + thu hồi sid', () => {
    const store = mk();
    const { sid, refresh } = store.create({ userId: 'u1', tenant: 'a', refreshTtlMs: ttl, now });
    expect(store.isActive(sid)).toBe(true);
    const r1 = store.consume(refresh, { refreshTtlMs: ttl, now });
    expect(r1.kind).toBe('ok');
    // Dùng lại refresh CŨ: replay ⇒ thu hồi sid.
    const r2 = store.consume(refresh, { refreshTtlMs: ttl, now });
    expect(r2).toMatchObject({ kind: 'replay', sid });
    expect(store.isActive(sid)).toBe(false);
    store.close();
  });

  it('hai consume "song song" cùng token: đúng một thành công, token kia replay + sid thu hồi', () => {
    const store = mk();
    const { sid, refresh } = store.create({ userId: 'u1', tenant: 'a', refreshTtlMs: ttl, now });
    const a = store.consume(refresh, { refreshTtlMs: ttl, now });
    const b = store.consume(refresh, { refreshTtlMs: ttl, now });
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['ok', 'replay']);
    expect(store.isActive(sid)).toBe(false); // replay làm thu hồi sid
    store.close();
  });

  it('refresh hết hạn → invalid, sid thu hồi; token rác → invalid', () => {
    const store = mk();
    const { sid, refresh } = store.create({ userId: 'u1', tenant: 'a', refreshTtlMs: 1000, now });
    expect(store.consume(refresh, { refreshTtlMs: 1000, now: now + 2000 }).kind).toBe('invalid');
    expect(store.isActive(sid)).toBe(false);
    expect(store.consume('rac', { refreshTtlMs: ttl, now }).kind).toBe('invalid');
    store.close();
  });

  it('revoke làm isActive=false; sessionInfo trả userId/tenant khi còn hiệu lực', () => {
    const store = mk();
    const { sid } = store.create({ userId: 'u1', tenant: 'b', refreshTtlMs: ttl, now });
    expect(store.sessionInfo(sid)).toEqual({ userId: 'u1', tenant: 'b' });
    store.revoke(sid);
    expect(store.isActive(sid)).toBe(false);
    expect(store.sessionInfo(sid)).toBeUndefined();
    store.close();
  });
});
