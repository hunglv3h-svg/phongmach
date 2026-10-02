// Trạng thái phụ thuộc của một mục trong hàng đợi đồng bộ (kế hoạch, OFF-7): mục trước xong hết thì gửi được, có mục trước đang
// cần người xử lý thì bị giữ, còn lại thì chờ. Hàm thuần, dùng chung cho bộ máy đồng bộ, danh sách chờ đồng bộ và màn hình kết quả ký,
// để ba nơi không bao giờ hiểu khác nhau về "bị giữ".
import type { OpMeta, OpStatus } from './store';

/** Trạng thái cần người xử lý: xung đột (409), quy tắc kê đơn (422), lỗi khác. Không tự gửi lại, không tự bỏ (N3). */
export const ATTENTION: ReadonlySet<OpStatus> = new Set<OpStatus>(['conflict', 'rules', 'error']);
export const needsAttention = (status: OpStatus): boolean => ATTENTION.has(status);

export type DepState =
  | { kind: 'ready' }
  /** Còn mục trước chưa xong (đang chờ gửi hoặc thử lại): `on` là mục gần nhất trong chuỗi. */
  | { kind: 'waiting'; on: string }
  /** Một mục trước (trực tiếp hoặc qua nhiều bậc) đang cần người xử lý: `by` là chính mục đó. */
  | { kind: 'held'; by: string };

interface DepNode {
  meta: Pick<OpMeta, 'deps' | 'status'>;
}

/** Mục không còn trong kho là đã xong và đã được dọn. */
export function depState(op: DepNode, byId: ReadonlyMap<string, DepNode>, seen = new Set<string>()): DepState {
  let waiting: string | undefined;
  for (const depId of op.meta.deps) {
    const dep = byId.get(depId);
    if (!dep || dep.meta.status === 'done' || seen.has(depId)) continue;
    if (needsAttention(dep.meta.status)) return { kind: 'held', by: depId };
    seen.add(depId);
    const inner = depState(dep, byId, seen);
    if (inner.kind === 'held') return inner;
    waiting ??= depId;
  }
  return waiting ? { kind: 'waiting', on: waiting } : { kind: 'ready' };
}
