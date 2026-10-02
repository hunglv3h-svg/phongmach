import { useState } from 'react';
import type { AuthState } from '../api';
import { ROLE_LABEL } from '../format';
import { AuditLog } from './AuditLog';
import { Reception } from './Reception';

type Screen = 'reception' | 'audit';

export function Shell({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const [screen, setScreen] = useState<Screen>('reception');
  const owner = auth.user.role === 'owner';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>{auth.tenant.name}</strong>
          <small data-testid="whoami">{auth.user.name} · {ROLE_LABEL[auth.user.role]}</small>
        </div>
        <nav aria-label="Chức năng">
          <button className={screen === 'reception' ? 'tab active' : 'tab'} onClick={() => setScreen('reception')}>Tiếp đón</button>
          {owner && <button className={screen === 'audit' ? 'tab active' : 'tab'} onClick={() => setScreen('audit')}>Nhật ký truy cập</button>}
        </nav>
        <button className="ghost" onClick={onLogout}>Đăng xuất</button>
      </header>
      {screen === 'reception' ? <Reception token={auth.token} /> : <AuditLog token={auth.token} />}
    </div>
  );
}
