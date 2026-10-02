import { MIN_ACK_REASON_LENGTH, type Finding, type Verdict } from '@phongmach/rules';
import type { Draft } from './draft';

/**
 * Cảnh báo kê đơn. `block`: không ký được. `ack`: ký được nhưng phải ghi lý do, lý do được lưu cùng đơn.
 * Cảnh báo là CỐ Ý hiện ra ở kịch bản trình diễn: không có lối tắt "bỏ qua tất cả".
 */
export function RulesPanel({ draft, onChange, findings, verdict, extra }: { draft: Draft; onChange: (d: Draft) => void; findings: Finding[]; verdict: Verdict; extra?: Finding[] }) {
  const all = [...findings, ...(extra ?? []).filter((e) => !findings.some((f) => f.key === e.key))];
  if (all.length === 0) return <p className="ok-text" data-testid="rules-ok">Không có cảnh báo.</p>;
  const acked = new Set(verdict.acknowledged.map((a) => a.key));
  return (
    <section className="rules" aria-label="Cảnh báo kê đơn" data-testid="rules">
      <h3>Cảnh báo ({all.length})</h3>
      <ul>
        {all.map((f) => (
          <li key={f.key} className={`rule ${f.severity} ${acked.has(f.key) ? 'done' : ''}`} data-testid="rule" data-rule={f.rule} data-severity={f.severity}>
            <p><b>{f.severity === 'block' ? 'Không thể ký:' : acked.has(f.key) ? 'Đã xác nhận:' : 'Cần xác nhận:'}</b> {f.message}</p>
            {f.severity === 'ack' && (
              <label className="ack">
                <span>Lý do vẫn kê (ít nhất {MIN_ACK_REASON_LENGTH} ký tự)</span>
                <input
                  value={draft.acks[f.key] ?? ''}
                  onChange={(e) => onChange({ ...draft, acks: { ...draft.acks, [f.key]: e.target.value } })}
                  placeholder="Ví dụ: đã dùng nhiều lần, dung nạp tốt"
                  data-testid="ack-reason"
                />
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
