import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// B0 (bất biến #3): web KHÔNG BAO GIỜ import @medplum/*. BFF là lớp duy nhất gọi Medplum.
// Mutation chứng minh đỏ: thêm `import … from '@medplum/core'` vào bất kỳ file nào trong src ⇒ bài này đỏ.
const SRC = fileURLToPath(new URL('./', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('bất biến #3 — web 0 import @medplum/*', () => {
  it('không file nào trong apps/clinic-web/src import @medplum/…', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith('no-medplum-import.test.ts')) continue; // chuỗi "@medplum" trong chính bài này không tính
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"]@medplum\//.test(text) || /import\s*\(\s*['"]@medplum\//.test(text) || /require\(\s*['"]@medplum\//.test(text)) {
        offenders.push(file.slice(SRC.length));
      }
    }
    expect(offenders).toEqual([]);
  });
});
