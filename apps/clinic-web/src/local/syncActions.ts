// Mọi thao tác mà danh sách "Chờ đồng bộ" làm được với hàng đợi (kế hoạch, OFF-7). Bốn việc: đồng bộ ngay; xác nhận lại một đơn bị
// quy tắc chặn (gửi lại CÙNG mục, cùng `clientUuid`); in lại đơn từ dữ liệu trên máy; và đánh dấu "đã xử lý" một mục KẸT (xung đột
// 409 hoặc lỗi dữ liệu) mà máy chủ không nhận được — mục rời danh sách, KHÔNG gửi lên máy chủ, KHÔNG ghi đè dữ liệu máy chủ (N3).
// KHÔNG có thao tác xóa/sửa dữ liệu mục một cách âm thầm: "đánh dấu đã xử lý" là hành động CÓ CHỦ ĐÍCH của người dùng (giao diện xác
// nhận hai nhịp), chỉ đổi trạng thái bản ghi trên máy sang `resolved`. Giao diện danh sách chỉ nhận đối tượng này, không nhận bộ máy
// đồng bộ, nên không gọi được `discard` (vốn chỉ dành cho thao tác có mạng vừa bị từ chối, dữ liệu còn trên màn hình).
import type { OfflineClient } from './client';
import { ackList, type SyncRow } from './syncList';

export interface SyncListActions {
  /** Gửi ngay mọi mục gửi được (mục đang cần xử lý và mục bị giữ thì không gửi). */
  syncNow(): Promise<void>;
  /** 422: bác sĩ đã ghi lý do cho từng phát hiện của máy chủ; gửi lại cùng `clientUuid` kèm các lý do đó. */
  acknowledge(row: SyncRow, reasons: Record<string, string>): Promise<void>;
  /** In lại đơn đã ký khi mất mạng từ dữ liệu trên máy (kể cả khi mục đang xung đột hoặc bị giữ). */
  reprint(row: SyncRow): Promise<void>;
  /**
   * Người dùng CHỦ ĐỘNG đánh dấu một mục KẸT (xung đột 409 hoặc lỗi dữ liệu) là "đã xử lý / đã liên hệ bệnh nhân": mục rời danh
   * sách và thôi giữ các mục phụ thuộc. KHÔNG gửi gì lên máy chủ, KHÔNG ghi đè dữ liệu máy chủ (N3). Chỉ cho mục `conflict`/`error`,
   * KHÔNG cho `rules` (có luồng xác nhận riêng) và KHÔNG cho mục `held` (bị giữ — phải đóng mục gốc gây giữ).
   */
  markHandled(row: SyncRow): Promise<void>;
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
    async markHandled(row) {
      // Guard ở lớp danh sách: chặn sớm ngay từ dòng người dùng bấm, với thông điệp theo ngôn ngữ của danh sách (dòng/trạng thái),
      // trước khi chạm bộ máy. Bộ máy (`resolveByUser`) có guard riêng theo id mục — hai lớp phòng vệ độc lập, thông điệp khác nhau.
      if (row.status !== 'conflict' && row.status !== 'error') {
        throw new Error('Chỉ xử lý được dòng đang xung đột hoặc lỗi dữ liệu; mục bị giữ thì đóng mục gốc gây giữ');
      }
      // Ủy quyền xuống bộ máy đồng bộ (giống `syncNow`/`acknowledge`): danh sách KHÔNG tự ghi vào kho. Bộ máy đổi mục sang
      // `resolved` — không gửi, không ghi đè máy chủ (N3). Guard trạng thái lặp lại ở bộ máy để không ai gọi tắt được.
      await client.engine.resolveByUser(row.id);
    },
  };
}
