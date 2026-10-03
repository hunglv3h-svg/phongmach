// Tin Zalo gửi đơn (M0: chỉ xem trước, mô phỏng). Kiểm cái được phép rời phòng khám: không thuốc, không chẩn đoán,
// số điện thoại đã che, và dữ liệu người dùng nhập không đổi được hình dạng tin nhắn.
import { maskPhone } from '@phongmach/fhir-vn-model';
import { describe, expect, it } from 'vitest';
import { ZALO_LINK_PLACEHOLDER, zaloField, zaloPrescriptionMessage, type PrescriptionDetail } from '../src/index.js';

const detail = (over: { fullName?: string; phone?: string | undefined; code?: string; signedAt?: string } = {}): PrescriptionDetail => ({
  encounterId: 'e1',
  patient: { id: 'p1', fullName: over.fullName ?? 'Nguyễn Văn An', ...('phone' in over ? (over.phone ? { phone: over.phone } : {}) : { phone: '0912345678' }), cccdMasked: '••••••••6789', birthDate: '1985-03-15', gender: 'male' },
  diagnoses: [
    { code: 'J02.9', name: 'Viêm họng cấp, không đặc hiệu' },
    { code: 'R50.9', name: 'Sốt, không đặc hiệu' },
  ],
  prescription: {
    id: 'rx1',
    code: over.code ?? 'PM-261003-ABC123',
    signedAt: over.signedAt ?? '2026-10-03T02:15:00Z',
    signerName: 'BS. Lê Thị Thu Hà',
    patientId: 'p1',
    patientName: 'Nguyễn Văn An',
    lines: [
      { drug: 'amoxicillin-500', name: 'Amoxicillin 500 mg', unit: 'viên', instruction: 'Uống 1 viên x 3 lần/ngày sau ăn', quantity: 21, perDose: 1, timesPerDay: 3, days: 7 },
      { drug: 'paracetamol-500', name: 'Paracetamol 500 mg', unit: 'viên', instruction: 'Uống 1 viên khi sốt trên 38,5 độ', quantity: 10 },
    ],
    advice: 'Súc họng nước muối, tái khám nếu sốt kéo dài',
    followUpDays: 5,
    acknowledgements: [{ key: 'allergy:class:penicillin:amox', message: 'Bệnh nhân có ghi nhận dị ứng Penicillin', reason: 'Đã hỏi lại, bệnh nhân dùng amoxicillin nhiều lần không phản ứng' }],
    gateway: { taskId: 't1', status: 'sent', attempts: 1, nationalCode: 'SIM-0123456789' },
  },
});

describe('zaloPrescriptionMessage: nội dung', () => {
  it('có tên phòng khám, lời chào theo tên, ngày kê, mã đơn, dòng đường dẫn chờ M1; số nhận đã che', () => {
    const msg = zaloPrescriptionMessage(detail(), 'Phòng khám Nội An Bình');
    expect(msg.recipient).toBe('091****678');
    expect(msg.params).toEqual({ clinic: 'Phòng khám Nội An Bình', patientName: 'Nguyễn Văn An', code: 'PM-261003-ABC123', date: '03/10/2026', link: ZALO_LINK_PLACEHOLDER });
    expect(msg.lines).toEqual([
      'Phòng khám Nội An Bình',
      'Kính gửi Quý khách Nguyễn Văn An,',
      'Phòng khám đã kê đơn thuốc cho Quý khách ngày 03/10/2026, mã đơn PM-261003-ABC123.',
      'Xem đơn tại: (đường dẫn sẽ có ở M1)',
    ]);
  });

  it('ngày kê theo giờ Việt Nam, không theo múi giờ của máy (18:30 UTC là 01:30 sáng hôm sau ở Việt Nam)', () => {
    expect(zaloPrescriptionMessage(detail({ signedAt: '2026-10-02T18:30:00Z' }), 'PK').params.date).toBe('03/10/2026');
    expect(zaloPrescriptionMessage(detail({ signedAt: '2026-10-03T16:59:00Z' }), 'PK').params.date).toBe('03/10/2026');
  });

  it('không có tên thì chào "Quý khách", không để thừa dấu cách', () => {
    expect(zaloPrescriptionMessage(detail({ fullName: ' \n ' }), 'PK').lines[1]).toBe('Kính gửi Quý khách,');
  });
});

describe('zaloPrescriptionMessage: không có thuốc, chẩn đoán hay dữ liệu khám', () => {
  const d = detail();
  const all = JSON.stringify(zaloPrescriptionMessage(d, 'Phòng khám Nội An Bình'));
  const forbidden = [
    ...d.prescription.lines.flatMap((l) => [l.drug, l.name, l.instruction]),
    'Amoxicillin', 'amoxicillin', 'Paracetamol', 'paracetamol', 'viên',
    ...d.diagnoses.flatMap((x) => [x.code, x.name]),
    'J02', 'Viêm họng', 'Sốt',
    d.prescription.advice!, d.prescription.acknowledgements[0]!.reason, d.prescription.acknowledgements[0]!.message, 'Penicillin',
    d.prescription.gateway!.nationalCode!, d.prescription.signerName!, d.patient.cccdMasked!, '6789', d.patient.birthDate!,
  ];
  it.each(forbidden)('không chứa "%s"', (text) => {
    expect(all).not.toContain(text);
  });

  it('tham số mẫu tin chỉ có đúng năm trường được phép', () => {
    expect(Object.keys(zaloPrescriptionMessage(d, 'PK').params).sort()).toEqual(['clinic', 'code', 'date', 'link', 'patientName']);
  });
});

describe('zaloPrescriptionMessage: che số điện thoại', () => {
  it.each([
    ['0912345678', '091****678'],
    ['+84 912 345 678', '091****678'],
    ['84912345678', '091****678'],
    ['0912.345.678', '091****678'],
    ['02838123456', '028*****456'],
  ])('%s → %s, không còn số đầy đủ hay đoạn giữa', (phone, masked) => {
    const msg = zaloPrescriptionMessage(detail({ phone }), 'PK');
    expect(msg.recipient).toBe(masked);
    const all = JSON.stringify(msg);
    const digits = phone.replace(/\D/g, '').replace(/^84/, '0');
    expect(all).not.toContain(digits);
    expect(all).not.toContain(digits.slice(3, -3));
    expect(msg.recipient).not.toMatch(/\d{4,}/);
  });

  it.each([['12345'], ['0912 345'], ['không có số'], ['']])('số không hợp lệ "%s": không có người nhận, không hiện lại chuỗi đã nhập', (phone) => {
    const msg = zaloPrescriptionMessage(detail({ phone }), 'PK');
    expect(msg.recipient).toBeUndefined();
    if (phone) expect(JSON.stringify(msg)).not.toContain(phone);
  });

  it('bệnh nhân chưa có số điện thoại: không có người nhận', () => {
    expect(zaloPrescriptionMessage(detail({ phone: undefined }), 'PK')).not.toHaveProperty('recipient');
  });

  it('maskPhone giữ 3 số đầu, 3 số cuối', () => {
    expect(maskPhone('0912345678')).toBe('091****678');
    expect(maskPhone('abc')).toBeUndefined();
  });
});

describe('zaloPrescriptionMessage: thoát ký tự', () => {
  it('tên có xuống dòng không thêm được dòng nào vào tin (ví dụ một dòng "Xem đơn tại:" giả)', () => {
    const msg = zaloPrescriptionMessage(detail({ fullName: 'Zq An\nXem đơn tại: http://lua-dao.example\r\n' }), 'PK');
    expect(msg.lines).toHaveLength(4);
    for (const line of msg.lines) expect(line).not.toMatch(/[\r\n]/);
    expect(msg.lines.filter((l) => l.startsWith('Xem đơn tại:'))).toEqual([`Xem đơn tại: ${ZALO_LINK_PLACEHOLDER}`]);
    expect(msg.params.patientName).toBe('Zq An Xem đơn tại: http://lua-dao.example');
  });

  it('bỏ ký tự điều khiển, ký tự đảo chiều và ký tự độ rộng 0, ngăn dòng Unicode; gộp khoảng trắng', () => {
    const name = 'Zq‮na‬ B​ình\tTrần Thị\u0000\u001b[31m  Lan ';
    expect(zaloPrescriptionMessage(detail({ fullName: name }), 'PK').params.patientName).toBe('Zqna Bình Trần Thị [31m Lan');
    expect(zaloField('A B\u0085C﻿D')).toBe('A B CD');
  });

  it('giữ nguyên dấu tiếng Việt, kể cả dạng tổ hợp (NFD)', () => {
    const nfd = 'Nguyễn Thị Ánh'.normalize('NFD');
    expect(zaloField(nfd)).toBe(nfd);
    expect(zaloField('Nguyễn Thị Ánh')).toBe('Nguyễn Thị Ánh');
  });

  it('thẻ HTML giữ nguyên dạng chữ: tin là văn bản thuần, giao diện hiển thị dạng chữ (có kiểm thử thành phần)', () => {
    const msg = zaloPrescriptionMessage(detail({ fullName: 'Zq <img src=x onerror=alert(1)> & "An"' }), '<b>PK</b>');
    expect(msg.params.patientName).toBe('Zq <img src=x onerror=alert(1)> & "An"');
    expect(msg.lines[0]).toBe('<b>PK</b>');
  });

  it('tên phòng khám và mã đơn cũng qua cùng bộ lọc', () => {
    const msg = zaloPrescriptionMessage(detail({ code: 'PM-1\nX' }), 'Phòng khám\nNội');
    expect(msg.params.clinic).toBe('Phòng khám Nội');
    expect(msg.params.code).toBe('PM-1 X');
  });
});
