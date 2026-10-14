# Verification — UI demo-blockers (PHONGMACH clinic-web)

Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\ui-demo-blockers` (branch `feat/ui-demo-blockers`).
Shell: PowerShell (pwsh). All `pnpm` commands prefixed with `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.

## Environment

- Full stack was already running: Medplum containers + BFF on `127.0.0.1:8110` (`GET /healthz` → `{"ok":true}`), seed data present.
- The pre-existing web server on `127.0.0.1:5173` did **not** contain my worktree changes, so e2e could not use it. I built the worktree and ran my own `vite preview`.
- `vite preview` bound to IPv6 `::1` only, so e2e was pointed at `http://localhost:4183` (not `127.0.0.1`). Preview launched from the worktree with `PREVIEW_PORT=4183 BFF_URL=http://127.0.0.1:8110` so `/api` proxied to the running BFF.
- Confirmed the served build actually contained the new UI before running e2e:
  - `GET http://localhost:4183/` → fetched the hashed entry JS → `cancel-visit-dialog` present: **True**, `error-boundary-fallback` present: **True**.
  - `POST http://localhost:4183/api/session {tenant:"noi-tong-quat",userId:"noi-assistant"}` → HTTP **200** (proxy to BFF works).

## Commands run and results

### Baseline (before edits)
- `pnpm --filter @phongmach/clinic-web typecheck` → exit 0 (installed 415 pkgs on first run, `tsc` clean).

### Unit / type / build gate (final, measures restored)
- `pnpm --filter @phongmach/clinic-web typecheck` → **exit 0** (`tsc -p tsconfig.json`, no errors).
- `pnpm --filter @phongmach/clinic-web test` → **exit 0**: `Test Files 15 passed (15)`, `Tests 233 passed (233)`.
  - Includes the new `src/components/error-boundary.test.tsx` (3 tests) and the pre-existing 230 tests unaffected by the per-file jsdom docblock.
- `pnpm --filter @phongmach/clinic-web build` → **exit 0** (`tsc` + `vite build`; PWA precache 17 entries). The only output warning is the pre-existing "chunks larger than 500 kB" notice, unrelated to this change.

### e2e (visit flow — includes new cancel-confirmation step)
- `E2E_URL=http://localhost:4183 pnpm --filter @phongmach/clinic-web e2e:visit` → **exit 0**, `Đạt 26/26`.
  - New **step 3**: `hủy lượt: bấm "Hủy" mở hộp thoại xác nhận và CHƯA hủy; "Giữ lại" không hủy; xác nhận mới thực sự hủy` — passed.
  - The new step cancels a **throwaway** check-in (an extra "Hủy thử" number for Nguyễn Văn An), then asserts the original An/Bình waiting rows survive; the downstream doctor flow (steps 5–25) ran green, confirming no knock-on breakage.

## Behavioral confirmation (not just exit codes)

- **Cancel confirmation (Task 1).** The e2e step performs, via the real UI + BFF, the exact spec: (1) click `cancel` → `cancel-visit-dialog` becomes visible and its text matches `/Nguyễn Văn An/` and `/số 0*<N>/`; while the dialog is open `GET /api/queue` shows the visit still `waiting` (click alone does NOT cancel). (2) click `cancel-visit-dismiss` → dialog detaches, visit still `waiting`. (3) re-open, click `cancel-visit-confirm` → dialog detaches, the row shows "Đã hủy" and `GET /api/queue` reports status `cancelled`. This proves the dialog gates the real `api.cancelVisit` call.
- **Error boundary (Task 2).** The jsdom component test renders `<ErrorBoundary><ThrowOnRender/></ErrorBoundary>` with a real `react-dom/client` root (true reconciler catch path, which `renderToStaticMarkup` cannot exercise). It asserts the mounted DOM contains `data-testid="error-boundary-fallback"`, the heading `Đã xảy ra lỗi hiển thị`, a `Tải lại trang` button; that `console.error` was called with `ErrorBoundary caught` (errors not swallowed); and that clicking the reload button calls `window.location.reload()` (spied).

## MUTATION PROOF

Each safety measure was temporarily removed, the relevant test was observed RED, then the measure was restored and observed GREEN.

### Task 1 — cancel confirmation (e2e)
- **Mutation:** reverted `Queue.tsx` cancel button `onClick` to call `act(i.id, … api.cancelVisit …)` directly (bypassing the dialog). Rebuilt, re-ran `e2e:visit`.
- **RED observed:**
  ```
  ✓  1. ... cấp số 020
  ✓  2. hàng chờ: số 021 ...
  ✗ Hỏng ở bước 3
   locator.waitFor: Timeout 30000ms exceeded.
     - waiting for getByTestId('cancel-visit-dialog') to be visible
       at .../e2e/visit.mjs:161
  ```
  The dialog never appears because the click cancels immediately — exactly the regression the test is meant to catch.
- **Restored → GREEN:** cancel button restored to `onClick={() => setPendingCancel(i)}`; rebuilt; `e2e:visit` → `Đạt 26/26`, step 3 passes.

### Task 2 — error boundary (jsdom component test)
- **Mutation:** in `ErrorBoundary.tsx`, neutered `getDerivedStateFromError()` to return `{ hasError: false }` and emptied `componentDidCatch` (swallow). Re-ran `vitest run src/components/error-boundary.test.tsx`.
- **RED observed:**
  ```
  ❯ src/components/error-boundary.test.tsx (3 tests | 2 failed)
    × con ném lỗi lúc render: hiện "Đã xảy ra lỗi hiển thị" + nút tải lại, và ghi lỗi ra console
    × nút tải lại gọi window.location.reload()
   Test Files  1 failed (1)
        Tests  2 failed | 1 passed (3)
  Error: nổ lúc render (cố ý)   ← error propagated out instead of being caught
  ```
  With the boundary neutered the thrown error escapes (no fallback, no `console.error('ErrorBoundary caught' …)`), so the two catch-path tests fail; the "renders children normally" test correctly stays green.
- **Restored → GREEN:** `getDerivedStateFromError` returns `{ hasError: true }`, `componentDidCatch` logs again; `vitest run src/components/error-boundary.test.tsx` → `Tests 3 passed (3)`, and the full suite → `233 passed`.

## Boundary / invariant checks

- `grep "@medplum"` across `apps/clinic-web/src/**` → **No matches** (web app keeps zero Medplum imports).
- New imports introduced: `ErrorBoundary` in `main.tsx` (local component); `jsdom` as a clinic-web **devDependency** (test-only, per-file `// @vitest-environment jsdom`); `LocalQueueItem` in `Queue.tsx` is a **type** import; `pad3` is from local `../format`. No new non-type runtime import from shared packages.
- No change to `cancelVisit`'s API contract, `clientUuid` idempotency, completion bundle, offline print barrier, BFF-only-Medplum, or tenant-from-JWT. Simulation labels and Scope/DemoBanner e2e assertions unchanged (step 24 still green).

## Not run / out of scope

- Did not run `pnpm e2e` (smoke), `e2e:offline`, `e2e:conflict`, `e2e:cycles`, or the monorepo-wide `pnpm test`/`pnpm typecheck` — the change is confined to `apps/clinic-web` and the plan's gate is the clinic-web typecheck/test/build + the visit e2e, all of which were run green here.
