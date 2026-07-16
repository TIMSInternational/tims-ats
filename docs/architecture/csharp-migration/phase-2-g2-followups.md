# Phase 2 (G2) — deferred follow-ups & deploy-verifies

Date: 2026-07-16 · Status: recorded at G2 (Slice 4). These are DELIBERATELY deferred — the Phase-2 identity/auth
plane has **no product traffic**, so none block G2. Each has a documented invariant + a home phase.

## Phase-3 follow-ups (close before the relevant surface serves traffic)
- **Scoped-probe registry coverage** — WP2.5b registers probe maps for the representative 6 entities
  (vacancy, candidate, application, interview, okr, team); the other 15 scoped entities have their scope LOGIC
  golden-fixtured but throw `InvalidOperationException` (fail-closed) from `AssertScopedAsync` until their probe map
  is registered. Register each as its domain ports in Phase 3+.
- **Rate-limit principal wiring** — `PrincipalResolutionMiddleware` currently resolves the principal a second time
  for the authz endpoints via fallback; consolidate to a single resolve consumed by both the limiter and handlers.
  Also: the live limiter is applied to product endpoints by denylist (infra/probe paths exempt) — verify each real
  product endpoint is limited as it ports. Candidate/portal AI-per-org keying needs the portal org (not in the JWT).
- **Candidate portal caller** — when the C# candidate-portal endpoint is built, the caller must resolve org-from-slug
  with the org-active/deleted guard (the resolver already enforces org `is_active AND deleted_at IS NULL`).
- **Impersonation mint/clear endpoints** — the cookie MINT/CLEAR route guards (owner re-verify,
  `cannot_impersonate_owner`, `inactive_user`, target-org audit) port when that endpoint lands (resolution side is done).
- **createApiKey scopes bound** (max 20) — when the key-creation mutation ports.
- **Membership-write escalation** — wire `SubjectInScope`/`SelfServiceGuard` onto the ninebox/unit-assignment
  mutations in Phase 3 (self-add-to-committee / self-assign-to-unit).

## Security follow-ups (owner action — prod migration)
- **`data_access_logs` insert-only** — the C# audit writer only appends, but the live migration still GRANTs
  `UPDATE, DELETE` on `data_access_logs` to `app_tenant` (RLS only constrains tenant ownership). Revoke `UPDATE, DELETE`
  + add an insert-only policy/trigger so a tenant-role bug/SQLi can't alter/erase same-org audit rows. **Federico
  (prod DB).**
- **TS candidate-portal org lookup** — TS `resolveOrg` checks `organizations.isActive` but not `deletedAt`; the C#
  candidate resolver is stricter (both). Add the `deletedAt` guard to the TS portal for parity (TS product follow-up).

## 🔴 Deploy-verify (confirm at first deploy — not blockers, no traffic today)
- Supabase must sign end-user JWTs **asymmetrically (JWKS)**, not legacy HS256 (WP2.1).
- Rate-limit **shared buckets** against the REAL Upstash instance (identical Lua + keys already proven locally).
- Redis-backed **permission cache** + **audit writer** exercised under the real Redis + RLS.
