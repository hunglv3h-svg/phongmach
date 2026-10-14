# Confirmation dialog before queue-visit cancel + global React error boundary

Two demo-blocker UI safety measures for the PHONGMACH clinic-web PWA, on branch `feat/ui-demo-blockers` (HEAD `73bd4d2`, based on `origin/main` `52c0054`). TASK 1 interposes an `alertdialog` confirmation before the destructive "Hủy" (cancel visit) action in the queue, naming the patient and number. TASK 2 adds a global `ErrorBoundary` wrapping `<App/>` so a render error on any screen shows a friendly Vietnamese fallback with a reload button instead of a white screen. Both measures carry mutation-tested coverage: an e2e dialog-gate step for TASK 1 and a jsdom component test exercising the real catch path for TASK 2.

Watch for: nothing blocking. The diff is confined to clinic-web UI + tests + the `jsdom` devDependency (confirmed); the final e2e cancellation assertion uses a Playwright locator `.waitFor()` plus a direct `api()` assert instead of the `eventually` helper, which the plan explicitly permitted and which satisfies the hard constraint of not using `page.waitForFunction` with an async fn (confirmed).

**Verdict**: APPROVED

## High-level view

The cancel confirmation mirrors the existing Shell.tsx logout dialog exactly — same `.dialog-backdrop` / `.card.dialog` markup, `role="alertdialog"`, `aria-labelledby`, and `.actions` two-button layout — so it inherits the established dialog styling and accessibility posture with no new CSS. The cancel button's `onClick` changed from calling `act(...)` directly to `setPendingCancel(i)`; the actual `api.cancelVisit` call still flows through the unchanged `act(...)` helper from the confirm button, so busy-locking and queue reload are preserved. The dialog references only `pendingCancel`, so it targets exactly one row. `cancelVisit`'s contract and all BFF/Medplum logic are untouched.

The error boundary is a minimal React class component with `getDerivedStateFromError`/`componentDidCatch`, placed inside `<StrictMode>` as specified. `componentDidCatch` logs `'ErrorBoundary caught'` to `console.error` rather than swallowing, and the fallback carries `data-testid="error-boundary-fallback"`, the exact heading `Đã xảy ra lỗi hiển thị`, and a reload button.

Mutation evidence in verification.md is concrete for both measures: TASK 1's e2e step was observed RED (dialog never appears, timeout) when the cancel button was reverted to cancel directly, and GREEN when restored; TASK 2's component test was observed RED (error escapes, no fallback, no console log) when `getDerivedStateFromError`/`componentDidCatch` were neutered, and GREEN when restored. The red/green evidence the acceptance criteria flag as most-important is present for each measure.

Boundaries hold: no `@medplum/*` import in the web app (grep clean per verification), the only new imports are a local component, a *type* import, and the test-only `jsdom` devDependency; completion bundle, clientUuid, print barrier, BFF-only-Medplum, tenant-from-JWT, and the Scope/DemoBanner e2e are untouched.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings.

</details>

<details>
<summary>Details</summary>

### TASK 1 — cancel confirmation dialog

The change in `Queue.tsx` is exactly the interposition the plan called for. State `const [pendingCancel, setPendingCancel] = useState<LocalQueueItem>()` holds the whole row so the dialog can name patient + number without a lookup. The `data-testid="cancel"` button keeps its full `disabled`/`title` gating (`busy === i.id || !online || !!local?.tentative`) and only its `onClick` changed to `setPendingCancel(i)` — opening the dialog is now gated by the same offline/tentative/busy conditions that previously gated the cancel itself (confirmed by reading the button line).

The dialog markup mirrors Shell.tsx's logout dialog faithfully: `<div className="dialog-backdrop">` wrapping `<section className="card dialog" role="alertdialog" aria-labelledby="cancel-visit-title" data-testid="cancel-visit-dialog">`, an `<h2 id="cancel-visit-title">`, a body `<p>` reading `Hủy lượt của {pendingCancel.patientName} số {pad3(pendingCancel.number)}?`, and an `.actions` div with the dismiss button (`secondary`, `autoFocus`, `data-testid="cancel-visit-dismiss"`) and the confirm button (`ghost`, `data-testid="cancel-visit-confirm"`). This matches the Shell pattern verified at Shell.tsx lines 82-86.

The confirm handler captures `const id = pendingCancel.id`, closes the dialog, then runs `void act(id, async () => void (await api.cancelVisit(token, id)))` — the exact call the cancel button ran before, through the same `act(...)` helper, so busy-locking and the post-cancel queue reload are preserved unchanged. Because every reference in the dialog is to `pendingCancel`, it can only ever target the one row that was clicked.

`pad3` and `LocalQueueItem` were already imported in Queue.tsx before this change (from `../format` and `../local/cache` respectively), so no new import was introduced for the dialog — consistent with the boundary that the web app adds no new non-type runtime imports from shared packages.

### TASK 2 — global error boundary

`ErrorBoundary.tsx` is a tight class component: `state = { hasError: false }`, `static getDerivedStateFromError()` returning `{ hasError: true }`, and `componentDidCatch(error, info)` calling `console.error('ErrorBoundary caught', error, info)` — it logs rather than swallowing, as required. The fallback renders a `.page`/`.card` using existing CSS classes, with `data-testid="error-boundary-fallback"`, the exact heading `Đã xảy ra lỗi hiển thị`, an explanatory paragraph, and a `primary` button `Tải lại trang` wired to `window.location.reload()`.

`main.tsx` wraps `<App/>` in `<ErrorBoundary>` while keeping it inside `<StrictMode>`, exactly as specified, and leaves the font/style imports in place.

### Tests and mutation proof

The TASK 1 e2e step (`visit.mjs`) cancels a throwaway "Hủy thử" check-in for Nguyễn Văn An so the original An/Bình waiting rows survive for the downstream doctor flow — the diff ends the block with an explicit assert that both An and Bình are still `waiting`. The step asserts: clicking "Hủy" opens `cancel-visit-dialog` naming the patient and number, and the visit is still `waiting` while the dialog is open (click alone does not cancel); dismiss closes the dialog with the visit still `waiting`; re-open + confirm detaches the dialog and the visit becomes `cancelled`. The waits use Playwright locator `.waitFor()` plus direct `api('GET','/api/queue')` asserts — no `page.waitForFunction` with an async fn, satisfying the documented Playwright trap avoidance. The plan explicitly preferred this locator-wait form over importing `eventually`, so this is a sanctioned choice, not a deviation.

The TASK 2 test (`error-boundary.test.tsx`) runs under a per-file `// @vitest-environment jsdom` docblock so only this file uses jsdom and the other node-env tests are unaffected. It renders `<ErrorBoundary><ThrowOnRender/></ErrorBoundary>` with a real `react-dom/client` root (the true reconciler catch path, which `renderToStaticMarkup` cannot reach), asserting the fallback testid/heading/reload-button are present, that `console.error` was called with `'ErrorBoundary caught'`, and that clicking reload invokes a spied `window.location.reload()`. A third case confirms children render normally when no error is thrown.

Mutation proof in verification.md is specific and credible for both: TASK 1 reverted to direct-cancel → e2e RED with a `getByTestId('cancel-visit-dialog') to be visible` timeout at the dialog step → restored → `Đạt 26/26`. TASK 2 neutered `getDerivedStateFromError` to `{ hasError: false }` and emptied `componentDidCatch` → the two catch-path tests RED (error escapes, no fallback, no log) while the render-normally test correctly stayed green → restored → `Tests 3 passed`, full suite `233 passed`. This meets the most-important acceptance criterion: red observed with the measure removed, green with it restored, for each measure.

### Boundaries

verification.md records `grep "@medplum"` across `apps/clinic-web/src/**` → no matches, and the diff stat confirms changes are confined to clinic-web (`e2e/visit.mjs`, `package.json`, `src/components/ErrorBoundary.tsx`, `src/components/Queue.tsx`, `src/components/error-boundary.test.tsx`, `src/main.tsx`) plus `pnpm-lock.yaml` for the `jsdom` devDependency. No touch to completion bundle, clientUuid idempotency, offline print barrier, BFF-only-Medplum, tenant-from-JWT, or the Scope/DemoBanner e2e assertions (step 24 noted still green). The only runtime import additions are the local `ErrorBoundary` in `main.tsx` and type-only `LocalQueueItem`; `jsdom` is a test-only devDependency.

</details>

<details>
<summary>File map</summary>

- `apps/clinic-web/src/components/ErrorBoundary.tsx` (new) — class error boundary with logging `componentDidCatch` and Vietnamese fallback + reload.
- `apps/clinic-web/src/main.tsx` — wraps `<App/>` in `<ErrorBoundary>` inside `<StrictMode>`.
- `apps/clinic-web/src/components/Queue.tsx` — adds `pendingCancel` state, routes cancel button to open an `alertdialog`, confirm button runs the unchanged `act(...)` cancel.
- `apps/clinic-web/src/components/error-boundary.test.tsx` (new) — jsdom component test (per-file docblock) exercising the real catch path.
- `apps/clinic-web/e2e/visit.mjs` — new step gating cancel behind the dialog on a throwaway check-in.
- `apps/clinic-web/package.json` + `pnpm-lock.yaml` — `jsdom` test-only devDependency.

Full diff: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ui-demo-blockers" diff origin/main`

</details>
