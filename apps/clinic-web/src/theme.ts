import { useEffect, useState } from 'react';

// Chủ đề giao diện là tùy chọn hiển thị của từng MÁY, không phải dữ liệu bệnh nhân:
// lưu bằng localStorage là đúng, không đụng quy tắc kho ngoại tuyến mã hóa.
export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_KEY = 'phongmach.theme';

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Đọc lựa chọn đã lưu; mặc định 'system' khi vắng, giá trị lạ hoặc localStorage lỗi. */
export function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v && (MODES as readonly string[]).includes(v)) return v as ThemeMode;
  } catch {
    // localStorage có thể bị chặn/ném (chế độ riêng tư); coi như chưa chọn.
  }
  return 'system';
}

/** Hàm thuần: suy ra chủ đề cụ thể từ mode + sở thích hệ điều hành. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/** Đặt data-theme lên <html>. */
export function applyTheme(resolved: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

function darkQuery(): MediaQueryList | undefined {
  // jsdom có thể thiếu matchMedia; dùng phòng thủ.
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;
}

export function useTheme(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    const mql = darkQuery();
    const apply = () => applyTheme(resolveTheme(mode, mql?.matches ?? false));
    apply();
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Không lưu được thì bỏ qua: chủ đề vẫn áp dụng cho phiên hiện tại.
    }
    // Chỉ nghe hệ điều hành khi đang ở chế độ "theo hệ thống".
    if (mode === 'system' && mql) {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    return undefined;
  }, [mode]);

  return { mode, setMode };
}
