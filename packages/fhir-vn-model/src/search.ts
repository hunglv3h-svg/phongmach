import { normalizeCccd } from './cccd.js';
import { digitsOnly, normalizePhone } from './phone.js';
import { nameTokens } from './text.js';

export type SearchIntent =
  | { kind: 'empty' }
  | { kind: 'cccd'; cccd: string }
  | { kind: 'phone'; phone: string }
  /** 3 chữ số trở lên nhưng chưa đủ một số điện thoại, ví dụ 4 số cuối. */
  | { kind: 'phone-fragment'; digits: string }
  | { kind: 'name'; tokens: string[] }
  /** Gõ lẫn tên và số trong một lần tìm ("an 5678", "nguyen van an 1985"): tên AND đoạn số (đuôi điện thoại). */
  | { kind: 'name+number'; tokens: string[]; digits: string };

const MIN_FRAGMENT = 3;

/** Chuỗi chỉ gồm số và dấu phân cách của số (không có chữ cái). */
const PURE_NUMBER = /^[\d\s.+\-()]+$/;

/** Hiểu một chuỗi toàn số/dấu: CCCD → số điện thoại đầy đủ → đoạn số → rỗng. */
function classifyNumber(q: string): SearchIntent {
  const digits = digitsOnly(q);
  const cccd = normalizeCccd(q);
  if (cccd) return { kind: 'cccd', cccd };
  const phone = normalizePhone(q);
  if (phone) return { kind: 'phone', phone };
  if (digits.length >= MIN_FRAGMENT) return { kind: 'phone-fragment', digits };
  return { kind: 'empty' };
}

/**
 * Hiểu một ô tìm kiếm duy nhất của phụ tá: gõ số điện thoại, 4 số cuối, CCCD, tên (có dấu hay không đều được),
 * hoặc gõ lẫn tên và số ("an 5678": tên "an" AND số điện thoại kết thúc "5678"). 4 chữ số là đuôi điện thoại, không phải năm sinh.
 */
export function classifyQuery(raw: string): SearchIntent {
  const q = raw.trim();
  if (!q) return { kind: 'empty' };

  if (PURE_NUMBER.test(q)) return classifyNumber(q);

  // Chuỗi lẫn: tách các mảnh toàn-số khỏi phần tên. Một mảnh là "số" khi chỉ gồm chữ số (không chữ cái, không dấu);
  // "an5678" (dính liền) KHÔNG tách vì digitsOnly('an5678') !== 'an5678' nên vẫn là một token của tên.
  const parts = q.split(/\s+/).filter(Boolean);
  const nameParts = parts.filter((p) => digitsOnly(p) !== p);
  const digits = parts.filter((p) => digitsOnly(p) === p).map((p) => digitsOnly(p)).join('');
  const tokens = nameTokens(nameParts.join(' '));

  if (!digits) return tokens.length ? { kind: 'name', tokens } : { kind: 'empty' };
  // Có mảnh số nhưng không có token tên: coi như số thuần, để "345 678" nhất quán với "345678".
  if (!tokens.length) return classifyNumber(digits);
  // Có cả tên lẫn số: đoạn số quá ngắn thì bỏ (dễ nhiễu), chỉ tìm tên.
  if (digits.length < MIN_FRAGMENT) return { kind: 'name', tokens };
  return { kind: 'name+number', tokens, digits };
}
