import { SPECIALTY_LABEL, type VisitContext, type VisitSummary } from '@phongmach/clinical';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, type AuthState, type CompleteResponse, type RulesRejected } from '../api';
import { ageText, clock, pad3 } from '../format';
import { useNow } from '../hooks';
import { printPrescription } from '../print';
import { addPrevious, dropDraft, evaluate, loadDraft, newDraft, saveDraft, toCompleteRequest, toVitals, type Draft } from './draft';
import { ExamForm } from './ExamForm';
import { PatientSide } from './PatientSide';
import { PrescriptionEditor } from './PrescriptionEditor';
import { RulesPanel } from './RulesPanel';
import { SignResult } from './SignResult';

/**
 * Màn hình khám một trang: bên trái hồ sơ (dị ứng, tiền sử, lịch sử khám), giữa khám bệnh, phải kê đơn.
 * Đồng hồ ở đầu trang đếm từ lúc mở hồ sơ (T-TELE); con số chính thức do máy chủ đo khi ký.
 */
export function Visit({ auth, context: initial, onDone }: { auth: AuthState; context: VisitContext; onDone: () => void }) {
  const { token } = auth;
  const visit = initial.visit;
  const [context, setContext] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(visit.id) ?? newDraft(visit.reason ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [server, setServer] = useState<RulesRejected>();
  const [result, setResult] = useState<CompleteResponse>();
  const [printError, setPrintError] = useState<string>();
  const now = useNow(1000);

  useEffect(() => {
    if (!result) saveDraft(visit.id, draft);
  }, [draft, visit.id, result]);

  const allergies = context.allergies;
  const { findings, verdict } = useMemo(
    () => evaluate(draft, { specialty: visit.specialty, patient: context.patient, allergies: allergies.map(({ kind, value, label }) => ({ kind, value, label })) }),
    [draft, visit.specialty, context.patient, allergies]
  );
  const { invalid } = toVitals(draft);
  const hasRx = draft.lines.length > 0;

  const blockedBy = [
    invalid.length > 0 && 'sinh hiệu nhập sai',
    draft.diagnoses.length === 0 && 'chưa chọn chẩn đoán',
    hasRx && verdict.blocking.length > 0 && `${verdict.blocking.length} lỗi không thể ký`,
    hasRx && verdict.unacknowledged.length > 0 && `${verdict.unacknowledged.length} cảnh báo chưa xác nhận`,
  ].filter(Boolean) as string[];
  // Không kê đơn: chỉ cần chẩn đoán và sinh hiệu hợp lệ; các cảnh báo thuộc về đơn nên không áp dụng.
  const canFinishWithoutRx = invalid.length === 0 && draft.diagnoses.length > 0;

  const complete = async (withRx: boolean) => {
    setSaving(true);
    setError(undefined);
    setServer(undefined);
    try {
      const res = await api.completeVisit(token, visit.id, toCompleteRequest(draft, withRx));
      dropDraft(visit.id);
      setResult(res);
      if (res.prescription && !res.replayed) printPrescription(token, res.prescription.id).catch((e: Error) => setPrintError(e.message));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'rules-not-satisfied') {
        setServer(e.body as RulesRejected);
        setError('Máy chủ kiểm tra lại và không cho ký: xem các cảnh báo bên dưới.');
      } else if (e instanceof ApiError && e.status === 0) {
        setError('Mất kết nối. Bản nháp được giữ lại; bấm lại khi có mạng, đơn sẽ không bị lưu trùng.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const repeat = (v: VisitSummary) => setDraft((d) => addPrevious(d, v));

  if (result) {
    return <SignResult token={token} result={result} {...(printError ? { printError } : {})} onBack={onDone} />;
  }

  const age = ageText(context.patient.birthDate);
  const elapsed = visit.calledAt ? (now - Date.parse(visit.calledAt)) / 1000 : 0;

  return (
    <main className="visit" data-testid="visit">
      <header className="visit-head">
        <span className="queue-number">{pad3(visit.number)}</span>
        <div>
          <h1>{context.patient.fullName}</h1>
          <small>{[age, SPECIALTY_LABEL[visit.specialty], context.patient.cccdMasked ? `CCCD ${context.patient.cccdMasked}` : 'chưa có CCCD'].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="timer" role="timer" aria-label="Thời gian khám" data-testid="visit-timer">
          <span>Đã khám</span>
          <b>{clock(elapsed)}</b>
        </div>
        <button className="ghost" onClick={onDone} title="Giữ hồ sơ đang khám, quay về hàng chờ" data-testid="leave-visit">Về hàng chờ</button>
      </header>

      <PatientSide token={token} context={context} onContext={setContext} onRepeat={repeat} />

      <section className="visit-exam card">
        <ExamForm draft={draft} onChange={setDraft} invalid={invalid} />
      </section>

      <section className="visit-rx card">
        <PrescriptionEditor draft={draft} onChange={setDraft} specialty={visit.specialty} findings={findings} />
        {hasRx && <RulesPanel draft={draft} onChange={setDraft} findings={findings} verdict={verdict} {...(server ? { extra: [...server.blocking, ...server.unacknowledged] } : {})} />}
        {!context.patient.cccdMasked && hasRx && <p className="muted small">Thiếu CCCD? Bổ sung ở màn hình Tiếp đón rồi mở lại hồ sơ này.</p>}

        <div className="sign-bar">
          {error && <p className="error" role="alert" data-testid="sign-error">{error}</p>}
          {hasRx ? (
            <>
              <button className="primary big" disabled={saving || blockedBy.length > 0} onClick={() => void complete(true)} data-testid="sign">
                {saving ? 'Đang lưu…' : 'Ký & In'}
              </button>
              {blockedBy.length > 0 && <p className="muted small" data-testid="sign-blocked">Chưa thể ký: {blockedBy.join('; ')}.</p>}
            </>
          ) : (
            <button className="primary big" disabled={saving || !canFinishWithoutRx} onClick={() => void complete(false)} data-testid="finish-no-rx">
              {saving ? 'Đang lưu…' : 'Kết thúc khám (không kê đơn)'}
            </button>
          )}
          <p className="muted small">Chữ ký số là <b>mô phỏng</b> (chưa gọi nhà cung cấp ký số); đơn được gửi lên cổng quốc gia <b>mô phỏng</b>.</p>
        </div>
      </section>
    </main>
  );
}
