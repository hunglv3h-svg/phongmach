import { GATEWAY_LABEL, type GatewayStatus, type PendingPrescription } from '@phongmach/clinical';
import { useState } from 'react';
import { api, type AuthState } from '../api';
import { formatTime, shortId } from '../format';
import { useNow, usePoll } from '../hooks';
import { NEED_NETWORK } from '../local/client';
import { useOffline } from '../local/OfflineProvider';

const BADGE: Record<GatewayStatus, string> = { signed: 'warn', sending: 'warn', retry: 'warn', sent: 'ok', failed: 'bad' };

function Pending({ p, token, onChanged, now, online }: { p: PendingPrescription; token: string; onChanged: () => void; now: number; online: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const g = p.gateway;
  const eta = g.nextAttemptAt ? Math.max(0, Math.ceil((Date.parse(g.nextAttemptAt) - now) / 1000)) : undefined;
  return (
    <tr data-testid="pending-row" data-status={g.status}>
      <td className="mono">{p.code}</td>
      <td>{p.patientName ?? '—'}</td>
      <td>{formatTime(p.signedAt)}</td>
      <td>
        <span className={`badge ${BADGE[g.status]}`}>{GATEWAY_LABEL[g.status]}</span>
        {g.attempts > 0 && <small> · đã thử {g.attempts} lần</small>}
        {g.status === 'retry' && eta !== undefined && <small> · thử lại sau {eta} giây</small>}
        {g.lastError && <small className="error"> · {g.lastError}</small>}
        {error && <small className="error"> · {error}</small>}
      </td>
      <td>
        <button className="secondary" disabled={busy || g.status === 'sending' || !online} title={online ? undefined : NEED_NETWORK} onClick={() => { setBusy(true); setError(undefined); api.retry(token, p.prescriptionId).then(onChanged, (e: Error) => setError(e.message)).finally(() => setBusy(false)); }} data-testid="retry">
          Gửi lại ngay
        </button>
      </td>
    </tr>
  );
}

export function Gateway({ auth }: { auth: AuthState }) {
  const { token, user } = auth;
  const { online } = useOffline();
  const pending = usePoll((signal) => api.pending(token, signal), 2000, [token]);
  const sim = usePoll(() => api.simGet(token).catch((e: Error & { status?: number }) => (e.status === 404 ? undefined : Promise.reject(e))), 3000, [token]);
  const now = useNow(1000);
  const [error, setError] = useState<string>();
  const canControl = user.role !== 'assistant' && online;
  const state = sim.data?.state;

  const set = async (body: { mode?: 'up' | 'down'; failNext?: number }) => {
    setError(undefined);
    try {
      await api.simSet(token, body);
      sim.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = pending.data?.pending ?? [];
  return (
    <main className="page">
      <h1>Liên thông cổng đơn thuốc quốc gia</h1>
      <p className="muted">Mỗi đơn đã ký được ghi vào hộp thư đi cùng lúc với đơn. Cổng lỗi thì đơn vẫn nằm đây và tự thử lại: không mất đơn.</p>
      {!online && <p className="offline-note" data-testid="needs-network">{NEED_NETWORK}: danh sách dưới đây là lần tải cuối; đơn ký khi mất mạng chỉ liên thông được sau khi đồng bộ.</p>}

      {state && (
        <section className="card sim" aria-label="Cổng mô phỏng" data-testid="sim-panel">
          <div className="sim-head">
            <strong>CỔNG QUỐC GIA: MÔ PHỎNG</strong>
            <span className="badge warn">Chưa gửi gì ra ngoài</span>
          </div>
          <p className="muted small">Chưa có tài liệu API và sandbox của cổng thật (TL34 Q1). Bộ nối thật sẽ thay đúng chỗ này mà không đổi màn hình.</p>
          <div className="sim-controls">
            <button className={state.mode === 'up' ? 'primary' : 'secondary'} aria-pressed={state.mode === 'up'} disabled={!canControl} onClick={() => void set({ mode: 'up' })} data-testid="sim-up">Cổng đang chạy</button>
            <button className={state.mode === 'down' ? 'danger' : 'secondary'} aria-pressed={state.mode === 'down'} disabled={!canControl} onClick={() => void set({ mode: 'down' })} data-testid="sim-down">Mất kết nối cổng</button>
            <button className="secondary" disabled={!canControl} onClick={() => void set({ failNext: 2 })} data-testid="sim-fail2">Lỗi 2 lần kế tiếp</button>
          </div>
          <p className="small" data-testid="sim-state">
            Trạng thái: <b>{state.mode === 'up' ? 'đang chạy' : 'mất kết nối'}</b>
            {state.failNext > 0 && <> · sẽ lỗi {state.failNext} lần kế tiếp</>} · cổng đã nhận {state.accepted} đơn
          </p>
        </section>
      )}
      {(error || pending.error) && <p className="error" role="alert">{error ?? pending.error}</p>}

      <h2>Đơn chưa gửi được</h2>
      {pending.data && rows.length === 0 && <p className="ok-text" data-testid="pending-empty">Không có đơn nào đang chờ: tất cả đã gửi.</p>}
      {rows.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Bảng dữ liệu, cuộn ngang bằng phím mũi tên">
          <table data-testid="pending-table">
            <thead><tr><th>Mã đơn</th><th>Bệnh nhân</th><th>Ký lúc</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{rows.map((p) => <Pending key={p.prescriptionId} p={p} token={token} now={now} online={online} onChanged={pending.reload} />)}</tbody>
          </table>
        </div>
      )}
      <p className="muted small">Mã nội bộ: {rows[0] ? shortId(rows[0].prescriptionId) : '—'}…</p>
    </main>
  );
}
