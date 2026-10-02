import { PRIORITY_LABEL, SPECIALTY_LABEL, type QueueItem } from '@phongmach/clinical';
import { useEffect, useState } from 'react';
import { api, type AuthState } from '../api';
import { ageText, formatClock, pad3, waitText } from '../format';
import { useNow, usePoll } from '../hooks';
import type { LocalQueueItem } from '../local/cache';
import { NEED_NETWORK, type Opened } from '../local/client';
import { useOffline } from '../local/OfflineProvider';

const CLOSED_SHOWN = 8;
const STATUS_LABEL: Record<QueueItem['status'], string> = { waiting: 'Đang chờ', 'in-exam': 'Đang khám', done: 'Đã xong', cancelled: 'Đã hủy' };

export function Queue({ auth, onOpenVisit }: { auth: AuthState; onOpenVisit: (opened: Opened) => void }) {
  const { token, user } = auth;
  const { client, online, sync } = useOffline();
  // Có mạng: tải hàng chờ của máy chủ (giữ ảnh chụp và nạp trước người mới). Mất mạng: không gọi, dùng ảnh chụp trên máy.
  const server = usePoll((signal) => (online ? client.refreshQueue(signal) : Promise.resolve(undefined)), 5000, [token, client, online]);
  const [merged, setMerged] = useState<{ items: LocalQueueItem[]; offline: boolean; fetchedAt?: string }>();
  const now = useNow(15_000);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const clinical = user.role !== 'assistant';

  // Gộp với thao tác chưa đồng bộ trên máy, mỗi khi máy chủ trả hàng chờ mới hoặc hàng đợi đồng bộ thay đổi.
  useEffect(() => {
    let live = true;
    void (async () => {
      const fresh = server.data;
      const snap = fresh ? undefined : await client.snapshot();
      const items = await client.localQueue(fresh?.items ?? snap?.items ?? []);
      if (live) setMerged({ items, offline: !fresh, ...(snap ? { fetchedAt: snap.fetchedAt } : {}) });
    })();
    return () => {
      live = false;
    };
  }, [client, server.data, sync.version]);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(undefined);
    try {
      await fn();
      server.reload();
    } catch (e) {
      setError((e as Error).message);
      server.reload();
    } finally {
      setBusy(undefined);
    }
  };

  const items = merged?.items ?? [];
  const inExam = items.filter((i) => i.status === 'in-exam');
  const waiting = items.filter((i) => i.status === 'waiting');
  // Gần nhất trước, chỉ hiện CLOSED_SHOWN lượt để danh sách không dài ra suốt ngày.
  const closedAll = items.filter((i) => i.status === 'done' || i.status === 'cancelled').sort((a, b) => b.number - a.number);
  const closed = closedAll.slice(0, CLOSED_SHOWN);
  const renumbered = items.filter((i) => i.local?.renumbered);

  const row = (i: LocalQueueItem, next: boolean) => {
    const mine = i.doctorUserId === user.id;
    const age = ageText(i.birthDate);
    const local = i.local;
    return (
      <li key={i.id} className={`queue-row ${i.status}`} data-testid="queue-row" data-status={i.status} data-number={i.number} data-tentative={String(!!local?.tentative)} data-pending={String(!!local?.pending)}>
        <span className="queue-number" aria-label={`Số ${i.number}${local?.tentative ? ' (tạm)' : ''}`}>
          {pad3(i.number)}
          {local?.tentative && <span className="tentative"> (tạm)</span>}
        </span>
        <div className="queue-who">
          <strong>{i.patientName}</strong>
          <small>{[age, SPECIALTY_LABEL[i.specialty], i.priority !== 'normal' ? PRIORITY_LABEL[i.priority] : undefined, i.reason].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="queue-state">
          <span className={`badge ${i.status === 'waiting' ? 'warn' : i.status === 'in-exam' ? 'ok' : 'muted'}`}>{STATUS_LABEL[i.status]}</span>
          {local?.pending && !local.attention && <span className="badge warn" data-testid="row-pending">Chờ đồng bộ</span>}
          {local?.attention && <span className="badge bad" data-testid="row-attention">Cần xử lý</span>}
          {i.status === 'waiting' && <small>chờ {waitText(i.arrivedAt, now)} (từ {formatClock(i.arrivedAt)})</small>}
          {i.status === 'in-exam' && <small>{i.doctorName}</small>}
          {next && <span className="chip" data-testid="next-chip">Tiếp theo</span>}
        </div>
        <div className="queue-actions">
          {i.status === 'waiting' && clinical && (
            <button className={next ? 'primary' : 'secondary'} disabled={busy === i.id} onClick={() => void act(i.id, async () => onOpenVisit(await client.openVisit(i)))} data-testid="call">
              Gọi vào khám
            </button>
          )}
          {i.status === 'in-exam' && clinical && (
            <button className="secondary" disabled={!mine || busy === i.id} title={mine ? undefined : `Đang do ${i.doctorName ?? 'người khác'} khám`} onClick={() => void act(i.id, async () => onOpenVisit(await client.openVisit(i)))} data-testid="continue">
              {mine ? 'Tiếp tục khám' : 'Đang có người khám'}
            </button>
          )}
          {i.status === 'waiting' && (
            // Hủy lượt: cần mạng (N4); lượt cấp lúc mất mạng chưa lên máy chủ thì chưa hủy được.
            <button className="ghost" disabled={busy === i.id || !online || !!local?.tentative} title={!online ? NEED_NETWORK : local?.tentative ? 'Chưa đồng bộ' : undefined} onClick={() => void act(i.id, async () => void (await api.cancelVisit(token, i.id)))} data-testid="cancel">Hủy</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Hàng chờ hôm nay{server.data ? <small> · {server.data.day.split('-').reverse().join('/')}</small> : null}</h1>
        <button className="secondary" onClick={server.reload}>Làm mới</button>
      </div>
      {merged?.offline && (
        <p className="offline-note" data-testid="queue-offline">
          Mất mạng: hàng chờ theo dữ liệu trên máy này{merged.fetchedAt ? ` (tải lần cuối lúc ${formatClock(merged.fetchedAt)})` : ''}. Người do máy khác cấp số khi mất mạng chưa hiện ở đây.
        </p>
      )}
      {renumbered.map((i) => (
        <p key={i.id} className="notice" role="status" data-testid="renumbered">
          Số {pad3(i.local!.renumbered!.from)} (cấp khi mất mạng) của {i.patientName} đã đổi thành {pad3(i.local!.renumbered!.to)}: máy khác đã cấp số đó trước.
        </p>
      ))}
      {(error || server.error) && <p className="error" role="alert">{error ?? server.error}</p>}
      {!merged && !server.error && <p className="muted">Đang tải…</p>}
      {merged && items.length === 0 && <p className="muted">Chưa có ai trong hàng chờ. Vào "Tiếp đón", tìm bệnh nhân rồi bấm "Cấp số".</p>}

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
