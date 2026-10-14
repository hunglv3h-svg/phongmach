# Verification — P2 cải thiện tính đúng khi tìm bệnh nhân

Branch: `p2-search-correctness` (worktree `.worktrees/p2-search-correctness`).
First implementation iteration (no `review.json` present).

## Commands run (from worktree root)

### `pnpm typecheck`
`pnpm -r typecheck` — **PASS** for all 8 workspace projects:
packages/fhir-vn-model, packages/catalogs, packages/rules, packages/clinical,
packages/trial, packages/print, services/bff, apps/clinic-web. Exit code 0.

(services/bff `tsconfig.json` includes `src`, `scripts`, and `test`, so the
integration test `test/integration/bff.test.ts` is type-checked as part of this
step even though it is not executed here.)

### `pnpm test`
`pnpm -r test` — **PASS**. Per-package Vitest results:

| Package | Test files | Tests |
|---|---|---|
| packages/fhir-vn-model | 1 passed | 54 passed |
| packages/catalogs | 1 passed | (passed) |
| packages/rules | 1 passed | (passed) |
| packages/clinical | 2 passed | 83 passed |
| packages/print | 1 passed | 4 passed |
| packages/trial | 1 passed | 13 passed |
| apps/clinic-web | 14 passed | 212 passed |
| services/bff | 10 passed | 128 passed (runs `test/unit`, excludes integration) |

Exit code 0. No failing test files.

## Integration suite — NOT run in this step

Per the step instructions, `pnpm --filter @phongmach/bff test:integration` was
**not** run here (a dedicated integration step follows; it requires a running
Medplum stack). New integration cases were authored and type-checked:

- Prerequisite `_summary=count` accuracy for the three real query shapes
  (`_tag` AND name-word keys; `phone:contains`; `_tag` AND name+suffix), each
  asserting `Bundle.total === 25` on a seeded known population.
- `hasMore` end-to-end (name query matching >20 → true; a unique family → false).
- Legacy un-keyed hint (Decision 1): 22 records written directly without
  `meta.tag` surface only via the prefix arm; `hasMore === true` even though the
  exact `_tag` count is 0.
- `name+number` semantics on real Medplum (AND of name + phone-suffix).

If any count shape under-reports when the integration step runs, the design's
deterministic fallback (`_count = limit + 1` on the exact query) applies to that
branch; all three are expected to report accurately.

## Deterministic ordering coverage (non-integration, as required)

Medplum does not sort and truncates at `_count`, so ordering cannot be asserted
in integration. The tie-break is covered by unit tests:

- `services/bff/test/unit/search.test.ts` — "thứ tự tất định giữa hai lần chạy":
  the fake Medplum returns the same set in a different order across two calls and
  the sliced `results` are identical (catches removal of `stableById`/`byId`).
- `packages/fhir-vn-model/test/model.test.ts` — `byId`/`stableById` and the
  equal-score ranker ordering (name words and phone suffix) by id.

## What was implemented (maps to the three requirements)

1. `hasMore` boolean on `GET /api/patients/search`, threaded through the BFF
   route, `PatientSearchResult` (store.ts/medplum.ts), `api.search`, the
   clinic-web `Search` state + both `setSearch` calls, and the exact Vietnamese
   hint rendered in `#search-status` (suppressed for `local` results and the
   `name+number` kind). `name` branch `hasMore = totalExact > limit ||
   byPrefix.length > limit` (Decision 1); exact count via `_summary=count` +
   deterministic `_count = limit + 1` fetches.
2. `name+number` variant in `classifyQuery` (4-digit = phone suffix, not birth
   year); honored in `searchPatients` (BFF, `_tag` AND of name-word keys AND
   phone-suffix key) and `searchLocal` (offline); both switches have a `never`
   guard default.
3. Shared `byId`/`stableById` in `searchKeys.ts`, used as the secondary
   comparator in `rankByNameWords` and `rankByPhoneSuffix`, and applied to the
   exact groups before `slice(0, limit)` in the BFF; `searchLocal` applies the
   same ranking offline (incl. `name+number`).
