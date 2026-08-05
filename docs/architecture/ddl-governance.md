# DDL governance — how schema changes reach production

> **Issue #115.** This replaces the aspirational "One DDL path" bullet in
> `csharp-migration/00-master-plan.md` §4 with what is actually true and actually enforced.
> Evidence: [`ddl-reconciliation-2026-08-03.md`](./ddl-reconciliation-2026-08-03.md).
>
> **The rule that generates every other rule here:** the repository is not evidence about production.
> #111 put RLS policies in prod that existed in zero repo files and survived every gate for ~14
> months. §3a of the reconciliation found a production column that **no repo file creates, no commit in
> history declares, and none of the three migration-history tables records**. Any control that reads only
> the repo is not a control.
>
> (Since this change landed, the committed baseline does record that the column exists — that is the
> point of having a baseline. What still does not exist anywhere is anything explaining how it got
> there.)

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

**How the EF path records itself without the banned command.** These two rules look contradictory and
are not, so the mechanism is worth stating: `__EFMigrationsHistory` rows are normally written by
`dotnet ef database update`, which is prohibited against prod. But
`dotnet ef migrations script --idempotent` puts the bookkeeping **into the generated SQL** — a
`CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory"` and, per migration, an `INSERT` guarded by
`IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '…')`. Applying that script
with psql therefore writes the history row itself. Verifiable in the committed artifact:
`services/Tims.Platform/db/manual/20260716000000_hris_domain.sql:23,33`. It is also why the script is
safe to re-apply.

This is precisely why "**never hand-write EF SQL**" (§6 step 2) matters: a hand-written equivalent
would create the tables and silently skip the history row, putting EF back in the same unrecorded state
as the psql path.

## 3. Prisma Migrate is formally unused in production

**Decision (2026-08-03).** Production has no `_prisma_migrations` table — verified by live query. Prisma
creates that table on first use and never drops it, so `prisma migrate deploy` has almost certainly never
run against prod. (That last step is an inference, not proof: someone could have dropped the table. No
evidence suggests it, and the conclusion below does not depend on which it is.)
`packages/db/prisma/migrations/` is **not** a Prisma
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

| Control                                                  | Real?                  | Catches                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/gate` **check 16** — live schema vs committed baseline | ✅ **yes**             | any out-of-band change made **since the last capture**, whatever path made it — including dashboard table-editor edits that leave no history row. Not anything already in the baseline (see below). |
| `guard-prod-ddl.sh`                                      | ✅ yes, bypassable     | accidental `pnpm db:push` / `pnpm db:migrate` at a non-local host                                                                                                                                   |
| `table-ownership.md` CI check                            | ✅ yes (pre-existing)  | a PR mutating a table it does not own                                                                                                                                                               |
| "Never use the Supabase dashboard"                       | ❌ **convention only** | nothing. Unenforceable — dashboard access cannot be revoked from the platform owner.                                                                                                                |
| PR body must state which path applied the DDL            | ❌ convention only     | nothing mechanically                                                                                                                                                                                |

**The Supabase dashboard prohibition has no technical enforcement and cannot have one.** Enforcement
is _detection_: check 16 sees the resulting object regardless of provenance. That asymmetry is the
whole design — provenance auditing can be bypassed by a path that writes no record, and §3a is proof
that such a path was used. Schema diffing cannot be.

**There is no enforcement beyond the three ✅ rows above.**

### Check 16 and check 14 are different controls — neither replaces the other

Written down because the first draft of this change called 16 a generalisation of 14, and the
cross-model reviewer was right to call that dangerous:

|                                                             | check 14 (`verify-rls-isolation.ts`)        | check 16 (`schema-baseline.sh`)                         |
| ----------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| Kind                                                        | functional — probes rows with the GUC unset | structural — diffs the schema text                      |
| Answers                                                     | "is tenant isolation actually holding?"     | "has the schema changed since we last looked?"          |
| Catches a fail-open policy that predates the baseline       | ✅ yes                                      | ❌ **no** — it is already in the baseline, so: no drift |
| Catches a dropped constraint / added column / missing GRANT | ❌ no                                       | ✅ yes                                                  |

**Check 16's blind spot is structural and permanent:** anything present at capture time is by
definition "no drift". It says the schema has not changed, never that it is correct.

Consequence, and why check 14 gained an assertion in this PR: a new policy named `tenant_isolation`
whose `USING` clause calls the orphaned `current_org_id()` would have passed _both_ checks. Check 14 now
rejects any policy calling a banned function by name (`BANNED_POLICY_FUNCTIONS`). Semantic assertions
belong in 14; only 14 can carry them.

### The failure paths are tested

`tests/db/schema-baseline-failure-paths.test.ts` asserts the exit-code contract offline against a stub
`pg_dump` — including a dump that fails, a dump that succeeds while emitting nothing, a missing
baseline, and a client older than the server. Given #38, a gate whose did-not-run path is untested is
not a gate. Exit 0 is not covered there (it needs live credentials); `/gate` check 16 covers it.

### Check 17 — `app_tenant` least privilege (#126, added 2026-08-04)

`scripts/security/verify-tenant-grants.ts`, wired as **`/gate` check 17**. Asserts that `app_tenant` holds
`INSERT`/`UPDATE`/`DELETE` only on tables that are **either** declared by the Prisma schema **or** protected
by RLS. **Exit 0 clean · 1 violation · 2 could-not-run** — the same contract as check 16, in both doctrine
and exit codes, as of #124.

Its three could-not-run paths are the missing-connection-URL guard, the zero-Prisma-tables refusal, and the
top-level `catch` (which covers an unreachable host, bad credentials, a rejected handshake, or a thrown
parser). All three emit `TENANT GRANT CHECK DID NOT RUN` and exit 2. Pinned offline by
`tests/security/verify-tenant-grants-failure-paths.test.ts`, which also asserts that no failure path can
print the success sentence — per #38, a gate whose did-not-run path is untested is not a gate.

> **Resolved 2026-08-05 (was a real defect, recorded because the reasoning generalises).** Until #124 this
> check returned **1 for both** a violation and a could-not-run. Fail-closed either way, so it could never
> read green — but the two states were distinguishable only by reading stderr, which is fine for a human at
> `/gate` and useless to an automated job. That made this issue's own acceptance criterion ("the job must
> distinguish exit 1 from exit 2 and fail loudly on 2") **literally unsatisfiable** for check 17.
>
> The general lesson: **"fails closed" and "reports usefully" are different properties, and a gate needs
> both.** Collapsing distinct outcomes onto one exit code is invisible while a human reads the output and
> becomes load-bearing the moment anything automates it. Worth checking for in any new gate.

Zero-Prisma-tables deserves its own note, since "refuses to run" over "reports 99 problems" looks
counter-intuitive: with an empty schema every non-Prisma table matches, so the check would emit ~99 false
positives. That is a broken input, not a finding — and a control cries wolf at that volume exactly once
before someone switches it off.

Read the invariant precisely — the "or" is load-bearing, and the next section explains why stating it as
"Prisma-owned only" nearly caused a production outage.

It exists because production carries this default privilege, verified via `pg_default_acl`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;   -- {app_tenant=arwd/postgres}
```

so **every** table `postgres` creates in `public` inherits tenant DML whether it needs it or not. Opt-out,
not opt-in.

**The discriminator is RLS, not ownership — and getting that wrong nearly caused an outage.** The first
version of this check flagged all 20 non-Prisma tables, and the accompanying REVOKE script would have
revoked all 20. A cross-model reviewer caught that the C# strangler writes its tables **as `app_tenant`**:
`TenantScope.cs:46` issues `SET LOCAL ROLE app_tenant`, because that is _how_ those writes are
RLS-enforced. Revoking the 7 RLS-protected EF tables would have broken HRIS sync, access-review attestation
and succession writes in production, detectable only by the failures themselves.

So the rule is:

| Table shape                 | Meaning                                                       | app_tenant DML    |
| --------------------------- | ------------------------------------------------------------- | ----------------- |
| Prisma-owned                | the TS app writes it via `tenantDb`                           | required          |
| EF-owned, **RLS protected** | tenant-scoped; C# writes it as `app_tenant` under TenantScope | **required**      |
| No RLS                      | not tenant-scoped ⇒ nothing writes it under TenantScope       | **dead → revoke** |

**"RLS protected" means `relrowsecurity` + at least one `pg_policy` row** — that is literally what
`verify-tenant-grants.ts:169` tests, and it is the right predicate rather than a loose approximation of one:

- **FORCE (`relforcerowsecurity`) is deliberately NOT part of it.** Forcing changes behaviour only for the
  table's _owner_; these tables are owned by `postgres`, while `app_tenant` is a non-owner `NOBYPASSRLS`
  role, so plain `relrowsecurity` already constrains every `app_tenant` statement. Tightening the check to
  require FORCE would report an RLS-enabled-but-unforced EF table as a violation — and acting on that reading
  is the same revoke-and-break-production mistake in a new disguise. **Do not "fix" the check toward FORCE.**
- **The `≥ 1 policy` half is load-bearing, not redundant.** RLS enabled with zero policies is default-deny
  for a non-owner, so `app_tenant` cannot write the table at all and the grant really is dead — correctly
  flagged.

Earlier revisions of this section, and of the surrounding prose, said "RLS **forced**". That was imprecise
about a check whose entire value is precision; corrected 2026-08-05.

That leaves **13 violations**: `fx_rates` (its writer runs on a plain connection as the owner role,
explicitly not under TenantScope), all **11 `qrtz_*`** (no Quartz source file references TenantScope), and
`__EFMigrationsHistory` (written by psql-applied scripts as `postgres`). All 13 have RLS disabled, so the
grant is their only guard. Writer-verified per table, which is the step the first draft skipped.

Two further corrections this check encodes, both wrong in #126's original framing:

- **The grant is applied at `CREATE TABLE`, not at flip time.** An ownership flip does not re-grant, so a
  `REVOKE` on a flipped table **is** durable. The earlier "every flip re-creates the condition" was wrong.
- **The exposure is therefore not about flips at all** — it is every non-Prisma table in the schema, which
  is how the 11 `qrtz_*` and `__EFMigrationsHistory` were sitting there unnoticed.

Severity, stated honestly: `app_tenant` is `NOLOGIN` and `NOBYPASSRLS`, reachable only via
`SET LOCAL ROLE app_tenant` from the app's own connection inside a transaction. Exploiting it needs
app-level SQL injection or a compromised app process — **not remotely exploitable**. But containing exactly
that is what `app_tenant` + RLS exist for.

The default ACL is **deliberately left in place**: narrowing it means explicitly granting ~99 Prisma-owned
tables, and one missed table breaks tenant writes at runtime. This check is the chosen alternative — it
catches the next table that inherits the grant, instead of preventing the inheritance. Fix script:
`packages/db/prisma/manual/2026-08-04-revoke-app-tenant-dml.sql` (+ `.ROLLBACK.sql`).

> **Grants are part of the baseline**, so applying that REVOKE **will** make check 16 report drift. Re-capture
> in the same change, and read the diff — it should contain nothing but the expected `REVOKE`s.

### Which of the flip/privilege controls are actually enforced, and where

Being explicit, because "documented in the runbook" and "enforced" are not the same thing and this repo has
been burned by the difference (#38):

| Control                                          | Runs where                               | Enforced?                               |
| ------------------------------------------------ | ---------------------------------------- | --------------------------------------- |
| `tests/governance/scope-fixtures.test.ts` (#132) | `npx vitest run` → CI `Security Audit`   | ✅ **yes** — blocks CI                  |
| `tests/governance/table-ownership.test.ts`       | `npx vitest run` + `dotnet-platform.yml` | ✅ yes                                  |
| check 14 `verify-rls-isolation.ts`               | `/gate`, local (live DB)                 | ⚠️ ship-time only                       |
| check 16 `schema-baseline.sh check`              | `/gate`, local (live DB)                 | ⚠️ ship-time only (#124)                |
| **check 17 `verify-tenant-grants.ts`**           | `/gate` **check 17**, local (live DB)    | ⚠️ ship-time only — same credential gap |
| `scripts/db/pre-flip-scan.ts` (#132)             | by hand, per flip (runbook §5)           | ❌ no — a documented step, not a gate   |

`main` also has **no required status checks** (see the ownership-flip runbook §1), so even the ✅ rows are
"CI goes red", not "the merge is blocked". `gh pr merge --admin` bypasses all of it.

> **CORRECTED 2026-08-05.** The paragraph here previously said "the `/gate` skill's own check list is
> defined outside this repository", so check 17 could not be added to it. **That was false.** The check list
> is `.claude/commands/gate.md`, committed to this repo — and PRs #114, #117 and #125 had each already edited
> that exact file. The claim was never verified against `git ls-files`, and the effect was that a mandated
> control sat unwired for a day while the reason given for not wiring it did not exist.
>
> **Check 17 is now in `/gate` as check 17.** The residual gap is CI only (#124), which it shares with 14
> and 16.
>
> The instructive part is the failure mode, not the fix: this is the #38 shape with the polarity reversed.
> #38 was a gate everyone believed ran and did not. This was a gate everyone knew did not run, kept out by a
> blocker that a single `ls` would have dissolved. **An unverified claim about why a control cannot be
> enforced is itself a governance defect** — hold it to the same standard as a claim about the schema
> (§"The repository is not evidence about production"), and grep before believing it.

### CI, and what to do when check 16 cannot run

Check 16 is local-only for now: it needs the direct connection (`:5432`) and a `pg_dump` ≥ 17, and
wiring production credentials into CI is a separate decision (#124). Until then, drift is caught when
`/gate` runs — which is every ship — not on every push.

That creates an obvious trap, so it is spelled out rather than left to be discovered: **"every schema PR
passes check 16" is unsatisfiable on a machine with no direct connection or no `pg_dump` ≥ 17.** A rule
that cannot be satisfied gets satisfied dishonestly — by re-capturing without reading, which is exactly
the rubber-stamp failure §7 prohibits. The escape clause:

| Situation                                      | Required action                                                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check 16 runs, exit 0                          | Proceed.                                                                                                                                                               |
| Check 16 runs, exit 1 (drift)                  | Resolve per §7 before merge.                                                                                                                                           |
| Check 16 exits 2 **and the PR changes no DDL** | Record `Verification: check 16 NOT RUN (<reason>)` in the PR body and proceed. A non-DDL PR cannot have caused drift.                                                  |
| Check 16 exits 2 **and the PR changes DDL**    | **Do not merge.** Fix the tooling (`brew install postgresql@17`, `bash scripts/dev/setup-db-env.sh`) or hand off to someone who can run it. This is the one hard stop. |

Never resolve an exit 2 by re-capturing the baseline: `capture` and `check` use the same `pg_dump`, so if
`check` could not run, `capture` cannot produce a trustworthy baseline either.

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
