import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredMode, THEME_KEY } from './theme';

describe('readStoredMode', () => {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('localStorage', stub);

  afterEach(() => store.clear());

  it('trả đúng giá trị đã lưu (light/dark)', () => {
    store.set(THEME_KEY, 'light');
    expect(readStoredMode()).toBe('light');
    store.set(THEME_KEY, 'dark');
    expect(readStoredMode()).toBe('dark');
  });

  it('mặc định dark khi vắng (lần chạy đầu)', () => {
    expect(readStoredMode()).toBe('dark');
  });

  it('quy giá trị cũ "system" về dark (di trú êm cho người từng chọn "theo hệ thống")', () => {
    store.set(THEME_KEY, 'system');
    expect(readStoredMode()).toBe('dark');
  });

  it('quy giá trị lạ về dark', () => {
    store.set(THEME_KEY, 'neon');
    expect(readStoredMode()).toBe('dark');
  });

  it('mặc định dark khi localStorage ném lỗi', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bị chặn');
      },
    });
    try {
      expect(readStoredMode()).toBe('dark');
    } finally {
      vi.stubGlobal('localStorage', stub);
    }
  });
});
