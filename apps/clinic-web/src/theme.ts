import { useEffect, useState } from 'react';

// Chủ đề giao diện là tùy chọn hiển thị của từng MÁY, không phải dữ liệu bệnh nhân:
// lưu bằng localStorage là đúng, không đụng quy tắc kho ngoại tuyến mã hóa.
export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'phongmach.theme';

/**
 * Đọc lựa chọn đã lưu. Mặc định 'dark' (giao diện gốc của ứng dụng là tối).
 * Giá trị cũ 'system' (đã bỏ) và mọi giá trị lạ/vắng/localStorage lỗi đều quy về 'dark'
 * để người từng chọn "theo hệ thống" không bị kẹt.
 */
export function readStoredMode(): ThemeMode {
  try {
    if (localStorage.getItem(THEME_KEY) === 'light') return 'light';
  } catch {
    // localStorage có thể bị chặn/ném (chế độ riêng tư); coi như chưa chọn.
  }
  return 'dark';
}

/** Đặt data-theme lên <html>. */
export function applyTheme(resolved: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

export function useTheme(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Không lưu được thì bỏ qua: chủ đề vẫn áp dụng cho phiên hiện tại.
    }
  }, [mode]);

  return { mode, setMode };
}
