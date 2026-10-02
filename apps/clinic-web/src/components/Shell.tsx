import { useState } from 'react';
import type { AuthState } from '../api';
import type { Opened } from '../local/client';
import { useOffline } from '../local/OfflineProvider';
import type { LocalStore } from '../local/store';
import { ROLE_LABEL } from '../format';
import { Visit } from '../visit/Visit';
import { AuditLog } from './AuditLog';
import { Display } from './Display';
import { Gateway } from './Gateway';
import { Metrics } from './Metrics';
import { Queue } from './Queue';
import { Reception } from './Reception';
import { Scope } from './Scope';

type Screen = 'reception' | 'queue' | 'visit' | 'display' | 'gateway' | 'metrics' | 'audit' | 'scope';

/** Trạng thái mạng và hàng đợi đồng bộ (bản tối thiểu; danh sách chờ đồng bộ đầy đủ là lát 4). */
function SyncStatus() {
  const { client, sync, online } = useOffline();
  return (
    <div className="sync-status" data-testid="sync-status" data-online={String(online)} data-pending={sync.pending} data-attention={sync.attention} aria-live="polite">
      {!online && <span className="badge bad" data-testid="offline-badge">Mất mạng</span>}
      {sync.paused === 'unauthorized' && <span className="badge bad">Phiên hết hạn: đăng nhập lại để đồng bộ</span>}
      {sync.pending > 0 && (
        <>
          <span className={`badge ${sync.attention > 0 ? 'bad' : 'warn'}`}>
            {sync.pending} mục chờ đồng bộ{sync.attention > 0 ? ` (${sync.attention} cần xử lý)` : ''}
          </span>
          <button className="ghost" disabled={!online} onClick={() => void client.engine.syncNow()} data-testid="sync-now">Đồng bộ ngay</button>
        </>
      )}
    </div>
  );
}

export function Shell({ auth, store, onLogout }: { auth: AuthState; store: LocalStore; onLogout: (keepData: boolean) => void }) {
  const { client } = useOffline();
  const [screen, setScreen] = useState<Screen>('reception');
  const [visit, setVisit] = useState<Opened>();
  const [confirm, setConfirm] = useState<number>();
  const { role } = auth.user;
  const clinical = role !== 'assistant';

  const tabs: Array<{ id: Screen; label: string; show: boolean }> = [
    { id: 'reception', label: 'Tiếp đón', show: true },
    { id: 'queue', label: 'Hàng chờ', show: true },
    { id: 'visit', label: visit ? `Đang khám: ${visit.context.patient.fullName}` : 'Khám bệnh', show: clinical && !!visit },
    { id: 'display', label: 'Màn hình chờ', show: true },
    { id: 'gateway', label: 'Liên thông', show: true },
    { id: 'metrics', label: 'Thời gian khám', show: clinical },
    { id: 'audit', label: 'Nhật ký truy cập', show: role === 'owner' },
    { id: 'scope', label: 'Phạm vi', show: true },
  ];

  // Còn mục chưa đồng bộ: không xóa dữ liệu khi đăng xuất, hỏi người dùng (OFF-6). Không có nút hủy dữ liệu chưa đồng bộ.
  const logout = async () => {
    const pending = await store.pendingCount().catch(() => 0);
    if (pending > 0) setConfirm(pending);
    else onLogout(false);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>{auth.tenant.name}</strong>
          <small data-testid="whoami">{auth.user.name} · {ROLE_LABEL[role]}</small>
        </div>
        <nav aria-label="Chức năng">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} className={screen === t.id ? 'tab active' : 'tab'} onClick={() => setScreen(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
          ))}
        </nav>
        <SyncStatus />
        <button className="ghost" onClick={() => void logout()}>Đăng xuất</button>
      </header>
      {confirm !== undefined && (
        <div className="dialog-backdrop">
          <section className="card dialog" role="alertdialog" aria-labelledby="logout-title" data-testid="logout-dialog">
            <h2 id="logout-title">Còn {confirm} mục chưa đồng bộ</h2>
            <p>Các thao tác làm lúc mất mạng chưa lên máy chủ. Chúng nằm trên máy này, đã mã hóa, và chỉ được gửi bằng phiên của chính bạn.</p>
            <div className="actions">
              <button className="primary" onClick={() => { setConfirm(undefined); void client.engine.syncNow(); }} data-testid="logout-wait">Chờ đồng bộ</button>
              <button className="secondary" onClick={() => { setConfirm(undefined); onLogout(true); }} data-testid="logout-keep">Đăng xuất, giữ dữ liệu đã mã hóa trên máy</button>
            </div>
            <p className="muted small">Lần đăng nhập sau của bạn trên máy này sẽ tự gửi tiếp.</p>
          </section>
        </div>
      )}
      {screen === 'reception' && <Reception token={auth.token} />}
      {screen === 'queue' && <Queue auth={auth} onOpenVisit={(opened) => { setVisit(opened); setScreen('visit'); }} />}
      {screen === 'visit' && visit && <Visit key={visit.context.visit.id} auth={auth} store={store} opened={visit} onDone={() => { setVisit(undefined); setScreen('queue'); }} />}
      {screen === 'display' && <Display token={auth.token} />}
      {screen === 'gateway' && <Gateway auth={auth} />}
      {screen === 'metrics' && clinical && <Metrics auth={auth} />}
      {screen === 'audit' && role === 'owner' && <AuditLog token={auth.token} />}
      {screen === 'scope' && <Scope />}
    </div>
  );
}
