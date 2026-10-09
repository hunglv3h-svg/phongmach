// Tìm bệnh nhân: phần GỘP và XẾP HẠNG của MedplumClinicStore.searchPatients (tiêu chí M0-3), với một Medplum giả.
// Medplum thật không sắp xếp kết quả và cắt ở _count; phần nào bị cắt tùy kế hoạch truy vấn của Postgres, đổi theo cỡ bảng
// [Đã đo: cùng một bài tích hợp lúc bắt được, lúc không bắt được việc gỡ truy vấn theo khóa]. Ở đây bài kiểm thử tự quyết định
// mỗi truy vấn trả về gì, nên việc gỡ bất kỳ bước nào cũng làm bài đỏ một cách tất định. Việc Medplum thật hiểu đúng `_tag`
// (chính xác, AND, OR) do test/integration/bff.test.ts kiểm.
import { randomUUID } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { Bundle, Patient } from '@medplum/fhirtypes';
import { SEARCH_TAGS, buildPatient, classifyQuery } from '@phongmach/fhir-vn-model';
import { describe, expect, it } from 'vitest';
import { MedplumClinicStore } from '../../src/medplum.js';

const LIMIT = 20;
const person = (fullName: string, phone?: string): Patient & { id: string } => ({ ...buildPatient({ clientUuid: randomUUID(), fullName, ...(phone ? { phone } : {}) }), id: randomUUID() });
const many = (n: number, make: (i: number) => Patient & { id: string }) => Array.from({ length: n }, (_, i) => make(i));
const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

/**
 * Kho thật nối với Medplum giả: mỗi loại truy vấn trả danh sách soạn sẵn (đã "cắt" như Medplum sẽ cắt); ghi lại truy vấn đã nhận.
 * `counts` điền `Bundle.total` cho truy vấn `_summary=count` theo từng hình truy vấn (khóa _tag / name / phone:contains);
 * không điền thì `total` suy từ độ dài danh sách tương ứng (đủ cho phần lớn ca).
 */
function storeWith(answers: { byKey?: Patient[]; byPrefix?: Patient[]; containing?: Patient[]; counts?: { exact?: number; prefix?: number; containing?: number } }) {
  const queries: string[] = [];
  const arm = (params: URLSearchParams): Patient[] => {
    if (params.has('_tag')) return answers.byKey ?? [];
    if (params.has('name')) return answers.byPrefix ?? [];
    if (params.has('phone:contains')) return answers.containing ?? [];
    return [];
  };
  const total = (params: URLSearchParams): number => {
    if (params.has('_tag')) return answers.counts?.exact ?? (answers.byKey ?? []).length;
    if (params.has('name')) return answers.counts?.prefix ?? (answers.byPrefix ?? []).length;
    if (params.has('phone:contains')) return answers.counts?.containing ?? (answers.containing ?? []).length;
    return 0;
  };
  const medplum = {
    searchResources: async (_type: string, query: URLSearchParams | Record<string, string>) => {
      const params = new URLSearchParams(query);
      queries.push(decodeURIComponent(params.toString()));
      if (params.has('_tag') || params.has('name') || params.has('phone:contains')) return arm(params);
      throw new Error(`truy vấn không chờ đợi: ${params.toString()}`);
    },
    // `_summary=count`: đọc `Bundle.total`, không kéo tài nguyên về.
    search: async (_type: string, query: URLSearchParams | Record<string, string>): Promise<Bundle> => {
      const params = new URLSearchParams(query);
      queries.push(decodeURIComponent(params.toString()));
      if (params.get('_summary') !== 'count') throw new Error(`truy vấn search không chờ đợi: ${params.toString()}`);
      return { resourceType: 'Bundle', type: 'searchset', total: total(params) };
    },
  } as unknown as MedplumClient;
  const store = new MedplumClinicStore(medplum);
  return { queries, search: (q: string) => store.searchPatients(classifyQuery(q), LIMIT) };
}

describe('tìm theo đoạn số: gộp kết quả theo khóa 4 số cuối với kết quả "chứa"', () => {
  // 50 người có "1234" ở GIỮA số điện thoại: đúng bằng số kết quả "chứa" mà BFF xin về, không có người cần tìm trong đó.
  const middles = many(50, (i) => person('Trần Thị Giữa', `091234${1000 + i}`));

  it('người có số KẾT THÚC bằng đoạn đã gõ đứng đầu dù không nằm trong các kết quả "chứa"', async () => {
    const target = person('Nguyễn Văn Cuối', '0370011234');
    const { search, queries } = storeWith({ byKey: [target], containing: middles });
    const { results: found } = await search('1234');
    expect(found).toHaveLength(LIMIT);
    expect(found[0]?.id).toBe(target.id);
    // 19 người "chứa" còn lại là 19 id nhỏ nhất (nhóm cùng điểm xếp theo id, rồi cắt).
    const expectedMiddles = ids(middles).sort().slice(0, LIMIT - 1);
    expect(ids(found.slice(1))).toEqual(expectedMiddles);
    expect(queries).toContain(`_tag=${SEARCH_TAGS.phoneSuffix}|1234&_count=100`);
    expect(queries).toContain('phone:contains=1234&_count=50');
    expect(queries.some((q) => q.includes('phone:contains=1234') && q.includes('_summary=count'))).toBe(true);
  });
  it('đoạn dài hơn 4 số: người chỉ chung 4 số cuối bị loại; một người không xuất hiện hai lần', async () => {
    const target = person('Nguyễn Văn Cuối', '0370051234');
    const other = person('Lê Thị Khác', '0380061234');
    const { search, queries } = storeWith({ byKey: [other, target], containing: [target] });
    expect(ids((await search('51234')).results)).toEqual([target.id]);
    expect(queries).toContain(`_tag=${SEARCH_TAGS.phoneSuffix}|1234&_count=100`);
  });
  it('đoạn 3 số: hỏi cả 10 khả năng của chữ số đứng trước', async () => {
    const target = person('Nguyễn Văn Cuối', '0370051234');
    const { search, queries } = storeWith({ byKey: [target], containing: [] });
    expect(ids((await search('234')).results)).toEqual([target.id]);
    const tag = queries.find((q) => q.startsWith('_tag=') && q.includes('_count'))!;
    expect(tag.split(',')).toHaveLength(10);
    expect(tag).toContain(`${SEARCH_TAGS.phoneSuffix}|1234`);
  });
  it('hồ sơ chưa có khóa chỉ ra ở kết quả "chứa": vẫn xếp người có số kết thúc bằng đoạn đó lên trước', async () => {
    const legacy = person('Phạm Văn Cũ', '0390071234');
    const { search } = storeWith({ byKey: [], containing: [middles[0]!, legacy, middles[1]!] });
    const { results } = await search('1234');
    expect(results[0]?.id).toBe(legacy.id); // kết thúc 1234 (điểm 0) lên đầu
    expect(ids(results.slice(1)).sort()).toEqual([middles[0]!.id, middles[1]!.id].sort()); // nhóm "chứa" xếp theo id
  });
  it('người có trong cả hai kết quả chỉ ra một lần, ở vị trí đầu', async () => {
    const target = person('Nguyễn Văn Cuối', '0370011234');
    const { search } = storeWith({ byKey: [target], containing: [middles[0]!, target] });
    expect(ids((await search('1234')).results)).toEqual([target.id, middles[0]!.id]);
  });
  it('hasMore: đếm trên phone:contains vượt limit', async () => {
    const target = person('Nguyễn Văn Cuối', '0370011234');
    expect((await storeWith({ byKey: [target], containing: middles, counts: { containing: 21 } }).search('1234')).hasMore).toBe(true);
    expect((await storeWith({ byKey: [target], containing: middles.slice(0, 10), counts: { containing: 20 } }).search('1234')).hasMore).toBe(false);
  });
});

describe('tìm theo tên: gộp kết quả theo khóa từ với kết quả theo đầu từ', () => {
  // 20 người chỉ khớp ĐẦU TỪ với "an": đúng bằng số kết quả theo đầu từ mà BFF xin về, không có người cần tìm trong đó.
  const prefixOnly = many(20, () => person('Bùi Thị Anh'));

  it('người khớp đúng từng từ đứng đầu dù không nằm trong các kết quả theo đầu từ', async () => {
    const an = person('Bùi Văn An');
    const aan = person('Bùi Thị Ân');
    const { search, queries } = storeWith({ byKey: [an, aan], byPrefix: prefixOnly });
    const { results: found } = await search('bui an');
    expect(found).toHaveLength(LIMIT);
    expect(ids(found.slice(0, 2)).sort()).toEqual([an.id, aan.id].sort()); // nhóm khớp đúng, xếp theo id
    expect(new Set(found.map((r) => r.id)).size).toBe(LIMIT);
    expect(queries).toContain(`_tag=${SEARCH_TAGS.nameWord}|bui&_tag=${SEARCH_TAGS.nameWord}|an&_count=21`);
    expect(queries).toContain('name=bui&name=an&_count=21');
    expect(queries.some((q) => q.includes(`_tag=${SEARCH_TAGS.nameWord}|bui`) && q.includes('_summary=count'))).toBe(true);
  });
  it('gõ dở từ cuối: không ai khớp đúng cả từ thì vẫn ra theo đầu từ', async () => {
    const { search } = storeWith({ byKey: [], byPrefix: prefixOnly.slice(0, 3) });
    expect(ids((await search('bui a')).results).sort()).toEqual(ids(prefixOnly.slice(0, 3)).sort());
  });
  it('hồ sơ chưa có khóa chỉ ra ở kết quả theo đầu từ: vẫn xếp người khớp đúng từng từ lên trước', async () => {
    const legacy = person('Bùi Văn An');
    const { search } = storeWith({ byKey: [], byPrefix: [prefixOnly[0]!, legacy, prefixOnly[1]!] });
    const { results } = await search('bui an');
    expect(results[0]?.id).toBe(legacy.id); // khớp đúng cả từ lên đầu
    expect(ids(results.slice(1)).sort()).toEqual([prefixOnly[0]!.id, prefixOnly[1]!.id].sort());
  });
  it('người có trong cả hai kết quả chỉ ra một lần, ở vị trí đầu', async () => {
    const an = person('Bùi Văn An');
    const { search } = storeWith({ byKey: [an], byPrefix: [prefixOnly[0]!, an] });
    expect(ids((await search('bui an')).results)).toEqual([an.id, prefixOnly[0]!.id]);
  });

  describe('hasMore: đếm trên tập khớp-đúng (_tag AND), không phải prefix', () => {
    it('tập khớp-đúng 21 → true; đúng 20 → false; 19 → false', async () => {
      const an = person('Bùi Văn An');
      expect((await storeWith({ byKey: [an], byPrefix: [], counts: { exact: 21 } }).search('bui an')).hasMore).toBe(true);
      expect((await storeWith({ byKey: [an], byPrefix: [], counts: { exact: 20 } }).search('bui an')).hasMore).toBe(false);
      expect((await storeWith({ byKey: [an], byPrefix: [], counts: { exact: 19 } }).search('bui an')).hasMore).toBe(false);
    });
    it('prefix 50 nhưng _tag AND khớp-đúng 12 → false (không báo thừa như Finding 2)', async () => {
      const an = person('Bùi Văn An');
      // byPrefix dưới limit (12) để không kích nhánh prefix-overflow; đếm khớp-đúng 12 ≤ 20.
      expect((await storeWith({ byKey: [an], byPrefix: many(12, () => person('Bùi Thị Anh')), counts: { exact: 12 } }).search('bui an')).hasMore).toBe(false);
    });
    it('hồ sơ cũ chưa có khóa chỉ ra qua prefix và tràn limit: hasMore=true dù _tag AND đếm 0 (Decision 1)', async () => {
      // Dân số khớp-đúng theo khóa = 0, nhưng 21 hồ sơ cũ (chưa có khóa) ra qua prefix: câu nhắc không được tắt thầm.
      const legacy = many(21, () => person('Bùi Văn An'));
      expect((await storeWith({ byKey: [], byPrefix: legacy, counts: { exact: 0 } }).search('bui an')).hasMore).toBe(true);
    });
  });
});

describe('tìm lẫn tên và số (name+number): AND khóa tên và khóa đuôi số', () => {
  it('AND tên + đuôi số trong một truy vấn _tag; cộng nhánh prefix', async () => {
    const target = person('Nguyễn Văn An', '0370011234');
    const { search, queries } = storeWith({ byKey: [target], byPrefix: [] });
    expect(ids((await search('nguyen van an 1234')).results)).toEqual([target.id]);
    const tag = queries.find((q) => q.startsWith('_tag=') && q.includes('_count') && !q.includes('_summary'))!;
    expect(tag).toContain(`${SEARCH_TAGS.nameWord}|nguyen`);
    expect(tag).toContain(`${SEARCH_TAGS.nameWord}|an`);
    expect(tag).toContain(`${SEARCH_TAGS.phoneSuffix}|1234`);
    expect(queries).toContain('name=nguyen&name=van&name=an&_count=21');
  });
  it('đoạn >4 số: người chỉ chung 4 số cuối theo khóa bị loại bằng lọc endsWith đuôi thật', async () => {
    const target = person('Nguyễn Văn An', '0370051234');
    const other = person('Nguyễn Văn An', '0380061234'); // cùng 4 số cuối 1234 nhưng không kết thúc 51234
    const { search } = storeWith({ byKey: [other, target], byPrefix: [] });
    expect(ids((await search('nguyen van an 51234')).results)).toEqual([target.id]);
  });
  it('hồ sơ chưa có khóa ra qua prefix và được giữ nếu đuôi số khớp; bỏ trùng', async () => {
    const keyed = person('Nguyễn Văn An', '0370011234');
    const legacy = person('Nguyễn Văn An', '0390071234');
    const legacyWrong = person('Nguyễn Văn An', '0390079999'); // đuôi không khớp, bị loại khỏi prefix
    const { search } = storeWith({ byKey: [keyed], byPrefix: [legacy, keyed, legacyWrong] });
    const { results } = await search('nguyen van an 1234');
    expect(ids(results).sort()).toEqual([keyed.id, legacy.id].sort());
    expect(new Set(results.map((r) => r.id)).size).toBe(2);
  });
  it('hasMore từ truy vấn đếm tập khớp-đúng', async () => {
    const target = person('Nguyễn Văn An', '0370011234');
    expect((await storeWith({ byKey: [target], byPrefix: [], counts: { exact: 21 } }).search('nguyen van an 1234')).hasMore).toBe(true);
    expect((await storeWith({ byKey: [target], byPrefix: [], counts: { exact: 5 } }).search('nguyen van an 1234')).hasMore).toBe(false);
  });
});

describe('thứ tự tất định giữa hai lần chạy (tie-break theo id)', () => {
  it('Medplum giả trả cùng tập theo thứ tự khác nhau → results giống hệt nhau', async () => {
    const people = many(25, () => person('Bùi Văn An', '0370011234'));
    const shuffled = [...people].reverse();
    const first = (await storeWith({ byKey: people, byPrefix: [] }).search('bui an')).results;
    const second = (await storeWith({ byKey: shuffled, byPrefix: [] }).search('bui an')).results;
    expect(ids(second)).toEqual(ids(first)); // cùng lát cắt 20 người, cùng thứ tự
    expect(first).toHaveLength(LIMIT);
  });
});
