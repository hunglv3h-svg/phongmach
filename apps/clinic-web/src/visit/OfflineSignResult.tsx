import { useEffect, useState } from 'react';
import type { CompleteResponse, RulesRejected } from '../api';
import { clock } from '../format';
import type { SignOutcome } from '../local/client';
import type { AnyOp } from '../local/ops';
import { useOffline } from '../local/OfflineProvider';
import { printLocal, printSaved } from '../print';

type SyncView = { status: 'pending' | 'done' | 'conflict' | 'rules' | 'error' | 'held'; op?: AnyOp };

const ATTENTION = new Set(['conflict', 'rules', 'error']);

/**
 * Kết quả ký khi mất mạng: đơn đã lưu bền trên máy và đã in từ dữ liệu trên máy (nhãn "KÝ KHI MẤT MẠNG").
 * Theo dõi mục hoàn tất trong hàng đợi: chờ đồng bộ → đã đồng bộ, hoặc cần xử lý (OFF-7). Danh sách đầy đủ ở lát 4.
 */
export function OfflineSignResult({ result, onBack }: { result: Extract<SignOutcome, { kind: 'offline' }>; onBack: () => void }) {
  const { client, sync, online } = useOffline();
  const { opId, detail } = result;
  const [view, setView] = useState<SyncView>({ status: 'pending' });
  const [printErr, setPrintErr] = useState(result.printError);
  const [reprinted, setReprinted] = useState(false);

  useEffect(() => {
    let live = true;
    void client.engine.ops().then((ops) => {
      const op = ops.find((o) => o.id === opId);
      if (!live) return;
      if (!op) return setView({ status: 'pending' });
      if (op.meta.status === 'done' || ATTENTION.has(op.meta.status)) return setView({ status: op.meta.status as SyncView['status'], op });
      // Mục hoàn tất bị giữ vì một mục trước nó (cấp số, mở hồ sơ) đang cần xử lý.
      const blocker = ops.find((o) => op.meta.deps.includes(o.id) && ATTENTION.has(o.meta.status));
      setView(blocker ? { status: 'held', op: blocker } : { status: 'pending', op });
    });
    return () => {
      live = false;
    };
  }, [client, opId, sync.version]);

  const server = view.status === 'done' ? (view.op?.body.result as CompleteResponse | undefined) : undefined;
  const serverRx = server?.prescription;
  const seconds = server?.visit.visitSeconds;

  const reprint = async () => {
    if (!detail) return;
    setPrintErr(undefined);
    try {
      if (serverRx && online) {
        // Đã đồng bộ và có mạng: in qua máy chủ như mọi đơn khác (máy chủ ghi nhật ký in).
        const via = await printSaved(client.auth().token, { ...detail, prescription: { ...detail.prescription, ...serverRx } }, client.clinicName());
        if (via === 'local') await client.recordLocalPrint(serverRx.id);
      } else {
        await printLocal(detail, client.clinicName(), !serverRx);
        await client.recordLocalPrint(detail.prescription.id, opId);
      }
      setReprinted(true);
    } catch (e) {
      setPrintErr((e as Error).message);
    }
  };

  const error = view.op?.body.error;
  return (
    <main className="page">
      <section className="card done" aria-labelledby="done-title" data-testid="offline-sign-result">
        <h1 id="done-title">{detail ? 'Đã ký đơn khi mất mạng' : 'Đã kết thúc khám khi mất mạng'}</h1>
        <p className="offline-note">Đã lưu trên máy này (mã hóa){detail ? ' và in từ dữ liệu trên máy' : ''}. Máy sẽ tự gửi lên máy chủ khi có mạng; gửi lại nhiều lần cũng không lưu trùng.</p>
        {detail && (
          <p>
            Mã đơn: <b className="mono" data-testid="rx-code">{detail.prescription.code}</b> <span className="badge warn">chữ ký số MÔ PHỎNG</span> <span className="badge warn">chưa liên thông</span>
          </p>
        )}
        <p data-testid="offline-sync-state" data-status={view.status}>
          Đồng bộ:{' '}
          {view.status === 'pending' && <span className="badge warn">Chờ đồng bộ</span>}
          {view.status === 'done' && <span className="badge ok">Đã đồng bộ lên máy chủ</span>}
          {view.status === 'conflict' && <span className="badge bad">Xung đột</span>}
          {view.status === 'rules' && <span className="badge bad">Cần bác sĩ xác nhận</span>}
          {view.status === 'error' && <span className="badge bad">Cần xử lý</span>}
          {view.status === 'held' && <span className="badge bad">Bị giữ: thao tác trước đó cần xử lý</span>}
        </p>
        {serverRx && detail && serverRx.code !== detail.prescription.code && (
          <p className="error" role="alert" data-testid="code-mismatch">
            Mã đơn trên máy chủ ({serverRx.code}) khác mã đã in ({detail.prescription.code}) vì đồng hồ máy này lệch qua nửa đêm. Hãy in lại đơn.
          </p>
        )}
        {(view.status === 'conflict' || view.status === 'held') && (
          <p className="error" role="alert" data-testid="sync-conflict">
            Lượt khám này đã do người khác mở hoặc kết thúc khi bạn mất mạng; kết quả khám của bạn chưa được lưu lên hệ thống. Bản khám vẫn giữ trên máy và in lại được.
            {error?.message ? ` (${error.message})` : ''}
          </p>
        )}
        {view.status === 'rules' && (
          <div className="error" role="alert" data-testid="sync-rules">
            Máy chủ kiểm tra lại và cần bác sĩ xác nhận trước khi lưu đơn (đơn đã in: liên hệ bệnh nhân nếu cần đổi thuốc):
            <ul>{((error?.body as RulesRejected | undefined)?.unacknowledged ?? []).map((f) => <li key={f.key}>{f.message}</li>)}</ul>
          </div>
        )}
        {view.status === 'error' && <p className="error" role="alert">{error?.message}</p>}
        {seconds !== undefined && <p data-testid="visit-seconds">Thời gian phiên khám (đo ở máy này): <b>{clock(seconds)}</b> <small>({seconds} giây)</small></p>}
        {printErr && <p className="error" role="alert">Không in được: {printErr}</p>}
        {reprinted && <p className="notice" role="status">Đã in lại.</p>}
        <div className="actions">
          {detail && <button className="secondary" onClick={() => void reprint()} data-testid="reprint">In lại đơn</button>}
          <button className="primary" onClick={onBack} data-testid="back-to-queue">Về hàng chờ</button>
        </div>
      </section>
    </main>
  );
}

