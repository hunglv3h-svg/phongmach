// Hệ định danh. Dùng URN tạm cho đến khi chốt tên miền chuẩn (kế hoạch, Q9, T-FHIR).
export const SYSTEMS = {
  cccd: 'urn:phongmach:cccd',
  clientUuid: 'urn:phongmach:client-uuid',
  prescriptionCode: 'urn:phongmach:ma-don-thuoc-quoc-gia',
  visitCode: 'urn:phongmach:luot-kham',
} as const;

export const EXTENSIONS = {
  /** Đánh dấu một HumanName là bản không dấu do hệ thống sinh ra để tìm kiếm (T-NAME). */
  nameFolded: 'urn:phongmach:ext:name-folded',
} as const;

/** Tham số `If-None-Exist` để tạo có điều kiện theo UUID do client sinh (T-IDEM). */
export function clientUuidQuery(clientUuid: string): string {
  return `identifier=${SYSTEMS.clientUuid}|${clientUuid}`;
}
