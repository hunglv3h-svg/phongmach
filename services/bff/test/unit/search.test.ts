// Tìm bệnh nhân: phần GỘP và XẾP HẠNG của MedplumClinicStore.searchPatients (tiêu chí M0-3), với một Medplum giả.
// Medplum thật không sắp xếp kết quả và cắt ở _count; phần nào bị cắt tùy kế hoạch truy vấn của Postgres, đổi theo cỡ bảng
// [Đã đo: cùng một bài tích hợp lúc bắt được, lúc không bắt được việc gỡ truy vấn theo khóa]. Ở đây bài kiểm thử tự quyết định
// mỗi truy vấn trả về gì, nên việc gỡ bất kỳ bước nào cũng làm bài đỏ một cách tất định. Việc Medplum thật hiểu đúng `_tag`
// (chính xác, AND, OR) do test/integration/bff.test.ts kiểm.
import { randomUUID } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { SEARCH_TAGS, buildPatient, classifyQuery } from '@phongmach/fhir-vn-model';
import { describe, expect, it } from 'vitest';
import { MedplumClinicStore } from '../../src/medplum.js';

const LIMIT = 20;
const person = (fullName: string, phone?: string): Patient & { id: string } => ({ ...buildPatient({ clientUuid: randomUUID(), fullName, ...(phone ? { phone } : {}) }), id: randomUUID() });
const many = (n: number, make: (i: number) => Patient & { id: string }) => Array.from({ length: n }, (_, i) => make(i));
const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

/** Kho thật nối với Medplum giả: mỗi loại truy vấn trả danh sách soạn sẵn (đã "cắt" như Medplum sẽ cắt); ghi lại truy vấn đã nhận. */
function storeWith(answers: { byKey?: Patient[]; byPrefix?: Patient[]; containing?: Patient[] }) {
  const queries: string[] = [];
  const medplum = {
    searchResources: async (_type: string, query: URLSearchParams | Record<string, string>) => {
      const params = new URLSearchParams(query);
      queries.push(decodeURIComponent(params.toString()));
      if (params.has('_tag')) return answers.byKey ?? [];
      if (params.has('name')) return answers.byPrefix ?? [];
      if (params.has('phone:contains')) return answers.containing ?? [];
      throw new Error(`truy vấn không chờ đợi: ${params.toString()}`);
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
    const found = await search('1234');
    expect(found).toHaveLength(LIMIT);
    expect(found[0]?.id).toBe(target.id);
    expect(ids(found.slice(1))).toEqual(ids(middles.slice(0, LIMIT - 1)));
    expect(queries.sort()).toEqual([`_tag=${SEARCH_TAGS.phoneSuffix}|1234&_count=100`, 'phone:contains=1234&_count=50']);
  });
  it('đoạn dài hơn 4 số: người chỉ chung 4 số cuối bị loại; một người không xuất hiện hai lần', async () => {
    const target = person('Nguyễn Văn Cuối', '0370051234');
    const other = person('Lê Thị Khác', '0380061234');
    const { search, queries } = storeWith({ byKey: [other, target], containing: [target] });
    expect(ids(await search('51234'))).toEqual([target.id]);
    expect(queries).toContain(`_tag=${SEARCH_TAGS.phoneSuffix}|1234&_count=100`);
  });
  it('đoạn 3 số: hỏi cả 10 khả năng của chữ số đứng trước', async () => {
    const target = person('Nguyễn Văn Cuối', '0370051234');
    const { search, queries } = storeWith({ byKey: [target], containing: [] });
    expect(ids(await search('234'))).toEqual([target.id]);
    const tag = queries.find((q) => q.startsWith('_tag='))!;
    expect(tag.split(',')).toHaveLength(10);
    expect(tag).toContain(`${SEARCH_TAGS.phoneSuffix}|1234`);
  });
  it('hồ sơ chưa có khóa chỉ ra ở kết quả "chứa": vẫn xếp người có số kết thúc bằng đoạn đó lên trước', async () => {
    const legacy = person('Phạm Văn Cũ', '0390071234');
    const { search } = storeWith({ byKey: [], containing: [middles[0]!, legacy, middles[1]!] });
    expect(ids(await search('1234'))).toEqual([legacy.id, middles[0]!.id, middles[1]!.id]);
  });
  it('người có trong cả hai kết quả chỉ ra một lần, ở vị trí đầu', async () => {
    const target = person('Nguyễn Văn Cuối', '0370011234');
    const { search } = storeWith({ byKey: [target], containing: [middles[0]!, target] });
    expect(ids(await search('1234'))).toEqual([target.id, middles[0]!.id]);
  });
});

describe('tìm theo tên: gộp kết quả theo khóa từ với kết quả theo đầu từ', () => {
  // 20 người chỉ khớp ĐẦU TỪ với "an": đúng bằng số kết quả theo đầu từ mà BFF xin về, không có người cần tìm trong đó.
  const prefixOnly = many(20, () => person('Bùi Thị Anh'));

  it('người khớp đúng từng từ đứng đầu dù không nằm trong các kết quả theo đầu từ', async () => {
    const an = person('Bùi Văn An');
    const aan = person('Bùi Thị Ân');
    const { search, queries } = storeWith({ byKey: [an, aan], byPrefix: prefixOnly });
    const found = await search('bui an');
    expect(found).toHaveLength(LIMIT);
    expect(ids(found.slice(0, 2))).toEqual([an.id, aan.id]);
    expect(ids(found.slice(2))).toEqual(ids(prefixOnly.slice(0, LIMIT - 2)));
    expect(queries.sort()).toEqual([`_tag=${SEARCH_TAGS.nameWord}|bui&_tag=${SEARCH_TAGS.nameWord}|an&_count=20`, 'name=bui&name=an&_count=20']);
  });
  it('gõ dở từ cuối: không ai khớp đúng cả từ thì vẫn ra theo đầu từ', async () => {
    const { search } = storeWith({ byKey: [], byPrefix: prefixOnly.slice(0, 3) });
    expect(ids(await search('bui a'))).toEqual(ids(prefixOnly.slice(0, 3)));
  });
  it('hồ sơ chưa có khóa chỉ ra ở kết quả theo đầu từ: vẫn xếp người khớp đúng từng từ lên trước', async () => {
    const legacy = person('Bùi Văn An');
    const { search } = storeWith({ byKey: [], byPrefix: [prefixOnly[0]!, legacy, prefixOnly[1]!] });
    expect(ids(await search('bui an'))).toEqual([legacy.id, prefixOnly[0]!.id, prefixOnly[1]!.id]);
  });
  it('người có trong cả hai kết quả chỉ ra một lần, ở vị trí đầu', async () => {
    const an = person('Bùi Văn An');
    const { search } = storeWith({ byKey: [an], byPrefix: [prefixOnly[0]!, an] });
    expect(ids(await search('bui an'))).toEqual([an.id, prefixOnly[0]!.id]);
  });
});
