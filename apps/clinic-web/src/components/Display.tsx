import { initialsOf, sortQueue, type DisplayBoard, type QueuePriority } from '@phongmach/clinical';
import { useRef } from 'react';
import { ApiError, api } from '../api';
import { pad3 } from '../format';
import { useNow, usePoll } from '../hooks';
import { useOffline } from '../local/OfflineProvider';

interface Cell {
  number: number;
  initials: string;
  priority: QueuePriority;
  /** Số tạm cấp khi mất mạng, chưa được máy chủ xác nhận. */
  tentative?: boolean;
}

interface Board {
  clinic: string;
  inExam: Cell[];
  waiting: Cell[];
  /** Dựng từ dữ liệu trên máy này (mất mạng, hoặc có lượt cấp lúc mất mạng chưa đồng bộ). */
  local: boolean;
}

/**
 * Màn hình chờ cho TV phòng chờ. Chỉ có số thứ tự và chữ cái đầu, không có họ tên:
 * màn hình nằm nơi công cộng nên không hiển thị nhiều hơn mức cần thiết.
 * M0: dùng chung phiên đăng nhập của máy lễ tân; thiết bị màn hình chuyên dụng có mã ghép riêng là việc của M1.
 * Mất mạng (OFF-2): dựng từ ảnh chụp hàng chờ trên máy cộng các lượt cấp số trên máy này (số tạm có nhãn "tạm").
 */
export function Display({ token }: { token: string }) {
  const { client, online } = useOffline();
  const board = usePoll(
    async (signal): Promise<Board> => {
      const local = await client.localQueue();
      const unsynced = local.some((i) => i.local?.pending);
      let server: DisplayBoard | undefined;
      if (online && !unsynced) {
        try {
          server = await client.call(() => api.display(token, signal));
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 0)) throw e;
        }
      }
      if (server) return { clinic: server.clinic, inExam: server.inExam, waiting: server.waiting, local: false };
      const pick = (i: (typeof local)[number]): Cell => ({ number: i.number, initials: initialsOf(i.patientName), priority: i.priority, ...(i.local?.tentative ? { tentative: true } : {}) });
      const sorted = sortQueue(local) as typeof local;
      return { clinic: client.clinicName(), inExam: sorted.filter((i) => i.status === 'in-exam').map(pick), waiting: sorted.filter((i) => i.status === 'waiting').map(pick), local: true };
    },
    3000,
    [token, client, online]
  );
  const now = useNow(1000);
  const root = useRef<HTMLElement>(null);
  const data = board.data;

  const cell = (i: Cell) => (
    <li key={`${i.number}-${i.initials}`} className={`display-cell ${i.priority}`} data-testid="display-cell" data-tentative={String(!!i.tentative)}>
      <b>{pad3(i.number)}{i.tentative && <span className="tentative"> tạm</span>}</b>
      <span>{i.initials}</span>
    </li>
  );

  return (
    <main className="display" ref={root} aria-label="Màn hình chờ" data-testid="display">
      <header>
        <h1>{data?.clinic ?? 'Phòng khám'}</h1>
        <time dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleTimeString('vi-VN', { hour12: false })}</time>
        <button className="secondary" onClick={() => void root.current?.requestFullscreen?.()}>Toàn màn hình</button>
      </header>
      {board.error && <p className="error" role="alert">Mất kết nối, đang thử lại… ({board.error})</p>}
      {data?.local && !online && <p className="offline-note" data-testid="display-offline">Mất mạng: theo dữ liệu trên máy này.</p>}
      <section aria-label="Đang khám">
        <h2>Mời vào khám</h2>
        <ul className="display-grid big" data-testid="display-in-exam">{data?.inExam.map(cell)}</ul>
        {data && data.inExam.length === 0 && <p className="display-empty">—</p>}
      </section>
      <section aria-label="Đang chờ">
        <h2>Đang chờ</h2>
        <ul className="display-grid" data-testid="display-waiting">{data?.waiting.slice(0, 12).map(cell)}</ul>
        {data && data.waiting.length > 12 && <p className="display-empty">… và {data.waiting.length - 12} người nữa</p>}
        {data && data.waiting.length === 0 && <p className="display-empty">Không có ai đang chờ</p>}
      </section>
    </main>
  );
}
