import { describe, expect, it } from 'vitest';
import { localPrescriptionCode } from './print';

describe('mã đơn sinh ở máy khách', () => {
  it('cùng vectơ với máy chủ: 6 ký tự đầu SHA-256(clientUuid), ngày theo giờ ký giờ Việt Nam', async () => {
    // Giá trị tính bằng createHash('sha256') của Node, đúng cách BFF tính (kiểm thử BFF dùng cùng vectơ).
    expect(await localPrescriptionCode('11111111-1111-4111-8111-111111111111', '2026-10-20T03:00:00Z')).toBe('PM-261020-XP25EM');
    // Không phân biệt hoa thường của UUID (máy chủ hạ chữ thường trước khi băm).
    expect(await localPrescriptionCode('b1e2c3d4-a5f6-4789-8abc-def012345678', '2026-10-20T03:00:00Z')).toBe('PM-261020-DPR1CY');
    expect(await localPrescriptionCode('B1E2C3D4-A5F6-4789-8ABC-DEF012345678', '2026-10-20T03:00:00Z')).toBe('PM-261020-DPR1CY');
    // 23:59 giờ Việt Nam vẫn là ngày 20; 00:01 giờ Việt Nam đã là ngày 21.
    expect(await localPrescriptionCode('11111111-1111-4111-8111-111111111111', '2026-10-20T16:59:00Z')).toBe('PM-261020-XP25EM');
    expect(await localPrescriptionCode('11111111-1111-4111-8111-111111111111', '2026-10-20T17:01:00Z')).toBe('PM-261021-XP25EM');
  });
});
