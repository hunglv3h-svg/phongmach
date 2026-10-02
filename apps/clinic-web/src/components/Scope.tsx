const REAL = [
  'Tìm bệnh nhân theo tên không dấu, số điện thoại, 4 số cuối, CCCD; tạo nhanh; không tạo trùng',
  'Hàng chờ có cấp số, ưu tiên người đã hẹn/cấp cứu, màn hình chờ (chỉ số thứ tự và chữ cái đầu)',
  'Khám một trang: sinh hiệu, triệu chứng, chẩn đoán ICD-10 gõ tắt, dị ứng, tiền sử, lịch sử khám',
  'Kê đơn: đơn mẫu, "kê lại" một nút, kiểm tra trùng hoạt chất, dị ứng, số ngày tối đa (30 ngày, mạn tính 90 ngày), thiếu CCCD; xác nhận kèm lý do được lưu',
  'In đơn A5 có mã QR; hộp thư đi không mất đơn khi cổng lỗi; trạng thái từng đơn; thử lại tự động và thủ công',
  'Đồng hồ phiên khám đo ở máy chủ (mục tiêu 60 giây); nhật ký truy cập; cách ly giữa hai phòng khám',
];
const SIMULATED = [
  'Chữ ký số: băm nội dung đơn và gắn nhãn, chưa gọi nhà cung cấp ký số (T1)',
  'Cổng đơn thuốc quốc gia: bộ nối giả có nút chèn lỗi, cùng giao diện với bộ nối thật (chưa có tài liệu API và sandbox, TL34 Q1)',
  'Danh mục ICD-10, thuốc và đơn mẫu: tập con minh họa, chưa được cố vấn y khoa duyệt, chưa phải danh mục chính thức',
  'Đăng nhập: chọn người dùng demo, chưa có mật khẩu (T-IDP)',
];
const MISSING = [
  'Ngoại tuyến (mất mạng vẫn khám và in): M0-S3',
  'Gửi đơn qua Zalo (sẽ chỉ hiện bản xem trước), đặt lịch, nhắc lịch',
  'Thu tiền, hóa đơn điện tử, bệnh án điện tử đầy đủ, tương tác thuốc, đơn thuốc cổ truyền',
  'Đồng ý điện tử, xuất/xóa dữ liệu theo yêu cầu, phân quyền chi tiết, nhiều cơ sở',
];

export function Scope() {
  const block = (title: string, items: string[], tone: string) => (
    <section className="card scope" aria-label={title}>
      <h2><span className={`badge ${tone}`}>{title}</span></h2>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </section>
  );
  return (
    <main className="page" data-testid="scope">
      <h1>Phạm vi bản trình diễn M0</h1>
      <p className="muted">Mọi thứ trên màn hình hoặc là thật, hoặc có nhãn "mô phỏng", hoặc nằm trong danh sách "chưa làm". Không có mục nào ở giữa.</p>
      <div className="scope-grid">
        {block('Đã làm thật', REAL, 'ok')}
        {block('Mô phỏng (có nhãn trên màn hình)', SIMULATED, 'warn')}
        {block('Chưa làm ở M0', MISSING, 'muted')}
      </div>
    </main>
  );
}
