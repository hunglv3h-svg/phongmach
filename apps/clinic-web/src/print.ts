import { makePrescriptionCode, vnDay, type PrescriptionDetail } from '@phongmach/clinical';
import { renderPrescriptionHtml } from '@phongmach/print';
import { ApiError, api } from './api';
import { whileLocalStoreQuiet } from './local/store';

/**
 * In một trang HTML qua iframe ẩn. Trang in mang CSP `default-src 'none'` nên không chạy được script dù có dữ liệu độc.
 * Gọi `print()` khi kho trên máy không có thao tác IndexedDB đang dở (xem `whileLocalStoreQuiet`): Chromium bỏ mất sự kiện của
 * yêu cầu đang dở lúc in, làm treo hàng đợi đồng bộ.
 */
export async function printHtml(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-testid', 'print-frame');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  await new Promise<void>((resolve) => {
    frame.onload = () => {
      void whileLocalStoreQuiet(() => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }).finally(resolve);
    };
    document.body.appendChild(frame);
  });
  // Hộp thoại in có thể còn mở: giữ iframe một lúc rồi dọn.
  setTimeout(() => frame.remove(), 120_000);
}

/** In đơn đã lưu: tải trang do BFF dựng (có dòng nhật ký "In đơn thuốc"). */
export async function printPrescription(token: string, id: string): Promise<void> {
  await printHtml(await api.printHtml(token, id));
}

/**
 * In đơn từ dữ liệu trên máy, cùng mẫu với BFF (`@phongmach/print`), không cần mạng.
 * `pendingSync`: đơn ký khi mất mạng, máy chủ chưa nhận (trang in có nhãn riêng).
 */
export async function printLocal(detail: PrescriptionDetail, clinicName: string, pendingSync: boolean): Promise<void> {
  await printHtml(await renderPrescriptionHtml(detail, clinicName, { local: { pendingSync } }));
}

/**
 * In một đơn đã lưu trên máy chủ: qua BFF khi có mạng; mất mạng thì in từ dữ liệu đang có trên máy.
 * Trả về 'local' khi phải in từ dữ liệu trên máy (giao diện báo cho người dùng biết).
 */
export async function printSaved(token: string, detail: PrescriptionDetail, clinicName: string): Promise<'server' | 'local'> {
  let html: string;
  try {
    html = await api.printHtml(token, detail.prescription.id);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 0)) throw e;
    await printLocal(detail, clinicName, false);
    return 'local';
  }
  await printHtml(html);
  return 'server';
}

/**
 * Mã đơn sinh ở máy khách khi ký lúc mất mạng: PM-<ngày theo giờ ký, giờ Việt Nam>-<6 ký tự từ SHA-256(clientUuid)>.
 * Máy chủ tính lại đúng như vậy khi đồng bộ, nên mã in trên giấy trùng mã lưu trên máy chủ.
 */
export async function localPrescriptionCode(clientUuid: string, signedAt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientUuid.toLowerCase()));
  return makePrescriptionCode(vnDay(new Date(signedAt)), new Uint8Array(digest));
}
