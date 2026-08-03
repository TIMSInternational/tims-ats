# DDL governance — how schema changes reach production

> **Issue #115.** This replaces the aspirational "One DDL path" bullet in
> `csharp-migration/00-master-plan.md` §4 with what is actually true and actually enforced.
> Evidence: [`ddl-reconciliation-2026-08-03.md`](./ddl-reconciliation-2026-08-03.md).
>
> **The rule that generates every other rule here:** the repository is not evidence about production.
> #111 put RLS policies in prod that existed in zero repo files and survived every gate for ~14
> months. §3a of the reconciliation found a production column that exists in **no repo file, no commit,
> and none of the three migration-history tables**. Any control that reads only the repo is not a
> control.

## 1. Ground truth

[`packages/db/baseline/prod-public-schema.sql`](../../packages/db/baseline/prod-public-schema.sql) —
`pg_dump --schema-only` of `public` + `supabase_migrations`, committed and reviewable.

```bash
bash scripts/db/schema-baseline.sh capture   # refresh, then REVIEW THE GIT DIFF
bash scripts/db/schema-baseline.sh check     # /gate check 16 — diff live vs committed
```

Scoped to schemas we own. `auth`, `storage`, `realtime`, `vault` are Supabase-managed and change on
platform upgrades; including them would make the check cry wolf until it got ignored.

**Exit codes.** `0` matches · `1` drift · `2` **could not run**. Exit 2 is not a pass — same doctrine
as [`.claude/rules/verification.md`](../../.claude/rules/verification.md), for the same reason (#38: a
gate that exits 0 when it cannot run is worse than no gate).

## 2. Who may change the schema

| Path                                                                               | Status            | Records the apply        |
| ---------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| **EF Core migrations** (`services/Tims.Platform/**/Migrations/`)                   | ✅ **preferred**  | `__EFMigrationsHistory`  |
| **Reviewed SQL applied via psql** (`packages/db/prisma/{migrations,manual}/*.sql`) | ✅ allowed        | `tims_ddl_log` (see §4)  |
| **Supabase dashboard / CLI**                                                       | ⛔ **prohibited** | partially, or not at all |
| **`prisma migrate deploy` / `db push` / `migrate dev` against prod**               | ⛔ **prohibited** | n/a                      |
| **`dotnet ef database update` against prod**                                       | ⛔ **prohibited** | n/a                      |

Table-level ownership (which stack owns which table) is separate and stays in
[`table-ownership.md`](./table-ownership.md), which CI already enforces. This document governs
_mechanism_; that one governs _ownership_.

EF is preferred because it is the only path that already records its own applies, and it is the
Phase-7 endpoint. That does **not** make it the owner of Prisma's 102 tables today — see §3.

## 3. Prisma Migrate is formally unused in production

**Decision (2026-08-03).** Production has no `_prisma_migrations` table and never has:
`prisma migrate deploy` has never run against it. `packages/db/prisma/migrations/` is **not** a Prisma
Migrate history. It is a directory of **reviewed SQL change scripts applied by hand via psql**, which
is also exactly what `prisma/manual/` is — the split between the two directories is convention only.

`_prisma_migrations` stays deliberately absent. It is not an oversight; do not "fix" it.

**Why not baseline it instead.** Baselining would let Prisma reason about drift — but the datamodel
currently disagrees with prod in three ways (§3c of the reconciliation), so the first `migrate dev`
after a baseline would generate DDL that drops 11 foreign keys, a live column, and 6 column defaults.
Baselining now makes Prisma _able to act_ while it is still _wrong_. That is strictly more dangerous
than leaving it inert.

**Revisit when** the three datamodel drift classes are closed (#118, #119, #120). Until then the
answer is no, and `guard-prod-ddl.sh` enforces it.

### The hazard this creates, stated plainly

`prisma db push` is documented in `CLAUDE.md:32` and `README.md` as the post-clone bootstrap step, and
it is how ~100 of the 102 Prisma tables were created. Pointed at prod today it would
**`DROP TABLE` ×17** — every `hris_*` table, `fx_rates`, all eleven `qrtz_*`, and `__EFMigrationsHistory`
itself — plus drop a column, 16 constraints and 6 defaults. Blast radius measured in §4 of the
reconciliation.

Mitigation is `scripts/db/guard-prod-ddl.sh`: it refuses `db push` / `migrate dev` / `migrate deploy`
when the target host is not local. It is a guard, not a proof — a raw `npx prisma db push` with an
explicit `--url` bypasses it. **The backstop is check 16 plus a database backup, not the guard.**

## 4. Recording a hand-applied SQL change

The gap this closes: paths 1 and 2 left no trace at all, so "applied via psql" was unauditable
afterwards. Every hand-applied script now writes its own ledger row, in the same transaction as the
DDL:

```sql
BEGIN;
  -- ... the DDL ...
  INSERT INTO tims_ddl_log (script_path, applied_by, note)
  VALUES ('packages/db/prisma/manual/2026-08-03-example.sql', current_user, 'issue #NNN');
COMMIT;
```

Same transaction, so a rolled-back DDL cannot leave a row claiming it succeeded, and a successful DDL
cannot omit one.

`tims_ddl_log` does **not exist yet** — creating it is itself a schema change and belongs in its own
reviewed PR (#123). Until it lands, §5's PR-body requirement is the only record. Stated here so the
target is unambiguous, not to imply it is built.

## 5. What is actually enforced, and what is only convention

Being explicit about this, because the previous version of the verification rule claimed enforcement
that did not exist:

| Control                                                  | Real?                  | Catches                                                                                                              |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/gate` **check 16** — live schema vs committed baseline | ✅ **yes**             | **any** out-of-band change, whatever path made it — including dashboard table-editor edits that leave no history row |
| `guard-prod-ddl.sh`                                      | ✅ yes, bypassable     | accidental `pnpm db:push` / `pnpm db:migrate` at a non-local host                                                    |
| `table-ownership.md` CI check                            | ✅ yes (pre-existing)  | a PR mutating a table it does not own                                                                                |
| "Never use the Supabase dashboard"                       | ❌ **convention only** | nothing. Unenforceable — dashboard access cannot be revoked from the platform owner.                                 |
| PR body must state which path applied the DDL            | ❌ convention only     | nothing mechanically                                                                                                 |

**The Supabase dashboard prohibition has no technical enforcement and cannot have one.** Enforcement
is _detection_: check 16 sees the resulting object regardless of provenance. That asymmetry is the
whole design — provenance auditing can be bypassed by a path that writes no record, and §3a is proof
that such a path was used. Schema diffing cannot be.

**There is no enforcement beyond the three ✅ rows above.**

### CI

Check 16 is local-only for now: it needs the direct connection (`:5432`) and a `pg_dump` ≥ 17, and
wiring production credentials into CI is a separate decision (#124). Until then, drift is caught when
`/gate` runs — which is every ship — not on every push.

## 6. Adding a schema change: the procedure

1. **Write the DDL** — an EF migration (preferred), or a reviewed `.sql` under
   `packages/db/prisma/{migrations,manual}/`. Every new org-scoped table carries its RLS block
   (`tenant_isolation`, fail-closed, `FORCE ROW LEVEL SECURITY`) — see `.claude/rules/db.md`.
2. **Never hand-write EF SQL** — generate it: `dotnet ef migrations script`. Note it emits a **UTF-8
   BOM that psql rejects**; strip it. `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`
   still carries one.
3. **Apply via psql** on the direct connection (`:5432`, not the `:6543` transaction pooler).
4. **Re-capture the baseline** — `bash scripts/db/schema-baseline.sh capture` — and commit it **in the
   same PR** as the DDL. The baseline diff is the reviewable record of what changed in prod.
5. **Run `/gate`.** Check 14 (RLS) and check 16 (drift) must both pass. Check 16 passing after step 4
   proves the applied change is exactly the reviewed change and nothing else came along with it.
6. **State the path in the PR body** under `## Verification`.

## 7. When check 16 reports drift

Drift is not automatically a problem — but it is never nothing.

- **Explained by this PR** → `capture`, commit the new baseline, done.
- **Not explained by anything in this PR** → **stop.** Something changed prod out of band. This is the
  #111 scenario. Check `supabase_migrations.schema_migrations` and `__EFMigrationsHistory` for
  provenance; if neither explains it, you are in §3a territory — an unrecorded change — and the object
  must be identified and either adopted or reverted before merging.

Never re-capture a baseline to make a red check go green without knowing what the hunk is. That
converts the one working control into a rubber stamp.

Related: #115 · #111 · #63 · #38 · [`table-ownership.md`](./table-ownership.md) ·
[`.claude/rules/db.md`](../../.claude/rules/db.md) · [`.claude/rules/verification.md`](../../.claude/rules/verification.md)
