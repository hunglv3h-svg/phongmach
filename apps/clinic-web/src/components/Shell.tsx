import type { VisitContext } from '@phongmach/clinical';
import { useState } from 'react';
import type { AuthState } from '../api';
import { ROLE_LABEL } from '../format';
import { dropAllDrafts } from '../visit/draft';
import { Visit } from '../visit/Visit';
import { AuditLog } from './AuditLog';
import { Display } from './Display';
import { Gateway } from './Gateway';
import { Metrics } from './Metrics';
import { Queue } from './Queue';
import { Reception } from './Reception';
import { Scope } from './Scope';

type Screen = 'reception' | 'queue' | 'visit' | 'display' | 'gateway' | 'metrics' | 'audit' | 'scope';

export function Shell({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const [screen, setScreen] = useState<Screen>('reception');
  const [visit, setVisit] = useState<VisitContext>();
  const { role } = auth.user;
  const clinical = role !== 'assistant';

  const tabs: Array<{ id: Screen; label: string; show: boolean }> = [
    { id: 'reception', label: 'Tiếp đón', show: true },
    { id: 'queue', label: 'Hàng chờ', show: true },
    { id: 'visit', label: visit ? `Đang khám: ${visit.patient.fullName}` : 'Khám bệnh', show: clinical && !!visit },
    { id: 'display', label: 'Màn hình chờ', show: true },
    { id: 'gateway', label: 'Liên thông', show: true },
    { id: 'metrics', label: 'Thời gian khám', show: clinical },
    { id: 'audit', label: 'Nhật ký truy cập', show: role === 'owner' },
    { id: 'scope', label: 'Phạm vi', show: true },
  ];

  const logout = () => {
    dropAllDrafts(); // bản nháp chứa dữ liệu lâm sàng, không để lại sau khi đăng xuất
    onLogout();
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
        <button className="ghost" onClick={logout}>Đăng xuất</button>
      </header>
      {screen === 'reception' && <Reception token={auth.token} />}
      {screen === 'queue' && <Queue auth={auth} onOpenVisit={(context) => { setVisit(context); setScreen('visit'); }} />}
      {screen === 'visit' && visit && <Visit key={visit.visit.id} auth={auth} context={visit} onDone={() => { setVisit(undefined); setScreen('queue'); }} />}
      {screen === 'display' && <Display token={auth.token} />}
      {screen === 'gateway' && <Gateway auth={auth} />}
      {screen === 'metrics' && clinical && <Metrics auth={auth} />}
      {screen === 'audit' && role === 'owner' && <AuditLog token={auth.token} />}
      {screen === 'scope' && <Scope />}
    </div>
  );
}
