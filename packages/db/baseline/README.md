# Production schema baseline

`prod-public-schema.sql` is a `pg_dump --schema-only` of the **live production** database — schemas
`public` and `supabase_migrations`. It is the answer to "what does the schema actually look like right
now", which nothing in this repo could answer before 2026-08-03 (issue #115).

**It is generated. Never hand-edit it.**

```bash
bash scripts/db/schema-baseline.sh capture   # refresh from prod, then REVIEW THE GIT DIFF
bash scripts/db/schema-baseline.sh check     # /gate check 16 — diff live vs this file
```

## Why this exists rather than trusting the migrations

Four systems can mutate the production schema, and none of them is authoritative:

| Path                                | Records the apply                       |
| ----------------------------------- | --------------------------------------- |
| Reviewed SQL applied via psql       | nothing                                 |
| EF Core migrations                  | `__EFMigrationsHistory`                 |
| Supabase dashboard **SQL editor**   | `supabase_migrations.schema_migrations` |
| Supabase dashboard **table editor** | **nothing at all**                      |

Consequences already observed in production:

- **#111** — two RLS policy families existed in prod and in **zero repo files**, silently defeating
  tenant isolation for ~14 months while every gate reported green.
- **#115 §3a** — `nine_box_evaluations.updated_at` exists in prod and in no repo file, no commit, and
  none of the three migration-history tables. Provenance auditing cannot see it. A schema diff can.

That is why the control is a diff of the whole schema rather than a reconciliation of migration
ledgers.

## Reading the file

Stable, reviewable diffs are the point, so `capture` normalises away the parts of `pg_dump` output that
change between runs without the schema changing: the client-version banner, timestamps, and pg_dump 17's
random `\restrict` nonce. The **server** version is recorded in the generated header, where a genuine
Postgres upgrade shows up as a one-line intentional change.

Supabase-managed schemas (`auth`, `storage`, `realtime`, `vault`) are **excluded** — they change under us
on platform upgrades, and including them would make the check cry wolf until it got ignored.

`supabase_migrations` is included as _schema only_, so the file shows that the ledger table exists but not
its rows. To read the actual migration provenance:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
select "MigrationId", "ProductVersion" from "__EFMigrationsHistory";
```

## If `check` reports drift

See [`docs/architecture/ddl-governance.md`](../../../docs/architecture/ddl-governance.md) §7. Short
version: if this PR caused it, `capture` and commit. If nothing in this PR explains it, **stop** — that is
the #111 scenario.

**Never re-capture to make a red check green without reading the hunk.** That converts the only working
control into a rubber stamp.
