# DDL path reconciliation — 2026-08-03

> **Issue #115.** Point-in-time reconciliation of every DDL path against the live production schema.
> The living policy that came out of it is [`ddl-governance.md`](./ddl-governance.md); this file is the
> evidence, kept dated because its value is being a snapshot.
>
> **Ground truth:** [`packages/db/baseline/prod-public-schema.sql`](../../packages/db/baseline/prod-public-schema.sql)
> — `pg_dump --schema-only` of `public` + `supabase_migrations`, server PostgreSQL 17.6, 8,781 lines.
> Everything below was verified against the live database or that dump, never against migration files.

## Method

Deliberately not "read the migrations and believe them" — that is the technique that let #111 survive
14 months. Every claim here came from one of:

- `pg_dump --schema-only` against prod (the committed baseline)
- direct `pg_catalog` / `information_schema` queries
- `prisma migrate diff` between the datamodel and the live URL, **both directions**
- `git log --all -S` over the full history of the relevant schema files

Where a catalog query and a repo file disagreed, the query won.

## 1. Table-level: no drift

| Source                             | Count   |
| ---------------------------------- | ------- |
| Tables in prod `public`            | **119** |
| Prisma models (`@@map`)            | 102     |
| EF-owned (`hris_*` ×4, `fx_rates`) | 5       |
| Quartz scheduler store (`qrtz_*`)  | 11      |
| `__EFMigrationsHistory`            | 1       |

102 + 5 + 11 + 1 = 119. **Every Prisma model exists in prod, every prod table is accounted for, and
there are no orphan tables in either direction.** The 17 non-Prisma tables are all .NET-side and all
expected.

## 2. Repo migrations with no prod effect: none

All 53 index/constraint names declared across `packages/db/prisma/migrations/**` and
`prisma/manual/*.sql` (excluding `*.ROLLBACK.sql`) exist in prod. So do all 100 `tenant_isolation`
policies, both `allow_all` policies on the global catalogs, and all 4 append-only triggers on
`audit_logs` / `data_access_logs`.

**Nothing in the repo is unapplied.** The 2026-08-03 HRIS finding (documented DONE, never applied)
was the last instance of that direction and #116 closed it. All remaining drift points the other way:
**prod has things no repo file declares.**

## 3. Prod objects with no repo counterpart

### 3a. `nine_box_evaluations.updated_at` — zero provenance anywhere

```
updated_at timestamp(3) without time zone DEFAULT now() NOT NULL
```

Nothing **creates or declares** it. Searched and absent from all of (the committed baseline records
that it exists — that is the baseline doing its job; nothing anywhere explains how it got there):

| Source                                                 | Result                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `NineBoxEvaluation` in the current datamodel           | absent                                                                                 |
| `NineBoxEvaluation` in **every commit** in git history | absent (`37438ca1`, `323c0665` — the only two commits to touch the file)               |
| `packages/db/prisma/migrations/**`                     | no `CREATE TABLE nine_box_evaluations` at all; only the RLS `ALTER`                    |
| `packages/db/prisma/manual/*.sql`                      | absent                                                                                 |
| all 5 `supabase_migrations` rows (SQL text inspected)  | absent — none combines `nine_box` with `updated_at`, none has `ADD COLUMN` touching it |
| `__EFMigrationsHistory` (2 rows)                       | not EF-owned                                                                           |
| C# integration fixtures (`NineBoxReadFixture.cs:145`)  | explicitly omits it                                                                    |

Corroborating detail: `created_at` on the same table defaults to `CURRENT_TIMESTAMP` — what Prisma
emits for `@default(now())` — while `updated_at` defaults to `now()`. **The two columns were written
by different tools.**

**Most probable origin (inference, not proven):** the Supabase dashboard's _table editor_. Unlike its
SQL editor, the table editor does **not** write a `supabase_migrations` row. If so, this is a
materially worse finding than #115 assumed:

> The issue's table records path 4 as "recorded in `supabase_migrations`". That is true only of the
> SQL editor. **The dashboard has a sub-path that leaves no record in any of the three history
> tables.** No provenance-reconciliation check could ever see it. Only a live-schema diff can.

This single column is the strongest argument in the whole issue for detection-over-provenance, and it
is why `/gate` check 16 diffs the schema rather than auditing migration ledgers.

### 3b. `current_org_id()` — orphaned function, still present

Created by `supabase_migrations` row `20260531055730 enable_rls_all_tables` (so it _is_ recorded), but
present in **zero repo files**. Post-#111 it is now fully orphaned:

```
calls_the_function:     0    -- no policy calls current_org_id()
uses_guc_directly:    100    -- all tenant_isolation policies read the GUC directly
pg_depend dependents:   0
```

> **Correction to my own first measurement.** An earlier query reported "100 policies use
> `current_org_id`". That was a false positive: `current_setting('app.current_org_id')` _contains_ the
> substring. Re-measured with `~ 'current_org_id\(\)'`, the true count is **0**. This is the same
> inference-from-pattern-matching error #111 warns about, caught by re-querying.

It is a latent hazard — a future policy written against it silently reintroduces the fail-open shape —
but harmless today. Removal tracked separately; not dropped here.

### 3c. Hand-written migration SQL that the datamodel never declared

`prisma migrate diff` run in both directions between the datamodel and prod. **All three classes share
one root cause: the `migrations/*.sql` files are hand-written, not generated from the datamodel, and
were never reconciled back into it.** Prod matches the migration files; the _datamodel_ is what disagrees.

| Class                | Detail                                                                                                                                              | In repo?                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 11 undeclared FKs    | `hire_predictions` ×7; `organization_id` FKs on `rater_assignments`, `rater_responses`, `review_cycles`, `role_family_weight_profiles`              | in migration SQL, **not** in datamodel                                                                                                 |
| 6 `id` defaults      | `gen_random_uuid()` on `review_cycles`, `rater_assignments`, `rater_responses`, `hire_predictions`, `access_reviews`, `role_family_weight_profiles` | in migration SQL, **not** in datamodel (Prisma's `@default(uuid())` is client-side)                                                    |
| 1 FK definition skew | `role_family_weight_profiles_organization_id_fkey` is `ON UPDATE NO ACTION` in prod; the datamodel implies CASCADE                                  | `20260710140000_add_fit_engine_schema/migration.sql:26` writes `ON DELETE CASCADE` and **omits `ON UPDATE`**, so Postgres defaulted it |

`HirePrediction` is the clearest case: the model declares seven scalar id fields and **zero
`@relation` blocks**, yet prod carries all seven FKs, created by
`20260713120000_add_hire_predictions/migration.sql:35-48`.

## 4. The destructive-migration hazard, quantified

`#115` and the ownership-flip runbook both name this hazard. Here is the actual generated DDL —
what `prisma db push` / `migrate dev` would do to prod **today**:

- **`DROP TABLE` ×17** — all four live `hris_*` tables, `fx_rates`, all eleven `qrtz_*` (the live
  Quartz job store), and **`__EFMigrationsHistory` itself**, destroying EF's only baseline.
- **`DROP COLUMN nine_box_evaluations.updated_at`** — data loss.
- **`DROP CONSTRAINT` ×16** — including all 7 `hire_predictions` FKs.
- **`ALTER COLUMN id DROP DEFAULT` ×6** — any non-Prisma writer relying on the DB default breaks.

This is no longer a theoretical risk in a runbook; it is a reproducible command with a known blast
radius. Reproduce read-only with:

```bash
cd packages/db && set -a && . ./.env && set +a
npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema --script
```

> **Do not** pass a production URL as `--shadow-database-url`. Prisma **resets** shadow databases.
> The `--from-migrations` direction is therefore not runnable against prod and was not run.

## 5. Path-by-path verdict

| #   | Path                 | Recorded where                                       | Reviewable in repo | Verdict                                                                                                                                                                          |
| --- | -------------------- | ---------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prisma migration SQL | **nowhere** — no `_prisma_migrations` table          | ✅ yes             | Applied by hand via psql. Not a Prisma Migrate history at all.                                                                                                                   |
| 2   | Prisma manual SQL    | **nowhere**                                          | ✅ yes             | Same mechanism as path 1 — **paths 1 and 2 are one path**, split across two directories by convention only. `access_reviews` DDL exists in **both**, with identical object sets. |
| 3   | EF Core migrations   | `__EFMigrationsHistory` (2 rows)                     | ✅ yes             | Now recorded, as of #116. The healthiest path.                                                                                                                                   |
| 4   | Supabase dashboard   | `supabase_migrations` (5 rows) — **SQL editor only** | ❌ no              | Table editor records **nothing**. Source of #111 and, most likely, §3a.                                                                                                          |

A fifth definition of the schema, not a path to prod but a drift risk worth naming: the **C#
integration-test fixtures** (`NineBoxReadFixture.cs`, `SuccessionReadFixture.cs`) hand-write
`CREATE TABLE` for tables they read. `NineBoxReadFixture` already disagrees with prod (no
`updated_at`), so those tests pass against a schema production does not have.

## 6. What §4 of the master plan actually got wrong

`00-master-plan.md` §4 "One DDL path" reads:

> all schema changes (Prisma- or EF-authored) are generated, reviewed as SQL, and applied via psql.
> Never `dotnet ef database update` / `prisma migrate deploy` against prod.

Being precise, because #115 overstates this slightly: **the procedure it describes is accurate** and
is what paths 1–3 actually do. Three things are wrong:

1. **"One"** — there are four, and it omits path 4 entirely. That omission is where #111 came from.
2. **Nothing records that an apply happened.** Paths 1 and 2 leave no trace, so "applied via psql" is
   unauditable after the fact.
3. **It is silent on `prisma db push`**, which `CLAUDE.md:32` and `README.md` document as the
   post-clone bootstrap step, and which is how ~100 of the 102 Prisma tables were created — no
   migration file ever created them.

Corrected in this PR.

## 7. Follow-ups (opened as issues, deliberately not fixed here)

This PR lands ground truth, reconciliation, governance and detection. It makes **no** production DDL
change and **no** datamodel edit, so each item below gets its own reviewed change:

| Issue | Item                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #118  | Declare the 11 undeclared FKs in the datamodel                                                                                                    |
| #119  | Resolve the 6 `gen_random_uuid()` id defaults                                                                                                     |
| #120  | `nine_box_evaluations.updated_at` — adopt into the datamodel or drop it                                                                           |
| #121  | Drop the orphaned `current_org_id()` function                                                                                                     |
| #122  | C# test fixtures drift from prod; `table-ownership.md:108` cites the wrong `fx_rates` migration id (`20260722000000`; actual is `20260723032952`) |

Related: [`ddl-governance.md`](./ddl-governance.md) · #111 · #63 · #116
