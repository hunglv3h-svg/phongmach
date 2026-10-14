# Thiết kế: cải thiện tính đúng khi tìm bệnh nhân (P2)

> Bản sửa vòng 3 sau review (`design-review.json` / `design-review.md`, verdict
> `CHANGES_REQUESTED`: 1 HIGH + 3 MEDIUM + 2 NIT). Phản hồi từng finding ở cuối tài liệu.
> Những thay đổi lớn so với bản trước:
> 1. **Cơ chế đếm `hasMore` được chốt là một hành vi Medplum PHẢI đo trước** (Finding 1):
>    thêm một bài tích hợp làm *điều kiện tiên quyết* (seed dân số đã biết, assert
>    `Bundle.total` chính xác), và một phương án lùi tất định (`_count=limit+1` +
>    `fetched.length > limit`) cho nhánh nào `total` không đáng tin. Bỏ câu mâu thuẫn
>    `_total=accurate` (Finding 5) — chỉ dùng `_summary=count`.
> 2. Nhánh `name` **đếm trên truy vấn khớp-đúng (`_tag` AND), không phải prefix**
>    (Finding 2): `hasMore` khớp đúng ngữ nghĩa câu nhắc "còn người **trùng tên**".
> 3. Cả hai `switch` (`searchPatients`, `searchLocal`) thêm **arm `name+number` và
>    một never-guard tất định** (Finding 3).
> 4. `Search` state mang `kind` lấy từ phản hồi; guard câu nhắc đọc `search.kind`,
>    **không** `classifyQuery(query)` lần ba (Finding 4).
> 5. `startNew()` prefill `name+number` **giữ dấu/hoa-thường** bằng cách bỏ các mảnh
>    số khỏi `query`, nhất quán với nhánh `name` (Finding 6).

## Tổng quan

Ba việc còn lại trong mục "Còn lại, chưa làm" của `docs/ke-hoach-trien-khai.md`
(quanh dòng 184–187) đều là chuyện *tính đúng* của một đường tìm đã chạy và đã đo,
không phải viết lại. Đường tìm hiện tại: `GET /api/patients/search` ở BFF gọi
`classifyQuery(q)` (gói `@phongmach/fhir-vn-model`) ra một `SearchIntent`, rồi
`MedplumClinicStore.searchPatients(intent, limit)` hỏi Medplum (hai truy vấn song
song cho tên và cho đoạn số), gộp, xếp hạng, bỏ trùng và cắt ở 20. Khi mất mạng,
`apps/clinic-web` gọi `searchLocal(query, entries, limit)` dùng *cùng* `classifyQuery`
và cùng các hàm xếp hạng của gói model, để quy ước tìm giống hệt phía máy chủ.

Thiết kế này chạm ba điểm, giữ nguyên kiến trúc đó:

1. **Báo "còn người khác" khi hơn 20 người khớp** — thêm một cờ `hasMore` vào phản
   hồi API và câu nhắc tiếng Việt ở `Reception.tsx`. BFF là nơi quyết định `hasMore`
   bằng **một truy vấn đếm chính xác** (`_summary=count`) độc lập với truy vấn xếp
   hạng (Quyết định 1), không tin client. Cơ chế đếm này là một hành vi Medplum
   **chưa có đường mã nào trong repo dùng**, nên phải đo trước (xem "Điều kiện tiên
   quyết đo" và phương án lùi).
2. **Thứ tự 20 người ổn định giữa hai lần chạy** — thêm một khóa sắp xếp phụ **tất
   định theo `id`** ở cuối chuỗi xếp hạng trong `searchPatients`, áp dụng sau mọi
   tiêu chí hiện có và *trước* khi cắt ở 20. Dùng một hàm `stableById`/`byId` export
   dùng chung duy nhất.
3. **Gõ lẫn tên và số trong một lần tìm** (`an 5678`, `nguyen van an 1985`) — mở rộng
   `classifyQuery` để tách phần chữ (tên) khỏi một đoạn số, trả về một ý định *kết
   hợp* `name+number`; `searchPatients` (BFF) và `searchLocal` (offline) cùng tôn trọng.
4. (Hệ quả của mục 3 + tie-break) **Tìm offline đưa người khớp đúng lên đầu** —
   `searchLocal` vốn đã dùng `rankByPhoneSuffix` cho đoạn số; sau khi có ý định kết hợp
   và tie-break `id`, offline cũng "người khớp đúng lên đầu" như BFF, trong phạm vi
   vài chục hồ sơ của bộ đệm.

Ngăn xếp công nghệ **khóa lại** (không đổi): TypeScript ESM; Fastify + Zod ở BFF;
`@medplum/core` `MedplumClient`; React 18 ở clinic-web; Vitest cho đơn vị/tích hợp;
pnpm workspace. Logic phân loại và xếp hạng tiếp tục nằm ở `@phongmach/fhir-vn-model`
để BFF và bộ đệm offline không lệch nhau — đây là ranh giới bắt buộc của nhiệm vụ.

---

## Quyết định 1 — Báo "còn người trùng tên" khi hơn 20 người khớp

### Hình phản hồi API

Phản hồi hiện tại của `GET /api/patients/search` là `{ intent: string; results: PatientSummary[] }`.
Thêm **một trường boolean `hasMore`** (luôn có mặt):

```jsonc
{ "intent": "name", "results": [ /* ≤ 20 */ ], "hasMore": true }
```

Chọn tên `hasMore` (không phải `truncated`) vì:

- Ngữ nghĩa đứng từ phía người dùng ("còn người khác"), đúng với câu nhắc tiếng Việt
  sẽ hiển thị, dễ đọc ở cả API lẫn UI.
- `finishedVisits` của BFF trả `{ visits, truncated }`, nhưng ở đó `truncated` nói về
  *dữ liệu đo bị cắt*; ở đây điều ta truyền là *còn kết quả nữa* — `hasMore` diễn đạt
  đúng. Giữ hai tên khác nhau cho hai ngữ nghĩa khác nhau là có chủ ý.
- Luôn có mặt (không optional) để UI không phải phân biệt "không có cờ" với "false".
  `hasMore: false` khi số kết quả ≤ 20 là trạng thái hợp lệ, rõ ràng.

### `hasMore` lấy từ một truy vấn đếm chính xác — và đếm đúng dân số nào (sửa Finding 1, 2)

**`hasMore` KHÔNG suy ra từ kích thước tập đã lấy.** Các truy vấn xếp hạng ở từng nhánh
đều gộp *hợp* của hai truy vấn, mỗi truy vấn bị Medplum cắt ở `_count` và không sắp xếp;
nên "tập sau `uniqueById` dài hơn `limit`" không tương đương với "dân số khớp > `limit`"
(ví dụ `nguyen phu` có hàng trăm người khớp nhưng mỗi truy vấn chỉ lấy `limit+1`). Do đó
`hasMore` lấy từ **một truy vấn đếm riêng** dùng `_summary=count`, đọc `Bundle.total`.

**Đếm trên truy vấn nào — đây là điểm sửa Finding 2.** Câu nhắc là "còn người **trùng
tên**", và chuỗi xếp hạng *cố tình* đặt người khớp-đúng-cả-từ lên trước người chỉ khớp
đầu-từ. Vì vậy `hasMore` phải đếm **tập khớp-đúng** (ngữ nghĩa của câu nhắc), không phải
tập prefix (rộng hơn, sẽ báo thừa cho truy vấn vốn đã cụ thể):

- `name`: đếm trên **truy vấn `_tag` AND các khóa-từ-tên** (`nameWordTag(token)`) — chính
  là truy vấn `exact`/`byWords` đã phát để xếp hạng. `hasMore = totalExact > limit`.
  *Không* đếm trên truy vấn `name` prefix. (Prefix bao exact về mặt tập hợp, nhưng
  "Bùi Thị **Anh**" không phải người "trùng tên" với truy vấn `bui an`; đếm prefix sẽ
  bật câu nhắc cho `bui an` dù dân số khớp-đúng ≤ 20 — lỗi báo-thừa mà Finding 2 chỉ ra.)
- `phone-fragment`: đếm trên **`phone:contains` của đoạn**. Ở đây tập "khớp đúng" là
  "số KẾT THÚC bằng đoạn", nhưng Medplum không có tham số "ends-with"; `phone:contains`
  là truy vấn bao hẹp nhất mà Medplum đếm được. Chấp nhận `hasMore` của nhánh này có thể
  *báo thừa* nhẹ (ai đó chứa đoạn ở giữa nhưng không kết thúc bằng đoạn) — ghi rõ là
  đánh đổi có chủ đích: với đoạn 4 số, "chứa" và "kết thúc bằng" gần như trùng nhau, và
  câu nhắc cho nhánh số là khuyên gõ thêm số, không sai về hướng.
- `name+number`: đếm trên **truy vấn `_tag` khớp-đúng** (AND khóa-từ-tên + khóa-đuôi-số)
  — tập khớp đúng cả hai điều kiện (xem Quyết định 3). `hasMore = totalKeys > limit`.
  (Thực tế UI *không hiện* câu nhắc cho `name+number`; vẫn tính để nhất quán kiểu — xem
  "Tương tác với câu nhắc".)
- `cccd` / `phone`: đếm trên chính truy vấn định danh / số đầy đủ. Thực tế gần như luôn
  ≤ 1, nhưng vẫn trả `hasMore` nhất quán kiểu.
- `empty`: `hasMore = false`, không gọi Medplum.

> Bất biến có chủ đích: với `name`/`name+number`, `hasMore` phản ánh **dân số khớp-đúng**
> (`_tag` AND `> limit`) — cùng tập mà chuỗi xếp hạng gọi là "người khớp đúng", nên câu
> nhắc "còn người trùng tên" nói đúng về tập đó. Đây là nguồn sự thật ở BFF; client chỉ
> hiển thị.

### Cơ chế đếm: `_summary=count` qua `this.medplum.search`, đọc `Bundle.total`

Dùng **`_summary=count`** (FHIR R4 chỉ trả `total`, không kéo tài nguyên về). Để đọc
`total`, phải gọi `this.medplum.search('Patient', params)` (trả cả `Bundle`, có `.total`),
*không* phải `this.medplum.searchResources` (chỉ trả mảng tài nguyên). `listQueue`/
`loadVisits`/`pendingPrescriptions` đã dùng `this.medplum.search` nên mẫu này không mới
về mặt gọi hàm — chỉ *đọc `bundle.total`* là mới (chưa đường mã nào trong repo đọc).

Hàm nội bộ:

```ts
/** Đếm chính xác dân số khớp một truy vấn (không kéo tài nguyên). Trả 0 nếu Medplum không điền total. */
private async count(query: URLSearchParams | Record<string, string>): Promise<number> {
  const params = new URLSearchParams(query as Record<string, string>);
  params.set('_summary', 'count');
  const bundle = await this.medplum.search('Patient', params);
  return bundle.total ?? 0;
}
```

Truy vấn đếm chạy **song song** cùng các truy vấn xếp hạng (thêm vào `Promise.all` sẵn
có), nên một lượt tìm vẫn chỉ chờ một vòng gọi Medplum.

### Điều kiện tiên quyết đo + phương án lùi (sửa Finding 1)

Toàn bộ `hasMore` dựa vào giả định **chưa đo**: Medplum 5.2.0 điền `Bundle.total`
*chính xác* (không trần, không ước lượng) cho `_summary=count` trên truy vấn `_tag`-AND
và `phone:contains`. Mục M0-3 chỉ đo đường 2-truy-vấn, chưa bao giờ đo truy vấn đếm. Nếu
`total` vắng hoặc bị trần, mặc định `?? 0 → hasMore=false` sẽ **âm thầm không bao giờ
hiện câu nhắc** — đúng yêu cầu số (1) hỏng mà không bài nào bắt được.

Vì vậy, **trước khi** nối truy vấn đếm vào đường chạy, phải chạy một bài tích hợp (xem
"Kiểm thử") seed một dân số đã biết (ví dụ 25 người cùng một từ tên, 25 người cùng 4 số
cuối) và assert `_summary=count` trả `Bundle.total === 25` cho **từng hình truy vấn thực
dùng**: `_tag` AND khóa-từ-tên; `phone:contains`; `_tag` AND tên + đuôi-số. Đây là
*điều kiện tiên quyết* của Quyết định 1, không phải một bài phụ.

**Phương án lùi (nếu bài trên cho thấy `total` bị trần/ước lượng ở nhánh nào):** nhánh
đó bỏ truy vấn đếm, thay bằng lấy dư một bản ở truy vấn *bao* và so độ dài:
`_count = limit + 1` trên truy vấn khớp-đúng của nhánh (`_tag` AND), rồi
`hasMore = fetchedExact.length > limit`. Kém chính xác hơn đếm (chỉ biết "> limit" chứ
không biết tổng), nhưng đủ cho câu nhắc nhị phân và không phụ thuộc `Bundle.total`. Ghi
rõ nhánh nào dùng phương án nào trong code comment sau khi đo. (Thiết kế **ưu tiên** đếm
vì nó chính xác; phương án lùi chỉ kích hoạt theo kết quả đo.)

### Đổi kiểu trả về của `searchPatients`

Để không tin client và giữ quy ước ở BFF, **đổi kiểu trả về của `ClinicStore.searchPatients`**
từ `Promise<PatientSummary[]>` thành:

```ts
export interface PatientSearchResult {
  results: PatientSummary[];   // đã xếp hạng, bỏ trùng, cắt ở limit
  hasMore: boolean;            // còn người khớp-đúng ngoài limit (từ truy vấn đếm)
}
searchPatients(intent: SearchIntent, limit: number): Promise<PatientSearchResult>;
```

(Khai báo ở `services/bff/src/store.ts`; triển khai ở `services/bff/src/medplum.ts`.)
`typecheck` sẽ bắt mọi chỗ gọi chưa cập nhật (`store.ts` interface, `medplum.ts` impl,
route `app.ts`) — dùng điều đó làm lưới an toàn.

Route trong `app.ts` (route `/api/patients/search`) truyền thẳng cờ ra phản hồi, **không
đổi phần ghi nhật ký** (vẫn `resultCount: results.length` theo tập đã cắt — số bản ghi
thực sự rời khỏi BFF):

```ts
const { results, hasMore } = await store.searchPatients(intent, limit);
await record(req, 'search', { queryKind: intent.kind, resultCount: results.length, resourceIds: results.map((r) => r.id) });
return { intent: intent.kind, results, hasMore };
```

### Nơi clinic-web hiện câu nhắc — nối đủ cả đường online

Câu nhắc bắt buộc (nguyên văn tài liệu kế hoạch): **"còn người trùng tên, gõ thêm
năm sinh hoặc 4 số cuối"**. Hiện `Reception.tsx` đã có vùng `#search-status`
(`aria-live="polite"`, `data-testid="search-status"`) hiển thị `"${n} kết quả"`.

Các sửa cụ thể (bản gốc thiếu, khiến online không bao giờ hiện câu nhắc):

1. `apps/clinic-web/src/api.ts` — kiểu trả của `api.search`:
   ```ts
   search: (token, q, signal?) =>
     request<{ intent: string; results: PatientSummary[]; hasMore: boolean }>(
       'GET', `/api/patients/search?q=${encodeURIComponent(q)}`, { token, ...(signal ? { signal } : {}) }),
   ```
2. `apps/clinic-web/src/components/Reception.tsx` — kiểu `Search` thêm `hasMore` **và
   `kind`** (xem Finding 4):
   ```ts
   type Search = {
     status: 'idle' | 'loading' | 'done' | 'error';
     results: PatientSummary[];
     forQuery?: string;
     error?: string;
     local?: { total: number };
     hasMore?: boolean;                 // MỚI
     kind?: SearchIntent['kind'];       // MỚI: loại ý định đã tạo ra kết quả này
   };
   ```
   (`import { type SearchIntent } from '@phongmach/fhir-vn-model'`.)
3. Cả **hai** nhánh `setSearch` đặt `hasMore` và `kind` *từ phản hồi*, không re-derive:
   - Online: `setSearch({ status: 'done', results: r.results, forQuery: query, hasMore: r.hasMore, kind: r.intent as SearchIntent['kind'] });`
   - Offline: `setSearch({ status: 'done', results: r.results, forQuery: query, local: { total: r.total }, hasMore: r.hasMore, kind: classifyQuery(query).kind });`
     (Offline BFF không trả `intent`, nên offline phân loại một lần tại đây và lưu vào
     state; đây là lần phân loại *duy nhất* cho mục đích câu nhắc.)
4. Guard hiển thị **tường minh**, đọc từ state (không gọi `classifyQuery` lần nữa):
   ```ts
   const showMoreHint = fresh && search.hasMore === true && !search.local
     && search.kind !== 'name+number';
   ```
   `fresh` (`search.status === 'done' && search.forQuery === query`) bảo đảm
   `search.hasMore`/`search.kind` ứng với *đúng* chuỗi đang gõ; việc gate đọc từ phản
   hồi (không từ ô nhập) khiến nó không vỡ nếu logic `fresh` đổi (sửa Finding 4).
5. Hằng chuỗi và chỗ render trong `#search-status` (nối sau số kết quả bằng dấu `·`,
   viết thường, không dấu chấm than — đúng tone đang dùng):
   ```ts
   const MORE_HINT = 'còn người trùng tên, gõ thêm năm sinh hoặc 4 số cuối';
   ```
   Khi `showMoreHint`, dòng trạng thái thành:
   ```
   20 kết quả · còn người trùng tên, gõ thêm năm sinh hoặc 4 số cuối
   ```

Lý do đặt ở `#search-status` chứ không phải hộp cảnh báo riêng: vùng này đã là
`aria-live="polite"` nên trình đọc màn hình đọc được mà không cần vùng sống mới; và
nó giữ đúng tone các câu trạng thái quanh đó ("Mất mạng: chỉ tìm trong N hồ sơ trên
máy này · N kết quả").

### Offline `hasMore`

- `searchLocal` đổi trả về từ `PatientSummary[]` thành `{ results: PatientSummary[]; hasMore: boolean }`:
  tính `hasMore = found.length > limit` **trước** khi `slice(0, limit)`.
- `OfflineClient.searchCache(query)` hiện trả `{ results, total }` và gọi
  `searchLocal(query, entries)` **không truyền `limit`** (dựa mặc định `= 20`). Giữ
  cách gọi, nối `hasMore`:
  ```ts
  async searchCache(query: string): Promise<{ results: PatientSummary[]; total: number; hasMore: boolean }> {
    const entries = (await this.store.list<'patients', CachedPatient>('patients')).map((r) => r.value);
    const { results, hasMore } = searchLocal(query, entries);
    return { results, total: entries.length, hasMore };
  }
  ```
- Dù `searchCache` trả `hasMore`, **UI vẫn không hiện `MORE_HINT` khi offline** nhờ
  guard `!search.local`: bộ đệm chỉ vài chục hồ sơ nên "hơn 20" gần như không xảy ra, và
  câu "chỉ tìm trong N hồ sơ trên máy này" đã nói rõ giới hạn. Trả `hasMore` ở cả hai
  nguồn giữ một trường `hasMore` *duy nhất* trong state; *có hiện hay không* do guard
  quyết định.

### Kiểm thử (Quyết định 1)

- **Tích hợp — ĐIỀU KIỆN TIÊN QUYẾT** (`services/bff/test/integration/bff.test.ts`,
  Medplum thật): seed một dân số đã biết (ví dụ 25 người họ ngẫu nhiên `FAMILY` + cùng
  một từ tên; 25 người cùng 4 số cuối), rồi gọi thẳng `this.medplum.search` tương đương
  với `_summary=count` cho từng hình truy vấn (`_tag` AND khóa-từ-tên; `phone:contains`;
  `_tag` AND tên+đuôi) và assert `Bundle.total === 25`. Bài này phải xanh *trước* khi tin
  vào `hasMore`. Nếu một hình trả `total` sai → chuyển nhánh đó sang phương án lùi.
- **BFF đơn vị** (`services/bff/test/unit/search.test.ts`, Medplum giả): **Medplum giả
  hiện chỉ mock `searchResources`; phải thêm mock `search`** trả một `Bundle` với `.total`
  khi `params.get('_summary') === 'count'` (một nhánh rẽ trong hàm giả). Ca "tên khớp
  311 người, truy vấn xếp hạng chỉ trả 21 → `hasMore === true`"; "đúng 20 người →
  `false`"; "19 người → `false`". Ca "prefix 50 người nhưng `_tag` AND khớp-đúng 12
  người → `hasMore === false`" (bắt đúng lỗi Finding 2: đếm phải trên `_tag` AND, không
  prefix). Bắt đột biến "gỡ truy vấn đếm, quay lại suy từ `merged.length`".
- **clinic-web** (`cache.test.ts` cho `searchLocal` trả `hasMore`): `searchLocal` trả
  `hasMore = found.length > limit`. Nếu có test component cho `Reception`: `MORE_HINT`
  hiện khi `fresh && hasMore && !local && kind !== 'name+number'`; không hiện khi `local`
  (dù `hasMore` đúng), khi `!fresh`, hay khi `kind === 'name+number'`.

---

## Quyết định 2 — Tie-break tất định để tập 20 ổn định

### Vấn đề

Medplum/Postgres không bảo đảm thứ tự khi không có `_sort`, phần bị cắt đổi theo kế
hoạch truy vấn (tài liệu kế hoạch: "17 và 19 trên 1.198 truy vấn ra tập khác nhau giữa
hai lần chạy"). `rankByNameWords`/`rankByPhoneSuffix` dùng `Array.prototype.sort` (ổn
định trong V8) nên giữ thứ tự *đầu vào* trong cùng nhóm điểm — mà thứ tự đầu vào chính
là thứ tự Medplum trả về, không cố định. Nên trong cùng nhóm điểm hai người có thể đổi
chỗ, và khi nhóm vắt ngang mốc cắt 20 thì tập 20 đổi.

### Giải pháp: khóa phụ theo `id`, một hàm `byId`/`stableById` export duy nhất

`id` của Patient là UUID Medplum, duy nhất và không đổi, nên là khóa tie-break tất
định hoàn hảo; thứ tự UUID không mang nghĩa cho người dùng nhưng *cố định* giữa hai
lần chạy, đúng yêu cầu.

Export **một** cặp `byId`/`stableById` từ `packages/fhir-vn-model/src/searchKeys.ts`,
dùng lại ở *cả* hai comparator `rankBy*` *lẫn* ở `medplum.ts`/`cache.ts`. Không nội tuyến
so-sánh-id ở nơi khác — một hiện thực tie-break duy nhất (đúng bất biến "logic dùng chung
ở model").

```ts
// packages/fhir-vn-model/src/searchKeys.ts
/** So id tăng dần (UUID): khóa tie-break tất định dùng chung cho mọi xếp hạng tìm. */
export function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** Sắp một mảng theo id tăng dần (ổn định). */
export function stableById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort(byId);
}
```

Hai comparator xếp hạng dùng `byId` làm khóa phụ (tie-break xảy ra *trong từng nhóm
điểm*, không phá thứ tự nhóm):

```ts
// searchKeys.ts
export function rankByNameWords<T extends { id: string; fullName: string }>(items: T[], tokens: string[]): T[] {
  const score = (item: T) => (tokens.every((t) => nameTokens(item.fullName).includes(t)) ? 0 : 1);
  return [...items].sort((a, b) => score(a) - score(b) || byId(a, b));
}
// patient.ts (import { byId } from './searchKeys.js')
export function rankByPhoneSuffix<T extends { id: string; phone?: string }>(items: T[], digits: string): T[] {
  const score = (p?: string) => (p?.endsWith(digits) ? 0 : 1);
  return [...items].sort((a, b) => score(a.phone) - score(b.phone) || byId(a, b));
}
```

Hai hàm đã nhận generic có `fullName`/`phone`; `PatientSummary` có `id: string` nên
thêm ràng buộc `id: string` không phá **chỗ gọi sản phẩm** nào (`medplum.ts`,
`cache.ts` đều truyền `PatientSummary`). `patient.ts` import `byId` từ `searchKeys.ts`;
`searchKeys.ts` không import ngược `patient.ts` nên không có vòng phụ thuộc.

### Cập nhật test model (ghim `id` cụ thể)

Các bài trong `packages/fhir-vn-model/test/model.test.ts` hiện gọi `rankByPhoneSuffix`/
`rankByNameWords` với đối tượng **không có `id`** → thêm ràng buộc `id` sẽ hỏng typecheck,
và thứ tự trong nhóm đổi từ "theo đầu vào" sang "theo `id`". Ghim dữ liệu:

- `rankByNameWords`:
  ```ts
  const people = [
    { id: 'a', fullName: 'Bùi Văn An' },   // score 0
    { id: 'b', fullName: 'Bùi Thị Ân' },   // score 0
    { id: 'c', fullName: 'Bùi Thị Anh' },  // score 1
    { id: 'd', fullName: 'Bùi Ánh Tuyết' },// score 1
  ];
  // rankByNameWords(people, ['bui','an']) → ['Bùi Văn An','Bùi Thị Ân','Bùi Thị Anh','Bùi Ánh Tuyết']
  ```
  Bài "thiếu một từ" (`['bui','van','anh']`): mọi người cùng score=1, nên thứ tự ra là
  `id`-tăng-dần = `a,b,c,d`. Cập nhật kỳ vọng thành đúng mảng đó (bỏ `people.map(...)`).
- `rankByPhoneSuffix`:
  ```ts
  const ranked = rankByPhoneSuffix(
    [{ id: 'z', phone: '0956781234' }, { id: 'a', phone: '0912345678' }, { id: 'b', phone: '0907785678' }],
    '5678');
  // nhóm score 0: a,b (theo id); nhóm score 1: z → ['0912345678','0907785678','0956781234']
  ```

### Vị trí chính xác trong `searchPatients`

Thứ tự cuối cùng là `uniqueById([...khớp-đúng, ...rankXxx(mờ)])`. Nhóm "khớp đúng theo
khóa" *luôn* đứng trước nhóm "chỉ khớp mờ" (tính chất đúng cần giữ). Nhưng *bên trong*
nhóm khớp đúng, thứ tự cũng là thứ tự Medplum trả về — cũng không cố định. Vì vậy
tie-break `id` áp **cho cả hai nhóm**: `stableById` cho nhánh khớp đúng, và khóa phụ
`byId` (đã nhúng trong `rankXxx`) cho nhánh mờ. `uniqueById` giữ lần xuất hiện đầu nên
ranh giới nhóm được giữ bằng thứ tự nối mảng:

- Nhánh `name`:
  ```ts
  const [byWords, byPrefix, total] = await Promise.all([
    this.search(exact), this.search(prefix), this.count(exact),   // ĐẾM trên exact (_tag AND), sửa Finding 2
  ]);
  const merged = uniqueById([...stableById(byWords), ...rankByNameWords(byPrefix, intent.tokens)]);
  return { results: merged.slice(0, limit), hasMore: total > limit };
  ```
- Nhánh `phone-fragment`:
  ```ts
  const [bySuffix, containing, total] = await Promise.all([
    this.search({ _tag: phoneSuffixTagQuery(intent.digits), _count: String(SUFFIX_FETCH) }),
    this.search({ 'phone:contains': intent.digits, _count: String(FRAGMENT_FETCH) }),
    this.count({ 'phone:contains': intent.digits }),
  ]);
  const ending = stableById(bySuffix.filter((p) => p.phone?.endsWith(intent.digits)));
  const merged = uniqueById([...ending, ...rankByPhoneSuffix(containing, intent.digits)]);
  return { results: merged.slice(0, limit), hasMore: total > limit };
  ```
- Nhánh `name+number`: xem Quyết định 3.
- Nhánh `cccd`/`phone`: `this.search(...)` như cũ, trả `{ results, hasMore: (await this.count(...)) > limit }`
  cho đồng nhất kiểu (thực tế `hasMore` hầu như luôn false).
- Nhánh `empty`: `{ results: [], hasMore: false }`, không gọi Medplum.
- **`default` (never-guard, sửa Finding 3):** `switch (intent.kind)` thêm
  ```ts
  default: { const _never: never = intent; return _never; }
  ```
  để một biến thể `SearchIntent` mới trong tương lai *không* lọt qua switch mà
  typecheck không báo. (Hiện switch không có `default`; biến thể thiếu arm chỉ bị bắt
  gián tiếp qua kiểu trả không-optional. Never-guard làm chủ ý tường minh.)

Các truy vấn Medplum cắt theo `_count` đặt `_count = limit + 1` (`name` exact + prefix,
`cccd`, `phone`); `phone-fragment` giữ `SUFFIX_FETCH=100`/`FRAGMENT_FETCH=50`. (Nếu một
nhánh phải dùng *phương án lùi* đo-được của Finding 1, `_count = limit + 1` trên truy vấn
khớp-đúng chính là cái phương án lùi cần — không thêm chi phí.)

### Offline

`searchLocal` lọc toàn bộ bộ đệm trong bộ nhớ rồi xếp hạng, nên `hasMore = found.length > limit`.
Nhờ `rankByPhoneSuffix`/`rankByNameWords` (dùng chung) đã có khóa phụ `byId`, thứ tự
offline tất định. Nhánh `name` offline hiện xếp theo `fullName.localeCompare(..., 'vi')`
— giữ phép so người-đọc-được này nhưng **nối thêm `byId`** để hai người cùng tên không
đổi chỗ:
```ts
.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi') || byId(a, b));
```
(`cache.ts` import `byId` từ `@phongmach/fhir-vn-model`.)

### Kiểm thử (Quyết định 2)

- **BFF đơn vị**: ca "Medplum giả trả cùng tập theo thứ tự khác nhau giữa hai lần gọi →
  `results` giống hệt nhau" (mảng đã xáo trộn) — bắt đột biến tie-break mạnh nhất.
- **Model đơn vị**: `stableById`/`byId` với đầu vào xáo trộn → `id` tăng dần;
  `rankByNameWords`/`rankByPhoneSuffix` với phần tử cùng điểm, đầu vào xáo trộn → trong
  nhóm theo `id`.
- **Tích hợp**: chạy cùng truy vấn tên một từ hai lần, hai tập 20 phải bằng nhau (lỗi
  tài liệu kế hoạch mô tả, nay thành bài hồi quy).

---

## Quyết định 3 — Ý định kết hợp tên + số

### Vấn đề và cách tách

Hiện `classifyQuery`: nếu chuỗi khớp `/^[\d\s.+\-()]+$/` thì là số; ngược lại gọi
`nameTokens(q)` ra ý định `name`. Vì vậy `"an 5678"` rơi vào nhánh tên, `nameTokens`
trả `['an','5678']`, rồi BFF AND hai khóa `tu-ten|an` và `tu-ten|5678` — không ai có
"5678" là *từ của tên* nên ra 0 kết quả. Đúng như tài liệu kế hoạch mô tả.

Thêm biến thể vào `SearchIntent` và viết lại `classifyQuery` (gói model, dùng chung):

```ts
export type SearchIntent =
  | { kind: 'empty' }
  | { kind: 'cccd'; cccd: string }
  | { kind: 'phone'; phone: string }
  | { kind: 'phone-fragment'; digits: string }
  | { kind: 'name'; tokens: string[] }
  | { kind: 'name+number'; tokens: string[]; digits: string }; // MỚI
```

Thuật toán `classifyQuery(raw)`:

1. `q = raw.trim()`; rỗng → `empty`.
2. **Nếu `q` toàn số và dấu** (`/^[\d\s.+\-()]+$/`): giữ nguyên hành vi cũ
   (cccd → phone → phone-fragment → empty). Không đổi.
3. **Ngược lại**, tách theo khoảng trắng; với mỗi phần, phần nào `digitsOnly(part) === part`
   (chỉ chữ số, không có chữ cái/dấu) là "mảnh số", còn lại gộp vào chuỗi tên:
   - `tokens = nameTokens(các phần không-số nối lại)`.
   - `digits = digitsOnly(các mảnh số nối lại theo thứ tự xuất hiện)`.
   - Không có mảnh số → `name` (nếu có token) hoặc `empty`.
   - Có mảnh số nhưng **không** có token tên → **số thuần**: chạy lại nhánh số với
     `digits` (phone / cccd / phone-fragment / empty), để `"345 678"` nhất quán với
     `"345678"`.
   - Có **cả** token tên và `digits`:
     - `digits.length < MIN_FRAGMENT` (3): bỏ phần số (quá ngắn, dễ nhiễu) → `name` với `tokens`.
     - `digits.length ≥ MIN_FRAGMENT`: `{ kind: 'name+number', tokens, digits }`.

Ví dụ:
- `"an 5678"` → `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`.
- `"nguyen van an 1985"` → `{ kind: 'name+number', tokens: ['nguyen','van','an'], digits: '1985' }`.
- `"an 12"` → `{ kind: 'name', tokens: ['an'] }` (số quá ngắn, bỏ).
- `"5678"` → `{ kind: 'phone-fragment', digits: '5678' }` (không đổi).

### Diễn giải 4 chữ số: điện thoại-đuôi, không phải năm sinh

Khi `digits` dài đúng 4 và nằm trong `1900..năm hiện tại`, nó mơ hồ: vừa là 4 số cuối
điện thoại, vừa có thể là năm sinh. Phải chọn một.

**Chọn: luôn hiểu `digits` là đoạn số điện thoại (4 số cuối / phone-fragment), không
phải năm sinh.** Lý do theo đúng tinh thần tài liệu kế hoạch:

- Câu nhắc bắt buộc là *"gõ thêm năm sinh **hoặc** 4 số cuối"* — năm sinh và 4 số cuối
  là **hai cách khác nhau** để thu hẹp. Nhưng hạ tầng khóa tìm hiện có (`SEARCH_TAGS.phoneSuffix`,
  `phoneSuffixTagQuery`) chỉ hỗ trợ *đoạn số điện thoại*; **không có** khóa/chỉ mục nào
  cho năm sinh (xác nhận trong `identifiers.ts`/`searchKeys.ts`), và `Patient.birthDate`
  là ngày đầy đủ (`YYYY-MM-DD`).
- Mục M0-3 "Đoạn số" định nghĩa mọi đoạn số là tìm theo *đuôi số điện thoại* ("người
  có số KẾT THÚC bằng đoạn đã gõ"). Diễn giải phone-suffix là diễn giải *doc ngụ ý* cho
  một chuỗi số, và *đã có hạ tầng và đã đo*.
- Lọc theo năm sinh sẽ là *tính năng mới* (thêm khóa tìm năm sinh hoặc tham số
  `birthdate` của Medplum + bài đo) — vượt ba việc của P2. Để lại cho sau (ghi vào
  "Còn lại").

Hệ quả: `"nguyen van an 1985"` lọc "An họ Nguyễn Văn **có số điện thoại kết thúc 1985**".
Không ai khớp cả hai thì trả rỗng — đúng như mọi truy vấn AND; người dùng bỏ bớt điều kiện.

> Giả định nêu rõ: diễn giải 4-số = đuôi điện thoại là lựa chọn có chủ đích dựa trên
> hạ tầng khóa tìm hiện có và phạm vi P2. Nếu chủ dự án muốn `1985` lọc theo *năm sinh*,
> đó là hạng mục riêng (khóa tìm năm sinh + đo) — thiết kế này cố ý không làm.

### Tương tác với câu nhắc trên `name+number` (sửa Finding 4)

Một khi người dùng *đã* gõ `an 5678`, intent là `name+number`, 4 chữ số đã bị dùng làm
đuôi điện thoại. Câu nhắc "gõ thêm … 4 số cuối" lúc này thừa (họ đã cho 4 số).

**Chốt: suppress `MORE_HINT` khi `kind === 'name+number'`.** Lý do: (a) câu nhắc khuyên
người dùng "gõ thêm 4 số cuối" trong khi họ *đã* gõ, nên vô nghĩa; (b) `name AND đuôi-số`
gần như không bao giờ vượt 20 người, nên mất mát hiển thị là không đáng kể.

Guard **đọc `search.kind` từ state** (được đặt từ phản hồi, xem Quyết định 1), không
gọi `classifyQuery(query)` lần nữa:
```ts
const showMoreHint = fresh && search.hasMore === true && !search.local
  && search.kind !== 'name+number';
```
Trước đây guard re-derive `classifyQuery(query).kind` — brittle nếu logic `fresh` đổi và
thêm một lần phân loại mỗi render. Nay suppression gắn vào *kết quả thật* (`search.kind`),
không vào ô nhập (sửa Finding 4). BFF vẫn *tính và trả* `hasMore` cho `name+number` cho
nhất quán kiểu và cho test; chỉ UI chọn không hiện câu nhắc đó — là quyết định, không phải
bỏ sót.

### `hint()`, `startNew()`, `INTENT_LABEL` cho `name+number`

`Reception.tsx` gọi `classifyQuery(query)` trong `hint(query)` và `startNew()`;
`format.ts` phải thêm nhãn, nếu không `INTENT_LABEL['name+number']` ra `undefined` và
`hint()` hiện `"Đang tìm theo undefined"`.

1. `apps/clinic-web/src/format.ts` — thêm nhãn vào `INTENT_LABEL`:
   ```ts
   export const INTENT_LABEL: Record<string, string> = {
     phone: 'số điện thoại',
     'phone-fragment': 'đoạn số điện thoại',
     cccd: 'CCCD',
     name: 'tên (không cần dấu)',
     'name+number': 'tên và số',   // MỚI
   };
   ```
2. `hint(query)` — nhánh `default` cho ra `"Đang tìm theo tên và số"` cho `name+number`
   (đủ dùng; không cần case riêng). Giữ nguyên cấu trúc `switch`.
3. `startNew()` — prefill biểu mẫu bệnh nhân mới cho `name+number`: điền `fullName`
   **từ `query` đã bỏ các mảnh số, giữ dấu/hoa-thường** (sửa Finding 6), vì phần số là
   tiêu chí lọc chứ không phải tên, và vì nhánh `name` đang prefill `query.trim()` (có
   dấu) — làm `name+number` nhất quán:
   ```ts
   // bỏ các mảnh toàn-số (tách theo khoảng trắng), giữ nguyên các từ còn lại
   const nameOnly = (q: string) =>
     q.trim().split(/\s+/).filter((p) => digitsOnly(p) !== p).join(' ');
   const initial: FormInitial =
     intent.kind === 'name' ? { fullName: query.trim() }
     : intent.kind === 'name+number' ? { fullName: nameOnly(query) }
     : intent.kind === 'phone' ? { phone: intent.phone }
     : intent.kind === 'cccd' ? { cccd: intent.cccd }
     : {};
   ```
   (`import { digitsOnly } from '@phongmach/fhir-vn-model'`.) Ví dụ `"Nguyễn Văn An 1985"`
   prefill `"Nguyễn Văn An"` — giữ dấu, bỏ `1985`, giống hành vi nhánh `name`.

### `searchPatients` honor `name+number` (BFF)

Nhánh mới gộp *điều kiện tên* và *điều kiện đoạn số* bằng **AND**. Tái dùng khóa tìm:
một truy vấn `_tag` AND cả khóa từ-tên lẫn khóa đuôi-số, cộng nhánh "lấp chỗ" cho hồ sơ
chưa có khóa, cộng **truy vấn đếm** cho `hasMore`:

```ts
case 'name+number': {
  const digits = intent.digits;
  // Khớp đúng: AND mọi khóa từ-tên VÀ khóa 4-số-cuối trong một truy vấn _tag.
  const exact = new URLSearchParams();
  for (const token of intent.tokens) exact.append('_tag', nameWordTag(token));
  exact.append('_tag', phoneSuffixTagQuery(digits)); // 4+ số: 1 giá trị; 3 số: OR 10 (dấu phẩy)
  exact.set('_count', String(limit + 1));
  // Lấp chỗ: khớp tên theo đầu-từ (hồ sơ cũ chưa có khóa), rồi lọc lại bằng đuôi số thật.
  const prefix = new URLSearchParams();
  for (const token of intent.tokens) prefix.append('name', token);
  prefix.set('_count', String(limit + 1));

  const [byKeys, byPrefix, total] = await Promise.all([
    this.search(exact), this.search(prefix), this.count(exact),
  ]);
  const endsWithDigits = (p: PatientSummary) => digitsOnly(p.phone ?? '').endsWith(digits);
  const keysEnding = stableById(byKeys.filter(endsWithDigits));       // đoạn >4: lọc lại đuôi thật
  const prefixEnding = stableById(byPrefix.filter(endsWithDigits));
  const merged = uniqueById([...keysEnding, ...prefixEnding]);
  return { results: merged.slice(0, limit), hasMore: total > limit };
}
```

Giải thích các cạnh:

- **Đoạn > 4 số** (vd `"an 51234"`): `phoneSuffixTagQuery` tìm theo 4 số cuối của đoạn
  (`1234`), nên `byKeys` có thể gồm người chỉ chung 4 số cuối. Vì vậy `byKeys` **luôn**
  lọc lại bằng `endsWith(digits)` (qua `digitsOnly(p.phone)` cho an toàn với định dạng),
  y như nhánh `phone-fragment`.
- **Đoạn 3 số**: `phoneSuffixTagQuery` sinh OR 10 giá trị; vẫn chạy, rồi lọc `endsWith`.
- **Hồ sơ chưa có khóa** (tạo trước M0-3): không ở `byKeys`, nhưng ra ở `byPrefix` (nhờ
  `HumanName` không dấu, T-NAME) và được giữ nếu đuôi số khớp.
- **AND tên trong `_tag`**: Medplum hiểu nhiều `_tag` cùng tham số là AND (đã đo M0-3).
- **Khi `byKeys` khớp đúng đã vượt `limit`**: `stableById(keysEnding)` là lát cắt
  **theo `id`** của tập người khớp-đúng (tên + đuôi số). Đây là **hành vi có chủ đích**:
  mọi người khớp đúng đều "đúng như nhau", nên cắt theo `id` cho *tất định* là chọn hợp
  lý. `hasMore` của nhánh này lấy từ `this.count(exact)` (đếm chính xác tập khớp-đúng),
  **không** bị chặn bởi `_count` của truy vấn xếp hạng — nhất quán với Finding 1.

Chi phí: nhánh này **ba** truy vấn Medplum song song (một `_tag` AND, một `name` prefix,
một đếm `_summary=count`).

### `searchLocal` honor `name+number` (offline) (sửa Finding 3)

```ts
case 'name+number': {
  const matched = entries
    .filter((e) => {
      const words = foldName(e.patient.fullName).split(' ');
      const nameOk = intent.tokens.every((t) => words.some((w) => w.startsWith(t)));
      const numOk = digitsOnly(e.patient.phone ?? '').endsWith(intent.digits);
      return nameOk && numOk;
    })
    .map((e) => e.patient);
  found = rankByPhoneSuffix(matched, intent.digits); // mọi người đã qua lọc đuôi; byId tie-break
  break;
}
```

Và `searchLocal` thêm **never-guard** vào `switch (intent.kind)** (sửa Finding 3): switch
hiện không có `default`, `let found: PatientSummary[]` được dùng-trước-gán chỉ nhờ mỗi arm
gán `found` (hoặc `return`). Thêm:
```ts
default: { const _never: never = intent; return _never; }
```
để biến thể `SearchIntent` mới sau này không lọt qua mà không gán `found` (typecheck báo
ngay ở `default`). Offline dùng *cùng quy ước* (AND tên + đuôi số, tie-break `id`) như
BFF. Chênh lệch đã tồn tại: offline khớp tên theo *đầu-từ*, BFF `byKeys` khớp *đúng cả
từ* (bộ đệm nhỏ nên đầu-từ đủ dùng) — thiết kế này không làm tệ hơn.

### Mục 3 của nhiệm vụ (offline đưa người khớp đúng lên đầu)

Thỏa như hệ quả: `searchLocal` dùng `rankByPhoneSuffix` cho `phone-fragment` và nay cho
`name+number` (đuôi đúng lên trước), nhánh `name` offline xếp theo tên + `byId`. Không
cần đổi gì thêm cho riêng mục (3) ngoài tie-break `id` của Quyết định 2.

### Validation đầu vào (Quyết định 3)

`classifyQuery` nhận **một chuỗi tự do**; không có "lỗi" phân loại, mọi chuỗi đều ra
một `SearchIntent` hợp lệ (xấu nhất là `empty`). Ràng buộc độ dài do route Zod lo
(`q: z.string().max(100)`, giữ nguyên). Quy tắc cụ thể cho phần số trong chuỗi lẫn:

- `digits` rút bằng `digitsOnly`, **nối mọi chữ số của mọi mảnh số theo thứ tự xuất hiện**.
- Ngưỡng kích hoạt lọc số trong chuỗi lẫn: `MIN_FRAGMENT = 3` (tái dùng). Dưới ngưỡng →
  bỏ phần số, chỉ tìm tên.
- Không chặn giới hạn trên của `digits`: `phoneSuffixTagQuery` xử lý ≥ 4 bằng 4 số cuối,
  lọc `endsWith` lo phần còn lại.
- Không còn gì để tìm (không token tên lẫn không đủ số) → `empty` → `{ results: [], hasMore: false }`.
  Không ném lỗi.

### Kiểm thử (Quyết định 3) — ghim ca ghép/đảo

- **Model đơn vị** (`fhir-vn-model/test/model.test.ts`): bảng ca `classifyQuery`, mỗi ca
  ghim intent kỳ vọng:
  - `"an 5678"` → `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`
  - `"nguyen van an 1985"` → `{ kind: 'name+number', tokens: ['nguyen','van','an'], digits: '1985' }`
  - `"an 12"` → `{ kind: 'name', tokens: ['an'] }` (số quá ngắn, bỏ)
  - `"an 56 78"` → `{ kind: 'name+number', tokens: ['an'], digits: '5678' }` (nối nhiều mảnh số)
  - `"an5678"` (không khoảng trắng) → `{ kind: 'name', tokens: ['an5678'] }` — là **một**
    token chữ-lẫn-số (`digitsOnly('an5678') !== 'an5678'`), không tách; hành vi đã ghim.
  - `"5678 an"` (số trước) → `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`.
  - `"5678"` → `{ kind: 'phone-fragment', digits: '5678' }` (không đổi).
  - `"0912 345 678"` → `{ kind: 'phone', phone: '0912345678' }` (không đổi).
  - Các ca cũ (`'Nguyễn Văn An'`, `'001234567890'`, `''`, `'12'`) không đổi.
- **BFF đơn vị**: nhánh `name+number` với Medplum giả — AND khóa tên + khóa đuôi; đoạn
  >4 lọc `endsWith`; hồ sơ chưa khóa ra qua prefix và giữ nếu đuôi khớp; bỏ trùng;
  `hasMore` từ truy vấn đếm; lát cắt `byKeys` theo `id` khi vượt `limit`.
- **BFF tích hợp**: `"<FAMILY> van an <4 số cuối thật>"` ra đúng người; `"an 5678"` khi
  dữ liệu mẫu có người tên An số đuôi 5678.
- **clinic-web** (`cache.test.ts`): `searchLocal` với `name+number` AND đúng, xếp đúng;
  nếu có test component: `Reception` không hiện `MORE_HINT` khi `search.kind === 'name+number'`;
  `startNew()` cho `"Nguyễn Văn An 1985"` prefill `"Nguyễn Văn An"`.

---

## Danh sách tệp chạm

Chỉ các tệp ba mục cần:

- `packages/fhir-vn-model/src/search.ts` — thêm biến thể `name+number` vào `SearchIntent`;
  viết lại thuật toán tách tên/số trong `classifyQuery`.
- `packages/fhir-vn-model/src/searchKeys.ts` — thêm `byId` + `stableById` (export dùng
  chung); thêm khóa phụ `byId` vào `rankByNameWords` (ràng buộc generic thêm `id`).
- `packages/fhir-vn-model/src/patient.ts` — thêm khóa phụ `byId` vào `rankByPhoneSuffix`
  (import `byId` từ `searchKeys.js`; ràng buộc generic thêm `id`).
- `packages/fhir-vn-model/src/index.ts` — xác nhận `byId`/`stableById`/biến thể mới
  được re-export (gói dùng `export *`, tự có; chỉ cần khai báo nằm trong các tệp trên).
- `packages/fhir-vn-model/test/model.test.ts` — ghim `id` cho dữ liệu `rankByPhoneSuffix`/
  `rankByNameWords`; cập nhật kỳ vọng bài "thiếu một từ"; bảng ca `classifyQuery` cho
  `name+number` (gồm `an5678`, `5678 an`, `an 56 78`); ca `stableById`/`byId`.
- `services/bff/src/store.ts` — đổi chữ ký `searchPatients` trả `PatientSearchResult`
  (thêm interface `PatientSearchResult`).
- `services/bff/src/medplum.ts` — `searchPatients`: nhánh `name+number`; **never-guard
  `default`**; hàm nội bộ `count` (dùng `this.medplum.search`, đọc `bundle.total`);
  `hasMore` từ `count` trên truy vấn khớp-đúng; `_count = limit + 1`; `stableById` cho
  các nhóm khớp đúng.
- `services/bff/src/app.ts` — route `/api/patients/search` trả thêm `hasMore` (không đổi
  phần ghi nhật ký).
- `apps/clinic-web/src/api.ts` — kiểu trả `api.search` thêm `hasMore: boolean`.
- `apps/clinic-web/src/format.ts` — thêm nhãn `name+number` vào `INTENT_LABEL`.
- `apps/clinic-web/src/local/cache.ts` — `searchLocal` trả `{ results, hasMore }`; thêm
  `case 'name+number'` **và never-guard `default`**; nối `byId` cho nhánh `name` offline
  (import `byId`, `digitsOnly` đã import).
- `apps/clinic-web/src/local/client.ts` — `searchCache` trả thêm `hasMore`.
- `apps/clinic-web/src/components/Reception.tsx` — `Search` type thêm `hasMore` + `kind`;
  đặt cả hai ở hai `setSearch`; guard `showMoreHint` đọc `search.kind` (loại trừ
  `name+number`); hằng `MORE_HINT`; render trong `#search-status`; `startNew()` prefill
  `name+number` giữ dấu.
- Các tệp test tương ứng (đã liệt kê ở từng quyết định), gồm **mock `search` cho Medplum
  giả** trong `services/bff/test/unit/search.test.ts`.

## Xử lý lỗi theo thao tác

- **Gọi Medplum lỗi mạng/5xx trong `searchPatients`** (kể cả truy vấn `count` mới):
  lỗi ném lên như hiện tại (`this.search`/`this.medplum.search`/`this.count` không bắt).
  Vì các truy vấn chạy trong `Promise.all`, *bất kỳ* truy vấn nào lỗi làm cả lượt tìm
  lỗi — *fatal* cho lượt đó. Route không có `try/catch` riêng → rơi vào `setErrorHandler`
  của Fastify → 500 `{ error: 'internal' }`, chỉ log tên+thông điệp (không PII). *Có thể
  phục hồi* phía client: `api.ts` biến lỗi mạng (`fetch` ném) thành `ApiError(0, 'network')`,
  và `Reception.tsx` khi `status === 0` chuyển sang `searchLocal`. Không đổi hành vi này.
- **`Bundle.total` thiếu** (Medplum không điền `total`): `count` trả `0` (toán tử `?? 0`),
  nên `hasMore = false`. Đây là mặc định *an toàn phía hiển thị* (thà không hiện câu nhắc
  còn hơn hiện sai) **nhưng** cũng là chế độ hỏng-thầm của yêu cầu (1) — chính vì vậy bài
  tích hợp "điều kiện tiên quyết" phải chứng minh `total` đúng *trước*, và nếu không đúng
  thì nhánh đó chuyển sang phương án lùi `_count=limit+1` (Finding 1), *không* dựa vào
  `?? 0`.
- **Zod từ chối `q` > 100 ký tự**: 400 `bad-request` (hiện có). Không đổi.
- **`classifyQuery` với chuỗi lạ** (chỉ dấu câu, emoji, chữ-lẫn-số dính liền): không
  ném; trả `empty` hoặc `name` tùy nội dung. `nameTokens`/`digitsOnly` chịu được chuỗi bất kỳ.
- **`PatientSummary.phone` thiếu/khác chuẩn** khi lọc `endsWith`: dùng
  `digitsOnly(p.phone ?? '')` nên `undefined`/định dạng lạ không ném, chỉ không khớp
  (an toàn, không lọt người sai lên đầu).
- **Offline `searchLocal` lỗi đọc bộ đệm**: lỗi store nổi lên `Reception.tsx` `catch` →
  trạng thái `error`. Giữ nguyên.

Mọi lỗi trên **không ghi dữ liệu bệnh nhân**: route search chỉ ghi nhật ký khi *thành
công* (trước khi trả), đúng quy ước "ghi nhật ký trước khi dữ liệu rời BFF".

## Bất biến và lớp sở hữu

- **Quy ước tìm & xếp hạng thuộc BFF, không tin client**: `searchPatients` quyết định
  thứ tự, bỏ trùng, cắt 20 và `hasMore` (từ truy vấn đếm của chính BFF); client chỉ
  *hiển thị* `results`/`hasMore`, không tự xếp lại, không tự đếm. Enforce ở `medplum.ts`
  (nguồn sự thật) + route trả thẳng cờ.
- **Phân loại/xếp hạng/tie-break dùng chung ở `@phongmach/fhir-vn-model`**: `classifyQuery`,
  `rankByNameWords`, `rankByPhoneSuffix`, `byId`, `stableById` sống ở gói model; cả BFF
  và offline import từ đó. Enforce bằng việc *không* nhân bản logic trong `cache.ts`/
  `medplum.ts` — chúng chỉ gọi hàm model. Có đúng **một** hiện thực tie-break (`byId`).
- **Tính đầy đủ của `switch`**: cả `searchPatients` (BFF) và `searchLocal` (offline) có
  never-guard `default`, nên biến thể `SearchIntent` mới trong tương lai bắt buộc có arm
  ở cả hai nơi, typecheck báo ngay — không lọt thầm (sửa Finding 3).
- **`meta.tag` là nguồn khóa tìm chính xác** (bất biến M0-3): không chạm `searchKeys`/
  `withSearchKeys`; nhánh `name+number` chỉ *đọc* khóa qua `nameWordTag`/`phoneSuffixTagQuery`,
  không thêm hệ khóa mới (không có khóa năm sinh — xem Quyết định 3).

## Khả năng kiểm thử

- **Đơn vị thuần (tất định, không I/O):** `classifyQuery`, `rankByNameWords`/
  `rankByPhoneSuffix`/`byId`/`stableById`, `searchLocal`. Lớp này chứa gần như toàn bộ
  logic mới → test rẻ và chắc.
- **BFF đơn vị với Medplum giả** (`search.test.ts`): phần gộp/xếp hạng/`hasMore`/tie-break.
  Medplum giả hiện chỉ có `searchResources`; **phải thêm `search`** trả `Bundle` với
  `.total` khi `_summary=count`. Bắt mọi đột biến tất định (gỡ truy vấn đếm, gỡ tie-break,
  gỡ lọc `endsWith`, gỡ cờ, đếm trên prefix thay vì `_tag` AND).
- **Tích hợp trên Medplum thật** (`bff.test.ts`): (a) **điều kiện tiên quyết** —
  `_summary=count` trả `Bundle.total` chính xác cho `_tag` AND / `phone:contains` /
  `_tag` AND tên+đuôi (Finding 1); (b) `_tag` AND/OR cho `name+number`; (c) `hasMore`
  đúng cho truy vấn một từ; (d) hai lần chạy ra cùng tập 20. Theo bài học tài liệu kế
  hoạch, **không** giao bắt-đột-biến cho tích hợp (thứ tự Medplum không ổn định); việc đó
  thuộc bài tất định.
- **Chi phí chưa đo:** truy vấn đếm `_summary=count` thêm một lời gọi Medplum song song
  mỗi lượt tìm (nhánh `name`/`phone-fragment`/`name+number`): từ 40 lên 60 điểm hạn mức
  (F5), và một truy vấn Postgres thêm (dù `_summary=count` không kéo tài nguyên). Các số
  M0-3 đo ở 2 truy vấn; nên đo lại p95 với truy vấn đếm trước buổi trình diễn. Đây là chi
  phí có chủ đích để đổi lấy `hasMore` *đúng* — thà đúng-và-đo còn hơn nhanh-mà-sai. Nếu
  đo thấy `total` không đáng tin, phương án lùi `_count=limit+1` *không* thêm truy vấn
  (gộp vào truy vấn khớp-đúng sẵn có).

## VERIFY

Theo nhiệm vụ: `pnpm typecheck && pnpm test`, và `pnpm --filter @phongmach/bff test:integration`
(cần stack đang chạy). Đổi chữ ký `searchPatients` làm `typecheck` bắt ngay mọi chỗ gọi
chưa cập nhật (store interface, medplum impl, route); never-guard `default` làm thiếu arm
`name+number` ở hai switch bị bắt tường minh. Đổi kiểu trả `api.search` + `Search` type
cũng được `typecheck` bắt ở `Reception.tsx`. **Bài tích hợp "điều kiện tiên quyết" của
Finding 1 phải xanh trước khi tin vào `hasMore`.**

---

## Phản hồi review (đối chiếu từng finding — vòng 3)

**Finding 1 (HIGH) — `_summary=count` → `Bundle.total` là hành vi Medplum chưa kiểm
chứng mà cả `hasMore` dựa vào.** *Đã sửa.* (a) Thêm một bài tích hợp làm **điều kiện tiên
quyết**: seed dân số đã biết (25 người) và assert `Bundle.total === 25` cho *từng* hình
truy vấn thực dùng (`_tag` AND khóa-từ-tên, `phone:contains`, `_tag` AND tên+đuôi). (b)
Nêu **phương án lùi tất định** nếu `total` bị trần/ước lượng ở nhánh nào:
`_count = limit + 1` trên truy vấn khớp-đúng + `fetched.length > limit`. (c) Ghi rõ mặc
định `?? 0` là chế độ hỏng-thầm nên *không* được dựa vào — bài tiên quyết phải chứng minh
trước. (d) Chốt chỉ dùng `this.medplum.search` để đọc `bundle.total` (không `searchResources`).

**Finding 2 (MEDIUM) — nhánh `name` đếm trên prefix nên báo thừa dân số khớp-đúng.**
*Đã sửa.* `hasMore` của nhánh `name` nay đếm trên **truy vấn `_tag` AND khóa-từ-tên**
(tập khớp-đúng), không phải truy vấn `name` prefix. Nêu rõ lý do: câu nhắc "còn người
**trùng tên**" nói về khớp-đúng-cả-từ, và chuỗi xếp hạng cũng đặt khớp-đúng lên trước.
`phone-fragment` giữ `phone:contains` (Medplum không có "ends-with") và ghi rõ đây là
đánh đổi báo-thừa-nhẹ có chủ đích. Thêm ca unit "prefix 50 nhưng `_tag` AND 12 →
`hasMore=false`".

**Finding 3 (MEDIUM) — hai `switch` không có never-guard; `name+number` offline chỉ được
giả định.** *Đã sửa.* Nêu tường minh cả `searchPatients` (BFF) và `searchLocal` (offline)
thêm arm `name+number` **và** một `default: { const _never: never = intent; return _never; }`.
Liệt kê `medplum.ts` và `cache.ts` trong "Danh sách tệp chạm" cho việc này; thêm vào
"Bất biến" một mục về tính đầy đủ của switch.

**Finding 4 (MEDIUM) — guard suppress câu nhắc re-derive `classifyQuery(query)` thay vì
đọc từ phản hồi.** *Đã sửa.* `Search` state thêm `kind?: SearchIntent['kind']`, đặt từ
`r.intent` (online) và `classifyQuery(query).kind` (offline, một lần) trong hai `setSearch`.
Guard thành `... && search.kind !== 'name+number'`, bỏ lần gọi `classifyQuery(query)` thừa,
gắn suppression vào kết quả thật thay vì ô nhập.

**Finding 5 (NIT) — mâu thuẫn `_total=accurate` vs `_summary=count`.** *Đã sửa.* Bỏ hẳn
câu `_total=accurate`; chỉ nêu một cơ chế `_summary=count` một lần, trong phần "Cơ chế đếm".

**Finding 6 (NIT) — `startNew()` prefill `name+number` mất dấu/hoa-thường.** *Đã sửa.*
Prefill `fullName` từ `query` đã **bỏ các mảnh toàn-số, giữ nguyên các từ còn lại** (giữ
dấu/hoa-thường) qua helper `nameOnly(query)`, nhất quán với nhánh `name` (vốn prefill
`query.trim()`). Ví dụ `"Nguyễn Văn An 1985"` → `"Nguyễn Văn An"`.
