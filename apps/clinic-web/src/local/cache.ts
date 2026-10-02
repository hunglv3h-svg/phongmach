// Bộ đệm cho lúc mất mạng (kế hoạch, OFF-2 và OFF-4) và các hàm thuần dùng nó: tìm bệnh nhân trên máy, gộp hàng chờ của máy chủ
// với các thao tác chưa đồng bộ, cấp số tạm. Mọi bản ghi bộ đệm nằm trong kho mã hóa (`store.ts`), dạng rõ chỉ có id và ngày.
import { sortQueue, type AllergyView, type HistoryItem, type PrescriptionDetail, type QueueItem, type VisitSummary } from '@phongmach/clinical';
import { classifyQuery, digitsOnly, foldName, normalizePhone, rankByPhoneSuffix, type PatientSummary } from '@phongmach/fhir-vn-model';
import type { AnyOp, Op } from './ops';

/** Một bệnh nhân trong bộ đệm: người trong hàng chờ hôm nay, hồ sơ đã mở trong ngày, hoặc người tạo trên máy này. */
export interface CachedPatient {
  patient: PatientSummary;
  /** Không có: máy chưa có dữ liệu dị ứng của người này (mở hồ sơ khi mất mạng thì đòi xác nhận `allergy-unknown`). */
  allergies?: AllergyView[];
  /** Chỉ có khi hồ sơ đã được mở lúc có mạng trong ngày. */
  history?: HistoryItem[];
  previous?: VisitSummary[];
  /** Chỉ với bệnh nhân tạo trên máy này: CCCD đầy đủ (máy chủ chỉ trả CCCD đã che), để tìm được khi mất mạng. */
  cccd?: string;
}

/** Ảnh chụp hàng chờ hôm nay lần gần nhất tải được từ máy chủ. */
export interface QueueSnapshot {
  day: string;
  items: QueueItem[];
  fetchedAt: string;
}

/** Đơn ký khi mất mạng, giữ trên máy để in lại (kể cả trước khi đồng bộ). */
export interface SignedOffline {
  detail: PrescriptionDetail;
  clinicName: string;
  /** id mục hoàn tất trong hàng đợi (= clientUuid của bản nháp). */
  completeOpId: string;
}

/**
 * Tìm trong bộ đệm khi mất mạng, cùng cách hiểu ô tìm của máy chủ (`classifyQuery`): tên không dấu theo tiền tố từng từ,
 * số điện thoại, đoạn số (4 số cuối xếp trước). CCCD chỉ tìm được với người tạo trên máy này (bộ đệm khác chỉ có CCCD đã che).
 */
export function searchLocal(query: string, entries: CachedPatient[], limit = 20): PatientSummary[] {
  const intent = classifyQuery(query);
  let found: PatientSummary[];
  switch (intent.kind) {
    case 'empty':
      return [];
    case 'name':
      found = entries
        .filter((e) => {
          const words = foldName(e.patient.fullName).split(' ');
          return intent.tokens.every((t) => words.some((w) => w.startsWith(t)));
        })
        .map((e) => e.patient)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
      break;
    case 'phone':
      found = entries.filter((e) => e.patient.phone && normalizePhone(e.patient.phone) === intent.phone).map((e) => e.patient);
      break;
    case 'phone-fragment':
      found = rankByPhoneSuffix(
        entries.filter((e) => digitsOnly(e.patient.phone ?? '').includes(intent.digits)).map((e) => e.patient),
        intent.digits
      );
      break;
    case 'cccd':
      found = entries.filter((e) => e.cccd === intent.cccd).map((e) => e.patient);
      break;
  }
  return found.slice(0, limit);
}

/** Dòng hàng chờ trên máy: của máy chủ, hoặc dựng từ thao tác chưa đồng bộ. */
export interface LocalQueueItem extends QueueItem {
  local?: {
    /** Số tạm cấp khi mất mạng, máy chủ chưa xác nhận (hiện "007 (tạm)"). */
    tentative?: boolean;
    /** Có thao tác trên máy chưa đồng bộ cho lượt này (cấp số, mở hồ sơ, kết thúc khám). */
    pending?: boolean;
    /** Một thao tác của lượt này bị máy chủ từ chối vì xung đột hoặc cần xử lý (OFF-7). */
    attention?: boolean;
    /** Máy chủ đã cấp số khác số tạm (OFF-2). */
    renumbered?: { from: number; to: number };
  };
}

const ATTENTION = new Set(['conflict', 'rules', 'error']);

/**
 * Gộp hàng chờ của máy chủ với các thao tác trên máy (OFF-2, N3): người cấp số khi mất mạng hiện với số tạm, lượt đã mở
 * hoặc đã ký trên máy hiện đúng trạng thái dù máy chủ chưa biết. `ops` theo thứ tự hàng đợi, chỉ của hôm nay.
 */
export function mergeQueue(snapshot: QueueItem[], ops: AnyOp[], ids: Map<string, string>, me: { id: string; name: string }): LocalQueueItem[] {
  const items = new Map<string, LocalQueueItem>(snapshot.map((i) => [i.id, { ...i }]));
  const find = (visitId: string) => items.get(ids.get(visitId) ?? visitId) ?? items.get(visitId);
  const mark = (item: LocalQueueItem, op: AnyOp) => {
    const done = op.meta.status === 'done';
    item.local = { ...item.local, ...(done ? {} : { pending: true }), ...(ATTENTION.has(op.meta.status) ? { attention: true } : {}) };
  };

  for (const op of ops) {
    if (op.meta.kind === 'checkin') {
      const { body, display, visitTmpId } = (op as Op<'checkin'>).body.payload;
      const result = (op as Op<'checkin'>).body.result;
      const proposed = body.proposedNumber;
      const serverId = result?.item.id ?? (visitTmpId ? ids.get(visitTmpId) : undefined);
      const known = serverId ? items.get(serverId) : undefined;
      if (known || result) {
        const item = known ?? { ...result!.item };
        if (proposed !== undefined && item.number !== proposed) item.local = { ...item.local, renumbered: { from: proposed, to: item.number } };
        if (op.meta.status !== 'done') mark(item, op);
        items.set(item.id, item);
        continue;
      }
      const id = visitTmpId ?? op.id;
      const item: LocalQueueItem = {
        id,
        number: proposed ?? 0,
        code: '',
        status: 'waiting',
        priority: body.priority,
        specialty: body.specialty,
        patientId: body.patientId,
        patientName: display.patientName,
        ...(display.birthDate ? { birthDate: display.birthDate } : {}),
        arrivedAt: body.arrivedAt ?? new Date(op.meta.createdAt).toISOString(),
        ...(body.reason ? { reason: body.reason } : {}),
        local: { tentative: true },
      };
      mark(item, op);
      items.set(id, item);
    } else if (op.meta.kind === 'open') {
      const { visitId, openedAt } = (op as Op<'open'>).body.payload;
      const item = find(visitId);
      if (!item) continue;
      if (op.meta.status !== 'done' && item.status === 'waiting') {
        Object.assign(item, { status: 'in-exam', doctorUserId: me.id, doctorName: me.name, ...(openedAt ? { calledAt: openedAt } : {}) });
      }
      if (op.meta.status !== 'done') mark(item, op);
    } else if (op.meta.kind === 'complete') {
      const { visitId } = (op as Op<'complete'>).body.payload;
      const item = find(visitId);
      if (!item) continue;
      if (op.meta.status !== 'done') {
        if (item.status === 'waiting' || item.status === 'in-exam') item.status = 'done';
        mark(item, op);
      }
    }
  }
  return sortQueue([...items.values()]) as LocalQueueItem[];
}

/** Số tạm khi cấp số lúc mất mạng (OFF-2): số lớn nhất máy này biết trong ngày (của máy chủ và số tạm đã cấp) + 1. */
export function nextLocalNumber(items: QueueItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.number), 0) + 1;
}
