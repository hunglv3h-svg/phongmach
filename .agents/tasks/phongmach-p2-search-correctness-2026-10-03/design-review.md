# Design review — P2 cải thiện tính đúng khi tìm bệnh nhân

Reviewed: `.agents/tasks/phongmach-p2-search-correctness-2026-10-03/design.md` (bản sửa vòng 3)
Worktree: `.worktrees/p2-search-correctness`
Cross-checked requirement list: `docs/ke-hoach-trien-khai.md` → mục 2, "Sau khi sửa" → "Còn lại, chưa làm" (quanh dòng 184–187).

Verdict: **CHANGES_REQUESTED** (1 MEDIUM, 3 NIT).

The design is unusually careful: it already closed the earlier round's HIGH (`Bundle.total` unverified) with a prerequisite integration test plus a deterministic fallback, and it resolves all three required decisions explicitly. The remaining MEDIUM is a correctness gap of the *same class* the design claims to have closed (a silent "never show the hint" path), but on a different input — un-backfilled legacy records — which the plan doc itself flags as an outstanding one-time operation.

The three required decisions map cleanly to the task and are each unambiguous on *backfilled* data:

1. **"More than 20 matches" signal + UI hint.** Field `hasMore: boolean` (always present) on `GET /api/patients/search`; store signature changes to `PatientSearchResult { results; hasMore }`; UI shows the exact Vietnamese string in `#search-status` (existing `aria-live="polite"` region). Mechanism is a separate `_summary=count` query reading `Bundle.total`, counted on the *exact* (`_tag` AND) population — correct semantics for "còn người trùng tên".
2. **Deterministic tie-break.** Field is Patient `id` (Medplum UUID), via a single shared `byId`/`stableById` in `searchKeys.ts`, used as the secondary comparator inside `rankByNameWords`/`rankByPhoneSuffix` and as `stableById` on the exact groups, applied before `slice(0, limit)`.
3. **Mixed name+number + 4-digit interpretation.** New `name+number` variant in `classifyQuery`; 4 digits always interpreted as phone suffix (not birth year), with a stated, scoped rationale; both `searchPatients` (BFF) and `searchLocal` (offline) honor it, each with an added `never`-guard `default`.

---

## Findings

### 1. [MEDIUM] `hasMore` for `name` / `name+number` counts only the keyed (`_tag`) population, but the displayed set also includes legacy un-keyed records via the prefix query — on un-backfilled data the hint silently never shows

Where: Quyết định 1, "`hasMore` lấy từ một truy vấn đếm chính xác — và đếm đúng dân số nào"; and Quyết định 2, nhánh `name` snippet (`this.count(exact)` where `exact` is `_tag` AND name-word keys). Also the `name+number` branch (`this.count(exact)`).

Problem: the ranked, displayed result set for `name` is `uniqueById([...byWords (_tag AND), ...rankByNameWords(byPrefix, …)])`. The `byPrefix` arm exists *specifically* to surface records created before M0-3 that have no `meta.tag` search keys (verified: `searchPatients` nhánh `name` in `services/bff/src/medplum.ts` lines 118–131, and `buildPatient`/`patchPatient` only write keys going forward). The count query, however, runs on `_tag` AND only. So for a population where keys are not yet backfilled:

- displayed results can legitimately include >20 people (via prefix), while
- `total = count(_tag AND)` ≤ 20 because the un-keyed records are not counted,

so `hasMore = total > limit` is `false` and the UI never shows "còn người trùng tên …" even though more than 20 people match. This is exactly the silent-failure mode of requirement (1) that the design went to great lengths to prevent for the `Bundle.total` case — but it reappears here on un-keyed data, and the design does not state the precondition.

This is not hypothetical: the plan doc's own "Còn lại, chưa làm" lists *"Bệnh nhân đang có trên các stack đã chạy từ trước cần ghi bổ sung khóa một lần … Chưa chạy trên stack dev dùng chung."* The design assumes keys are fully present but never says so, and the prerequisite integration test seeds a *keyed* population (`buildPatient`), so it would not catch this.

Concrete fix — pick one and state it:
- (a) Make the backfilled-keys state an explicit, documented precondition of `hasMore` correctness (same status as the `Bundle.total` precondition): add an assertion/note that `hasMore` is only accurate once `backfill:search-keys` has run for the tenant, and that un-backfilled tenants may under-report. The integration prerequisite test should additionally include at least one legacy (no-`meta.tag`) record and assert the documented behavior, so the limitation is pinned rather than silent. OR
- (b) Count on a population that matches the displayed set: run the count on the `name` prefix query as well and take `hasMore = max(totalExact, …)` is wrong semantically (that was Finding 2 of the prior round). Instead, keep the exact count but add a cheap `_count = limit + 1` check on the *prefix* arm and set `hasMore = totalExact > limit || byPrefix.length > limit` — i.e. "more than 20 either by exact keys or by displayed prefix matches". This keeps the "trùng tên" semantics for the keyed case while not silently hiding the signal when the displayed set overflows on legacy data. (The prefix arm is already fetched with `_count = limit + 1`, so this adds no query.)

Either is acceptable; the design must say which, because the two give different user-visible behavior on un-backfilled tenants and the task's requirement (1) is "phải báo" without a backfill caveat.

---

### 2. [NIT] Existing `searchLocal` callers in `cache.test.ts` break on the return-type change; design lists the file but not the specific helper

Where: "Danh sách tệp chạm" lists `apps/clinic-web/src/local/cache.test.ts`, and Quyết định 1 "Kiểm thử" says "`cache.test.ts` cho `searchLocal` trả `hasMore`".

Problem: `cache.test.ts` currently has `const names = (q) => searchLocal(q, CACHE).map((p) => p.fullName);` (verified, line 14) and every name/phone assertion flows through it. Changing `searchLocal` to return `{ results, hasMore }` breaks `.map` here and in `OfflineClient.searchCache` (`client.ts` line 144, `return { results: searchLocal(query, entries), total: … }`). `searchCache`'s change is covered in the design (it rewrites that call), but the pre-existing `names` helper is not called out.

Impact is small: `typecheck` catches both (`.map` on an object; object-in-object). Non-blocking, but the design should name the `names` helper (→ `searchLocal(q, CACHE).results`) so the implementer doesn't rewrite assertions blindly.

Concrete fix: in Quyết định 1/3 test notes, add: "cập nhật helper `names` trong `cache.test.ts` thành `searchLocal(q, CACHE).results`."

---

### 3. [NIT] Offline `name+number` `hasMore` counts a prefix-matched population while BFF counts the exact-keyed population — divergent, though harmless because the offline hint is suppressed

Where: Quyết định 2 "Offline" (`hasMore = found.length > limit`) combined with Quyết định 3 `searchLocal` nhánh `name+number` (name matched by `startsWith` prefix).

Problem: for `name+number`, BFF `hasMore` comes from `count(_tag AND tên + đuôi)` (exact), while offline `hasMore` is `found.length > limit` where `found` was filtered by name-*prefix* + exact phone suffix. These are different populations, so the single `hasMore` field in `Search` state carries different semantics depending on online/offline. The design states the online/offline name-match divergence is pre-existing and acceptable (bộ đệm nhỏ), and the UI guard `!search.local && kind !== 'name+number'` suppresses the hint in both the offline and `name+number` cases — so this never reaches the user. It is a consistency nit worth a one-line acknowledgement, not a behavior change.

Concrete fix: add a sentence to the Offline section noting that offline `hasMore` for `name+number` is prefix-based (not exact) and that it is never displayed (guard suppresses it on both `local` and `name+number`), so the divergence is intentional and inert.

---

## Verified assumptions

The design's claims about existing code were checked against the worktree source and are accurate:

- **`classifyQuery` current shape** — pure-number regex `/^[\d\s.+\-()]+$/` → cccd/phone/phone-fragment; else `nameTokens` → `name`; `MIN_FRAGMENT = 3`. Matches `packages/fhir-vn-model/src/search.ts`. The claim that `"an 5678"` currently yields `name` with tokens `['an','5678']` and ANDs `tu-ten|an` AND `tu-ten|5678` → 0 results is correct.
- **`searchPatients` returns `Promise<PatientSummary[]>`** and the `switch` has no `default`; nhánh `name` runs `_tag` AND (`nameWordTag`) + `name` prefix in parallel; nhánh `phone-fragment` runs `phoneSuffixTagQuery` key + `phone:contains`, filters `endsWith`, `uniqueById`, `slice(limit)`. Matches `services/bff/src/medplum.ts`.
- **`SUFFIX_FETCH=100`, `FRAGMENT_FETCH=50`** constants exist as described.
- **`rankByNameWords` lives in `searchKeys.ts`** with generic `<T extends { fullName: string }>` (no `id`); **`rankByPhoneSuffix` lives in `patient.ts`** with `<T extends { phone?: string }>` (no `id`). Both lack the `id` constraint the design adds, and neither currently has a secondary tie-break. Confirmed.
- **No import cycle for `byId`**: `searchKeys.ts` imports only `identifiers.js`, `phone.js`, `text.js`; `patient.ts` already imports `withSearchKeys` from `searchKeys.js`. Adding `byId` import in `patient.ts` from `searchKeys.js` is safe. Confirmed.
- **Production callers of the two rankers all pass `PatientSummary`** (which has `id: string`): `medplum.ts` (both), `cache.ts` (`rankByPhoneSuffix`). So the added `id` constraint breaks no product call site, only `model.test.ts` fixtures lacking `id` — exactly as the design states. Confirmed.
- **`index.ts` uses `export *`** over the touched files, so new `byId`/`stableById`/variant are auto re-exported. Confirmed.
- **BFF unit mock only implements `searchResources`, not `search`** (`services/bff/test/unit/search.test.ts`), and its `searchResources` throws on unexpected queries. The design's statement that a `search` mock returning a `Bundle` with `.total` for `_summary=count` must be added is correct and necessary.
- **`_tag` AND / OR semantics** (repeated `_tag` = AND; comma within one value = OR) is [Đã đo] in the plan doc (mục 2, "Sau khi sửa"); the `name+number` exact query (`exact.append('_tag', nameWordTag(token))` × tokens, plus `exact.append('_tag', phoneSuffixTagQuery(digits))`) relies on exactly this and is consistent.
- **`phoneSuffixTagQuery`**: ≥4 digits → single `suffix|<last4>`; 3 digits → comma-OR of 10. Matches `searchKeys.ts`; the design's 3-digit / >4-digit edge handling (filter by full `endsWith`) is consistent with the existing `phone-fragment` branch.
- **UI anchor points**: `#search-status` with `aria-live="polite"`, `data-testid="search-status"` exists; `Search` type is `{ status; results; forQuery?; error?; local? }` (no `hasMore`/`kind`); `startNew()` currently prefills `name → query.trim()`; `hint()` uses a `switch` with a `default` that reads `INTENT_LABEL[intent.kind]`. All match `Reception.tsx`.
- **`INTENT_LABEL`** has no `name+number` key (would render `undefined`), so adding `'tên và số'` is required — and `hint()`'s `default` then yields "Đang tìm theo tên và số" as the design claims. Matches `format.ts`.
- **`api.search` returns `{ intent: string; results: PatientSummary[] }`**; adding `hasMore` is required. Matches `api.ts`.
- **`searchCache` returns `{ results, total }`** and calls `searchLocal(query, entries)` without `limit`. Matches `client.ts`.
- **`searchLocal` returns `PatientSummary[]`**, no `default` arm, `let found: PatientSummary[]` assigned per-arm; `name` arm sorts by `localeCompare(…, 'vi')`; `phone-fragment` arm uses `rankByPhoneSuffix` on `digitsOnly(...).includes(...)`. Matches `cache.ts`. The design's `foldName`/`digitsOnly` usage in the new `name+number` arm reuses symbols already imported.
- **Route `/api/patients/search`** destructures `{ q, limit }` from `searchQuery` (`q: z.string().max(100).default('')`, `limit: 1..50 default 20`), calls `store.searchPatients(intent, limit)`, then `record(req, 'search', { queryKind, resultCount: results.length, resourceIds })`, returns `{ intent: intent.kind, results }`. The design's proposed edit (destructure `hasMore`, keep `resultCount: results.length`, add `hasMore` to the returned object) is accurate and preserves the "log before data leaves BFF" invariant. Matches `app.ts`.
- **`finishedVisits` returns `{ visits, truncated }`** — confirming the design's reasoning for choosing `hasMore` over `truncated` (distinct semantics) in `store.ts`.
- **Requirement list** in `docs/ke-hoach-trien-khai.md` "Còn lại, chưa làm": (1) >20-match hint + unstable 20, (2) mixed name+number `an 5678`, (3) offline bring-exact-to-top. The three decisions cover exactly these. The two extra bullets (one-time key backfill on shared dev stack; search keys are plaintext PII → T-ENC) are out of P2 scope and the design correctly does not claim them — but bullet 1 (backfill) is the root of Finding 1.

## Unverified / wrong assumptions

- **Nothing was found to be factually wrong** about the existing code.
- **`Bundle.total` accuracy under `_summary=count`** for `_tag` AND / `phone:contains` / `_tag` AND tên+đuôi remains genuinely unverified against Medplum 5.2.0 — but the design *correctly flags this as unverified*, makes it a blocking prerequisite integration test, and provides a deterministic `_count = limit + 1` fallback. This is handled, not a finding.
- **Cost of the extra `_summary=count` query** (40 → 60 quota points, extra Postgres query per search; M0-3 p95 measured only the 2-query path) is unmeasured. The design discloses this and recommends re-measuring p95 before the demo. Disclosed, not a finding.
- **Finding 1's un-keyed-population behavior is the one unstated assumption**: the design implicitly assumes `meta.tag` keys are present for the whole searchable population, which the plan doc contradicts for pre-existing/un-backfilled tenants. See Finding 1.
