import { foldName } from '@phongmach/fhir-vn-model';
import { DRUGS } from './drugs.js';

export interface AllergyClass {
  id: string;
  label: string;
}

/**
 * Nhóm thuốc dùng để ghi dị ứng và đối chiếu khi kê đơn. `classes` của từng thuốc trong danh mục dùng cùng các mã này.
 * MINH HỌA: chưa duyệt y khoa; chưa mô hình hóa dị ứng chéo giữa các nhóm (trừ nhóm "beta-lactam" gộp sẵn).
 */
export const ALLERGY_CLASSES: readonly AllergyClass[] = [
  { id: 'penicillin', label: 'Penicillin (amoxicillin…)' },
  { id: 'cephalosporin', label: 'Cephalosporin (cefuroxim, cefixim…)' },
  { id: 'beta-lactam', label: 'Nhóm beta-lactam (penicillin và cephalosporin)' },
  { id: 'nsaid', label: 'Thuốc kháng viêm không steroid (ibuprofen, diclofenac…)' },
  { id: 'salicylate', label: 'Aspirin / salicylat' },
  { id: 'sulfonamide', label: 'Sulfonamid (có trong co-trimoxazol)' },
  { id: 'macrolide', label: 'Macrolid (azithromycin…)' },
  { id: 'quinolone', label: 'Quinolon (ciprofloxacin…)' },
  { id: 'tetracycline', label: 'Tetracyclin (doxycyclin…)' },
  { id: 'aminoglycoside', label: 'Aminoglycosid' },
  { id: 'corticosteroid', label: 'Corticosteroid' },
];

const classLabels = new Map(ALLERGY_CLASSES.map((c) => [c.id, c.label]));
export const allergyClassLabel = (id: string): string => classLabels.get(id) ?? id;

/** Mọi hoạt chất có trong danh mục thuốc, đã sắp xếp: dùng khi ghi dị ứng theo hoạt chất. */
export const INGREDIENTS: readonly string[] = [...new Set(DRUGS.flatMap((d) => d.ingredients))].sort((a, b) => a.localeCompare(b, 'vi'));

export function searchIngredients(query: string, limit = 8): string[] {
  const q = foldName(query);
  if (!q) return [];
  return INGREDIENTS.filter((i) => foldName(i).includes(q))
    .sort((a, b) => Number(!foldName(a).startsWith(q)) - Number(!foldName(b).startsWith(q)) || a.length - b.length)
    .slice(0, limit);
}
