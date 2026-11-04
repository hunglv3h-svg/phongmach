# Code Review — T-IDP real staff authentication (branch `t-idp-design`)

Replaces `DEMO_AUTH=1` with real staff auth per the approved Option-B design: an embedded `identity` module behind an OIDC-ready `StaffClaim` boundary, password (Argon2id) + mandatory TOTP for owner/doctor with a forced-enrollment gate, a 15-minute access token plus a rotating single-use 7-day refresh backed by a SQLite session store with atomic consume, sid-revocation on every route, owner-only staff admin, a select-tenant flow for multi-clinic staff, and a no-default `AUTH_MODE` enum gating mutually-exclusive demo/real route sets. The three safety invariants (tenant-from-signed-JWT, audit-before-data fail-closed with no PII including the pre-session login branch, BFF-only Medplum access) are each held and re-proven by a mutation test recorded RED on removal.

Watch for:
- Nothing blocking. Implementation matches design §1–§11 and the 6 LOW/NIT notes from the approved design review are all addressed (confirmed). All of B0–B7 are present in the correct package with RED proofs recorded. (confirmed)

**Verdict**: APPROVED

## High-level view

Design fidelity is high. The embedded identity module (`services/bff/src/identity/*`) emits a `StaffClaim` (`{ sub, name, role, tenants[] }`) that is exactly the OIDC-ready boundary the design calls for; nothing in the route layer reads tenant from a request, and staff identity never enters Medplum. The two-token model lives in `session.ts` (access `typ:'access'` signed with the access key; mfa/pretenant tokens `typ:'mfa'`/`'pretenant'` signed with the separate `REFRESH_SECRET`), and `verify()` rejects any non-`access` `typ` and checks sid-revocation on every route including reads. The SQLite session store (`sessionStore.ts`) does single-use refresh consume via `UPDATE … WHERE refresh_hash=? AND revoked=0` with a rowcount check plus a `consumed_refresh` replay table that revokes the sid on reuse — the F11 non-atomic trap is explicitly avoided.

The demo/real split is fail-closed-by-default: `AUTH_MODE` is a `z.enum` with no default, so a missing or unknown mode throws in `loadConfig` before `listen`. Real mode requires `SESSION_SECRET`/`REFRESH_SECRET`/`TOTP_ENC_KEY`/`SESSION_STORE_URL` to be present and valid with no random-secret generation, and requires `REFRESH_SECRET ≠ SESSION_SECRET`. Route registration is mutually exclusive at `buildApp` (`if (deps.mode === 'demo') registerDemoAuth else registerRealAuth`), so no demo endpoint exists in real mode.

The three invariants are preserved. Tenant flows only from `req.session!.tenant` (set by `verify`); the select-tenant flow only chooses within the signed `allow` list. Audit on the login/denied branch goes through `recordLogin()`, which builds the entry from explicit fields and never touches `req.session`, carries no `loginId`/password/OTP, and is awaited before any 401/token is returned. Web keeps zero `@medplum/*` imports, enforced by a static-grep test.

The offline key model is deliberately untouched (`local/store.ts`, `local/crypto.ts`, and the service worker are not in the diff) — the key stays machine-local per `(tenant,userId)` and is not password-derived, so offline unlock never needs the network, exactly as §6 requires. Traps are honored: no `window.print()`, SW unchanged (still not caching `/api`), timer tests use injected virtual clocks, and the three new dependencies are pinned to exact versions.

<details>
<summary>Issues (0 blocking)</summary>

No blocking findings. No non-blocking findings worth an action item beyond what the design review already captured as closed NITs.

</details>

<details>
<summary>Details</summary>

## Design fidelity: Option B embedded identity with OIDC-ready claim

`identity/index.ts` defines `StaffClaim = { sub, name, role, tenants[], practitionerId? }` and documents it as the claim a real OIDC IdP would emit at M1, with the route layer unchanged. The module is embedded in the BFF (not a separate service), matching §2.3's recommendation. `authenticate()` returns a password-stage result with `mfa: 'none' | 'verify' | 'enroll'`; MFA is mandatory for `owner`/`doctor` (`MFA_REQUIRED_ROLES`) with a forced-enrollment gate — an owner/doctor without TOTP gets `mfa:'enroll'` and the enroll `mfaToken` cannot reach a data route until a code is verified. Assistant MFA is optional (`none` when no TOTP enrolled, but `verify` if they have enrolled one — correct). SMS-OTP and trusted-device remain labeled-simulated connectors (`connectors.ts` `SimulatedSmsOtp.simulated = true`); TOTP is real. (confirmed)

Account-existence is not leaked: a wrong `loginId` and a wrong password both return `{ kind: 'invalid' }` and both increment the rate limiter. (confirmed)

## Session lifecycle: two tokens, atomic single-use refresh, sid revocation everywhere

`session.ts` signs access tokens with the access key and mfa/pretenant tokens with a separate `REFRESH_SECRET`; `verify()` accepts only `typ:'access'`, so an mfa or pretenant token presented as a bearer is rejected (401) — this is the primary B2b/B4 gate, with key-separation as defense in depth. `verify()` checks sid-revocation through the injected `SidRevocationCheck` for every route (reads included), and a token lacking a `sid` is accepted only when no revocation store is configured (the demo path); in real mode the store is always present, so a sid-less token is rejected. (confirmed)

`sessionStore.ts` consume: it first checks `consumed_refresh` (replay → revoke sid, return `replay`), then does the compare-and-set `UPDATE … WHERE sid=? AND refresh_hash=? AND revoked=0` and treats `changes !== 1` as a lost race → revoke sid → `replay`. `node:sqlite` is synchronous so each consume runs to completion; the UNIQUE constraint plus the rowcount check give exactly-one-winner semantics. This is the design's §3.2/MEDIUM-2 requirement and avoids the F11 non-atomic-write class. (confirmed)

Refresh route rebuilds identity/tenant from the stored sid (`sessionInfo` + `identity.get`), never from the request, and rotates the cookie. Logout revokes the sid; `DELETE /api/sessions/:sid` is owner-only. (confirmed)

## Demo/real separation and config contract

`AUTH_MODE` is `z.enum(['real','demo'])` with no default; `loadConfig({})` throws, and an unknown value throws. In real mode `loadConfig` collects missing required keys and throws naming them, forbids `SESSION_SECRET === REFRESH_SECRET`, and does not generate random secrets (random generation only happens in demo). `server.ts` lets `loadConfig` throw before `app.listen`, keeps the localhost bind guard for demo, and warns (not silently boots) when real mode loads zero staff — the non-blocking `staff-file-not-required-real` note from design-review round 2. Route sets are mutually exclusive at `buildApp`. (confirmed)

## Invariant 1 — tenant only from the signed JWT

Every data route derives the store from `req.session!.tenant`; `store: (req) => deps.stores(req.session!.tenant)`. The select-tenant handler enforces `ticket.allow.includes(body.tenant)` and 403s otherwise, with `allow` coming from the signed pretenant token. Re-proven by B2 (unit `real-auth.test.ts`: `?tenant=b`/`x-tenant:b` ignored, store only asked for `a`) and the integration B2 (two real Medplum tenants, docB cannot read docA's patient even when stuffing `tenant=a`), plus B2b (pretenant token → 401 on data route; `tenant ∉ allow` → 403). verification.md records the mutation (read tenant from `req.query.tenant`) RED across demo and real. (confirmed)

## Invariant 2 — audit before data, fail-closed, no PII, including the pre-session branch

`recordLogin()` builds the entry from explicit fields and never reads `req.session`; the denied branch carries only `outcome` + `requestId` + `ts` (no `userId`/`tenant`/`loginId`). `AuditEntry.userId`/`tenant` are optional only to accommodate this, and the data-path `record()` throws if a session is absent, keeping the compile-is-not-enough runtime assertion (NIT-1). `recent()` filters by `tenant === tenant`, so undefined-tenant login entries never surface in any clinic's audit view. The Fastify logger strips query strings, redacts `authorization`/`cookie`, and does not serialize request bodies; the error handler does not echo body values on a ZodError. B3 proves: sink throwing on `login/denied` → 500 (not 401); denied entry has no `loginId`/password; and the captured log contains no password/loginId even on a 400. verification.md records the mutations (swallow the await; add `loginId` to the entry) RED. (confirmed)

## Invariant 3 — BFF-only Medplum, web zero `@medplum/*`

`no-medplum-import.test.ts` walks `apps/clinic-web/src` and asserts no `from '@medplum/'`, dynamic `import('@medplum/')`, or `require('@medplum/')`. verification.md records adding an `@medplum/fhirtypes` import to `format.ts` → RED. `api.ts` imports only types from workspace packages and calls `/api/...` only. (confirmed)

## Mutation-test completeness (B0–B7)

All eight gates are present in the specified package with a recorded RED proof: B0 web static-grep (unit, web); B1 missing-session (unit, `real-auth.test.ts`); B2 tenant-from-session (unit + integration); B2b pretenant/allow (unit); B3 login audit fail-closed + no-PII (unit); B4 forced-enrollment TOTP (unit); B5 revocation on reads + atomic single-use refresh incl. parallel-replay (unit `identity.test.ts` + `real-auth.test.ts`, virtual clock); B6 config contract + route exclusivity (unit `config.test.ts` + `real-auth.test.ts`); B7 signer-identity-at-create-time (integration `real-auth.test.ts` on real Medplum, two same-tenant doctors + a pre-cutover userId). The B7 mechanism (`enc.participant?.[0]?.individual?.identifier?.value !== cmd.doctor.userId` in `medplum.ts completeVisit`) is confirmed present. verification.md's §3 table records a RED proof for each. (confirmed)

## Trap honoring

No `window.print()` anywhere in the web `.tsx` changes (printing still goes through the existing `printHtml` path, unchanged). The service worker and `vite.config.ts` are not in the diff, so `/api` is still not cached. Timer-sensitive tests (access expiry, refresh, rate limit, TOTP window) all use an injected `now()`/numeric clock, never `sleep`. The three new dependencies are pinned exactly: `@fastify/cookie@11.1.3`, `@node-rs/argon2@2.2.2`, `otpauth@9.5.2`, with Argon2id at OWASP params (19 MiB / t=2 / p=1). Login/denied audit entries carry no PII. (confirmed)

## Offline key model unchanged (design §6)

`local/store.ts`, `local/crypto.ts`, and the service worker are untouched, so the AES-GCM key remains machine-local per `(tenant,userId)` and is not password-derived — offline unlock requires no network, as §6 requires. App.tsx wires logout to `api.logout` (server sid revocation) while keeping the store when pending items exist, matching OFF-6. (confirmed)

</details>

<details>
<summary>File map</summary>

- `services/bff/src/session.ts` — two-token model, `verify` (typ + sid-revocation on every route), mfa/pretenant tickets.
- `services/bff/src/sessionStore.ts` (new) — SQLite session store, atomic single-use refresh consume + replay→revoke.
- `services/bff/src/identity/*` (new) — `index.ts` (IdentityStore + StaffClaim + forced-enrollment), `crypto.ts` (Argon2id + AES-256-GCM TOTP secret), `totp.ts`, `rateLimit.ts`, `connectors.ts` (simulated SMS-OTP), `types.ts`.
- `services/bff/src/app.ts` — real vs demo route sets (mutually exclusive), `recordLogin()`, requireSession via verify on every route, owner staff admin, select-tenant.
- `services/bff/src/audit.ts` — optional userId/tenant for login; data-path assertion.
- `services/bff/src/config.ts` + `server.ts` — `AUTH_MODE` no-default, real-mode config contract, throw-before-listen, staff-count warning.
- `apps/clinic-web/src/{api.ts,components/Login.tsx,components/DemoBanner.tsx,components/Scope.tsx,App.tsx}` — multi-step real login, mode-aware banner, scope line moved to REAL + SMS-OTP labeled SIMULATED, logout revokes server session.
- `services/bff/test/unit/{real-auth,identity,config}.test.ts`, `test/unit/real-helpers.ts`, `test/integration/real-auth.test.ts`, `apps/clinic-web/src/no-medplum-import.test.ts` — B0–B7.
- `services/bff/package.json` + `pnpm-lock.yaml` — pinned new deps.

Full diff: `git -C .worktrees/t-idp-design diff main` (plus untracked `identity/`, `sessionStore.ts`, new test files).

</details>
