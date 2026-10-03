import { zaloPrescriptionMessage, type PrescriptionDetail } from '@phongmach/clinical';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Nhãn của hộp thoại (KH 5.1: mọi phần mô phỏng có nhãn trên màn hình). */
export const ZALO_SIMULATED_LABEL = 'MÔ PHỎNG: không có tin nhắn nào được gửi';

/**
 * Bản xem trước tin Zalo gửi đơn (M0: mô phỏng, không gửi). Chỉ dựng từ dữ liệu đang có trên màn hình: thành phần không nhận
 * token hay hàng đợi, nên không gọi mạng, không ghi hàng đợi đồng bộ, không sinh dòng nhật ký truy cập, và mất mạng vẫn mở được.
 * Gửi thật (ZNS) là việc của M1 (T-ZALO), dùng lại `zaloPrescriptionMessage`.
 */
export function ZaloPreview({ detail, clinicName, onClose }: { detail: PrescriptionDetail; clinicName: string; onClose: () => void }) {
  const msg = zaloPrescriptionMessage(detail, clinicName);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop">
      <section className="card dialog" role="dialog" aria-modal="true" aria-labelledby="zalo-title" data-testid="zalo-preview">
        <h2 id="zalo-title">Xem trước tin nhắn Zalo</h2>
        <p className="badge warn zalo-simulated" data-testid="zalo-simulated">{ZALO_SIMULATED_LABEL}</p>
        <p data-testid="zalo-recipient">
          Gửi tới (Zalo): {msg.recipient ? <b className="mono">{msg.recipient}</b> : <span className="muted">chưa có số điện thoại hợp lệ: bản thật sẽ không gửi được</span>}
        </p>
        <div className="zalo-message" data-testid="zalo-message">
          {msg.lines.map((line, i) => <p key={i}>{line}</p>)}
        </div>
        <p className="muted small" data-testid="zalo-why">
          Tin nhắn không có tên thuốc hay chẩn đoán: gửi dữ liệu sức khỏe qua bên thứ ba (Zalo) cần bệnh nhân đồng ý và mẫu tin ZNS được duyệt.
          Đó là việc của M1 (T-ZALO, T-CONSENT) và cần ý kiến pháp chế.
        </p>
        <div className="actions">
          <button className="primary" ref={close} onClick={onClose} data-testid="zalo-close">Đóng</button>
        </div>
      </section>
    </div>
  );
}

/** Nút "Gửi đơn qua Zalo" ở màn hình kết quả ký: chỉ mở bản xem trước. */
export function ZaloButton({ detail, clinicName }: { detail: PrescriptionDetail; clinicName: string }) {
  const [open, setOpen] = useState(false);
  // Màn hình kết quả ký dựng lại mỗi 2 giây (trạng thái liên thông): giữ cùng một hàm đóng để hộp thoại không lấy lại tiêu điểm.
  const onClose = useCallback(() => setOpen(false), []);
  return (
    <>
      <button className="secondary" onClick={() => setOpen(true)} data-testid="zalo-open">
        Gửi đơn qua Zalo <span className="badge warn">MÔ PHỎNG</span>
      </button>
      {open && <ZaloPreview detail={detail} clinicName={clinicName} onClose={onClose} />}
    </>
  );
}
