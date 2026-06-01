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

### Multi-Tenancy (Defense in Depth)
1. **Primary:** Application-level `WHERE organizationId = ctx.user.organizationId` on every query.
2. **Secondary:** Supabase RLS policies as safety net.
3. **Enforcement:** Prisma tenant middleware that auto-injects `organizationId` on all tenant-scoped models.
- **IDOR prevention.** Every mutation verifies resource belongs to caller's org.

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

## 4. Database Standards

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

## 5. AI Agent Architecture — Microservice

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

## 6. PII Handling (CRITICAL)

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
- **Presidio** (Microsoft, open-source) + custom HR recognizers (salary, visa, cedula).
- **Deterministic tokens** scoped per-request: `"John Smith" → "<<PERSON_1>>"`.
- **Token vault:** In-memory only, destroyed immediately after response.
- **Output validation:** Re-scan LLM response for leaked PII.
- **Bedrock Guardrails:** MASK mode as defense-in-depth safety net.

### Compliance
- **Colombian Habeas Data (Ley 1581/2012):** Prior express consent. AI processing clause. SIC registry.
- **GDPR:** Data minimization, DPIA, right to explanation.
- **CCPA/CPRA 2026:** Full consumer rights on employee data.

### Audit Logging (PII-free)
- Log what happened, never actual content. 7-year retention. Debug logs 30-day auto-purge.

---

## 7. Scaling & Production Infrastructure

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

## 8. Known Issues & Remaining Work

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
| HIGH | Split god components (invoices 605 LOC, orgs 611, invitations 572) |
| HIGH | Split platform.ts router (1519 LOC) into sub-routers |
| HIGH | Wire i18n keys to page components (mechanical replacement) |
| HIGH | Introduce service layer on next feature |
| HIGH | Configure Supavisor connection pooling for production |
| MEDIUM | Add Sentry + Pino structured logging |
| MEDIUM | Refactor pages to use shared KpiCard/DataTable components |
| MEDIUM | Add Prisma tenant middleware (auto-inject organizationId) |
| MEDIUM | Circuit breaker for Bedrock/SES |
| MEDIUM | Set up AI gateway microservice (Docker + ECS) |
| LOW | Migrate to Supabase sa-east-1 region |
| LOW | Add Prisma read replica extension |

---

## 9. Commit & PR Standards

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

## 10. Development Commands

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
