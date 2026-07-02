---
paths:
  - "packages/api/**"
  - "packages/auth/**"
  - "packages/shared/**"
---

# API — Service Layer Pattern & Security

## Clean Architecture — Service Layer Pattern

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

## Security Requirements

### SQL Injection
- **NEVER `$executeRawUnsafe` with interpolation.** Use `$executeRaw` template literals.

### Multi-Tenancy (Defense in Depth) — BOTH layers live (updated 2026-06-05)
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

### RBAC
- Least-privilege is live: every role (including `hr_admin`) is DB-checked against `rolePermission` grants via `buildAccessForUser` in `trpc.ts`. The old `hr_admin` denylist short-circuit and silent platform/super_admin bypass have been removed — see `docs/WAVE-2.5-ACCESS-CONTROL.md`.

## Caching (Upstash Redis)

| Data | TTL | Strategy |
|------|-----|----------|
| Feature flags | 5 min | Cache-aside, invalidate on update |
| Org settings | 10 min | Cache-aside |
| Dashboard KPIs | 30-60 sec | Stale-while-revalidate |
| User session/roles | 5 min | Cache-aside |
| Permission checks | 5 min | Cache-aside |

Cache keys: `trpc:{orgId}:{path}:{inputHash}`. Invalidate by org prefix on writes.

> **Implemented (2026-06-05):** cache-aside layer in `packages/api/src/lib/cache.ts`
> (Upstash + in-memory fallback, fail-soft). First consumer = the per-request
> **permission check** in `trpc.ts` (`tims:perm:{orgId}:{roles}:{module}:{action}`,
> 5-min TTL) — it previously hit `rolePermission` on every authed request.
> Role-assignment writes call `invalidatePermissionCache(orgId)`. Org-settings /
> dashboard-KPI caching can reuse `cacheGet`/`cacheSet`/`cacheInvalidatePrefix`.

## Circuit Breaker (External Services)

```typescript
// Bedrock: 5 failures → open for 30s. SES: 3 failures → open for 60s.
const result = await bedrockCircuit.execute(
  () => aiService.analyze(data),
  () => ({ result: null, source: 'fallback', message: 'AI temporarily unavailable' })
);
```
App continues working when AI is down. Graceful degradation, not crashes.

## Background Jobs (Trigger.dev)

| Queue | Concurrency | Use Case |
|-------|------------|----------|
| `cv-parse` | 20 | AI CV parsing |
| `email-send` | 50 | SES dispatch |
| `report-generate` | 5 | Heavy KPI reports |
| `ai-batch` | 10 | Other AI calls |
| `export` | 3 | Large CSV/XLSX |

Dead letter queue + `onFailure` hooks for persistent failure alerting.

## Observability

- **Logging:** Pino (structured JSON, 5x faster than Winston).
- **Error tracking:** Sentry (OpenTelemetry-based, auto-captures tRPC + Prisma).
- **Tracing:** OpenTelemetry spans on tRPC procedures + Prisma queries.
- **AI cost:** `ai_invocations` table + Helicone proxy.
