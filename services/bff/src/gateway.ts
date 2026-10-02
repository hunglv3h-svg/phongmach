import { createHash } from 'node:crypto';
import type { DiagnosisView, PrescriptionLineView } from '@phongmach/clinical';

/** Nội dung gửi lên cổng đơn thuốc quốc gia. Hình dạng thật phụ thuộc tài liệu API của cổng (TL34 Q1): đây là bản giả định cho M0. */
export interface GatewayPayload {
  localCode: string;
  issuedAt: string;
  doctorName: string;
  patient: { name: string; birthDate?: string; cccd?: string; gender?: string };
  diagnoses: DiagnosisView[];
  lines: PrescriptionLineView[];
  advice?: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    /** Lỗi tạm thời (mạng, cổng quá tải) thì thử lại; lỗi do nội dung đơn (400) thì thử lại cũng vô ích. */
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Giao diện bộ nối cổng đơn thuốc. Bộ nối thật (T-RX, GĐ 1) cài cùng giao diện này nên thay vào không đổi ứng dụng.
 * Gửi PHẢI idempotent theo `localCode`: gửi lại cùng một đơn trả về cùng một mã quốc gia (A2).
 */
export interface Gateway {
  submit(tenant: string, payload: GatewayPayload): Promise<{ nationalCode: string }>;
}

export interface SimulatorState {
  /** `up`: nhận đơn; `down`: mô phỏng cổng không phản hồi. */
  mode: 'up' | 'down';
  /** Số lần gửi kế tiếp sẽ bị lỗi rồi tự hết (để trình diễn "tự thử lại thành công"). */
  failNext: number;
  /** Số đơn đã nhận (không đếm gửi lặp). */
  accepted: number;
}

/** Cổng quốc gia MÔ PHỎNG, trạng thái tách riêng từng phòng khám để một phòng khám không ảnh hưởng phòng khám khác. */
export class SimulatedGateway implements Gateway {
  private readonly states = new Map<string, SimulatorState & { codes: Set<string> }>();

  private state(tenant: string) {
    let s = this.states.get(tenant);
    if (!s) {
      s = { mode: 'up', failNext: 0, accepted: 0, codes: new Set() };
      this.states.set(tenant, s);
    }
    return s;
  }

  get(tenant: string): SimulatorState {
    const { mode, failNext, accepted } = this.state(tenant);
    return { mode, failNext, accepted };
  }

  set(tenant: string, patch: Partial<Pick<SimulatorState, 'mode' | 'failNext'>>): SimulatorState {
    const s = this.state(tenant);
    if (patch.mode) s.mode = patch.mode;
    if (patch.failNext !== undefined) s.failNext = Math.max(0, Math.min(20, Math.trunc(patch.failNext)));
    return this.get(tenant);
  }

  async submit(tenant: string, payload: GatewayPayload): Promise<{ nationalCode: string }> {
    const s = this.state(tenant);
    if (s.mode === 'down') throw new GatewayError('Cổng đơn thuốc quốc gia (mô phỏng) không phản hồi', true);
    if (s.failNext > 0) {
      s.failNext -= 1;
      throw new GatewayError('Cổng đơn thuốc quốc gia (mô phỏng) trả lỗi tạm thời', true);
    }
    if (!payload.localCode || payload.lines.length === 0 || payload.diagnoses.length === 0) {
      throw new GatewayError('Đơn không hợp lệ: thiếu mã đơn, thuốc hoặc chẩn đoán', false);
    }
    // Mã xác định theo (phòng khám, mã đơn): gửi lặp trả về cùng một mã, đúng yêu cầu idempotent.
    const nationalCode = `SIM-${createHash('sha1').update(`${tenant}:${payload.localCode}`).digest('hex').slice(0, 10).toUpperCase()}`;
    if (!s.codes.has(nationalCode)) {
      s.codes.add(nationalCode);
      s.accepted += 1;
    }
    return { nationalCode };
  }
}
