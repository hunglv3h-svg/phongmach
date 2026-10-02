/** Mọi dữ liệu trong gói này là MINH HỌA cho bản trình diễn M0, chưa duyệt y khoa, không dùng lâm sàng. */
export const CATALOG_NOTICE = 'Dữ liệu minh họa cho bản trình diễn: không phải danh mục chính thức, chưa được duyệt y khoa.';

export interface Icd10Entry {
  code: string;
  name: string;
  /** Bệnh mạn tính: cho phép kê đơn dài ngày hơn (quy tắc số ngày tối đa). Danh sách mẫu, chưa phải Phụ lục của Bộ Y tế. */
  chronic?: boolean;
}

export type Route = 'uong' | 'boi' | 'nho-mat' | 'nho-mui' | 'nho-tai' | 'xit' | 'khi-dung';

export interface DrugDefaults {
  /** Số đơn vị mỗi lần dùng. Để trống với thuốc phải tính theo cân nặng: bác sĩ tự nhập. */
  perDose?: number;
  timesPerDay?: number;
  days?: number;
  /** "sau ăn", "trước ăn", "buổi tối"… */
  timing?: string;
  /** Dùng khi cần (sốt, đau): số lượng do bác sĩ nhập, không tự tính. */
  asNeeded?: boolean;
}

export interface DrugEntry {
  code: string;
  /** Các hoạt chất đã chuẩn hóa (chữ thường, không dấu), dùng để phát hiện kê trùng hoạt chất. Thuốc phối hợp có nhiều hoạt chất. */
  ingredients: string[];
  name: string;
  unit: string;
  route: Route;
  /** Nhóm dùng để đối chiếu dị ứng: 'penicillin', 'cephalosporin', 'nsaid', 'sulfonamide'… */
  classes: string[];
  defaults: DrugDefaults;
  /** Dạng bào chế dành cho trẻ em (gói, siro). */
  paediatric?: boolean;
  /** Số lượng phải nhập tay (kem bôi, thuốc nhỏ, bình xịt, thuốc dùng khi cần). */
  manualQuantity?: boolean;
}

export interface TemplateLine {
  drug: string;
  perDose?: number;
  timesPerDay?: number;
  days?: number;
  quantity?: number;
  /** Ghi đè cách dùng sinh tự động. */
  instruction?: string;
}

export interface PrescriptionTemplate {
  id: string;
  name: string;
  /** Mã ICD-10 gợi ý khi chọn đơn mẫu. */
  icd10: string[];
  reason?: string;
  specialty: 'noi' | 'nhi';
  lines: TemplateLine[];
  advice?: string;
}
