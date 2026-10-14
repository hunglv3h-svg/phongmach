# Implementation Plan — UI demo-blockers (PHONGMACH clinic-web)

All paths below are relative to the worktree root:
`d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ui-demo-blockers`
(branch `feat/ui-demo-blockers`, based on `origin/main` HEAD `52c0054`). Do NOT touch the main repo.

## Scope & decisions (grounded in the code I read)

Two demo-blocker UI safety measures plus mutation-tested coverage, confined to `apps/clinic-web`:

1. **Confirmation dialog before cancelling a queue visit** (`Queue.tsx`).
2. **Global React error boundary** (`main.tsx` + new `ErrorBoundary.tsx`).

Key findings that drove the decisions:

- **Dialog pattern to mirror** lives in `apps/clinic-web/src/components/Shell.tsx` (the "còn N mục chưa đồng bộ" logout dialog): a `.dialog-backdrop` wrapping a `<section className="card dialog" role="alertdialog" aria-labelledby="logout-title" data-testid="logout-dialog">` with a title `<h2 id="logout-title">`, a body `<p>`, and an `.actions` div holding two buttons. Styles `.dialog-backdrop` and `.dialog` already exist in `src/styles.css` (lines ~287-288). The existing dialog does **no** JS focus trapping — it relies on `role="alertdialog"` + `aria-labelledby`. So "mirror focus handling" = replicate that same markup; I additionally add `autoFocus` on the dismiss (safe-default) button, which is a faithful, non-divergent enhancement.
- **Cancel action today** (`Queue.tsx`, the `data-testid="cancel"` button): `onClick={() => void act(i.id, async () => void (await api.cancelVisit(token, i.id)))}`. `act(id, fn)` sets `busy`, runs `fn`, reloads the queue, and clears `busy` in `finally`. The button is already disabled when `busy === i.id`, offline, or the row is `tentative`. We must preserve all of that and only interpose a confirm step before the `api.cancelVisit` call.
- **Test tooling for Task 2.** Evidence: `apps/clinic-web` has 12 unit/component tests under `src/**` run by vitest's default (node) environment. Every component test (`src/components/sync.test.tsx`, `src/visit/zalo.test.tsx`) uses `renderToStaticMarkup` from `react-dom/server` — static SSR string output, asserting on HTML text. There is **no jsdom / happy-dom, no `@testing-library`, no client-render harness** anywhere (`vite.config.ts` has no `test` block; there is no `vitest.config.ts` in clinic-web; `grep` for jsdom/testing-library returns nothing; `fake-indexeddb/auto` is used only by store tests). React error boundaries only fire `componentDidCatch`/`getDerivedStateFromError` during **client-side render/commit** via the reconciler; `renderToStaticMarkup` throws the error straight to the caller and never invokes the boundary — so an SSR test can confirm the fallback *markup* but cannot prove the *catch* path. **Decision (see item 6): prefer a vitest component test that uses a per-file `// @vitest-environment jsdom` docblock + `react-dom/client` `createRoot` to render a child that throws, exercising the real catch path, without disturbing the other node-env tests. Fall back to an SSR fallback-markup test paired with an e2e catch-path check only if jsdom cannot be added cleanly.** The task's "inspect what exists, then choose" instruction is satisfied: the choice is grounded in the absence of any client-render harness.
- **`eventually` helper** is defined and exported in `apps/clinic-web/e2e/offline-helpers.mjs` (polls `check()` every 250ms up to a timeout; wraps `page.evaluate(async …)` to avoid the `page.waitForFunction(async)` trap documented there). `visit.mjs` does **not** currently import it. For the Task-1 negative assertion we read queue state through `visit.mjs`'s existing `api('GET', '/api/queue')` helper (synchronous assert, no polling needed because the UI click is deterministic) and use Playwright locator `.waitFor()` for the positive dialog-open/cancel waits. We will NOT add `page.waitForFunction` with an async fn.

### Why no workflow restructuring / FEAT decomposition

Both measures are small, live entirely in `apps/clinic-web`, share one build and one test invocation, and together form a single coherent unit of work. There is no dependency ordering worth separating and no independent verification boundary. This does not decompose into separable features, so the plan stays a single file and the existing implement/review loop runs it. The loop's gate file remains `d:\My Documents D\UNIGIS\PM\phongmach\.agents\tasks\ui-demo-blockers-2026-10-13\review.json` (jsonPath `verdict`, stop value `APPROVED`).

## Boundaries (do not cross)

No changes to: idempotent `clientUuid` logic, completion bundle (`buildCompletionBundle`/`completeVisit`), offline print barrier (`whileLocalStoreQuiet`/`printHtml`; never call `window.print()` directly), BFF-is-only-Medplum-caller, tenant-from-signed-JWT. Web app must keep **zero** `@medplum/*` imports and only call `/api` + import *types* from shared packages. Do not alter simulation-label behavior or the Scope/DemoBanner e2e assertions. `api.cancelVisit`'s contract is unchanged.

---

## Items

- [ ] 1. Add the `ErrorBoundary` class component.
      Create a React class component with `state = { hasError: false }`, a static `getDerivedStateFromError()` returning `{ hasError: true }`, and `componentDidCatch(error, info)` that calls `console.error('ErrorBoundary caught', error, info)` (do NOT swallow). `render()` returns the children when `!hasError`; on error it returns a friendly Vietnamese fallback: a `.page` container holding a `.card` with `data-testid="error-boundary-fallback"`, a heading with the exact text `Đã xảy ra lỗi hiển thị`, a short explanatory paragraph, and a primary button `Tải lại trang` whose `onClick` calls `window.location.reload()`. Props type is `{ children: ReactNode }`. Reuse existing `.page`/`.card`/`.primary` classes from `src/styles.css` (no new CSS needed).
      Files: `apps/clinic-web/src/components/ErrorBoundary.tsx` (new)
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes (file compiles, no new TS errors).

- [ ] 2. Wrap the app in the error boundary, inside `<StrictMode>`.
      In `apps/clinic-web/src/main.tsx`, import `ErrorBoundary` and change the render tree to `<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>`. Keep the boundary INSIDE `<StrictMode>` so dev behavior is otherwise unchanged. Do not reorder or remove the existing font/style imports.
      Files: `apps/clinic-web/src/main.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes; `pnpm --filter @phongmach/clinic-web build` succeeds.

- [ ] 3. Add per-row cancel-confirmation state and dialog to `Queue.tsx`.
      In `apps/clinic-web/src/components/Queue.tsx`, add component state `const [pendingCancel, setPendingCancel] = useState<LocalQueueItem>()` to track which row is awaiting confirmation (store the whole item so the dialog can name the patient and number; a bare id would require a lookup). Change the `data-testid="cancel"` button's `onClick` from calling `act(...)` directly to `onClick={() => setPendingCancel(i)}` (keep its existing `disabled`/`title` logic unchanged — offline/tentative/busy still gate opening the dialog). Render a confirmation dialog (only when `pendingCancel` is set) that mirrors the Shell logout dialog structure: a `.dialog-backdrop` wrapping `<section className="card dialog" role="alertdialog" aria-labelledby="cancel-visit-title" data-testid="cancel-visit-dialog">`, with `<h2 id="cancel-visit-title">Hủy lượt khám?</h2>`, a body paragraph naming patient + number, e.g. `Hủy lượt của {pendingCancel.patientName} số {pad3(pendingCancel.number)}?`, and an `.actions` div with two buttons:
      - dismiss: `data-testid="cancel-visit-dismiss"`, className `secondary`, `autoFocus`, `onClick={() => setPendingCancel(undefined)}` (safe default = do nothing);
      - confirm: `data-testid="cancel-visit-confirm"`, className `ghost` (destructive), `onClick` that captures the id, closes the dialog (`setPendingCancel(undefined)`), then runs the EXISTING cancel via the `act` helper: `void act(id, async () => void (await api.cancelVisit(token, id)))`. This preserves busy-locking and queue reload exactly as today.
      The dialog must only ever reference `pendingCancel` (the specific row), so it opens for exactly one visit. Do not change `cancelVisit` or any API/BFF logic.
      Files: `apps/clinic-web/src/components/Queue.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes; `pnpm --filter @phongmach/clinic-web build` succeeds.

- [ ] 4. Run the full clinic-web verification baseline before touching e2e.
      Confirm the two code changes build and all existing unit tests still pass (the existing `sync.test.tsx`/`zalo.test.tsx` SSR tests must be unaffected).
      Files: none
      Verify: `pnpm --filter @phongmach/clinic-web typecheck && pnpm --filter @phongmach/clinic-web test && pnpm --filter @phongmach/clinic-web build` — all green.

- [ ] 5. Add the Task-1 e2e assertions to `apps/clinic-web/e2e/visit.mjs`.
      Insertion point: in the reception section, AFTER the existing step `ok('hàng chờ: số ... phụ tá không có nút gọi vào khám')` (where two patients have been checked in and the queue is visible for the assistant) and BEFORE the `await page.getByTestId('tab-display').click()` / display-board step. The assistant role already has access to the `cancel` button (cancel is not clinical-gated). Add a new verified step that:
      1. Reads the baseline waiting set via the existing `api('GET', '/api/queue')` helper and records the id + number of the Nguyễn Văn An waiting row (`anNumber` from `checkIn`).
      2. Locates that queue row (`page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' })`), clicks its `cancel` button, and asserts the dialog appears: `await page.getByTestId('cancel-visit-dialog').waitFor()` and that it names the patient/number (`assert.match(await page.getByTestId('cancel-visit-dialog').innerText(), /Nguyễn Văn An/)`).
      3. Asserts cancelling has NOT happened yet: after dismissing is NOT what we test first — instead, with the dialog open, re-query `api('GET', '/api/queue')` and assert the An visit is still `waiting` (not `cancelled`). This proves the click alone does not cancel. (Use a direct `assert`, not `page.waitForFunction`; the state is deterministic once the dialog is shown.)
      4. Clicks `cancel-visit-dismiss`, asserts the dialog closes (`await page.getByTestId('cancel-visit-dialog').waitFor({ state: 'detached' })`) and the visit is still `waiting` via the API.
      5. Re-opens the dialog (click `cancel`), clicks `cancel-visit-confirm`, waits for the dialog to detach, then asserts the visit becomes `cancelled` — poll with the existing `api` helper inside an `eventually`-style loop. Since `visit.mjs` does not import `eventually`, EITHER import it (`import { eventually } from './offline-helpers.mjs'`) and use `await eventually(async () => (await api('GET','/api/queue')).json.items.find(x => x.id === anId)?.status === 'cancelled', 'lượt An chuyển sang đã hủy')`, OR wait on the UI with Playwright: `await page.getByTestId('queue-row').filter({ hasText: 'Nguyễn Văn An' }).filter({ hasText: 'Đã hủy' }).first().waitFor()`. Prefer the Playwright locator wait (no new import; matches the file's style) and keep one API assert for certainty. Do NOT use `page.waitForFunction` with an async fn.
      6. Add a `shot(...)` + `ok('hủy lượt: bấm "Hủy" mở hộp thoại xác nhận và CHƯA hủy; xác nhận mới thực sự hủy')` line, incrementing the step counter via the existing `ok` helper.
      Note the knock-on effect: because An is cancelled mid-flow, the later doctor section calls `callPatient('Nguyễn Văn An')` — An must still be re-checkable-in. Confirm the subsequent flow: the doctor section re-opens An via the queue `call` button, but An is now `cancelled`, not `waiting`. To avoid breaking the downstream flow, cancel a DISPOSABLE check-in instead: in step 1, do a dedicated extra `checkIn` for a throwaway visit (e.g. re-open An and check in a second time, or check in Bình is NOT disposable). SAFER APPROACH: perform the whole cancel test on a NEW throwaway check-in created just for this test (reuse `openPatient('nguyen van an', …)` + `checkIn('Hủy thử')`), cancel THAT number, and leave the original An/Bình waiting rows intact for the downstream doctor flow. The implementer must verify the downstream `callPatient('Nguyễn Văn An')` still finds a waiting An after this block.
      Files: `apps/clinic-web/e2e/visit.mjs`
      Verify: with stack + seed + BFF (`DEMO_AUTH=1`) + web running, `pnpm --filter @phongmach/clinic-web e2e:visit` passes end-to-end including the new step and the unchanged downstream doctor/sign/scope steps. (Running the stack is required for e2e; if the environment cannot run it, state that and fall back to typecheck+build+unit as the committed evidence, noting e2e is "cần kiểm khi chạy".)

- [ ] 6. Add the Task-2 error-boundary test. **Chosen approach: a vitest component test that exercises the real catch path with jsdom — but ONLY if jsdom can be added without disrupting the existing node-env SSR tests; otherwise fall back to the documented split below.**
      The hard constraints: (1) the catch path only fires under a real client reconciler, which `renderToStaticMarkup` cannot provide; (2) we must not add production-only test triggers; (3) we must not break the 12 existing node-environment tests. Two viable, no-production-change options — the implementer picks exactly one and documents the choice and evidence:

      **Option A (preferred — true catch-path coverage via a per-file jsdom environment).** Add a single component test `apps/clinic-web/src/components/error-boundary.test.tsx` that, via a file-local `// @vitest-environment jsdom` docblock (so only this file runs under jsdom and the other tests keep their node env), uses `react-dom/client` `createRoot` to render `<ErrorBoundary><ThrowOnRender/></ErrorBoundary>` where `ThrowOnRender` is a tiny component defined in the test that throws during render. Assert the mounted DOM contains `data-testid="error-boundary-fallback"`, the heading `Đã xảy ra lỗi hiển thị`, and the reload button; spy on `console.error` and assert it was called (proving errors are not swallowed). This requires adding `jsdom` as a devDependency of clinic-web. Because `@vitest-environment` is per-file, no `vitest.config.ts` and no change to the other tests is needed. Verify the existing suite is unaffected.

      **Option B (fallback — SSR fallback-markup test + e2e catch path).** If adding jsdom is undesirable, add `apps/clinic-web/src/components/error-boundary.test.tsx` using `renderToStaticMarkup` to render the fallback branch directly (force `hasError`/render the fallback), asserting `data-testid="error-boundary-fallback"`, the Vietnamese heading, and the reload button are present. This proves the fallback UI but NOT the catch path. Pair it with a dedicated e2e `apps/clinic-web/e2e/error-boundary.mjs` + a test-only HTML/entry fixture under `e2e/` that mounts `<ErrorBoundary><ThrowOnRender/></ErrorBoundary>` with `createRoot`, loaded in Chromium, asserting the fallback appears and the reload button triggers `window.location.reload()`. The throwing child lives entirely in the e2e fixture, so production code is unchanged.

      Decision rule: prefer **Option A** — it gives real catch-path coverage in a fast unit test, is a smaller footprint than a new e2e script, and keeps the existing node-env tests untouched via the per-file docblock. Use Option B only if jsdom cannot be added cleanly. Either way the mutation test (item 8) must go RED when the boundary is removed.
      Files: `apps/clinic-web/src/components/error-boundary.test.tsx` (new) [Option A also adds `jsdom` to `apps/clinic-web/package.json` devDependencies; Option B also adds `apps/clinic-web/e2e/error-boundary.mjs` + fixture]
      Verify: `pnpm --filter @phongmach/clinic-web test` runs the new test and the full existing suite, all green. (Option B's e2e: `node apps/clinic-web/e2e/error-boundary.mjs` with web running shows the fallback.)

- [ ] 7. Mutation-test the cancel-confirmation measure (prove the e2e goes RED when the guard is removed).
      Temporarily revert the `cancel` button's `onClick` in `Queue.tsx` back to the direct form `onClick={() => void act(i.id, async () => void (await api.cancelVisit(token, i.id)))}` (i.e. remove the dialog interposition). Re-run `pnpm --filter @phongmach/clinic-web e2e:visit`. The new Task-1 step MUST fail — specifically the "dialog appears" / "still waiting after click" assertion goes RED because the click now cancels immediately. Restore the dialog code and confirm the suite goes green again. Record the RED output in the implementation summary.
      Files: `apps/clinic-web/src/components/Queue.tsx` (temporary revert, then restored)
      Verify: e2e RED with guard removed, GREEN with guard restored.

- [ ] 8. Mutation-test the error-boundary measure (prove the check goes RED when the boundary is removed).
      Temporarily remove the `<ErrorBoundary>` wrapper in `main.tsx` (option a) OR force `getDerivedStateFromError`/fallback to a no-op (option b), re-run the Task-2 check from item 6, and confirm it goes RED (fallback no longer appears / fallback markup absent). Restore and confirm GREEN. Record the RED output.
      Files: `apps/clinic-web/src/main.tsx` or `apps/clinic-web/src/components/ErrorBoundary.tsx` (temporary revert, then restored)
      Verify: check RED with boundary removed, GREEN with boundary restored.

- [ ] 9. Final verification, cleanup, and commit on the branch.
      Ensure no temp fixtures/dev-only triggers remain beyond the committed test fixtures; confirm the web app still has **zero** `@medplum/*` imports and no new non-type imports from shared packages (`grep` the diff). Run the full gate once more.
      Files: none (or minor cleanup)
      Verify: `pnpm --filter @phongmach/clinic-web typecheck && pnpm --filter @phongmach/clinic-web test && pnpm --filter @phongmach/clinic-web build` all pass; e2e steps pass (or are documented as "cần kiểm khi chạy" if the stack is unavailable). Then commit locally on `feat/ui-demo-blockers` (do NOT push).

## Mutation-test verification procedure (summary)

| Measure | Guard to temporarily remove | Test that must go RED |
|---|---|---|
| Task 1 — cancel confirmation | Restore `cancel` button `onClick` to call `act(... api.cancelVisit ...)` directly (bypass dialog) | New step in `e2e/visit.mjs`: "bấm Hủy mở hộp thoại và CHƯA hủy" assertion |
| Task 2 — error boundary | Remove `<ErrorBoundary>` wrapper in `main.tsx` (or neuter its fallback) | `error-boundary.mjs` fallback assertion (option a) or `error-boundary.test.tsx` fallback assertion (option b) |

## Open assumptions / "cần kiểm khi chạy"

- The downstream doctor flow in `visit.mjs` depends on An/Bình remaining `waiting`; item 5 mandates cancelling a throwaway check-in so the original rows survive. The implementer must run `e2e:visit` end-to-end to confirm no downstream step broke.
- Running any e2e requires the full stack (Medplum + BFF `DEMO_AUTH=1` + web) per project rules; if the environment cannot bring the stack up, the committed evidence is `typecheck` + `test` + `build` green plus the mutation-test code changes, and the e2e result is recorded as "cần kiểm khi chạy".
