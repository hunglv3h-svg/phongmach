import { PRIORITY_LABEL, SPECIALTY_LABEL, type QueueItem, type VisitContext } from '@phongmach/clinical';
import { useState } from 'react';
import { api, type AuthState } from '../api';
import { ageText, formatClock, pad3, waitText } from '../format';
import { useNow, usePoll } from '../hooks';

const CLOSED_SHOWN = 8;
const STATUS_LABEL: Record<QueueItem['status'], string> = { waiting: 'Đang chờ', 'in-exam': 'Đang khám', done: 'Đã xong', cancelled: 'Đã hủy' };

export function Queue({ auth, onOpenVisit }: { auth: AuthState; onOpenVisit: (context: VisitContext) => void }) {
  const { token, user } = auth;
  const queue = usePoll((signal) => api.queue(token, signal), 5000, [token]);
  const now = useNow(15_000);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const clinical = user.role !== 'assistant';

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(undefined);
    try {
      await fn();
      queue.reload();
    } catch (e) {
      setError((e as Error).message);
      queue.reload();
    } finally {
      setBusy(undefined);
    }
  };

  const items = queue.data?.items ?? [];
  const inExam = items.filter((i) => i.status === 'in-exam');
  const waiting = items.filter((i) => i.status === 'waiting');
  // Gần nhất trước, chỉ hiện CLOSED_SHOWN lượt để danh sách không dài ra suốt ngày.
  const closedAll = items.filter((i) => i.status === 'done' || i.status === 'cancelled').sort((a, b) => b.number - a.number);
  const closed = closedAll.slice(0, CLOSED_SHOWN);

  const row = (i: QueueItem, next: boolean) => {
    const mine = i.doctorUserId === user.id;
    const age = ageText(i.birthDate);
    return (
      <li key={i.id} className={`queue-row ${i.status}`} data-testid="queue-row" data-status={i.status} data-number={i.number}>
        <span className="queue-number" aria-label={`Số ${i.number}`}>{pad3(i.number)}</span>
        <div className="queue-who">
          <strong>{i.patientName}</strong>
          <small>{[age, SPECIALTY_LABEL[i.specialty], i.priority !== 'normal' ? PRIORITY_LABEL[i.priority] : undefined, i.reason].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="queue-state">
          <span className={`badge ${i.status === 'waiting' ? 'warn' : i.status === 'in-exam' ? 'ok' : 'muted'}`}>{STATUS_LABEL[i.status]}</span>
          {i.status === 'waiting' && <small>chờ {waitText(i.arrivedAt, now)} (từ {formatClock(i.arrivedAt)})</small>}
          {i.status === 'in-exam' && <small>{i.doctorName}</small>}
          {next && <span className="chip" data-testid="next-chip">Tiếp theo</span>}
        </div>
        <div className="queue-actions">
          {i.status === 'waiting' && clinical && (
            <button className={next ? 'primary' : 'secondary'} disabled={busy === i.id} onClick={() => void act(i.id, async () => onOpenVisit(await api.openVisit(token, i.id)))} data-testid="call">
              Gọi vào khám
            </button>
          )}
          {i.status === 'in-exam' && clinical && (
            <button className="secondary" disabled={!mine || busy === i.id} title={mine ? undefined : `Đang do ${i.doctorName ?? 'người khác'} khám`} onClick={() => void act(i.id, async () => onOpenVisit(await api.openVisit(token, i.id)))} data-testid="continue">
              {mine ? 'Tiếp tục khám' : 'Đang có người khám'}
            </button>
          )}
          {i.status === 'waiting' && (
            <button className="ghost" disabled={busy === i.id} onClick={() => void act(i.id, async () => void (await api.cancelVisit(token, i.id)))} data-testid="cancel">Hủy</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Hàng chờ hôm nay{queue.data ? <small> · {queue.data.day.split('-').reverse().join('/')}</small> : null}</h1>
        <button className="secondary" onClick={queue.reload}>Làm mới</button>
      </div>
      {(error || queue.error) && <p className="error" role="alert">{error ?? queue.error}</p>}
      {!queue.data && !queue.error && <p className="muted">Đang tải…</p>}
      {queue.data && items.length === 0 && <p className="muted">Chưa có ai trong hàng chờ. Vào "Tiếp đón", tìm bệnh nhân rồi bấm "Cấp số".</p>}

      {inExam.length > 0 && (
        <section aria-label="Đang khám">
          <h2>Đang khám</h2>
          <ul className="queue-list" data-testid="in-exam">{inExam.map((i) => row(i, false))}</ul>
        </section>
      )}
      {waiting.length > 0 && (
        <section aria-label="Đang chờ">
          <h2>Đang chờ ({waiting.length})</h2>
          <ul className="queue-list" data-testid="waiting">{waiting.map((i, idx) => row(i, idx === 0))}</ul>
        </section>
      )}
      {closed.length > 0 && (
        <section aria-label="Đã xong">
          <h2>Đã xong hoặc hủy ({closedAll.length})</h2>
          <ul className="queue-list compact" data-testid="closed">{closed.map((i) => row(i, false))}</ul>
          {closedAll.length > closed.length && <p className="muted small">… và {closedAll.length - closed.length} lượt cũ hơn trong ngày.</p>}
        </section>
      )}
    </main>
  );
}
