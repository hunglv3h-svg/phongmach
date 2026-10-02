import { DomainError, buildPatient, type Gender, type PatientSummary } from '@phongmach/fhir-vn-model';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';

export interface FormInitial {
  fullName?: string;
  phone?: string;
  cccd?: string;
}

interface Props {
  token: string;
  initial: FormInitial;
  onCreated: (patient: PatientSummary, created: boolean) => void;
  onCancel: () => void;
}

export function PatientForm({ token, initial, onCreated, onCancel }: Props) {
  // Một UUID cho mỗi lần mở biểu mẫu: bấm hai lần hoặc gửi lại khi mạng chập chờn không tạo bệnh nhân trùng.
  const clientUuid = useRef(crypto.randomUUID());
  const [fullName, setFullName] = useState(initial.fullName ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [cccd, setCccd] = useState(initial.cccd ?? '');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      clientUuid: clientUuid.current,
      fullName,
      ...(phone.trim() ? { phone } : {}),
      ...(cccd.trim() ? { cccd } : {}),
      ...(birthDate ? { birthDate } : {}),
      ...(gender ? { gender } : {}),
    };
    try {
      buildPatient(input); // kiểm tra ngay trên máy bằng đúng quy tắc của máy chủ
    } catch (err) {
      if (err instanceof DomainError) return setError(err.message);
      throw err;
    }
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.createPatient(token, input);
      onCreated(r.patient, r.created);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit} aria-labelledby="new-title" data-testid="patient-form">
      <h2 id="new-title">Thêm bệnh nhân mới</h2>
      <label>
        Họ và tên
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus autoComplete="off" placeholder="Nguyễn Văn An" data-testid="f-name" />
      </label>
      <div className="row">
        <label>
          Số điện thoại
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder="0912 345 678" data-testid="f-phone" />
        </label>
        <label>
          CCCD
          <input value={cccd} onChange={(e) => setCccd(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="12 chữ số" data-testid="f-cccd" />
        </label>
      </div>
      <div className="row">
        <label>
          Ngày sinh
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} data-testid="f-birth" />
        </label>
        <label>
          Giới tính
          <select value={gender} onChange={(e) => setGender(e.target.value as Gender | '')} data-testid="f-gender">
            <option value="">Chưa chọn</option>
            <option value="male">Nam</option>
            <option value="female">Nữ</option>
            <option value="other">Khác</option>
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert" data-testid="form-error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy} data-testid="f-submit">{busy ? 'Đang lưu…' : 'Tạo và mở hồ sơ'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}
