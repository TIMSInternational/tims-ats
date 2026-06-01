# TIMS ATS — Engineering Standards & Architecture

> **Last updated**: 2026-06-01 | **Owner**: NexaDev LLC | **Platform**: TIMS ATS (Applicant Tracking System)

---

## Project Overview

Multi-tenant enterprise HR/ATS SaaS platform. Monorepo with Turborepo + pnpm.

**Stack**: Next.js 15 (App Router, Turbopack) | tRPC | Prisma (PostgreSQL/Supabase) | AWS Bedrock (Claude) | Tailwind 4 | TypeScript (strict)

**Repo**: `~/Desktop/NexaDev/clients/tims-international/tims-ats/`

---

## 1. Architecture Principles

### Monorepo Structure
```
apps/web           → Next.js frontend (SSR, App Router)
packages/api       → tRPC routers, middleware, business logic
packages/db        → Prisma schema (23 files), seed, migrations
packages/shared    → Zod validators, types, constants
packages/auth      → Supabase auth (server/client/middleware)
packages/ai        → AWS Bedrock AI agent orchestration
packages/ui        → Shared component library (build out over time)
workers/           → Trigger.dev background jobs
docs/              → Architecture docs, design specs
```

### Rules
- **No circular dependencies.** Dependency flow: `shared` → `db` → `api` → `web`. Never reverse.
- **Package boundaries are hard.** A package can only import from packages listed in its `package.json` dependencies.
- **No empty shell packages.** If a package has no implementation, do not create it. Remove `@tims/email`, `@tims/events`, `@tims/whatsapp`, `@tims/video`, `@tims/storage` until needed.
- **Feature grouping.** Routers, schema files, and pages are organized by domain (recruitment, people, talent, platform, engagement).

---

## 2. Coding Standards

### TypeScript
- **Strict mode always.** `strict: true` in tsconfig. No `// @ts-ignore`.
- **No `any` type.** Use `unknown` and narrow with type guards. If tRPC query returns data, type it properly — never `(inv: any)`.
- **Zod for all boundaries.** Every tRPC input uses Zod. Every external API response is parsed with Zod. No `as any` type assertions.
- **Shared types.** Export input/output types from routers for frontend reuse via `RouterOutput['procedure']`.

### Naming Conventions
```
Files:           kebab-case          (billing-profile.ts, invoice-wizard.tsx)
Components:      PascalCase          (InvoiceWizard, BillingProfileDrawer)
Functions:       camelCase           (getInvoiceKpis, formatCurrency)
Types/Interfaces: PascalCase         (InvoiceLineItem, BillingProfile)
Constants:       SCREAMING_SNAKE     (SYSTEM_ROLES, STATUS_TABS)
DB fields:       camelCase           (organizationId, createdAt)
DB columns:      snake_case via @map (organization_id, created_at)
DB tables:       snake_case via @@map (invoice_line_items, billing_profiles)
Boolean fields:  is/has prefix       (isActive, isPlatformOwner, hasAccepted)
```

### File Size Limits
- **Max 300 lines per component file.** If a page exceeds this, extract subcomponents.
- **Max 500 lines per router file.** Split into sub-routers if growing beyond this.
- **One component per file.** No defining `CreateModal`, `EditDrawer`, and `DetailView` in the same `page.tsx`. Extract to sibling files.

### Frontend Patterns
- **Shared UI components.** Build and use `@tims/ui` for: `KpiCard`, `DataTable`, `StatusBadge`, `EmptyState`, `Modal`, `Drawer`, `SearchInput`, `Pagination`. No duplicating table/pagination/badge code across pages.
- **Form library.** Use `react-hook-form` + Zod resolver for all forms. No raw `useState` per field.
- **Error handling on all mutations.** Every `useMutation` MUST have `onError` that shows a toast/notification.
- **Loading + Error + Empty states.** Every query-backed page must handle all 3 states explicitly.
- **No hardcoded strings.** ALL user-facing text goes through `lib/i18n`. No inline Spanish. Status labels, button text, empty state messages — everything in `es.json`/`en.json`.

### CSS / Tailwind
- **Design tokens over hex codes.** Define color aliases in Tailwind config:
  ```
  brand-dark: #1F114C    text-muted: #8B8B8B    text-primary: #333333
  brand-red: #DD0C15     border-light: #EDEDED   bg-surface: #F6F6F6
  ```
  Use `bg-brand-dark` not `bg-[#1F114C]`. Use `text-muted` not `text-[#8B8B8B]`.
- **No inline `style={{}}`.** All styling through Tailwind classes.
- **No magic numbers.** Use Tailwind spacing scale. `text-[10px]` → define a `text-badge` utility.

---

## 3. Security Requirements (CRITICAL)

### SQL Injection
- **NEVER use `$executeRawUnsafe` with string interpolation.** Use parameterized queries:
  ```typescript
  // WRONG - SQL injection risk
  await db.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${orgId}'`);
  // RIGHT
  await db.$executeRaw`SET LOCAL app.current_org_id = ${orgId}`;
  ```

### Multi-Tenancy & RLS
- **Every tenant-scoped query MUST filter by organizationId.** This is non-negotiable. Defense in depth: Supabase RLS policies AND application-level `WHERE organizationId = ?`.
- **IDOR prevention.** Every mutation that targets a resource by ID must verify the resource belongs to the current user's org:
  ```typescript
  // WRONG
  db.user.update({ where: { id: input.userId }, data: { ... } });
  // RIGHT
  db.user.update({ where: { id: input.userId, organizationId: ctx.user.organizationId }, data: { ... } });
  ```
- **Platform owner RLS.** Even platform owners should go through RLS with an elevated role, not bypass it entirely.

### Authentication & Authorization
- **Public procedures are rare.** Only `getInvitationByToken` and `acceptInvitation` are public. Everything else requires `protectedProcedure` or `platformProcedure`.
- **Token validation.** Invitation tokens must be validated for format (UUID) and rate-limited to prevent enumeration.
- **Permission checks.** All role-based checks must hit the database. Never trust client-side role claims alone.

### Input Validation
- **Bound all string inputs.** `.min(1).max(500)` on descriptions, `.max(100)` on names. No unbounded `z.string()`.
- **Bound all array inputs.** `.max(50)` on line items, `.max(100)` on bulk operations.
- **Validate email formats.** Use `z.string().email()` for all email fields.
- **Sanitize HTML in emails.** Never inject raw user input into email HTML templates. Escape with a utility.

### Rate Limiting
- **Production requirement: Redis/Upstash.** In-memory `Map` rate limiter does not work across instances. Replace before production.
- **IP-based limiting.** Do not trust `X-Forwarded-For` alone. Use the actual request IP from the platform (Vercel provides this).

### Secrets & Credentials
- **No secrets in code.** All credentials in `.env` / environment variables.
- **Validate env at startup.** Use Zod to parse `process.env` and fail fast on missing vars.
- **Never return tokens in API responses.** Invitation tokens are one-use, one-way. Never expose Supabase service keys, AWS credentials, or session tokens.

---

## 4. Database Standards

### Schema Conventions
- **Every model has `id` (UUID), `createdAt`, `updatedAt`.** No exceptions.
- **Every tenant-scoped model has `organizationId` with `@@index([organizationId])`.** No exceptions.
- **Every foreign key has an `@@index`.** Prisma does not auto-create indexes for relations.
- **Cascade deletes are explicit.** Every `@relation` must specify `onDelete:` behavior. Default to `Cascade` for owned resources, `SetNull` for references.
- **Use Prisma enums for status/type fields.** No raw strings for statuses. Define:
  ```prisma
  enum InvoiceStatus { draft pending paid void }
  enum InvitationStatus { pending sent accepted expired revoked }
  enum VacancyStatus { draft open closed archived on_hold }
  ```
- **Soft delete consistency.** If a model supports soft delete (`deletedAt`), ALL queries must filter `WHERE deletedAt IS NULL` by default. Consider Prisma middleware for this.
- **Invoice numbering is org-scoped.** `invoiceNumber` should be unique per org, not globally. Use compound unique `@@unique([organizationId, invoiceNumber])`.

### Migration Discipline
- **Use `prisma db push` for development only.** Production uses `prisma migrate dev` → `prisma migrate deploy`.
- **Never `--accept-data-loss` in production.** Only in development with empty/test data.
- **Schema changes are reviewed.** Every `.prisma` file change requires checking for missing indexes, cascades, and RLS implications.

---

## 5. AI Agent Architecture

> Full technical doc: `docs/AI-AGENT-ARCHITECTURE.md`

### Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mono vs micro | **Monorepo** (`packages/ai`) | Zero latency overhead, full type safety, same deploy. Extract only if AI blocks non-AI requests. |
| MCP Server | **No** | 32 fixed agents, single vendor (Bedrock). MCP solves multi-vendor dynamic discovery we don't need. |
| Framework | **Custom on Vercel AI SDK + Zod** | 81% of agents are single-shot structured calls. No framework overhead. ~800 LOC custom pipeline. |
| Execution | **Hybrid** | 6 real-time agents (streaming via Vercel AI SDK), 26 batch agents (Trigger.dev + Bedrock Batch API, 50% savings). |
| Observability | **`ai_invocations` table + Helicone** | $0/mo. Tracks cost, latency, cache hits. Add Helicone for dashboards. |

### Agent Pipeline (8 steps)
```
Request → Budget Check → Cache Lookup → PII Strip → Bedrock Call → Output Validation → PII Re-inject → Audit Log
```

### Guardrails
- **System prompt hardening.** Treat all user-provided content (CVs, job descriptions) as DATA, never as INSTRUCTIONS. Use XML delimiters: `<candidate_cv>...</candidate_cv>`.
- **Input sanitization.** Strip known injection patterns from user content before including in prompts.
- **Zod output validation.** 100% of agent outputs are parsed with Zod schemas. Malformed responses are rejected and retried.
- **Tool-level permissions.** Agent permission matrix: CV Parser can access `candidates` table but NOT `salary_adjustments`. Enforced at context construction — agents never see data they shouldn't.
- **Per-org budget enforcement.** Hard monthly limits stored in `AiAgentOrgConfig.monthlyBudget`. Check before every invocation. Alert at 80%, block at 100%.

---

## 6. PII Handling (CRITICAL for HR Data)

### Architecture: PII Proxy Layer
```
App → PII Proxy (strip PII) → AWS Bedrock → PII Proxy (re-inject PII, validate output) → App
```

### PII Classification for HR
```
CRITICAL (never reaches LLM):  SSN, bank accounts, medical info, criminal records, drug tests
HIGH (tokenized before LLM):   Full name, salary, home address, DOB, phone, personal email
MEDIUM (anonymized):            Job title + dept, employment dates, education
LOW (pass through, log access): Generic job descriptions, company policies
```

### Implementation
- **Detection:** Microsoft Presidio (open-source, self-hosted in VPC) + custom HR recognizers (salary patterns, visa numbers, Colombian cedula).
- **Tokenization:** Deterministic tokens scoped to request context. `"John Smith" → "<<PERSON_1>>"`. Same value always maps to same token within a conversation.
- **Re-injection:** After LLM response, tokens are replaced with original values. Vault is destroyed immediately after response.
- **Second pass:** Re-scan LLM output with Presidio to catch any PII that leaked through tokenization.
- **Bedrock Guardrails:** Enabled as safety net (MASK mode on all PII types). Defense in depth.
- **Token vault:** In-memory only, per-request scoped, tenant-isolated, NEVER persisted to disk/Redis/DB.

### Compliance
- **Colombian Habeas Data (Ley 1581/2012):** Prior express consent required. AI processing clause in candidate consent forms. Data processing registry with SIC.
- **GDPR:** Data minimization, DPIA before AI deployment, right to explanation for AI-influenced hiring decisions.
- **CCPA/CPRA 2026:** Full consumer rights apply to California employee data. Privacy risk assessments required.
- **AWS Bedrock DPA:** Signed. Data encrypted in transit/rest. Bedrock does NOT train on customer data.

### Audit Logging (PII-free)
```json
{
  "tenant_id": "org_abc",
  "user_id": "user_123",
  "action": "ai_candidate_analysis",
  "model": "claude-sonnet",
  "pii_types_detected": ["PERSON", "SALARY"],
  "pii_count": 4,
  "critical_pii_blocked": ["US_SSN"],
  "tools_invoked": ["search_candidates"],
  "duration_ms": 2340,
  "status": "success"
}
```
- **Never log:** Actual prompts, responses, token vault contents, raw DB results.
- **Retention:** Audit logs 7 years. Debug logs (encrypted) 30 days auto-purge. Token vaults destroyed per-request.

---

## 7. Known Issues & Fix Priority

### Critical (fix before production)
| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1 | SQL injection in RLS middleware | `api/src/trpc.ts:54` | Change `$executeRawUnsafe` to `$executeRaw` template literal |
| 2 | IDOR in user.deactivate | `api/src/routers/user.ts:167` | Add `organizationId` to WHERE clause |
| 3 | Platform owners bypass RLS entirely | `api/src/trpc.ts:42` | Use elevated role, not skip |
| 4 | In-memory rate limiter | `api/src/middleware/rate-limit.ts` | Replace with Upstash Redis |
| 5 | All status fields are raw strings | All `.prisma` files | Convert to Prisma enums |

### High (fix before scaling)
| # | Issue | Fix |
|---|-------|-----|
| 6 | 45+ `any` casts in frontend | Type all tRPC responses properly |
| 7 | All user-facing strings hardcoded in Spanish | Move to i18n JSON files |
| 8 | No ESLint/Prettier config | Add root `.eslintrc.json` + `.prettierrc` |
| 9 | No error callbacks on mutations | Add `onError` toast to every `useMutation` |
| 10 | Missing indexes on 15+ foreign keys | Add `@@index` to all FK fields |
| 11 | No env validation | Add Zod env parser at startup |
| 12 | God components (600+ LOC pages) | Extract to subcomponents |
| 13 | No accessibility (zero aria-labels, no focus traps) | Full a11y pass |
| 14 | Modals lack role="dialog" and focus trap | Fix all modals |

---

## 8. Commit & PR Standards

### Commit Messages
```
feat(invoices): add Mercury-style invoice creation wizard
fix(security): parameterize RLS query to prevent SQL injection
refactor(ui): extract KpiCard shared component
chore(db): add missing indexes to FK fields
```

### Branch Naming
```
feat/invoice-wizard
fix/rls-sql-injection
refactor/extract-shared-components
```

### PR Requirements
- All PRs must pass `tsc --noEmit` on both `@tims/api` and `@tims/web`
- Schema changes must include migration + index review
- Security-related changes require explicit review note
- No `any` types introduced
- No hardcoded strings in UI

---

## 9. Development Commands

```bash
# Start dev server
cd apps/web && pnpm dev

# Type check
pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit

# Push schema (dev only)
cd packages/db && npx prisma db push --schema=prisma/schema

# Seed database
cd packages/db && npx tsx prisma/seed.ts

# Generate Prisma client
cd packages/db && npx prisma generate
```
