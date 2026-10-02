import { stripDiacritics } from '@phongmach/fhir-vn-model';
import type { DrugDefaults, DrugEntry, Route } from './types.js';

/** Mã thuốc nội bộ sinh từ tên hiển thị: "Paracetamol 500 mg" → "PARACETAMOL-500-MG". */
export function drugCode(name: string): string {
  return stripDiacritics(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface Options {
  route?: Route;
  classes?: string[];
  paediatric?: boolean;
  manual?: boolean;
  /** Các hoạt chất, mặc định là [ingredient]. */
  also?: string[];
}

const d = (ingredient: string, name: string, unit: string, defaults: DrugDefaults = {}, o: Options = {}): DrugEntry => ({
  code: drugCode(name),
  ingredients: o.also ?? [ingredient],
  name,
  unit,
  route: o.route ?? 'uong',
  classes: o.classes ?? [],
  defaults,
  ...(o.paediatric ? { paediatric: true } : {}),
  ...(o.manual || defaults.asNeeded ? { manualQuantity: true } : {}),
});

const NSAID = ['nsaid'];
const PEN = ['penicillin', 'beta-lactam'];
const CEPH = ['cephalosporin', 'beta-lactam'];

/**
 * Thuốc phổ biến ở phòng mạch nội và nhi. MINH HỌA: không phải danh mục thuốc chính thức, chưa duyệt y khoa,
 * chưa có dữ liệu tương tác. Thuốc dạng trẻ em để trống liều: bác sĩ phải nhập theo cân nặng.
 */
export const DRUGS: readonly DrugEntry[] = [
  // Giảm đau, hạ sốt, chống viêm
  d('paracetamol', 'Paracetamol 500 mg', 'viên', { perDose: 1, asNeeded: true }),
  d('paracetamol', 'Paracetamol 150 mg (gói)', 'gói', { asNeeded: true }, { paediatric: true }),
  d('paracetamol', 'Paracetamol 250 mg (gói)', 'gói', { asNeeded: true }, { paediatric: true }),
  d('ibuprofen', 'Ibuprofen 400 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 3, timing: 'sau ăn' }, { classes: NSAID }),
  d('ibuprofen', 'Ibuprofen 100 mg/5 ml (siro)', 'chai', {}, { classes: NSAID, paediatric: true, manual: true }),
  d('diclofenac', 'Diclofenac 50 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5, timing: 'sau ăn' }, { classes: NSAID }),
  d('meloxicam', 'Meloxicam 7,5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5, timing: 'sau ăn' }, { classes: NSAID }),
  d('celecoxib', 'Celecoxib 200 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5, timing: 'sau ăn' }, { classes: NSAID }),
  d('etoricoxib', 'Etoricoxib 60 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5, timing: 'sau ăn' }, { classes: NSAID }),
  d('aspirin', 'Aspirin 81 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'sau ăn' }, { classes: ['nsaid', 'salicylate'] }),
  d('alverin', 'Alverin citrat 40 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5 }),
  d('hyoscin', 'Hyoscin butylbromid 10 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 3 }),
  d('trimebutin', 'Trimebutin 100 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 7, timing: 'trước ăn' }),
  // Kháng sinh
  d('amoxicillin', 'Amoxicillin 500 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5 }, { classes: PEN }),
  d('amoxicillin', 'Amoxicillin 250 mg (gói)', 'gói', { timesPerDay: 3, days: 5 }, { classes: PEN, paediatric: true }),
  d('amoxicillin+clavulanat', 'Amoxicillin + acid clavulanic 625 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5, timing: 'đầu bữa ăn' }, { classes: PEN, also: ['amoxicillin', 'acid clavulanic'] }),
  d('cefuroxim', 'Cefuroxim 500 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5, timing: 'sau ăn' }, { classes: CEPH }),
  d('cefixim', 'Cefixim 200 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5 }, { classes: CEPH }),
  d('cefixim', 'Cefixim 100 mg (gói)', 'gói', { timesPerDay: 2, days: 5 }, { classes: CEPH, paediatric: true }),
  d('cefpodoxim', 'Cefpodoxim 200 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5 }, { classes: CEPH }),
  d('cefalexin', 'Cefalexin 500 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5 }, { classes: CEPH }),
  d('azithromycin', 'Azithromycin 500 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 3, timing: 'trước ăn 1 giờ' }, { classes: ['macrolide'] }),
  d('clarithromycin', 'Clarithromycin 500 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 7 }, { classes: ['macrolide'] }),
  d('ciprofloxacin', 'Ciprofloxacin 500 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 5 }, { classes: ['quinolone'] }),
  d('levofloxacin', 'Levofloxacin 500 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5 }, { classes: ['quinolone'] }),
  d('metronidazol', 'Metronidazol 250 mg', 'viên', { perDose: 2, timesPerDay: 3, days: 7, timing: 'sau ăn' }),
  d('sulfamethoxazol+trimethoprim', 'Sulfamethoxazol + trimethoprim 480 mg', 'viên', { perDose: 2, timesPerDay: 2, days: 5, timing: 'sau ăn' }, { classes: ['sulfonamide'], also: ['sulfamethoxazol', 'trimethoprim'] }),
  d('doxycyclin', 'Doxycyclin 100 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 7, timing: 'sau ăn, uống nhiều nước' }, { classes: ['tetracycline'] }),
  d('fosfomycin', 'Fosfomycin 3 g', 'gói', { perDose: 1, timesPerDay: 1, days: 1, timing: 'buổi tối, trước khi ngủ' }),
  // Dị ứng, hô hấp
  d('cetirizin', 'Cetirizin 10 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5, timing: 'buổi tối' }, { classes: ['antihistamine'] }),
  d('loratadin', 'Loratadin 10 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5 }, { classes: ['antihistamine'] }),
  d('fexofenadin', 'Fexofenadin 180 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5 }, { classes: ['antihistamine'] }),
  d('desloratadin', 'Desloratadin 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5 }, { classes: ['antihistamine'] }),
  d('clorpheniramin', 'Clorpheniramin 4 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 3 }, { classes: ['antihistamine'] }),
  d('montelukast', 'Montelukast 10 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi tối' }),
  d('salbutamol', 'Salbutamol 100 mcg/liều (bình xịt)', 'bình', { asNeeded: true }, { route: 'xit' }),
  d('salbutamol', 'Salbutamol 2 mg/5 ml (siro)', 'chai', {}, { paediatric: true, manual: true }),
  d('budesonid', 'Budesonid 0,5 mg/2 ml (khí dung)', 'ống', { perDose: 1, timesPerDay: 2, days: 5 }, { route: 'khi-dung', classes: ['corticosteroid'] }),
  d('acetylcystein', 'Acetylcystein 200 mg', 'gói', { perDose: 1, timesPerDay: 3, days: 5, timing: 'sau ăn' }),
  d('bromhexin', 'Bromhexin 8 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5 }),
  d('ambroxol', 'Ambroxol 30 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5, timing: 'sau ăn' }),
  d('dextromethorphan', 'Dextromethorphan 15 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 3 }),
  d('natri clorid', 'Natri clorid 0,9% (nhỏ mũi)', 'lọ', {}, { route: 'nho-mui', paediatric: true, manual: true }),
  d('prednisolon', 'Prednisolon 5 mg', 'viên', { timesPerDay: 1, days: 5, timing: 'buổi sáng, sau ăn' }, { classes: ['corticosteroid'] }),
  d('methylprednisolon', 'Methylprednisolon 16 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 5, timing: 'buổi sáng, sau ăn' }, { classes: ['corticosteroid'] }),
  // Tiêu hóa
  d('omeprazol', 'Omeprazol 20 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi sáng, trước ăn 30 phút' }, { classes: ['ppi'] }),
  d('esomeprazol', 'Esomeprazol 40 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi sáng, trước ăn' }, { classes: ['ppi'] }),
  d('pantoprazol', 'Pantoprazol 40 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi sáng, trước ăn' }, { classes: ['ppi'] }),
  d('rabeprazol', 'Rabeprazol 20 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi sáng, trước ăn' }, { classes: ['ppi'] }),
  d('domperidon', 'Domperidon 10 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 7, timing: 'trước ăn 15–30 phút' }),
  d('metoclopramid', 'Metoclopramid 10 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 3, timing: 'trước ăn' }),
  d('ondansetron', 'Ondansetron 4 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 2 }),
  d('oresol', 'Oresol (muối bù nước)', 'gói', { asNeeded: true }),
  d('zinc', 'Kẽm 10 mg', 'viên', { timesPerDay: 1, days: 10 }, { paediatric: true }),
  d('racecadotril', 'Racecadotril 100 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5, timing: 'trước ăn' }),
  d('racecadotril', 'Racecadotril 30 mg (gói)', 'gói', { timesPerDay: 3, days: 5 }, { paediatric: true }),
  d('diosmectit', 'Diosmectit 3 g', 'gói', { perDose: 1, timesPerDay: 3, days: 3, timing: 'xa bữa ăn' }),
  d('lactulose', 'Lactulose 10 g/15 ml', 'gói', { perDose: 1, timesPerDay: 2, days: 5 }),
  d('bisacodyl', 'Bisacodyl 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 3, timing: 'buổi tối' }),
  d('simethicon', 'Simethicon 40 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5, timing: 'sau ăn' }),
  d('lactobacillus', 'Men vi sinh Lactobacillus', 'gói', { perDose: 1, timesPerDay: 2, days: 7 }),
  d('nhom hydroxyd+magnesi hydroxyd', 'Nhôm hydroxyd + magnesi hydroxyd', 'gói', { perDose: 1, timesPerDay: 3, days: 7, timing: 'sau ăn 1–2 giờ' }, { also: ['nhom hydroxyd', 'magnesi hydroxyd'] }),
  d('sucralfat', 'Sucralfat 1 g', 'gói', { perDose: 1, timesPerDay: 2, days: 14, timing: 'trước ăn' }),
  // Tim mạch, chuyển hóa
  d('amlodipin', 'Amlodipin 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng' }, { classes: ['ccb'] }),
  d('losartan', 'Losartan 50 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }, { classes: ['arb'] }),
  d('telmisartan', 'Telmisartan 40 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }, { classes: ['arb'] }),
  d('valsartan', 'Valsartan 80 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }, { classes: ['arb'] }),
  d('perindopril', 'Perindopril 4 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng' }, { classes: ['acei'] }),
  d('enalapril', 'Enalapril 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }, { classes: ['acei'] }),
  d('bisoprolol', 'Bisoprolol 2,5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng' }, { classes: ['beta-blocker'] }),
  d('hydroclorothiazid', 'Hydroclorothiazid 25 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng' }, { classes: ['thiazide'] }),
  d('indapamid', 'Indapamid 1,5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng' }, { classes: ['thiazide'] }),
  d('atorvastatin', 'Atorvastatin 20 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi tối' }, { classes: ['statin'] }),
  d('rosuvastatin', 'Rosuvastatin 10 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi tối' }, { classes: ['statin'] }),
  d('metformin', 'Metformin 500 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 30, timing: 'sau ăn' }, { classes: ['biguanide'] }),
  d('metformin', 'Metformin 850 mg', 'viên', { perDose: 1, timesPerDay: 2, days: 30, timing: 'sau ăn' }, { classes: ['biguanide'] }),
  d('gliclazid', 'Gliclazid 30 mg (giải phóng chậm)', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng, trước ăn' }, { classes: ['sulfonylurea'] }),
  d('glimepirid', 'Glimepirid 2 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'buổi sáng, trước ăn' }, { classes: ['sulfonylurea'] }),
  d('clopidogrel', 'Clopidogrel 75 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }),
  d('allopurinol', 'Allopurinol 300 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'sau ăn' }),
  // Vitamin, khoáng, thần kinh, cơ xương khớp
  d('vitamin b1+b6+b12', 'Vitamin B1 + B6 + B12', 'viên', { perDose: 1, timesPerDay: 2, days: 14 }, { also: ['vitamin b1', 'vitamin b6', 'vitamin b12'] }),
  d('vitamin c', 'Vitamin C 500 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 10 }),
  d('vitamin d3', 'Vitamin D3 400 IU (giọt)', 'lọ', {}, { paediatric: true, manual: true }),
  d('sat+acid folic', 'Sắt fumarat + acid folic', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'sau ăn' }, { also: ['sat fumarat', 'acid folic'] }),
  d('calci+vitamin d3', 'Calci carbonat + vitamin D3', 'viên', { perDose: 1, timesPerDay: 1, days: 30, timing: 'sau ăn' }, { also: ['calci carbonat', 'vitamin d3'] }),
  d('acid folic', 'Acid folic 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 30 }),
  d('betahistin', 'Betahistin 16 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 14, timing: 'sau ăn' }),
  d('flunarizin', 'Flunarizin 5 mg', 'viên', { perDose: 1, timesPerDay: 1, days: 14, timing: 'buổi tối' }),
  d('eperison', 'Eperison 50 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 5, timing: 'sau ăn' }),
  d('glucosamin', 'Glucosamin 500 mg', 'viên', { perDose: 1, timesPerDay: 3, days: 30 }),
  // Dùng ngoài, nhỏ mắt, tai
  d('mupirocin', 'Mupirocin 2% (kem)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('clotrimazol', 'Clotrimazol 1% (kem)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('ketoconazol', 'Ketoconazol 2% (kem)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('terbinafin', 'Terbinafin 1% (kem)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('hydrocortison', 'Hydrocortison 1% (kem)', 'tuýp', {}, { route: 'boi', manual: true, classes: ['corticosteroid'] }),
  d('permethrin', 'Permethrin 5% (kem)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('benzoyl peroxid', 'Benzoyl peroxid 2,5% (gel)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('adapalen', 'Adapalen 0,1% (gel)', 'tuýp', {}, { route: 'boi', manual: true }),
  d('natri clorid', 'Natri clorid 0,9% (nhỏ mắt)', 'lọ', {}, { route: 'nho-mat', manual: true }),
  d('tobramycin', 'Tobramycin 0,3% (nhỏ mắt)', 'lọ', {}, { route: 'nho-mat', manual: true, classes: ['aminoglycoside'] }),
  d('ofloxacin', 'Ofloxacin 0,3% (nhỏ tai)', 'lọ', {}, { route: 'nho-tai', manual: true, classes: ['quinolone'] }),
];

const byCode = new Map(DRUGS.map((x) => [x.code, x]));
export const getDrug = (code: string): DrugEntry | undefined => byCode.get(code);
