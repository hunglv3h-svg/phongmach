# Implementation Plan — Theme switcher (Sáng / Tối / Theo hệ thống)

Worktree (absolute, Windows + Git Bash): `d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\theme-switcher`
Package: `@phongmach/clinic-web` (apps/clinic-web). All commands run from the worktree root.

## Context discovered during exploration (read before implementing)

- `apps/clinic-web/src/styles.css` already drives nearly all colors through CSS custom properties on `:root` (`--bg`, `--surface`, `--text`, `--muted`, `--line`, `--primary`, `--warn-bg/ink`, `--ok-bg/ink`, `--bad-bg`, `--danger`, etc.), and already has a `@media (prefers-color-scheme: dark)` block (lines ~21-40) that redefines those same vars with dark values. The content area, cards, forms, tables, demo banner, sync panel all consume the vars — so dark mode is largely a matter of toggling which var set is active, not rewriting rules.
- Intentionally-dark surfaces that must stay dark regardless of theme (do NOT convert): `.display` (public TV screen) and the desktop left sidebar `.topbar` under `@media (min-width: 1024px)` which uses `--ink`/`--ink-text`/`--ink-muted`. The sidebar is a dark "ink column" by design and already reads correctly on a dark page; leave its rules alone.
- The nav lives in `Shell.tsx` inside `<header className="topbar">` → `<nav className="main-nav">` with `.tab` buttons (icon + `.tab-label`), followed by `<SyncBar/>` and a `<button className="ghost">Đăng xuất</button>`. On desktop the topbar is a vertical sidebar; on phones (`max-width: 759px`) `.main-nav` becomes a fixed bottom bar.
- No existing `localStorage`, `matchMedia`, or `data-theme` usage anywhere in `apps/clinic-web/src` — this is net-new, no conflicts.
- Tests: Vitest. Component tests that need the DOM start the file with the pragma `// @vitest-environment jsdom` (see `src/components/error-boundary.test.tsx`) and render with `react-dom/client` + `act`. Build is `tsc -p tsconfig.json && vite build`.
- Invariants to preserve: web must NOT import `@medplum/*` and only call `/api/...`; introduce NO new runtime deps (plain React + DOM only); keep DemoBanner / Scope ("Phạm vi") mock-labeling intact. localStorage for a UI preference is fine — it is not patient data, so the IndexedDB-encryption offline rules do not apply here.

## Design decisions

- **Control style**: a compact 3-button segmented group (not a native `<select>`), wrapped in a container with `role="group"` and `aria-label="Chủ đề giao diện"`. Reason: matches the existing button/`.tab` visual language, works cleanly inside the dark ink sidebar where a native dropdown looks out of place, and keeps all three options visible. Labels are exactly `Sáng`, `Tối`, `Theo hệ thống`.
- **State lives in a plain hook** `useTheme()` in a new `src/theme.ts`; the control UI is a small `ThemeToggle` component. Reason: keeps `Shell.tsx` lean, makes the apply/matchMedia logic unit-testable in isolation, no new dependency.
- **Apply mechanism**: set `data-theme="light" | "dark"` on `document.documentElement`. `system` mode resolves via `window.matchMedia('(prefers-color-scheme: dark)')` and subscribes to its `change` event; the listener is removed on unmount and whenever mode leaves `system`.
- **CSS**: add explicit `[data-theme="dark"]` overrides (mirroring the existing media-query dark values) and `[data-theme="light"]` (forcing the light values even when the OS prefers dark). Keep the existing `@media (prefers-color-scheme: dark)` block as the no-JS / pre-hydration fallback. Because rules already consume vars, no rule bodies need rewriting; only a couple of still-hardcoded spots are reviewed.
- **No-flash**: a tiny inline script in `index.html` `<head>` sets `data-theme` from localStorage (or the OS query for `system`/absent) before first paint.

---

- [ ] 1. Add the theme model + hook in a new file `apps/clinic-web/src/theme.ts`.
      Export `type ThemeMode = 'light' | 'dark' | 'system'`; `const THEME_KEY = 'phongmach.theme'`; `function readStoredMode(): ThemeMode` (reads localStorage, validates against the three values, defaults to `'system'`, wrapped in try/catch so a disabled/throwing localStorage degrades to `'system'`); `function resolveTheme(mode, systemPrefersDark: boolean): 'light' | 'dark'` (pure: `system` → dark/light from the boolean, otherwise the mode itself); `function applyTheme(resolved: 'light'|'dark'): void` (sets `document.documentElement.setAttribute('data-theme', resolved)`); and a React hook `useTheme()` returning `{ mode, setMode }`. The hook: `useState(readStoredMode)`; a `useEffect([mode])` that creates the matchMedia query, computes + applies the resolved theme, persists `mode` to localStorage (try/catch), and — only when `mode === 'system'` — adds a `change` listener that re-applies on OS change; the effect's cleanup removes the listener. `setMode` just updates state (effect does the rest). Use `matchMedia?.('(prefers-color-scheme: dark)')` defensively (jsdom may lack it). Do NOT import anything outside `react`.
      Files: `apps/clinic-web/src/theme.ts`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes (file compiles; completes together with step 2's component before running the suite).

- [ ] 2. Add the control component `apps/clinic-web/src/components/ThemeToggle.tsx`.
      Render `<div className="theme-toggle" role="group" aria-label="Chủ đề giao diện">` containing three `<button type="button" className="theme-opt{ active ? ' active' : ''}">` for the modes in order `system`, `light`, `dark` → labels `Theo hệ thống`, `Sáng`, `Tối`. Each button: `aria-pressed={mode === value}`, `data-testid={`theme-${value}`}`, `onClick={() => setMode(value)}`. Consume `useTheme()` from `../theme`. Keep it presentational and dependency-free (plain React).
      Files: `apps/clinic-web/src/components/ThemeToggle.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes.

- [ ] 3. Mount `ThemeToggle` in the nav of `Shell.tsx`.
      Import `ThemeToggle` and render `<ThemeToggle />` inside `<header className="topbar">`, placed after the `<nav>` and before `<SyncBar ... />` (so on desktop it sits in the sidebar flow above/near the sync status, and on phones it stays in the top header, not the fixed bottom tab bar). Do not alter the existing nav/tab logic, SyncBar, logout button, or DemoBanner wiring.
      Files: `apps/clinic-web/src/components/Shell.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes.

- [ ] 4. Add CSS variables for explicit theming and style the toggle in `apps/clinic-web/src/styles.css`.
      (a) After the existing `@media (prefers-color-scheme: dark)` block, add an explicit `[data-theme="dark"] { ... }` selector that sets the SAME dark values currently inside that media block (so a user-chosen dark theme wins regardless of OS), and a `[data-theme="light"] { ... }` selector that restates the `:root` light values (so a user-chosen light theme wins even when the OS prefers dark). Keep the existing `:root` and the `@media (prefers-color-scheme: dark)` block unchanged as the pre-hydration / no-JS fallback. (b) Review the two remaining `@media (min-width: 1024px) and (prefers-color-scheme: dark)` sidebar rule near the file end: add a parallel `[data-theme="dark"]` form so the desktop sidebar border behaves consistently when dark is chosen explicitly. (c) Add `.theme-toggle` styling: a small inline-flex segmented group of three buttons that reads correctly BOTH in the light content area and inside the dark desktop ink sidebar — e.g. `.theme-toggle { display: inline-flex; gap: 2px; }`, `.theme-opt { min-height: 36px; padding: 0 .6rem; font-size: .8rem; border: 1px solid var(--line); background: var(--surface); color: var(--text); }`, grouped border-radius on first/last, and `.theme-opt.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }`. Inside the desktop sidebar add `@media (min-width:1024px){ .topbar .theme-opt { color: var(--ink-text); background: transparent; border-color: rgba(255,255,255,.18); } .topbar .theme-opt.active { background: rgba(255,255,255,.14); color: #fff; } }` to match the ink-column tabs. Ensure `.theme-opt:focus-visible` keeps a visible outline (the global `button:focus-visible` already covers it). Keep contrast adequate (WCAG AA where reasonable); avoid pure black/white.
      Files: `apps/clinic-web/src/styles.css`
      Verify: `pnpm --filter @phongmach/clinic-web build` succeeds (CSS is bundled by Vite; a syntax error fails the build).

- [ ] 5. Add the no-flash inline script in `apps/clinic-web/index.html`.
      In `<head>` (after the existing `<meta>`/`<title>`, before `</head>`), add a small `<script>` (no `type="module"`, so it runs synchronously before body paint) that: reads `localStorage.getItem('phongmach.theme')` inside try/catch; if it is `'light'` or `'dark'` use it directly, otherwise (value `'system'`, absent, or storage throwing) resolve via `window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`; then `document.documentElement.setAttribute('data-theme', resolved)`. Keep it ~8 lines, no dependencies. This only sets the initial attribute; the React hook (step 1) takes over and keeps it in sync afterward, so the key name `phongmach.theme` must match `THEME_KEY`.
      Files: `apps/clinic-web/index.html`
      Verify: `pnpm --filter @phongmach/clinic-web build` succeeds and the built `dist/index.html` contains the inline script (open it to confirm Vite preserved the head script).

- [ ] 6. Add a unit test `apps/clinic-web/src/theme.test.ts` for the pure logic.
      Cover `resolveTheme` for all three modes against both `systemPrefersDark` values, and `readStoredMode` returning the stored value for `'light'`/`'dark'`/`'system'` and defaulting to `'system'` for an absent or garbage value. Use a jsdom-friendly setup or stub `localStorage`/`globalThis` as needed; follow the node-env default (no DOM render required for the pure functions). Keep it in the Vitest `pnpm test` graph.
      Files: `apps/clinic-web/src/theme.test.ts`
      Verify: `pnpm --filter @phongmach/clinic-web test` runs and the new theme tests pass.

- [ ] 7. Add a component/behavior test `apps/clinic-web/src/components/theme-toggle.test.tsx`.
      Start the file with `// @vitest-environment jsdom`. Provide a minimal `window.matchMedia` stub (jsdom lacks it) returning `{ matches: false, media, addEventListener, removeEventListener, addListener, removeListener, dispatchEvent }`. Render `ThemeToggle` via `react-dom/client` + `act` (pattern from `error-boundary.test.tsx`): assert the three buttons show exactly `Theo hệ thống`, `Sáng`, `Tối`; clicking `data-testid="theme-dark"` sets `document.documentElement.getAttribute('data-theme') === 'dark'` and writes `'dark'` to `localStorage['phongmach.theme']`; clicking `theme-light` sets it to `'light'`. Reset `document.documentElement` attribute and `localStorage` in `beforeEach`/`afterEach` so tests don't leak shared state (per the test-culture rule).
      Files: `apps/clinic-web/src/components/theme-toggle.test.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web test` passes including the new file.

- [ ] 8. Update the "Phạm vi" scope listing to record the real (non-simulated) feature.
      Add one entry to the `REAL` array in `apps/clinic-web/src/components/Scope.tsx` describing the per-device theme switch (Sáng/Tối/Theo hệ thống, lưu lựa chọn trên từng máy). This keeps the honest-demo invariant (every on-screen feature is listed as real / simulated / missing). The theme switch is a genuine, fully-working feature, so it belongs under `REAL`, not `SIMULATED`.
      Files: `apps/clinic-web/src/components/Scope.tsx`
      Verify: `pnpm --filter @phongmach/clinic-web typecheck` passes.

- [ ] 9. Full verification gate for the whole change.
      Run the repo's minimum gate plus the web build.
      Files: (none — verification only)
      Verify: from the worktree root run `pnpm typecheck`, then `pnpm test`, then `pnpm --filter @phongmach/clinic-web build` — all succeed with no errors.

## Note on the Docker rebuild question (from the original request)

The user asked whether a new Docker image is needed. Record this in the final summary (no code change): the clinic-web PWA is served by Vite/preview, not by the Medplum/Postgres/Redis containers in `infra/medplum` (those are the backend). In dev (`pnpm dev:web`) and in the build/preview flow (`pnpm --filter @phongmach/clinic-web build && ... preview`), changes to `styles.css` / `Shell.tsx` take effect from the rebuilt front-end assets — no Medplum Docker image rebuild is required. A rebuild of the backend containers is only relevant if the app were packaged into its own image for deployment, which is not part of this M0 front-end change. The implementer should restate this in the hand-off summary.

## Assumptions

- The desktop ink sidebar staying dark in all themes is acceptable and intended (it is a design choice already in the codebase); dark mode primarily restyles the content area, cards, forms, tables, and the demo banner.
- Placing the toggle after `<nav>` and before `<SyncBar>` is the least disruptive spot that keeps it off the phone bottom tab bar; if a reviewer prefers it elsewhere in the header that is a trivial JSX move and does not change the hook/CSS.
