# Design Review — T-IDP (real staff auth, replacing `DEMO_AUTH=1`)

Reviewed document: `.agents/tasks/phongmach-t-idp-staff-auth/design.md` (round 2 — it carries a `§11` responding to a prior `CHANGES_REQUESTED` review).
Scope of this review: the design document only. No application code was changed and none should be in this run. I read the invariant-bearing source and the cited plan rows to verify the design's claims rather than taking its word.

## Verdict summary

The design is unusually concrete and self-aware. Every claim I could check against source held up (see Verified Assumptions). The A-vs-B analysis is correctly grounded in F2/F5/row 12/T-EGR/T-TEN with an explicit, justified recommendation (B, with an M0 "embedded minimal IdP" at the OIDC boundary). The three invariants are each preserved and re-proven by a named test shown RED when the guard is removed. Session lifecycle (issue/refresh/revoke, sid-based revocation on every route, atomic single-use refresh), the offline key story, the demo/real split via a no-default `AUTH_MODE`, and the F5 test note are all present and specified.

I found no HIGH issues and no MEDIUM issues that block. The findings below are NITs: small gaps or under-specifications that the implementer should close but that do not change the design's correctness or the invariant proofs. Because the mechanical gate counts only HIGH and MEDIUM, the verdict is **APPROVED**.

I note explicitly that the design intentionally stops at the design stage pending the owner's A/B decision (and HIBP-egress acceptance if A). That is per the original request ("dừng ở bước thiết kế nếu chưa có quyết định") and is not a defect.

---

## Verified Assumptions

These design claims were checked against the actual source in the worktree and are correct:

1. **`record()` uses `req.session!`** and `AuditEntry.tenant`/`userId` are required `string`. Confirmed in `app.ts` (`const s = req.session!; … tenant: s.tenant, userId: s.userId`) and `audit.ts` (`tenant: string; userId: string;`). This is exactly the problem §4.5 addresses with `recordLogin()` + optional fields for `action:'login'`.
2. **`requireSession` currently only verifies the token signature/claims** — there is no `sid` lookup or revocation check. Confirmed in `app.ts`. The design's HIGH-3 fix (check `sid` on every `requireSession`, including reads) is a real, needed addition, not a restatement of existing behavior.
3. **Tenant comes only from the signed session**: `store: (req) => deps.stores(req.session!.tenant)` and every route uses `req.session!.tenant`; no route reads tenant from body/query/header. `SessionService.verify` is the sole token→`{userId,userName,role,tenant}` mapping. Confirmed in `app.ts` and `session.ts`.
4. **`SessionService` signs one HS256 JWT, 480-min default, no refresh, no revocation.** Confirmed in `session.ts` and `config.ts` (`SESSION_TTL_MINUTES … default(480)`). The design's two-token redesign is correctly motivated.
5. **`config.ts` has `DEMO_AUTH` default `'0'`** and **generates a random `SESSION_SECRET` when unset** (`randomBytes(32)`, `sessionSecretGenerated`). Confirmed. This is exactly why §5.1's HIGH-1 point (don't let a default decide network binding) and §5.1.1's "no random secret on the real path" are correct.
6. **`server.ts` exits if `!config.demoAuth` and binds only localhost.** Confirmed. The design preserves this fail-closed property by routing it through the no-default `AUTH_MODE`.
7. **BFF is the only Medplum caller via client-credentials**: `medplum.ts` `startClientLogin(clientId, secret)`, `cacheTime: 0`. Confirmed. Staff identity never enters Medplum under either A or B, so invariant #3 is untouched — the design's reasoning is sound.
8. **`completeVisit` checks `enc.participant?.[0]?.individual?.identifier?.value !== cmd.doctor.userId`** and `readVisit`/`openVisit` compare against `doctor.userId`. Confirmed in `medplum.ts`. The design's §6(4) signer-identity-at-create-time plan (and B7) correctly builds on this existing comparison.
9. **Offline store**: per-`(tenant,userId)` Dexie DB (`dbName = ${DB_PREFIX}${tenant}:${userId}`), AES-GCM-256 key via `newKey()` with `extractable:false` stored in IndexedDB on the same machine, `destroy()`, `pendingCount()`, `setOwnerName()`. Confirmed in `local/store.ts`, `local/crypto.ts`, and tests. The §6 key-lifecycle plan matches reality, including "key lives on the machine, not derived from identity."
10. **`Login.tsx`** has `expired` / `device-pending` ("Máy này còn N mục chưa đồng bộ của …") handling. Confirmed. §6 correctly reuses it.
11. **`Scope.tsx`** groups are `REAL` / `SIMULATED` / `MISSING`; the exact line `'Đăng nhập: chọn người dùng demo, chưa có mật khẩu (T-IDP)'` is under `SIMULATED`, and `'mã PIN cho kho trên máy'` is under `MISSING`. Confirmed. §5.3's move instruction is accurate to the current file.
12. **Plan citations**: F2 (`api.pwnedpasswords.com`, no off switch, affects create/set/change password), F5 (login 5/min/IP, shared behind NAT), F6/T-TEN (one Project + one ClientApplication per clinic), T-EGR (NĐ 53/2022 egress allowlist), A8 (choose Medplum-user-as-IdP vs own UNIGIS IdP → F2), and row 12 (phone+OTP+trusted device; MFA for signing/admin roles; `[Chưa kiểm chứng]`). All verified in `docs/ke-hoach-trien-khai.md`. The trade-off analysis is faithful to these rows.
13. **F11 non-atomic transaction lesson** is correctly invoked as the analogy for why the M0 session store must not be a naive JSON file (§3.2). Confirmed F11 wording in the plan.

## Unverified / Wrong Assumptions

I found **no wrong assumptions**. Items the design asserts that I could not fully verify from code (they concern external systems or future behavior, not current source):

- **Medplum's exact login/MFA HTTP surface for Option A** (`/auth/login` + MFA step, `ProjectMembership` return shape) is described at a level sufficient for the recommendation but not verified against Medplum internals. Since the design recommends B and this only matters if the owner chooses A, it is not blocking — but see NIT-4.
- **Argon2id availability / chosen library** is assumed but not pinned (no dependency named). Not blocking at design stage; see NIT-5.

---

## Findings

### NIT-1 — `recordLogin` field-shape change needs a one-line type/`recent()` note to be unambiguous
§4.5 chooses to make `AuditEntry.userId` and `tenant` optional *only for* `action:'login'`, with `recent()` filtering by `tenant` so undefined-tenant entries never surface per-clinic. This is the right call, but TypeScript cannot express "optional only for one action" on a single interface; the implementer could read "optional" as weakening the type for *all* actions, which would silently relax invariant #2's data-path guarantee.
**Fix:** state the mechanism concretely — either (a) keep `userId`/`tenant` required on `AuditEntry` and add a separate `LoginAuditEntry` type (or a discriminated union on `action`) so non-login actions still require both at compile time; or (b) if making them optional on the shared interface, add an explicit runtime assertion in `record()` (the data-path writer) that both are present, with a test that `record()` throws if `tenant`/`userId` is missing. Note which `recent()` behavior holds for an entry whose `tenant` is undefined (dropped from every clinic's view).

### NIT-2 — `/api/audit` (owner audit view) is not re-stated under the new `requireSession`/`sid` revocation
The existing `/api/audit` route is `owner`-only and read-only. §3.2 HIGH-3 says `sid` revocation applies to *all* `requireSession` routes including reads, which correctly covers `/api/audit`. But the checklist (§9) and B5 enumerate `/api/patients/:id` as the representative read and do not mention the audit route. Since the audit screen exposes access history, a revoked owner session continuing to read it is exactly the case HIGH-3 cares about.
**Fix:** add one line to §9 / B5 noting `/api/audit` is also behind the `sid` check, or state generally "every route registered under the `requireSession` hook, with no per-route exemption" and name `/api/audit` as a covered example.

### NIT-3 — Rate-limit (§4.6) has no named test, unlike every other guard
§4.6 introduces internal login rate-limiting (token bucket per `loginId`+IP, escalating soft-lock) as the replacement for F5's role. Every other guard in the design has a B-row with a mutation proof; rate-limit has none. It is a security control (brute-force / credential-stuffing defense) and the project's culture requires a test proven RED when removed.
**Fix:** add a B-row (unit, virtual clock, no `sleep` per the project's timer-test rule): N failed logins for one `loginId` → subsequent attempt is throttled (429/`locked`) even with a correct password within the window; mutation — remove the counter increment / lock check ⇒ throttle never triggers ⇒ test RED. Reuse the injected `now()` for the window.

### NIT-4 — Option-A HIBP-egress operational detail is thin for a decision the owner may actually pick
§3.3 and §10(1) correctly flag that choosing A forces an approved HIBP egress proxy (F2/T-EGR) and F5 handling. But the owner is being asked to decide A/B, and A's description does not say *what breaks and when* concretely: F2 fires on create/set/change password, so under A a staff member cannot set an initial password or rotate one while the proxy/international egress is down — a startup/onboarding blocker, not just a login-time one.
**Fix (doc clarity, not a correctness gap):** in §3.3 add one sentence making the A failure mode concrete ("under A, with HIBP egress blocked, no staff account can be created and no password can be set or changed — not only login is affected"), so the owner's A/B choice is informed. This does not change the recommendation.

### NIT-5 — Password-hashing and TOTP libraries are unpinned
The design names Argon2id and RFC 6238 TOTP but no concrete library/version. The project's conventions require pinned, well-known dependencies and secure defaults. Leaving this open invites an ad-hoc or typosquatted choice at implementation time.
**Fix:** name the intended libraries and pin them (e.g., a maintained Argon2 binding and a maintained TOTP implementation), with Argon2id parameters stated (memory/time/parallelism) so the implementer does not pick weak defaults. State this in §9's `identity` module checklist item.

### NIT-6 — "No PII in audit" for `login/denied` should explicitly cover the Fastify request log, not only the audit entry
§4.5(3)/B3 correctly forbid `loginId`/password/OTP/phone/name in the `login/denied` *audit entry* and reference `logStream`. The current `app.ts` already strips query strings and redacts `authorization` in the Fastify logger, but the new login routes receive credentials in the request **body**, and the design does not state that the body must never be logged (e.g., on a validation error or in the error handler). A `ZodError` on the login body, or any `req.log` that serializes the body, could leak the password.
**Fix:** add an explicit invariant + test: the login/MFA routes must never log request bodies; the `setErrorHandler` path for login must not echo body contents; B3(3) should assert the captured `logStream` contains no password/OTP/`loginId` even on a 400/validation failure, not only on the audit entry.

---

## Invariant re-proof check (as requested)

- **Invariant 1 (tenant only from signed JWT):** Preserved — access token bakes exactly one tenant; multi-tenant staff get a `pretenant` token whose `allow` list is signed and `select-tenant` only chooses within it; `verify` rejects non-`access` `typ`. Re-proven by **B2** (unit + `services/bff` integration: `?tenant=Y`/body/header ignored; cross-tenant 404) and **B2b** (pretenant token → 401 on data route; tenant ∉ signed `allow` → 403). Mutations named and plausible-RED (read tenant from query; read `allow` from body). ✔
- **Invariant 2 (audit before data, fail-closed, no PII):** Preserved and extended to the pre-session login path via `recordLogin()`. Re-proven by **B3** (sink throws ⇒ 500 on data route and on `login/denied`, no body; no `loginId`/password/OTP in entry or log). Mutation: drop `await`/swallow error ⇒ RED. ✔ (see NIT-1, NIT-6 for sharpening)
- **Invariant 3 (BFF-only Medplum; web 0 `@medplum/*`):** Preserved — staff identity never enters Medplum; client-credentials unchanged. Added **B0** static grep/lint proven RED by adding one `@medplum/*` import to web. ✔

## Session lifecycle & offline

- Issue/refresh/revoke, 15-min access + rotating single-use refresh, `sid` revocation on **every** route (reads included), atomic consume (SQLite UNIQUE + UPDATE-row-count, or Redis `GETDEL`, or per-`sid` serialization) with parallel-replay → single success + `sid` revoked. B5 covers all four cases with virtual clock. ✔
- Offline: 480→15-min change motivated by the "token not renewed offline" lesson; store survives logout/expiry when `pendingCount>0`, `destroy()` only when drained; key stays machine-local per `(tenant,userId)`, not password-derived (so offline unlock does not require network); residual shared-machine risk kept in `Scope`/`README` MISSING. Signer identity frozen into the op payload at create time (§6(4), B7). ✔

## Demo/real separation

No `DEMO_AUTH=1` on the real path; `AUTH_MODE` with **no default** gates binding; missing/invalid mode ⇒ exit before `listen`; mutually exclusive route registration at `buildApp`; config contract (§5.1.1) enforced in `loadConfig` with named-key errors and no random secret on `real`. B6 proves it, including config-contract RED mutations. ✔

## Test-plan / F5 note

F5 note present and correct (back-to-back `test:integration` data setup can hit 429 per IP; wait ~1 min; recount login count when adding tests). Virtual-clock mandate for all expiry/refresh tests (no `sleep`), `beforeEach` reset, deterministic TOTP for e2e, no async `page.waitForFunction`. ✔
