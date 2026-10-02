import type { IndicatorView } from '../local/syncList';

/**
 * Chỉ báo mạng và đồng bộ ở thanh trên (kế hoạch, N3, OFF-6): có mạng hay mất mạng, đang gửi, số mục chờ ("đang đếm" khi chưa đếm xong),
 * số mục cần xử lý, lần gửi thành công cuối, hết phiên. Bấm vào thì mở danh sách "Chờ đồng bộ".
 * Huy hiệu "cần xử lý" chỉ phụ thuộc hàng đợi: không có cách nào tắt nó ngoài việc xử lý xong các mục đó.
 */
export function SyncBar({ view, open, onToggle, onSyncNow }: { view: IndicatorView; open: boolean; onToggle: () => void; onSyncNow: () => void }) {
  return (
    <div className="sync-status" data-testid="sync-status" data-online={String(view.online)} data-pending={view.pending ?? 'counting'} data-attention={view.attention} aria-live="polite">
      {view.online ? <span className="badge ok" data-testid="online-badge">Có mạng</span> : <span className="badge bad" data-testid="offline-badge">Mất mạng</span>}
      {view.expired && <span className="badge bad" data-testid="session-expired">{view.expired}</span>}
      <button className="ghost sync-open" aria-expanded={open} aria-controls="sync-list" onClick={onToggle} data-testid="sync-open">
        {view.summary}
        {view.sending ? ' · đang gửi…' : ''}
      </button>
      {view.attention > 0 && (
        <button className="badge bad attention" onClick={onToggle} data-testid="attention-badge">{view.attention} cần xử lý</button>
      )}
      {view.lastSync && <small className="muted" data-testid="last-sync">{view.lastSync}</small>}
      {(view.pending ?? 0) > 0 && <button className="ghost" disabled={!view.online} onClick={onSyncNow} data-testid="sync-now">Đồng bộ ngay</button>}
    </div>
  );
}
