import { drugCode } from './drugs.js';
import type { PrescriptionTemplate } from './types.js';

const D = drugCode;

const PARACETAMOL_PRN = 'Uống 1 viên mỗi lần khi sốt hoặc đau, cách nhau ít nhất 4–6 giờ, tối đa 4 viên/ngày';

/**
 * Đơn mẫu theo bệnh. MINH HỌA: chưa được cố vấn y khoa duyệt, không dùng lâm sàng.
 * Với trẻ em, liều thuốc phải tính theo cân nặng nên để trống: bác sĩ bắt buộc nhập.
 */
export const TEMPLATES: readonly PrescriptionTemplate[] = [
  {
    id: 'nhiem-tru-ho-hap-tren',
    name: 'Nhiễm trùng hô hấp trên cấp (không kháng sinh)',
    icd10: ['J06.9'],
    specialty: 'noi',
    reason: 'Sổ mũi, ho, đau họng',
    lines: [
      { drug: D('Paracetamol 500 mg'), perDose: 1, quantity: 10, instruction: PARACETAMOL_PRN },
      { drug: D('Cetirizin 10 mg') },
      { drug: D('Natri clorid 0,9% (nhỏ mũi)'), quantity: 1, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' },
    ],
    advice: 'Uống nhiều nước, nghỉ ngơi. Tái khám nếu sốt trên 3 ngày hoặc khó thở.',
  },
  {
    id: 'viem-hong-cap',
    name: 'Viêm họng cấp có chỉ định kháng sinh',
    icd10: ['J02.9'],
    specialty: 'noi',
    reason: 'Đau họng, sốt',
    lines: [
      { drug: D('Amoxicillin 500 mg') },
      { drug: D('Paracetamol 500 mg'), perDose: 1, quantity: 10, instruction: PARACETAMOL_PRN },
    ],
    advice: 'Súc họng nước muối ấm. Tái khám nếu sốt cao kéo dài hoặc khó nuốt, khó thở.',
  },
  {
    id: 'viem-phe-quan-cap',
    name: 'Viêm phế quản cấp',
    icd10: ['J20.9'],
    specialty: 'noi',
    reason: 'Ho, khạc đờm',
    lines: [
      { drug: D('Acetylcystein 200 mg') },
      { drug: D('Paracetamol 500 mg'), perDose: 1, quantity: 10, instruction: PARACETAMOL_PRN },
    ],
    advice: 'Uống nhiều nước ấm. Tái khám nếu khó thở, sốt cao hoặc ho kéo dài trên 2 tuần.',
  },
  {
    id: 'viem-mui-di-ung',
    name: 'Viêm mũi dị ứng',
    icd10: ['J30.4'],
    specialty: 'noi',
    reason: 'Hắt hơi, ngạt mũi, chảy mũi',
    lines: [{ drug: D('Cetirizin 10 mg'), days: 14 }, { drug: D('Natri clorid 0,9% (nhỏ mũi)'), quantity: 1, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' }],
  },
  {
    id: 'viem-da-day',
    name: 'Viêm dạ dày',
    icd10: ['K29.7'],
    specialty: 'noi',
    reason: 'Đau thượng vị, đầy bụng',
    lines: [{ drug: D('Omeprazol 20 mg') }, { drug: D('Domperidon 10 mg') }, { drug: D('Nhôm hydroxyd + magnesi hydroxyd') }],
    advice: 'Ăn uống đúng giờ, tránh rượu bia, đồ chua cay. Tái khám nếu đau tăng, nôn ra máu hoặc đi ngoài phân đen.',
  },
  {
    id: 'tieu-chay-cap',
    name: 'Tiêu chảy cấp (người lớn, không kháng sinh)',
    icd10: ['A09'],
    specialty: 'noi',
    reason: 'Đi ngoài phân lỏng',
    lines: [
      { drug: D('Oresol (muối bù nước)'), quantity: 10, instruction: 'Pha 1 gói với lượng nước theo hướng dẫn trên gói, uống sau mỗi lần đi ngoài phân lỏng' },
      { drug: D('Racecadotril 100 mg'), days: 3 },
      { drug: D('Men vi sinh Lactobacillus') },
    ],
    advice: 'Bù nước đầy đủ. Tái khám nếu đi ngoài ra máu, sốt cao, nôn nhiều hoặc mệt lả.',
  },
  {
    id: 'nhiem-khuan-tiet-nieu',
    name: 'Nhiễm khuẩn đường tiết niệu',
    icd10: ['N39.0'],
    specialty: 'noi',
    reason: 'Tiểu buốt, tiểu rắt',
    lines: [{ drug: D('Cefixim 200 mg') }],
    advice: 'Uống nhiều nước. Tái khám nếu sốt, đau lưng hoặc triệu chứng không giảm sau 3 ngày.',
  },
  {
    id: 'dau-that-lung',
    name: 'Đau vùng thắt lưng',
    icd10: ['M54.5'],
    specialty: 'noi',
    reason: 'Đau lưng',
    lines: [{ drug: D('Meloxicam 7,5 mg') }, { drug: D('Eperison 50 mg') }, { drug: D('Omeprazol 20 mg'), days: 5 }],
    advice: 'Tránh mang vác nặng. Tái khám nếu tê yếu chân hoặc rối loạn tiểu tiện.',
  },
  {
    id: 'tang-huyet-ap-tai-kham',
    name: 'Tăng huyết áp: tái khám cấp thuốc',
    icd10: ['I10', 'Z76.0'],
    specialty: 'noi',
    reason: 'Tái khám tăng huyết áp',
    lines: [{ drug: D('Amlodipin 5 mg') }],
    advice: 'Đo huyết áp tại nhà hằng ngày. Giảm muối. Tái khám sau 1 tháng.',
  },
  {
    id: 'dai-thao-duong-typ-2',
    name: 'Đái tháo đường typ 2: tái khám cấp thuốc',
    icd10: ['E11.9', 'Z76.0'],
    specialty: 'noi',
    reason: 'Tái khám đái tháo đường',
    lines: [{ drug: D('Metformin 500 mg') }],
    advice: 'Theo dõi đường huyết. Chế độ ăn hợp lý. Tái khám sau 1 tháng.',
  },
  {
    id: 'sot-virus-tre-em',
    name: 'Sốt, nhiễm virus ở trẻ em',
    icd10: ['B34.9'],
    specialty: 'nhi',
    reason: 'Sốt',
    lines: [{ drug: D('Paracetamol 150 mg (gói)'), quantity: 6 }],
    advice: 'Lau mát, cho uống nhiều nước. Tái khám ngay nếu sốt trên 3 ngày, li bì, bỏ bú, bỏ ăn hoặc co giật.',
  },
  {
    id: 'tieu-chay-cap-tre-em',
    name: 'Tiêu chảy cấp ở trẻ em',
    icd10: ['A09'],
    specialty: 'nhi',
    reason: 'Đi ngoài phân lỏng',
    lines: [
      { drug: D('Oresol (muối bù nước)'), quantity: 10, instruction: 'Pha 1 gói với lượng nước theo hướng dẫn trên gói, cho uống từng ít một sau mỗi lần đi ngoài phân lỏng' },
      { drug: D('Kẽm 10 mg') },
      { drug: D('Men vi sinh Lactobacillus') },
    ],
    advice: 'Tiếp tục cho ăn, bú bình thường. Tái khám ngay nếu đi ngoài ra máu, nôn nhiều, khát nhiều hoặc li bì.',
  },
  {
    id: 'ho-cam-tre-em',
    name: 'Ho, sổ mũi ở trẻ em',
    icd10: ['J06.9'],
    specialty: 'nhi',
    reason: 'Ho, sổ mũi',
    lines: [
      { drug: D('Natri clorid 0,9% (nhỏ mũi)'), quantity: 2, instruction: 'Nhỏ mỗi bên mũi 2–3 giọt, 3–4 lần/ngày' },
      { drug: D('Paracetamol 150 mg (gói)'), quantity: 6 },
    ],
    advice: 'Vệ sinh mũi bằng nước muối sinh lý. Tái khám nếu khó thở, thở nhanh hoặc sốt trên 3 ngày.',
  },
];
