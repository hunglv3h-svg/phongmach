import { getIcd10, searchIcd10, type Icd10Entry } from '@phongmach/catalogs';
import { Typeahead } from '../components/Typeahead';
import { parseNum, VITAL_FIELDS, type Draft, type VitalField } from './draft';

const VITAL_LABEL: Record<VitalField, { label: string; unit: string }> = {
  temperatureC: { label: 'Nhiệt độ', unit: '°C' },
  pulse: { label: 'Mạch', unit: 'lần/phút' },
  systolic: { label: 'HA tâm thu', unit: 'mmHg' },
  diastolic: { label: 'HA tâm trương', unit: 'mmHg' },
  respiratoryRate: { label: 'Nhịp thở', unit: 'lần/phút' },
  spo2: { label: 'SpO2', unit: '%' },
  weightKg: { label: 'Cân nặng', unit: 'kg' },
  heightCm: { label: 'Chiều cao', unit: 'cm' },
};

export function ExamForm({ draft, onChange, invalid }: { draft: Draft; onChange: (d: Draft) => void; invalid: VitalField[] }) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const addDx = (e: Icd10Entry) => !draft.diagnoses.includes(e.code) && set('diagnoses', [...draft.diagnoses, e.code]);

  return (
    <div className="exam" data-testid="exam-form">
      <h2>Khám bệnh</h2>
      <label>Lý do khám
        <input value={draft.reason} onChange={(e) => set('reason', e.target.value)} maxLength={300} data-testid="exam-reason" />
      </label>

      <fieldset className="vitals">
        <legend>Sinh hiệu</legend>
        {VITAL_FIELDS.map((f) => {
          const bad = invalid.includes(f);
          return (
            <label key={f} className={bad ? 'bad' : undefined}>
              <span>{VITAL_LABEL[f].label} <small>{VITAL_LABEL[f].unit}</small></span>
              <input
                inputMode="decimal"
                value={draft.vitals[f]}
                onChange={(e) => set('vitals', { ...draft.vitals, [f]: e.target.value })}
                aria-invalid={bad}
                data-testid={`vital-${f}`}
              />
            </label>
          );
        })}
      </fieldset>
      {invalid.length > 0 && <p className="error" role="alert">Sinh hiệu phải là số (ví dụ 37,5).</p>}

      <label>Triệu chứng, bệnh sử
        <textarea rows={2} value={draft.symptoms} onChange={(e) => set('symptoms', e.target.value)} maxLength={2000} data-testid="exam-symptoms" />
      </label>
      <label>Khám lâm sàng
        <textarea rows={2} value={draft.findings} onChange={(e) => set('findings', e.target.value)} maxLength={2000} data-testid="exam-findings" />
      </label>

      <div className="dx">
        <Typeahead<Icd10Entry>
          label="Chẩn đoán (ICD-10): gõ tắt mã hoặc tên, có dấu hay không đều được"
          placeholder="Ví dụ: J02, viem hong, tang huyet ap"
          testId="dx-search"
          search={(q) => searchIcd10(q, 8)}
          render={(e) => ({ primary: `${e.code}  ${e.name}`, ...(e.chronic ? { secondary: 'mạn tính' } : {}) })}
          getKey={(e) => e.code}
          onPick={addDx}
        />
        <ul className="tags" aria-label="Chẩn đoán đã chọn" data-testid="dx-selected">
          {draft.diagnoses.map((code) => {
            const e = getIcd10(code);
            return (
              <li key={code} className="tag" data-testid="dx-tag">
                <b>{code}</b> {e?.name ?? '(không có trong danh mục)'}
                {e?.chronic && <small> · mạn tính</small>}
                <button className="ghost x" aria-label={`Bỏ chẩn đoán ${code}`} onClick={() => set('diagnoses', draft.diagnoses.filter((c) => c !== code))}>×</button>
              </li>
            );
          })}
        </ul>
        {draft.diagnoses.length === 0 && <p className="muted small">Chưa chọn chẩn đoán: cần ít nhất một để kết thúc khám.</p>}
      </div>
    </div>
  );
}

export { parseNum };
