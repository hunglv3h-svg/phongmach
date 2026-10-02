/** Bỏ dấu tiếng Việt: "Nguyễn Đức" → "Nguyen Duc". */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** Chuẩn hóa để so khớp: bỏ dấu, chữ thường, gộp khoảng trắng. */
export function foldName(input: string): string {
  return stripDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function nameTokens(input: string): string[] {
  const folded = foldName(input);
  return folded ? folded.split(' ') : [];
}

export interface ParsedName {
  family: string;
  given: string[];
}

/** Tách "Nguyễn Văn An" thành họ "Nguyễn" và tên đệm + tên ["Văn", "An"]. Họ là từ đầu tiên. */
export function parseFullName(input: string): ParsedName | undefined {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const [family, ...given] = parts;
  if (!family || given.length === 0) return undefined;
  return { family, given };
}
