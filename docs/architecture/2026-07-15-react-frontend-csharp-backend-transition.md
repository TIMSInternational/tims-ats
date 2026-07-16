# TIMS ATS Architecture Recommendation: React Frontend + C# Backend Transition

Date: 2026-07-15

## Executive Recommendation

Keep the current TIMS ATS frontend in React/Next.js and progressively migrate backend/domain functionality into C#/.NET services.

Do not pause product completion for a full rewrite. The best path is a phased transition:

1. Finish and stabilize the current TIMS ATS platform.
2. Add a C#/.NET backend foundation beside the current TypeScript/tRPC backend.
3. Move stable backend domains into C# one at a time.
4. Keep the Next.js UI as the unified product shell.
5. Study Team Suite's existing C# repository and use it as a reference/input for backend layering, domain services, and integration patterns.

The target is not "TIMS becomes Team Suite." The target is:

```txt
React/Next.js product experience
+ C#/.NET backend domain services
+ shared tenant/auth/audit model
+ Team Suite services integrated later as part of one ecosystem
```

## Why This Direction

TIMS ATS has become a large product platform. It already includes recruitment, candidate portal, assessment player, AI agents, access control, sensitive-data protection, billing, compensation, currency, video interviews, 360 evaluations, and role-specific dashboards.

The current TypeScript/Next.js stack has been excellent for product speed and UI iteration. However, as the platform becomes more enterprise-heavy, several backend domains would benefit from a stronger service-oriented C# foundation:

- compensation and currency
- billing and invoices
- audit/compliance
- HRIS and external integrations
- scheduled jobs and retries
- reporting and analytics
- long-running AI workflows
- Team Suite integration

The frontend should stay React because the current TIMS UI is strong and already fits the product direction. The backend should evolve toward C# because Team Suite is already C#, and because .NET is a better long-term fit for complex enterprise backend services.

## Current State

Current TIMS ATS stack:

- `apps/web`: Next.js/React frontend
- `packages/api`: TypeScript/tRPC backend surface
- `packages/db`: Prisma/Postgres schema and client
- `packages/shared`: shared TypeScript constants/types
- `workers`: current worker package
- Supabase/Postgres database
- Supabase auth
- Vercel production deploy
- GitHub repository and PR workflow

Current Team Suite indication from Azure DevOps screenshot:

- C#/.NET solution
- layered projects:
  - `Business`
  - `Common`
  - `DataAccess`
  - `Web`
- Azure DevOps Repos/Pipelines/Boards style workflow

## Target Architecture

Recommended target shape:

```txt
tims-ats/
  apps/
    web/                         # Next.js/React unified product UI

  packages/
    api/                         # Transitional BFF/tRPC adapter, thinner over time
    shared/                      # Shared frontend-safe constants/types
    ui/
    auth/
    i18n/
    db/                          # Prisma during transition, eventually reduced

  services/
    Tims.Platform/
      Tims.Platform.sln
      src/
        Tims.Api/                # ASP.NET Core HTTP API
        Tims.Application/        # Use cases, orchestration, commands/queries
        Tims.Domain/             # Domain entities, value objects, policies
        Tims.Infrastructure/     # EF Core/Dapper, integrations, external APIs
        Tims.Workers/            # Background workers/jobs
      tests/
        Tims.UnitTests/
        Tims.IntegrationTests/

  contracts/
    openapi/                     # Versioned API contracts used by frontend/BFF

  docs/
    architecture/
    audits/
    plans/
```

Recommended request flow during transition:

```txt
Current:
Next.js UI -> tRPC router -> Prisma/Postgres

Transition:
Next.js UI -> tRPC adapter -> C# API -> Postgres

End state:
Next.js UI -> C# API -> Postgres
```

The TypeScript API layer can remain as a Backend-for-Frontend while we migrate. It should get thinner over time.

## Core Principles

### 1. No Big-Bang Rewrite

Avoid rewriting all backend functionality at once. A one-shot migration would risk:

- feature regressions
- access-control mistakes
- data migration bugs
- duplicated effort
- months of delayed product work
- reintroducing bugs already fixed in production

Use a strangler pattern: move one bounded domain at a time.

### 2. React UI Remains The Product Shell

The current UI is a major asset. Keep:

- Next.js routing
- React components
- role-specific shells
- dashboards
- candidate/employee/admin experiences
- Vercel frontend workflow, unless a future infrastructure decision changes it

Do not migrate the UI to Blazor unless there is a separate, strong product reason. There is not one right now.

### 3. C# Owns Backend Domains, Not Pages

C# should own business rules and backend processes:

- money/currency
- workflows
- state transitions
- audit
- permissions enforcement
- integrations
- jobs
- reports

React should own:

- layout
- forms
- tables
- dashboards
- navigation
- role-specific UX

### 4. One Identity, One Tenant Model

Before moving major domains, define a shared identity contract:

- platform owner
- organization
- user
- employee
- candidate
- external API key principal
- role
- scope
- impersonation
- audit actor

The C# backend must understand the same tenant and permission model as the current TIMS app.

### 5. One Domain Owns Each Table

During transition, avoid letting Prisma and EF Core both freely mutate the same tables.

Rules:

- A table has one migration owner at a time.
- TypeScript/Prisma owns existing tables until a domain is migrated.
- C#/EF Core owns new C# domain tables or migrated tables.
- Shared tables are accessed through explicit read models, SQL views, or carefully reviewed queries.
- Cross-domain writes go through APIs/events, not direct writes by multiple services.

### 6. Preserve Security Invariants

The C# backend must preserve the hard-won security properties already built in TIMS:

- role and scope enforcement
- tenant isolation
- sensitive-field projection
- restricted-read audit logging
- k-anonymity suppression
- external API key boundaries
- candidate auth boundaries
- platform-owner vs organization-user separation
- impersonation safety

No migrated endpoint ships without parity tests for these invariants.

## Migration Phases

## Phase 0 - Current Platform Completion

Goal: Finish TIMS ATS as a functional product before major backend migration.

Work:

- Continue role-by-role platform audit:
  - super_admin
  - hr_admin
  - hrbp
  - recruiter
  - leader
  - committee
  - employee
  - platform_owner
  - candidate/external paths
- Fix broken pages, APIs, loading states, data rendering, and pipelines.
- Close documentation gaps versus current code.
- Keep production stable.
- Avoid starting a broad backend rewrite while product behavior is still moving.

Exit criteria:

- All role dashboards/pages load without unexpected errors.
- Core recruitment pipeline works end to end.
- Compensation/currency displays correctly.
- AI/video/interview flows are either functional or explicitly marked deferred.
- Docs reflect reality.

## Phase 1 - C# Architecture Runway

Goal: Prepare the backend foundation without moving product traffic yet.

Work:

- Create `services/Tims.Platform/`.
- Add .NET solution and projects:
  - `Tims.Api`
  - `Tims.Application`
  - `Tims.Domain`
  - `Tims.Infrastructure`
  - `Tims.Workers`
  - tests
- Add local build/test scripts.
- Add CI checks for .NET build/tests.
- Add OpenAPI output.
- Add basic health endpoint.
- Add environment/config convention.
- Add logging/telemetry convention.
- Document auth/tenant contract.

Exit criteria:

- .NET service builds in CI.
- Health endpoint runs locally.
- OpenAPI contract generated.
- No production traffic depends on it yet.

## Phase 2 - Team Suite Intake Study

Goal: Understand the existing C# Team Suite repo before shaping final service boundaries.

Inputs:

- Azure DevOps repo: `tims.configuration.core`
- Team Suite database/schema
- Team Suite deployed app if accessible
- Team Suite business docs, if any

Audit checklist:

- solution/project structure
- framework version
- package dependencies
- authentication model
- authorization model
- tenant/company model
- user model
- database provider and schema
- migrations strategy
- repository/data-access patterns
- service/business-layer patterns
- controller/API surface
- UI technology
- background jobs
- integration points
- reporting/export features
- test coverage
- deployment pipeline
- environment/secrets model
- overlap with TIMS modules
- features worth integrating
- code quality and refactor risks

Deliverable:

`docs/architecture/team-suite-integration-study.md`

Exit criteria:

- Clear map of Team Suite modules.
- Clear recommendation on what to reuse, wrap, rewrite, or discard.
- Clear mapping between Team Suite concepts and TIMS concepts.

## Phase 3 - First C# Pilot: Compensation, Currency, and Money

Goal: Move one high-value, domain-heavy backend area into C#.

Recommended first domain:

- compensation and currency

Reason:

- money rules need strict domain modeling
- currency correctness is business-critical
- recent TIMS fixes showed this is a natural backend-domain boundary
- easy to compare old vs new calculations

C# domain model examples:

```txt
Money
CurrencyCode
FxRate
CompensationBand
SalaryAdjustment
PayEquityResult
TotalCompensationBreakdown
```

Work:

- Build C# money/currency domain types.
- Implement FX provider abstraction.
- Implement compensation calculations.
- Implement salary adjustment simulation.
- Implement pay-equity normalization.
- Build OpenAPI endpoints.
- Add parity tests comparing TypeScript and C# results.
- Route one read-only endpoint through C# behind the current tRPC adapter.

Exit criteria:

- C# and TypeScript produce the same expected results for fixture cases.
- One production-safe endpoint can call C#.
- No user-visible regression.

## Phase 4 - C# Workers and Jobs

Goal: Move long-running and scheduled backend tasks out of serverless request paths.

Good C# worker candidates:

- FX rate refresh
- audit log retention/purge
- HRIS sync
- billing reconciliation
- email/WhatsApp retry queue
- report generation
- AI summarization jobs
- candidate pipeline automation
- data quality audits

Work:

- Add `Tims.Workers`.
- Choose queue/scheduler strategy.
- Add idempotency and retry policies.
- Add structured logs and failure alerts.
- Add operational dashboard hooks.

Exit criteria:

- At least one recurring job runs through the C# worker.
- Failures are visible.
- Retries are safe/idempotent.

## Phase 5 - Stable Domain Migration

Goal: Move backend domains into C# one at a time after the pilot is proven.

Suggested order:

1. Compensation/currency
2. Billing/invoices
3. External vendor API
4. HRIS/integrations
5. Audit/compliance
6. Reporting/analytics
7. 360 evaluation backend
8. Candidate pipeline state machine

Keep in TypeScript longer:

- UI composition
- role-specific dashboards
- fast-changing candidate detail UI
- experimental AI UX
- frontend forms/tables

For each domain:

1. Document current behavior.
2. Add characterization tests.
3. Implement C# service.
4. Add parity tests.
5. Route through adapter.
6. Verify production.
7. Remove old TypeScript business logic.

Exit criteria:

- Each migrated domain has one owner.
- Tests prove behavior/security parity.
- TypeScript backend surface becomes thinner.

## Phase 6 - Team Suite Integration

Goal: Bring Team Suite services into TIMS as part of the same ecosystem.

Possible integration paths:

### Option A - Wrap Existing Team Suite Service

Use when Team Suite code is stable and production-worthy.

```txt
TIMS UI -> TIMS BFF -> Team Suite API/service -> Team Suite DB
```

Pros:

- fastest reuse
- preserves existing logic
- lower initial risk

Cons:

- may preserve old architecture problems
- identity/tenant mapping can be awkward
- two data models may remain for longer

### Option B - Extract Team Suite Business Logic Into TIMS C# Services

Use when Team Suite business logic is good but web/data layers need modernization.

```txt
Team Suite Business/Common -> Tims.Domain/Tims.Application
Team Suite DataAccess -> rewritten Infrastructure layer
Team Suite Web -> replaced by TIMS React UI
```

Pros:

- better long-term architecture
- cleaner UX integration
- one platform experience

Cons:

- more work than wrapping
- needs careful parity testing

### Option C - Rebuild Team Suite Features Using TIMS Patterns

Use when Team Suite code is too old, too coupled, or too risky.

Pros:

- cleanest final architecture

Cons:

- slowest
- least reuse

Likely recommendation:

- Use Option B for high-value reusable domain logic.
- Use Option A for low-risk services that can be wrapped quickly.
- Use Option C only for messy or UI-heavy legacy parts.

## Phase 7 - Platform Consolidation

Goal: End with one coherent platform rather than two products stitched together.

Work:

- Single login/session model.
- Single org/user/role model.
- Single navigation system.
- Single audit trail.
- Single billing/subscription model.
- Single reporting surface.
- Shared design system.
- Cross-module search.
- Cross-module notifications.
- Unified admin console.

Exit criteria:

- Users experience TIMS as one platform.
- Team Suite features are not visibly separate unless intentionally branded as modules.
- Backend ownership is clear.

## Database Strategy

Start with current Postgres/Supabase.

Do not immediately split databases.

Recommended transition:

1. Keep one Postgres database initially.
2. Define table ownership.
3. Use schemas or naming conventions for new C# domains if needed.
4. Avoid duplicate writes by Prisma and EF Core.
5. Use SQL views/read models for cross-domain reads.
6. Add event/outbox patterns only when needed.

Possible future:

- separate service databases for mature domains
- event-driven sync
- data warehouse/reporting replica

But do not start there. It adds operational cost before we need it.

## API Contract Strategy

Use OpenAPI between TIMS frontend/BFF and C# services.

Reason:

- explicit contracts
- easy client generation
- good external API discipline
- easier testing
- easier Team Suite integration

Initial pattern:

```txt
Next.js client -> tRPC -> internal C# HTTP client -> C# API
```

Later pattern:

```txt
Next.js client -> generated API client -> C# API
```

## Deployment Strategy

Near term:

- Keep Next.js on Vercel.
- Deploy C# services separately as containers or Azure App Service.
- Keep Postgres/Supabase.

Preferred C# hosting candidates:

- Azure App Service
- Azure Container Apps
- AWS App Runner
- Fly.io/Render/Railway for simpler early service hosting
- Kubernetes only later, if operational scale justifies it

Do not move the React frontend off Vercel unless Vercel becomes a real limitation.

## GitHub vs Azure DevOps Strategy

TIMS currently uses GitHub. Team Suite uses Azure DevOps.

Recommendation:

- Keep TIMS on GitHub.
- Study Team Suite in Azure DevOps.
- When integration starts, import or mirror Team Suite code into GitHub for the new platform work.
- Preserve Team Suite Git history if possible.
- Do not maintain two active source-of-truth systems long term.

Why GitHub for the unified platform:

- TIMS is already there.
- Current deploy/PR workflow is there.
- AI-assisted development workflow fits GitHub better.
- Vercel integration is already working.
- Modern TypeScript/React ecosystem fits GitHub naturally.

What to borrow from Azure DevOps:

- stronger work-item discipline
- test plans
- release gates
- package feeds/versioning discipline
- traceability between work, code, tests, and releases

## Risk Register

### Risk: Auth and RBAC drift

Mitigation:

- Write shared auth/tenant contract before C# endpoints handle real user data.
- Add parity tests against current TIMS access behavior.

### Risk: Two ORMs conflict

Mitigation:

- Table ownership rules.
- Migration ownership rules.
- No silent dual writes.

### Risk: Rewriting incomplete product logic

Mitigation:

- Finish current platform first.
- Migrate stable domains first.
- Keep fast-changing UX in TypeScript until settled.

### Risk: Team Suite code quality unknown

Mitigation:

- Run a dedicated Team Suite intake study.
- Classify modules as wrap, extract, rewrite, or discard.

### Risk: Split platform experience

Mitigation:

- TIMS React shell remains the only user-facing experience.
- Team Suite features enter as modules inside TIMS navigation and permissions.

### Risk: Operational complexity increases

Mitigation:

- Start with one C# service.
- Add observability from day one.
- Avoid Kubernetes or many microservices too early.

## First Concrete Work Items

1. Finish current TIMS role-by-role audit.
2. Create C# backend architecture spike.
3. Add `services/Tims.Platform` skeleton.
4. Add OpenAPI/health endpoint.
5. Add CI for .NET build/test.
6. Study Team Suite repo.
7. Build compensation/currency C# pilot.
8. Route one low-risk endpoint through C#.
9. Expand to workers/jobs.
10. Start domain-by-domain migration.

## Decision Summary

Approved direction:

- React frontend stays.
- C# backend foundation should be introduced progressively.
- Team Suite will be studied later and integrated as backend/domain capabilities.
- TIMS remains the unified all-in-one platform experience.
- Migration happens by phases, not a full rewrite.

Primary recommendation:

```txt
Complete TIMS product now.
Build C# backend runway in parallel.
Migrate stable domains one by one.
Use Team Suite as a reference and source of reusable backend logic.
Keep React as the product shell.
```

## Reference Links

- ASP.NET Core APIs: https://dotnet.microsoft.com/en-us/apps/aspnet/apis
- EF Core migrations: https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/
- Aspire distributed app model: https://aspire.dev/get-started/what-is-aspire/
- Azure DevOps overview: https://learn.microsoft.com/en-us/azure/devops/user-guide/what-is-azure-devops
- Vercel Functions: https://vercel.com/docs/functions
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Prisma ORM overview: https://www.prisma.io/docs/orm
