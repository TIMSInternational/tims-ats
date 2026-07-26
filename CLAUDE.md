# TIMS ATS — Engineering Standards & Architecture

> **Owner**: NexaDev LLC | **Platform**: TIMS ATS (Applicant Tracking System)
> **Scale target**: Thousands of concurrent users from day one. Enterprise-grade.

Multi-tenant enterprise HR/ATS SaaS platform for TIMS International. Monorepo with Turborepo + pnpm.

**Stack**: Next.js 15 (App Router) | tRPC | Prisma (PostgreSQL/Supabase) | AWS Bedrock (Claude) | Tailwind 4 | TypeScript (strict)

> Domain rules auto-load from `.claude/rules/` when you touch matching files:
> `api-security.md` (packages/api+auth), `ai-safety.md` (packages/ai, workers),
> `frontend.md` (apps/web), `db.md` (packages/db).
> Status/backlog: `docs/REMAINING-WORK.md`. AI architecture: `docs/AI-AGENT-ARCHITECTURE.md`.

## Commands

```bash
# Dev server
cd apps/web && pnpm dev

# Type check (both must pass before any commit)
pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit

# Tests (vitest, repo root)
npx vitest run

# Full local verify gate (tsc + tests + build + gitleaks) — use /gate
# Ship to production — use /ship (PR → gate → merge → vercel deploy)

# Schema (dev only)
cd packages/db && npx prisma db push --schema=prisma/schema
# Generate client
cd packages/db && npx prisma generate
# Seed
cd packages/db && npx tsx prisma/seed.ts

# Lint / Format
pnpm eslint . --ext .ts,.tsx
pnpm prettier --write .
```

## Monorepo Structure

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

## Architecture Rules

- **Clean architecture flow:** Router (Zod input validation) → Service (business logic) → Repository (Prisma queries). Details + examples in `.claude/rules/api-security.md`.
- **No circular dependencies.** Flow: `shared` → `db` → `api` → `web`. Never reverse.
- **Package boundaries are hard.** Only import from declared `package.json` dependencies.
- **No empty shell packages.** Don't create until you have code.
- **Feature grouping.** Routers, schema files, pages organized by domain.
- **Routers never import `db` directly.** Always go through repositories.
- **Services never import tRPC types.** They return plain objects, routers handle tRPC concerns.

## TypeScript

- **Strict mode always.** `strict: true` in tsconfig. No `// @ts-ignore`.
- **No `any` type.** Use `unknown` and narrow. Use `trpc-types.ts` for inferred tRPC output types.
- **Zod for all boundaries.** Every tRPC input, every external API response, every agent output.
- **Shared types.** Export via `inferRouterOutputs<AppRouter>` for frontend reuse.

## Naming Conventions

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

## File Size Limits

- **Max 300 lines per component file.** Extract subcomponents.
- **Max 500 lines per router file.** Split into sub-routers.
- **Max 300 lines per service file.** Split by subdomain if growing.
- **One component per file.** No multi-component files.

## AI-Generated Code Safety (MANDATORY)

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

### Dependency Safety

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

## Commit & PR Standards

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

## Deployment

See `docs/DEPLOYMENT.md` for hosting phases, region/CDN config, and CI/CD security gates. Codex cross-model verification runs at every build's review gate per `.claude/rules/verification.md`.

---

_Last updated: 2026-07-25_
