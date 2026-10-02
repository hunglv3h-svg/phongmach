// Mọi thao tác mà danh sách "Chờ đồng bộ" làm được với hàng đợi (kế hoạch, OFF-7). Chỉ có ba: đồng bộ ngay, xác nhận lại một đơn bị
// quy tắc chặn (gửi lại CÙNG mục, cùng `clientUuid`), và in lại đơn từ dữ liệu trên máy.
// KHÔNG có thao tác bỏ hay sửa mục: đã chốt ở M0 là không có nút xóa hay hủy mục chưa đồng bộ. Giao diện danh sách chỉ nhận đối tượng
// này, không nhận bộ máy đồng bộ, nên không gọi được việc bỏ mục vốn chỉ dành cho thao tác có mạng vừa bị từ chối.
import type { OfflineClient } from './client';
import { ackList, type SyncRow } from './syncList';

export interface SyncListActions {
  /** Gửi ngay mọi mục gửi được (mục đang cần xử lý và mục bị giữ thì không gửi). */
  syncNow(): Promise<void>;
  /** 422: bác sĩ đã ghi lý do cho từng phát hiện của máy chủ; gửi lại cùng `clientUuid` kèm các lý do đó. */
  acknowledge(row: SyncRow, reasons: Record<string, string>): Promise<void>;
  /** In lại đơn đã ký khi mất mạng từ dữ liệu trên máy (kể cả khi mục đang xung đột hoặc bị giữ). */
  reprint(row: SyncRow): Promise<void>;
}

export function syncListActions(client: OfflineClient): SyncListActions {
  return {
    syncNow: () => client.engine.syncNow(),
    async acknowledge(row, reasons) {
      if (row.status !== 'rules' || !row.rules) throw new Error('Mục này không chờ xác nhận');
      if (row.rules.blocking.length > 0) throw new Error('Đơn có lỗi không xác nhận được: không gửi lại được');
      const acks = ackList(row.rules.unacknowledged, reasons);
      if (!acks) throw new Error('Ghi lý do cho từng cảnh báo trước khi gửi lại');
      await client.engine.acknowledge(row.id, acks);
    },
    async reprint(row) {
      if (!row.reprint) throw new Error('Mục này không có đơn để in lại');
      await client.reprintSigned(row.reprint);
    },
  };
}
