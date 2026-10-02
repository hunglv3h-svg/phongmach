import { useCallback, useEffect, useState } from 'react';
import { loadAuth, saveAuth, setUnauthorizedHandler, type AuthState } from './api';
import { DemoBanner } from './components/DemoBanner';
import { Login } from './components/Login';
import { Shell } from './components/Shell';
import { purgeLegacySessionDrafts } from './local/store';
import { useLocalStore } from './local/useLocalStore';

export function App() {
  const [auth, setAuth] = useState<AuthState | undefined>(() => loadAuth());
  const [notice, setNotice] = useState<string>();
  const store = useLocalStore(auth ? { tenant: auth.tenant.slug, userId: auth.user.id } : undefined);

  const update = useCallback((next: AuthState | undefined) => {
    saveAuth(next);
    setAuth(next);
  }, []);

  useEffect(() => purgeLegacySessionDrafts(), []);

  // Hết phiên (401): chỉ về màn hình đăng nhập, KHÔNG xóa dữ liệu trên máy (đăng nhập lại đúng người thì dùng tiếp).
  useEffect(() => {
    setUnauthorizedHandler(() => update(undefined));
    return () => setUnauthorizedHandler(undefined);
  }, [update]);

  // Đăng xuất: xóa dữ liệu trên máy của người này (bản nháp có dữ liệu lâm sàng) cùng khóa của nó.
  const logout = async () => {
    setNotice(undefined);
    try {
      await store?.destroy();
    } catch {
      setNotice('Không xóa được dữ liệu đã mã hóa trên máy khi đăng xuất. Đóng các tab khác của ứng dụng, đăng nhập rồi đăng xuất lại.');
    }
    update(undefined);
  };

  return (
    <>
      <DemoBanner />
      {auth ? (
        store ? <Shell auth={auth} store={store} onLogout={() => void logout()} /> : <main className="page"><p className="muted">Đang mở dữ liệu trên máy…</p></main>
      ) : (
        <Login onLogin={update} {...(notice ? { notice } : {})} />
      )}
    </>
  );
}
