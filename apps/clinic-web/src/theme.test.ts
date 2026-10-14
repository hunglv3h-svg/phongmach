import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredMode, resolveTheme, THEME_KEY } from './theme';

describe('resolveTheme', () => {
  it('system theo sở thích hệ điều hành', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('light/dark bỏ qua sở thích hệ điều hành', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('readStoredMode', () => {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('localStorage', stub);

  afterEach(() => store.clear());

  it('trả đúng giá trị đã lưu', () => {
    for (const m of ['light', 'dark', 'system'] as const) {
      store.set(THEME_KEY, m);
      expect(readStoredMode()).toBe(m);
    }
  });

  it('mặc định system khi vắng', () => {
    expect(readStoredMode()).toBe('system');
  });

  it('mặc định system khi giá trị lạ', () => {
    store.set(THEME_KEY, 'neon');
    expect(readStoredMode()).toBe('system');
  });

  it('mặc định system khi localStorage ném lỗi', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bị chặn');
      },
    });
    try {
      expect(readStoredMode()).toBe('system');
    } finally {
      vi.stubGlobal('localStorage', stub);
    }
  });
});
