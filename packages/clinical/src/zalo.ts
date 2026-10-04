import { maskPhone } from '@phongmach/fhir-vn-model';
import type { PrescriptionDetail } from './dto.js';
import { vnDay } from './time.js';

/** M0 chưa có trang xem đơn cho bệnh nhân: đường dẫn là việc của M1 (T-ZALO). */
export const ZALO_LINK_PLACEHOLDER = '(đường dẫn sẽ có ở M1)';

/**
 * Tham số của mẫu tin gửi đơn: đúng những trường được phép rời phòng khám qua Zalo.
 * Không có thuốc, chẩn đoán, lời dặn hay lý do xác nhận: gửi dữ liệu sức khỏe qua bên thứ ba cần bệnh nhân đồng ý
 * và mẫu tin ZNS được duyệt (M1: T-ZALO, T-CONSENT, cần ý kiến pháp chế).
 */
export interface ZaloPrescriptionParams {
  clinic: string;
  patientName: string;
  code: string;
  /** Ngày kê theo giờ Việt Nam, dd/mm/yyyy. */
  date: string;
  link: string;
}

export interface ZaloPrescriptionMessage {
  /** Số nhận đã che (`091****678`). Không có khi bệnh nhân chưa có số điện thoại hợp lệ. */
  recipient?: string;
  params: ZaloPrescriptionParams;
  /** Các dòng của tin nhắn, văn bản thuần (giao diện hiển thị dạng chữ, không dạng HTML). */
  lines: string[];
}

/**
 * Một trường đưa vào tin nhắn: bỏ ký tự định dạng vô hình (đảo chiều, độ rộng 0), đổi ký tự điều khiển (kể cả xuống dòng)
 * và ký tự ngăn dòng thành dấu cách, rồi gộp khoảng trắng. Tên bệnh nhân là dữ liệu do người dùng nhập: nó không được
 * thêm dòng (ví dụ một dòng "Xem đơn tại:" giả) hay đảo chiều chữ trong tin.
 */
export function zaloField(value: string | undefined): string {
  return (value ?? '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const vnDate = (iso: string): string => {
  const [y, m, d] = vnDay(new Date(iso)).split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Nội dung tin Zalo gửi đơn cho bệnh nhân, dựng từ đơn đã ký. Hàm thuần, không gọi mạng: M0 dùng để hiện bản xem trước
 * (mô phỏng, không gửi); M1 dùng `params` làm tham số mẫu ZNS. Nhận cả đơn nhưng chỉ lấy các trường ở `ZaloPrescriptionParams`.
 */
export function zaloPrescriptionMessage(detail: PrescriptionDetail, clinicName: string): ZaloPrescriptionMessage {
  const params: ZaloPrescriptionParams = {
    clinic: zaloField(clinicName),
    patientName: zaloField(detail.patient.fullName || detail.prescription.patientName),
    code: zaloField(detail.prescription.code),
    date: vnDate(detail.prescription.signedAt),
    link: ZALO_LINK_PLACEHOLDER,
  };
  const recipient = detail.patient.phone ? maskPhone(detail.patient.phone) : undefined;
  return {
    ...(recipient ? { recipient } : {}),
    params,
    lines: [
      params.clinic,
      `Kính gửi Quý khách${params.patientName ? ` ${params.patientName}` : ''},`,
      `Phòng khám đã kê đơn thuốc cho Quý khách ngày ${params.date}, mã đơn ${params.code}.`,
      `Xem đơn tại: ${params.link}`,
    ],
  };
}
