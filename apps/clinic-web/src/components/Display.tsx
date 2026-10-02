import type { DisplayItem } from '@phongmach/clinical';
import { useRef } from 'react';
import { api } from '../api';
import { pad3 } from '../format';
import { useNow, usePoll } from '../hooks';

/**
 * Màn hình chờ cho TV phòng chờ. Chỉ có số thứ tự và chữ cái đầu, không có họ tên:
 * màn hình nằm nơi công cộng nên không hiển thị nhiều hơn mức cần thiết.
 * M0: dùng chung phiên đăng nhập của máy lễ tân; thiết bị màn hình chuyên dụng có mã ghép riêng là việc của M1.
 */
export function Display({ token }: { token: string }) {
  const board = usePoll((signal) => api.display(token, signal), 3000, [token]);
  const now = useNow(1000);
  const root = useRef<HTMLElement>(null);
  const data = board.data;

  const cell = (i: DisplayItem) => (
    <li key={i.number} className={`display-cell ${i.priority}`} data-testid="display-cell">
      <b>{pad3(i.number)}</b>
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
