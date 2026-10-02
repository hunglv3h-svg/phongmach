import { SPECIALTY_LABEL, type PrescriptionDetail, type VisitContext, type VisitSummary } from '@phongmach/clinical';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, type AuthState, type CompleteResponse, type RulesRejected } from '../api';
import { ageText, clock, pad3 } from '../format';
import { useNow } from '../hooks';
import { printSaved } from '../print';
import type { DraftStore } from '../local/store';
import { addPrevious, evaluate, newDraft, toCompleteRequest, toVitals, type Draft } from './draft';
import { ExamForm } from './ExamForm';
import { PatientSide } from './PatientSide';
import { PrescriptionEditor } from './PrescriptionEditor';
import { RulesPanel } from './RulesPanel';
import { SignResult } from './SignResult';

/**
 * Màn hình khám một trang: bên trái hồ sơ (dị ứng, tiền sử, lịch sử khám), giữa khám bệnh, phải kê đơn.
 * Đồng hồ ở đầu trang đếm từ lúc mở hồ sơ (T-TELE); con số chính thức do máy chủ đo khi ký.
 */
export function Visit(props: { auth: AuthState; store: DraftStore; context: VisitContext; onDone: () => void }) {
  const { store, context } = props;
  const visitId = context.visit.id;
  // Bản nháp nằm trong kho mã hóa trên máy: đọc bất đồng bộ trước khi hiện màn hình khám.
  const [loaded, setLoaded] = useState<{ draft: Draft; stored: boolean; error?: string }>();
  useEffect(() => {
    let live = true;
    store.getDraft(visitId).then(
      (d) => live && setLoaded(d ? { draft: d, stored: true } : { draft: newDraft(context.visit.reason ?? ''), stored: false }),
      () => live && setLoaded({ draft: newDraft(context.visit.reason ?? ''), stored: false, error: 'Không đọc được bản nháp đã lưu trên máy: đã mở bản nháp mới.' })
    );
    return () => {
      live = false;
    };
  }, [store, visitId, context.visit.reason]);

  if (!loaded) return <main className="page"><p className="muted">Đang mở bản nháp…</p></main>;
  return <VisitEditor {...props} initialDraft={loaded.draft} draftStored={loaded.stored} {...(loaded.error ? { loadError: loaded.error } : {})} />;
}

function VisitEditor({
  auth,
  store,
  context: initial,
  onDone,
  initialDraft,
  draftStored,
  loadError,
}: {
  auth: AuthState;
  store: DraftStore;
  context: VisitContext;
  onDone: () => void;
  initialDraft: Draft;
  draftStored: boolean;
  loadError?: string;
}) {
  const { token } = auth;
  const visit = initial.visit;
  const [context, setContext] = useState(initial);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  // Bản nháp đã nằm trong kho (so theo đối tượng): khác `draft` nghĩa là còn thay đổi chưa lưu xong.
  const [savedDraft, setSavedDraft] = useState<Draft | undefined>(draftStored ? initialDraft : undefined);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [server, setServer] = useState<RulesRejected>();
  const [result, setResult] = useState<CompleteResponse>();
  const [printError, setPrintError] = useState<string>();
  const [printedLocally, setPrintedLocally] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    if (result || draft === savedDraft) return;
    // Kho chạy các lần ghi lần lượt, nên lần ghi xong sau cùng là bản mới nhất.
    store.putDraft(visit.id, draft).then(
      () => {
        setSavedDraft(draft);
        setSaveError(false);
      },
      () => setSaveError(true)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, visit.id, result, store]);
  const dirty = draft !== savedDraft;

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
      setResult(res);
      void store.deleteDraft(visit.id).catch(() => undefined);
      const detail = toDetail(res);
      if (detail && !res.replayed) {
        printSaved(token, detail, auth.tenant.name).then(
          (via) => via === 'local' && setPrintedLocally(true),
          (e: Error) => setPrintError(e.message)
        );
      }
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
  // Dữ liệu để in lại từ máy khi mất mạng: đơn do máy chủ trả về + bệnh nhân đang mở.
  const toDetail = (res: CompleteResponse): PrescriptionDetail | undefined =>
    res.prescription ? { prescription: res.prescription, patient: context.patient, diagnoses: res.visit.diagnoses, encounterId: visit.id } : undefined;

  if (result) {
    const detail = toDetail(result);
    return (
      <SignResult
        token={token}
        clinicName={auth.tenant.name}
        result={result}
        {...(detail ? { detail } : {})}
        {...(printError ? { printError } : {})}
        printedLocally={printedLocally}
        onBack={onDone}
      />
    );
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
          <small className={saveError ? 'error draft-state' : 'muted draft-state'} data-testid="draft-saved" data-dirty={String(dirty)} data-persistent={String(store.persistent)}>
            {saveError
              ? 'Không lưu được bản nháp trên máy'
              : dirty
                ? 'Đang lưu nháp…'
                : store.persistent
                  ? 'Đã lưu nháp trên máy (mã hóa)'
                  : 'Trình duyệt không cho lưu trên máy: nháp chỉ giữ trong tab này, mất khi tải lại'}
          </small>
          {loadError && <small className="error draft-state" role="alert">{loadError}</small>}
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
