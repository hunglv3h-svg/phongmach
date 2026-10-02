import { useEffect, useState } from 'react';
import { MemoryStore, openEncryptedStore, type DraftStore, type Owner } from './store';

/**
 * Kho trên máy của người đang đăng nhập; undefined khi đang mở. Không mở được kho mã hóa (trình duyệt thiếu IndexedDB/WebCrypto,
 * chế độ riêng tư chặn lưu trữ) thì dùng kho trong bộ nhớ của tab và `persistent` là false để giao diện báo rõ.
 * Đổi người dùng hoặc hết phiên thì đóng kho, không xóa: xóa chỉ khi đăng xuất (kế hoạch, OFF-5 và OFF-6).
 */
export function useLocalStore(owner: Owner | undefined): DraftStore | undefined {
  const [store, setStore] = useState<DraftStore>();
  const tenant = owner?.tenant;
  const userId = owner?.userId;

  useEffect(() => {
    setStore(undefined);
    if (!tenant || !userId) return;
    let opened: DraftStore | undefined;
    let live = true;
    openEncryptedStore({ tenant, userId })
      .catch(() => new MemoryStore())
      .then((s) => {
        opened = s;
        if (live) setStore(s);
        else s.close();
      });
    return () => {
      live = false;
      opened?.close();
    };
  }, [tenant, userId]);

  return store;
}
