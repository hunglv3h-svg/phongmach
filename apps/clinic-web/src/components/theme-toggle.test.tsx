// @vitest-environment jsdom
// Nút chọn chủ đề: render thật dưới jsdom. jsdom thiếu matchMedia nên phải stub.
// Reset data-theme + localStorage mỗi lần để test không rò trạng thái chung (quy tắc văn hóa test).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
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
  vi.unstubAllGlobals();
});

function click(testId: string) {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('ThemeToggle', () => {
  it('hiện đúng ba nhãn', () => {
    act(() => root.render(<ThemeToggle />));
    const labels = [...container.querySelectorAll('.theme-opt')].map((b) => b.textContent);
    expect(labels).toEqual(['Theo hệ thống', 'Sáng', 'Tối']);
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
});
