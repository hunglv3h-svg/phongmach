import { GATEWAY_LABEL, type GatewayStatus } from '@phongmach/clinical';
import { useState } from 'react';
import { api, type CompleteResponse } from '../api';
import { usePoll } from '../hooks';
import { clock } from '../format';
import { printPrescription } from '../print';

const BADGE: Record<GatewayStatus, string> = { signed: 'warn', sending: 'warn', retry: 'warn', sent: 'ok', failed: 'bad' };

/** Kết quả sau khi ký: mã đơn, trạng thái liên thông (tự cập nhật), thời gian phiên khám, in lại. */
export function SignResult({ token, result, printError, onBack }: { token: string; result: CompleteResponse; printError?: string; onBack: () => void }) {
  const rx = result.prescription;
  const live = usePoll(async () => (rx ? (await api.prescription(token, rx.id)).prescription.gateway : undefined), 2000, [token, rx?.id]);
  const gateway = live.data ?? rx?.gateway;
  const [printErr, setPrintErr] = useState(printError);
  const seconds = result.visit.visitSeconds;

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
        {printErr && <p className="error" role="alert">Không in được: {printErr}</p>}
        <div className="actions">
          {rx && <button className="secondary" onClick={() => { setPrintErr(undefined); printPrescription(token, rx.id).catch((e: Error) => setPrintErr(e.message)); }} data-testid="reprint">In lại đơn</button>}
          <button className="primary" onClick={onBack} data-testid="back-to-queue">Về hàng chờ</button>
        </div>
      </section>
    </main>
  );
}
