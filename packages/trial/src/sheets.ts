// Phiếu ca: mỗi ca một trang cho người đóng vai bệnh nhân, sinh từ bộ ca (không soạn tay). Hai dạng cùng một nội dung:
// Markdown để cố vấn y khoa đọc và duyệt trên kho mã, HTML để in (mỗi ca một trang A4).
import { TEMPLATES, formatNumber, getDrug, getIcd10, allergyClassLabel, type LineInput } from '@phongmach/catalogs';
import { SPECIALTY_LABEL, type Specialty, type VitalsInput } from '@phongmach/clinical';
import type { RuleId } from '@phongmach/rules';
import { REQUIRED_SCENARIOS, SCENARIO_LABEL, TRIAL_NOTICE, TRIAL_REFERENCE_DAY, type Step, type TrialCase } from './types.js';

export const RULE_LABEL: Record<RuleId, string> = {
  'no-diagnosis': 'chưa chọn chẩn đoán (chặn ký)',
  'no-lines': 'đơn chưa có thuốc (chặn ký)',
  'unknown-drug': 'thuốc không có trong danh mục (chặn ký)',
  'incomplete-line': 'thiếu liều hoặc số lượng (chặn ký cho tới khi nhập)',
  'max-days': 'vượt số ngày tối đa (chặn ký)',
  'duplicate-ingredient': 'trùng hoạt chất',
  allergy: 'dị ứng thuốc',
  'no-cccd': 'thiếu CCCD (chặn ký)',
  'no-birthdate': 'chưa có ngày sinh',
  'no-weight': 'trẻ chưa được ghi cân nặng',
  'paediatric-form': 'dạng viên cho trẻ nhỏ',
  'allergy-unknown': 'chưa rõ dị ứng (mở hồ sơ lúc mất mạng)',
};

const vnDate = (day: string) => day.split('-').reverse().join('/');
const drugName = (code: string) => getDrug(code)?.name ?? code;
const dxName = (code: string) => `${code} ${getIcd10(code)?.name ?? ''}`.trim();

function vitalsText(v: VitalsInput, child: boolean): string[] {
  const out: string[] = [];
  if (v.temperatureC !== undefined) out.push(`Nhiệt độ: ${formatNumber(v.temperatureC)} °C`);
  if (v.pulse !== undefined) out.push(`Mạch: ${v.pulse} lần/phút`);
  if (v.systolic !== undefined && v.diastolic !== undefined) out.push(`Huyết áp: ${v.systolic}/${v.diastolic} mmHg`);
  if (v.respiratoryRate !== undefined) out.push(`Nhịp thở: ${v.respiratoryRate} lần/phút`);
  if (v.spo2 !== undefined) out.push(`SpO2: ${v.spo2} %`);
  if (v.weightKg !== undefined) out.push(`Cân nặng: ${formatNumber(v.weightKg)} kg`);
  else if (child) out.push('Cân nặng: CHƯA CÂN (để trống)');
  return out;
}

function lineText(l: LineInput): string {
  const dose = l.perDose !== undefined && l.timesPerDay !== undefined && l.days !== undefined ? `${formatNumber(l.perDose)} x ${l.timesPerDay} lần/ngày x ${l.days} ngày` : undefined;
  const quantity = l.quantity !== undefined ? `số lượng ${formatNumber(l.quantity)}` : undefined;
  return [drugName(l.drug), dose ?? quantity].filter(Boolean).join(': ');
}

export function stepText(s: Step): string {
  switch (s.do) {
    case 'dx':
      return `Gõ chẩn đoán "${s.query}", Enter: ${dxName(s.code)}`;
    case 'template':
      return `Chọn đơn mẫu "${TEMPLATES.find((t) => t.id === s.id)?.name ?? s.id}"`;
    case 'repeat':
      return 'Bấm "Kê lại đơn này" ở lượt khám cũ (cột bên trái)';
    case 'add':
      return `Thêm thuốc: gõ "${s.query}", Enter: ${drugName(s.drug)}`;
    case 'remove':
      return `Bỏ ${drugName(s.drug)} (nút × ở dòng thuốc)`;
    case 'set': {
      const parts = [s.perDose && `liều/lần ${s.perDose}`, s.timesPerDay && `lần/ngày ${s.timesPerDay}`, s.days && `số ngày ${s.days}`, s.quantity && `số lượng ${s.quantity}`].filter(Boolean);
      return `${drugName(s.drug)}: nhập ${parts.join(', ')}`;
    }
    case 'weight':
      return `Hỏi người nhà rồi nhập cân nặng ${s.kg} kg`;
    case 'expect':
      return `Máy hiện cảnh báo: ${RULE_LABEL[s.rule]}`;
    case 'ack':
      return `Ghi lý do ở cảnh báo "${RULE_LABEL[s.rule]}": "${s.reason}"`;
  }
}

interface Section {
  title: string;
  lines: string[];
}

export interface Sheet {
  id: string;
  heading: string;
  warmup: boolean;
  sections: Section[];
}

/** Nội dung một phiếu ca, dạng trung gian dùng chung cho Markdown và HTML. */
export function toSheet(c: TrialCase): Sheet {
  const child = c.specialty === 'nhi';
  const p = c.patient;
  const record = [
    c.allergies.length ? `Dị ứng: ${c.allergies.map((a) => (a.kind === 'class' ? allergyClassLabel(a.value) : (a.label ?? a.value))).join('; ')}` : 'Dị ứng: chưa ghi nhận',
    ...(c.history.length ? [`Tiền sử: ${c.history.join('; ')}`] : []),
    ...(c.prior
      ? [`Một lượt khám cũ (hơn 3 tháng trước, bác sĩ khác khám): ${c.prior.dx.map(dxName).join('; ')}. Đơn: ${c.prior.lines.map(lineText).join('; ')}`]
      : ['Lịch sử khám: lần đầu đến khám']),
  ];
  const final = c.final.lines.map((l) => drugName(l.drug)).join('; ');
  return {
    id: c.id,
    heading: `${c.id} · ${SPECIALTY_LABEL[c.specialty]} · ${c.title}`,
    warmup: c.warmup,
    sections: [
      {
        title: 'Người đóng vai',
        lines: [
          `Bệnh nhân: ${p.fullName}, ${p.gender === 'male' ? 'nam' : 'nữ'}, ${p.ageLabel} (sinh ${vnDate(p.birthDate)})`,
          ...(c.companion ? [`Người đi cùng, nói chuyện với bác sĩ: ${c.companion}`] : []),
          `Lý do đến khám (đã ghi lúc cấp số): ${c.reason}`,
        ],
      },
      { title: 'Kể với bác sĩ', lines: c.story },
      { title: 'Chỉ nói khi bác sĩ hỏi', lines: c.ifAsked },
      { title: 'Phiếu điều dưỡng (đưa cho bác sĩ khi vào khám)', lines: vitalsText(c.vitals, child) },
      { title: 'Kết quả khám (điều phối viên đọc khi bác sĩ khám)', lines: [c.findings] },
      { title: 'Đã có sẵn trong hồ sơ trên máy', lines: record },
      {
        title: 'Dành cho điều phối viên (không đọc cho bác sĩ)',
        lines: [
          `Tình huống: ${c.scenarios.map((s) => SCENARIO_LABEL[s]).join('; ')}`,
          c.note,
          `Đường đi của bài diễn tập kỹ thuật (bác sĩ tự quyết định, không phải hướng dẫn điều trị): ${[...c.steps.map(stepText), 'Bấm "Ký & In"'].map((t, i) => `(${i + 1}) ${t}`).join(' ')}`,
          `Đơn cuối của bài diễn tập: ${c.final.dx.map(dxName).join('; ')}. Thuốc: ${final}`,
        ],
      },
      { title: 'Cố vấn y khoa duyệt', lines: ['[ ] Dùng được   [ ] Cần sửa: ............................................................', 'Người duyệt, ngày: ....................................'] },
    ],
  };
}

const order = (cases: readonly TrialCase[], specialty: Specialty) => cases.filter((c) => c.specialty === specialty);

/** Tài liệu Markdown của cả bộ ca: bảng tổng quan, bảng phủ tình huống, rồi từng phiếu. */
export function renderMarkdown(cases: readonly TrialCase[]): string {
  const out: string[] = [
    '# Bộ ca khám mô phỏng cho phiên thử với bác sĩ (M0-1)',
    '',
    `> **${TRIAL_NOTICE}**`,
    '>',
    '> Tệp này sinh từ `packages/trial/src/cases-noi.ts` và `cases-nhi.ts` bằng lệnh `pnpm trial sheets`. Không sửa tay: sửa dữ liệu rồi sinh lại (có kiểm thử giữ hai bên khớp nhau).',
    `> Tuổi ghi trên phiếu tính đến ${vnDate(TRIAL_REFERENCE_DAY)}. Tên và ngày sinh đều là giả. Bản in mỗi ca một trang: xem \`docs/phien-thu-bac-si.md\`.`,
    '',
    '## Tổng quan',
    '',
    '| Ca | Chuyên khoa | Nội dung | Tình huống | Tính số đo |',
    '|---|---|---|---|---|',
    ...cases.map((c) => `| ${c.id} | ${SPECIALTY_LABEL[c.specialty]} | ${c.title} | ${c.scenarios.map((s) => SCENARIO_LABEL[s]).join('; ')} | ${c.warmup ? 'Không (làm quen)' : 'Có'} |`),
    '',
    '## Phủ tình huống (chỉ tính ca có số đo)',
    '',
    '| Tình huống | Nội tổng quát | Nhi |',
    '|---|---|---|',
    ...REQUIRED_SCENARIOS.map((s) => {
      const ids = (sp: Specialty) => order(cases, sp).filter((c) => !c.warmup && c.scenarios.includes(s)).map((c) => c.id).join(', ') || 'không áp dụng';
      return `| ${SCENARIO_LABEL[s]} | ${ids('noi')} | ${ids('nhi')} |`;
    }),
    '',
  ];
  for (const specialty of ['noi', 'nhi'] as const) {
    out.push(`## ${SPECIALTY_LABEL[specialty]}`, '');
    for (const c of order(cases, specialty)) {
      const sheet = toSheet(c);
      out.push(`### ${sheet.heading}`, '', `*${TRIAL_NOTICE}*${sheet.warmup ? ' **Ca làm quen: không tính vào số đo.**' : ''}`, '');
      for (const s of sheet.sections) out.push(`**${s.title}**`, '', ...s.lines.map((l) => `- ${l}`), '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Trang in: mỗi ca một trang A4. Không có script, không tải gì từ ngoài. */
export function renderHtml(cases: readonly TrialCase[], title: string): string {
  const sheets = cases.map(toSheet);
  const body = sheets
    .map(
      (sheet) => `<section class="sheet">
<header><h1>${esc(sheet.heading)}</h1>${sheet.warmup ? '<p class="warmup">CA LÀM QUEN · không tính vào số đo</p>' : ''}<p class="notice">${esc(TRIAL_NOTICE)}</p></header>
${sheet.sections.map((s, i) => `<div class="block b${i}"><h2>${esc(s.title)}</h2><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('\n')}
</section>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.35 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
.sheet { break-after: page; page-break-after: always; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
h1 { font-size: 14pt; margin: 0 0 2mm; }
h2 { font-size: 10.5pt; margin: 3mm 0 1mm; text-transform: uppercase; letter-spacing: .02em; }
ul { margin: 0; padding-left: 5mm; }
li { margin: 0 0 .6mm; }
.notice { border: 1.5pt solid #b00; color: #b00; font-weight: 700; padding: 1.5mm 2mm; margin: 0 0 2mm; }
.warmup { background: #111; color: #fff; font-weight: 700; padding: 1mm 2mm; margin: 0 0 2mm; display: inline-block; }
.b6 { border-top: 1pt dashed #555; margin-top: 4mm; padding-top: 1mm; font-size: 9pt; color: #333; }
.b7 { font-size: 9pt; }
.b7 ul { list-style: none; padding-left: 0; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
