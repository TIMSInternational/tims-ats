# TIMS ATS — Engineering Standards & Architecture

> **Last updated**: 2026-06-01 | **Owner**: NexaDev LLC | **Platform**: TIMS ATS (Applicant Tracking System)
> **Scale target**: Thousands of concurrent users from day one. Enterprise-grade.

---

## Project Overview

Multi-tenant enterprise HR/ATS SaaS platform for TIMS International. Production-ready for thousands of daily active users. Monorepo with Turborepo + pnpm.

**Stack**: Next.js 15 (App Router) | tRPC | Prisma (PostgreSQL/Supabase) | AWS Bedrock (Claude) | Tailwind 4 | TypeScript (strict)

**Repo**: `~/Desktop/NexaDev/clients/tims-international/tims-ats/`

---

## 1. Architecture Principles

### Monorepo Structure
```
apps/web              → Next.js frontend (SSR, App Router)
packages/api          → tRPC routers + services + repositories
packages/db           → Prisma schema (23 files), client, seed, migrations
packages/shared       → Zod validators, types, constants, logger
packages/auth         → Supabase auth (server/client/middleware)
packages/ai           → Shared AI types, prompts, Zod output schemas
packages/ui           → Shared component library
packages/i18n         → Typed i18n message exports (es/en)
services/ai-gateway   → AI microservice (Docker, deploys independently)
workers/              → Trigger.dev background jobs (batch AI, exports, emails)
docs/                 → Architecture docs, design specs
```

### Clean Architecture — Service Layer Pattern

Routers are thin controllers. Business logic lives in services. Data access in repositories.

```
Router (input validation) → Service (business logic) → Repository (Prisma queries)
```

**Router** — validates input via Zod, calls service, returns result. No Prisma imports. No business logic.
```typescript
// routers/candidate.ts
merge: permissionProcedure('candidate', 'delete')
  .input(z.object({ primaryId: z.string().uuid(), duplicateId: z.string().uuid() }))
  .mutation(({ ctx, input }) => candidateService.merge(ctx.user.organizationId, input.primaryId, input.duplicateId)),
```

**Service** — orchestrates operations, enforces domain rules, calls repositories.
```typescript
// services/candidate.service.ts
async merge(orgId: string, primaryId: string, duplicateId: string) {
  if (primaryId === duplicateId) throw new TRPCError({ code: 'BAD_REQUEST' });
  const [primary, dup] = await candidateRepo.findByIds(orgId, [primaryId, duplicateId]);
  if (!primary || !dup) throw new TRPCError({ code: 'NOT_FOUND' });
  return candidateRepo.mergeRecords(primaryId, duplicateId);
}
```

**Repository** — only place that imports `db`. Encapsulates queries, joins, transactions.
```typescript
// repositories/candidate.repository.ts
async findByIds(orgId: string, ids: string[]) {
  return Promise.all(ids.map(id => db.candidate.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })));
}
```

**API folder structure:**
```
packages/api/src/
  trpc.ts              → tRPC init + middleware
  root.ts              → Router composition
  context.ts           → Request context
  middleware/           → rate-limit, tenant, audit, cache
  routers/             → Thin controllers (Zod → service → return)
  services/            → Business logic (domain rules, orchestration)
  repositories/        → Data access (Prisma queries only)
  lib/                 → Utilities (ses, circuit-breaker, logger)
```

**Migration strategy:** Introduce service layer on new features. Backfill complex routers first (candidate, pipeline, vacancy, billing). Simple CRUD routers can stay as-is.

### Rules
- **No circular dependencies.** Flow: `shared` → `db` → `api` → `web`. Never reverse.
- **Package boundaries are hard.** Only import from declared `package.json` dependencies.
- **No empty shell packages.** Don't create until you have code.
- **Feature grouping.** Routers, schema files, pages organized by domain.
- **Routers never import `db` directly.** Always go through repositories.
- **Services never import tRPC types.** They return plain objects, routers handle tRPC concerns.

---

## 2. Coding Standards

### TypeScript
- **Strict mode always.** `strict: true` in tsconfig. No `// @ts-ignore`.
- **No `any` type.** Use `unknown` and narrow. Use `trpc-types.ts` for inferred tRPC output types.
- **Zod for all boundaries.** Every tRPC input, every external API response, every agent output.
- **Shared types.** Export via `inferRouterOutputs<AppRouter>` for frontend reuse.

### Naming Conventions
```
Files:           kebab-case       (candidate.service.ts, invoice-wizard.tsx)
Components:      PascalCase       (InvoiceWizard, BillingProfileDrawer)
Functions:       camelCase        (getInvoiceKpis, formatCurrency)
Types:           PascalCase       (InvoiceLineItem, CandidateFilters)
Constants:       SCREAMING_SNAKE  (SYSTEM_ROLES, MAX_LINE_ITEMS)
DB fields:       camelCase        (organizationId, createdAt)
DB columns:      snake_case @map  (organization_id, created_at)
DB tables:       snake_case @@map (invoice_line_items)
Booleans:        is/has prefix    (isActive, isPlatformOwner)
Services:        *.service.ts     (candidate.service.ts)
Repositories:    *.repository.ts  (candidate.repository.ts)
```

### File Size Limits
- **Max 300 lines per component file.** Extract subcomponents.
- **Max 500 lines per router file.** Split into sub-routers.
- **Max 300 lines per service file.** Split by subdomain if growing.
- **One component per file.** No multi-component files.

### Frontend Patterns
- **Shared UI components** in `apps/web/components/`: KpiCard, DataTable, StatusBadge, EmptyState, Modal (with focus trap), Drawer, Skeleton. No duplicating UI code.
- **react-hook-form + Zod** for all forms. No raw `useState` per field.
- **`onError` toast on every mutation.** Import `toast()` from `lib/toast.ts`.
- **Loading + Error + Empty states.** Every query page handles all 3.
- **No hardcoded strings.** All text through `lib/i18n`. Keys in `es.json`/`en.json`.

### CSS / Tailwind
- **Design tokens via `@theme` in globals.css.** Use `bg-brand`, `text-muted`, `border-border`, `bg-surface`.
- **No inline `style={{}}`.** All Tailwind.
- **No magic numbers.** Use spacing scale.

---

## 3. Security Requirements

### SQL Injection
- **NEVER `$executeRawUnsafe` with interpolation.** Use `$executeRaw` template literals.

### Multi-Tenancy (Defense in Depth) — BOTH layers now live (updated 2026-06-05)
1. **Primary — IMPLEMENTED:** Application-level `WHERE organizationId = ctx.user.organizationId` on every tenant query.
2. **Secondary — IMPLEMENTED (RLS is live, verified):** Postgres RLS is enabled. Migration `20260604100000_enable_rls_tenant_isolation` applies `ENABLE` + `FORCE ROW LEVEL SECURITY` + a fail-closed `tenant_isolation` policy on **81 tables** (3 global catalogs — `ai_agents`, `permissions`, `platform_owner_emails` — are intentionally exempt). Policy reads `NULLIF(current_setting('app.current_org_id', true), '')::uuid`, so an unset GUC hides all rows.
3. **Enforcement — WIRED IN:** `packages/db/src/tenant-client.ts` (`tenantDb`) wraps each tenant op in a transaction that runs `SET LOCAL ROLE app_tenant` + `set_config('app.current_org_id', …, true)`. `trpc.ts` `runWithTenant(orgId)` sets the context per request; `app_tenant` is NOLOGIN/NOBYPASSRLS; platform owners run on the privileged `db`. Gated by `RLS_ENFORCED=true` (set in prod). Verified live: cross-org read/write blocked, unset GUC fails closed.
- **IDOR prevention (still required):** even with RLS, every query/mutation taking a resource id MUST verify it belongs to `ctx.user.organizationId` (`findFirst({ where: { id, organizationId } })`) — defense in depth, and platform/privileged-`db` paths aren't RLS-scoped.

### Rate Limiting (Per-Tenant)
- **Upstash Redis** with sliding window. Three tiers:
  - Tenant: 1000 req/min per org (noisy neighbor prevention)
  - User: 100 req/min per user
  - Expensive: 10 AI calls/min per org
- **Fallback to in-memory** for local dev when Upstash env vars missing.

### Input Validation
- **Bound all strings** (`.max(500)` descriptions, `.max(100)` names). No unbounded `z.string()`.
- **Bound all arrays** (`.max(50)` line items). Validate email with `.email()`.
- **Sanitize HTML** in email templates. Never inject raw user input.

### Secrets
- **Zod env validation** (`lib/env.ts`). Fail fast on missing vars in production.
- **Never return tokens** in API responses.

---

## 4. AI-Generated Code Safety (MANDATORY)

> 45% of AI-generated code contains security vulnerabilities (Veracode 2025).
> AI code has 2.74x higher vulnerability density than human-written code.
> These rules are NON-NEGOTIABLE for every line of code in this project.

### Banned Patterns (auto-reject in review)
```
NEVER generate:
  - $executeRawUnsafe or $queryRawUnsafe (SQL injection)
  - dangerouslySetInnerHTML without DOMPurify (XSS)
  - eval(), new Function(), vm.runInNewContext (code injection)
  - cors({ origin: '*' }) (open CORS)
  - NODE_TLS_REJECT_UNAUTHORIZED = '0' (TLS bypass)
  - Hardcoded API keys, tokens, passwords, or connection strings
  - z.any(), z.unknown() without narrowing, .passthrough() on Zod schemas
  - console.log with request bodies, tokens, or PII
  - findMany() / findFirst() without explicit select (data exposure)
  - JWT verification without checking exp, iss, aud
```

### Prisma Safety Rules
- **Always use `select` or `omit`.** Never return full records — HR data contains SSN, salary, medical info.
  ```typescript
  // WRONG — leaks all fields including password hash, SSN
  db.candidate.findMany({ where: { organizationId } })
  // RIGHT — explicit field selection
  db.candidate.findMany({ where: { organizationId }, select: { id: true, firstName: true, lastName: true, email: true } })
  ```
- **Never `$queryRawUnsafe`.** Use `$queryRaw` with tagged template literals.
- **Wrap multi-step operations in `$transaction`.** Race conditions are the #1 AI-generated production bug.
- **Use database-level unique constraints.** Don't rely on check-then-create patterns.

### Next.js Safety Rules
- **Use `import 'server-only'`** in all server modules. Prevents server code from being bundled into client.
- **Keep Next.js patched.** CVE-2025-55182 (React2Shell) was CVSS 10.0 — RCE via Server Components.
- **Never expose server env vars to client.** Only `NEXT_PUBLIC_*` prefixed vars reach the browser.
- **No `dangerouslySetInnerHTML`.** If rendering user HTML (job descriptions, candidate notes), sanitize with DOMPurify.

### Supabase Safety Rules
- **RLS enabled on EVERY table.** Tables have RLS off by default. This single misconfiguration caused CVE-2025-48757 (170+ apps exposed).
- **Never use `service_role` key client-side.** It bypasses ALL RLS. Only the `anon` key in browser code.
- **Audit RLS policies quarterly.** New tables = new policies. No exceptions.

### Dependency Safety Rules
- **Verify every new package exists and is legitimate before `pnpm add`.** AI hallucinates package names 19.7% of the time ("slopsquatting"). Check npmjs.com manually.
- **Lock all dependency versions.** Use exact versions, not ranges. `pnpm-lock.yaml` committed always.
- **Run `npm audit` before every deploy.** Block deploys with high/critical vulnerabilities.

### Code Review Checklist for AI-Generated Code
Every PR must be checked for:
1. **Auth bypass** — Does every endpoint have the correct middleware? (`protectedProcedure`, `platformProcedure`, `permissionProcedure`)
2. **Tenant isolation** — Does every query filter by `organizationId`?
3. **Data exposure** — Are Prisma queries using `select`? Is sensitive data (passwords, SSN, salary) excluded from responses?
4. **Input bounds** — Are all string inputs bounded (`.max()`)? All arrays bounded?
5. **Secret leakage** — Any hardcoded keys, tokens, or credentials?
6. **XSS** — Any `dangerouslySetInnerHTML` or unescaped HTML rendering?
7. **Race conditions** — Are multi-step DB operations wrapped in `$transaction`?
8. **Error exposure** — Do error handlers leak stack traces or internal state?

### CI/CD Security Gates (implement before production)
```
Pre-commit:
  - Gitleaks (block commits with secrets)
  - ESLint with @typescript-eslint/no-explicit-any

Pull Request:
  - tsc --noEmit (zero errors)
  - Semgrep security scan (block high/critical)
  - npm audit (block known vulnerable deps)

Pre-deploy:
  - Supabase RLS audit (all tables have policies)
  - Environment variable validation (no hardcoded fallbacks)

Post-deploy:
  - Sentry error monitoring (no stack traces in responses)
  - Runtime secret scanning
```

---

## 5. Database Standards

### Schema Conventions
- Every model: `id` (UUID), `createdAt`, `updatedAt`.
- Every tenant model: `organizationId` with `@@index([organizationId])`.
- Every FK: `@@index`. Prisma does NOT auto-create.
- Cascades: explicit `onDelete:` on every `@relation`.
- **Prisma enums** for all status/type fields: `InvoiceStatus`, `OrgPlan`, `SubscriptionStatus`, `InvitationType`, `InvitationStatus`.
- **Org-scoped uniqueness**: `@@unique([organizationId, invoiceNumber])`.

### Connection Pooling (Critical for Scale)
- **Supavisor** (Supabase's built-in pooler) on port 6543 for application queries.
- **Direct connection** on port 5432 for migrations only.
- **Transaction mode** — connections released after each transaction.
```env
DATABASE_URL="postgresql://...@pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...@supabase.com:5432/postgres"
```
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### Read Replicas
- Use `@prisma/extension-read-replicas` to route reads to replica.
- Dashboard KPIs, reports, analytics hit read replica. Writes hit primary.
- After a write, use `db.$primary()` if immediate consistency needed.

### Migration Discipline
- `prisma db push` for dev only. Production: `prisma migrate dev` → `prisma migrate deploy`.
- Never `--accept-data-loss` in production.

---

## 6. AI Agent Architecture — Microservice

> Full technical doc: `docs/AI-AGENT-ARCHITECTURE.md`

### Why Microservice (not monorepo)
At thousands of concurrent users, AI calls (3-15 seconds each for Bedrock) WILL block the main API. CV batch processing (500+ at a time) needs independent scaling. PII proxy (Presidio) is Python-based. Cost isolation per tenant requires separate metering.

### Architecture
```
apps/web (Next.js)
  ↓ REST/gRPC
services/ai-gateway (Docker, ECS Fargate)
  ├── PII Proxy (Presidio — strip/re-inject)
  ├── Agent Router (32 agents, budget check, cache)
  ├── Bedrock Client (Claude Haiku/Sonnet)
  └── Audit Logger
  ↓ async via SQS
workers/ (Trigger.dev)
  └── Batch jobs (CV parsing, assessments, reports)
```

### Shared Types (Stay in Monorepo)
```
packages/ai/          → Agent configs, prompt templates, Zod output schemas
                        Imported by BOTH services/ai-gateway AND workers/
                        Ensures type safety without coupling
```

### Communication
- **Real-time (6 agents):** REST or gRPC from Next.js API routes → AI gateway. Streaming via SSE.
- **Batch (26 agents):** tRPC enqueues to SQS → AI gateway processes → webhook callback to API.
- **Message broker:** SQS for batch jobs (managed, cheap, scales). Redis Streams if sub-second latency needed later.

### Agent Pipeline (8 steps)
```
Request → Budget Check → Cache Lookup → PII Strip → Bedrock Call → Output Validation → PII Re-inject → Audit Log
```

> **Implemented today (2026-06-05), in-process in `packages/ai`** — the microservice
> above is the scale-target, not yet built (rule #9). Every agent now goes through
> ONE gated door, `invokeAgent` (`packages/ai/src/invoke.ts`):
> `budget (fail-closed) → cache (org-scoped, per-agent TTL) → PII (input sanitize/wrap + Bedrock Guardrails) → bedrockGenerate (circuit-broken) → Zod-validate → usage log → cache store`.
> Raw Bedrock access lives ONLY in `packages/ai/src/client.ts` (`bedrockGenerate`);
> no router/service may import `@ai-sdk` or call Bedrock directly (rule #2). Budget
> failures throw; a malformed model response returns the agent's obviously-degraded
> fallback (rule #4), never fabricated data. PII tokenization (Presidio) is deferred.

### Guardrails
- **System prompt hardening.** User content as DATA in XML delimiters, never INSTRUCTIONS.
- **Input sanitization.** Strip injection patterns from CVs/job descriptions.
- **Zod output validation.** 100% of outputs parsed. Malformed → retry.
- **Tool-level permissions.** CV Parser accesses `candidates` only, not `salary_adjustments`.
- **Per-org budget.** Hard limits in `AiAgentOrgConfig.monthlyBudget`. Alert 80%, block 100%.

### Scaling
- Auto-scale ECS tasks based on SQS queue depth.
- Concurrency limit: 20 parallel Bedrock calls (API rate limit).
- Cold start mitigation: min 2 tasks always warm.
- Bedrock Batch API for bulk operations (50% cost savings).

---

## 7. PII Handling (CRITICAL)

### Architecture
```
App → PII Proxy (strip) → Bedrock → PII Proxy (validate + re-inject) → App
```

### Classification
```
CRITICAL (blocked):     SSN, bank accounts, medical, criminal records
HIGH (tokenized):       Full name, salary, address, DOB, phone, personal email
MEDIUM (anonymized):    Job title + dept, dates, education
LOW (pass, log access): Job descriptions, company policies
```

### Implementation
- **Input sanitization — IMPLEMENTED** (`packages/ai/src/pii.ts`): strips control/
  zero-width/bidi chars, defangs prompt-injection markers, and `wrapAsData()` wraps
  user content in a delimiter it cannot break out of. Applied by every agent when
  building the Bedrock message.
- **Bedrock Guardrails (MASK) — IMPLEMENTED, env-gated** defense-in-depth: when
  `BEDROCK_GUARDRAIL_ID` is set, `bedrockGenerate` references the guardrail so PII is
  masked server-side. The MASK policy lives in the AWS guardrail config.
- **Presidio strip/re-inject — DEFERRED** to a measured scale-trigger (rule #9):
  - **Presidio** (Microsoft, open-source) + custom HR recognizers (salary, visa, cedula).
  - **Deterministic tokens** scoped per-request: `"John Smith" → "<<PERSON_1>>"`.
  - **Token vault:** In-memory only, destroyed immediately after response.
  - **Output validation:** Re-scan LLM response for leaked PII.

### Compliance
- **Colombian Habeas Data (Ley 1581/2012):** Prior express consent. AI processing clause. SIC registry.
- **GDPR:** Data minimization, DPIA, right to explanation.
- **CCPA/CPRA 2026:** Full consumer rights on employee data.

### Audit Logging (PII-free)
- Log what happened, never actual content. 7-year retention. Debug logs 30-day auto-purge.

---

## 8. Scaling & Production Infrastructure

### Caching (Upstash Redis)
| Data | TTL | Strategy |
|------|-----|----------|
| Feature flags | 5 min | Cache-aside, invalidate on update |
| Org settings | 10 min | Cache-aside |
| Dashboard KPIs | 30-60 sec | Stale-while-revalidate |
| User session/roles | 5 min | Cache-aside |
| Permission checks | 5 min | Cache-aside |

Cache keys: `trpc:{orgId}:{path}:{inputHash}`. Invalidate by org prefix on writes.

### Circuit Breaker (External Services)
```typescript
// Bedrock: 5 failures → open for 30s. SES: 3 failures → open for 60s.
const result = await bedrockCircuit.execute(
  () => aiService.analyze(data),
  () => ({ result: null, source: 'fallback', message: 'AI temporarily unavailable' })
);
```
App continues working when AI is down. Graceful degradation, not crashes.

### Background Jobs (Trigger.dev)
| Queue | Concurrency | Use Case |
|-------|------------|----------|
| `cv-parse` | 20 | AI CV parsing |
| `email-send` | 50 | SES dispatch |
| `report-generate` | 5 | Heavy KPI reports |
| `ai-batch` | 10 | Other AI calls |
| `export` | 3 | Large CSV/XLSX |

Dead letter queue + `onFailure` hooks for persistent failure alerting.

### Observability
- **Logging:** Pino (structured JSON, 5x faster than Winston).
- **Error tracking:** Sentry (OpenTelemetry-based, auto-captures tRPC + Prisma).
- **Tracing:** OpenTelemetry spans on tRPC procedures + Prisma queries.
- **AI cost:** `ai_invocations` table + Helicone proxy.

### Deployment
- **Phase 1 (launch):** Vercel (auto-scaling, zero-ops) + Supabase Team ($599/mo, ~200 pooled connections).
- **Phase 2 (scale):** AWS ECS Fargate for AI gateway + API if Vercel limits hit.
- **Region:** Supabase `sa-east-1` (Sao Paulo, ~40ms from Bogota vs 120ms from us-east-1).
- **CDN:** Vercel Edge for static assets. API routes: no-cache.

---

## 9. Known Issues & Remaining Work

### FIXED (this session)
- [x] SQL injection in RLS middleware
- [x] IDOR in user.deactivate + user.assignRole
- [x] In-memory rate limiter → Upstash Redis
- [x] 28 `any` types removed
- [x] 80+ missing FK indexes added
- [x] 5 Prisma enums added (OrgPlan, SubscriptionStatus, InvoiceStatus, InvitationType, InvitationStatus)
- [x] ESLint + Prettier config
- [x] Env validation with Zod
- [x] Tailwind design tokens
- [x] 8 shared UI components with a11y
- [x] Toast system + error handling on 19 mutations
- [x] 173 i18n keys (es + en)
- [x] 5 empty packages removed

### Remaining (next sessions)
| Priority | Task |
|----------|------|
| ~~CRITICAL — SECURITY~~ DONE | ~~Database-level tenant isolation is ABSENT.~~ **RLS is now live and verified** (migration `20260604100000`, `tenantDb`, `RLS_ENFORCED=true`) — see §3. |
| ~~**HIGH — AI COST/SAFETY**~~ DONE (Phase 1) | **Guardrail layer is built.** Every AI call now goes through the single gated `@tims/ai` `invokeAgent` (budget→cache→PII→bedrock→validate→log): org-scoped response cache (per-agent TTL; PII agents ttl=0), input sanitization + env-gated Bedrock Guardrails MASK, fail-closed budget, `bedrockCircuit` wired, Zod validation. Rule #2 (no Bedrock outside `packages/ai`) is enforced by a CI grep-gate + Vitest test. **Phase 2 wired (real Bedrock through the gate):** `candidate.parseCV` (CV text → structured data, persists to document) and `candidate.screen` (candidate↔vacancy screening → FitScore) via `candidate-ai.service.ts` + `candidate-ai.repository.ts`. **Remaining:** per-org `AiAgentOrgConfig` budgets still unseeded (default $25 cap applies); Presidio strip/re-inject deferred to a scale-trigger (rule #9); real CV file→text extraction (S3 + PDF/DOCX) is a separate future phase. |
| HIGH — SECURITY | RBAC follow-up: `hr_admin` uses a denylist short-circuit in `trpc.ts` that bypasses the DB `rolePermission` check. Move to least-privilege once per-org `rolePermission` coverage is verified for every `hr_admin` role. |
| HIGH — SECURITY | Add CAPTCHA (Turnstile/hCaptcha) to the public `applyToVacancy` form; move to nonce-based CSP and drop `'unsafe-inline'`/`'unsafe-eval'` from `script-src`. |
| HIGH | Split god components (invoices 605 LOC, orgs 611, invitations 572) |
| HIGH | Split platform.ts router (1519 LOC) into sub-routers |
| HIGH | Wire i18n keys to page components (mechanical replacement) |
| HIGH | Introduce service layer on next feature |
| HIGH | Configure Supavisor connection pooling for production |
| MEDIUM | Add Sentry + Pino structured logging |
| MEDIUM | Refactor pages to use shared KpiCard/DataTable components |
| ~~MEDIUM~~ DONE | Circuit breaker for Bedrock (`bedrockCircuit` in `packages/ai`) + SES (`sesCircuit` in `packages/api`) — both wired. |
| MEDIUM | Set up AI gateway microservice (Docker + ECS) |
| LOW | Migrate to Supabase sa-east-1 region |
| LOW | Add Prisma read replica extension |

---

## 10. Commit & PR Standards

### Commit Messages
```
feat(invoices): add Mercury-style invoice creation wizard
fix(security): parameterize RLS query to prevent SQL injection
refactor(api): extract candidate service layer
chore(db): add missing indexes to FK fields
```

### Branch Naming
```
feat/invoice-wizard       fix/rls-sql-injection
refactor/service-layer    chore/connection-pooling
```

### PR Requirements
- `tsc --noEmit` passes on both `@tims/api` and `@tims/web`
- Schema changes include index review + migration
- Security changes require explicit review note
- No `any` types. No hardcoded strings. No unbounded inputs.
- New routers must use service layer pattern

---

## 11. Development Commands

```bash
# Dev server
cd apps/web && pnpm dev

# Type check
pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit

# Schema (dev only)
cd packages/db && npx prisma db push --schema=prisma/schema

# Seed
cd packages/db && npx tsx prisma/seed.ts

# Generate client
cd packages/db && npx prisma generate

# Lint
pnpm eslint . --ext .ts,.tsx

# Format
pnpm prettier --write .
```
