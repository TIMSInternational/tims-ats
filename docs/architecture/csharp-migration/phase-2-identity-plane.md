# Phase 2 — Identity / Auth Plane in C#

Date: 2026-07-15 · Status: **Detailed, ready** (starts after Phase 1 gate G1).
Parent: `00-master-plan.md` · Architecture: `../2026-07-15-csharp-backend-target-architecture.md` §3–§4.

## Objective

Build the C# authentication + authorization + tenant plane that **every future domain depends on**, as
internal infrastructure with **no product traffic**. It must resolve exactly the same principals, tenant
context, permissions, and scopes as the current TS stack — proven by the Phase-1 golden fixtures plus new
auth-specific fixtures/integration tests.

**Exit gate G2 (all green):**
1. A valid Supabase JWT is accepted (JWKS, exp/iss/aud verified); an invalid/expired/wrong-aud one is
   rejected (fail-closed).
2. A `tims_` API key authenticates via the ported `resolveApiKeyPrincipal` (SHA-256, scopes, org-scoped,
   suspended-org lockout); scope narrowing incl. `alwaysEnforceScope` matches the 1.6 fixtures.
3. All four principal types resolve into `ITenantContext`: platform-owner, org-user, candidate,
   external-API-key. Impersonation yields the TARGET's org+roles + `impersonatedBy`.
4. The endpoint guards (`RequirePermission`, `RequireOrgScope`, `AssertScoped`, identity-anchored) compose
   and enforce identically to the tRPC procedures — verified against the access fixtures.
5. Rate limiting runs on the **same Redis, same keys** as TS (cross-stack limits are shared).
6. Every auth invariant (architecture §11) has a golden fixture or Testcontainers integration test.

## Work packages

Build via SDD; the whole plane gets a Codex adversarial pass (auth is the highest-value attack surface).

### WP2.1 — Supabase JWT authentication
**Deliverable:** ASP.NET Core `AddAuthentication().AddJwtBearer(...)` configured against Supabase's JWKS +
issuer; `TokenValidationParameters` **must** validate issuer, audience, lifetime, and signing key (the
banned-pattern list forbids skipping exp/iss/aud). Clock-skew minimal. Produces a `ClaimsPrincipal` carrying
the Supabase user id.
**Acceptance:** valid token → authenticated; tampered signature, expired, wrong `aud`, wrong `iss` → 401.
Integration test with a locally-minted token against a test JWKS.

### WP2.2 — Principal resolution → `ITenantContext`
**Deliverable:** middleware that turns an authenticated identity into the TIMS principal + tenant context.
From the Supabase user id → look up the TIMS `User` (org, roles via slug, `isPlatformOwner`) → build:
```csharp
ITenantContext {
  PrincipalType,               // PlatformOwner | OrgUser | Candidate | ExternalApiKey
  OrganizationId,              // drives the RLS GUC (Phase 1) + every WHERE org filter
  UserId,                      // audit actor + identity-anchored filters
  Roles[],
  ImpersonatedBy?,             // set only on impersonation
  ApiKeyScopes?                // set only for ExternalApiKey
}
```
- Selects the DbContext profile (tenant vs privileged) from `PrincipalType` (Phase 1 §WP1.4).
- **Candidate** principals (portal) resolve to their own bounded context — candidate vs staff auth boundary
  is a §11 invariant; candidates never resolve staff roles.
**Acceptance:** each principal type resolves correctly; a user with no TIMS `User` row fails closed; the
resolved context drives the correct DbContext profile (owner never gets `app_tenant`, tenant never gets
privileged).

### WP2.3 — External API-key authentication (port of the 1.6 surface)
**Deliverable:** a second `AuthenticationScheme` handling `Authorization: Bearer tims_...`:
- `hashApiKey` (SHA-256 hex) + active-key lookup (not revoked, not expired) + **suspended-org lockout** (an
  inactive/deleted org's keys stop immediately) — ported from `resolveApiKeyPrincipal`.
- `externalScopeSatisfied(requiredScope, scopes, alwaysEnforceScope)` ported verbatim (the 1.6 fix: empty
  scopes = wildcard for reads, but writes pass `alwaysEnforceScope=true` so an empty-scope key can't reach
  them). Golden fixtures from 1.6.
- Fail-closed on malformed scopes.
**Acceptance:** valid key → `ExternalApiKey` principal with org + scopes; revoked/expired/suspended-org → 401;
the `validation:write` unconditional-scope behavior matches the 1.6 fixtures exactly.

### WP2.4 — Impersonation
**Deliverable:** platform-owner-only impersonation producing a tenant context with the **target's** org +
roles and `ImpersonatedBy = ownerUserId`, `isPlatformOwner = false` (so the impersonated session takes the
DB-checked permission path with the target's grants — mirrors the current `route.ts:150` behavior). Audit
records the real actor.
**Acceptance:** an owner can impersonate; the impersonated context resolves the target's permissions (not
owner bypass); audit shows `impersonatedBy`; a non-owner cannot impersonate.

### WP2.5 — Endpoint-guard composition (the tRPC-procedure equivalents)
**Deliverable:** authorization filters/policies that compose like the tRPC procedures, each consulting
`Tims.Domain.Access` (Phase 1) over the DB grants:
- `RequirePermission("module","action")` → `permissionProcedure`. Injects `AccessDecision { scope, anchors }`.
- `RequireOrgScope` → asserts `scope ∈ {organization, company}` else FORBIDDEN (the 1.7 org-rollup gate).
- `AssertScoped(entity, id)` → resolves the entity anchor + does the `id + org + anchor` IDOR check.
- Identity-anchored self-service → `[Authenticated]` (any in-org user) + a hard `subjectUserId/raterUserId ==
  ctx.UserId` filter in the query (NOT scope-aware) — the 1.7 pattern, preserved exactly.
- Permission cache-aside on the **same Redis keys** (`tims:perm:{org}:{roles}:{module}:{action}`, 5-min), so
  a grant change invalidated by either stack is seen by both.
**Acceptance:** each guard's allow/deny matches the access fixtures across all roles/scopes; the
identity-anchored guard rejects a cross-user id even for an org-scoped caller (the exact bug class caught in
1.7); org-rollup endpoints FORBIDDEN for sub-org scopes.

### WP2.6 — Rate limiting (shared with TS)
**Deliverable:** Redis-backed sliding-window limiter keyed identically to the TS tiers (per-IP, per-user,
per-org, per-API-key), so limits are shared across both backends during coexistence.
**Acceptance:** a key/user/org hitting its limit is throttled the same way from either stack; fail-open to
in-memory only in local dev (never prod), matching existing behavior.

### WP2.7 — Audit plane
**Deliverable:** `logDataAccess` ported as a cross-cutting behavior (MediatR pipeline behavior or an EF
interceptor): single `data_access_log` writer, **fail-closed on restricted reads, fail-soft after writes**
(the 1.6/1.7 policy), actor = `UserId` or `ApiKeyId`, records `ImpersonatedBy`.
**Acceptance:** a restricted read that can't audit fails closed; a write whose audit fails still commits; the
actor + impersonator are recorded.

## Execution order

```txt
WP2.1 JWT ─► WP2.2 principal/context ─► WP2.5 guards ─► G2
WP2.3 API-key (parallel to 2.2, own scheme) ──────────┤
WP2.4 impersonation (after 2.2) ──────────────────────┤
WP2.6 rate-limit · WP2.7 audit (parallel) ────────────┘
```

## What Phase 2 deliberately does NOT do
- No business/domain logic (that's Phase 3+).
- No product traffic — this plane is exercised only by tests until Phase 3's HRIS becomes the first consumer.
- No new tables owned by EF except any auth-support tables that are genuinely C#-greenfield (API keys already
  exist and are Prisma-owned during coexistence — read via EF, write via the owning stack per the ledger).

## Dependencies & open inputs
- **Requires Phase 1 G1** (the RLS plumbing + the access kernel + fixtures).
- Needs the exact Supabase JWKS/issuer/audience values (config, not a blocker to plan).
- Confirm whether API-key writes remain Prisma-owned or move to EF during Phase 2 (ledger decision) — default:
  stay Prisma-owned until Phase 5 touches the integration domain.
