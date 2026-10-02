export * from './drugs.js';
export * from './icd10.js';
export * from './instruction.js';
export * from './search.js';
export * from './templates.js';
export * from './types.js';

import { ICD10 } from './icd10.js';

const icd = new Map(ICD10.map((e) => [e.code, e]));
export const getIcd10 = (code: string) => icd.get(code);
