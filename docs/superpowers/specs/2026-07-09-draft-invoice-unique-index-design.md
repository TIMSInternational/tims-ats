# Slice 2b.1 — Draft-invoice period uniqueness (close duplicate-draft race)

> Status: approved | Date: 2026-07-09 | Depends on: Slice 2b (usage billing, prod `a1211a3`)

## Goal

Prevent a concurrent race in `generateUsageInvoice` (slice 2b) from creating two DRAFT
usage invoices for the same `(organization_id, period_start, period_end)`. The pre-check
(`findDraftInvoiceForPeriod` → CONFLICT) and the UI disable-while-pending mitigation both
exist; this adds the authoritative DB-level guard + graceful error mapping.

## Design

### 1. Migration (raw SQL — Prisma cannot express a partial unique index)
New migration `packages/db/prisma/migrations/20260709000000_add_draft_invoice_period_unique/migration.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_period_draft_key"
  ON "invoices" ("organization_id", "period_start", "period_end")
  WHERE status = 'draft' AND period_start IS NOT NULL AND period_end IS NOT NULL;
```
Partial: constrains only draft usage invoices (period non-null). A period may still later
hold a pending/paid/void invoice; non-usage invoices (null periods) are unaffected. Like the
entitlements RLS, this index is a raw prod artifact not represented in the Prisma schema —
documented; prod applies DDL via `prisma db execute` (not migrate/push).

### 2. App-level P2002 handling
In `packages/api/src/routers/platform/usage-billing.ts` `generateUsageInvoice`: wrap the
`createUsageInvoice` call; if it throws a Prisma `P2002` unique-constraint error, throw
`TRPCError({ code: 'CONFLICT', message: 'draft_invoice_exists' })` — identical to the
pre-check response. The pre-check stays as the common-case fast path; the constraint is the
race-proof backstop. (Detect via `Prisma.PrismaClientKnownRequestError` + `err.code === 'P2002'`,
imported from `@prisma/client`.)

### 3. Prod apply (env already at prod; like slice 1)
1. Pre-check prod for existing duplicate draft-usage rows
   (`SELECT organization_id, period_start, period_end, count(*) FROM invoices WHERE status='draft'
   AND period_start IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1`) — must be zero.
2. `prisma db execute --file <migration.sql> --url "$DIRECT"` (packages/db/.env DATABASE_URL = direct :5432).
3. Verify via `pg_indexes` that `invoices_org_period_draft_key` exists.

## Testing (mock-based)
- Router test: mock `createUsageInvoice` to reject with a `P2002`-shaped
  `PrismaClientKnownRequestError`; assert `generateUsageInvoice` → `CONFLICT` (`draft_invoice_exists`),
  not a 500/uncaught. Keep the existing pre-check CONFLICT + zero-billable BAD_REQUEST tests green.

## Out of scope
- Converting the pre-check into a transaction (the DB constraint makes it unnecessary).
- Any change to preview / pricing / metering logic.
