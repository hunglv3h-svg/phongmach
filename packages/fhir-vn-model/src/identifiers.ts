// Hệ định danh. Dùng URN tạm cho đến khi chốt tên miền chuẩn (kế hoạch, Q9, T-FHIR).
export const SYSTEMS = {
  cccd: 'urn:phongmach:cccd',
  clientUuid: 'urn:phongmach:client-uuid',
  /** Mã đơn thuốc do cổng quốc gia cấp sau khi nhận đơn (M0: cổng mô phỏng). */
  prescriptionCode: 'urn:phongmach:ma-don-thuoc-quoc-gia',
  /** Mã đơn nội bộ sinh lúc ký, in lên đơn (mã QR). Cơ chế mã thật phụ thuộc cổng quốc gia (TL34 Q1). */
  prescriptionLocal: 'urn:phongmach:ma-don-noi-bo',
  visitCode: 'urn:phongmach:luot-kham',
  drug: 'urn:phongmach:thuoc',
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  allergyClass: 'urn:phongmach:nhom-di-ung',
  ingredient: 'urn:phongmach:hoat-chat',
  specialty: 'urn:phongmach:chuyen-khoa',
  priority: 'urn:phongmach:uu-tien',
  task: 'urn:phongmach:task',
  /** Người dùng ứng dụng (nhân viên phòng khám). */
  user: 'urn:phongmach:nguoi-dung',
} as const;

export const EXTENSIONS = {
  /** Đánh dấu một HumanName là bản không dấu do hệ thống sinh ra để tìm kiếm (T-NAME). */
  nameFolded: 'urn:phongmach:ext:name-folded',
  queueNumber: 'urn:phongmach:ext:so-thu-tu',
  /** Lúc bác sĩ mở hồ sơ: mốc bắt đầu của đồng hồ phiên khám (T-TELE). */
  examOpened: 'urn:phongmach:ext:luc-mo-ho-so',
  /** Mốc mở hồ sơ theo đồng hồ của ai: 'client' khi mở lúc mất mạng (máy khách gửi lúc đồng bộ); không có là máy chủ. */
  examOpenedSource: 'urn:phongmach:ext:nguon-luc-mo-ho-so',
  visitSeconds: 'urn:phongmach:ext:thoi-gian-kham-giay',
  /** Thời gian phiên khám đo ở đâu: 'server', 'client' (ký khi mất mạng), 'client-invalid' (giờ máy khách không hợp lý, không tính). */
  visitSecondsSource: 'urn:phongmach:ext:nguon-thoi-gian-kham',
  /** Xác nhận của bác sĩ trước một cảnh báo kê đơn. */
  ruleAck: 'urn:phongmach:ext:xac-nhan-canh-bao',
  /** Chữ ký mô phỏng, không có giá trị pháp lý. */
  simulated: 'urn:phongmach:ext:mo-phong',
  attempts: 'urn:phongmach:ext:so-lan-gui',
  nextAttempt: 'urn:phongmach:ext:lan-gui-tiep',
  claimedAt: 'urn:phongmach:ext:nhan-viec-luc',
  lastError: 'urn:phongmach:ext:loi-gan-nhat',
  followUpDays: 'urn:phongmach:ext:tai-kham-sau-ngay',
} as const;

/** Tham số `If-None-Exist` để tạo có điều kiện theo UUID do client sinh (T-IDEM). */
export function clientUuidQuery(clientUuid: string): string {
  return `identifier=${SYSTEMS.clientUuid}|${clientUuid}`;
}
