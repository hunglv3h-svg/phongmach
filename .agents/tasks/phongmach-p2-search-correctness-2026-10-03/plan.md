# Implementation Plan — P2 cải thiện tính đúng khi tìm bệnh nhân

Worktree (all paths below are absolute under it):
`d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\p2-search-correctness`

Branch `p2-search-correctness` (off `main`). Git ops use
`git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\p2-search-correctness"`.

This plan implements the three requirements from the approved design
(`.agents/tasks/phongmach-p2-search-correctness-2026-10-03\design.md`) plus the three
orchestrator decisions. It is one cohesive change to the shared search path, ordered so
each step leaves the tree type-checkable (the signature changes in steps 3–4 are what the
type-checker uses to find every caller to update in later steps).

Design-vs-brief precedence: where they differ, the brief wins. The three orchestrator
decisions are folded in at steps 4 (decision 1), 10 (decision 2), and 7 (decision 3).

## Ordering note on verification
Deterministic ordering (requirement 1's "thứ tự 20 người cố định" and requirement 3) must
be covered by **non-integration unit tests**: Medplum does not sort and truncates at
`_count`, so the truncated set is not stable across runs and integration tests cannot
assert a fixed order. The ordering guarantees live in the fake-Medplum BFF unit test
(`services/bff/test/unit/search.test.ts`) and the model unit test
(`packages/fhir-vn-model/test/model.test.ts`). Integration tests cover only Medplum
semantics (`_tag` AND/OR, `Bundle.total` accuracy) and end-to-end wiring.

---

## Model layer (`@phongmach/fhir-vn-model`) — shared classification + ranking

- [ ] 1. Add the deterministic id tie-break and thread it into `rankByNameWords`.
      In `packages/fhir-vn-model/src/searchKeys.ts` add two exported functions:
      `byId(a: { id: string }, b: { id: string }): number` (ascending UUID compare,
      returns -1/0/1) and `stableById<T extends { id: string }>(items: T[]): T[]`
      (`[...items].sort(byId)`). Change `rankByNameWords`'s generic constraint to
      `<T extends { id: string; fullName: string }>` and make `byId` the secondary
      comparator: `.sort((a, b) => score(a) - score(b) || byId(a, b))`. There is no import
      cycle (`searchKeys.ts` imports only `identifiers.js`/`phone.js`/`text.js`).
      Files: `packages/fhir-vn-model/src/searchKeys.ts`
      Verify: `pnpm --filter @phongmach/fhir-vn-model typecheck` passes (model test is
      updated in step 2; expect it red until then).

- [ ] 2. Add the id tie-break to `rankByPhoneSuffix`.
      In `packages/fhir-vn-model/src/patient.ts` import `byId` from `./searchKeys.js`,
      change the generic constraint to `<T extends { id: string; phone?: string }>`, and
      make `byId` the secondary comparator:
      `.sort((a, b) => score(a.phone) - score(b.phone) || byId(a, b))`.
      Files: `packages/fhir-vn-model/src/patient.ts`
      Verify: `pnpm --filter @phongmach/fhir-vn-model typecheck` passes.

- [ ] 3. Add the `name+number` variant and rewrite `classifyQuery` to split name tokens
      from a numeric fragment (4 digits = phone suffix, not birth year).
      In `packages/fhir-vn-model/src/search.ts` add
      `| { kind: 'name+number'; tokens: string[]; digits: string }` to `SearchIntent`.
      Rewrite `classifyQuery`: keep the pure-number branch (`/^[\d\s.+\-()]+$/` →
      cccd/phone/phone-fragment/empty) unchanged; in the else branch split on whitespace,
      classify each part as a number fragment when `digitsOnly(part) === part`, join the
      non-number parts for `nameTokens`, and join number-only parts' digits via
      `digitsOnly` in order. Resolve per the design: no number fragment → `name` or
      `empty`; number(s) but no name tokens → re-run the pure-number logic on the joined
      digits (so `"345 678"` matches `"345678"`); both name tokens and digits with
      `digits.length < MIN_FRAGMENT` (3) → `name` (drop digits); both with
      `digits.length >= MIN_FRAGMENT` → `{ kind: 'name+number', tokens, digits }`. Reuse
      the existing `MIN_FRAGMENT = 3`.
      Files: `packages/fhir-vn-model/src/search.ts`
      Verify: `pnpm --filter @phongmach/fhir-vn-model typecheck` passes. `byId`,
      `stableById`, and the new variant are auto re-exported (`index.ts` uses `export *`);
      no edit to `packages/fhir-vn-model/src/index.ts` is needed — confirm by reading it.

---

## BFF store (`@phongmach/bff`) — authoritative search, ranking, hasMore

- [ ] 4. Change `searchPatients` to return `PatientSearchResult` and compute `hasMore`,
      add the `name+number` branch, a `count()` helper, deterministic ordering, and a
      `never`-guard default.
      In `services/bff/src/store.ts` add
      `export interface PatientSearchResult { results: PatientSummary[]; hasMore: boolean }`
      and change the `ClinicStore.searchPatients` signature to
      `Promise<PatientSearchResult>`. In `services/bff/src/medplum.ts`:
      - Import `stableById`, `byId`, and `digitsOnly` from `@phongmach/fhir-vn-model`, and
        the `PatientSearchResult` type from `./store.js`.
      - Add a private `count(query)` that sets `_summary=count`, calls
        `this.medplum.search('Patient', params)`, and returns `bundle.total ?? 0`
        (uses `this.medplum.search`, NOT `searchResources`, to read `Bundle.total`).
      - Rewrite each `switch (intent.kind)` arm to return `{ results, hasMore }`:
        - `empty`: `{ results: [], hasMore: false }` (no Medplum call).
        - `cccd` / `phone`: fetch with `_count = limit + 1`; `hasMore` via
          `(await this.count(...)) > limit` (consistent typing; near-always false).
        - `name`: fetch `exact` (`_tag` AND `nameWordTag` per token) and `prefix`
          (`name` per token), both with `_count = limit + 1`, plus `count(exact)` in the
          same `Promise.all`. Build
          `uniqueById([...stableById(byWords), ...rankByNameWords(byPrefix, intent.tokens)])`,
          slice to `limit`. **Decision 1 (MEDIUM finding 1):** set
          `hasMore = totalExact > limit || byPrefix.length > limit` where `totalExact` is
          the `count(exact)` result and `byPrefix` is the already-fetched prefix arm — no
          extra query; this keeps the hint from silently hiding on un-backfilled legacy
          (un-keyed) records that surface only via the prefix arm.
        - `phone-fragment`: keep `SUFFIX_FETCH`/`FRAGMENT_FETCH`; add
          `count({ 'phone:contains': intent.digits })` to the `Promise.all`;
          `stableById` the `endsWith`-filtered suffix group;
          `hasMore = total > limit`.
        - `name+number` (new): per the design snippet — `exact` = `_tag` AND each
          `nameWordTag(token)` AND `phoneSuffixTagQuery(digits)` with `_count = limit + 1`;
          `prefix` = `name` per token with `_count = limit + 1`; `Promise.all` of
          `search(exact)`, `search(prefix)`, `count(exact)`; filter both arms by
          `digitsOnly(p.phone ?? '').endsWith(digits)`, `stableById` each, `uniqueById`,
          slice; `hasMore = totalExact > limit`. (Decision 1(b)'s prefix-OR is specified
          for the `name` branch; `name+number` counts the exact-keyed population only, and
          its hint is suppressed in the UI anyway — see step 7.)
        - `default`: `{ const _never: never = intent; return _never; }`.
      Files: `services/bff/src/store.ts`, `services/bff/src/medplum.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` passes (route + unit test are
      updated in steps 5 and 9; expect those red until then).

- [ ] 5. Thread `hasMore` through the search route without changing the audit log.
      In `services/bff/src/app.ts` `/api/patients/search`: destructure
      `const { results, hasMore } = await store.searchPatients(intent, limit);`, keep
      `record(req, 'search', { queryKind: intent.kind, resultCount: results.length, resourceIds: results.map((r) => r.id) })`
      unchanged, and return `{ intent: intent.kind, results, hasMore }`.
      Files: `services/bff/src/app.ts`
      Verify: `pnpm --filter @phongmach/bff typecheck` passes.

---

## clinic-web (`@phongmach/clinic-web`) — API type, offline, UI hint

- [ ] 6. Add `hasMore` to the `api.search` response type and the `name+number` intent
      label.
      In `apps/clinic-web/src/api.ts` change the `search` generic to
      `request<{ intent: string; results: PatientSummary[]; hasMore: boolean }>(...)`.
      In `apps/clinic-web/src/format.ts` add `'name+number': 'tên và số'` to
      `INTENT_LABEL` (so `hint()`'s `default` renders "Đang tìm theo tên và số").
      Files: `apps/clinic-web/src/api.ts`, `apps/clinic-web/src/format.ts`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` (expect red until steps
      7–8; the signature changes drive the remaining edits).

- [ ] 7. Change `searchLocal` to return `{ results, hasMore }`, add the `name+number`
      arm and a `never`-guard default, and tie-break the offline `name` arm.
      In `apps/clinic-web/src/local/cache.ts`:
      - Import `byId` from `@phongmach/fhir-vn-model` (`digitsOnly`, `foldName`,
        `rankByPhoneSuffix` already imported).
      - Change `searchLocal`'s return type to
        `{ results: PatientSummary[]; hasMore: boolean }`; compute
        `hasMore = found.length > limit` **before** `slice(0, limit)` and return
        `{ results: found.slice(0, limit), hasMore }`.
      - `name` arm: append `|| byId(a, b)` to the `localeCompare(..., 'vi')` sort.
      - Add `case 'name+number'`: filter entries where every token prefix-matches a
        folded name word AND `digitsOnly(e.patient.phone ?? '').endsWith(intent.digits)`,
        map to `e.patient`, `found = rankByPhoneSuffix(matched, intent.digits)`.
        **Decision 3 (NIT finding 3):** add a one-line comment here noting that offline
        `name+number` `hasMore` is prefix-based (not exact like the BFF) and is never
        displayed (the UI guard suppresses the hint for both `local` results and the
        `name+number` kind), so the online/offline divergence is intentional and inert.
      - Add `default: { const _never: never = intent; return _never; }`.
      Files: `apps/clinic-web/src/local/cache.ts`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` (cache.test.ts updated in
      step 11; may still be red until then).

- [ ] 8. Thread offline `hasMore` through `searchCache`.
      In `apps/clinic-web/src/local/client.ts` change `searchCache`'s return type to
      `{ results: PatientSummary[]; total: number; hasMore: boolean }`, destructure
      `const { results, hasMore } = searchLocal(query, entries);` and return
      `{ results, total: entries.length, hasMore }`.
      Files: `apps/clinic-web/src/local/client.ts`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes (together with step
      9 Reception edits).

- [ ] 9. Render the Vietnamese "more results" hint in Reception, suppressing it offline
      and for `name+number`, and prefill `name+number` keeping diacritics.
      In `apps/clinic-web/src/components/Reception.tsx`:
      - Import the `SearchIntent` type and `digitsOnly` from `@phongmach/fhir-vn-model`
        (alongside `classifyQuery`, `PatientSummary`).
      - Extend the `Search` type with `hasMore?: boolean` and
        `kind?: SearchIntent['kind']`.
      - Online `setSearch`: add `hasMore: r.hasMore, kind: r.intent as SearchIntent['kind']`.
      - Offline `setSearch` (the `searchLocal` closure): add
        `hasMore: r.hasMore, kind: classifyQuery(query).kind` (this is the single
        classification used for the hint offline).
      - Add `const MORE_HINT = 'còn người trùng tên, gõ thêm năm sinh hoặc 4 số cuối';`
        and `const showMoreHint = fresh && search.hasMore === true && !search.local && search.kind !== 'name+number';`
        (read from state, do NOT re-call `classifyQuery`).
      - In the `#search-status` region, when `showMoreHint`, append
        ` · ${MORE_HINT}` after the "N kết quả" line (lowercase, no exclamation, matching
        the existing tone). Keep the `local` status line and the `hintText` chip as-is.
      - `startNew()`: add a `name+number` branch to `initial` that prefills
        `fullName` from the query with number-only parts removed, diacritics preserved:
        `const nameOnly = (s: string) => s.trim().split(/\s+/).filter((p) => digitsOnly(p) !== p).join(' ');`
        then `intent.kind === 'name+number' ? { fullName: nameOnly(query) } : ...`.
      Files: `apps/clinic-web/src/components/Reception.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes.

---

## Tests

- [ ] 10. Update model tests: pin `id`s for the rankers, fix the "missing word"
      expectation, and add the `classifyQuery` `name+number` case table plus
      `byId`/`stableById` cases.
      In `packages/fhir-vn-model/test/model.test.ts`:
      - `rankByPhoneSuffix` test: give each object an `id`
        (`{ id: 'z', phone: '0956781234' }`, `{ id: 'a', phone: '0912345678' }`,
        `{ id: 'b', phone: '0907785678' }`); expected order
        `['0912345678','0907785678','0956781234']` (score-0 group a,b by id; then z).
      - `rankByNameWords`: give the four people ids `a..d`
        (`a` Bùi Văn An, `b` Bùi Thị Ân, `c` Bùi Thị Anh, `d` Bùi Ánh Tuyết); keep the
        `['bui','an']` expectation; change the "missing word" (`['bui','van','anh']`)
        expectation to the id-ascending order (all score 1 → `a,b,c,d` names in that id
        order), replacing the `people.map(...)` expectation.
      - Add a `classifyQuery` case table pinning: `"an 5678"` →
        `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`;
        `"nguyen van an 1985"` → `{ kind: 'name+number', tokens: ['nguyen','van','an'], digits: '1985' }`;
        `"an 12"` → `{ kind: 'name', tokens: ['an'] }`; `"an 56 78"` →
        `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`; `"an5678"` →
        `{ kind: 'name', tokens: ['an5678'] }`; `"5678 an"` →
        `{ kind: 'name+number', tokens: ['an'], digits: '5678' }`; and confirm unchanged
        `"5678"`, `"0912 345 678"` cases still hold.
      - Add a `byId`/`stableById` test: shuffled input sorts to ascending id; and
        equal-score ranker input orders within-group by id.
      Files: `packages/fhir-vn-model/test/model.test.ts`
      Verify: `pnpm --filter @phongmach/fhir-vn-model test` — all model unit tests pass.

- [ ] 11. Update `cache.test.ts` for the `searchLocal` return-type change and add
      `name+number` coverage.
      In `apps/clinic-web/src/local/cache.test.ts`: **Decision 2 (NIT finding 2):**
      change the `names` helper (around line 14) from `searchLocal(q, CACHE).map(...)` to
      `searchLocal(q, CACHE).results.map(...)`; fix any other caller the type-checker
      flags the same way. Add a `name+number` case: a query like `"nguyen van an 5678"`
      returns the entry whose phone ends in `5678` (AND of name prefix + phone suffix),
      ranked by `rankByPhoneSuffix`. Optionally assert `searchLocal(...).hasMore === false`
      for the small `CACHE`.
      Files: `apps/clinic-web/src/local/cache.test.ts`
      Verify: `pnpm --filter @phongmach/clinic-web test` — all clinic-web unit tests pass.

- [ ] 12. Extend the BFF fake-Medplum unit test: add a `search` mock returning a
      `Bundle` with `.total` for `_summary=count`, cover `hasMore` and `name+number`, and
      pin deterministic ordering.
      In `services/bff/test/unit/search.test.ts` add a `search` method to the fake
      `medplum` that, when `params.get('_summary') === 'count'`, returns a `Bundle` with
      `.total` driven by the test (branch on `_tag`/`name`/`phone:contains` like
      `searchResources`); otherwise keep returning the soạn-sẵn arms. Update `storeWith`
      so each `name`/`name+number`/`phone-fragment` call also supplies a count. Add cases:
      - `name` hasMore: exact-keyed population 21 → `hasMore === true`; exactly 20 →
        `false`; 19 → `false`.
      - Decision 1 (finding 1): exact `_tag` AND count = 12 but `byPrefix.length` = 21 →
        `hasMore === true` (prefix overflow on legacy data must not hide the hint).
      - `name+number`: AND of name-word keys + phone-suffix key; a long (>4) fragment is
        re-filtered by `endsWith`; an un-keyed record surfaces via prefix and is kept when
        the suffix matches; dedupe; `hasMore` from the count query.
      - Deterministic ordering: the fake returns the same set in a different order across
        two calls → `results` are identical (shuffled-array assertion), catching removal
        of the `stableById`/`byId` tie-break.
      Files: `services/bff/test/unit/search.test.ts`
      Verify: `pnpm --filter @phongmach/bff test` — all BFF unit tests pass.

- [ ] 13. Add the integration prerequisite + `hasMore` + `name+number` coverage
      (requires a running stack; ordering is NOT asserted here).
      In `services/bff/test/integration/bff.test.ts`:
      - **Prerequisite (blocking) `_summary=count` accuracy:** seed a known population
        (e.g. ~25 patients sharing one `nameWord`, and ~25 sharing one 4-digit phone
        suffix) via the BFF create path, then call `tenantA`'s client `search('Patient', ...)`
        with `_summary=count` for each real query shape used — `_tag` AND name-word keys,
        `phone:contains`, and `_tag` AND name+suffix — and assert `Bundle.total === 25`.
        If any shape under-reports, the implementer switches that branch to the
        deterministic `_count = limit + 1` fallback (design "phương án lùi"); note which
        branch used which in a code comment in `medplum.ts`.
      - **hasMore end-to-end:** a name query matching >20 seeded people returns
        `hasMore === true`; a ≤20 query returns `false`. Extend the inline `search`
        response type to include `hasMore: boolean`.
      - **Legacy un-keyed hint (decision 1):** reusing the existing "hồ sơ tạo trước khi
        có khóa tìm" pattern (`legacy(...)` writes directly, no `meta.tag`), seed >20
        un-keyed records sharing a family so they surface only via the prefix arm, and
        assert `hasMore === true` even though the exact `_tag` count is 0.
      - **name+number semantics:** `"<family> van an <real 4-digit suffix>"` returns the
        matching person; AND of name + phone-suffix behaves as designed.
      Files: `services/bff/test/integration/bff.test.ts`
      Verify: `pnpm --filter @phongmach/bff test:integration` (stack running) — new
      integration cases pass; the prerequisite count assertions are green before relying
      on `hasMore`.

---

## Final verification (run from the worktree root)

- [ ] 14. Full gate.
      Verify: `pnpm typecheck && pnpm test` both pass, and
      `pnpm --filter @phongmach/bff test:integration` passes with a running stack
      (`pnpm stack:up` first if needed). Commit locally on `p2-search-correctness`; do not
      push.

## Boundaries honored
- Search & ranking stay authoritative in the BFF (`searchPatients` decides order, dedupe,
  truncation, and `hasMore` from its own count query); clients only display.
- Classification, ranking, and the single `byId`/`stableById` tie-break live in
  `@phongmach/fhir-vn-model`; BFF and offline import them, no duplicated logic.
- 4-digit numbers are interpreted as phone suffix (not birth year), per the approved
  design — no new birth-year search key.
- No unrelated refactors; only the files listed above are touched.
