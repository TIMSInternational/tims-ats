# Table-Ownership Ledger (CI-enforced)

Date: 2026-07-15 · Status: **Active, CI-enforced (WP1.7).**
Parent: `csharp-migration/00-master-plan.md` §4 (One DDL path) + `phase-1-runway-and-spikes.md` WP1.7.

During the C#/.NET convergence, **two ORMs coexist** (Prisma today, EF Core as domains are
built/strangled). Exactly one owns the DDL of each table. This ledger is the source of truth,
and `scripts/table-ownership.mjs` (run by both CIs, asserted by `tests/governance/table-ownership.test.ts`)
**fails any PR that lets one ORM mutate a table the other owns.**

## The rule

- **`defaultOwner: prisma`** — every table mapped in `packages/db/prisma/schema/*.prisma`
  (`@@map("…")`) is Prisma-owned. Prisma is authoritative for all product tables today.
- **`efcore`** — the explicit allow-list of tables owned by EF Core / `Tims.Platform`. A table
  here must **NOT** also be `@@map`'d in the Prisma schema (that is a cross-owner conflict → red build).
  Every new EF-owned table (Phase 3 HRIS onward) is added here in the same PR that creates it, and
  ships its RLS block via `EnableTenantRls()` (org-scoped tables only).

A migration authored by one owner that touches a table owned by the other is a merge blocker.
Ownership transfers (Phase 5 strangler) move a table from `prisma` to `efcore` in one reviewed step.

## Ledger

<!-- machine-readable: parsed by scripts/table-ownership.mjs. Keep this the ONLY json block. -->
```json
{
  "defaultOwner": "prisma",
  "efcore": [
    "widgets"
  ],
  "notes": {
    "widgets": "Phase-1 Spike A test-only table (Testcontainers DDL + TenantWidgetDbContext). NOT a product table; created by hand-authored test SQL, never by an EF migration against prod."
  }
}
```

## What the CI check enforces (Phase 1)

1. **No cross-owner collision:** no table in `efcore[]` may appear as a Prisma `@@map` table.
   (Catches a Prisma model silently re-declaring an EF-owned table, or an EF table added without
   first removing the Prisma one during a strangler transfer.)
2. **EF ownership is registered:** the only EF-mapped table in `Tims.Platform`
   (`TenantWidgetDbContext` → `widgets`) is present in `efcore[]`. A new EF `ToTable(...)` not
   listed here fails the check (forces the ledger update to accompany the schema change).

Later phases extend check #2 to parse every EF `ToTable`/migration and every Prisma migration for
the tables they mutate; Phase 1 keeps it deterministic against the single spike table.
