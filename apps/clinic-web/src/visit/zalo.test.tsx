// Bản xem trước tin Zalo (M0: mô phỏng). Dựng ra HTML tĩnh để kiểm đúng cái người dùng thấy: có nhãn mô phỏng,
// số đã che, không thuốc hay chẩn đoán, dữ liệu người dùng nhập hiện dạng chữ, và không có nút nào ngoài "Đóng".
import type { PrescriptionDetail } from '@phongmach/clinical';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ZALO_SIMULATED_LABEL, ZaloButton, ZaloPreview } from './ZaloPreview';

const noop = () => undefined;
const detail = (fullName = 'Nguyễn Văn An', phone: string | null = '0912345678'): PrescriptionDetail => ({
  encounterId: 'e1',
  patient: { id: 'p1', fullName, ...(phone ? { phone } : {}), cccdMasked: '••••••••6789' },
  diagnoses: [{ code: 'J02.9', name: 'Viêm họng cấp, không đặc hiệu' }],
  prescription: {
    id: 'rx1',
    code: 'PM-261003-ABC123',
    signedAt: '2026-10-03T02:15:00Z',
    signerName: 'BS. Lê Thị Thu Hà',
    patientId: 'p1',
    lines: [{ drug: 'amoxicillin-500', name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày' }],
    advice: 'Súc họng nước muối',
    acknowledgements: [],
  },
});
const preview = (d: PrescriptionDetail, clinic = 'Phòng khám Nội An Bình') => renderToStaticMarkup(<ZaloPreview detail={d} clinicName={clinic} onClose={noop} />);
/** data-testid của mọi nút bấm trong HTML. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => /data-testid="([^"]+)"/.exec(m[0])?.[1] ?? m[0]);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('ZaloPreview', () => {
  it('có nhãn "MÔ PHỎNG: không có tin nhắn nào được gửi" ở đầu hộp thoại, và lý do không có thuốc hay chẩn đoán', () => {
    const html = preview(detail());
    expect(ZALO_SIMULATED_LABEL).toBe('MÔ PHỎNG: không có tin nhắn nào được gửi');
    expect(html).toMatch(new RegExp(`data-testid="zalo-simulated"[^>]*>${ZALO_SIMULATED_LABEL}<`));
    expect(html.indexOf('zalo-simulated')).toBeLessThan(html.indexOf('zalo-message'));
    expect(text(html)).toMatch(/không có tên thuốc hay chẩn đoán/);
    expect(text(html)).toMatch(/đồng ý/);
    expect(text(html)).toMatch(/T-ZALO, T-CONSENT/);
    expect(text(html)).toMatch(/pháp chế/);
  });

  it('tin nhắn: tên phòng khám, lời chào, ngày kê, mã đơn, đường dẫn chờ M1; người nhận đã che số', () => {
    const t = text(preview(detail()));
    for (const part of ['Phòng khám Nội An Bình', 'Kính gửi Quý khách Nguyễn Văn An,', '03/10/2026', 'PM-261003-ABC123', 'Xem đơn tại: (đường dẫn sẽ có ở M1)', '091****678']) expect(t).toContain(part);
    expect(t).not.toContain('0912345678');
    expect(t).not.toContain('2345');
  });

  it('không hiện thuốc, chẩn đoán, lời dặn, bác sĩ ký hay CCCD', () => {
    const t = text(preview(detail()));
    for (const secret of ['Amoxicillin', 'amoxicillin', 'Uống', 'J02', 'Viêm họng', 'Súc họng', 'Lê Thị Thu Hà', '6789']) expect(t).not.toContain(secret);
  });

  it('tên bệnh nhân và tên phòng khám hiện dạng chữ, không thành thẻ HTML', () => {
    const html = preview(detail('Zq <img src=x onerror=alert(1)>'), '<b>PK</b>');
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/<b>PK<\/b>/);
    expect(html).toContain('Zq &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;PK&lt;/b&gt;');
  });

  it('chưa có số điện thoại: nói rõ bản thật sẽ không gửi được', () => {
    expect(text(preview(detail('Zq An', null)))).toMatch(/chưa có số điện thoại hợp lệ: bản thật sẽ không gửi được/);
  });

  it('chỉ có nút "Đóng": không có nút gửi', () => {
    expect(buttons(preview(detail()))).toEqual(['zalo-close']);
  });
});

describe('ZaloButton', () => {
  it('nút có nhãn MÔ PHỎNG; chưa bấm thì chưa có hộp thoại', () => {
    const html = renderToStaticMarkup(<ZaloButton detail={detail()} clinicName="PK" />);
    expect(buttons(html)).toEqual(['zalo-open']);
    expect(text(html)).toMatch(/Gửi đơn qua Zalo\s+MÔ PHỎNG/);
    expect(html).not.toContain('zalo-preview');
  });
});
