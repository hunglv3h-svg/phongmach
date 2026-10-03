import { GATEWAY_LABEL, type GatewayStatus, type PrescriptionDetail } from '@phongmach/clinical';
import { useEffect, useState } from 'react';
import { api, type CompleteResponse } from '../api';
import { usePoll } from '../hooks';
import { clock } from '../format';
import { printSaved } from '../print';
import { useOffline } from '../local/OfflineProvider';
import { ZaloButton } from './ZaloPreview';

const BADGE: Record<GatewayStatus, string> = { signed: 'warn', sending: 'warn', retry: 'warn', sent: 'ok', failed: 'bad' };

/** Kết quả sau khi ký: mã đơn, trạng thái liên thông (tự cập nhật), thời gian phiên khám, in lại (cả khi mất mạng), xem trước tin Zalo (mô phỏng). */
export function SignResult({
  token,
  clinicName,
  result,
  detail,
  printError,
  printedLocally,
  onBack,
}: {
  token: string;
  clinicName: string;
  result: CompleteResponse;
  /** Dữ liệu đơn đang có trên máy, để in lại khi mất mạng. */
  detail?: PrescriptionDetail;
  printError?: string;
  printedLocally: boolean;
  onBack: () => void;
}) {
  const rx = result.prescription;
  const { client, online } = useOffline();
  // Mất mạng thì không hỏi trạng thái liên thông (giữ trạng thái đã biết).
  const live = usePoll(async () => (rx && online ? (await api.prescription(token, rx.id)).prescription.gateway : undefined), 2000, [token, rx?.id, online]);
  // Trạng thái liên thông mới nhất đã biết (giữ lại khi mất mạng).
  const [known, setKnown] = useState(rx?.gateway);
  useEffect(() => {
    if (live.data) setKnown(live.data);
  }, [live.data]);
  const gateway = known;
  // Lần in ngay sau khi ký chạy song song với màn hình này: kết quả của nó đến sau khi màn hình đã dựng.
  const [printErr, setPrintErr] = useState(printError);
  const [via, setVia] = useState<'server' | 'local'>();
  useEffect(() => setPrintErr(printError), [printError]);
  useEffect(() => {
    if (printedLocally) setVia('local');
  }, [printedLocally]);
  const seconds = result.visit.visitSeconds;

  const reprint = () => {
    if (!detail) return;
    setPrintErr(undefined);
    // Trạng thái liên thông mới nhất đã biết đi kèm bản in từ máy.
    const latest = { ...detail, prescription: { ...detail.prescription, ...(gateway ? { gateway } : {}) } };
    printSaved(token, latest, clinicName).then(
      (v) => {
        setVia(v);
        // In từ dữ liệu trên máy khi mất mạng: máy chủ có dòng nhật ký khi hàng đợi gửi "đã in" (OFF-1).
        if (v === 'local') void client.recordLocalPrint(latest.prescription.id);
      },
      (e: Error) => setPrintErr(e.message)
    );
  };

  return (
    <main className="page">
      <section className="card done" aria-labelledby="done-title" data-testid="sign-result">
        <h1 id="done-title">{rx ? 'Đã ký đơn thuốc' : 'Đã kết thúc khám'}</h1>
        {result.replayed && <p className="notice" role="status">Lượt khám này đã được lưu từ lần bấm trước: không lưu trùng.</p>}
        {rx && (
          <>
            <p>Mã đơn: <b className="mono" data-testid="rx-code">{rx.code}</b> <span className="badge warn">chữ ký số MÔ PHỎNG</span></p>
            {gateway && (
              <p data-testid="gateway-status" data-status={gateway.status}>
                Liên thông (cổng mô phỏng): <span className={`badge ${BADGE[gateway.status]}`}>{GATEWAY_LABEL[gateway.status]}</span>
                {gateway.nationalCode && <> · mã quốc gia <span className="mono">{gateway.nationalCode}</span></>}
                {gateway.attempts > 0 && gateway.status !== 'sent' && <small> · đã thử {gateway.attempts} lần</small>}
                {gateway.lastError && gateway.status !== 'sent' && <small className="error"> · {gateway.lastError}</small>}
              </p>
            )}
          </>
        )}
        {seconds !== undefined && (
          <p data-testid="visit-seconds">Thời gian phiên khám: <b>{clock(seconds)}</b> <small>({seconds} giây, mục tiêu ≤ 60 giây)</small></p>
        )}
        {via === 'local' && (
          <p className="notice" role="status" data-testid="printed-locally">Mất mạng: đã in từ dữ liệu trên máy. Trạng thái liên thông trên tờ in có thể chưa cập nhật.</p>
        )}
        {printErr && <p className="error" role="alert">Không in được: {printErr}</p>}
        <div className="actions">
          {rx && detail && <button className="secondary" onClick={reprint} data-testid="reprint">In lại đơn</button>}
          {rx && detail && <ZaloButton detail={detail} clinicName={clinicName} />}
          <button className="primary" onClick={onBack} data-testid="back-to-queue">Về hàng chờ</button>
        </div>
      </section>
    </main>
  );
}
