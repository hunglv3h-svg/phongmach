// Danh sách "Chờ đồng bộ", thông báo và chỉ báo mạng (kế hoạch, N3, OFF-6, OFF-7). Toàn hàm thuần: nhận hàng đợi ĐÃ GIẢI MÃ trong bộ nhớ
// và trả về thứ để hiện. Không đọc, không ghi kho; tên bệnh nhân chỉ được giải mã để hiện, không bao giờ ra đĩa ở dạng rõ.
// Không có hàm nào ở đây bỏ hay sửa một mục: danh sách chỉ có hai thao tác, "Đồng bộ ngay" và "Xác nhận và gửi lại" (xem `SyncListActions`).
import { MIN_ACK_REASON_LENGTH, type Finding } from '@phongmach/rules';
import type { CompleteResponse, RulesRejected } from '../api';
import { pad3, vnClock } from '../format';
import type { LocalQueueItem, SignedOffline } from './cache';
import { depState } from './deps';
import type { AnyOp, Op, OpDisplay } from './ops';
import type { OpKind, OpStatus } from './store';
import type { SyncState } from './sync';

/** Những gì danh sách cần, đọc từ kho trên máy mỗi khi hàng đợi thay đổi (`sync.version`). */
export interface SyncData {
  /** Mọi mục trong hàng đợi, theo thứ tự (kể cả mục đã xong của hôm nay: thông báo đổi số, lệch mã đơn). */
  ops: AnyOp[];
  /** id tạm → id máy chủ. */
  ids: Map<string, string>;
  /** Hàng chờ hôm nay trên máy này (của máy chủ gộp với thao tác chưa đồng bộ): để biết số thứ tự và ai đang giữ lượt khám. */
  queue: LocalQueueItem[];
  /** Đơn ký khi mất mạng còn giữ trên máy, theo id tạm của đơn: in lại được. */
  signed: Map<string, SignedOffline>;
}

export interface ViewContext {
  now: number;
  /** id mục đang gửi (chỉ có ở tab đang giữ khóa đồng bộ). */
  sending?: string;
  online: boolean;
  paused: SyncState['paused'];
  /** id người đang đăng nhập: để không gọi chính mình là "người khác" khi báo xung đột. */
  me: string;
}

/** Trạng thái hiện ở danh sách. `done` không có ở đây: mục đã xong không nằm trong danh sách chờ. */
export type RowStatus = 'pending' | 'sending' | 'waiting' | 'retry' | 'conflict' | 'rules' | 'error' | 'held';

export interface SyncRow {
  /** id mục, cũng là `clientUuid` gửi lên máy chủ. */
  id: string;
  kind: OpKind;
  kindLabel: string;
  patientName?: string;
  /** Số thứ tự của lượt khám; `tentative`: số tạm, máy chủ chưa xác nhận. */
  number?: number;
  tentative?: boolean;
  /** Mã đơn (đã in). */
  code?: string;
  /** Cách gọi mục này ở dòng khác ("bị giữ vì mục …"). */
  label: string;
  status: RowStatus;
  statusLabel: string;
  /** Cần người xử lý, hoặc bị một mục như vậy giữ lại: được tính vào huy hiệu. */
  attention: boolean;
  /** Mục mà mục này đang chờ (`waiting`) hoặc bị giữ vì nó (`held`). */
  blockedBy?: { id: string; label: string };
  /** Lỗi tạm: lần gửi lại kế tiếp và số lần đã gửi. */
  retry?: { at: number; attempts: number };
  /** Thông điệp lỗi gần nhất của máy chủ (nguyên văn). */
  error?: { status: number; code: string; message: string };
  /** 409 ở mục mở hồ sơ hoặc hoàn tất: câu báo của OFF-7. */
  conflict?: string;
  /** 422 `rules-not-satisfied`: phát hiện của máy chủ. Có `blocking` thì không xác nhận được. */
  rules?: { unacknowledged: Finding[]; blocking: Finding[] };
  /** In lại được từ dữ liệu trên máy: id tạm của đơn. */
  reprint?: string;
}

const KIND_LABEL: Record<OpKind, string> = {
  patient: 'Tạo bệnh nhân',
  checkin: 'Cấp số',
  open: 'Mở hồ sơ khám',
  complete: 'Ký đơn',
  printed: 'Ghi nhận in đơn',
};

const BLOCKER_PHRASE: Partial<Record<OpStatus, string>> = { conflict: 'đang xung đột', rules: 'đang chờ bác sĩ xác nhận', error: 'cần xử lý' };

function kindLabel(op: AnyOp): string {
  if (op.meta.kind === 'complete' && !(op as Op<'complete'>).body.payload.body.prescription) return 'Kết thúc khám (không kê đơn)';
  return KIND_LABEL[op.meta.kind];
}

interface Who extends OpDisplay {
  tentative?: boolean;
  /** Người đang giữ lượt khám theo máy chủ (khi khác người đang đăng nhập). */
  holder?: string;
  rxTmpId?: string;
}

/** Tên, số thứ tự, mã đơn của một mục: từ nhãn của chính nó, không có thì tra qua hàng chờ trên máy và đơn đã ký. */
function describe(op: AnyOp, data: SyncData, me: string): Who {
  const visitOf = (visitId: string): LocalQueueItem | undefined => data.queue.find((i) => i.id === (data.ids.get(visitId) ?? visitId)) ?? data.queue.find((i) => i.id === visitId);
  const fromVisit = (visitId: string, display: OpDisplay | undefined): Who => {
    const v = visitOf(visitId);
    const patientName = display?.patientName ?? v?.patientName;
    const number = v?.number ?? display?.number;
    return {
      ...(patientName ? { patientName } : {}),
      ...(number ? { number } : {}),
      ...(v?.local?.tentative ? { tentative: true } : {}),
      ...(v?.doctorName && v.doctorUserId !== me ? { holder: v.doctorName } : {}),
    };
  };
  switch (op.meta.kind) {
    case 'patient':
      return { patientName: (op as Op<'patient'>).body.payload.input.fullName };
    case 'checkin': {
      const p = (op as Op<'checkin'>).body.payload;
      return { patientName: p.display.patientName, ...(p.body.proposedNumber !== undefined ? { number: p.body.proposedNumber, tentative: true } : {}) };
    }
    case 'open': {
      const p = (op as Op<'open'>).body.payload;
      return fromVisit(p.visitId, p.display);
    }
    case 'complete': {
      const p = (op as Op<'complete'>).body.payload;
      const signed = p.rxTmpId ? data.signed.get(p.rxTmpId) : undefined;
      const code = p.display?.code ?? signed?.detail.prescription.code;
      const who = fromVisit(p.visitId, p.display);
      return { ...who, ...(who.patientName ? {} : signed ? { patientName: signed.detail.patient.fullName } : {}), ...(code ? { code } : {}), ...(signed && p.rxTmpId ? { rxTmpId: p.rxTmpId } : {}) };
    }
    case 'printed': {
      const p = (op as Op<'printed'>).body.payload;
      const signed = data.signed.get(p.prescriptionId);
      const patientName = p.display?.patientName ?? signed?.detail.patient.fullName;
      const code = p.display?.code ?? signed?.detail.prescription.code;
      return { ...(patientName ? { patientName } : {}), ...(p.display?.number ? { number: p.display.number } : {}), ...(code ? { code } : {}) };
    }
  }
}

function labelOf(op: AnyOp, who: Who): string {
  return [kindLabel(op), who.patientName, who.number ? `số ${pad3(who.number)}${who.tentative ? ' (tạm)' : ''}` : undefined, who.code].filter(Boolean).join(' · ');
}

/**
 * Câu báo xung đột của OFF-7. `who`: tên người đã mở hoặc kết thúc lượt khám, nếu máy chủ cho biết.
 * Không gửi lại, không ghi đè: bản khám vẫn giữ trên máy.
 */
export function conflictText(number: number | undefined, who: string | undefined): string {
  return `Lượt khám ${number ? `${pad3(number)} ` : ''}đã do ${who ?? 'người khác'} mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống.`;
}

/** Tên người đang giữ hồ sơ trong thông điệp 409 `taken` của máy chủ ("Hồ sơ đang do BS. B khám"), nếu có. */
export function holderFromMessage(message: string | undefined): string | undefined {
  const name = /đang do (.+) khám/.exec(message ?? '')?.[1]?.trim();
  return name && name !== 'người khác' ? name : undefined;
}

/**
 * Thứ tự hiện: theo thứ tự hàng đợi, nhưng mục trước luôn đứng trên mục phụ thuộc nó. (Mục ghi nhận in được xếp vào hàng đợi
 * trước mục ký của chính nó vì hai mục ghi trong cùng một giao dịch; bộ máy gửi theo phụ thuộc nên thứ tự đó không sai, chỉ khó đọc.)
 */
function displayOrder(ops: AnyOp[]): AnyOp[] {
  const byId = new Map(ops.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: AnyOp[] = [];
  const place = (op: AnyOp): void => {
    if (seen.has(op.id)) return;
    seen.add(op.id);
    for (const dep of op.meta.deps) {
      const before = byId.get(dep);
      if (before) place(before);
    }
    out.push(op);
  };
  for (const op of [...ops].sort((a, b) => a.meta.seq - b.meta.seq)) place(op);
  return out;
}

/**
 * Dựng các dòng của danh sách "Chờ đồng bộ": mọi mục chưa xong, theo thứ tự hàng đợi (mục trước đứng trên mục phụ thuộc nó).
 * Mục cần xử lý (409, 422, lỗi khác) và mục bị chúng giữ luôn có mặt: không có đầu vào nào làm chúng biến mất ngoài việc máy chủ nhận.
 */
export function buildSyncRows(data: SyncData, ctx: ViewContext): SyncRow[] {
  const byId = new Map(data.ops.map((o) => [o.id, o]));
  const whoOf = new Map(data.ops.map((o) => [o.id, describe(o, data, ctx.me)]));
  const label = (id: string): string => {
    const op = byId.get(id);
    return op ? labelOf(op, whoOf.get(id)!) : 'mục trước';
  };

  return displayOrder(data.ops.filter((o) => o.meta.status !== 'done')).map((op): SyncRow => {
      const who = whoOf.get(op.id)!;
      const { status: stored, attempts, nextAt } = op.meta;
      const err = op.body.error;
      const base = {
        id: op.id,
        kind: op.meta.kind,
        kindLabel: kindLabel(op),
        ...(who.patientName ? { patientName: who.patientName } : {}),
        ...(who.number ? { number: who.number } : {}),
        ...(who.tentative ? { tentative: true } : {}),
        ...(who.code ? { code: who.code } : {}),
        label: labelOf(op, who),
        ...(err ? { error: { status: err.status, code: err.code, message: err.message } } : {}),
        ...(who.rxTmpId ? { reprint: who.rxTmpId } : {}),
      };

      if (stored === 'conflict') {
        const visit = op.meta.kind === 'open' || op.meta.kind === 'complete';
        return { ...base, status: 'conflict', statusLabel: 'Xung đột', attention: true, ...(visit ? { conflict: conflictText(who.number, who.holder ?? holderFromMessage(err?.message)) } : {}) };
      }
      if (stored === 'rules') {
        const body = err?.body as Partial<RulesRejected> | undefined;
        return { ...base, status: 'rules', statusLabel: 'Chờ bác sĩ xác nhận', attention: true, rules: { unacknowledged: body?.unacknowledged ?? [], blocking: body?.blocking ?? [] } };
      }
      if (stored === 'error') return { ...base, status: 'error', statusLabel: 'Cần xử lý', attention: true };

      const dep = depState(op, byId);
      if (dep.kind === 'held') {
        const phrase = BLOCKER_PHRASE[byId.get(dep.by)!.meta.status] ?? 'cần xử lý';
        return { ...base, status: 'held', statusLabel: `Bị giữ: mục «${label(dep.by)}» ${phrase}`, attention: true, blockedBy: { id: dep.by, label: label(dep.by) } };
      }
      if (ctx.sending === op.id) return { ...base, status: 'sending', statusLabel: 'Đang gửi…', attention: false };
      if (dep.kind === 'waiting') return { ...base, status: 'waiting', statusLabel: `Chờ mục trước: «${label(dep.on)}»`, attention: false, blockedBy: { id: dep.on, label: label(dep.on) } };
      if (stored === 'retry' && nextAt > ctx.now && ctx.online && !ctx.paused) {
        return { ...base, status: 'retry', statusLabel: `Thử lại lúc ${vnClock(nextAt, true)} (lần gửi thứ ${attempts + 1})`, attention: false, retry: { at: nextAt, attempts } };
      }
      const waitingFor = ctx.paused === 'unauthorized' ? 'Chờ đăng nhập lại' : ctx.paused === 'owner' ? 'Chờ đúng người đăng nhập' : !ctx.online ? 'Chờ có mạng' : 'Chờ gửi';
      return { ...base, status: 'pending', statusLabel: attempts > 0 ? `${waitingFor} (đã gửi ${attempts} lần chưa được)` : waitingFor, attention: false, ...(stored === 'retry' ? { retry: { at: nextAt, attempts } } : {}) };
    });
}

/**
 * Lý do xác nhận cho các phát hiện của máy chủ (422): đủ thì trả danh sách để gửi lại, còn thiếu thì undefined.
 * Mỗi phát hiện một lý do, ít nhất `MIN_ACK_REASON_LENGTH` ký tự (máy chủ kiểm lại đúng như vậy).
 */
export function ackList(findings: Finding[], reasons: Record<string, string>): Array<{ key: string; reason: string }> | undefined {
  const acks = findings.map((f) => ({ key: f.key, reason: (reasons[f.key] ?? '').trim() }));
  return acks.length > 0 && acks.every((a) => a.reason.length >= MIN_ACK_REASON_LENGTH) ? acks : undefined;
}

// ------------------------------------------------------------------------------------------------- thông báo (N3)

export type NoticeKind = 'conflict' | 'rules' | 'error' | 'renumbered' | 'code-mismatch';

export interface SyncNotice {
  /** Ổn định theo sự việc: một sự việc chỉ báo một lần, tắt rồi thì không hiện lại; mục bị từ chối lần nữa là sự việc mới. */
  id: string;
  kind: NoticeKind;
  opId: string;
  text: string;
}

/**
 * Thông báo không âm thầm: một mục vừa chuyển sang xung đột, chờ xác nhận hoặc cần xử lý; máy chủ đổi số tạm;
 * mã đơn trên máy chủ khác mã đã in. Mục bị giữ không có thông báo riêng (nó là hệ quả của mục đang cần xử lý).
 */
export function buildNotices(data: SyncData, ctx: Pick<ViewContext, 'me'>): SyncNotice[] {
  const out: SyncNotice[] = [];
  for (const op of displayOrder(data.ops)) {
    const who = describe(op, data, ctx.me);
    const label = labelOf(op, who);
    const err = op.body.error;
    const id = (kind: NoticeKind) => `${kind}:${op.id}:${op.updatedAt}`;
    if (op.meta.status === 'conflict') {
      const visit = op.meta.kind === 'open' || op.meta.kind === 'complete';
      const text = visit ? `${conflictText(who.number, who.holder ?? holderFromMessage(err?.message))} Bản khám vẫn giữ trên máy này.` : `Xung đột ở mục «${label}»: ${err?.message ?? 'máy chủ từ chối'}`;
      out.push({ id: id('conflict'), kind: 'conflict', opId: op.id, text });
    } else if (op.meta.status === 'rules') {
      const what = ['Đơn', who.code, who.patientName ? `của ${who.patientName}` : undefined].filter(Boolean).join(' ');
      out.push({ id: id('rules'), kind: 'rules', opId: op.id, text: `${what} đã in nhưng CHƯA lưu lên máy chủ: máy chủ kiểm tra lại và cần bác sĩ xác nhận. Mở "Chờ đồng bộ" để xem cảnh báo.` });
    } else if (op.meta.status === 'error') {
      out.push({ id: id('error'), kind: 'error', opId: op.id, text: `Máy chủ từ chối mục «${label}»: ${err?.message ?? 'lỗi không rõ'}` });
    } else if (op.meta.status === 'done' && op.meta.kind === 'checkin') {
      const { body } = op as Op<'checkin'>;
      const from = body.payload.body.proposedNumber;
      const to = body.result?.item.number;
      if (from !== undefined && to !== undefined && from !== to) {
        out.push({ id: `renumbered:${op.id}`, kind: 'renumbered', opId: op.id, text: `Số ${pad3(from)} (cấp khi mất mạng) của ${body.payload.display.patientName} đã đổi thành ${pad3(to)}: máy khác đã cấp số đó trước.` });
      }
    } else if (op.meta.status === 'done' && op.meta.kind === 'complete') {
      const { body } = op as Op<'complete'>;
      const printed = body.payload.display?.code ?? (body.payload.rxTmpId ? data.signed.get(body.payload.rxTmpId)?.detail.prescription.code : undefined);
      const server = (body.result as CompleteResponse | undefined)?.prescription?.code;
      if (body.payload.rxTmpId && printed && server && printed !== server) {
        out.push({ id: `code-mismatch:${op.id}`, kind: 'code-mismatch', opId: op.id, text: `Mã đơn trên máy chủ (${server}) khác mã đã in (${printed})${who.patientName ? ` của ${who.patientName}` : ''}: hãy in lại đơn.` });
      }
    }
  }
  return out;
}

/** Thông báo còn hiện: bỏ những cái người dùng đã tắt. Tắt thông báo không đụng tới hàng đợi và không đụng tới huy hiệu. */
export function visibleNotices(notices: SyncNotice[], dismissed: ReadonlySet<string>): SyncNotice[] {
  return notices.filter((n) => !dismissed.has(n.id));
}

// ------------------------------------------------------------------------------------------------- chỉ báo

export interface IndicatorView {
  online: boolean;
  /** Số mục chờ; undefined khi chưa đếm xong (không bao giờ hiện "0" trước lần đếm đầu). */
  pending: number | undefined;
  attention: number;
  sending: boolean;
  /** "Đang đếm mục chờ…", "Đã đồng bộ hết", "3 mục chờ đồng bộ". */
  summary: string;
  /** Hết phiên (401): "Phiên đã hết hạn: đăng nhập lại để đồng bộ N mục". */
  expired?: string;
  /** "Gửi lần cuối 14:32". */
  lastSync?: string;
}

/** Câu báo hết phiên (OFF-6), dùng cho cả chỉ báo và màn hình đăng nhập. `pending` undefined: chưa đếm xong. */
export function expiredText(pending: number | undefined): string {
  if (pending === undefined) return 'Phiên đã hết hạn: đăng nhập lại để đồng bộ các mục còn trên máy này';
  return pending > 0 ? `Phiên đã hết hạn: đăng nhập lại để đồng bộ ${pending} mục` : 'Phiên đã hết hạn: đăng nhập lại';
}

export function indicatorView(sync: SyncState, online: boolean): IndicatorView {
  const pending = sync.counted ? sync.pending : undefined;
  return {
    online,
    pending,
    attention: sync.counted ? sync.attention : 0,
    sending: sync.sending !== undefined,
    summary: pending === undefined ? 'Đang đếm mục chờ…' : pending === 0 ? 'Đã đồng bộ hết' : `${pending} mục chờ đồng bộ`,
    ...(sync.paused === 'unauthorized' ? { expired: expiredText(pending) } : {}),
    ...(sync.lastSyncAt ? { lastSync: `Gửi lần cuối ${vnClock(sync.lastSyncAt)}` } : {}),
  };
}

// ------------------------------------------------------------------------------------------------- toàn cảnh

export interface SyncOverview {
  view: IndicatorView;
  /** undefined: chưa đọc xong kho trên máy. */
  rows: SyncRow[] | undefined;
  /** Thông báo chưa tắt. */
  notices: SyncNotice[];
}

/**
 * Những gì thanh trên và danh sách hiện ra. `dismissed` (thông báo đã tắt) CHỈ lọc thông báo: chỉ báo, huy hiệu "cần xử lý" và các dòng
 * của danh sách tính từ hàng đợi, không phụ thuộc việc người dùng đã tắt thông báo hay chưa (N3).
 */
export function overviewOf(data: SyncData | undefined, sync: SyncState, online: boolean, me: string, dismissed: ReadonlySet<string>, now: number): SyncOverview {
  const ctx: ViewContext = { now, online, paused: sync.paused, me, ...(sync.sending ? { sending: sync.sending } : {}) };
  return {
    view: indicatorView(sync, online),
    rows: data && buildSyncRows(data, ctx),
    notices: data ? visibleNotices(buildNotices(data, ctx), dismissed) : [],
  };
}
