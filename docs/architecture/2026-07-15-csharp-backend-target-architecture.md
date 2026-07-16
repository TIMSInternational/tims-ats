# TIMS ATS — Full C# Backend: Target Architecture & Migration Design

Date: 2026-07-15
Status: **Authoritative.** Supersedes the strategy framing in
`2026-07-15-react-frontend-csharp-backend-transition.md` (kept for history). That draft got the *shape*
right (React stays, strangler not big-bang, security invariants non-negotiable, GitHub SoT, OpenAPI, no
early DB-split). This document commits to the decision the draft hedged — **the TIMS backend converges fully
onto C#/.NET** — and specifies *how* to do it without losing the hard-won multi-tenant / RLS / RBAC /
k-anonymity guarantees.

---

## 0. The decision, stated plainly

- **Frontend:** Next.js/React, on Vercel. Unchanged. Not Blazor.
- **Backend:** converges **fully** to C#/.NET. End state: no tRPC, no Prisma, `packages/api` and
  `packages/db` retired.
- **AI/inference:** stays a **separate polyglot service** (`services/ai-gateway`, TS/Python), called by C#
  over HTTP. This is a *deliberate bounded context*, not an exception — see §7. "Full C# backend" means all
  **transactional/enterprise domain** logic is C#; inference orchestration is infrastructure, like the DB.
- **Path:** greenfield/new-value C# first, working-domain rewrites last, every step gated by shared
  golden-fixture parity. Full convergence is the destination; the sequence means we never rewrite working
  code until the C# stack is battle-proven.

## 1. What changed from the transition draft (and why)

| # | Draft said | This doc says | Why it matters |
|---|---|---|---|
| 1 | "Preserve tenant isolation" (listed as an invariant) | **RLS stays in Postgres, unchanged, and protects the C# backend for free.** It is not "migrated." | The RLS policy layer is ORM-agnostic — it guards *any* client. Biggest single de-risker: the security backbone doesn't move. §3. |
| 2 | Auth/RBAC drift → "add parity tests" | **One runtime data source (the DB grant tables) + a shared golden-fixture behavior spec run in BOTH CIs.** Canonical logic converges to C#. | Parity-tests-as-afterthought catch drift *after* it ships. A shared fixture suite makes drift a red build. §4. |
| 3 | First pilot = rewrite **compensation** | **First real C# domain = HRIS (Sprint 1.8), greenfield.** Compensation becomes a *throwaway* parity spike only. | Rewriting working code as the pilot = pure risk, zero new value. Prove C# on greenfield first. §9 Phase 3. |
| 4 | Hosting = App Service / Container Apps / App Runner (menu) | **Co-locate C# with the DB region (hard constraint).** AWS-default vs Azure is an explicit org cloud-strategy decision. | Cross-region compute↔DB latency was a real prod problem (#100 pinned Vercel to `pdx1`). Non-negotiable. §8. |
| 5 | AI workflows → C# candidate | **AI orchestration stays out of C#.** | .NET's AI/agent/MCP ecosystem lags TS badly; the whole Phase-2 roadmap is AI-heavy. §7. |
| 6 | Two ORMs, "table ownership" | Same, **plus:** one hand-applied SQL migration path, RLS-block-per-new-table baked into EF migration convention, a table-ownership ledger enforced in CI. | Two auto-migrators on one prod DB is how you lose data. Extends the existing "generate-then-hand-apply" reality. §5. |
| 7 | Team Suite: wrap/extract/rebuild | Same, **plus the top security gate:** adopt Team Suite Business/Common; **re-home its DataAccess onto TIMS's tenant-isolated infra; never import its tenant model.** | Team Suite has its own company/tenant model. Importing it verbatim = a cross-tenant breach. §10. |
| 8 | tRPC BFF "gets thinner" | **BFF holds zero business logic and is explicitly slated for deletion.** Frontend calls a generated OpenAPI client directly per migrated domain. | A BFF that accretes logic becomes a third backend. §6. |

## 2. Target architecture (end state)

```txt
tims-ats/                         # single GitHub monorepo, one source of truth
  apps/
    web/                          # Next.js/React (Vercel). Calls the generated C# API client.
  packages/
    ui/  auth/  i18n/             # frontend-side, retained
    api-client/                   # GENERATED typed TS client from the C# OpenAPI (replaces tRPC inference)
    shared/                       # frontend-safe constants/types (shrinks; server types move to C#)
    # packages/api (tRPC)  -> DELETED at end state
    # packages/db (Prisma) -> DELETED at end state
  services/
    Tims.Platform/                # the C# backend
      Tims.Platform.sln
      src/
        Tims.Api/                 # ASP.NET Core (minimal APIs), auth + tenant middleware, OpenAPI
        Tims.Application/         # use cases (commands/queries), cross-cutting pipeline behaviors
        Tims.Domain/              # entities, value objects (Money…), the Access kernel, k-anon, policies
        Tims.Infrastructure/      # EF Core + Npgsql (RLS plumbing), Redis, SES, AI-gateway client
        Tims.Workers/             # IHostedService / scheduler (Quartz or cloud-native)
      tests/
        Tims.UnitTests/           # domain + access-kernel golden fixtures
        Tims.IntegrationTests/    # Testcontainers-Postgres WITH the real RLS policies applied
    ai-gateway/                   # polyglot inference service (TS/Python) — NOT migrated. §7
  contracts/
    openapi/                      # versioned C# API contract; source for packages/api-client + contract tests
    access-fixtures/              # SHARED golden fixtures (JSON) run by BOTH C# and TS CI. §4
  docs/architecture|audits|plans/
```

Request flow, by era:

```txt
Now:          Next.js UI → tRPC → Prisma → Postgres
Coexistence:  Next.js UI → { generated C# client (migrated domains)          → C# API → Postgres
                             tRPC BFF (un-migrated) → Prisma                  → Postgres }
End state:    Next.js UI → generated C# client / Next route handlers → C# API → Postgres
                                                        C# API → ai-gateway (inference)
```

The C# layering (`Api → Application → Infrastructure`, with a pure `Domain`) is a deliberate 1:1 with the
current `router → service → repository` discipline, so the team's mental model transfers unchanged.

---

## 3. Tenant isolation — the backbone that does NOT move

Current mechanism (keep every word of it in the DB):
- `20260604100000_enable_rls_tenant_isolation`: `ENABLE` + `FORCE ROW LEVEL SECURITY` + fail-closed
  `tenant_isolation` policy on 81 tables, predicate
  `organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid`.
- Runtime: every tenant op runs in a transaction that does `SET LOCAL ROLE app_tenant` +
  `set_config('app.current_org_id', <org>, true)`. `app_tenant` is `NOLOGIN`/`NOBYPASSRLS`. Platform owners
  run on a privileged role/connection. Gated by `RLS_ENFORCED=true`.

**These SQL policies are ORM-agnostic. They already protect any client — Prisma, EF Core, psql, a rogue
query. The C# backend inherits this protection unchanged, provided it connects as `app_tenant` and sets the
GUC.** So the single most valuable security asset is *preserved, not rewritten*.

What C# must reproduce is only the **per-request GUC + role plumbing.** Design:

- **`ITenantContext`** (scoped): `{ OrganizationId, UserId, Roles[], PrincipalType, ImpersonatedBy? }`,
  populated by auth/tenant middleware (§4) from the validated JWT/API-key.
- **Two Npgsql data sources / DbContext profiles**, selected by principal:
  - *Tenant profile* → login role that immediately assumes `app_tenant`; used for every org-user / candidate
    / external-key request.
  - *Privileged profile* → the owner role (BYPASSRLS-capable), used ONLY for resolved platform-owner
    requests. A tenant request must never touch this. (Mirrors the current `tenantDb` vs `db` split.)
- **GUC/role set via a per-request ambient transaction + `SET LOCAL`**, issued by a
  `DbConnectionInterceptor`/unit-of-work wrapper right after `BEGIN`:
  ```csharp
  // Infrastructure: TenantConnectionInterceptor (pseudocode)
  public override async ValueTask<InterceptionResult> TransactionStartingAsync(...) {
      // inside the just-opened transaction, before any query:
      await cmd.ExecuteAsync("SET LOCAL ROLE app_tenant");
      await cmd.ExecuteAsync("SELECT set_config('app.current_org_id', @org, true)", tenant.OrganizationId);
  }
  ```
  Fail-closed: if `ITenantContext` has no org (unauth/misconfig), the GUC is empty string → the policy's
  `NULLIF(..., '')::uuid` is NULL → **every row is hidden**. Identical property to today.

- **This is FORCED by connection pooling, not just cleanest.** Prod uses Supavisor **transaction-mode**
  pooling (port 6543). Under transaction pooling, session-level `SET ROLE` / `set_config(..., false)` **leak
  onto the next borrower** of the physical connection — a cross-tenant catastrophe. `SET LOCAL` is
  transaction-scoped and released with the txn, so it is the *only* pooling-safe option. Runtime → Supavisor
  6543; DDL/migrations → direct 5432. (This constraint alone validates the design.)

- **Phase-1 spike (make-or-break):** a Testcontainers integration test that (a) applies the real RLS
  policies, (b) creates two orgs, (c) proves org-A's context cannot read org-B's rows, (d) proves an unset
  GUC returns zero rows. If EF + the interceptor can't pass this in week 1, the plan is wrong — and you learn
  it cheap. The C# side tests RLS **for real via Testcontainers**, going *further* than the current TS suite
  (which mocks the DB).

**Defense-in-depth is retained:** application-level `WHERE organization_id = ctx.OrganizationId` on every
query stays (primary layer); RLS is the backstop; IDOR checks (`id + organizationId`) on every id-taking
query remain mandatory (§4).

---

## 4. The authorization kernel — one data source, one behavior spec, no drift

Today: 9 roles × `module:action:scope`; the `MATRIX` seeds `role_permissions` (+ a global `permissions`
catalog) per-org; `buildAccessForUser(user, module, action)` reads those rows → `resolveAccess` →
`{ allowed, scope }`; plus `requireOrgScope`, `assertScoped`, `scopeWhereFor` (entity anchors), and
k-anonymity (`suppressBelowMin5`, and the 360 `MIN_360_BUCKET_SIZE=3`). Scope lattice:
`own < team < unit < company < organization`.

**Anti-drift design (the core idea):**
1. **Runtime data source = the DB grant tables**, read identically by both stacks during coexistence. The
   `MATRIX` is only a *seeder*; runtime truth is `role_permissions`. No duplication of grant *data*.
2. **Behavior is pinned by SHARED golden fixtures** in `contracts/access-fixtures/*.json`:
   `{ principal(roles, org, isPlatformOwner, apiKeyScopes?), module, action, dataShape } → { allowed, scope,
   suppressed? }`. **Both the TS suite and the C# `Tims.UnitTests` load and assert the same fixtures.** Drift
   = a red build in one language. This is the enforcement, not a hope.
3. **Canonical logic converges to `Tims.Domain.Access`** (pure, no infra deps): the scope lattice,
   `ResolveAccess`, `RequireOrgScope`, the entity-anchor policies (the `scopeWhereFor` equivalents →
   translated to EF `IQueryable` predicates), and k-anon (`SuppressBelowMin(n)` with the platform-5 and
   360-3 thresholds). The seeder (`MATRIX`) moves to an EF Core data seed once C# owns the access tables;
   until then C# reads the TS-seeded rows.
4. **Permission-caching parity:** the current 5-min cache-aside (`tims:perm:{org}:{roles}:{module}:{action}`)
   → C# uses the **same Redis, same keys**, so a role-assignment write that invalidates from either stack is
   seen by both.

Ported endpoint-guard equivalents:
- `permissionProcedure(module, action)` → an ASP.NET Core **authorization policy / endpoint filter**
  `RequirePermission("module","action")` that runs the kernel and injects the `AccessDecision` (scope +
  anchors) into the request context.
- `requireOrgScope` → a filter asserting `scope ∈ {organization, company}` (FORBIDDEN otherwise) — the exact
  org-rollup gate from Sprint 1.7.
- `assertScoped(entity, id)` → an `IAccessGuard.AssertScopedAsync` that resolves the entity's anchor
  predicate and does the `findFirst(id + org + anchor)` IDOR check.
- **Identity-anchored** self-service (the 1.7 pattern) → these endpoints authenticate via `protectedProcedure`
  equivalent (any authenticated in-org user) and hard-filter `subjectUserId/raterUserId == ctx.UserId` — NOT
  scope-aware. Preserve this distinction exactly.

---

## 5. The two-ORM coexistence — operating two DDL owners on one prod DB safely

- **Table-ownership ledger** (`docs/architecture/table-ownership.md`, CI-enforced): every table → `{ owner:
  prisma | efcore, migratedOn? }`. A PR that mutates a table it doesn't own fails CI.
- **One hand-applied SQL path for ALL DDL.** Prod is already *not* auto-migrated (Prisma migrations are
  generated then applied via psql). Extend, don't invent: EF migrations are authored with `dotnet ef
  migrations add`, rendered with `dotnet ef migrations script`, **reviewed as SQL, applied via psql** — never
  `dotnet ef database update` against prod. Neither tool auto-syncs prod. This is the existing discipline,
  now covering both tools.
- **RLS-per-new-table is a convention, not a memory test.** Every EF migration that `CREATE TABLE`s an
  org-scoped table must include the `ENABLE + FORCE + tenant_isolation` block (a reusable
  `migrationBuilder.EnableTenantRls("table")` helper). This encodes the lesson that burned the FIT engine and
  that Sprints 1.6/1.7 got right: **RLS is not automatic.**
- **No dual writes.** A table has exactly one *writer* service. Cross-domain writes go through the owner's
  API (or an outbox/event once justified) — never a second service writing another domain's tables.
  Cross-domain *reads* use SQL views / read models.
- **Enums:** the Postgres enum is the truth. Map with Npgsql `MapEnum<T>()` (values must match exactly), or
  the existing string+CHECK pattern where TIMS already uses it.
- **Schema onboarding per domain:** `dotnet ef dbcontext scaffold` the owned tables as a starting point, then
  hand-refine to a clean domain model; global `UseSnakeCaseNamingConvention()` (EFCore.NamingConventions) so
  columns map to the existing snake_case without per-property attributes.

---

## 6. The frontend contract — recovering most of what tRPC gave

Leaving tRPC costs end-to-end inference. Recover it:
- **OpenAPI-first.** `Tims.Api` emits a versioned OpenAPI doc (built-in .NET 9 OpenAPI or Swashbuckle) into
  `contracts/openapi/`.
- **Generate the typed TS client** (`openapi-typescript` + `openapi-fetch`, or Kiota/orval) into
  `packages/api-client`. The frontend imports typed functions — ~90% of tRPC's DX, fully typed request/
  response.
- **Coexistence proxying, minimized.** The tRPC BFF forwards to the C# client for un-migrated cross-cutting
  needs and SSR auth-cookie→bearer translation. **For a migrated domain, the frontend calls the generated C#
  client directly** (bypassing the BFF), so the BFF only ever covers the shrinking un-migrated set. **BFF
  rule: zero business logic; scheduled for deletion.**
- **Validation:** Zod becomes *frontend UX validation only*; the **C# request models are the authoritative
  validators** (FluentValidation / DataAnnotations), encoded in the OpenAPI schema (bounds `.max()`, enums,
  uuid). Consumer-driven **contract tests** (frontend expectations) + provider verification (C# honors the
  spec) pin the boundary.
- **SSR/auth:** Next.js route handlers / server actions forward the Supabase session (cookie → `Authorization:
  Bearer`) to the C# API for server-rendered data.

---

## 7. The AI boundary — the one deliberate polyglot line

The entire Phase-2 roadmap (agent foundation, conversational core, 26 AI tools, MCP server, WhatsApp agent)
is inference-orchestration-heavy, and the TS/Python ecosystem (Vercel AI SDK, MCP tooling, streaming,
tool-calling) is *years* ahead of .NET. Forcing this into C# would kneecap the product's AI future.

**Correct bounded-context design:** AI inference is *infrastructure*, like Bedrock, Redis, or the DB — not a
"backend domain." `services/ai-gateway` (already a Docker microservice) stays TS/Python and remains the AI
orchestration home. **C# domain services own the business decisions and data; they *call* the AI gateway over
HTTP for inference** (a capability provider behind an interface, `IInferenceClient`, with the existing
circuit-breaker/fallback discipline). This is not backsliding on "full C# backend" — the transactional
enterprise backend is 100% C#; inference is a separately-deployed capability.

- **MCP server** may be C# (the .NET MCP SDK exists and is maturing) or stay TS — decide at Phase-2 time
  based on SDK maturity; either composes via the gateway.
- If you later want to override this and force AI into C#, that's a vetoable decision — but the honest call
  today is to keep the AI plane polyglot.

---

## 8. Deployment, data plane, observability

- **Frontend:** Vercel (unchanged).
- **C# API + workers:** containerized .NET (Linux), **co-located with the Postgres region** — hard latency
  constraint (cross-region compute↔DB was the #100 problem that pinned Vercel to `pdx1`/us-west-2). Current
  data plane is Supabase (us-west-2) + AWS (Bedrock/SES/ai-gateway); FormMaps already runs ECR→App
  Runner/Fargate. **Default = AWS ECS Fargate (or App Runner) in the DB region**, behind an ALB, TLS,
  no-cache API routes, CORS locked to the app origin (never `origin:*`). **Azure Container Apps in the DB
  region is acceptable IF the org standardizes on Azure** (Team Suite is Azure DevOps) — this is an explicit
  org cloud-strategy decision, not a toss-up, and it must still co-locate with the DB.
- **Connections:** runtime → Supavisor transaction pooler (6543, `SET LOCAL` only — §3); DDL → direct 5432.
- **Secrets/config:** `IOptions<T>` validated at startup (fail-fast, mirroring the Zod env gate); secrets in
  AWS Secrets Manager / Azure Key Vault. Never expose the Supabase `service_role` key.
- **Observability from day one:** OpenTelemetry (.NET first-class) → the existing OTel/Sentry backend;
  Serilog JSON logs (matching Pino); health/readiness endpoints; the `data_access_log` audit table with a
  single writer (a MediatR pipeline behavior or EF interceptor implementing `logDataAccess`, fail-closed on
  restricted reads / fail-soft after writes — the exact 1.6/1.7 policy).

---

## 9. Sequenced roadmap (reconciled with the product + AI roadmap)

**Phase 0 — Do not stall the product (parallel, now).** Keep shipping TS (Sprints 1.8/1.9) — but **stop
digging:** any *new* backend-heavy domain from here is evaluated for "build directly in C#" rather than
TS-then-migrate. AI layer excepted (stays TS).

**Phase 1 — Runway + the two make-or-break spikes.** `services/Tims.Platform` skeleton, CI (.NET build/test),
OpenAPI + health endpoint, config/logging conventions. **Then prove, before anything else:**
(a) **RLS-via-EF spike** — Testcontainers cross-tenant isolation + fail-closed (§3);
(b) **Access-kernel golden fixtures** — the shared fixture suite passing identically in C# and TS (§4).
Exit only when both pass. (This is the "fail fast on the riskiest assumption" gate.)

**Phase 2 — Identity/auth plane (internal, no product traffic).** Supabase JWT validation (JWKS, check
exp/iss/aud), the 4 principal types (platform-owner / org-user / candidate / external-API-key), the API-key
handler (port `resolveApiKeyPrincipal` + `externalScopeSatisfied` with golden fixtures), impersonation
(target org+roles + `impersonatedBy`), the tenant middleware → `ITenantContext`. Redis-backed rate limiting
on shared keys.

**Phase 3 — First REAL C# domain = HRIS (Sprint 1.8), greenfield.** Not a rewrite. Backend-heavy (sync/jobs/
retries — .NET hosted services shine), needs the worker infra anyway, natural Team-Suite affinity. Proves the
stack on new value at low risk. (A tiny read-only *compensation* slice is used only as a **throwaway parity
spike** in Phase 1 to validate the diff harness — not a committed migration.)

**Phase 4 — C# workers/jobs.** `Tims.Workers` (Quartz.NET/Hangfire or cloud-native EventBridge+SQS): FX
refresh, audit purge, HRIS sync, email/WhatsApp retry, report generation. Idempotent, retried, observable.
Clear .NET strength; moves long-running work off serverless request paths.

**Phase 5 — Strangle the working domains (only now, one at a time, golden-fixture-gated).** Suggested order
by least-cross-cutting/most-benefit: external-vendor API → billing/invoices → reporting/analytics → audit →
360 backend → candidate pipeline state machine → compensation. Per domain: characterization tests → C# impl →
shared golden parity → route (direct client or BFF) → verify prod → **delete the TS logic**. The *rule*
(one-at-a-time, parity-gated, delete-after) is fixed; the order is adjustable.

**Phase 6 — Team Suite.** Intake study (`docs/architecture/team-suite-integration-study.md`) → adopt
Business/Common into `Tims.Domain`/`Tims.Application`; **re-home DataAccess onto the tenant-isolated Postgres
+ EF + RLS**; **discard Web** (React is the UI). **Top security gate: never import Team Suite's tenant/company
model — map it to the TIMS org + RLS model, or it is a cross-tenant hole.** Wrap low-risk services (Option A)
short-term; extract high-value logic (Option B); rebuild messy/legacy (Option C).

**Phase 7 — Retire the TS backend + consolidate.** BFF → zero → deleted; tRPC removed; Prisma retired;
`packages/api` + `packages/db` deleted; frontend on the generated client + Next handlers. One identity, one
tenant, one audit, one authz kernel — all C#. `ai-gateway` remains (by design). Team Suite features live as
modules inside TIMS nav + permissions.

---

## 10. Risk register (delta from the draft's — the ones that actually threaten this)

| Risk | Severity | Mitigation |
|---|---|---|
| **EF can't reproduce the RLS GUC under transaction pooling** | Existential | Phase-1 Testcontainers spike; `SET LOCAL`-only design; fail-closed empty GUC. §3. |
| **Authz kernel drifts between stacks** | Critical | Shared golden fixtures in both CIs + one DB grant source + shared Redis cache. §4. |
| **Team Suite tenant model imported verbatim** | Critical (tenant breach) | Re-home all Team Suite DataAccess onto TIMS RLS/org model; discard its tenant model. §10/Phase 6. |
| **Two ORMs corrupt a shared table** | High | Ownership ledger (CI-enforced), single hand-applied SQL path, no dual writes. §5. |
| **Rewriting still-moving domain logic** | High | Greenfield/new-value first (HRIS); working domains last, characterization + parity gated. §9. |
| **Losing frontend type safety / DX** | Medium | OpenAPI-generated client + contract tests; C# request models authoritative. §6. |
| **AI roadmap kneecapped by C#** | Medium | AI stays a polyglot gateway called by C#. §7. |
| **Cross-region compute↔DB latency** | Medium | Co-locate C# with the DB region (hard constraint). §8. |

## 11. Non-negotiable invariants (no migrated endpoint ships without parity on these)

Tenant isolation (RLS + app-level filter) · role/scope enforcement (the kernel) · identity-anchored
self-service · sensitive-field projection (explicit select; SSN/salary/medical/DEI never over-returned) ·
restricted-read audit (fail-closed) / post-write audit (fail-soft) · k-anonymity suppression (min-5 platform,
min-3 360) · external API-key boundaries + scope enforcement · candidate vs staff auth boundaries ·
platform-owner vs org-user separation · impersonation safety · atomic state transitions (guarded `UPDATE ...
WHERE status = expected`) · bounded inputs · no raw-SQL-unsafe. Each has an existing TS test; each gets a C#
golden-fixture/integration equivalent before its domain ships.

## 12. First concrete work items (supersedes the draft's list)

1. Stand up `services/Tims.Platform` skeleton + solution + CI (.NET build/test) + OpenAPI + health.
2. **Phase-1 Spike A:** EF Core + Npgsql RLS interceptor; Testcontainers cross-tenant + fail-closed test.
3. **Phase-1 Spike B:** author `contracts/access-fixtures/` golden set; run it in the existing TS suite AND
   a new `Tims.UnitTests` port of `ResolveAccess` + scope lattice + k-anon.
4. Compensation read-only *throwaway* parity spike (validate the old-vs-new diff harness only).
5. Establish the table-ownership ledger + the CI check + the `EnableTenantRls` EF migration helper.
6. Auth/identity plane (Phase 2): Supabase JWT + API-key handler + tenant middleware + impersonation.
7. Team Suite intake study (Phase 6 input) — with the "re-home DataAccess, never import tenant model" gate up
   front.
8. Build HRIS (Sprint 1.8) directly in C# as the first real domain.

---

### Appendix — mechanism sketches (unambiguous, not full code)

**Principal resolution → tenant context (Api middleware):**
```txt
Supabase JWT (JwtBearer, JWKS, verify exp/iss/aud) ──┐
tims_ API key (custom AuthenticationHandler)         ├─► resolve TIMS principal
                                                     │     (org, userId, roles, isPlatformOwner, scopes)
impersonation header (owner-only) ───────────────────┘   ──► ITenantContext { org, user, roles, impersonatedBy }
                                                              └─► selects DbContext profile (tenant vs privileged)
                                                              └─► GUC set via SET LOCAL in the request txn
```

**Endpoint guard composition (mirrors the tRPC procedures):**
```txt
[Authenticated] + RequirePermission("module","action")        // = permissionProcedure
              (+ RequireOrgScope)                              // = org-rollup endpoints
              (+ AssertScoped(entity, id))                     // = IDOR-guarded by-id endpoints
protectedProcedure-equivalent + hard subjectUserId==ctx.User  // = identity-anchored self-service
externalPermissionProcedure("module","action","scope", alwaysEnforceScope)  // = API-key surface (1.6)
```
