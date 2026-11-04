// @vitest-environment jsdom
// Nút chọn chủ đề: render thật dưới jsdom.
// Reset data-theme + localStorage mỗi lần để test không rò trạng thái chung (quy tắc văn hóa test).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

function click(testId: string) {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function activeTestId(): string | undefined {
  return container.querySelector<HTMLButtonElement>('.theme-opt.active')?.dataset.testid;
}

describe('ThemeToggle', () => {
  it('chỉ hai nút Sáng / Tối, không còn "Theo hệ thống"', () => {
    act(() => root.render(<ThemeToggle />));
    const labels = [...container.querySelectorAll('.theme-opt')].map((b) => b.textContent);
    expect(labels).toEqual(['Sáng', 'Tối']);
    expect(container.querySelector('[data-testid="theme-system"]')).toBeNull();
  });

  it('chọn Tối: data-theme=dark và lưu localStorage', () => {
    act(() => root.render(<ThemeToggle />));
    click('theme-dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('phongmach.theme')).toBe('dark');
  });

  it('chọn Sáng: data-theme=light và lưu localStorage', () => {
    act(() => root.render(<ThemeToggle />));
    click('theme-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('phongmach.theme')).toBe('light');
  });

  it('nhớ lựa chọn qua lần tải lại trang (đọc lại từ localStorage)', () => {
    act(() => root.render(<ThemeToggle />));
    click('theme-light');
    act(() => root.unmount());
    // Mô phỏng tải lại: mount lại thành phần, giá trị phải còn 'light'.
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    document.documentElement.removeAttribute('data-theme');
    act(() => root.render(<ThemeToggle />));
    expect(activeTestId()).toBe('theme-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('lần chạy đầu (chưa lưu gì): mặc định Tối', () => {
    act(() => root.render(<ThemeToggle />));
    expect(activeTestId()).toBe('theme-dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('giá trị cũ "system" đã lưu: quy về Tối, không lỗi, không trống', () => {
    localStorage.setItem('phongmach.theme', 'system');
    act(() => root.render(<ThemeToggle />));
    expect(activeTestId()).toBe('theme-dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
