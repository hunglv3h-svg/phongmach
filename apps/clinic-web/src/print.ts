import { api } from './api';

/**
 * In đơn thuốc A5: tải HTML do BFF dựng (đã thoát ký tự, có mã QR, có nhãn mô phỏng) rồi in qua iframe ẩn.
 * HTML mang CSP `default-src 'none'` nên không chạy được script dù có dữ liệu độc.
 */
export async function printPrescription(token: string, id: string): Promise<void> {
  const html = await api.printHtml(token, id);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-testid', 'print-frame');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  await new Promise<void>((resolve) => {
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        resolve();
      }
    };
    document.body.appendChild(frame);
  });
  // Hộp thoại in có thể còn mở: giữ iframe một lúc rồi dọn.
  setTimeout(() => frame.remove(), 120_000);
}
