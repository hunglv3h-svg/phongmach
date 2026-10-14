# Verification — Theme switcher (Sáng / Tối / Theo hệ thống)

Branch: `feat/theme-switcher`
Worktree: `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\theme-switcher`
Environment: Windows + Git Bash (`C:\Program Files\Git\bin\bash.exe -lc`), pnpm 12.8.1, Node ≥ 22.

## What was implemented

- `apps/clinic-web/src/theme.ts` — `ThemeMode` type, `THEME_KEY = 'phongmach.theme'`, pure `resolveTheme`, `readStoredMode` (defaults to `system`, try/catch around localStorage), `applyTheme`, and the `useTheme()` hook. The hook applies `data-theme` on `<html>`, persists the mode, and — only in `system` mode — subscribes to `matchMedia('(prefers-color-scheme: dark)')` `change`, cleaning the listener up on unmount / leaving system mode. No imports outside `react`.
- `apps/clinic-web/src/components/ThemeToggle.tsx` — segmented 3-button group `role="group" aria-label="Chủ đề giao diện"`; labels exactly `Theo hệ thống`, `Sáng`, `Tối`; `aria-pressed` + `data-testid="theme-{mode}"`. Plain React, no new deps.
- `apps/clinic-web/src/components/Shell.tsx` — mounts `<ThemeToggle />` in `<header className="topbar">`, after `<nav>` and before `<SyncBar>`. Nav/tab logic, SyncBar, logout, DemoBanner wiring untouched.
- `apps/clinic-web/src/styles.css` — added explicit `[data-theme="light"]` and `[data-theme="dark"]` variable sets (user choice wins over OS); kept `:root` + `@media (prefers-color-scheme: dark)` as pre-hydration fallback; added `[data-theme="dark"] .topbar` desktop border parallel to the existing dark media rule; added `.theme-toggle` / `.theme-opt` styling that reads in both the light content area and the dark desktop ink sidebar. Colors reuse existing vars (WCAG-tuned palette already in the file; no pure black/white).
- `apps/clinic-web/index.html` — inline (non-module) head script sets `data-theme` from `localStorage['phongmach.theme']` or the OS query before first paint (no flash). Confirmed preserved in built `dist/index.html`.
- `apps/clinic-web/src/components/Scope.tsx` — added a `REAL` entry recording the per-device theme switch (honest-demo invariant: it is a genuine, fully-working feature).
- Tests: `apps/clinic-web/src/theme.test.ts` (pure logic) and `apps/clinic-web/src/components/theme-toggle.test.tsx` (jsdom render + click behavior, state reset in `beforeEach`/`afterEach`).

## Invariants preserved

- No `@medplum/*` import in clinic-web; no `/api` change; no new runtime dependency (plain React + DOM only).
- localStorage used only for a UI preference (not patient data) — does not touch the encrypted offline store rules.
- DemoBanner / "Phạm vi" scope behavior intact; Scope now lists the feature as real.

## Commands run and results

Run from the worktree root via Git Bash:

- `pnpm typecheck` → PASS. `pnpm -r typecheck` across all 9 workspace projects, every package `Done`, exit 0. (This run also auto-triggered `pnpm install`, which completed cleanly: 495 packages, esbuild postinstall Done.)
- `pnpm test` → PASS. All workspace Vitest suites green; `apps/clinic-web` = **242 tests passed / 17 files** (includes the two new theme test files), exit 0.
- `pnpm --filter @phongmach/clinic-web build` → PASS. `tsc -p tsconfig.json && vite build`, 167 modules transformed, `✓ built in 3.25s`, PWA precache generated, exit 0. Verified `dist/index.html` contains the inline no-flash script ahead of the module script.

## Docker rebuild question (from the original request)

**No Docker image rebuild is required for this change.** The clinic-web PWA is served by Vite (dev: `pnpm dev:web`; demo: `pnpm --filter @phongmach/clinic-web build && ... preview`). The Docker Compose stack under `infra/medplum` only runs the backend — PostgreSQL 16, Redis 7, and Medplum 5.2.0 — and does not build or serve the front-end bundle. Changes to `styles.css`, `Shell.tsx`, `theme.ts`, `ThemeToggle.tsx`, and `index.html` take effect from the rebuilt front-end assets (`pnpm --filter @phongmach/clinic-web build`), with no backend container rebuild.
