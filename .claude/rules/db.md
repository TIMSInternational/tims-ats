---
paths:
  - "packages/db/**"
  - "packages/api/**"
---
<!-- packages/api/** is in scope because Prisma queries are WRITTEN in
     packages/api/src/repositories/ — the Prisma/Supabase safety rules
     below must load when editing query code, not only the schema. -->

# Database Standards, Prisma & Supabase Safety

## Schema Conventions

- Every model: `id` (UUID), `createdAt`, `updatedAt`.
- Every tenant model: `organizationId` with `@@index([organizationId])`.
- Every FK: `@@index`. Prisma does NOT auto-create.
- Cascades: explicit `onDelete:` on every `@relation`.
- **Prisma enums** for all status/type fields: `InvoiceStatus`, `OrgPlan`, `SubscriptionStatus`, `InvitationType`, `InvitationStatus`, `Gender`, `Ethnicity`, `DisabilityStatus`.
- **Org-scoped uniqueness**: `@@unique([organizationId, invoiceNumber])`.

## Prisma Safety Rules

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

## Supabase Safety Rules

- **RLS enabled on EVERY table.** Tables have RLS off by default. This single misconfiguration caused CVE-2025-48757 (170+ apps exposed).
- **Never use `service_role` key client-side.** It bypasses ALL RLS. Only the `anon` key in browser code.
- **Audit RLS policies quarterly.** New tables = new policies. No exceptions.
- **Tenant RLS is live:** migration `20260604100000_enable_rls_tenant_isolation`, fail-closed `tenant_isolation` policy on 81 tables, `tenant-client.ts` (`tenantDb`) enforces `SET LOCAL ROLE app_tenant` + org GUC per transaction. See `.claude/rules/api-security.md` §Multi-Tenancy.

## Connection Pooling (Critical for Scale)

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

## Read Replicas

- Use `@prisma/extension-read-replicas` to route reads to replica.
- Dashboard KPIs, reports, analytics hit read replica. Writes hit primary.
- After a write, use `db.$primary()` if immediate consistency needed.

## Migration Discipline

- `prisma db push` for dev only. Production: `prisma migrate dev` → `prisma migrate deploy`.
- Never `--accept-data-loss` in production.
