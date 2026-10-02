import type { Role } from './api';

export const ROLE_LABEL: Record<Role | 'system', string> = { owner: 'Chủ phòng khám', doctor: 'Bác sĩ', assistant: 'Phụ tá', system: 'Hệ thống' };

export const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác', unknown: 'Chưa rõ' };

export const ACTION_LABEL: Record<string, string> = {
  login: 'Đăng nhập',
  search: 'Tìm bệnh nhân',
  read: 'Mở hồ sơ',
  create: 'Tạo bệnh nhân',
  update: 'Cập nhật hồ sơ bệnh nhân',
  'audit-read': 'Xem nhật ký truy cập',
  'queue-read': 'Xem hàng chờ',
  'queue-prefetch': 'Nạp trước hồ sơ hàng chờ (để dùng khi mất mạng)',
  'check-in': 'Cho vào hàng chờ',
  'queue-cancel': 'Hủy lượt chờ',
  'visit-open': 'Mở hồ sơ khám',
  'visit-read': 'Xem lại hồ sơ khám',
  'visit-complete': 'Kết thúc khám / ký đơn',
  'history-read': 'Xem lịch sử khám',
  'note-read': 'Xem dị ứng / tiền sử',
  'note-write': 'Sửa dị ứng / tiền sử',
  'prescription-read': 'Xem đơn thuốc',
  'prescription-print': 'In đơn thuốc',
  'prescription-retry': 'Gửi lại đơn lên cổng',
  'gateway-send': 'Gửi đơn lên cổng (mô phỏng)',
  'gateway-sim': 'Chỉnh cổng mô phỏng',
  'metrics-read': 'Xem thời gian khám',
};

export const INTENT_LABEL: Record<string, string> = {
  phone: 'số điện thoại',
  'phone-fragment': 'đoạn số điện thoại',
  cccd: 'CCCD',
  name: 'tên (không cần dấu)',
};

/** "34 tuổi", hoặc "2 tuổi 5 tháng" / "8 tháng" cho trẻ nhỏ. */
export function ageText(birthDate: string | undefined, now = new Date()): string | undefined {
  if (!birthDate) return undefined;
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months -= 1;
  if (months < 0) return undefined;
  const years = Math.floor(months / 12);
  if (years >= 5) return `${years} tuổi`;
  if (years >= 1) return months % 12 ? `${years} tuổi ${months % 12} tháng` : `${years} tuổi`;
  return `${months} tháng`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { hour12: false });
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "1:12" cho 72 giây; quá một giờ thì "1:02:03". */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "5 phút", "1 giờ 5 phút". */
export function waitText(fromIso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  if (minutes < 1) return 'vừa đến';
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Giờ Việt Nam "14:05" hoặc "14:05:09", không phụ thuộc múi giờ của máy (dùng cho chỗ cần kết quả xác định: danh sách chờ đồng bộ). */
export function vnClock(ms: number, seconds = false): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });
}
