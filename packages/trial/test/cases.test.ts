import { readFileSync } from 'node:fs';
import { TEMPLATES, getDrug, getIcd10, resolveLine, searchDrugs, searchIcd10, type LineInput } from '@phongmach/catalogs';
import { ageInYears, formatAge, DEFAULT_RULES_CONFIG } from '@phongmach/rules';
import { describe, expect, it } from 'vitest';
import {
  ALL_CASES,
  M01_MIN_VISITS,
  NHI_CASES,
  NOI_CASES,
  REQUIRED_SCENARIOS,
  TRIAL_NOTICE,
  TRIAL_REFERENCE_DAY,
  TRIAL_WINDOW,
  casesOf,
  renderHtml,
  renderMarkdown,
  toSheet,
  type TrialCase,
} from '../src/index.js';

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const drugsOf = (c: TrialCase): string[] => [
  ...c.steps.flatMap((s) => ('drug' in s ? [s.drug] : [])),
  ...c.final.lines.map((l) => l.drug),
  ...(c.prior?.lines.map((l) => l.drug) ?? []),
];
const dxOf = (c: TrialCase): string[] => [...c.final.dx, ...(c.prior?.dx ?? []), ...c.steps.flatMap((s) => (s.do === 'dx' ? [s.code] : []))];

describe('bộ ca của phiên thử', () => {
  it('mỗi chuyên khoa có ít nhất 12 ca tính số đo (đủ 10 lượt mỗi bác sĩ, có dư) và 2–3 ca làm quen', () => {
    for (const specialty of ['noi', 'nhi'] as const) {
      expect(casesOf(specialty, false).length).toBeGreaterThanOrEqual(12);
      expect(casesOf(specialty, false).length).toBeGreaterThanOrEqual(M01_MIN_VISITS + 2);
      expect(casesOf(specialty, true).length).toBeGreaterThanOrEqual(2);
      expect(casesOf(specialty, true).length).toBeLessThanOrEqual(3);
    }
    expect(NOI_CASES.every((c) => c.specialty === 'noi')).toBe(true);
    expect(NHI_CASES.every((c) => c.specialty === 'nhi')).toBe(true);
  });

  it('mã ca và tên bệnh nhân không trùng; ca làm quen đứng trước ca tính số đo', () => {
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(new Set(ALL_CASES.map((c) => c.patient.fullName)).size).toBe(ALL_CASES.length);
    for (const specialty of ['noi', 'nhi'] as const) {
      const flags = casesOf(specialty).map((c) => c.warmup);
      expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    }
    for (const c of ALL_CASES) expect(c.id, 'ca làm quen có chữ L trong mã').toMatch(c.warmup ? /^[NP]L\d$/ : /^[NP]\d\d$/);
  });

  it('phủ các tình huống của đề bài bằng ca tính số đo; "trẻ em thiếu cân nặng" chỉ áp dụng cho nhi', () => {
    for (const s of REQUIRED_SCENARIOS) {
      expect(casesOf('nhi', false).some((c) => c.scenarios.includes(s)), `nhi thiếu tình huống ${s}`).toBe(true);
      if (s !== 'thieu-can-nang') expect(casesOf('noi', false).some((c) => c.scenarios.includes(s)), `nội thiếu tình huống ${s}`).toBe(true);
    }
  });

  it('mọi thuốc, mã ICD-10 và đơn mẫu dùng trong bộ ca đều có trong danh mục', () => {
    for (const c of ALL_CASES) {
      for (const code of drugsOf(c)) expect(getDrug(code), `${c.id}: thuốc ${code}`).toBeDefined();
      for (const code of dxOf(c)) expect(getIcd10(code), `${c.id}: ICD-10 ${code}`).toBeDefined();
      for (const s of c.steps) if (s.do === 'template') expect(TEMPLATES.some((t) => t.id === s.id), `${c.id}: đơn mẫu ${s.id}`).toBe(true);
    }
  });

  it('gõ tắt trong bài diễn tập ra đúng kết quả đầu tiên (Enter chọn kết quả đầu)', () => {
    for (const c of ALL_CASES) {
      for (const s of c.steps) {
        if (s.do === 'dx') expect(searchIcd10(s.query, 8)[0]?.code, `${c.id}: chẩn đoán "${s.query}"`).toBe(s.code);
        if (s.do === 'add') expect(searchDrugs(s.query, 8)[0]?.code, `${c.id}: thuốc "${s.query}"`).toBe(s.drug);
      }
    }
  });

  it('tuổi ghi trên phiếu khớp ngày sinh; người từ 14 tuổi có CCCD, trẻ nhỏ hơn thì không', () => {
    for (const c of ALL_CASES) {
      expect(c.patient.ageLabel, c.id).toBe(formatAge(c.patient.birthDate, at(TRIAL_REFERENCE_DAY)));
      const age = ageInYears(c.patient.birthDate, at(TRIAL_REFERENCE_DAY))!;
      expect(c.patient.hasCccd, `${c.id}: ${age} tuổi`).toBe(age >= DEFAULT_RULES_CONFIG.cccdMinAgeYears);
      expect(age < 16, `${c.id}: chuyên khoa theo tuổi`).toBe(c.specialty === 'nhi');
    }
  });

  it('trong suốt khoảng thử, không ca nào vượt qua một ngưỡng tuổi của quy tắc kê đơn', () => {
    const { paediatricFormUnderYears, weightRequiredUnderYears, cccdMinAgeYears } = DEFAULT_RULES_CONFIG;
    for (const c of ALL_CASES) {
      const from = ageInYears(c.patient.birthDate, at(TRIAL_WINDOW.from))!;
      const to = ageInYears(c.patient.birthDate, at(TRIAL_WINDOW.to))!;
      for (const limit of [paediatricFormUnderYears, weightRequiredUnderYears, cccdMinAgeYears]) {
        expect(from < limit, `${c.id}: ${from} → ${to} tuổi, ngưỡng ${limit}`).toBe(to < limit);
      }
    }
  });

  it('lượt khám cũ nạp sẵn nằm ngoài mọi khoảng của "Thời gian khám" (hơn 90 ngày) và có đơn đầy đủ để kê lại', () => {
    const withPrior = ALL_CASES.filter((c) => c.prior);
    expect(withPrior.length).toBeGreaterThan(0);
    for (const c of withPrior) {
      expect(c.prior!.daysAgo, c.id).toBeGreaterThan(90);
      expect(c.steps.some((s) => s.do === 'repeat'), `${c.id}: có lượt khám cũ thì phải dùng "kê lại"`).toBe(true);
      for (const line of c.prior!.lines as LineInput[]) {
        const r = resolveLine(getDrug(line.drug)!, line);
        expect(r.instruction, `${c.id}: ${line.drug} thiếu cách dùng`).not.toBe('');
        expect(r.quantity, `${c.id}: ${line.drug} thiếu số lượng`).toBeGreaterThan(0);
      }
    }
    for (const c of ALL_CASES.filter((x) => x.steps.some((s) => s.do === 'repeat'))) expect(c.prior, `${c.id}: "kê lại" cần lượt khám cũ`).toBeDefined();
  });

  it('phiếu điều dưỡng: trẻ thiếu cân nặng thì không có cân nặng, các ca khác đều có', () => {
    for (const c of ALL_CASES) {
      expect(c.vitals.weightKg === undefined, c.id).toBe(c.scenarios.includes('thieu-can-nang'));
    }
  });
});

describe('phiếu ca', () => {
  it('phiếu nào cũng ghi rõ là dữ liệu minh họa chưa duyệt, và có chỗ cho cố vấn y khoa ký duyệt', () => {
    const html = renderHtml(ALL_CASES, 'Phiếu ca');
    expect(html.split('<section class="sheet">').length - 1).toBe(ALL_CASES.length);
    expect(html.split(TRIAL_NOTICE).length - 1).toBe(ALL_CASES.length);
    const markdown = renderMarkdown(ALL_CASES);
    // Một lần ở đầu tệp và một lần trên mỗi phiếu.
    expect(markdown.split(TRIAL_NOTICE).length - 1).toBe(ALL_CASES.length + 1);
    for (const c of ALL_CASES) {
      const sheet = toSheet(c);
      expect(sheet.sections.at(-1)!.title).toBe('Cố vấn y khoa duyệt');
      expect(sheet.sections.some((s) => s.title.startsWith('Dành cho điều phối viên'))).toBe(true);
    }
  });

  it('trang in không có script và thoát ký tự HTML trong nội dung', () => {
    const tricky: TrialCase = { ...ALL_CASES[0]!, story: ['<script>alert(1)</script> & "x"'] };
    const html = renderHtml([tricky], 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(html).toContain("default-src 'none'");
  });

  it('ca làm quen được đánh dấu trên phiếu', () => {
    for (const c of ALL_CASES) expect(renderHtml([c], 'x').includes('CA LÀM QUEN'), c.id).toBe(c.warmup);
  });

  it('tệp docs/phien-thu/ca-mo-phong.md khớp với bộ ca (sinh lại bằng "pnpm trial sheets")', () => {
    const committed = readFileSync(new URL('../../../docs/phien-thu/ca-mo-phong.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderMarkdown(ALL_CASES));
  });
});
