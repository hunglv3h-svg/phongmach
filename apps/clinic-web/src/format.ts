import type { Role } from './api';

export const ROLE_LABEL: Record<Role, string> = { owner: 'Chủ phòng khám', doctor: 'Bác sĩ', assistant: 'Phụ tá' };

export const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác', unknown: 'Chưa rõ' };

export const ACTION_LABEL: Record<string, string> = {
  login: 'Đăng nhập',
  search: 'Tìm bệnh nhân',
  read: 'Mở hồ sơ',
  create: 'Tạo bệnh nhân',
  'audit-read': 'Xem nhật ký truy cập',
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
