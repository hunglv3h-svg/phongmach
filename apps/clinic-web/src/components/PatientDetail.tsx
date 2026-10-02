import type { PatientSummary } from '@phongmach/fhir-vn-model';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { GENDER_LABEL, ageText, formatDate, shortId } from '../format';

export function PatientDetail({ token, summary }: { token: string; summary: PatientSummary }) {
  const [patient, setPatient] = useState(summary);
  const [error, setError] = useState<string>();

  // Mở hồ sơ là một lần truy cập được ghi nhật ký (đọc theo id).
  useEffect(() => {
    let live = true;
    api.readPatient(token, summary.id).then(
      (r) => live && setPatient(r.patient),
      (e: Error) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [token, summary.id]);

  const age = ageText(patient.birthDate);
  return (
    <article className="card" aria-labelledby="pt-name" data-testid="patient-detail">
      <h2 id="pt-name">{patient.fullName}</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <dl className="facts">
        <div><dt>Điện thoại</dt><dd>{patient.phone ?? '—'}</dd></div>
        <div><dt>CCCD</dt><dd>{patient.cccdMasked ?? '—'}</dd></div>
        <div><dt>Ngày sinh</dt><dd>{patient.birthDate ? `${formatDate(patient.birthDate)}${age ? ` (${age})` : ''}` : '—'}</dd></div>
        <div><dt>Giới tính</dt><dd>{patient.gender ? GENDER_LABEL[patient.gender] : '—'}</dd></div>
        <div><dt>Mã hồ sơ</dt><dd className="mono">{shortId(patient.id)}</dd></div>
      </dl>
      <div className="actions">
        <button className="primary" disabled title="Có ở M0-S2">Cho vào hàng chờ</button>
        <button className="secondary" disabled title="Có ở M0-S2">Khám và kê đơn</button>
      </div>
      <p className="muted small">Hàng chờ, khám và kê đơn là phần việc của M0-S2.</p>
    </article>
  );
}
