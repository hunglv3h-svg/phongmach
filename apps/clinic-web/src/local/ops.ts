// Các loại thao tác trong hàng đợi đồng bộ (kế hoạch, N1, N2, N4, OFF-7): dữ liệu gửi đi, cách gửi, id tạm và việc làm sau khi máy chủ nhận.
import type { QueueItem, VisitContext } from '@phongmach/clinical';
import type { PatientSummary } from '@phongmach/fhir-vn-model';
import { api, type CheckInRequest, type CompleteRequest, type CompleteResponse, type NewPatient } from '../api';
import type { CachedPatient } from './cache';
import type { Change, LocalStore, OpKind, OpMeta } from './store';

/** id tạm của bản ghi tạo trên máy khi chưa có id máy chủ (bệnh nhân, lượt khám, đơn). Không bao giờ được gửi lên máy chủ. */
export const TMP_PREFIX = 'tmp-';
export const newTmpId = (): string => `${TMP_PREFIX}${crypto.randomUUID()}`;
export const isTmp = (id: string | undefined): boolean => !!id?.startsWith(TMP_PREFIX);

/**
 * Nhãn để hiện một mục trong danh sách chờ đồng bộ (tên bệnh nhân, số thứ tự, mã đơn) mà không phải tra ngược qua mục khác.
 * Nằm trong phần mã hóa của mục, và KHÔNG được gửi lên máy chủ (`send` chỉ gửi các trường của yêu cầu).
 */
export interface OpDisplay {
  patientName?: string;
  number?: number;
  code?: string;
}

export interface Payloads {
  /** Tạo bệnh nhân; `tmpId` là id dùng trên máy cho tới khi máy chủ trả id thật. */
  patient: { tmpId: string; input: NewPatient };
  /** Cấp số. `display`: tên và ngày sinh để hiện hàng chờ trên máy khi chưa đồng bộ. */
  checkin: { visitTmpId?: string; body: CheckInRequest; display: { patientName: string; birthDate?: string } };
  /** Mở hồ sơ (gọi vào khám). `openedAt` chỉ có khi mở lúc mất mạng. */
  open: { visitId: string; openedAt?: string; display?: OpDisplay };
  /** Hoàn tất lượt khám (ký đơn hoặc kết thúc không kê đơn). `rxTmpId`: id tạm của đơn đã in khi mất mạng. */
  complete: { visitId: string; rxTmpId?: string; body: CompleteRequest; display?: OpDisplay };
  /** Ghi nhật ký một lần in làm lúc mất mạng. */
  printed: { prescriptionId: string; printedAt: string; display?: OpDisplay };
}

export interface Results {
  patient: { patient: PatientSummary; created: boolean };
  checkin: { item: QueueItem; created: boolean };
  open: VisitContext;
  complete: CompleteResponse;
  printed: { ok: true };
}

export interface OpError {
  status: number;
  code: string;
  message: string;
  /** Nội dung phản hồi lỗi (ví dụ danh sách phát hiện của quy tắc khi 422). */
  body?: unknown;
}

/** Phần mã hóa của một mục: dữ liệu gửi đi, kết quả của máy chủ, lỗi gần nhất. */
export interface OpBody<K extends OpKind = OpKind> {
  payload: Payloads[K];
  result?: Results[K];
  error?: OpError;
}

export type Op<K extends OpKind = OpKind> = { id: string; meta: OpMeta & { kind: K }; body: OpBody<K>; updatedAt: number };
export type AnyOp = { [K in OpKind]: Op<K> }[OpKind];

/** Mục mới cho `SyncEngine.enqueue`. */
export type NewOp = { [K in OpKind]: { id: string; kind: K; deps?: string[]; payload: Payloads[K] } }[OpKind];

const mapped = (id: string, ids: Map<string, string>): string | undefined => (isTmp(id) ? ids.get(id) : id);

/**
 * Thay id tạm bằng id máy chủ ngay trước khi gửi. Còn id tạm chưa có ánh xạ (mục tạo ra nó chưa xong) thì trả undefined:
 * mục này chưa gửi được.
 */
export function resolveIds(op: AnyOp, ids: Map<string, string>): Payloads[OpKind] | undefined {
  switch (op.meta.kind) {
    case 'patient':
      return op.body.payload;
    case 'checkin': {
      const p = (op as Op<'checkin'>).body.payload;
      const patientId = mapped(p.body.patientId, ids);
      return patientId ? { ...p, body: { ...p.body, patientId } } : undefined;
    }
    case 'open': {
      const p = (op as Op<'open'>).body.payload;
      const visitId = mapped(p.visitId, ids);
      return visitId ? { ...p, visitId } : undefined;
    }
    case 'complete': {
      const p = (op as Op<'complete'>).body.payload;
      const visitId = mapped(p.visitId, ids);
      return visitId ? { ...p, visitId } : undefined;
    }
    case 'printed': {
      const p = (op as Op<'printed'>).body.payload;
      const prescriptionId = mapped(p.prescriptionId, ids);
      return prescriptionId ? { ...p, prescriptionId } : undefined;
    }
  }
}

/** Gửi một mục (payload đã thay id). Lỗi là `ApiError` của `api.ts`; bộ máy đồng bộ phân loại theo OFF-7. */
export function send(kind: OpKind, payload: Payloads[OpKind], token: string): Promise<Results[OpKind]> {
  switch (kind) {
    case 'patient':
      return api.createPatient(token, (payload as Payloads['patient']).input);
    case 'checkin':
      return api.checkIn(token, (payload as Payloads['checkin']).body);
    case 'open': {
      const p = payload as Payloads['open'];
      return api.openVisit(token, p.visitId, p.openedAt ? { openedAt: p.openedAt } : undefined);
    }
    case 'complete': {
      const p = payload as Payloads['complete'];
      return api.completeVisit(token, p.visitId, p.body);
    }
    case 'printed': {
      const p = payload as Payloads['printed'];
      return api.printed(token, p.prescriptionId, { printedAt: p.printedAt });
    }
  }
}

/**
 * Việc làm trên máy khi máy chủ đã nhận một mục, ghi cùng giao dịch với trạng thái "xong" của mục:
 * ánh xạ id tạm → id máy chủ, chuyển bộ đệm bệnh nhân sang id thật, lưu ngữ cảnh hồ sơ vừa mở, xóa bản nháp của lượt đã ký.
 */
export async function effectsOf(
  op: AnyOp,
  payload: Payloads[OpKind],
  result: Results[OpKind],
  ctx: { store: LocalStore; ids: Map<string, string>; day: string }
): Promise<Change[]> {
  const { store, ids, day } = ctx;
  switch (op.meta.kind) {
    case 'patient': {
      const { tmpId } = payload as Payloads['patient'];
      const { patient } = result as Results['patient'];
      const changes: Change[] = [{ table: 'ids', id: tmpId, serverId: patient.id, day }];
      const cached = await store.get<'patients', CachedPatient>('patients', tmpId);
      if (cached) {
        changes.push({ table: 'patients', id: patient.id, plain: cached.plain, value: { ...cached.value, patient: { ...cached.value.patient, id: patient.id } } });
        changes.push({ table: 'patients', id: tmpId, delete: true });
      }
      return changes;
    }
    case 'checkin': {
      const { visitTmpId } = payload as Payloads['checkin'];
      const { item } = result as Results['checkin'];
      return visitTmpId ? [{ table: 'ids', id: visitTmpId, serverId: item.id, day }] : [];
    }
    case 'open': {
      const context = result as Results['open'];
      const cached = await store.get<'patients', CachedPatient>('patients', context.patient.id);
      const value: CachedPatient = { ...cached?.value, patient: context.patient, allergies: context.allergies, history: context.history, previous: context.previous };
      return [{ table: 'patients', id: context.patient.id, plain: { day }, value }];
    }
    case 'complete': {
      const p = payload as Payloads['complete'];
      const { prescription } = result as Results['complete'];
      const original = (op as Op<'complete'>).body.payload.visitId;
      // Bản nháp của lượt này có thể nằm dưới id máy chủ hoặc id tạm (mở khi mất mạng rồi đồng bộ): xóa hết.
      const visitIds = new Set([original, p.visitId, ...[...ids].filter(([, server]) => server === p.visitId).map(([tmp]) => tmp)]);
      const changes: Change[] = [...visitIds].map((id) => ({ table: 'drafts' as const, id, delete: true as const }));
      if (p.rxTmpId && prescription) changes.push({ table: 'ids', id: p.rxTmpId, serverId: prescription.id, day });
      return changes;
    }
    case 'printed':
      return [];
  }
}
