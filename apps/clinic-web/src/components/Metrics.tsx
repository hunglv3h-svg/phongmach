import { clock } from '../format';
import { useState } from 'react';
import { api, type AuthState } from '../api';
import { usePoll } from '../hooks';

const Value = ({ seconds, target }: { seconds?: number; target: number }) =>
  seconds === undefined ? <span className="muted">—</span> : <span className={seconds <= target ? 'badge ok' : 'badge bad'}>{clock(seconds)} <small>({seconds} giây)</small></span>;

export function Metrics({ auth }: { auth: AuthState }) {
  const [days, setDays] = useState(14);
  const m = usePoll(() => api.metrics(auth.token, days), 10_000, [auth.token, days]);
  const data = m.data;
  return (
    <main className="page">
      <div className="page-head">
        <h1>Thời gian một lượt khám</h1>
        <label className="inline">
          Khoảng thời gian
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Khoảng thời gian">
            <option value={1}>Hôm nay</option>
            <option value={7}>7 ngày</option>
            <option value={14}>14 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </label>
      </div>
      <p className="muted">Từ lúc bác sĩ mở hồ sơ đến lúc ký và in đơn, do máy chủ đo (không tin đồng hồ trình duyệt). Mục tiêu: trung vị ≤ 60 giây, p90 ≤ 120 giây (TL34 B.5).{auth.user.role === 'doctor' ? ' Bạn chỉ thấy số của chính mình.' : ''}</p>
      {m.error && <p className="error" role="alert">{m.error}</p>}
      {data && (
        <>
          <div className="table-wrap">
            <table data-testid="metrics-table">
              <thead><tr><th>Bác sĩ</th><th>Số lượt</th><th>Trung vị (p50)</th><th>p90</th><th>Phiên bị loại</th></tr></thead>
              <tbody>
                {data.doctors.map((d) => (
                  <tr key={d.name} data-testid="metrics-row">
                    <td>{d.name}</td><td>{d.visits}</td>
                    <td><Value seconds={d.p50Seconds} target={data.targetP50Seconds} /></td>
                    <td><Value seconds={d.p90Seconds} target={data.targetP90Seconds} /></td>
                    <td>{d.excluded}</td>
                  </tr>
                ))}
                <tr className="total" data-testid="metrics-total">
                  <td><b>Toàn phòng khám</b></td><td>{data.all.visits}</td>
                  <td><Value seconds={data.all.p50Seconds} target={data.targetP50Seconds} /></td>
                  <td><Value seconds={data.all.p90Seconds} target={data.targetP90Seconds} /></td>
                  <td>{data.all.excluded}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {data.all.visits === 0 && <p className="muted">Chưa có lượt khám nào trong khoảng này.</p>}
          <p className="muted small">Phiên dài hơn {Math.round(data.excludedLongerThanSeconds / 60)} phút (thường là bỏ dở) không tính vào phân vị nhưng được đếm ở cột "Phiên bị loại".{data.truncated ? ' Số liệu bị cắt vì quá nhiều lượt: hãy chọn khoảng ngắn hơn.' : ''}</p>
        </>
      )}
    </main>
  );
}
