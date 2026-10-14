# OFF-8 Sign & Print fix: route the five non-terminal outcomes through offline signing with a date fence

The fix closes OFF-8, where "Ký & In" while the app considered itself online could save a visit but print nothing when a prior same-visit op was still pending server confirmation. The approach follows the approved design (`docs/ke-hoach-trien-khai.md`, "Thiết kế OFF-8", approach **A + C1 + A-1**, owner-approved 02/10): every non-terminal outcome of `engine.submit` (`waiting`, un-promoted `offline`, `retrying`, `paused`, `held`) is now driven through the existing offline-signing path — promoted inside the sync engine while the lock is held — so the prescription is persisted and printed from the device, or the screen says "CHƯA in" explicitly. C1 pushes a focused op's ancestors immediately so the common "prior op still backing off, server has recovered" case returns to the normal online path. A-1 adds a date fence: an op that already reached the server (error.status ≠ 0) is only promoted when the client sign date equals the server `Date` date (Vietnam time); otherwise it is held back and reported "CHƯA in" to avoid a two-code prescription.

Watch for: the date fence depends on the error-response `Date` header surviving the Vite proxy and the production build — unverified because e2e couldn't run (confirmed as a disclosed gap, not a bug). The fence fails closed on a missing/unparseable `Date`, which is the safe direction (confirmed).

**Verdict**: APPROVED

## High-level view

The engine change is the heart of the fix. `settleFocus` no longer bails out unless the network is down; it now promotes any focused op that ended the sweep neither done nor in an attention state, including the two early-return paths (not-store-owner, awaiting re-login). Promotion still happens under the sync lock, so a background sweep in another tab cannot race in and send the online-form op first — the design's correctness argument for why promotion must live in the engine rather than in `complete()`.

The date fence is the one place the design admitted residual risk, and the implementation handles it conservatively. `dateFenceAllows` returns true only when the op never reached the server, or carries no sign time, or the server `Date` parses and matches the client sign day in Vietnam time. A missing or garbage `Date` returns false — no promote, no print, "CHƯA in". That is fail-closed: the dangerous outcome (printing a paper code that the server may have half-written under a different day's code) is the one that gets blocked.

The `outcome()` precedence was reordered so a promoted op always reports `offline` (prints), and a server-reached-but-fenced op reports `retrying` even while offline, so `complete()` says "CHƯA in" instead of printing a possibly date-skewed prescription. The pure-offline branch in `complete()` shares the same fence via `dateFenceBlocks`, which keeps slice 3b-1's "don't change sign time after 503" rule intact on that path too — previously it was only honored at `submit`.

The idempotency boundary is respected: promotion reuses the same op id and `clientUuid`, `enqueue` now preserves the prior `error` (so the fence still has server-date data when `complete` is re-clicked) without touching the replay contract, and the `checkin`/`openVisit` re-enqueue after submit was removed — that stale re-enqueue set `nextAt=0` and resent a just-failed op too early.

The known gaps are disclosed and match the design's "Rủi ro còn lại": the date fence itself (residual case 1), double-fault store-write failure (case 2), 401 closing the store before promotion (case 3, to be measured by e2e), and crash-between-persist-and-result (case 4, pre-existing, out of scope). e2e could not run in this environment (no `openssl` to seed the shared Medplum stack), so the `Date`-header-through-proxy question and residual case 3 remain unmeasured — reported honestly, not claimed as passing.

<details>
<summary>Issues (3)</summary>

1. **Date header through proxy/build unverified** — A-1 relies on the error-response `Date` header reaching the browser through the Vite proxy and the production build; unit tests mock it, e2e couldn't run. If it doesn't arrive in a real build, every `retrying` case fails closed to "CHƯA in" (degrades to A-2 for that case, still satisfies K). Measure on an environment where the Medplum stack stands up before the 13/11 demo.
2. **Residual case 3 (401 store-close race) unmeasured** — the design flags that 401 at sign time could close the store before promotion completes; the e2e `offline-conflict` case meant to measure it was written but not run. Not a regression, but unconfirmed on this fix.
3. **e2e suite not executed** — `pnpm e2e:cycles` could not run (no `openssl` for stack setup); the three e2e edits are syntax-checked only. Run the 100-cycle (seed 558698034) and 20-cycle 429 scenarios where the stack is available.

</details>

<details>
<summary>Details</summary>

### Test-first is genuine

`repro-red.txt` shows 14 failed / 31 passed across `client.test.ts` and `sync.test.ts` on unchanged production code: 9 client failures and 5 sync failures, each asserting the OFF-8 expectation (`online`/`offline`/"CHƯA in") against the old `failed`-everything behavior. The failure messages are the real pre-fix strings ("Đang chờ thao tác trước đó…", "Mất kết nối…"), confirming the tests were red for the right reason — the behavior, not a compile error. After the fix both files are green (45/45). The design's "bài 2" (the old "click again to print" path) was removed as specified, since the path no longer exists.

### The five outcomes map to K

The client tests encode invariant K directly. `waiting` with a recovered server → `online` via C1 (no re-click); `waiting` with the prior op still failing → `offline`, printed once after persist. `offline` un-promoted, `retrying` same-day, `paused` (401), and `held` (409) all → `offline`, printed exactly once. `held` additionally proves the prescription reprints from the sync-pending list via `reprintSigned`. Every success path asserts `printed[0].persisted === { op: true, draftGone: true }` — print happens *after* the op and draft are committed, which is the design's N1 ("persist durably, then print") and blocks the "print before write" mutation.

### clientUuid and idempotency untouched

`expectSignedOffline` asserts `op.id === draft.clientUuid` and `op.body.payload.body.clientUuid === draft.clientUuid` on every promoted path, and the `retrying` same-day test asserts the server receives 2 requests with one completion (`bff.sent === 2`, `bff.completions.size === 1`) — the replay contract still collapses duplicates. Promotion generates no new UUID. `enqueue` was changed to spread `...existing.value` so the prior `error` survives a payload-only update; this preserves server-date data for the fence without altering the completion payload's replay semantics. The BFF and `@phongmach/print` are not in the diff.

### Date fence is fail-closed

```
dateFenceAllows(error, clientSignedAt):
  no error / error.status === 0   -> true   (never reached server)
  no clientSignedAt               -> true   (open/checkin, no date-coded prescription)
  no error.serverDate             -> false  (reached server, can't verify day -> block)
  unparseable serverDate          -> false  (block)
  else                            -> vnDay(client) === vnDay(server)
```

The two negative branches return false, so an op that reached the server but whose day can't be confirmed is never promoted and never printed — it surfaces as "CHƯA in" and keeps retrying in online form. This is the safe direction: the harm the fence exists to prevent (a paper code diverging from a half-written server record across a midnight boundary) is exactly what gets blocked. The `retrying`-other-day and `retrying`-no-Date tests both assert `failed` + "CHƯA in" + `rxTmpId` undefined + `clientTimes` undefined (op stays in online form, still self-sends). The pure-offline branch routes through `dateFenceBlocks` and the "503 other-day then offline" test proves it no longer rewrites the sign time of a server-reached op — closing the slice-3b-1 gap that test 7 originally documented as a bug.

### outcome() precedence

The reorder is load-bearing. `promoted` is checked first (always `offline` → prints, even when held/paused/not-owner). Then `held` (dep in attention). Then — new — a server-reached op that was *not* promoted returns `retrying` *before* the `paused`/`offline`/`waiting` checks, so the date-fence rejection reaches `complete()` as "CHƯA in" even when the client is offline, rather than being masked as a benign `offline`. The sync test "mục bị GIỮ … vẫn chuyển" confirms a held op (blocked by an upstream 409) still promotes to `offline`, while "mục tự nó … 409 không bao giờ promote" confirms an op in its own attention state never promotes — the two cases the design distinguishes.

### C1 scope is bounded

The sync test builds two independent chains and proves C1 pushes only the focused op's ancestors (via `deps`, transitively) past `nextAt`, leaving the other visit's op in `retry` with zero new requests. The "C1 pushes everything" mutation is caught by this test (verification table row C: 1 failed). C1 touches neither `backoff` nor `attempts`.

### Mutation evidence

Four mutations were run and each turned at least one test red: promote-only-on-network (old behavior) → 9 failed; drop the date fence → 4 failed; C1 pushes all ops → 1 failed (the cross-visit test); `failed` without "CHƯA in" → 2 failed. The remaining design mutations (promote outside the lock, print before write, new clientUuid on promote, sign time taken at promote) are argued as structurally blocked — promotion runs inside `locks.request`, the fake printer checks `persisted.op`/`draftGone` at print time, and `expectSignedOffline` pins the same `clientUuid` and `signedAt === click time`. The argument holds against the diff: there is no code path that prints before `store.commit`, and the sign time comes from the payload built before the first send, not from promotion.

### Verification scope and the e2e gap

Typecheck clean across all 8 packages; `pnpm test` green with clinic-web at 210 (14 OFF-8 tests added) and 517 total. The count diverging from the design's "370" snapshot is explained (project grew after slice 6). `pnpm e2e:cycles` did not run: the shared Medplum stack needs `openssl` to seed RSA keys and `.env`, which isn't on this machine, and `stack:up` uses Bash redirection that breaks under PowerShell. The three e2e edits (cycles "must-be-0" assertion, 503-at-complete sign scenario, 401-at-sign conflict scenario) were written and pass `node --check` but are unexecuted. This is reported as not-passing rather than claimed green, which is the correct call — and it leaves the one risk the design itself marked "chưa đo" (does `Date` survive the proxy/build) genuinely open. It should be measured before the 13/11 demo, since that is the environment the bug was observed in.

</details>

<details>
<summary>File map</summary>

Production:
- `apps/clinic-web/src/api.ts` — `ApiError` carries `serverDate`; `request()` reads `res.headers.get('date')` on error responses.
- `apps/clinic-web/src/local/ops.ts` — `OpError` carries `serverDate`.
- `apps/clinic-web/src/local/sync.ts` — `classify` copies `serverDate`; `dateFenceAllows`/`dateFenceOk`/`dateFenceBlocks`; `settleFocus` promotes all non-terminal focused ops under lock; C1 ancestor set; `enqueue` preserves prior `error`; `outcome()` precedence reorder.
- `apps/clinic-web/src/local/client.ts` — `complete()` prints on `offline`, says "CHƯA in" otherwise; pure-offline branch shares the fence; `openVisit`/`checkin` drop the post-submit re-enqueue.

Tests & support:
- `apps/clinic-web/src/local/client.test.ts` — 9 OFF-8 cases (replaces the "TÁI HIỆN" group).
- `apps/clinic-web/src/local/sync.test.ts` — 5 engine cases (promote under lock, C1 scope, held-vs-own-attention, date fence).
- `apps/clinic-web/src/local/fakeBff.ts` — `Fault` accepts `date`, emitted as the `Date` header.

e2e (written, not executed):
- `apps/clinic-web/e2e/offline-cycles.mjs`, `offline-sign.mjs`, `offline-conflict.mjs`.

Full diff: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\off8-sign-print" diff main`

</details>
