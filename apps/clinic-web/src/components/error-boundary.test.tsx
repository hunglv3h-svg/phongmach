// @vitest-environment jsdom
// Hàng rào lỗi hiển thị: chạy riêng file này dưới jsdom (các file khác vẫn môi trường node) để render thật bằng react-dom/client
// và đi qua đúng đường bắt lỗi của React. Một component con ném lỗi lúc render phải làm hiện màn hình xin lỗi + nút tải lại,
// và lỗi phải được GHI ra console (không nuốt im lặng).
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowOnRender(): never {
  throw new Error('nổ lúc render (cố ý)');
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // React ghi ra console.error khi một hàng rào bắt lỗi; nuốt tiếng ồn nhưng vẫn đếm được số lần gọi.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  errorSpy.mockRestore();
});

describe('ErrorBoundary', () => {
  it('con render được thì cho hiện bình thường, không có màn hình xin lỗi', () => {
    act(() => root.render(<ErrorBoundary><p>nội dung thật</p></ErrorBoundary>));
    expect(container.textContent).toContain('nội dung thật');
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeNull();
  });

  it('con ném lỗi lúc render: hiện "Đã xảy ra lỗi hiển thị" + nút tải lại, và ghi lỗi ra console', () => {
    act(() => root.render(<ErrorBoundary><ThrowOnRender /></ErrorBoundary>));
    const fallback = container.querySelector('[data-testid="error-boundary-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('Đã xảy ra lỗi hiển thị');
    const reload = [...container.querySelectorAll('button')].find((b) => /Tải lại trang/.test(b.textContent ?? ''));
    expect(reload).toBeTruthy();
    // componentDidCatch ghi lỗi; nếu nuốt im lặng thì chuỗi này không xuất hiện trong các lần gọi console.error.
    expect(errorSpy.mock.calls.some((args: unknown[]) => args.some((a) => typeof a === 'string' && a.includes('ErrorBoundary caught')))).toBe(true);
  });

  it('nút tải lại gọi window.location.reload()', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      act(() => root.render(<StrictMode><ErrorBoundary><ThrowOnRender /></ErrorBoundary></StrictMode>));
      const btn = [...container.querySelectorAll('button')].find((b) => /Tải lại trang/.test(b.textContent ?? ''));
      act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
