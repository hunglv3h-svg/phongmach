import { Component, type ErrorInfo, type ReactNode } from 'react';

// Hàng rào lỗi hiển thị toàn ứng dụng: một lỗi render ở bất kỳ màn hình nào không được làm trắng cả trang.
// Hiện màn hình xin lỗi với nút tải lại, và GHI lỗi ra console (không nuốt im lặng) để còn gỡ được.
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught', error, info);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="page">
        <section className="card" data-testid="error-boundary-fallback">
          <h1>Đã xảy ra lỗi hiển thị</h1>
          <p>Màn hình gặp lỗi không mong muốn. Dữ liệu đang làm dở trên máy này vẫn còn; tải lại trang để tiếp tục.</p>
          <button className="primary" onClick={() => window.location.reload()}>Tải lại trang</button>
        </section>
      </main>
    );
  }
}
