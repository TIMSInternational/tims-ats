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
    "widgets",
    "hris_connectors",
    "hris_external_employees",
    "hris_sync_runs",
    "hris_sync_record_errors"
  ],
  "efcoreReadOnly": [
    "users",
    "user_roles",
    "roles",
    "organizations",
    "api_keys",
    "role_permissions",
    "permissions",
    "teams",
    "user_teams",
    "user_business_units",
    "business_units",
    "interview_evaluators",
    "interviews",
    "candidates"
  ],
  "efcoreAppendOnly": [
    "data_access_logs"
  ],
  "notes": {
    "widgets": "Phase-1 Spike A test-only table (Testcontainers DDL + TenantWidgetDbContext). NOT a product table; created by hand-authored test SQL, never by an EF migration against prod.",
    "hris": "Phase-3 HRIS (WP3.1): the FIRST EF-OWNED product tables — EF holds the DDL (migration 20260716000000_hris_domain, HrisDbContext) AND writes them. NOT @@map'd in Prisma. Deliberately `hris_`-prefixed so they are DISTINCT from the live Prisma-owned `connectors`/`connector_syncs`/`sync_errors` integration tables (reusing those names would be a cross-owner collision → red build). All four are org-scoped, so the migration wraps each with EnableTenantRls (ENABLE + FORCE ROW LEVEL SECURITY + fail-closed tenant_isolation policy) and GRANTs SELECT/INSERT/UPDATE/DELETE to app_tenant; every read/write runs UNDER TenantScope. Proven for real in Testcontainers (HrisRlsTests): org isolation, unset-GUC fail-closed, WITH-CHECK insert block.",
    "efcoreReadOnly": "Phase-2 identity plane reads these Prisma-OWNED tables via EF (IdentityDbContext, no writes) to resolve principals + API keys and to enforce permissions (WP2.5 reads role_permissions + permissions joined to roles for the grant fetch). WP2.5b adds the AnchorDbContext read-only maps (teams, user_teams, user_business_units, business_units, interview_evaluators, interviews) for the EF anchor loaders + the AssertScoped IDOR probe — run UNDER TenantScope (app_tenant/RLS), SELECT only. The candidate-resolution WP adds `candidates` (IdentityDbContext maps id, organization_id, email, is_active, deleted_at) — the privileged pre-tenant read that resolves the 4th principal type (a portal Supabase session with no staff User row → PrincipalType.Candidate by email+org), read-only like the rest. Prisma keeps the DDL; EF only SELECTs. NOT an ownership transfer — they still appear in the Prisma schema (that is expected, not a collision). Writes stay on the owning (Prisma/tRPC) stack until a Phase-5 strangler transfers a domain.",
    "efcoreAppendOnly": "WP2.7 audit plane: data_access_logs is Prisma-OWNED for schema/migrations. The C# WRITER (DataAccessAuditDbContext + DataAccessAuditWriter) only APPENDS — it INSERTs one audit row per sensitive read/export UNDER TenantScope (app_tenant + org GUC) so the RLS WITH CHECK passes, and it NEVER issues UPDATE/DELETE and touches no other table. IMPORTANT — append-only is a WRITER discipline, NOT yet a DB-enforced invariant: the live migration (20260612000000_access_control_models) still GRANTs UPDATE, DELETE on data_access_logs to app_tenant, and the tenant RLS policy only constrains rows to the caller's org — so a tenant-role SQLi/bug could still alter or erase same-org audit rows. DB-level insert-only enforcement is an OPEN security follow-up (see below). This category is deliberately NOT `efcore` (Prisma still owns the DDL — labeling it EF-OWNED would be a cross-owner collision) and NOT `efcoreReadOnly` (C# genuinely writes it — labeling it read-only would be dishonest). Like efcoreReadOnly, the table still appears in the Prisma schema — expected, not a collision."
  }
}
```

- **`efcore`** — EF-OWNED (DDL + writes). Must NOT be `@@map`'d in Prisma.
- **`efcoreReadOnly`** — Prisma-OWNED, EF reads only. MUST be `@@map`'d in Prisma.
- **`efcoreAppendOnly`** — Prisma-OWNED (DDL/migrations), EF INSERT-only. MUST be `@@map`'d in Prisma. C#
  appends rows (never UPDATE/DELETE) under tenant RLS; it is the honest middle category for the audit
  writer — neither a full ownership transfer nor read-only. **Append-only here is a C# WRITER discipline,
  not a DB-enforced invariant** (see the security follow-up below). Every EF `ToTable(...)` in
  `Tims.Platform` must appear in one of the three lists, or the CI check fails.

## Security follow-up — DB-enforce insert-only on `data_access_logs` (OPEN, Federico)

The audit ledger is append-only at the C# writer, but **not yet at the database**. The live migration
`20260612000000_access_control_models` GRANTs `UPDATE, DELETE` on `data_access_logs` to `app_tenant`
(line ~84), and the tenant RLS policy (line ~99) only scopes rows to the caller's org — so a tenant-role
SQL-injection or application bug could still **alter or erase same-org audit rows** after a restricted
read. To make append-only a real invariant, a **prod migration (owner action — Federico)** should:

1. `REVOKE UPDATE, DELETE ON data_access_logs FROM app_tenant;` (keep `INSERT`, `SELECT`).
2. Add an insert-only guard — a `BEFORE UPDATE OR DELETE` trigger that `RAISE`s (or an RLS policy with a
   `USING (false)` clause for `UPDATE`/`DELETE`) — so even a future accidental grant cannot mutate the ledger.

This is DOC-ONLY here (no migration/DB change in this slice); `scripts/table-ownership.mjs` continues to
treat `data_access_logs` as Prisma-owned + EF append-only.

## What the CI check enforces (Phase 1)

1. **No cross-owner collision:** no table in `efcore[]` may appear as a Prisma `@@map` table.
   (Catches a Prisma model silently re-declaring an EF-owned table, or an EF table added without
   first removing the Prisma one during a strangler transfer.)
2. **EF ownership is registered:** the only EF-mapped table in `Tims.Platform`
   (`TenantWidgetDbContext` → `widgets`) is present in `efcore[]`. A new EF `ToTable(...)` not
   listed here fails the check (forces the ledger update to accompany the schema change).

Later phases extend check #2 to parse every EF `ToTable`/migration and every Prisma migration for
the tables they mutate; Phase 1 keeps it deterministic against the single spike table.
