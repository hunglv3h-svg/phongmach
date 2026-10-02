import type { PrescriptionDetail } from '@phongmach/clinical';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { esc, formatVnDateTime, qrPayload, renderPrescriptionHtml } from '../src/index.js';

const EVIL = `<script>alert(1)</script>"'&`;

const detail = (over: Partial<PrescriptionDetail['prescription']> = {}, patient: Partial<PrescriptionDetail['patient']> = {}): PrescriptionDetail => ({
  prescription: {
    id: 'l1',
    code: 'PM-301010-ABC123',
    signedAt: '2030-01-10T03:05:00.000Z',
    signerName: 'BS. Lê Thu Hà',
    patientId: 'p1',
    lines: [
      { drug: 'AMOXICILLIN-500-MG', name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày', quantity: 15 },
      { drug: 'PARACETAMOL-500-MG', name: 'Paracetamol 500 mg', unit: 'viên', instruction: 'Uống khi sốt', quantity: 10 },
    ],
    advice: 'Uống nhiều nước',
    followUpDays: 3,
    acknowledgements: [],
    ...over,
  },
  patient: { id: 'p1', fullName: 'Nguyễn Văn An', birthDate: '2028-01-15', gender: 'male', cccdMasked: '0001****6789', phone: '0912345678', ...patient },
  diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp' }],
  encounterId: 'e1',
});

describe('mẫu in đơn thuốc A5', () => {
  it('khổ A5, CSP chặn mọi tài nguyên ngoài, nhãn mô phỏng, mã đơn và mã QR của đúng nội dung', async () => {
    const html = await renderPrescriptionHtml(detail(), 'Phòng khám Nội');
    expect(html).toContain('@page { size: A5 portrait');
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html).toContain('BẢN MÔ PHỎNG');
    expect(html).toContain('PM-301010-ABC123');
    expect(html).toContain(await QRCode.toString(qrPayload('PM-301010-ABC123'), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }));
    expect(html).not.toMatch(/<script|<img|<link|src=/i);
  });

  it('mọi chuỗi từ dữ liệu đều được thoát ký tự HTML', async () => {
    const html = await renderPrescriptionHtml(
      detail(
        { signerName: EVIL, advice: EVIL, lines: [{ drug: 'X', name: EVIL, unit: EVIL, instruction: EVIL, quantity: 1 }], gateway: { taskId: 't', status: 'sent', attempts: 1, nationalCode: EVIL } },
        { fullName: EVIL, cccdMasked: EVIL, phone: EVIL }
      ),
      EVIL
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain(`"'&<`);
    expect(html.split(esc(EVIL)).length - 1).toBe(10); // phòng khám, tên, CCCD, điện thoại, thuốc, cách dùng, đơn vị, lời dặn, bác sĩ, mã quốc gia
    expect(html).toContain(`Mã đơn quốc gia (mô phỏng): <b>${esc(EVIL)}</b>`);
  });

  it('cùng dữ liệu cho cùng một trang: tuổi tính tại lúc ký, giờ theo giờ Việt Nam (không theo đồng hồ hay múi giờ của máy in)', async () => {
    const a = await renderPrescriptionHtml(detail(), 'Phòng khám Nội');
    expect(await renderPrescriptionHtml(detail(), 'Phòng khám Nội')).toBe(a);
    // Sinh 15/01/2028, ký 10/01/2030: 23 tháng tại lúc ký (nếu tính theo hôm nay thì chưa sinh, sẽ không có tuổi).
    expect(a).toContain('<b>Tuổi:</b> 23 tháng');
    expect(a).toContain('10/01/2030 10:05');
    expect(formatVnDateTime('2026-10-20T16:59:30Z')).toBe('20/10/2026 23:59');
  });

  it('in khi mất mạng: đơn chưa đồng bộ có nhãn riêng; in lại đơn đã lưu ghi rõ trạng thái liên thông có thể cũ', async () => {
    const online = await renderPrescriptionHtml(detail({ gateway: { taskId: 't', status: 'retry', attempts: 2 } }), 'PK');
    expect(online).not.toContain('MẤT MẠNG');
    expect(online).toContain('Liên thông: Chờ gửi lại');

    const pending = await renderPrescriptionHtml(detail(), 'PK', { local: { pendingSync: true } });
    expect(pending).toContain('KÝ KHI MẤT MẠNG: chưa đồng bộ lên hệ thống, chưa liên thông');
    expect(pending).toContain('Liên thông: chưa gửi (đơn chưa đồng bộ lên hệ thống)');

    const reprint = await renderPrescriptionHtml(detail({ gateway: { taskId: 't', status: 'sent', attempts: 1, nationalCode: 'SIM-1' } }), 'PK', { local: { pendingSync: false } });
    expect(reprint).not.toContain('KÝ KHI MẤT MẠNG');
    expect(reprint).toContain('SIM-1');
    expect(reprint).toContain('In khi mất mạng từ dữ liệu trên máy; trạng thái liên thông có thể chưa cập nhật');
  });
});
