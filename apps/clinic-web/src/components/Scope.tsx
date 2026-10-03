const REAL = [
  'Tìm bệnh nhân theo tên không dấu, số điện thoại, 4 số cuối, CCCD; tạo nhanh; không tạo trùng',
  'Hàng chờ có cấp số, ưu tiên người đã hẹn/cấp cứu, màn hình chờ (chỉ số thứ tự và chữ cái đầu)',
  'Khám một trang: sinh hiệu, triệu chứng, chẩn đoán ICD-10 gõ tắt, dị ứng, tiền sử, lịch sử khám',
  'Kê đơn: đơn mẫu, "kê lại" một nút, kiểm tra trùng hoạt chất, dị ứng, số ngày tối đa (30 ngày, mạn tính 90 ngày), thiếu CCCD; xác nhận kèm lý do được lưu',
  'In đơn A5 có mã QR; hộp thư đi không mất đơn khi cổng lỗi; trạng thái từng đơn; thử lại tự động và thủ công',
  'Đồng hồ phiên khám đo ở máy chủ, lượt làm lúc mất mạng đo bằng đồng hồ máy khám và đếm riêng (mục tiêu 60 giây); nhật ký truy cập; cách ly giữa hai phòng khám',
  'Ngoại tuyến trên từng máy: mất mạng vẫn tìm trong hồ sơ đã có trên máy, tạo bệnh nhân, cấp số tạm, gọi vào khám, khám, ký (chữ ký vẫn là mô phỏng) và in đơn có nhãn "ký khi mất mạng"; có mạng lại thì tự đồng bộ, không mất, không trùng (kiểm thử tự động 20 chu kỳ ngắt và khôi phục mạng)',
  'Dữ liệu trên máy (bản nháp, hàng đợi đồng bộ, bộ đệm hồ sơ) được mã hóa; thao tác bị máy chủ từ chối khi đồng bộ (xung đột, quy tắc kê đơn) luôn được báo, không tự bỏ, không ghi đè',
];
const SIMULATED = [
  'Chữ ký số: băm nội dung đơn và gắn nhãn, chưa gọi nhà cung cấp ký số (T1)',
  'Cổng đơn thuốc quốc gia: bộ nối giả có nút chèn lỗi, cùng giao diện với bộ nối thật (chưa có tài liệu API và sandbox, TL34 Q1)',
  'Danh mục ICD-10, thuốc và đơn mẫu: tập con minh họa, chưa được cố vấn y khoa duyệt, chưa phải danh mục chính thức',
  'Đăng nhập: chọn người dùng demo, chưa có mật khẩu (T-IDP)',
  'Gửi đơn qua Zalo: nút ở màn hình kết quả ký chỉ mở bản xem trước tin nhắn, không gửi gì; tin nhắn không có thuốc hay chẩn đoán (gửi thật cần bệnh nhân đồng ý và mẫu tin ZNS được duyệt, M1)',
];
const MISSING = [
  'Ngoại tuyến, phần chưa có: hai máy thấy nhau khi phòng khám mất Internet (mỗi máy tự làm, có mạng lại mới thấy nhau); giải quyết xung đột (bản này chỉ phát hiện và báo)',
  'Ngoại tuyến, phần chưa có: chờ ký số và gửi cổng khi mất mạng ở mức đầy đủ; lưu toàn bộ danh sách bệnh nhân trên máy (chỉ có người trong hàng chờ hôm nay, hồ sơ đã mở trong ngày và người tạo trên máy này); mã PIN cho kho trên máy (khóa mã hóa nằm cùng máy với dữ liệu)',
  'Zalo, phần chưa có: gửi tin thật (ZNS); đặt lịch, nhắc lịch',
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
