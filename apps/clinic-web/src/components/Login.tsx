import { useEffect, useState } from 'react';
import { api, type AuthState, type DemoTenant } from '../api';
import { ROLE_LABEL } from '../format';

export function Login({ onLogin }: { onLogin: (auth: AuthState) => void }) {
  const [tenants, setTenants] = useState<DemoTenant[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.demoUsers().then((r) => setTenants(r.tenants), (e: Error) => setError(e.message));
  }, []);

  const pick = async (tenant: string, userId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      onLogin(await api.login(tenant, userId));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1>Chọn phòng khám và người dùng</h1>
      <p className="muted">Hai phòng khám demo dùng hai kho dữ liệu tách biệt. Chưa có mật khẩu: đây là bản trình diễn.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!tenants && !error && <p className="muted">Đang tải…</p>}
      <div className="tenant-grid">
        {tenants?.map((t) => (
          <section key={t.slug} className="card" aria-labelledby={`t-${t.slug}`}>
            <h2 id={`t-${t.slug}`}>{t.name}</h2>
            <ul className="user-list">
              {t.users.map((u) => (
                <li key={u.id}>
                  <button className="user-btn" disabled={busy} onClick={() => pick(t.slug, u.id)} data-testid={`login-${u.id}`}>
                    <span>{u.name}</span>
                    <small>{ROLE_LABEL[u.role]}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
