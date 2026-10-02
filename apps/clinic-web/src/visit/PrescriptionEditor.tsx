import { TEMPLATES, getDrug, searchDrugs, type DrugEntry } from '@phongmach/catalogs';
import type { Finding } from '@phongmach/rules';
import { Typeahead } from '../components/Typeahead';
import { addTemplate, describeLine, lineFromDrug, withInstruction, type Draft, type LineDraft } from './draft';

const NUMERIC: Array<{ field: 'perDose' | 'timesPerDay' | 'days'; label: string; width: string }> = [
  { field: 'perDose', label: 'Liều/lần', width: '4.5rem' },
  { field: 'timesPerDay', label: 'Lần/ngày', width: '4.5rem' },
  { field: 'days', label: 'Số ngày', width: '4.5rem' },
];

export function PrescriptionEditor({ draft, onChange, specialty, findings }: { draft: Draft; onChange: (d: Draft) => void; specialty: 'noi' | 'nhi'; findings: Finding[] }) {
  const setLine = (key: string, patch: Partial<LineDraft> | ((l: LineDraft) => LineDraft)) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? (typeof patch === 'function' ? patch(l) : { ...l, ...patch }) : l)) });

  const templates = [...TEMPLATES].sort((a, b) => Number(b.specialty === specialty) - Number(a.specialty === specialty));

  return (
    <div className="rx" data-testid="rx-editor">
      <h2>Kê đơn</h2>
      <div className="rx-tools">
        <label>Đơn mẫu
          <select
            value=""
            onChange={(e) => {
              const t = TEMPLATES.find((x) => x.id === e.target.value);
              if (t) onChange(addTemplate(draft, t));
            }}
            data-testid="template"
          >
            <option value="">Chọn đơn mẫu…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.specialty === specialty ? '' : '(khác chuyên khoa) '}{t.name}</option>)}
          </select>
        </label>
        <TypeaheadDrug onPick={(d) => onChange({ ...draft, lines: [...draft.lines, lineFromDrug(d)] })} />
      </div>

      {draft.lines.length === 0 ? <p className="muted">Chưa có thuốc. Chọn đơn mẫu, "Kê lại" từ lượt khám cũ, hoặc gõ tên thuốc.</p> : (
        <ol className="lines" data-testid="lines">
          {draft.lines.map((l, index) => {
            const info = describeLine(l);
            const mine = findings.filter((f) => f.lines.includes(index));
            const level = mine.some((f) => f.severity === 'block') ? 'block' : mine.length ? 'ack' : '';
            const drug = getDrug(l.drug);
            const name = drug?.name ?? l.drug;
            return (
              <li key={l.key} className={`line ${level}`} data-testid="line" data-drug={l.drug}>
                <div className="line-name">
                  <strong>{name}</strong>
                  <small>{drug?.unit}{drug?.paediatric ? ' · dạng cho trẻ em' : ''}</small>
                  <button className="ghost x" aria-label={`Bỏ ${name}`} onClick={() => onChange({ ...draft, lines: draft.lines.filter((x) => x.key !== l.key) })} data-testid="line-remove">×</button>
                </div>
                <div className="line-fields">
                  {NUMERIC.map((n) => (
                    <label key={n.field} style={{ width: n.width }}>
                      <span>{n.label}</span>
                      <input inputMode="decimal" value={l[n.field]} onChange={(e) => setLine(l.key, { [n.field]: e.target.value })} aria-label={`${n.label} của ${name}`} data-testid={`line-${n.field}`} />
                    </label>
                  ))}
                  <label style={{ width: '5.5rem' }}>
                    <span>Số lượng</span>
                    {drug?.manualQuantity ? (
                      <input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} aria-label={`Số lượng của ${name}`} data-testid="line-quantity" />
                    ) : (
                      <output data-testid="line-quantity-auto" aria-label={`Số lượng của ${name}`}>{info.quantity ?? '—'}</output>
                    )}
                  </label>
                </div>
                <label className="line-how">
                  <span>Cách dùng{l.instruction ? ' (đã sửa tay)' : ''}</span>
                  <input value={info.instruction} onChange={(e) => setLine(l.key, (x) => withInstruction(x, e.target.value))} placeholder={drug?.paediatric ? 'Nhập liều theo cân nặng' : 'Nhập liều để tự sinh cách dùng'} aria-label={`Cách dùng của ${name}`} data-testid="line-instruction" />
                </label>
                {mine.map((f) => <p key={f.key} className={`line-note ${f.severity}`}>{f.severity === 'block' ? '⛔' : '⚠️'} {f.message}</p>)}
              </li>
            );
          })}
        </ol>
      )}

      <label>Lời dặn
        <textarea rows={2} value={draft.advice} onChange={(e) => onChange({ ...draft, advice: e.target.value })} maxLength={1000} data-testid="advice" />
      </label>
      <label className="inline">Tái khám sau (ngày)
        <input inputMode="numeric" style={{ width: '5rem' }} value={draft.followUpDays} onChange={(e) => onChange({ ...draft, followUpDays: e.target.value })} data-testid="follow-up" />
      </label>
    </div>
  );
}

function TypeaheadDrug({ onPick }: { onPick: (d: DrugEntry) => void }) {
  return (
    <Typeahead<DrugEntry>
      label="Thêm thuốc"
      placeholder="Gõ tên thuốc hoặc hoạt chất…"
      testId="drug-search"
      search={(q) => searchDrugs(q, 8)}
      render={(d) => ({ primary: d.name, secondary: d.ingredients.join(' + ') })}
      getKey={(d) => d.code}
      onPick={onPick}
    />
  );
}
