import { ThemeToggle } from './ThemeToggle';

/**
 * Dải nhãn trình diễn. Chỉ hiện ở chế độ DEMO (BFF mode='demo'): ở đường THẬT không hiện "Chưa có xác thực
 * thật" nữa (T-IDP đã xong). Ở đường thật vẫn còn mô phỏng chữ ký số / cổng đơn thuốc / Zalo nên hiện một dải
 * gọn hơn nêu đúng phần còn mô phỏng, không nói sai về xác thực.
 */
export function DemoBanner({ mode }: { mode?: 'demo' | 'real' }) {
  // Chưa biết mode (đang tải): không hiện dải để tránh nói sai.
  if (!mode) return null;
  return (
    <div className="demo-banner" role="note">
      <span className="demo-banner-text">
        {mode === 'real' ? (
          <>
            <strong>BẢN TRÌNH DIỄN M0</strong> · <strong>Mô phỏng</strong>: chữ ký số, cổng đơn thuốc quốc gia, gửi đơn qua Zalo (chỉ xem trước), OTP qua SMS · Chưa có: thu tiền, đặt lịch
          </>
        ) : (
          <>
            <strong>BẢN TRÌNH DIỄN M0</strong> · Dữ liệu hoàn toàn là giả · Chế độ demo không có xác thực thật · <strong>Mô phỏng</strong>: chữ ký số, cổng đơn thuốc quốc gia, gửi đơn qua Zalo (chỉ xem trước) · Chưa có: thu tiền, đặt lịch
          </>
        )}
      </span>
      <ThemeToggle />
    </div>
  );
}
