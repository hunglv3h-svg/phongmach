import { MIN_ACK_REASON_LENGTH } from '@phongmach/rules';
import { useState } from 'react';
import { pad3 } from '../format';
import type { SyncListActions } from '../local/syncActions';
import { ackList, type IndicatorView, type RowStatus, type SyncNotice, type SyncRow } from '../local/syncList';

const SHORT: Record<RowStatus, string> = {
  pending: 'Chờ gửi',
  sending: 'Đang gửi',
  waiting: 'Chờ mục trước',
  retry: 'Thử lại',
  conflict: 'Xung đột',
  rules: 'Chờ bác sĩ xác nhận',
  error: 'Cần xử lý',
  held: 'Bị giữ',
};

/** Thao tác của danh sách: chỉ ba việc trong `SyncListActions`. Không có việc bỏ hay sửa mục. */
type Actions = Pick<SyncListActions, 'acknowledge' | 'reprint'>;

function Row({ row, actions }: { row: SyncRow; actions: Actions }) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [reprinted, setReprinted] = useState(false);
  const tone = row.attention ? 'bad' : row.status === 'sending' ? 'ok' : 'warn';
  const who = [
    row.patientName ?? 'Không rõ bệnh nhân',
    row.number ? `số ${pad3(row.number)}${row.tentative ? ' (tạm)' : ''}` : undefined,
    row.code ? `mã đơn ${row.code}` : undefined,
  ].filter(Boolean);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setFailed(undefined);
    try {
      await fn();
      after?.();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canAck = row.rules && row.rules.blocking.length === 0 && row.rules.unacknowledged.length > 0;
  return (
    <li className={`sync-row ${row.attention ? 'attention' : ''}`} data-testid="sync-row" data-kind={row.kind} data-status={row.status} data-op={row.id}>
      <div className="sync-row-head">
        <strong>{row.kindLabel}</strong>
        <span className={`badge ${tone}`} data-testid="sync-row-status">{SHORT[row.status]}</span>
      </div>
      <div className="sync-row-who">{who.join(' · ')}</div>
      {row.statusLabel !== SHORT[row.status] && <p className={`small ${row.attention ? 'error' : 'muted'}`} data-testid="sync-row-state">{row.statusLabel}</p>}
      {row.conflict && (
        <p className="error" role="alert" data-testid="sync-row-conflict">
          {row.conflict} Bản khám vẫn giữ trên máy này và in lại được. Bản này chưa có chức năng giải quyết xung đột: báo chủ phòng khám.
        </p>
      )}
      {row.rules && (
        <div className="sync-rules" role="alert" data-testid="sync-row-rules">
          <p className="error">Máy chủ kiểm tra lại và cần bác sĩ xác nhận trước khi lưu đơn (đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc):</p>
          <ul>
            {row.rules.blocking.map((f) => (
              <li key={f.key} className="error" data-testid="sync-finding" data-rule={f.rule} data-severity={f.severity}><b>Không thể lưu:</b> {f.message}</li>
            ))}
            {row.rules.unacknowledged.map((f) => (
              <li key={f.key} data-testid="sync-finding" data-rule={f.rule} data-severity={f.severity}>
                <span className="error">{f.message}</span>
                {canAck && (
                  <label className="ack">
                    <span>Lý do vẫn giữ đơn (ít nhất {MIN_ACK_REASON_LENGTH} ký tự)</span>
                    <input value={reasons[f.key] ?? ''} onChange={(e) => setReasons({ ...reasons, [f.key]: e.target.value })} placeholder="Ví dụ: đã gọi bệnh nhân, đã dùng nhiều lần không phản ứng" data-testid="sync-ack-reason" />
                  </label>
                )}
              </li>
            ))}
          </ul>
          {canAck ? (
            <button className="primary" disabled={busy || !ackList(row.rules.unacknowledged, reasons)} onClick={() => void run(() => actions.acknowledge(row, reasons))} data-testid="sync-ack-submit">
              {busy ? 'Đang gửi…' : 'Xác nhận và gửi lại'}
            </button>
          ) : (
            <p className="error small">Đơn này không gửi lại được bằng cách xác nhận. Liên hệ bệnh nhân và kê lại đơn; bản khám vẫn giữ trên máy này.</p>
          )}
        </div>
      )}
      {/* 422 quy tắc kê đơn: các phát hiện ở trên chính là câu trả lời của máy chủ. */}
      {row.error && !row.rules && (
        <p className="small sync-row-error" data-testid="sync-row-error">
          Máy chủ trả lời gần nhất ({row.error.status > 0 ? `HTTP ${row.error.status}` : 'không kết nối được'}): {row.error.message}
        </p>
      )}
      {row.reprint && (
        <div className="actions">
          <button className="secondary" disabled={busy} onClick={() => void run(() => actions.reprint(row), () => setReprinted(true))} data-testid="sync-reprint">In lại đơn (từ máy này)</button>
          {reprinted && <span className="small muted" role="status" data-testid="sync-reprinted">Đã in lại.</span>}
        </div>
      )}
      {failed && <p className="error small" role="alert" data-testid="sync-row-failed">{failed}</p>}
    </li>
  );
}

/**
 * Danh sách "Chờ đồng bộ" (kế hoạch, N3, OFF-7): mọi thao tác đã lưu trên máy mà máy chủ chưa nhận, kèm trạng thái và lỗi gần nhất.
 * Nút: "Đồng bộ ngay", "Đóng", "Xác nhận và gửi lại" (422), "In lại đơn". KHÔNG có nút xóa hay hủy mục chưa đồng bộ (đã chốt ở M0):
 * mục chỉ rời danh sách khi máy chủ nhận.
 */
export function SyncPanel({ view, rows, actions, onClose }: { view: IndicatorView; rows: SyncRow[] | undefined; actions: SyncListActions; onClose: () => void }) {
  return (
    <aside className="sync-panel card" id="sync-list" role="dialog" aria-labelledby="sync-title" data-testid="sync-list">
      <header className="sync-panel-head">
        <h2 id="sync-title">Chờ đồng bộ</h2>
        <button className="ghost" onClick={onClose} data-testid="sync-list-close">Đóng</button>
      </header>
      <p className="small" data-testid="sync-list-summary">
        {view.online ? 'Có mạng' : 'Mất mạng'} · {view.summary}
        {view.sending ? ' · đang gửi…' : ''}
        {view.attention > 0 ? ` · ${view.attention} cần xử lý` : ''}
        {view.lastSync ? ` · ${view.lastSync}` : ''}
      </p>
      {view.expired && <p className="error" role="alert">{view.expired}</p>}
      <div className="actions">
        <button className="secondary" disabled={!view.online} onClick={() => void actions.syncNow()} data-testid="sync-list-now">Đồng bộ ngay</button>
      </div>
      <p className="muted small">Các thao tác dưới đây đã lưu trên máy này (mã hóa) nhưng máy chủ chưa nhận. Máy tự gửi khi có mạng; gửi lại nhiều lần cũng không lưu trùng.</p>
      {rows === undefined ? (
        <p className="muted">Đang đọc dữ liệu trên máy…</p>
      ) : rows.length === 0 ? (
        <p data-testid="sync-list-empty">Không có mục nào chờ đồng bộ.</p>
      ) : (
        <ol className="sync-rows">{rows.map((r) => <Row key={r.id} row={r} actions={actions} />)}</ol>
      )}
    </aside>
  );
}

const NOTICE_TITLE: Record<SyncNotice['kind'], string> = {
  conflict: 'Xung đột khi đồng bộ',
  rules: 'Đơn cần bác sĩ xác nhận lại',
  error: 'Máy chủ từ chối một mục',
  renumbered: 'Số thứ tự đã đổi',
  'code-mismatch': 'Mã đơn khác mã đã in',
};

/**
 * Thông báo không âm thầm (N3): mục vừa bị từ chối, số tạm bị đổi, mã đơn lệch. Tắt được từng cái; tắt thông báo không làm mất
 * huy hiệu "cần xử lý" ở thanh trên và không đụng tới hàng đợi.
 */
export function SyncNotices({ notices, onDismiss, onOpenList }: { notices: SyncNotice[]; onDismiss: (id: string) => void; onOpenList: () => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="sync-notices" role="region" aria-label="Thông báo đồng bộ" data-testid="sync-notices">
      {notices.map((n) => {
        const warn = n.kind === 'renumbered';
        return (
          <div key={n.id} className={`sync-notice ${warn ? 'warn' : 'bad'}`} role={warn ? 'status' : 'alert'} data-testid="sync-notice" data-kind={n.kind} data-op={n.opId}>
            <p>
              <b>{NOTICE_TITLE[n.kind]}.</b> {n.text}
            </p>
            {!warn && n.kind !== 'code-mismatch' && <button className="secondary" onClick={onOpenList} data-testid="sync-notice-open">Xem</button>}
            <button className="ghost" onClick={() => onDismiss(n.id)} data-testid="sync-notice-dismiss">Đã xem</button>
          </div>
        );
      })}
    </div>
  );
}
