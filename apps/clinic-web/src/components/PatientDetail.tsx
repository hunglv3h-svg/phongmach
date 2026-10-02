import { PRIORITIES, PRIORITY_LABEL, SPECIALTIES, SPECIALTY_LABEL, type AllergyView, type QueuePriority, type Specialty } from '@phongmach/clinical';
import type { PatientSummary } from '@phongmach/fhir-vn-model';
import { ageInYears } from '@phongmach/rules';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { GENDER_LABEL, ageText, formatDate, pad3, shortId } from '../format';
import { NEED_NETWORK } from '../local/client';
import { isTmp } from '../local/ops';
import { useOffline } from '../local/OfflineProvider';
import { Allergies } from './Allergies';

export function PatientDetail({ token, summary, onQueued }: { token: string; summary: PatientSummary; onQueued: (message: string) => void }) {
  const { client, online } = useOffline();
  const [patient, setPatient] = useState(summary);
  const [error, setError] = useState<string>();
  const [allergies, setAllergies] = useState<AllergyView[]>();
  /** Hồ sơ đang hiện từ dữ liệu trên máy (mất mạng, hoặc bệnh nhân tạo trên máy chưa đồng bộ). */
  const [fromCache, setFromCache] = useState<{ allergiesKnown: boolean; unsynced: boolean }>();

  // Có mạng: mở hồ sơ là một lần truy cập được ghi nhật ký (đọc theo id), và giữ tóm tắt cùng dị ứng trên máy cho lúc mất mạng (OFF-4).
  // Mất mạng hoặc bệnh nhân mới có trên máy: dùng bộ đệm trên máy.
  useEffect(() => {
    let live = true;
    const fromLocal = async () => {
      const cached = await client.cachedPatient(summary.id);
      if (!live) return;
      if (cached) setPatient(cached.patient);
      setAllergies(cached?.allergies ?? []);
      setFromCache({ allergiesKnown: cached?.allergies !== undefined, unsynced: !(await client.serverId(summary.id)) });
    };
    void (async () => {
      const serverId = await client.serverId(summary.id);
      if (!online || !serverId) return fromLocal();
      try {
        const [p, a] = await Promise.all([client.call(() => api.readPatient(token, serverId)), client.call(() => api.allergies(token, serverId))]);
        if (!live) return;
        setPatient(p.patient);
        setAllergies(a.allergies);
        setFromCache(undefined);
        await client.cachePatient(p.patient, a.allergies);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return fromLocal();
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [token, summary.id, client, online]);

  const age = ageText(patient.birthDate);
  const years = ageInYears(patient.birthDate);

  // Một UUID cho mỗi lần "Cấp số": bấm đúp hay gửi lại sau lỗi mạng không cấp hai số.
  const checkInUuid = useRef(crypto.randomUUID());
  const [specialty, setSpecialty] = useState<Specialty>(years !== undefined && years < 16 ? 'nhi' : 'noi');
  const [priority, setPriority] = useState<QueuePriority>('normal');
  const [reason, setReason] = useState('');
  const [queuing, setQueuing] = useState(false);

  const checkIn = async (e: FormEvent) => {
    e.preventDefault();
    setQueuing(true);
    setError(undefined);
    try {
      // Qua hàng đợi trên máy: mất mạng thì cấp số tạm (số lớn nhất máy này biết + 1), máy chủ cố giữ số đó khi đồng bộ (OFF-2).
      const { item, created, tentative } = await client.checkIn(patient, { clientUuid: checkInUuid.current, specialty, priority, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      checkInUuid.current = crypto.randomUUID();
      setReason('');
      onQueued(
        tentative
          ? `Mất mạng: đã cấp số ${pad3(item.number)} (tạm) cho ${patient.fullName}. Mời bệnh nhân ngồi chờ; số được xác nhận khi có mạng.`
          : created
            ? `Đã cấp số ${pad3(item.number)} cho ${patient.fullName}. Mời bệnh nhân ngồi chờ.`
            : `${patient.fullName} đã có số ${pad3(item.number)}, không cấp thêm.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQueuing(false);
    }
  };

  const [fixCccd, setFixCccd] = useState('');
  const [fixBirth, setFixBirth] = useState('');
  const missing = !patient.cccdMasked || !patient.birthDate;
  // Bổ sung CCCD, sửa dị ứng: cần mạng (N4); bệnh nhân mới có trên máy thì cần đồng bộ trước.
  const locked = !online ? `${NEED_NETWORK}` : fromCache?.unsynced ? 'Cần đồng bộ bệnh nhân này lên máy chủ trước' : undefined;
  const complete = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const r = await api.patchPatient(token, patient.id, { ...(fixCccd.trim() ? { cccd: fixCccd } : {}), ...(fixBirth ? { birthDate: fixBirth } : {}) });
      setPatient(r.patient);
      setFixCccd('');
      setFixBirth('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

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

      {fromCache && (
        <p className="offline-note small" data-testid="from-cache">
          {fromCache.unsynced ? 'Bệnh nhân mới tạo trên máy này, chưa đồng bộ.' : 'Mất mạng: hồ sơ từ dữ liệu trên máy này.'}
          {!fromCache.allergiesKnown && ' Máy chưa có dữ liệu dị ứng của người này: bác sĩ sẽ phải hỏi lại trước khi kê đơn.'}
        </p>
      )}
      {missing && (
        <form className="inline-form" onSubmit={complete} aria-label="Bổ sung thông tin" data-testid="complete-form">
          {locked && <small data-testid="needs-network">{locked}</small>}
          <small className="muted">Thiếu {[!patient.cccdMasked && 'CCCD', !patient.birthDate && 'ngày sinh'].filter(Boolean).join(' và ')}: cần để kê đơn liên thông.</small>
          <div className="row">
            {!patient.cccdMasked && <input inputMode="numeric" placeholder="Số CCCD (12 số)" aria-label="Số CCCD" value={fixCccd} onChange={(e) => setFixCccd(e.target.value)} data-testid="fix-cccd" />}
            {!patient.birthDate && <input type="date" aria-label="Ngày sinh" value={fixBirth} onChange={(e) => setFixBirth(e.target.value)} data-testid="fix-birth" />}
          </div>
          <button className="secondary" disabled={!!locked || (!fixCccd.trim() && !fixBirth)} data-testid="fix-save">Lưu bổ sung</button>
        </form>
      )}

      {allergies && <Allergies token={token} patientId={patient.id} allergies={allergies} onChange={setAllergies} {...(locked ? { locked } : {})} {...(fromCache && !fromCache.allergiesKnown ? { unknown: true } : {})} />}

      <form className="checkin" onSubmit={checkIn} aria-label="Cho vào hàng chờ">
        <h3>Cho vào hàng chờ</h3>
        <div className="row">
          <label>Chuyên khoa
            <select value={specialty} onChange={(e) => setSpecialty(e.target.value as Specialty)} data-testid="specialty">
              {SPECIALTIES.map((s) => <option key={s} value={s}>{SPECIALTY_LABEL[s]}</option>)}
            </select>
          </label>
          <label>Ưu tiên
            <select value={priority} onChange={(e) => setPriority(e.target.value as QueuePriority)} data-testid="priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
        </div>
        <label>Lý do khám (không bắt buộc)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ví dụ: đau họng 2 ngày" data-testid="reason" />
        </label>
        <button className="primary" disabled={queuing} data-testid="check-in">Cấp số</button>
      </form>
    </article>
  );
}
