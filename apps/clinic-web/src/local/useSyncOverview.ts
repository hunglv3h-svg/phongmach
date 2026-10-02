import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOffline } from './OfflineProvider';
import { overviewOf, type SyncData, type SyncOverview } from './syncList';

const DISMISSED_KEY = 'phongmach.notices.dismissed';

/** id các thông báo đã tắt trong phiên trình duyệt này. Chỉ có id của mục hàng đợi (UUID), không có dữ liệu bệnh nhân. */
function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Chỉ báo, danh sách chờ đồng bộ và thông báo của người đang đăng nhập. Đọc kho trên máy mỗi khi hàng đợi thay đổi (`sync.version`);
 * không gọi máy chủ (không thêm dòng nhật ký truy cập nào).
 */
export function useSyncOverview(): SyncOverview & { dismiss: (id: string) => void } {
  const { client, sync, online } = useOffline();
  const [data, setData] = useState<SyncData>();
  const [dismissed, setDismissed] = useState(loadDismissed);

  useEffect(() => {
    let live = true;
    client.syncData().then(
      (d) => live && setData(d),
      () => undefined // kho đang đóng (đăng xuất) hoặc quá hạn: giữ danh sách cũ, lần thay đổi sau đọc lại
    );
    return () => {
      live = false;
    };
  }, [client, sync.version]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try {
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-200)));
      } catch {
        // sessionStorage bị chặn: thông báo chỉ tắt trong lần tải trang này
      }
      return next;
    });
  }, []);

  const me = client.auth().user.id;
  const overview = useMemo(() => overviewOf(data, sync, online, me, dismissed, Date.now()), [data, sync, online, me, dismissed]);
  return useMemo(() => ({ ...overview, dismiss }), [overview, dismiss]);
}
