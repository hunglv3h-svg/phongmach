# P2 — cải thiện tính đúng khi tìm bệnh nhân

Threads a BFF-owned `hasMore` flag through the whole search path, teaches `classifyQuery` to split a mixed name+number query into an AND of name tokens and a phone suffix, and adds a shared `byId`/`stableById` tie-break so the truncated top-20 is identical between runs. The ranking and classification stay in `@phongmach/fhir-vn-model` so the online (BFF) and offline (cache) paths cannot drift. The three requirements map cleanly onto the three design decisions, and the implementation matches the approved design decision-for-decision.

Watch for: nothing blocking. One intentional online/offline asymmetry in how `hasMore` is computed for `name+number` is documented in code and never surfaces to the UI (confirmed). The `_summary=count` → `Bundle.total` assumption remains unproven until the integration step runs, but the design's deterministic fallback is already wired for the un-keyed overflow case (confirmed).

**Verdict**: APPROVED

## High-level view

Requirement (1) is met by a `hasMore: boolean` that is always present on the search response. BFF decides it from a dedicated `_summary=count` query (never from the fetched set size), the route passes it straight through, and `api.ts` → `Search` state → both `setSearch` calls carry it to the exact Vietnamese hint rendered in the `#search-status` aria-live region. The hint is suppressed for `local` results and for the `name+number` kind. For the `name` branch, `hasMore` is `totalExact > limit || byPrefix.length > limit` — the exact `_tag`-AND count OR the limit+1 prefix overflow — so legacy records that only surface through the un-keyed prefix arm still trigger the hint.

Requirement (2) is met by a new `name+number` variant on `SearchIntent`. `classifyQuery` splits whitespace-separated pure-digit fragments from the name tokens, joins the digits, and treats 4 digits as a phone suffix, not a birth year. Both `searchPatients` (BFF, `_tag` AND of name-word keys AND the phone-suffix key, plus a prefix fill arm) and `searchLocal` (offline) honor it, and both switches end in a `never`-guard default. Classification lives in the model package.

Requirement (3) is met by a single shared `byId`/`stableById` exported from `searchKeys.ts`, used as the secondary comparator inside `rankByNameWords` and `rankByPhoneSuffix` and applied to the exact groups before `slice(0, limit)`. `searchLocal` uses the same rankers (and appends `byId` after the Vietnamese `localeCompare` for the offline `name` branch), so offline ordering is deterministic too.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. One intentional, documented online/offline asymmetry is noted in the details below for the record.

</details>

<details>
<summary>Details</summary>

### `hasMore` is counted, not inferred — and on the right population

The design's hard rule is that `hasMore` never comes from the size of the merged/fetched set, because each ranking query is a union of two Medplum queries, each capped at `_count` and unsorted. The implementation holds to this: `searchPatients` runs a separate `count()` (`_summary=count`, reading `bundle.total`) in the same `Promise.all` as the ranking queries, so a search is still one Medplum round trip (confirmed, `medplum.ts`).

The `name` branch counts on the exact `_tag`-AND query (the "trùng tên" population the prompt is about), not the broader `name` prefix query. The one subtlety worth calling out is the OR in `hasMore: totalExact > limit || byPrefix.length > limit`. Records created before search keys existed carry no `_tag`, so they never appear in the exact count; they surface only through the prefix arm. Counting the exact set alone would under-report "còn người" for a clinic with legacy records. The `|| byPrefix.length > limit` closes that gap, and the unit test at `search.test.ts:152` pins exactly this case (`_tag` AND count 0, prefix overflow → `hasMore === true`). This un-keyed overflow path is handled.

`phone-fragment` counts on `phone:contains`, which the code comment flags as a deliberate slight over-report (Medplum has no ends-with), consistent with the design. `name+number` counts on the exact `_tag`-AND set.

### `classifyQuery` splits name from number, 4 digits = phone suffix

`classifyQuery` keeps the all-numeric fast path unchanged, then for mixed strings splits on whitespace: a part is a number only when `digitsOnly(part) === part`, so `an5678` (glued) stays a single name token rather than splitting — a sharp edge the model test pins (`model.test.ts`). Digits from multiple fragments are concatenated in order (`an 56 78` → `5678`), fragments shorter than `MIN_FRAGMENT` (3) are dropped back to a plain `name`, and a mixed string with digits but no name tokens falls back to the pure-number classifier so `345 678` matches `345678`. Four digits are always a phone suffix; the design's rationale (no birth-year search key exists, suffix infra is already measured) is sound and in scope.

Both `searchPatients` and `searchLocal` end their `switch (intent.kind)` with `default: { const _never: never = intent; return _never; }`, so a future `SearchIntent` variant cannot slip through either path without a typecheck failure.

### Deterministic truncation via one shared `byId`

`byId`/`stableById` live only in `searchKeys.ts` and are the secondary comparator in both `rankByNameWords` and `rankByPhoneSuffix` (via `score(a) - score(b) || byId(a, b)`), applied to the exact groups through `stableById(...)` before `uniqueById(...).slice(0, limit)`. UUID order is meaningless to a human but fixed between runs, which is the requirement. The offline `name` branch appends `byId` after `localeCompare(..., 'vi')` so same-name records keep a stable order. The strongest regression guard is `search.test.ts:194`: the fake Medplum returns the same 25-person set in reversed order across two calls and the sliced results must be byte-identical.

### Offline `name+number` hasMore asymmetry (intentional, non-surfacing)

`searchLocal` computes `hasMore = found.length > limit` for `name+number`, where BFF counts the exact `_tag`-AND set. The code comment in `cache.ts` is explicit that this differs from BFF and that it never shows, because the UI gate (`!search.local && search.kind !== 'name+number'`) suppresses the hint for both local results and the `name+number` kind. The cache is a few dozen records, so `> limit` is effectively unreachable offline. This is a documented, harmless asymmetry, not a gap.

### Test coverage

The deterministic layer is covered where it can be: `classifyQuery` case table including the glued/reordered/multi-fragment edges; `byId`/`stableById` and equal-score ranker ordering in the model tests; and the BFF unit tests driving a fake Medplum that branches on `_summary=count` to return a `Bundle.total`. The `hasMore` unit cases cover exact-count over/under limit, the prefix-vs-exact distinction (`search.test.ts:140`), the legacy un-keyed overflow (`:152`), and `name+number` counting on the exact set (`:186`). `cache.test.ts` pins the small-cache `hasMore === false`.

Not tested at the unit level (by design, deferred to the integration step): that Medplum actually fills `Bundle.total` accurately for `_summary=count` on `_tag`-AND / `phone:contains` / `_tag`-AND-plus-suffix. If any shape under-reports, the design's `_count = limit + 1` fallback applies; for the `name` branch that fallback is in effect already shipped via the `|| byPrefix.length > limit` term. The verification notes record that the prerequisite integration cases were authored and type-checked but not run here, which is correct for this step.

### Verification evidence

`verification.md` records `pnpm -r typecheck` (8 projects, exit 0) and `pnpm -r test` (all packages pass, BFF 128 unit tests, clinic-web 212), with the integration suite correctly deferred. The signature change on `searchPatients` and the `api.search`/`Search` type changes make typecheck the safety net for every call site, and the never-guards make a missing arm an explicit typecheck failure. The evidence is specific and consistent with the code read here; no re-run was warranted.

</details>

<details>
<summary>File map</summary>

- `packages/fhir-vn-model/src/search.ts` — `name+number` variant; name/number split in `classifyQuery`.
- `packages/fhir-vn-model/src/searchKeys.ts` — `byId`/`stableById`; `byId` secondary key in `rankByNameWords`.
- `packages/fhir-vn-model/src/patient.ts` — `byId` secondary key in `rankByPhoneSuffix`.
- `packages/fhir-vn-model/test/model.test.ts` — `classifyQuery` table, `byId`/`stableById`, ranker ordering.
- `services/bff/src/store.ts` — `PatientSearchResult` interface; `searchPatients` returns it.
- `services/bff/src/medplum.ts` — `count()` helper; `hasMore` per branch; `name+number`; `stableById` on exact groups; `never` guard.
- `services/bff/src/app.ts` — route passes `hasMore` through; logging unchanged.
- `services/bff/test/unit/search.test.ts`, `test/unit/helpers.ts` — fake Medplum `_summary=count`; hasMore / name+number / deterministic-order cases.
- `services/bff/test/integration/bff.test.ts` — prerequisite count accuracy + end-to-end (authored, not run here).
- `apps/clinic-web/src/api.ts` — `api.search` return type adds `hasMore`.
- `apps/clinic-web/src/format.ts` — `name+number` label.
- `apps/clinic-web/src/local/cache.ts` — `searchLocal` returns `{ results, hasMore }`; `name+number` arm + `never` guard; `byId` on offline name sort.
- `apps/clinic-web/src/local/client.ts` — `searchCache` returns `hasMore`.
- `apps/clinic-web/src/components/Reception.tsx` — `Search` type adds `hasMore` + `kind`; both `setSearch` set them; `showMoreHint` gate; `MORE_HINT` render; `startNew` prefill.
- `apps/clinic-web/src/local/cache.test.ts` — small-cache `hasMore` false.

Full diff: `git -C .worktrees/p2-search-correctness diff main...p2-search-correctness`.

</details>
