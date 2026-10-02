import { ALLERGY_CLASSES, searchIngredients, allergyClassLabel } from '@phongmach/catalogs';
import type { AllergyView } from '@phongmach/clinical';
import { useState } from 'react';
import { api } from '../api';
import { Typeahead } from './Typeahead';

/** Dị ứng thuốc của bệnh nhân: phụ tá ghi lúc tiếp đón, bác sĩ thấy và bị cảnh báo khi kê đơn. */
export function Allergies({
  token,
  patientId,
  allergies,
  onChange,
  locked,
  unknown,
}: {
  token: string;
  patientId: string;
  allergies: AllergyView[];
  onChange: (next: AllergyView[]) => void;
  /** Lý do không sửa được lúc này (mất mạng: "Cần mạng", N4). */
  locked?: string;
  /** Máy không có dữ liệu dị ứng của bệnh nhân này (mở khi mất mạng): không được hiện như "chưa ghi nhận". */
  unknown?: boolean;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<AllergyView[]>) => {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (kind: 'class' | 'ingredient', value: string, label?: string) =>
    run(async () => {
      if (allergies.some((a) => a.kind === kind && a.value === value)) return allergies;
      const { allergy } = await api.addAllergy(token, patientId, { clientUuid: crypto.randomUUID(), kind, value, ...(label ? { label } : {}) });
      return [...allergies, allergy];
    });

  return (
    <section aria-label="Dị ứng thuốc" data-testid="allergies">
      <h3>Dị ứng thuốc</h3>
      {unknown ? (
        <p className="error small" data-testid="allergy-unknown">Máy này chưa có dữ liệu dị ứng của bệnh nhân (mất mạng): hỏi bệnh nhân.</p>
      ) : allergies.length === 0 ? <p className="muted small" data-testid="no-allergy">Chưa ghi nhận dị ứng.</p> : (
        <ul className="tags">
          {allergies.map((a) => (
            <li key={a.id} className="tag danger" data-testid="allergy">
              {a.kind === 'class' ? allergyClassLabel(a.value) : `Hoạt chất: ${a.label}`}
              <button className="ghost x" aria-label={`Xóa dị ứng ${a.label}`} disabled={busy || !!locked} title={locked} onClick={() => void run(async () => { await api.removeAllergy(token, patientId, a.id); return allergies.filter((x) => x.id !== a.id); })}>×</button>
            </li>
          ))}
        </ul>
      )}
      {locked ? <p className="muted small" data-testid="needs-network">{locked}: thêm hoặc xóa dị ứng.</p> : (
      <div className="allergy-add">
        <select aria-label="Thêm dị ứng theo nhóm thuốc" value="" disabled={busy} onChange={(e) => e.target.value && void add('class', e.target.value)} data-testid="allergy-class">
          <option value="">+ Nhóm thuốc…</option>
          {ALLERGY_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <Typeahead<string> label="Hoặc theo hoạt chất" placeholder="Gõ tên hoạt chất…" testId="allergy-ingredient" search={(q) => searchIngredients(q)} render={(i) => ({ primary: i })} getKey={(i) => i} onPick={(i) => void add('ingredient', i, i)} />
      </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
