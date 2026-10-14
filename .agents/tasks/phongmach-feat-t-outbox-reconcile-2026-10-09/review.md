# Outbox reconciliation for signed-but-unqueued prescriptions (T-OUTBOX)

Adds a BFF reconciliation path that closes the double-write gap (A2/F11): a prescription can be signed (a `List` with `code=prescription` written) while its `send-prescription` Task never lands, because Medplum transactions are not atomic. The worker only scans Tasks, so such a prescription is stuck invisibly — never queued, never sent. `reconcilePrescriptions` scans the most recent signed `List`s over a window, finds those with no matching send Task, and recreates the Task via `createResourceIfNoneExist` keyed by the local prescription code, making repeated calls idempotent. It is exposed as `POST /api/prescriptions/reconcile` (clinical roles only) and surfaced in `Gateway.tsx` as a "Quét đối soát" button next to the pending list. The gateway keeps its SIMULATED label and real-send behavior is untouched.

Watch for: nothing blocking. The one thing a reviewer should not be alarmed by — `git diff main` shows ErrorBoundary/Queue/visit.mjs deletions and a 301-line pnpm-lock change — is an artifact of the branch sitting one commit behind main, not a revert introduced by this work (confirmed below).

**Verdict**: APPROVED

## High-level view

The branch contains a single commit (`7736a3d`) that touches exactly twelve files, all in scope for T-OUTBOX: the BFF store/route/medplum/audit layer, the web API client and Gateway, a unit test, an integration test, and status docs. The scary-looking deletions in `git diff main` (the global error boundary, the queue cancel-confirm dialog, its e2e assertions, and a large pnpm-lock churn) come entirely from main having advanced one commit (`73bd4d2`, "confirm dialog before cancelling queue visit + global error boundary") that this branch has not yet merged. The feature commit itself deletes none of that — it is purely a rebase-gap artifact, so there is no regression to flag, only a note to rebase before merge.

The reconciliation logic is idempotent by construction. The send Task is built with `identifier = prescriptionLocal|<code>` and recreated with `createResourceIfNoneExist(..., identifier=prescriptionLocal|<code>)` — the build identifier and the dedup query match exactly, so a second call (or two concurrent scans) finds the existing Task and writes nothing new. The scan reuses the same `List`-identifier scheme the existing `pendingPrescriptions` path already uses, and gates re-enqueue on the encounter being `finished`, mirroring `toJob`'s "only closed visits are due" checkpoint.

The safety invariants hold. The web still has zero `@medplum/*` imports; the route reads tenant from the session via `ctx.store(req)` rather than a request param; the guard uses `CLINICAL_ROLES` so assistants get 403; the audit entry is written before the response and carries only `resultCount`, no PII. The clientUuid idempotency mechanism and the F11 completion bundle were not altered — the feature commit only adds `reconcilePrescriptions` and a `buildSendTask` import.

The mutation test exists and was observed red. The unit test models a signed prescription whose send status is removed, asserts it is invisible in pending, that reconcile re-enqueues it with a non-PII audit line, and that a second call is a no-op. The verification notes record stubbing `reconcilePrescriptions` to a no-op and watching assertion (b) fail with the expected `expected [] to include 'PM-...'`, then restoring it to green.

<details>
<summary>Issues (1)</summary>

1. **Branch is behind main (non-blocking)** — the branch's merge-base is `52c0054` but main is at `73bd4d2`, so `git diff main` surfaces main's error-boundary/cancel-dialog commit as spurious deletions. Rebase onto main before merge; the feature commit does not touch those files.

</details>

<details>
<summary>Details</summary>

## The deletions in the diff are a rebase gap, not a revert

Reviewing `git diff main --stat` first shows alarming removals: `ErrorBoundary.tsx` and its test deleted, `main.tsx` no longer wrapping `App` in the boundary, the queue cancel-confirmation dialog ripped out of `Queue.tsx`, the matching e2e assertions dropped from `visit.mjs`, `jsdom` removed from `package.json`, and ~301 lines of pnpm-lock churn. Taken at face value these would be serious regressions of existing safety features — a destructive cancel firing without confirmation, and the loss of a global render-error guard.

They are not part of this change. The branch has a single commit, `7736a3d`, and `git show 7736a3d --stat` lists only the twelve T-OUTBOX files; none of the error-boundary or queue files appear. The merge-base of the branch and main is `52c0054`, while main's tip is `73bd4d2` — a commit titled "feat(clinic-web): confirm dialog before cancelling queue visit + global error boundary" that the branch does not contain. `git diff main` therefore reports main's additions as if the branch had deleted them. The fix is procedural, not code: rebase `feat/t-outbox-reconcile` onto current main before merging so the diff reflects only the feature. No functional regression exists.

## Idempotency by matched identifier

```
signed List (code=prescription, identifier prescriptionLocal|CODE)
        │  reconcile scans newest `limit` lists over the window
        ▼
   has a send Task with identifier prescriptionLocal|CODE ?
        │ yes → skip
        │ no  → encounter finished ?
        │          │ no  → skip (not yet due, mirrors toJob)
        │          ▼ yes
        └─ createResourceIfNoneExist(buildSendTask{identifier prescriptionLocal|CODE},
                                     "identifier=prescriptionLocal|CODE")
```

The guarantee rests on the build identifier and the `ifNoneExist` query being the same string space. `buildSendTask` sets `identifier: [{ system: SYSTEMS.prescriptionLocal, value: localCode }]`; the recreate call passes `identifier=${SYSTEMS.prescriptionLocal}|${code}`. A repeated reconcile — or two scans racing — resolves to the existing Task and creates nothing, which is exactly what the "idempotent by prescription code" criterion requires given Medplum's non-atomic transactions (no reliance on rollback; the dedup is identifier-based, not `If-Match`-based). The batch `hasTask` pre-filter is only an optimization to avoid per-code round-trips; correctness still comes from `createResourceIfNoneExist`, so even a stale pre-filter cannot produce a duplicate.

The scan window is a simple "newest `limit` signed lists sorted by `-date`" (limit clamped 1–500, default 100), which the task description accepts as the M0 time-window approach. The re-enqueue is gated on `encounter.status === 'finished'`, matching the existing checkpoint rule that only closed visits are due to send — a half-finished completion is not force-sent by reconcile.

## Invariants preserved

The web client gains only `api.reconcile`, a `/api/...` call, and `Gateway.tsx` uses types only — `git grep @medplum/ HEAD -- apps/clinic-web/src` is empty, so the "BFF is the only Medplum caller" rule holds. The route resolves the store with `ctx.store(req)`, deriving tenant from the signed-JWT session rather than any request parameter. The guard is `ctx.guard('prescription-reconcile', ...CLINICAL_ROLES)`, excluding assistants; the 403 path is covered by a dedicated test. The audit record is written with `await ctx.record(req, 'prescription-reconcile', { resultCount: result.requeued.length })` before returning — fail-closed, and the payload carries a count only, no names/codes/diagnoses.

`/api/prescriptions/reconcile` is registered at line 324, ahead of `/api/prescriptions/:id` at line 331, with an inline comment noting the ordering so "reconcile" is not captured as an `:id`.

The clientUuid idempotency mechanism and the F11 completion bundle are untouched: the feature commit's only change to `medplum.ts` beyond the new method is importing `buildSendTask`; `buildCompletionBundle`, `toJob`, and `clientUuidQuery` are not modified.

## Test coverage and the mutation observation

The required "signed prescription with NO send entry" case is `reconcile.test.ts`. It signs a prescription through the real app injection path, drops the send Task from the fake store to model the double-write gap, then asserts: (a) the stuck prescription is absent from `/pending` beforehand; (b) reconcile returns the code in `requeued` and writes exactly one `prescription-reconcile` audit line with `outcome: ok`, `resultCount: 1`, and no PII (asserted via a negative regex over the serialized entry); (c) it reappears in pending as `signed`; (d) a second reconcile returns an empty `requeued`. A second test confirms assistant → 403 with a `denied` audit entry.

The verification notes record the mutation step explicitly: stubbing `FakeStore.reconcilePrescriptions` to `{ scanned: 0, requeued: [] }` turned assertion (b) red with `AssertionError: expected [] to include 'PM-261020-8SQ8GT'`, and restoring the implementation returned 2/2 green. This satisfies the "observed RED before adding" requirement.

The integration test (`clinical.test.ts`, "đối soát: đơn đã ký thiếu trạng thái gửi") exercises the real Medplum data layer: sign, delete the real Task via admin, confirm `count(Task)=0` and absence from pending, run `reconcilePrescriptions`, confirm `count(Task)=1` and reappearance as `signed`, run the worker to a `sent`/`SIM-` national code, then call reconcile again and confirm `count(Task)` stays 1. This directly demonstrates idempotency at the real-write level.

Verification evidence (`verification.md`) reports typecheck clean across all nine projects, unit suites green (BFF 11 files/131 tests including the new reconcile file), and integration 77 green against the running Medplum stack, with the F5 login-rate caveat noted as infrastructure, not code. Per instructions the suites were not re-run; the evidence is present and specific, so no spot-check was warranted.

</details>

<details>
<summary>File map</summary>

Feature commit `7736a3d` (twelve files; the rest of `git diff main` is the rebase gap described above):

- `services/bff/src/medplum.ts` — adds `reconcilePrescriptions`: window scan of signed lists, batch has-Task filter, `finished`-gated idempotent Task recreate.
- `services/bff/src/store.ts` — `ReconcileResult` type and the `reconcilePrescriptions` interface method with the A2/F11 rationale.
- `services/bff/src/routes/clinical.ts` — `POST /api/prescriptions/reconcile`, clinical-roles guard, declared before `/:id`, audits `resultCount`.
- `services/bff/src/audit.ts` — new `prescription-reconcile` action.
- `apps/clinic-web/src/api.ts` — `api.reconcile` client call (`/api/...` only).
- `apps/clinic-web/src/components/Gateway.tsx` — "Quét đối soát" button, result note, reload of pending; keeps SIMULATED label.
- `apps/clinic-web/src/components/Scope.tsx` — scope-page line describing the reconciliation scanner.
- `services/bff/test/unit/reconcile.test.ts` — mutation test (signed-but-no-send-entry) + assistant 403.
- `services/bff/test/unit/helpers.ts` — `FakeStore.reconcilePrescriptions` + `ReconcileResult` import.
- `services/bff/test/integration/clinical.test.ts` — real-Medplum A2 idempotency test.
- `trang-thai-chuc-nang.md` / `.docx` — status doc update.

Full diff: `git -C "d:\My Documents D\UNIGIS\PM\phongmach\.worktrees\t-outbox-reconcile" show 7736a3d`

</details>
