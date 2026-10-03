import type { LineInput } from '@phongmach/catalogs';
import type { Specialty, VitalsInput } from '@phongmach/clinical';
import type { RuleId } from '@phongmach/rules';

/** Ghi trên từng phiếu ca và ở đầu mọi tệp sinh ra từ bộ ca. */
export const TRIAL_NOTICE = 'DỮ LIỆU MINH HỌA, CHƯA ĐƯỢC CỐ VẤN Y KHOA DUYỆT. Chỉ dùng để thử phần mềm, không phải hướng dẫn điều trị.';

/** Ngày dùng để ghi tuổi trên phiếu: giữa tuần thử dự kiến 02–06/11/2026 (kế hoạch, mục 5.5). */
export const TRIAL_REFERENCE_DAY = '2026-11-04';
/** Khoảng ngày mà bộ ca phải giữ đúng tình huống (tuổi của bệnh nhân không vượt các ngưỡng của quy tắc kê đơn). */
export const TRIAL_WINDOW = { from: '2026-10-05', to: '2027-03-31' } as const;

/** Tình huống của kịch bản mà một ca phủ (đề bài M0-THU). */
export type Scenario = 'don-mau' | 'di-ung' | 'trung-hoat-chat' | 'man-tinh-90' | 'thieu-can-nang' | 'ke-lai' | 'khong-don-mau';

export const SCENARIO_LABEL: Record<Scenario, string> = {
  'don-mau': 'Ca thường, dùng đơn mẫu',
  'di-ung': 'Có dị ứng thuốc đã ghi trong hồ sơ',
  'trung-hoat-chat': 'Trùng hoạt chất',
  'man-tinh-90': 'Bệnh mạn tính, đơn 90 ngày',
  'thieu-can-nang': 'Trẻ em chưa có cân nặng',
  'ke-lai': '"Kê lại" đơn của lượt khám cũ',
  'khong-don-mau': 'Không có đơn mẫu, kê từng thuốc',
};

/** Các tình huống đề bài yêu cầu bộ ca phải phủ. */
export const REQUIRED_SCENARIOS: readonly Scenario[] = ['don-mau', 'di-ung', 'trung-hoat-chat', 'man-tinh-90', 'thieu-can-nang', 'ke-lai'];

/** Lượt khám cũ nạp sẵn để có cái mà "kê lại". Do một bác sĩ khác (không phải ba bác sĩ thử) khám, cách đây hơn 90 ngày. */
export interface PriorVisit {
  daysAgo: number;
  reason: string;
  symptoms: string;
  findings: string;
  vitals: VitalsInput;
  dx: string[];
  lines: LineInput[];
  advice?: string;
  followUpDays?: number;
}

/**
 * Một thao tác trên màn hình khám. Chuỗi thao tác của một ca là ĐƯỜNG ĐI DÙNG TRONG DIỄN TẬP KỸ THUẬT (bài e2e bấm đúng như vậy),
 * không phải hướng dẫn điều trị: trong buổi thử, bác sĩ tự quyết định.
 */
export type Step =
  /** Gõ tắt chẩn đoán rồi Enter (chọn kết quả đầu). */
  | { do: 'dx'; query: string; code: string }
  | { do: 'template'; id: string }
  /** Bấm "Kê lại đơn này" ở lượt khám cũ gần nhất. */
  | { do: 'repeat' }
  /** Gõ tắt tên thuốc rồi Enter (chọn kết quả đầu). */
  | { do: 'add'; query: string; drug: string }
  | { do: 'remove'; drug: string }
  | { do: 'set'; drug: string; perDose?: string; timesPerDay?: string; days?: string; quantity?: string }
  /** Nhập cân nặng sau khi hỏi người nhà (phiếu điều dưỡng không có). */
  | { do: 'weight'; kg: string }
  /** Ở thời điểm này màn hình phải đang hiện cảnh báo thuộc quy tắc này. */
  | { do: 'expect'; rule: RuleId }
  /** Xác nhận cảnh báo kèm lý do (vẫn kê). */
  | { do: 'ack'; rule: RuleId; reason: string };

export interface FinalLine {
  drug: string;
  perDose?: number;
  timesPerDay?: number;
  days?: number;
  quantity?: number;
}

export interface TrialCase {
  /** N01…N12, P01…P12 là ca tính số đo; NL1…NL3, PL1…PL3 là ca làm quen. */
  id: string;
  specialty: Specialty;
  /** Ca làm quen: không tính vào số đo M0-1, bị loại khi xuất. */
  warmup: boolean;
  title: string;
  scenarios: Scenario[];
  patient: {
    fullName: string;
    gender: 'male' | 'female';
    /** YYYY-MM-DD */
    birthDate: string;
    /** Tuổi ghi trên phiếu, tính đến TRIAL_REFERENCE_DAY (có kiểm thử đối chiếu với ngày sinh). */
    ageLabel: string;
    /** Bệnh nhân từ 14 tuổi phải có CCCD mới ký được đơn (quy tắc 'no-cccd'). Số giả, tiền tố 000. */
    hasCccd: boolean;
  };
  /** Người đi cùng trẻ, là người nói chuyện với bác sĩ. */
  companion?: string;
  /** Lý do khám ghi lúc cấp số: hiện ở hàng chờ và điền sẵn vào ô "Lý do khám". */
  reason: string;
  /** Người đóng vai kể với bác sĩ. */
  story: string[];
  /** Chỉ nói khi bác sĩ hỏi. */
  ifAsked: string[];
  /** Sinh hiệu điều dưỡng đã đo, in trên phiếu để bác sĩ nhập. */
  vitals: VitalsInput;
  /** Kết quả khám, điều phối viên đọc khi bác sĩ khám. */
  findings: string;
  /** Có sẵn trong hồ sơ trên máy trước buổi thử. */
  allergies: Array<{ kind: 'class' | 'ingredient'; value: string; label?: string }>;
  history: string[];
  prior?: PriorVisit;
  steps: Step[];
  /** Đơn sau khi đi hết `steps`. Bài diễn tập so đơn máy chủ đã lưu với phần này. */
  final: { dx: string[]; lines: FinalLine[]; acks: RuleId[] };
  /** Ghi chú cho điều phối viên: ca này thử điều gì. */
  note: string;
}
