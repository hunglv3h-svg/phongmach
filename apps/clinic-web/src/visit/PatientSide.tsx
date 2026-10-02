import type { HistoryItem, VisitContext, VisitSummary } from '@phongmach/clinical';
import { useState } from 'react';
import { api } from '../api';
import { Allergies } from '../components/Allergies';
import { formatTime } from '../format';

export function PatientSide({
  token,
  context,
  onContext,
  onRepeat,
}: {
  token: string;
  context: VisitContext;
  onContext: (c: VisitContext) => void;
  onRepeat: (v: VisitSummary) => void;
}) {
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
      <Allergies token={token} patientId={patientId} allergies={context.allergies} onChange={(allergies) => onContext({ ...context, allergies })} />

      <section aria-label="Tiền sử" data-testid="history">
        <h3>Tiền sử</h3>
        {context.history.length === 0 && <p className="muted small">Chưa ghi nhận.</p>}
        <ul className="tags">
          {context.history.map((h) => (
            <li key={h.id} className="tag">
              {h.text}
              <button className="ghost x" aria-label={`Xóa tiền sử ${h.text}`} onClick={() => void removeHistory(h)}>×</button>
            </li>
          ))}
        </ul>
        <div className="add-line">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addHistory())} placeholder="Thêm tiền sử…" aria-label="Thêm tiền sử" maxLength={300} data-testid="history-input" />
          <button className="secondary" onClick={() => void addHistory()} disabled={!text.trim()}>Thêm</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section aria-label="Lịch sử khám" data-testid="previous">
        <h3>Lịch sử khám</h3>
        {context.previous.length === 0 && <p className="muted small">Lần đầu đến khám.</p>}
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
