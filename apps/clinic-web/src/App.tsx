import { useCallback, useEffect, useState } from 'react';
import { loadAuth, saveAuth, setUnauthorizedHandler, type AuthState } from './api';
import { DemoBanner } from './components/DemoBanner';
import { Login } from './components/Login';
import { Shell } from './components/Shell';

export function App() {
  const [auth, setAuth] = useState<AuthState | undefined>(() => loadAuth());

  const update = useCallback((next: AuthState | undefined) => {
    saveAuth(next);
    setAuth(next);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => update(undefined));
    return () => setUnauthorizedHandler(undefined);
  }, [update]);

  return (
    <>
      <DemoBanner />
      {auth ? <Shell auth={auth} onLogout={() => update(undefined)} /> : <Login onLogin={update} />}
    </>
  );
}
