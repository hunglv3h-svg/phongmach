import { normalizeCccd } from './cccd.js';
import { digitsOnly, normalizePhone } from './phone.js';
import { nameTokens } from './text.js';

export type SearchIntent =
  | { kind: 'empty' }
  | { kind: 'cccd'; cccd: string }
  | { kind: 'phone'; phone: string }
  /** 3 chữ số trở lên nhưng chưa đủ một số điện thoại, ví dụ 4 số cuối. */
  | { kind: 'phone-fragment'; digits: string }
  | { kind: 'name'; tokens: string[] };

const MIN_FRAGMENT = 3;

/**
 * Hiểu một ô tìm kiếm duy nhất của phụ tá: gõ số điện thoại, 4 số cuối, CCCD hoặc tên (có dấu hay không đều được).
 */
export function classifyQuery(raw: string): SearchIntent {
  const q = raw.trim();
  if (!q) return { kind: 'empty' };

  if (/^[\d\s.+\-()]+$/.test(q)) {
    const digits = digitsOnly(q);
    const cccd = normalizeCccd(q);
    if (cccd) return { kind: 'cccd', cccd };
    const phone = normalizePhone(q);
    if (phone) return { kind: 'phone', phone };
    if (digits.length >= MIN_FRAGMENT) return { kind: 'phone-fragment', digits };
    return { kind: 'empty' };
  }

  const tokens = nameTokens(q);
  return tokens.length ? { kind: 'name', tokens } : { kind: 'empty' };
}
