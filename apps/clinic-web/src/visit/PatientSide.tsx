import type { HistoryItem, VisitContext, VisitSummary } from '@phongmach/clinical';
import { useState } from 'react';
import { api } from '../api';
import { Allergies } from '../components/Allergies';
import { formatTime } from '../format';
import { NEED_NETWORK } from '../local/client';

export function PatientSide({
  token,
  context,
  onContext,
  onRepeat,
  online = true,
  historyLoaded = true,
  allergiesKnown = true,
}: {
  token: string;
  context: VisitContext;
  onContext: (c: VisitContext) => void;
  onRepeat: (v: VisitSummary) => void;
  /** Mất mạng: thêm/xóa dị ứng và tiền sử bị khóa (N4). */
  online?: boolean;
  /** false: tiền sử và lịch sử khám không có trên máy này (mở khi mất mạng). */
  historyLoaded?: boolean;
  /** false: máy không có dữ liệu dị ứng của bệnh nhân này. */
  allergiesKnown?: boolean;
}) {
  const locked = online ? undefined : NEED_NETWORK;
  const patientId = context.patient.id;
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  const addHistory = async () => {
    if (!text.trim()) return;
    setError(undefined);
    try {
      const { item } = await api.addHistory(token, patientId, { clientUuid: crypto.randomUUID(), text });
      onContext({ ...context, history: [...context.history, item] });
      setText('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const removeHistory = async (h: HistoryItem) => {
    try {
      await api.removeHistory(token, patientId, h.id);
      onContext({ ...context, history: context.history.filter((x) => x.id !== h.id) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="side" data-testid="patient-side">
      <h2 className="sr-only">Thông tin bệnh nhân</h2>
      <Allergies token={token} patientId={patientId} allergies={context.allergies} onChange={(allergies) => onContext({ ...context, allergies })} {...(locked ? { locked } : {})} {...(allergiesKnown ? {} : { unknown: true })} />

      <section aria-label="Tiền sử" data-testid="history">
        <h3>Tiền sử</h3>
        {!historyLoaded ? <p className="muted small" data-testid="history-not-loaded">Chưa tải (mất mạng, máy này chưa có tiền sử của bệnh nhân).</p> : context.history.length === 0 && <p className="muted small">Chưa ghi nhận.</p>}
        <ul className="tags">
          {context.history.map((h) => (
            <li key={h.id} className="tag">
              {h.text}
              <button className="ghost x" aria-label={`Xóa tiền sử ${h.text}`} disabled={!!locked} title={locked} onClick={() => void removeHistory(h)}>×</button>
            </li>
          ))}
        </ul>
        {locked ? <p className="muted small" data-testid="needs-network">{locked}: thêm hoặc xóa tiền sử.</p> : (
          <div className="add-line">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addHistory())} placeholder="Thêm tiền sử…" aria-label="Thêm tiền sử" maxLength={300} data-testid="history-input" />
            <button className="secondary" onClick={() => void addHistory()} disabled={!text.trim()}>Thêm</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section aria-label="Lịch sử khám" data-testid="previous">
        <h3>Lịch sử khám</h3>
        {!historyLoaded ? <p className="muted small" data-testid="previous-not-loaded">Chưa tải (mất mạng).</p> : context.previous.length === 0 && <p className="muted small">Lần đầu đến khám.</p>}
        <ul className="previous">
          {context.previous.map((v) => (
            <li key={v.encounterId} className="prev" data-testid="prev-visit">
              <b>{formatTime(v.date)}</b>
              <div className="small">{v.diagnoses.map((d) => `${d.code} ${d.name}`).join('; ') || v.reason || '—'}</div>
              {v.prescription && v.prescription.lines.length > 0 && (
                <>
                  <ul className="prev-lines small">{v.prescription.lines.map((l) => <li key={l.drug}>{l.name}{l.quantity ? ` × ${l.quantity}` : ''}</li>)}</ul>
                  <button className="secondary" onClick={() => onRepeat(v)} data-testid="repeat">Kê lại đơn này</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
