import { foldName } from '@phongmach/fhir-vn-model';
import { DRUGS } from './drugs.js';
import { ICD10 } from './icd10.js';
import type { DrugEntry, Icd10Entry } from './types.js';

interface Indexed<T> {
  item: T;
  code: string;
  name: string;
  words: string[];
}

function index<T>(items: readonly T[], code: (t: T) => string, text: (t: T) => string): Array<Indexed<T>> {
  return items.map((item) => {
    const name = foldName(text(item));
    return { item, code: foldName(code(item)).replace(/\s/g, ''), name, words: name.split(/[\s/()+,-]+/).filter(Boolean) };
  });
}

/** Điểm khớp: mã trùng hẳn > mã bắt đầu bằng > mọi từ khóa là đầu từ > mọi từ khóa nằm trong tên. 0 là không khớp. */
function score<T>(entry: Indexed<T>, tokens: string[], joined: string): number {
  if (entry.code === joined) return 100;
  if (/^[a-z]\d/.test(joined) && entry.code.startsWith(joined)) return 80;
  if (tokens.every((t) => entry.words.some((w) => w.startsWith(t)))) return 60;
  if (tokens.every((t) => entry.name.includes(t))) return 40;
  return 0;
}

function run<T>(entries: Array<Indexed<T>>, query: string, limit: number): T[] {
  const folded = foldName(query);
  if (!folded) return [];
  const tokens = folded.split(' ');
  const joined = folded.replace(/\s/g, '');
  return entries
    .map((e) => ({ e, s: score(e, tokens, joined) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e.item);
}

const icdIndex = index(ICD10, (e) => e.code, (e) => e.name);
const drugIndex = index(DRUGS, (e) => e.code, (e) => `${e.name} ${e.ingredients.join(' ')}`);

/** Tìm ICD-10 theo mã ("J02") hoặc tên (gõ có dấu hay không đều được: "viem hong"). */
export const searchIcd10 = (query: string, limit = 10): Icd10Entry[] => run(icdIndex, query, limit);

/** Tìm thuốc theo tên hoặc hoạt chất. */
export const searchDrugs = (query: string, limit = 10): DrugEntry[] => run(drugIndex, query, limit);
