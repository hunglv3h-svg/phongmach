import { formatAge } from '@phongmach/rules';
import { GATEWAY_LABEL, type PrescriptionDetail } from '@phongmach/clinical';
import QRCode from 'qrcode';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Mọi chuỗi từ dữ liệu (tên, ghi chú) phải qua đây trước khi vào HTML: tên bệnh nhân là dữ liệu do người dùng nhập. */
export const esc = (s: string | number | undefined): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);

const GENDER: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác', unknown: '' };

const formatDate = (iso: string): string => {
  // Hiển thị theo giờ Việt Nam (UTC+7).
  const d = new Date(Date.parse(iso) + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

/** Nội dung mã QR trên đơn: tiền tố nhận diện + mã đơn nội bộ. Khi có cổng thật, mã quốc gia thay vào đây. */
export const qrPayload = (code: string): string => `phongmach:${code}`;

export async function renderPrescriptionHtml(detail: PrescriptionDetail, clinicName: string): Promise<string> {
  const { prescription: rx, patient, diagnoses } = detail;
  const qr = await QRCode.toString(qrPayload(rx.code), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const age = formatAge(patient.birthDate);
  const gateway = rx.gateway;
  const national = gateway?.nationalCode
    ? `Mã đơn quốc gia (mô phỏng): <b>${esc(gateway.nationalCode)}</b>`
    : `Liên thông: ${esc(gateway ? GATEWAY_LABEL[gateway.status] : 'chưa gửi')}`;
  const rows = rx.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td><b>${esc(l.name)}</b><div class="how">${esc(l.instruction)}</div></td><td class="c">${esc(l.quantity ?? '')} ${esc(l.unit)}</td></tr>`
    )
    .join('');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Đơn thuốc ${esc(rx.code)}</title>
<style>
@page { size: A5 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.35 "Times New Roman", serif; margin: 0; color: #000; }
h1 { font-size: 15pt; text-align: center; margin: 2mm 0; letter-spacing: .5px; }
.clinic { text-align: center; font-weight: bold; font-size: 12pt; }
.sim { border: 1.5px dashed #b00; color: #b00; text-align: center; font: bold 8.5pt sans-serif; padding: 1.2mm; margin: 1.5mm 0; }
.row { margin: .8mm 0; }
table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
th, td { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; }
th { background: #eee; font-size: 10pt; }
.c { text-align: center; white-space: nowrap; width: 1%; }
.how { font-size: 10pt; }
.foot { display: flex; justify-content: space-between; gap: 6mm; margin-top: 4mm; align-items: flex-start; }
.qr { width: 24mm; } .qr svg { width: 24mm; height: 24mm; display: block; }
.code { font: 8pt monospace; text-align: center; margin-top: .5mm; word-break: break-all; }
.sign { text-align: center; flex: 1; }
.sign .stamp { font: italic 8.5pt sans-serif; color: #b00; margin: 1mm 0 8mm; }
</style></head><body>
<div class="clinic">${esc(clinicName)}</div>
<h1>ĐƠN THUỐC</h1>
<div class="sim">BẢN MÔ PHỎNG: chữ ký số mô phỏng, chưa liên thông cổng quốc gia, không có giá trị pháp lý</div>
<div class="row"><b>Họ tên:</b> ${esc(patient.fullName)}${age ? ` &nbsp; <b>Tuổi:</b> ${esc(age)}` : ''}${GENDER[patient.gender ?? ''] ? ` &nbsp; <b>Giới:</b> ${esc(GENDER[patient.gender!])}` : ''}</div>
${patient.cccdMasked ? `<div class="row"><b>CCCD:</b> ${esc(patient.cccdMasked)}${patient.phone ? ` &nbsp; <b>Điện thoại:</b> ${esc(patient.phone)}` : ''}</div>` : ''}
<div class="row"><b>Chẩn đoán:</b> ${diagnoses.map((d) => `${esc(d.name)} (${esc(d.code)})`).join('; ') || '…'}</div>
<table><thead><tr><th>#</th><th>Thuốc, cách dùng</th><th>Số lượng</th></tr></thead><tbody>${rows}</tbody></table>
${rx.advice ? `<div class="row" style="margin-top:2mm"><b>Lời dặn:</b> ${esc(rx.advice)}</div>` : ''}
${rx.followUpDays ? `<div class="row"><b>Tái khám sau:</b> ${esc(rx.followUpDays)} ngày</div>` : ''}
<div class="foot">
  <div class="qr">${qr}<div class="code">${esc(rx.code)}</div></div>
  <div class="sign">
    <div>${esc(formatDate(rx.signedAt))}</div>
    <div><b>Bác sĩ khám bệnh</b></div>
    <div class="stamp">(đã ký số mô phỏng)</div>
    <div><b>${esc(rx.signerName)}</b></div>
  </div>
</div>
<div class="row" style="font:8pt sans-serif;margin-top:2mm">${national}</div>
</body></html>`;
}
