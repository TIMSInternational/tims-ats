# Phase 3 HRIS scaffold — deferred follow-ups

Tracks the deliberate deferrals in the Phase-3 HRIS scaffold (`services/Tims.Platform`, EF-owned
`hris_*` tables) — items reviewed and consciously left for a later phase, with the rationale and the
trigger that should reopen them. Surfaced by the whole-branch Codex (FIX-FIRST) + opus reviews; the
FIX-FIRST blockers were closed in the remediation pass, these are the accepted-for-now residuals.

Anchor comments live at each code site (search the noted file); this doc is the index.

## 1. Employee upsert is read-then-insert, not `ON CONFLICT` — Phase 4 [Codex Med#1-employee]

`HrisSyncRepository.PersistRecordsAsync` reads the existing external-ids (PII-free projection) and then
inserts the rest / `ExecuteUpdate`s the matches. Safe **today**: a connector is swept by exactly one
in-flight run (the idempotency short-circuit + the run-creation unique-violation guard prevent a second
concurrent run for the same connector), and the `(organization_id, connector_id, external_id)` unique
index is the hard net. It is a check-then-act race only once **concurrent** writers for the same
connector become possible.

- **Convert when**: manual triggers / parallel sweeps for one connector land (Phase 4).
- **To**: `INSERT … ON CONFLICT (organization_id, connector_id, external_id) DO UPDATE` (source wins),
  or take a per-connector `pg_advisory_xact_lock` for the persist transaction.

## 2. `raw_payload` stores the full directory field-bag (Confidential) [Codex Med#2 / opus M3]

`BambooHrConnector.ParseEmployee` copies every non-`id` property into the source field-bag, and
`RunHrisSyncUseCase` serializes the whole `HrisSourceEmployee` into `hris_external_employees.raw_payload`.
Acceptable **today** because the pull is the **directory** endpoint (`employees/directory`) — a bounded,
low-sensitivity field set — and the table is RLS-protected + classified Confidential (fail-soft audited).

- **Re-classify / allowlist / redact when**: the pull ever widens past the directory endpoint (e.g.
  `FetchEmployeeAsync`'s `fields=all`, or a directory config that requests sensitive fields). At that
  point add an explicit field allowlist before serialize, treat/encrypt `raw_payload` as higher
  sensitivity, and add explicit read controls.

## 3. Privileged connector read has no org filter — worker-internal only [Codex Low#1]

`HrisConnectorReadRepository` reads `hris_connectors` on the **owner** connection (bypasses RLS), by
connector id, with no org predicate — correct for the background sweep (no JWT/tenant context) and safe
because it projects **config columns only** (never employee PII). It is dangerous **only** if reused for
a tenant-triggered path.

- **Before any API / manual-trigger path uses it**: add an **org-filtered variant** that runs under
  `TenantScope` (org GUC) so RLS enforces isolation — never call the privileged owner-read from a
  request-scoped/tenant path.

## 4. No DB foreign keys between `hris_*` tables — deliberate [opus L3]

The four `hris_*` tables carry no FK constraints (e.g. `hris_external_employees.connector_id` →
`hris_connectors.id`). Deliberate under RLS coexistence: cross-row references are **app-enforced** (the
sync writes both sides under one tenant scope), matching the Prisma-side convention, and avoiding FK
enforcement that fights per-tenant RLS / partial writes. Revisit only if an integrity incident shows an
app gap.

## 5. Already-soft-deleted rows are re-touched each sweep — accepted churn [opus L4]

A row absent from the source snapshot is soft-marked (`is_deleted_in_source = true`) every sweep it stays
absent — so an already-soft-deleted row's `last_sync_run_id` / `updated_at` are re-stamped each run
(a redundant `ExecuteUpdate`). Minor, bounded write churn; not worth a "skip already-deleted" branch at
scaffold scale. Optimize only if soft-delete volume makes it measurable.

## 6. Deploy-verify (prod cutover) [opus deploy-verify]

- The privileged connector read requires connecting as the **BYPASSRLS pooler role** (as with the
  Phase-2 pre-tenant identity/API-key reads); on the plain `app_tenant` role with no org GUC it returns
  **0 rows** and the sweep silently no-ops.
- Seed `principals` / the `HrisSystemActor` row so the fail-soft audit attributes correctly.
- Wire the **AWS Secrets Manager** connector-secret store (WP3.4) — prod must resolve each connector's
  `secret_ref` to a real key; the dev `EnvConnectorSecretStore` is local-only.
- Each active connector row MUST carry both `secret_ref` and `subdomain` (the sync **fails closed**
  without them — no global fallback).
- The `20260716000000_hris_domain` migration is **uncommitted + never applied to prod**; it was amended
  in place to add the `subdomain` column (still deterministic, RLS/GRANTs intact).
