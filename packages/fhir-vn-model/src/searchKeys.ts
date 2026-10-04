import type { Coding, Patient } from '@medplum/fhirtypes';
import { SEARCH_TAGS } from './identifiers.js';
import { digitsOnly } from './phone.js';
import { nameTokens } from './text.js';

/** Số chữ số cuối của số điện thoại được ghi thành khóa tìm. */
export const PHONE_SUFFIX_LENGTH = 4;

const OWN_SYSTEMS: readonly string[] = Object.values(SEARCH_TAGS);

/**
 * Khóa tìm chính xác của một bệnh nhân: mỗi từ của tên (không dấu, chữ thường) và 4 số cuối của từng số điện thoại.
 * Tính từ chính nội dung hồ sơ nên tính lại bao nhiêu lần cũng ra cùng kết quả.
 */
export function searchKeys(patient: Patient): Coding[] {
  const words = new Set<string>();
  for (const name of patient.name ?? []) {
    for (const word of nameTokens([name.family, ...(name.given ?? [])].filter(Boolean).join(' '))) words.add(word);
  }
  const suffixes = new Set<string>();
  for (const contact of patient.telecom ?? []) {
    const digits = contact.system === 'phone' ? digitsOnly(contact.value ?? '') : '';
    if (digits.length >= PHONE_SUFFIX_LENGTH) suffixes.add(digits.slice(-PHONE_SUFFIX_LENGTH));
  }
  return [
    ...[...words].map((code) => ({ system: SEARCH_TAGS.nameWord, code })),
    ...[...suffixes].map((code) => ({ system: SEARCH_TAGS.phoneSuffix, code })),
  ];
}

/**
 * Bản sao của hồ sơ với `meta.tag` mang đúng các khóa tìm hiện tại; tag của hệ khác giữ nguyên.
 * Medplum thay cả `meta.tag` mỗi lần ghi (PUT không gửi tag là mất tag), nên MỌI lần tạo hay sửa Patient phải đi qua hàm này.
 */
export function withSearchKeys(patient: Patient): Patient {
  const others = (patient.meta?.tag ?? []).filter((t) => !OWN_SYSTEMS.includes(t.system ?? ''));
  return { ...patient, meta: { ...patient.meta, tag: [...others, ...searchKeys(patient)] } };
}

/** Hồ sơ đã mang đủ và đúng khóa tìm chưa (hồ sơ tạo trước khi có khóa tìm thì chưa). */
export function hasSearchKeys(patient: Patient): boolean {
  const key = (t: Coding) => `${t.system}|${t.code}`;
  const current = (patient.meta?.tag ?? []).filter((t) => OWN_SYSTEMS.includes(t.system ?? '')).map(key).sort();
  const wanted = searchKeys(patient).map(key).sort();
  return current.length === wanted.length && current.every((k, i) => k === wanted[i]);
}

/** Giá trị tham số `_tag` tìm chính xác một từ của tên (từ đã bỏ dấu, chữ thường, như `nameTokens` trả về). */
export function nameWordTag(word: string): string {
  return `${SEARCH_TAGS.nameWord}|${word}`;
}

/**
 * Giá trị tham số `_tag` ra mọi người có số điện thoại KẾT THÚC bằng đoạn số đã gõ (từ 3 chữ số, như `classifyQuery` bảo đảm).
 * Khóa lưu là 4 số cuối. Đoạn dài hơn 4 thì tìm theo 4 số cuối của đoạn, người gọi lọc lại bằng `endsWith`;
 * đoạn 3 số thì tìm cả 10 khả năng của chữ số đứng trước (các giá trị cách nhau dấu phẩy là OR).
 */
export function phoneSuffixTagQuery(digits: string): string {
  if (digits.length >= PHONE_SUFFIX_LENGTH) return `${SEARCH_TAGS.phoneSuffix}|${digits.slice(-PHONE_SUFFIX_LENGTH)}`;
  const missing = PHONE_SUFFIX_LENGTH - digits.length;
  return Array.from({ length: 10 ** missing }, (_, n) => `${SEARCH_TAGS.phoneSuffix}|${String(n).padStart(missing, '0')}${digits}`).join(',');
}

/**
 * Xếp kết quả tìm tên: người có đủ từng từ đã gõ (khớp đúng cả từ) lên trước người chỉ khớp đầu từ
 * ("bui an": Bùi Văn An trước Bùi Thị Anh). Giữ nguyên thứ tự trong mỗi nhóm.
 */
export function rankByNameWords<T extends { fullName: string }>(items: T[], tokens: string[]): T[] {
  const score = (item: T) => {
    const words = nameTokens(item.fullName);
    return tokens.every((t) => words.includes(t)) ? 0 : 1;
  };
  return [...items].sort((a, b) => score(a) - score(b));
}
