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
    "candidates",
    "assessment_results",
    "assessment_assignments",
    "assessment_types"
  ],
  "efcoreAppendOnly": [
    "data_access_logs"
  ],
  "efcoreStranglerWrite": [
    "preemployment_validations"
  ],
  "notes": {
    "widgets": "Phase-1 Spike A test-only table (Testcontainers DDL + TenantWidgetDbContext). NOT a product table; created by hand-authored test SQL, never by an EF migration against prod.",
    "hris": "Phase-3 HRIS (WP3.1): the FIRST EF-OWNED product tables — EF holds the DDL (migration 20260716000000_hris_domain, HrisDbContext) AND writes them. NOT @@map'd in Prisma. Deliberately `hris_`-prefixed so they are DISTINCT from the live Prisma-owned `connectors`/`connector_syncs`/`sync_errors` integration tables (reusing those names would be a cross-owner collision → red build). All four are org-scoped, so the migration wraps each with EnableTenantRls (ENABLE + FORCE ROW LEVEL SECURITY + fail-closed tenant_isolation policy) and GRANTs SELECT/INSERT/UPDATE/DELETE to app_tenant; every read/write runs UNDER TenantScope. Proven for real in Testcontainers (HrisRlsTests): org isolation, unset-GUC fail-closed, WITH-CHECK insert block.",
    "efcoreReadOnly": "Phase-2 identity plane reads these Prisma-OWNED tables via EF (IdentityDbContext, no writes) to resolve principals + API keys and to enforce permissions (WP2.5 reads role_permissions + permissions joined to roles for the grant fetch). WP2.5b adds the AnchorDbContext read-only maps (teams, user_teams, user_business_units, business_units, interview_evaluators, interviews) for the EF anchor loaders + the AssertScoped IDOR probe — run UNDER TenantScope (app_tenant/RLS), SELECT only. The candidate-resolution WP adds `candidates` (IdentityDbContext maps id, organization_id, email, is_active, deleted_at) — the privileged pre-tenant read that resolves the 4th principal type (a portal Supabase session with no staff User row → PrincipalType.Candidate by email+org), read-only like the rest. Prisma keeps the DDL; EF only SELECTs. NOT an ownership transfer — they still appear in the Prisma schema (that is expected, not a collision). Writes stay on the owning (Prisma/tRPC) stack until a Phase-5 strangler transfers a domain. Phase-5 Slice 1 (the FIRST strangler) adds `assessment_results`, `assessment_assignments`, `assessment_types` — the external-vendor assessment READ surface (ExternalAssessmentDbContext, SELECT-only, AsNoTracking) run UNDER TenantScope (app_tenant/RLS), joined result⋈assignment⋈type and gated completed-only. This is a READ port only: no ownership flip, no coexistence write — the TS `external-assessment` router/service/repo still serves prod (cutover deploy-gated/deferred). Prisma keeps the DDL.",
    "efcoreStranglerWrite": "Phase-5 Slice 2: preemployment_validations is Prisma-OWNED (DDL/migrations) AND is written by the TS STAFF path (updateValidation, sets completed_by_id). This slice ports ONLY the external-vendor write (external.submitValidationResult): the C# WRITER (ExternalValidationDbContext + ExternalValidationRepository) performs ONE documented atomic pending-only UPDATE — status/result/notes + vendor provenance (completed_by_api_key_id set, completed_by_id null; the DB CHECK preemployment_validations_single_completer_chk enforces the XOR) — UNDER TenantScope (app_tenant + org GUC) so RLS engages. It NEVER issues DDL and touches no other table. This is NOT `efcore` (Prisma still owns the DDL — labeling it EF-OWNED would be a cross-owner collision), NOT `efcoreReadOnly` (C# genuinely writes it), and honestly stronger than `efcoreAppendOnly` (an UPDATE, not append). The one-active-writer guarantee is a REAL runtime FACT, not just a ledger claim: the C# write route is mapped ONLY when the deploy flag `Platform:ExternalVendorWriteEnabled` is true, and it DEFAULTS false (dark) — so deploying Tims.Api adds NO second live writer (a request 404s) and TS stays the sole active writer until Federico flips the flag per-surface at canary (dark → canary → full). (The Slice-1 read surface is gated the same way by `Platform:ExternalVendorReadEnabled`.) The build-time OpenAPI document still describes the routes — GetDocument.Insider forces them mapped during generation — so the contract stays accurate while runtime stays dark. FULL ownership flip to `efcore` is the sequenced completing step, BLOCKED on ALSO migrating the staff updateValidation write — the whole preemployment_validations write surface must flip together, else two stacks write one table (one-writer violation). Until then the table stays here and TS is the active writer; cutover (route the vendor submit → C#, canary, prod-verify) is deploy-gated/deferred. Like efcoreReadOnly/efcoreAppendOnly, the table still appears in the Prisma schema — expected, not a collision.",
    "efcoreAppendOnly": "WP2.7 audit plane: data_access_logs is Prisma-OWNED for schema/migrations. The C# WRITER (DataAccessAuditDbContext + DataAccessAuditWriter) only APPENDS — it INSERTs one audit row per sensitive read/export UNDER TenantScope (app_tenant + org GUC) so the RLS WITH CHECK passes, and it NEVER issues UPDATE/DELETE and touches no other table. IMPORTANT — append-only is a WRITER discipline, NOT yet a DB-enforced invariant: the live migration (20260612000000_access_control_models) still GRANTs UPDATE, DELETE on data_access_logs to app_tenant, and the tenant RLS policy only constrains rows to the caller's org — so a tenant-role SQLi/bug could still alter or erase same-org audit rows. DB-level insert-only enforcement is an OPEN security follow-up (see below). This category is deliberately NOT `efcore` (Prisma still owns the DDL — labeling it EF-OWNED would be a cross-owner collision) and NOT `efcoreReadOnly` (C# genuinely writes it — labeling it read-only would be dishonest). Like efcoreReadOnly, the table still appears in the Prisma schema — expected, not a collision."
  }
}
```

- **`efcore`** — EF-OWNED (DDL + writes). Must NOT be `@@map`'d in Prisma.
- **`efcoreReadOnly`** — Prisma-OWNED, EF reads only. MUST be `@@map`'d in Prisma.
- **`efcoreAppendOnly`** — Prisma-OWNED (DDL/migrations), EF INSERT-only. MUST be `@@map`'d in Prisma. C#
  appends rows (never UPDATE/DELETE) under tenant RLS; it is the honest middle category for the audit
  writer — neither a full ownership transfer nor read-only. **Append-only here is a C# WRITER discipline,
  not a DB-enforced invariant** (see the security follow-up below).
- **`efcoreStranglerWrite`** — Prisma-OWNED (DDL/migrations), EF performs a specific documented UPDATE
  during an in-progress Phase-5 strangler. MUST be `@@map`'d in Prisma. The honest middle between
  `efcoreAppendOnly` (INSERT-only) and `efcore` (owned): C# genuinely UPDATEs the table, but Prisma still
  owns the DDL **and another (staff) write path**, so a REAL deploy flag keeps exactly ONE active runtime
  writer. The flag is `Platform:ExternalVendorWriteEnabled` (**default false / dark**): when off, the C#
  write route is NOT mapped (a request 404s), so deploying Tims.Api activates no second writer — Federico
  flips it per-surface at canary. **The full ownership flip to `efcore` is BLOCKED on ALSO migrating that
  staff write** (the whole table's write surface flips together, else two stacks write one table =
  one-writer violation) — the documented, sequenced completing step. Phase-5 Slice 2 registers
  `preemployment_validations` here (the external-vendor `submitValidationResult` write).

  Every EF `ToTable(...)` in `Tims.Platform` must appear in one of the four lists, or the CI check fails.

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
