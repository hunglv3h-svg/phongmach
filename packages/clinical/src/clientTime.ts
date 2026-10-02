// Giờ do máy khách gửi khi đồng bộ thao tác làm lúc mất mạng (kế hoạch, OFF-2 và OFF-3).
// Nguyên tắc: không bao giờ từ chối bản ghi vì giờ không hợp lý (bản ghi đã ký và đã in); chỉ không dùng giờ đó để đo và gắn cờ.

/** Độ lệch đồng hồ chấp nhận giữa máy khách và máy chủ. */
export const CLIENT_CLOCK_SKEW_MS = 5 * 60_000;
/** Phiên khám đo ở máy khách dài hơn mức này coi như giờ không hợp lý (khác ngưỡng 30 phút "bỏ dở" của số đo). */
export const MAX_CLIENT_VISIT_SECONDS = 12 * 3600;

/** Giờ máy khách dùng được làm mốc: hợp lệ và không ở tương lai quá độ lệch cho phép so với giờ máy chủ. */
export function plausibleClientTime(iso: string | undefined, now: Date): Date | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > now.getTime() + CLIENT_CLOCK_SKEW_MS) return undefined;
  return new Date(t);
}

export type VisitSecondsSource = 'server' | 'client' | 'client-invalid';

export interface VisitMeasure {
  /** Giờ ký ghi vào bản ghi (đơn, MedicationRequest, kết thúc lượt khám). */
  signedAt: Date;
  /** Thời gian phiên khám tính vào số đo; không có khi không đo được hoặc giờ không hợp lý. */
  seconds?: number;
  source: VisitSecondsSource;
}

/**
 * Đo một phiên khám lúc hoàn tất.
 * - Không có giờ máy khách: đo bằng giờ máy chủ (lúc mở hồ sơ máy chủ ghi → lúc nhận yêu cầu ký), như trước M0-S3.
 * - Có giờ máy khách (mở hoặc ký lúc mất mạng): thời lượng = ký − mở, cùng một đồng hồ nên độ lệch giờ triệt tiêu.
 *   Kiểm tra: không âm, không quá trần, giờ ký không ở tương lai, và nếu máy chủ đã thấy lúc mở thật thì không dài hơn
 *   khoảng máy chủ thấy (cộng độ lệch). Không hợp lý: vẫn ghi giờ ký của máy khách (đúng với tờ đã in), không tính số đo.
 */
export function measureVisit(input: {
  now: Date;
  /** Mốc mở hồ sơ đã ghi trên lượt khám và nguồn của nó. */
  opened?: { at: string; source: 'server' | 'client' } | undefined;
  client?: { openedAt: string; signedAt: string } | undefined;
}): VisitMeasure {
  const { now, opened, client } = input;
  if (!client) {
    if (!opened) return { signedAt: now, source: 'server' };
    // Mở bằng giờ máy khách mà ký lại không gửi giờ máy khách: hai đồng hồ khác nhau, không đo được.
    if (opened.source === 'client') return { signedAt: now, source: 'client-invalid' };
    return { signedAt: now, seconds: Math.max(0, Math.round((now.getTime() - Date.parse(opened.at)) / 1000)), source: 'server' };
  }
  const signed = Date.parse(client.signedAt);
  const open = Date.parse(client.openedAt);
  const signedAt = Number.isFinite(signed) ? new Date(signed) : now;
  const duration = (signed - open) / 1000;
  let valid = Number.isFinite(duration) && duration >= 0 && duration <= MAX_CLIENT_VISIT_SECONDS && signed <= now.getTime() + CLIENT_CLOCK_SKEW_MS;
  if (valid && opened?.source === 'server') {
    const seenByServer = (now.getTime() - Date.parse(opened.at)) / 1000;
    valid = duration <= seenByServer + CLIENT_CLOCK_SKEW_MS / 1000;
  }
  return valid ? { signedAt, seconds: Math.round(duration), source: 'client' } : { signedAt, source: 'client-invalid' };
}
