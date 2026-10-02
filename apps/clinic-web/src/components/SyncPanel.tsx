import { pad3 } from '../format';
import type { IndicatorView, RowStatus, SyncRow } from '../local/syncList';

const SHORT: Record<RowStatus, string> = {
  pending: 'Chờ gửi',
  sending: 'Đang gửi',
  waiting: 'Chờ mục trước',
  retry: 'Thử lại',
  conflict: 'Xung đột',
  rules: 'Chờ xác nhận',
  error: 'Cần xử lý',
  held: 'Bị giữ',
};

function Row({ row }: { row: SyncRow }) {
  const tone = row.attention ? 'bad' : row.status === 'sending' ? 'ok' : 'warn';
  const who = [
    row.patientName ?? 'Không rõ bệnh nhân',
    row.number ? `số ${pad3(row.number)}${row.tentative ? ' (tạm)' : ''}` : undefined,
    row.code ? `mã đơn ${row.code}` : undefined,
  ].filter(Boolean);
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
        <div className="error" role="alert" data-testid="sync-row-rules">
          Máy chủ kiểm tra lại và cần bác sĩ xác nhận trước khi lưu đơn (đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc):
          <ul>
            {[...row.rules.blocking, ...row.rules.unacknowledged].map((f) => (
              <li key={f.key} data-testid="sync-finding" data-rule={f.rule} data-severity={f.severity}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}
      {row.error && (
        <p className="small sync-row-error" data-testid="sync-row-error">
          Máy chủ trả lời gần nhất ({row.error.status > 0 ? `HTTP ${row.error.status}` : 'không kết nối được'}): {row.error.message}
        </p>
      )}
    </li>
  );
}

/**
 * Danh sách "Chờ đồng bộ" (kế hoạch, N3, OFF-7): mọi thao tác đã lưu trên máy mà máy chủ chưa nhận, kèm trạng thái và lỗi gần nhất.
 * Chỉ có "Đồng bộ ngay" và "Đóng". KHÔNG có nút xóa hay hủy mục chưa đồng bộ (đã chốt ở M0): mục chỉ rời danh sách khi máy chủ nhận.
 */
export function SyncPanel({ view, rows, onSyncNow, onClose }: { view: IndicatorView; rows: SyncRow[] | undefined; onSyncNow: () => void; onClose: () => void }) {
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
        <button className="secondary" disabled={!view.online} onClick={onSyncNow} data-testid="sync-list-now">Đồng bộ ngay</button>
      </div>
      <p className="muted small">Các thao tác dưới đây đã lưu trên máy này (mã hóa) nhưng máy chủ chưa nhận. Máy tự gửi khi có mạng; gửi lại nhiều lần cũng không lưu trùng.</p>
      {rows === undefined ? (
        <p className="muted">Đang đọc dữ liệu trên máy…</p>
      ) : rows.length === 0 ? (
        <p data-testid="sync-list-empty">Không có mục nào chờ đồng bộ.</p>
      ) : (
        <ol className="sync-rows">{rows.map((r) => <Row key={r.id} row={r} />)}</ol>
      )}
    </aside>
  );
}
