import { useEffect, useMemo, useState } from 'react';
import { useOffline } from './OfflineProvider';
import { buildNotices, buildSyncRows, indicatorView, type IndicatorView, type SyncData, type SyncNotice, type SyncRow } from './syncList';

export interface SyncOverview {
  view: IndicatorView;
  /** undefined: chưa đọc xong kho trên máy. */
  rows: SyncRow[] | undefined;
  notices: SyncNotice[];
}

/**
 * Chỉ báo, danh sách chờ đồng bộ và thông báo của người đang đăng nhập. Đọc kho trên máy mỗi khi hàng đợi thay đổi (`sync.version`);
 * không gọi máy chủ (không thêm dòng nhật ký truy cập nào).
 */
export function useSyncOverview(): SyncOverview {
  const { client, sync, online } = useOffline();
  const [data, setData] = useState<SyncData>();

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

  const me = client.auth().user.id;
  return useMemo(() => {
    const ctx = { now: Date.now(), online, paused: sync.paused, me, ...(sync.sending ? { sending: sync.sending } : {}) };
    return { view: indicatorView(sync, online), rows: data && buildSyncRows(data, ctx), notices: data ? buildNotices(data, ctx) : [] };
  }, [data, sync, online, me]);
}
