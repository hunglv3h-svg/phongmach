import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthState } from '../api';
import { OfflineClient } from './client';
import type { LocalStore } from './store';
import { SyncEngine, type SyncState } from './sync';

export interface Offline {
  client: OfflineClient;
  sync: SyncState;
  /** Mất mạng (trình duyệt báo hoặc lần gọi gần nhất lỗi mạng): giao diện đi đường ngoại tuyến, khóa thao tác "cần mạng" (N4). */
  online: boolean;
}

const Ctx = createContext<Offline | undefined>(undefined);

/** Nạp trước định kỳ (OFF-4): hàng chờ và hồ sơ của người mới vào hàng chờ, để tìm và khám được khi mất mạng. */
const PREFETCH_MS = 30_000;

/**
 * Hàng đợi đồng bộ và bộ đệm của người đang đăng nhập. Bộ máy đồng bộ gửi bằng phiên của chính người này (OFF-6);
 * đổi người dùng thì tạo bộ máy mới trên kho của người đó.
 */
export function OfflineProvider({ auth, store, children }: { auth: AuthState; store: LocalStore; children: ReactNode }) {
  const authRef = useRef(auth);
  authRef.current = auth;
  const tenant = auth.tenant.slug;
  const userId = auth.user.id;
  const client = useMemo(() => {
    const engine = new SyncEngine({
      store,
      owner: { tenant, userId },
      session: () => ({ token: authRef.current.token, tenant: authRef.current.tenant.slug, userId: authRef.current.user.id }),
    });
    return new OfflineClient({ store, engine, auth: () => authRef.current });
  }, [store, tenant, userId]);
  const [sync, setSync] = useState(client.engine.state);
  const [browserOnline, setBrowserOnline] = useState(() => globalThis.navigator?.onLine !== false);

  useEffect(() => {
    const unsubscribe = client.engine.subscribe(setSync);
    setSync(client.engine.state);
    void client.start();
    const onOnline = () => {
      setBrowserOnline(true);
      void client.engine.wake();
      void client.refreshQueue().catch(() => undefined);
    };
    const onOffline = () => {
      setBrowserOnline(false);
      client.engine.observe(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Màn hàng chờ đang mở thì nó đã tải mỗi 5 giây: lần nạp định kỳ dùng lại kết quả đó, không thêm dòng nhật ký.
    const refresh = () => void (client.online ? client.refreshQueue(undefined, PREFETCH_MS).catch(() => undefined) : undefined);
    const timer = setInterval(refresh, PREFETCH_MS);
    refresh();
    return () => {
      unsubscribe();
      client.engine.stop();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, [client]);

  const value = useMemo(() => ({ client, sync, online: sync.online && browserOnline }), [client, sync, browserOnline]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOffline(): Offline {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOffline cần OfflineProvider');
  return v;
}
