# Ownership Flip Runbook — strangler step 6 (Prisma → EF Core)

Date: 2026-08-03 (rev. 3 — flip #1 executed) · Status: **EXECUTED ONCE.** `access_reviews` was flipped
2026-08-03 (#63, #65) and its rollback was tested by a real `git revert`. The transcript is **§7**; the
`surveys`/`survey_responses` analysis moved to **§7b** as the next (still blocked) flip.

> **What flip #1 did and did not establish.** It proves the mechanics end-to-end for the easy case: the
> one-PR coupling, the `P1012` back-relation trap, the ledger move, and that pure `git revert` is a
> complete rollback under §4 option (c). It exercised **no** reader repointing (all five §1-step-6
> coupling categories were zero for that table) and **no** DDL transfer.
>
> **Flip #2 (§7c, `critical_roles` + `successors`, #69, executed 2026-08-04) closes two of those gaps:**
> it repointed **real readers** (2) and was the first flip to actually need **§0 P8**'s extracted DDL. It
> also produced the §1-step-6 correction — a flipped table's **scope policy is a cross-stack contract and
> must NOT be deleted with the model**, only its Prisma delegate. Still open after both flips: **DDL
> transfer** (§4 options (a)/(b)) and **§8 Q6** (EF design-time factory).
>
> Do not read §7 or §7c as evidence that a flip with live cross-domain readers is routine. Both flipped
> tables that no _other domain_ reads. §7b (`surveys`) is the honest picture of that harder case, and it is
> still blocked.

> ## ⚠️ PARTIALLY UNBLOCKED — read before executing any flip (#111)
>
> While investigating this runbook, a direct `pg_policies` audit of the live prod DB found that **RLS in
> production does not match the RLS in this repository's migrations**.
>
> **✅ Defect 1 — FIXED AND VERIFIED IN PROD 2026-08-02.** An undocumented `org_isolation` PERMISSIVE
> policy family on **67 tables** made tenant isolation fail **OPEN** on an unset org GUC (verified:
> 32/32 users across all 15 orgs visible as `app_tenant`). All 67 policies have been dropped via
> `packages/db/prisma/manual/2026-08-02-fix-rls-fail-open-org-isolation.sql`. Post-fix verification:
> unset GUC → 0 rows; per-org sweep across all 15 orgs → 32/32 users visible to exactly their own org,
> 0 mismatches; 0 RLS-enabled tables left policy-less.
>
> **✅ Defect 2 — FIXED AND VERIFIED IN PROD 2026-08-02.** An `allow_all (USING true)` PERMISSIVE policy
> sat on **7 tenant-scoped join tables** and OR'd past their correct fail-closed session-subquery guard —
> unconditionally, in every GUC state, so those tables had no effective DB isolation at all (worse than
> Defect 1). Dropped via `packages/db/prisma/manual/2026-08-02-fix-rls-allow-all-join-tables.sql`; unset
> GUC now returns 0 on all 7 and a per-org sweep accounts for every row. `allow_all` is deliberately kept
> on `permissions`/`platform_owner_emails` (global RLS-exempt catalogs). **#70's hazard note is CORRECT** —
> an earlier claim here that the calibration session-subquery policy did not exist was an error and has
> been withdrawn; the policy exists and is now the effective control.
>
> **❌ Provenance — STILL OPEN.** `org_isolation`, `allow_all` and `current_org_id()` appeared in
> **zero repo files**. Live DDL demonstrably diverges from the repo's migrations, which independently
> confirms §8's "One DDL path" finding. **Any flip precondition must be verified by querying prod, never
> by reading migration files alone** — that caution applies to §0 and §5 of this runbook and is not
> lifted by the Defect 1 fix.
> Parent: `phase-5-strangler.md` step 6 (`:29-30`) · Ledger: `docs/architecture/table-ownership.md`
> Issues: #63 (this runbook) · #64 (`surveys` + `survey_responses`, the intended first flip — §7)

Step 6 reads, in full: _"Flip ownership. Move D's tables to `efcore` in the ledger; C# becomes the sole
writer. Cross-domain readers switch to D's API or a read model."_ That is the entire prior specification.
Everything below was derived by reading `scripts/table-ownership.mjs`, tracing it against the real repo,
querying the live prod DB, and running `prisma migrate diff` offline. Where something could not be
resolved it is called out as an OPEN QUESTION (§8) rather than smoothed over.

---

## What a flip is, and is not

A flip is a **code-and-ledger change with zero DDL**. For a table that already exists in Postgres:

| Changes                                                     | Does NOT change                               |
| ----------------------------------------------------------- | --------------------------------------------- |
| The ledger entry (`efcoreStranglerWrite[]` → `efcore[]`)    | The physical table, its columns, its data     |
| The Prisma schema (model deleted)                           | Its RLS policies                              |
| Every TS Prisma reader of that table (deleted or repointed) | Its GRANTs                                    |
| Tripwire tests / parity surfaces / seeds that named it      | The EF `DbContext` mapping (already complete) |
| `docs/REMAINING-WORK.md`                                    | Any runtime flag, any deployed image          |

`PROD-DEPLOY-RUNBOOK-gate-g3.md:65-66` states it directly: every strangler surface except FX is
`efcoreReadOnly`/`efcoreStranglerWrite` over **existing Prisma tables (no DDL)**. Nothing about the flip
executes SQL. No App Runner rebuild. No Vercel env change.

Corollary: **"C# is the sole writer" is a code invariant, never a DB-enforced one.** `app_tenant` keeps
its full `INSERT/UPDATE/DELETE` grant on the flipped table (§3). Tightening that requires an explicit
`REVOKE`, which is a separate, out-of-scope decision — and one whose blast radius extends past the
flipped table's own readers, to any table whose RLS policy **references** it in a subquery (§3f, Q7).

---

## 0. Preconditions

Every box must be green **before** the flip PR is opened. Re-verify at flip time; do not trust a
prior issue's grep — issue #64's own context is already partly stale (§7).

> **P0 — Verify against the committed schema baseline, not against migration files (#115, 2026-08-03).**
> This runbook previously had no trustworthy source for "what does the schema look like right now",
> which was the M2 blocker. There is one now:
> [`packages/db/baseline/prod-public-schema.sql`](../../../packages/db/baseline/prod-public-schema.sql)
> — `pg_dump --schema-only` of prod, committed, and asserted still-current by `/gate` **check 16**.
>
> ```bash
> bash scripts/db/schema-baseline.sh check   # exit 0 = the baseline still matches prod
> ```
>
> **Run this first.** If it exits 1, prod has drifted since the baseline was captured and every other
> precondition below is being measured against a stale picture. If it exits 2 it did **not run** — that
> is not a pass. Once it is green, `grep` against the baseline file instead of querying prod ad hoc: it
> is the same data, but committed and reviewable in the PR rather than read once in a session.
>
> That is a real improvement and **not** immunity from misreading. The baseline is `pg_dump` output — the
> same `pg_policies` information in another form, larger and less structured than the targeted query that
> _was_ misread in #111. It removes the "nobody else can check my query" failure mode, not the "I read it
> wrong" one. For per-table RLS _shape_, still read `pg_get_expr(polqual, polrelid)` **per table** (P9)
> rather than inferring structure from aggregates — that exact mistake produced a false claim about
> `calibration_members`/`calibration_votes` during #111.
>
> The four-DDL-path reconciliation is [`../ddl-reconciliation-2026-08-03.md`](../ddl-reconciliation-2026-08-03.md);
> the governance policy it produced is [`../ddl-governance.md`](../ddl-governance.md).

**P1 — Zero TS writers, grep-verified now.**

```bash
# camelCase delegate, all write ops
grep -rnE '\.(<model>)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(' \
  packages/ apps/web/ workers/ scripts/ --include='*.ts' --include='*.tsx' | grep -v node_modules
# raw SQL naming the table
grep -rnE '(INSERT INTO|UPDATE|DELETE FROM)\s+"?<table>"?' packages/ apps/web/ workers/ services/ scripts/
```

Seeds count. `packages/db/prisma/seed.ts` / `seed-demo.ts` writes are writers — they must be ported to
raw SQL, ported to a C# seeder (none exists today), or the flip is blocked. `scripts/parity/seed.ts`
already writes via `pg` raw SQL, so it survives a flip mechanically.

**P2 — Cross-domain Prisma READERS enumerated and each one dispositioned.** **Six** grep strategies,
all of them (a `.model.method` grep alone is not sufficient — see §7's relation-traversal reads):

> **The sixth was added 2026-08-04 after flip #2 missed it.** The first five are all `.ts`-scoped, so a
> **data-driven** consumer is invisible to every one of them. Flip #2's first full-suite run failed on 6
> cases in `contracts/access-fixtures/scope-where.json`, a JSON fixture that names entities as strings and
> is read by both stacks. `tsc` cannot see it and none of the five greps looked at `*.json`. Run the sixth
> before concluding a reader sweep is complete.

```bash
grep -rnE '\.<model>\.[a-zA-Z]+\(' packages/ apps/web/ workers/ scripts/ --include='*.ts'   # delegates
grep -rn '<backRelationFieldName>' packages/api apps/web                                     # relation traversal
grep -rniE '\b<table>\b' packages/ apps/web/ workers/ scripts/                               # raw SQL / strings
grep -rnE "'<model>'" packages/api/src/access/                                               # dynamic delegate map
grep -rnE 'utils\.[a-zA-Z]+\.<procedure>\.(invalidate|fetch|prefetch|setData)' apps/web      # tRPC CACHE consumers
grep -rn '<model>' contracts/ tests/ --include='*.json'                                      # SIXTH: data fixtures
```

The fourth matters: `packages/api/src/access/scoped-probe.ts:41-63` resolves Prisma delegates from a
`Record<ScopedEntity, …>` map, which is invisible to a `.model.method` grep and is the only dynamic
delegate indexing in the repo. Its keys are mirrored in `packages/api/src/access/entity-policies.ts`
(`ScopedEntity` union + `ENTITIES` set) and `packages/api/src/access/scoped-probe.ts:16-39`
(`NOT_FOUND_MESSAGES` — an exhaustive `Record`, so removing one key without editing the union fails
`tsc`).

The **fifth is new (added 2026-08-02 after a review caught two misses)** and is the one that has already
bitten twice. A procedure with zero `useQuery` consumers can still be a live FE dependency purely through
its **cache key**: `apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx:58` calls
`utils.engagement.listSurveys.invalidate()` and
`apps/web/app/(admin)/monitoring/alert-rules-modal.tsx:82` calls
`utils.monitoring.getExecutiveKpis.invalidate()`. Neither is a `useQuery` and neither appears in any of
the first four greps — yet deleting the procedure breaks `Type Check (web)` (the property vanishes from
the typed utils object) **and** a static tripwire (`tests/tier1/s2-engagement-wiring.test.ts:33`).
"Zero FE consumers" is only true after this grep returns nothing.

Each reader gets exactly one disposition, decided before the PR:

- **Delete** — the procedure is dead: zero FE **query** consumers, zero FE **cache** consumers (grep 5),
  no parity-harness entry, and no static tripwire naming it. **Never** available for a read site
  reachable from a cron route, a scheduled job, a webhook handler, or a compliance/export path,
  regardless of FE consumers — those have no FE consumer _by construction_ (see the "Extract" note).
- **Repoint** — the whole procedure moves to the C# read endpoint through the
  `apps/web/lib/platform-api/*` wrapper pattern.
- **Extract** — the read site sits **inside a procedure that must survive**. Neither "Delete" nor
  "Repoint" applies: the surrounding procedure stays on tRPC and the one read must be served from the
  C# read surface.

  > ⚠️ **Corrected 2026-08-07.** This bullet used to say "server-to-server". **No such credential path
  > is wired**, so every Extract taught from it would be mis-designed. `packages/api/src/lib/platform-api-client.ts:9-11`
  > forwards the CALLER's own `Authorization` header verbatim and never holds or issues a credential of
  > its own — it works for the external-vendor surface only because a third-party server calls tRPC
  > directly with its own `Bearer tims_...` key. A staff/platform-owner tRPC request carries no such
  > header: the tRPC link (`apps/web/lib/trpc-provider.tsx:38-43`) sends none. The mechanism that
  > **does** work is **browser-direct** via `apps/web/lib/platform-api/client.ts:73-80`, which reads the
  > live Supabase session client-side — the pattern audit-log and access-review already use. Do not
  > record this as "Extract is unimplementable"; that is equally wrong.

  Worked counterexample the taxonomy previously had no slot
  for: `packages/api/src/routers/platform/data-requests.ts:93-97` reads
  `db.employeeCompensation.findMany({ … })` inside `exportSubjectData`, the GDPR / Ley 1581/2012
  right-of-access bundle (`:8-16`). The procedure has a live FE consumer
  (`apps/web/app/(admin)/platform/support/data-requests.tsx:20`) so it is not deletable, and it uses the
  privileged cross-org `db`, not `tenantDb`, so it is not repointable through a tenant-scoped read.
  Deleting just the read site yields a **200 export silently missing a legally mandated section**.
- **Blocked** — no C# read surface exists yet ⇒ the flip does not start.

**Field-authorization / audit parity is part of the disposition, not a follow-up.** For any table
registered in `packages/api/src/access/classification.ts` or `packages/api/src/access/select-for.ts`
(`employeeCompensation`, `salaryAdjustment`, `assessmentResult`, `employeeDemographics`,
`surveyResponse`), the flip PR must prove the C# replacement enforces the **same** `selectFor` field
authorization and the **same** fail-closed `logDataAccess` policy (`packages/api/src/access/audit.ts:24-27,45-68`),
and must **re-anchor** the corresponding tripwire rather than delete it. The repo-side guard for these is
a source-**count** tripwire (e.g. `tests/access/scope-wiring-sensitive-data.test.ts` asserting
`entity: 'employeeCompensation'` occurrences `>= 2`), so removing readers removes the guarantee _and_ its
alarm with a green suite. Note also that `employee_compensations` has **five** Prisma read sites, not the
one P3 cites: `routers/compensation.ts:30`, `routers/compensation.ts:80`,
`services/compensation.service.ts:62`, `routers/platform/data-requests.ts:94`, and
`access/scoped-probe.ts:76` — a bare delegate thunk (`() => tenantDb.employeeCompensation`),
which is invisible to a `.model.method` grep and is why it kept being missed. Its sibling
`access/scoped-probe.ts:77` is the identical construct for `salaryAdjustment`; both must be
dispositioned via the `FlippedEntity` union, never by deleting the entity from `ScopedEntity`.

**Do not** convert a Prisma read to `$queryRaw` to make `tsc` pass. `scripts/table-ownership.mjs` is
blind to raw SQL (§1, discovery), so this silently reintroduces a second reader of an EF-owned table
with zero CI signal. It is the single easiest way to make this runbook worthless.

**P3 — Cross-stack relation joins identified.** A flipped table joined to a Prisma-owned table in one
query cannot stay one query. `survey_responses ⋈ users` (§7) and `employee_compensations ⋈ salary_bands`
(`packages/api/src/services/compensation.service.ts:71` — **one of five** `employeeCompensation` read
sites; see the P2 note) are both real. Either flip both tables together
or denormalize into the C# read model. Tables that are joined and _both_ flip-ready must flip in the
same PR.

**P4 — Live RLS/GRANT inventory taken** for each table (§3). Not read from the migration source — read
from `pg_policy` / `pg_class` / `information_schema.role_table_grants` on prod.

**P5 — Enum re-exports checked.** `packages/db/src/index.ts:16-18` re-exports `ReviewCycleStatus`,
`RaterRelationship`, `RaterAssignmentStatus`, declared in
`packages/db/prisma/schema/evaluation360.prisma:7,14,21`. Flipping `review_cycles`/`rater_*` breaks every
consumer of those three enums. Budget it, or pick a different domain.

**P6 — Tripwire tests located — by sweep, not by citing one file.** Do this and disposition every hit:

```bash
grep -rln '<Model>\|<model>\|<procedure>' tests/
grep -n  'engagement\|[Ss]urvey' tests/access/scope-wiring-sensitive-data.test.ts   # per-domain re-read
```

`tests/access/scope-wiring-sensitive-data.test.ts` asserts on the _literal Prisma source text_ of several
readers (e.g. `:445-457` for the engagement survey reads) and is amended on **every** engagement deletion
pass, so its line numbers drift between passes — re-derive them, never copy them from a prior issue.
But it is **not the only** tripwire file: prior TS-deletion passes have been caught by tripwires in
`tests/tier1/`, `tests/monitoring/`, `tests/dei/` and `tests/access/` alike. For the §7 flip alone the
sweep returns `tests/access/scope-wiring-sensitive-data.test.ts`, `tests/tier1/s2-engagement-wiring.test.ts`,
`tests/monitoring/monitoring-suppression.test.ts`, `tests/monitoring/alert-evaluation.test.ts`,
`tests/monitoring/executive-kpis-vacancy-status.test.ts` and `tests/dei/sub-floor-aggregate-leaks.test.ts`.
They are static greps and hand-rolled mocks — a green suite is **not** evidence a flip is clean, and an
under-enumerated tripwire list is the most common way a flip PR goes red after it is opened.

**P7 — ~~`.claude/rules/db.md:66` acknowledged~~ → RESOLVED 2026-08-03 (#115).** That line said
_"Production: `prisma migrate dev` → `prisma migrate deploy`"_, contradicting `00-master-plan.md` §4 and
the observed reality (prod has no `_prisma_migrations` table at all). It has been **corrected**, not just
annotated: `.claude/rules/db.md` now states that Prisma Migrate is formally unused in production and
points at [`../ddl-governance.md`](../ddl-governance.md). `00-master-plan.md` §4 was corrected in the same
PR. No action left for the first flip.

**P8 — The repo retains an executable `CREATE` for the table.** Deleting the Prisma model can remove the
**only** DDL definition of the table in the entire repository. Check before you delete it:

```bash
grep -rn 'CREATE TABLE "\?<table>' packages/db/prisma/migrations/ services/Tims.Platform/
```

For `surveys`/`survey_responses` the answer today is: **nothing in `packages/db/prisma/migrations/`**
(25 migration dirs; `20260604100000_enable_rls_tenant_isolation/migration.sql:283-290` only `ALTER`s
them), and the only surviving `CREATE TABLE "surveys"` statements are C# **test fixtures**
(`EngagementReadFixture.cs:145,150`, `EngagementWriteFixture.cs:226,232`, `DeiReadFixture.cs:156,161`).
Combined with the §4 option-(c) decision (EF holds no migration and no snapshot), the flip would leave the
repo with **zero** executable definition of those tables. That matters concretely, because `README.md:80`
and `CLAUDE.md:32` both document `prisma db push` as the step immediately after `git clone`: a freshly
bootstrapped dev DB would simply not have the tables, and the P1-recommended raw-SQL port of
`packages/db/prisma/seed-demo.ts:1207,1226` would hard-fail with `relation "surveys" does not exist`.

**The fix is now a tool, not hand-authoring (#128).** `scripts/db/extract-table-ddl.mjs` slices a table's
complete definition out of the committed production baseline:

```bash
node scripts/db/extract-table-ddl.mjs --out services/Tims.Platform/db/flip-ddl/<name>.sql <table>...
```

It emits the `CREATE TABLE`, enum dependencies, sequences (with their ACLs), PK/UNIQUE constraints,
indexes, `ENABLE`/`FORCE ROW LEVEL SECURITY`, the **exact live** policy, role-guarded GRANTs, and the FKs
last — all idempotent, in one transaction. Crucially it reads the policy from the baseline's `pg_catalog`
snapshot, **not** from a migration file, which is what this paragraph originally demanded and what #111
proved is not optional.

**How bad P8 actually is, measured after flip #1:** of 101 Prisma-mapped tables, only **17** have a
`CREATE TABLE` anywhere in `packages/db/prisma/{migrations,manual}`. The other 84 were created by
`prisma db push` and exist as DDL nowhere. P8 therefore gates almost every flip in #28, not just #64.

Already committed ahead of their flips, so they are no longer P8-blocked:
`services/Tims.Platform/db/flip-ddl/surveys.sql` (#64) and `.../compensation.sql` (#66). Round-trip
verified: applied to an empty PostgreSQL 17 database, the resulting columns, constraints, indexes,
policies, RLS flags and grants match production's catalog **exactly** (53/53 and 43/43 canonical lines).

Per flip, commit the extracted DDL alongside the model deletion and apply it in the `db push` bootstrap
path (see `services/Tims.Platform/db/flip-ddl/README.md`). Verify with §5 step 8.

_(`access_reviews` did **not** have this problem — it has a real migration file at
`packages/db/prisma/migrations/20260717170000_add_access_reviews/migration.sql:4`. That is one more
reason it was the better pilot; see §7.)_

**P9 — Per-table RLS _shape_ classified from the live DB.** Read
`pg_get_expr(polqual, polrelid)` for every policy on the candidate table and classify it as a
**column predicate** (`organization_id = …`) or a **subquery** (`EXISTS (SELECT 1 FROM parent …)`).
`services/Tims.Platform/src/Tims.Domain/Rls/TenantRls.cs:18,31-32` hardcodes
`OrgColumn = "organization_id"` and can only emit the column-predicate form, so
**`EnableTenantRls()` structurally cannot serve a subquery-policy table.** `calibration_members` and
`calibration_votes` are exactly that: they have **no `organization_id` column at all** and their live
policies are parent subqueries over `calibration_sessions`
(`packages/db/baseline/prod-public-schema.sql:7480-7499`; also
`…/20260604100000_enable_rls_tenant_isolation/migration.sql:326,330`).
See §3(e) for what goes wrong if the ledger's standing "ships its RLS block via `EnableTenantRls()`" rule
is followed literally on those two.

> **Updated 2026-08-06 by flip #3 (§7d).** These two were `efcoreStranglerWrite[]` when this paragraph
> was written; they are now **`efcore[]`**, so the ledger rule applies to them for real rather than
> prospectively. The carve-out has been written into `table-ownership.md` "The rule". The Prisma models
> cited by the original text (`ninebox.prisma:41-77`) are deleted — the shape is now read from the
> baseline or from `services/Tims.Platform/db/flip-ddl/calibration.sql`. `TenantRls.cs:10-13`'s docstring
> still needs the same carve-out and did not get it (flip #3 touched no C# file).

**P10 — EF write-value column-type compatibility, verified against `information_schema`.** For the table
being flipped, **every** EF property must either pin `HasColumnType(...)` matching the live column type or
be `ValueGeneratedOnAdd`. This is a real precondition, not a formality: `EngagementWriteDbContext.cs:41-47,56`
carries **nine** `HasColumnType("timestamp")` pins and its doc comment (`:9-11`) explains exactly why
(Prisma `timestamp(3)` vs Npgsql's default `timestamptz` handling), while `AccessReviewDbContext.cs:52-55,76-80`
carries **zero** — safe only by accident, because its two datetime columns are
`HasDefaultValueSql("now()").ValueGeneratedOnAdd()` (`:117`, `:124`) so EF never sends a value.
Repo-wide, **8 of 28 strangler `DbContext`s carry no timestamp pins at all.** Verify against
`information_schema.columns` on prod, never against the Prisma model. §6's reversibility argument depends
on this check, not on the absence of an EF migration (§6).

---

## 1. The procedure — ONE PR, not two

**One PR. Both split orderings are red builds.** This was traced against the real repo's parsed inputs
(102 Prisma `@@map` tables, 56 EF `ToTable` tables) using the script's exported pure functions:

| Ordering                                                 | Result                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Ledger move **+** Prisma model deletion, same commit     | **clean, `[]`**                                                                   |
| Prisma model deleted first, ledger untouched             | ✗ `strangler-write mapping of a non-Prisma table` (`table-ownership.mjs:128-132`) |
| Ledger moved first, Prisma model still present           | ✗ `cross-owner collision` (`table-ownership.mjs:113-117`)                         |
| Added to `efcore[]` but left in `efcoreStranglerWrite[]` | ✗ same strangler-write violation                                                  |

So `phase-5-strangler.md`'s step 6 / step 7 numbering is misleading: for the **Prisma model
specifically**, steps 6 and 7 are the same commit. (Deleting the _tRPC procedures/services_ can still be
staged separately — only the `@@map` is coupled.)

**How the check discovers tables** (`table-ownership.mjs:58-88`): pure regex over source text —
`@@map("…")` across `packages/db/prisma/schema/*.prisma` (non-recursive, `.prisma` only) and
`\.ToTable\("…"` across `services/Tims.Platform/src/**/*.cs`. No DB, no migration parsing, no
awareness of raw SQL, and **no awareness of which stack reads a table**.

**Corrected 2026-08-02** — an earlier draft of this paragraph claimed "a table in `efcore[]` that another
domain still reads via Prisma is _not_ a violation of this check." That was wrong, and its own ordering
table (above) refutes it. A Prisma delegate read **requires** the Prisma model; the model's `@@map` puts
the table in `prismaSet`; `efcore[] ∩ prismaSet` is precisely the `cross-owner collision` rule at
`table-ownership.mjs:113-117`. Simulation confirms it: `efcore[]` + model still present = 2 collisions.
The accurate statement:

> Once the model is **deleted**, a leftover TS Prisma reader of an `efcore[]` table is invisible to this
> check — it surfaces only as a **`tsc`** failure. A reader that still compiles means the model still
> exists, which the check **does** catch as a cross-owner collision. Only **raw-SQL** readers escape both
> (which is why §0 P2 forbids converting a Prisma read to `$queryRaw` to make `tsc` pass).

`prisma generate` does not belong in that sentence either: it never fails because of a leftover TS
reader. It fails on a surviving **back-relation** (`P1012`) — a distinct concern, handled by step 3 below.

### Steps

1. **Branch.** `feat/flip-<domain>-ownership`.

2. **Delete the Prisma model(s)** from `packages/db/prisma/schema/<domain>.prisma`.

3. **Delete every inbound relation field in OTHER schema files.** The Prisma schema is one namespace
   across 29 files; a surviving back-reference is a hard `P1012` validation failure, and the ownership
   check will _not_ catch it (it only greps `@@map`). Find them with:

   ```bash
   grep -rn '<ModelName>' packages/db/prisma/schema/
   ```

   `prisma validate` is the real gate here, and `prisma generate` runs in all three `ci.yml` jobs
   (`:37`, `:59`, `:173`).

4. **Move the table name in the ledger**: delete it from `efcoreStranglerWrite[]` (or whichever list it
   is in) and add it to `efcore[]` in `docs/architecture/table-ownership.md`. Keep it in exactly one
   list. **Copy the name; do not retype it** — a typo'd `efcore[]` entry passes the check silently
   (`table-ownership.mjs:113-117` only asks `prismaSet.has(t)`; nothing asserts the entry corresponds to
   a real EF `ToTable`). A typo means the real table falls out of _every_ ledger list with a green build.

5. **Add a flip note** to the ledger's `notes` object recording: date, the PR, which C# writer is now
   sole owner, which readers were deleted vs repointed, and the DDL-home decision from §4. The `notes`
   object is parsed but never validated (`table-ownership.mjs` never reads it) — it is documentation,
   never enforcement.

6. **Fix every TS reader** per its P2 disposition. Expect `tsc` breakage in five distinct categories:
   Prisma delegates; generated `Prisma.<Model>WhereInput` types; the access registry (see the correction
   immediately below); hand-rolled `vi.mock('@tims/db')` delegate lists; and `packages/db/src/index.ts`
   enum re-exports.

   > **CORRECTED 2026-08-04 by flip #2 (#69). Do NOT strip the entity from the scope-policy registry.**
   > An earlier version of this step said to clean "the access-registry triple (`entity-policies.ts`
   > union + set, `scoped-probe.ts` `NOT_FOUND_MESSAGES` + `DELEGATES`)". Following that literally is
   > **wrong and silently destructive**. Only **`scoped-probe.ts`'s `DELEGATES`** actually needs the
   > Prisma model — it is the one place that dereferences `tenantDb.<model>`.
   >
   > `scopeWhereFor` in `entity-policies.ts` is a **pure function**: it builds a where-fragment and never
   > touches the Prisma client, so a flip does not require removing it. Worse, its expected outputs live
   > in **`contracts/access-fixtures/scope-where.json`, a cross-stack contract** asserted by
   > `tests/access/scope-where-fixtures.test.ts` (described in that file as "the production-TS oracle that
   > pins the fixtures") **and** by `Tims.UnitTests/Fixtures/ScopeWhereForFixtureTests.cs`. C# still needs
   > both roots — `Tims.Domain/Access/ScopeProbeRegistry.cs` registers them for its own by-id probes and
   > row filters. In flip #2, removing the TS entries broke **6 fixture cases**; "fixing" that by deleting
   > the fixture cases would have deleted the oracle that pins C#'s own implementation. The flipped
   > table's scope policy is part of the contract the C# owner must satisfy — it outlives the Prisma model.
   >
   > Keep `NOT_FOUND_MESSAGES` complete too: those exact Spanish strings are mirrored in
   > `Tims.Domain/Access/ScopedNotFoundException.cs`.
   >
   > Make the distinction compile-enforced rather than a comment (as flip #2 did):
   >
   > ```ts
   > type FlippedEntity = 'successor' | 'criticalRole';           // widen on each flip
   > export type ProbeableEntity = Exclude<ScopedEntity, FlippedEntity>;
   > const DELEGATES: Record<ProbeableEntity, () => unknown> = { … };  // annotate — a bare `as const`
   >                                                                  // enforces nothing
   > export async function assertScoped(entity: ProbeableEntity, …)
   > ```
   >
   > Now a by-id probe on a flipped entity is a **compile** error instead of an undefined-delegate crash,
   > and the next flip that forgets to widen `FlippedEntity` fails to compile at `DELEGATES`.

   **Find the real mock list per flip — do not reuse the example.**
   `tests/access/scoped-probe.test.ts:3-25` is the generic _pattern_ for a hand-rolled delegate mock, but
   for the §7 flip it is **the wrong file**: `grep -rniE 'survey' packages/api/src/access/` returns only
   `select-for.ts:13`, `classification.ts:120` and two comments — `scoped-probe.ts` has no survey delegate
   at all. The two files that actually mock the survey delegate, and that actually execute the readers §7
   repoints, are `tests/monitoring/executive-kpis-vacancy-status.test.ts:7`
   (`survey: { count: vi.fn() }` inside `vi.mock('@tims/db')`, driving a real tRPC caller through
   `caller.monitoring.getExecutiveKpis()`) and `tests/monitoring/alert-evaluation.test.ts:8,16`
   (`db.survey.count` for `alertEvaluationRepository.computeMetric`). Repointing the first reader to a C#
   fetch makes that test hit an unmocked network call **inside** the caller; the second's mock is left
   wired to a delegate that no longer exists. Locate them with:

   ```bash
   grep -rln "vi.mock('@tims/db')" tests/ | xargs grep -ln '<model>'
   ```

   **Two access-registry entries will NOT fail `tsc` and must be cleaned by hand.**
   `packages/api/src/access/select-for.ts:13` (`surveyResponse` in `ANCHOR_FIELDS`) and
   `packages/api/src/access/classification.ts:120` are typed `Record<string, …>`, not keyed on a Prisma
   model union — a stale entry compiles forever. Grep them explicitly; the compiler will not.

7. **Update tripwires, parity surfaces, seeds, docs** in the same commit:
   - the source-text assertions found by the P6 **sweep** (not just `scope-wiring-sensitive-data.test.ts`);
   - `scripts/parity/surfaces.ts` — and **`scripts/parity/surfaces.test.ts` in the same commit**. That
     test file is the enforcement layer for the file this step already tells you to edit, and
     `vitest.config.ts:50` includes `'scripts/**/*.test.ts'` in the node project, so `npx vitest run`
     executes it. Editing `surfaces.ts` without it is a guaranteed red `Security Audit`. See §7 item 4
     for the legal edits — and note that as of 2026-08-05 (#57) `tsProcedure` **is optional**, so
     "remove the `tsProcedure` side, keep the endpoint" IS now one of them, and is usually the RIGHT
     one;
   - the seed files;
   - `docs/REMAINING-WORK.md`;
   - **`README.md:80,96-97` and `CLAUDE.md:32`** if the flip ships the §2 `db push` guard — both document
     the unguarded command, and `CLAUDE.md` auto-loads into every agent session.

8. **Grep the domain name repo-wide** before opening the PR. Every prior TS-deletion pass was bitten by
   stale generic prose — file headers, worked examples in help text, `scripts/deploy/README-cutover.md`.

9. **Run the verification set** (§5) locally, then open the PR.

### `Type Check (api)` is not api-scoped — it type-checks the whole repo

`ci.yml:40` runs `pnpm --filter @tims/api exec tsc --noEmit`, which sets cwd to `packages/api` — **which
contains no `tsconfig.json`** (the only `tsconfig.json` under `packages/` is `packages/i18n/`). `tsc`
therefore walks up and resolves the **root** `tsconfig.json`, which declares no `include` and only
`"exclude": ["node_modules"]`. Consequences a flip PR must plan for:

- `scripts/**`, `tests/**` and `apps/web/**` are **all** in the `Type Check (api)` program. A type error
  in `scripts/parity/surfaces.ts` or in a `tests/` file reddens the _api_ job, not just the web one.
- A deleted tRPC procedure that a `.tsx` file still references reddens **both** typecheck jobs, not one.

Budget CI failures accordingly: the ownership check is the narrowest of the gates a flip trips, and
reasoning about it in isolation systematically under-scopes the blast radius.

### What CI will and will not do

Two independent entry points run the check:

- `.github/workflows/dotnet-platform.yml:92-108` — job `table-ownership`, `node scripts/table-ownership.mjs`.
  Has a `paths:` filter (`:11-26`) covering `services/Tims.Platform/**`, `contracts/**`, `packages/db/**`,
  `scripts/**` — **not** `docs/**`. A docs-only ledger edit skips this job.
- `.github/workflows/ci.yml:60` — `npx vitest run`, no paths filter, picks up
  `tests/governance/table-ownership.test.ts:8-10` (`expect(checkRepo()).toEqual([])`).

A real flip PR touches `packages/db/**`, so both fire. But:

> **`main` has NO required status checks and no rulesets.** `gh api …/branches/main/protection` returns
> no `required_status_checks` key; `…/protection/required_status_checks` → 404; `…/rulesets` → `[]`.
> Protection is 1 approving review + dismiss-stale + no-force-push, `enforce_admins: false`.
> **A red table-ownership job does not block the merge**, and `gh pr merge --admin` bypasses everything.
> The ledger header's "CI-enforced" (`table-ownership.md:1,3,8-9`) overstates the real gate. If the flip
> is to be genuinely gated, adding `table-ownership` + `Security Audit (56 tests)` as required checks is
> a prerequisite, not a follow-up.

Also stale and not to be used as a spec: `table-ownership.md:152-162` ("What the CI check enforces
(Phase 1)") describes 2 rules against 1 EF table. The code implements **six** rule families against 56
EF-mapped tables. The accurate prose is the legend at `:116-138` plus the script itself. Fixing that
section is a cheap side-quest for the flip PR.

---

## 2. The DROP TABLE hazard

**The flip PR itself ships no SQL and cannot drop anything. The hazard is a human running a Prisma CLI
command afterwards.**

Proven empirically, offline, no DB touched: copy `packages/db/prisma/schema` to a scratch dir, delete
`succession.prisma` and the three `user.prisma` back-relations, then

```bash
npx prisma migrate diff --from-schema-datamodel <before> --to-schema-datamodel <after> --script
```

emits four `DROP CONSTRAINT`s followed by `DROP TABLE "critical_roles"; DROP TABLE "successors";`.
Prisma's engine renders any ownership flip as a table drop, because from Prisma's point of view the
table just became drift.

**What cannot trigger it:**

- CI. `ci.yml` runs `prisma generate` only (`:37`, `:59`, `:173`); `dotnet-platform.yml` runs no
  `dotnet ef` command; `apps/web` build is plain `next build`; `turbo.json` `build` only
  `dependsOn: ["^build"]`.
- The prod deploy path. Prod is **not** `prisma migrate`-managed — live query confirms
  `_prisma_migrations` does not exist, while `__EFMigrationsHistory` does. `prisma migrate deploy` has
  never run and never will.
- Deploying the C# image. There is no runtime auto-migrate: zero `Migrate()`/`MigrateAsync()` calls in
  `services/Tims.Platform/src`; DDL is applied out-of-band by hand
  (`PROD-DEPLOY-RUNBOOK-gate-g3.md:73-74`).

**What can:**

1. **`prisma migrate diff --from-schema-datasource` — the highest-probability trigger, and it is a
   _routine_ command, not an accident.** This is the repo's own documented way to author a prod migration:
   `docs/superpowers/plans/2026-07-08-company-entitlements-slice-1.md:130-137` prescribes
   `npx prisma migrate diff --from-schema-datasource prisma/schema --to-schema-datamodel prisma/schema --script > prisma/migrations/<id>/migration.sql`,
   then states the file "is applied to **prod** later via `prisma db execute --file` per repo convention."
   `--from-schema-datasource` **introspects the live DB**, which still holds the flipped table. So after a
   flip, **every future prod migration authored that way begins with `DROP TABLE` against a live table
   with data** — and the plan doc primes the reviewer to expect only `CREATE TABLE` output, so a prepended
   `DROP` reads as noise. Reproduced offline against a schema copy with `model Survey`/`model SurveyResponse`
   and `user.prisma:105-106` removed: 3 × `DROP CONSTRAINT` + `DROP TABLE "surveys"; DROP TABLE "survey_responses";`.
   The same applies to any `--from-url` form. **A `db:push`/`db:migrate` script guard does not touch this
   path at all.**
2. A human running `pnpm db:push` (`packages/db/package.json` → `prisma db push`) or `pnpm db:migrate`
   (`prisma migrate dev`) against any live `DATABASE_URL` after the model is gone. `prisma db push --help`
   lists `--accept-data-loss` and `--force-reset`.
3. A human running the **raw** form, `cd packages/db && npx prisma db push --schema=prisma/schema` —
   which is what `CLAUDE.md:32` (auto-loaded into every agent session) documents as _the_ dev schema
   command, and what `docs/superpowers/plans/2026-08-01-assessment-player-norm-scoring.md:236` and
   `…/2026-07-08-company-entitlements-slice-1.md:153` repeat. **Renaming the package.json scripts does
   nothing for this call site.**

### Mandatory in the flip PR

Add to the PR description and to the ledger note, verbatim:

> **After this PR, `pnpm db:push` / `npx prisma db push` / `pnpm db:migrate` will DROP `<table>`, and
> `prisma migrate diff --from-schema-datasource` will EMIT a `DROP TABLE "<table>"` into every migration
> script authored against a live DB.** Do not run any of them against a database that holds real data —
> including preview and staging — and do not commit a generated migration script without grepping it for
> `DROP`/`ALTER` on a flipped table, until this table's Prisma model is restored or the commands are
> guarded.

The flip PR must **also** amend `docs/superpowers/plans/2026-07-08-company-entitlements-slice-1.md:130-137`
(and any successor migration-authoring doc) to either pass `--exclude-tables` for every table in
`efcore[]`, or to mandate that the generated script is diffed for `DROP`/`ALTER` on flipped tables before
it is committed.

### **UNRESOLVED — verify before the first flip**

> **It is NOT known what `prisma migrate dev` actually does against a database that has no
> `_prisma_migrations` table and heavy drift.** It plausibly offers a full database **reset**, which is
> strictly worse than a targeted `DROP TABLE`. This could not be tested: local Prisma credentials are
> known-broken (P1000) and pointing it at prod is not acceptable.

Resolve it exactly this way, once, before flip #1:

1. Provision a throwaway Postgres (Supabase branch or local Docker), load the current schema with
   `prisma db push`, insert a marker row into the candidate table.
2. Delete the model + back-relations locally, point `DATABASE_URL`/`DIRECT_URL` at the throwaway.
3. Run `pnpm db:migrate` and record verbatim what it prompts and what it does to the marker row.
4. Record the answer in §8 of this file.

Then ship a guard with flip #1. **The guard must be command-level, not script-level.** An earlier draft
recommended renaming `db:push`/`db:migrate` in `package.json` — that protects the two wrappers nobody is
told to use, while `CLAUDE.md:32`, `README.md:80,96-97` and two plan docs all point at the raw
`npx prisma db push` form, which bypasses the rename entirely. What actually covers every call site:

- a `packages/db/prisma/preflight` wrapper (or a `husky` pre-commit + a wrapper binary on `PATH`) that
  reads `DATABASE_URL`/`DIRECT_URL` and **refuses `db push` / `migrate dev` when the host is not
  `localhost`** — so `npx prisma db push` is covered too;
- and, in the same PR, `CLAUDE.md:32` + `README.md:80,96-97` updated to the guarded form (§1 step 7 lists
  both as mandatory edits).

A prominent warning is the minimum; the guard is the right answer, because the footgun is two words long,
sits in the root `package.json` **and** in the always-auto-loaded `CLAUDE.md`.

---

## 3. RLS and GRANTs on a transferred table

**Nothing physical happens, so policies and grants survive untouched.** The flipped table keeps its
Prisma-authored `tenant_isolation` policy, its `ENABLE`/`FORCE ROW LEVEL SECURITY`, its indexes, its FKs
and their cascade semantics — all verified live on the candidate tables.

**Do NOT re-run `EnableTenantRls` on a flipped table.** `services/Tims.Platform/src/Tims.Domain/Rls/TenantRls.cs:29-33`
creates a policy literally named `tenant_isolation` — it would fail on the existing one, and its text
differs from the Prisma original (`USING` only, no `WITH CHECK`, vs. the Prisma migration's
`USING … WITH CHECK …` at
`packages/db/prisma/migrations/20260604100000_enable_rls_tenant_isolation/migration.sql:290`). For a
column-predicate, permissive `ALL` policy the two are functionally equivalent (`WITH CHECK` defaults to
`USING`), so a drop-and-recreate there would be a silent, pointless rewrite of a live policy. Assert the
existing policy; do not re-declare it. **For a subquery-policy table it is neither pointless nor
equivalent — it is an outage. See (e).**

Live findings the runbook must not paper over:

**(a) Prod RLS is ALREADY divergent from the repo.** Every relevant public table carries a **second,
untracked permissive policy `org_isolation`** — 67 tables, `polpermissive=true`, USING
`((organization_id = current_org_id()) OR (current_org_id() IS NULL))`, no `WITH CHECK`. It exists in
**zero repo files**; no migration creates it, and `current_org_id()` reads the same GUC. Permissive
policies are OR'd in Postgres, so the `OR … IS NULL` disjunct means an unset GUC matches every row —
i.e. **fail-open**, the opposite of the documented fail-closed guarantee. This is a live tenant-isolation
concern independent of any flip; see §8 (Q2/Q3) for how to confirm and who owns it. **Do not flip a table
while assuming its live RLS matches its migration.**

**(b) GRANTs are additive; an EF migration can never narrow them.** The Prisma RLS migration set
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant`
(`…/20260604100000_enable_rls_tenant_isolation/migration.sql:27`; confirmed live in `pg_default_acl` as
`app_tenant=arwd/postgres`). So every new table — **including EF-created ones** — gets full DML for
`app_tenant`. Proof: `20260723032952_fx_rates.cs:31-36` deliberately emits `GRANT SELECT ON fx_rates TO
app_tenant` and comments "SELECT ONLY", yet live prod shows `app_tenant` holding
`SELECT, INSERT, UPDATE, DELETE` on `fx_rates` — which is also RLS-exempt with zero policies. Least
privilege requires an explicit `REVOKE`, verified against `pg_catalog`, never inferred from migration
source.

**(c) Testcontainers proofs cannot see (b).** `FxSchemaFixture.cs:36-49` creates `app_tenant` fresh in a
database with no `ALTER DEFAULT PRIVILEGES`, so the container matches the migration's _intent_, not
prod's reality. Container RLS/GRANT tests prove things about the migration. Only a live `pg_catalog`
assertion proves things about prod.

**(d) No automated RLS coverage exists for a flipped table.** `RlsMigrationLinter`
(`TenantRls.cs:49-57`) only compares "tables created" vs "tables wrapped", so a migration that creates
nothing trivially passes; and it is exercised against exactly one hardcoded file path
(`HrisMigrationRlsTests.cs:79-82` pins `20260716000000_hris_domain.cs`). The §5 live-DB assertion is the
only real check the flip gets.

**(e) `EnableTenantRls()` structurally cannot serve two of the EF-owned tables, and the ledger's standing
rule tells you to use it anyway.** `docs/architecture/table-ownership.md`
("The rule") says every EF-owned table "ships its RLS block via `EnableTenantRls()` (org-scoped tables
only)" — and `TenantRls.cs`'s own docstring (`:10-13`) asserts "The emitted block matches the live Prisma
policy (migration 20260604100000…)". **Both are untrue for `calibration_members` and `calibration_votes`:**

> **HALF-CLOSED 2026-08-06 by flip #3 (§7d).** Both tables were `efcoreStranglerWrite[]` when this was
> written; they are now `efcore[]`, so this stopped being prospective. `table-ownership.md`'s rule now
> carries an explicit subquery-policy carve-out. **`TenantRls.cs:10-13` still does not** — flip #3
> touched no C# file, so that half of side-quest 6 remains open. The reasoning below is unchanged.

- Neither table has an `organization_id` column at all — read it from
  `packages/db/baseline/prod-public-schema.sql` or `services/Tims.Platform/db/flip-ddl/calibration.sql`;
  their Prisma models (formerly `packages/db/prisma/schema/ninebox.prisma:41-77`, which gave them only
  `sessionId`/`userId`) were deleted by flip #3.
- Their live policies are parent subqueries, not column predicates:
  `…/20260604100000_enable_rls_tenant_isolation/migration.sql:326` and `:330` —
  `USING (EXISTS (SELECT 1 FROM "calibration_sessions" par WHERE par.id = …session_id AND par.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid))`.
- `TenantRls.cs:18,31-32` hardcodes `OrgColumn = "organization_id"` and can only emit
  `USING (organization_id = …)`.

The failure mode is worse than a no-op. In a hand-applied, **non-transactional** `psql` script the
`DROP POLICY IF EXISTS` succeeds and the `CREATE POLICY` then fails on a nonexistent column — leaving a
`FORCE ROW LEVEL SECURITY` table with **zero policies**, i.e. every calibration row invisible to
`app_tenant` (nine-box calibration outage) — or worse, if someone then "fixes" it by disabling RLS.
§0 P9 is the precondition that catches this; `TenantRls.cs:10-13` and `table-ownership.md:18` both need
the carve-out (side-quest list).

**(f) A `REVOKE` decision must consider policies that _reference_ the flipped table, not only policies
_on_ it.** Postgres evaluates an RLS policy expression **as the querying role**, and
`packages/db/src/tenant-client.ts:41,74` drops every tenant operation to `SET LOCAL ROLE app_tenant`. So
if `calibration_sessions` had `app_tenant`'s privileges revoked, the subquery policies on
`calibration_members`/`calibration_votes` (`migration.sql:326,330`) could no longer
evaluate — **breaking every read and write of those two tables**, neither of which is a reader of
the parent.

> **Still live after flip #3 (2026-08-06, §7d), and the reason its GRANTs were left alone.** This
> paragraph was written as a hypothetical about flipping the parent ahead of its children. All three
> flipped **together**, which removes the _Prisma-owned children_ half of the hazard but **not** the
> hazard itself: the children's policies still subquery the parent, Postgres still evaluates them as the
> querying role, and the C# strangler still queries as `app_tenant` via `TenantScope`'s
> `SET LOCAL ROLE`. A `REVOKE` on `calibration_sessions` would therefore still break the children — now
> for the C# stack instead of the TS one. §8 Q7 stays open for this trio deliberately.

Standing rules, therefore:

- Before any REVOKE, scan `pg_get_expr(polqual, polrelid)` across **all** of `pg_policy` for the candidate
  table's name, not just the rows where `polrelid` is the candidate. Record the result in the ledger note.
- **A table referenced by another table's RLS policy keeps `app_tenant` `SELECT` regardless of flip
  status**, unless the referencing policy is first rewritten to go through a `SECURITY DEFINER` function.

---

## 4. What "EF owns the DDL" means here

> **Superseded in part by #115 (2026-08-03).** DDL governance is now written down authoritatively in
> [`../ddl-governance.md`](../ddl-governance.md), backed by a committed `pg_dump` baseline and `/gate`
> check 16. Read that first; this section keeps the flip-specific reasoning. Two corrections from the
> reconciliation: there are **four** paths, not three (the Supabase dashboard's SQL editor and its table
> editor behave differently — the table editor records nothing at all), and the two Prisma rows below are
> really **one** path, since `prisma/migrations/` is hand-applied exactly like `prisma/manual/`.

| Path                                                                       | Evidence                                                                               | Tracked in                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Prisma, hand-written idempotent SQL applied via `prisma db execute`/`psql` | migration files say so, e.g. `…/20260624000000_ai_interview_session/migration.sql:4-5` | nothing — 24 dirs on disk, zero rows anywhere |
| EF, `dotnet ef migrations script --idempotent` applied via `psql`          | `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`                         | `__EFMigrationsHistory` — **two rows**        |
| Supabase's own migration mechanism                                         | `list_migrations` → 5 rows, several with no repo counterpart                           | `supabase_migrations`                         |

EF has applied DDL to prod **twice** (`fx_rates`, and the four `hris_*` tables on 2026-08-03 via #116 —
which is what created prod's first `__EFMigrationsHistory` row). Both were greenfield tables with no
Prisma reader. **No flipped table has ever had its DDL moved to EF**, and flip #1 (§7) deliberately did
not attempt it. Plan any DDL transfer as first-of-kind.

> Worth knowing before trusting an EF mapping for DDL: the reconciliation found EF's generated
> `--idempotent` script writes its own `__EFMigrationsHistory` row _inside the SQL_
> (`20260716000000_hris_domain.sql:23,33`), which is why the EF path stays self-recording even though
> `dotnet ef database update` is banned against prod — and why hand-writing EF SQL breaks that property.

### The decision the first flip must make

EF cannot honestly own the DDL of a flipped table today:

- No strangler `DbContext` has a design-time factory (only `Fx/` and `Hris/`), so
  `dotnet ef migrations add` cannot even be invoked on one — and whether it succeeds after adding one is
  unverified (§8 Q6).
- No strangler `DbContext` has a model snapshot, so its _first_ migration would start from empty and
  emit `CreateTable` for a table that already exists.
- Strangler contexts are **mixed** — e.g. `AccessReviewDbContext` maps 7 tables, 6 of them Prisma-owned.
  A migration on it would try to create all seven. `ExcludeFromMigrations` has **zero** uses in the repo.
- The mappings are DDL-incomplete: zero `HasIndex` outside `Hris/` and `Fx/`, while prod carries 9
  indexes/constraints on `critical_roles`/`successors` alone. And EF-created tables use
  `timestamp with time zone` while Prisma tables are `timestamp(3)` pinned via
  `HasColumnType("timestamp")` — a scaffolded migration would want to `ALTER` those columns, rewriting
  live data and changing semantics.

**Decision for flip #1 — option (c), stated explicitly in the ledger note:**

> The flipped table stays on the **hand-applied SQL path**. EF holds no migration and no snapshot for it.
> `efcore[]` means "C# is the sole writer and the sole authority for future schema changes to this
> table"; the _mechanism_ for those changes remains a reviewed SQL script applied via `psql`, exactly as
> `00-master-plan.md:68-70` requires.

This is honest, requires no new scaffolding, and keeps the flip a code-only change. It is a deliberate
narrowing of "EF owns the DDL", and the ledger note must say so rather than implying an EF artifact
exists.

The other two options, for when a flipped table actually needs a schema change:

- **(a) Split a pure, single-table `DbContext`** for it + a design-time factory (copy
  `Fx/FxRateDbContextDesignTimeFactory.cs` — placeholder connection string, no secrets), then a
  hand-authored baseline migration with an empty `Up()`/`Down()` whose `.Designer.cs` snapshot records
  the existing model (built from the existing `HasColumnName`/`HasColumnType` pins, never from EF
  defaults). The committed idempotent-script format makes adoption verifiable: every statement in
  `db/manual/20260723032952_fx_rates.sql` is wrapped in
  `IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '<id>')`, so pre-INSERTing
  the history row turns the whole script into a proven no-op. _(This is an observation about the
  artifact format, not an established practice — no adoption migration has ever been done here.)_
- **(b) `ExcludeFromMigrations`** on the Prisma-owned tables of a mixed context, plus a baseline.

**Point of no return — stated path-agnostically (corrected 2026-08-02):**

> **Any DDL change to a flipped table, by _any_ of the three paths in the table above, ends pure-revert
> reversibility.** After it, `git revert` restores a Prisma model that describes a schema which no longer
> exists.

An earlier draft keyed this test on "the moment anyone adds an EF migration that _alters_ the flipped
table's DDL." That test **cannot detect its own violation under the option this section actually chooses.**
Option (c) says EF holds no migration and no snapshot, and future schema changes go through a hand-applied
`psql` script — so an option-(c) DDL change produces **no EF migration**, and the old test would still read
"reversible" while the half-state §6 warns about had already happened. Only one of the three live DDL
paths produces an EF migration at all.

Because option (c) leaves no artifact, the point of no return needs a **detectable marker**. Pick one and
state it in the ledger note:

- require every hand-applied script that touches a flipped table to insert a tracked row (a
  `flipped_table_ddl_log`, or a row in `__EFMigrationsHistory` with a documented synthetic id); **or**
- schedule the §5 step 6 shape query as a **recurring** assertion against the pre-flip snapshot, so a
  silent option-(c) DDL change surfaces as a diff rather than as a surprise during a rollback.

Note also that the ledger `notes` object — the only thing recording the option-(c) decision — is "parsed
but never validated … documentation, never enforcement" (§1 step 5). Do not treat it as a control.

A benefit worth banking under (a) later: `EngagementWriteFixture.cs:226-256` hand-authors a **third**
copy of the schema (`CREATE TABLE surveys …` plus its own GRANT/RLS block). A real baseline migration
would let that fixture switch to `MigrateAsync()` like `HrisSchemaFixture`/`FxSchemaFixture` do, killing
one of three drift sources — but only if the baseline is written to match prod, read from `pg_catalog`.

> **But note what option (c) does to that fixture in the meantime.** For `surveys`/`survey_responses`
> there is **no** `CREATE TABLE` in `packages/db/prisma/migrations/` at all, so once the Prisma model is
> deleted the C# test fixtures (`EngagementWriteFixture.cs:226,232`, `EngagementReadFixture.cs:145,150`,
> `DeiReadFixture.cs:156,161`) become the **only** definitions of those tables left in the repo — the
> "third copy" becomes the last one, and it is a test artifact that no bootstrap path applies. That is
> §0 P8, and it must be resolved before the model is deleted, not banked as a later cleanup.

---

## 5. Verification

Run all of these. Step 0 and steps 6-9 need a real DB (0, 6, 7 and 9 against prod, read-only;
8 against a throwaway).

0.  **Schema drift, FIRST (#115).** Everything below compares the flip against an expected schema; this
    proves the expected schema is still the real one.
    ```bash
    bash scripts/db/schema-baseline.sh check   # 0 = matches, 1 = drift, 2 = DID NOT RUN
    ```
    A flip PR normally changes **no** DDL, so this must be a clean exit 0 both before and after. If the
    flip does move DDL (§4 option (a)/(b)), re-capture the baseline and commit it in the flip PR — the
    baseline diff is then the reviewable record of exactly what the flip did to prod. **Exit 2 is not a
    pass**; resolve it before continuing rather than proceeding on an unverified schema.
1.  **Ledger check, directly.**
    ```bash
    node scripts/table-ownership.mjs        # expect: "table-ownership check passed." exit 0
    npx vitest run tests/governance/table-ownership.test.ts
    ```
2.  **Prisma schema still validates and generates.** This is the real gate for missed back-relations.
    ```bash
    cd packages/db && npx prisma validate --schema=prisma/schema
    npx prisma generate --schema=prisma/schema
    ```
3.  **Both type checks.**
    ```bash
    pnpm --filter @tims/api exec tsc --noEmit
    cd apps/web && npx tsc --noEmit
    ```
    This — not the ownership check — is what catches a surviving Prisma reader.
4.  **Full suite + build.** `npx vitest run` at root, then `/gate`. Remember §0 P6: a green suite is not
    evidence the flip is clean, because the tripwires are static source greps.
5.  **Manual assertion the check cannot make — every `efcore[]` entry maps to a real EF `ToTable`:**

    ```bash
    # run from the repo root; the flag MUST precede -e
    node --input-type=module -e "
    import {parseLedger,parseEfCoreTables} from './scripts/table-ownership.mjs';
    import fs from 'node:fs';
    const l=parseLedger(fs.readFileSync('docs/architecture/table-ownership.md','utf8'));
    const ef=new Set(parseEfCoreTables('services/Tims.Platform/src'));
    console.log('ghost efcore[] entries:', l.efcore.filter(t=>!ef.has(t)));"
    ```

    Verified 2026-08-02 against the current repo: `ghost efcore[] entries: []` (all six pass). A typo in
    step 4 of §1 shows up here and nowhere else.
    _(Consider promoting this to a real rule in `checkOwnership()` — it is a ~3-line addition.)_
    5b. **Pre-flip dependency scan — SCRIPTED as of #132, and WIRED as `/gate` check 18.** Run this
    BEFORE deleting the model, not after:

        ```bash
        npx tsx scripts/db/pre-flip-scan.ts <table>...   # 0 = no blocker · 1 = blocker · 2 = DID NOT RUN
        npx tsx scripts/db/pre-flip-scan.ts --flip-diff  # same, tables derived from the ledger diff
        ```

        **Exit 2 is not a pass** — same contract as checks 14, 16 and 17. `--flip-diff` is the form
        `/gate` runs: it takes the tables from the ownership ledger's `efcore[]` diff against
        `origin/main`, so nobody has to remember to type the names, and on a branch that flips nothing it
        scans nothing and says what it compared.

        It replaces four separate hand-run queries and covers what no repo grep can see:

        - **views/matviews** referencing the table, found BOTH by text over `pg_get_viewdef` AND through
          `pg_depend`. Neither method subsumes the other — measured on PG 17.10, a `plpgsql` function body
          (and equally a dollar-quoted `LANGUAGE sql` body) produces **no `pg_depend` row at all**, so
          those can only ever be a text match, while `pg_depend` catches relations the text arm cannot see.
          **The converse also holds, and it bit us:** a SQL-standard body (`BEGIN ATOMIC … END` or the
          `RETURN` form, PG14+) is stored PARSED in `pg_proc.prosqlbody` with `prosrc = ''`, so it is
          invisible to the text arm and visible ONLY through `pg_depend`. The text arm therefore searches
          `prosrc || pg_get_function_sqlbody(oid)`, not `prosrc` alone. Do not "simplify" that back.
        - **functions**, **triggers**, and any other `pg_depend` dependent (`deptype = 'n'`) — a default
          expression or a generated column can depend on a table too. All BLOCKERS: they keep working
          after the Prisma model is deleted, and keep bypassing whatever scoping the TS stack applied.
        - the §3(f) policy scan, inbound FKs (flagging any from *outside* the flip set, resolved by OID so
          a same-named constraint in another schema cannot become a phantom), `app_tenant` grants (#126),
          and RLS state.
        - **data-file readers** — the class flip #2 actually hit. `contracts/access-fixtures/scope-where.json`
          named `'successor'` / `'criticalRole'`, `tsc` stayed green, and all six P2 greps are `.ts`-scoped.
          Hits there and in `packages/db/prisma/seed*.ts` are BLOCKERS; DDL and parity references are INFO.

        **Every arm reports the population it searched, and a hit count without one is not a result.**
        Flip #3's hand-run queries came back empty for the calibration tables, and the view arm had in fact
        examined nothing worth the name — 0 across a `public` schema that contains 119 tables and **zero**
        views. Each text arm now re-runs its own query against a row it MUST match before its result is
        believed (exit 2 if that fails), and the whole run is fingerprinted against the Prisma schema, so
        an empty or wrong database exits 2 rather than printing a tick. An arm reported **NOT EXERCISED**
        is a statement about the database — copy it into the PR body rather than writing "clean scan".

        Coverage split, stated plainly: the could-not-run paths are EXECUTED in
        `tests/db/pre-flip-scan.test.ts` and the data-file arm is unit-tested for real in
        `tests/db/pre-flip-repo-scan.test.ts`. Exit 0 and exit 1 need a database, so they were proved on a
        throwaway PostgreSQL 17.10 cluster (transcript in the test header, including the mutation that
        turns the functions arm blind and the exit 2 that catches it) and are pinned offline as properties
        — the same split, and the same reason, as `tests/db/schema-baseline-failure-paths.test.ts`.

6.  **Live DB assertion — the table survived, unchanged.** Run against prod (read-only) before and after
    the PR merges, and diff. `pre-flip-scan.ts` above already reports existence, RLS, policies, grants and
    FKs, so this step is the _before/after diff_ of that plus the row-liveness probes below:

    ```sql
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('<table>');

    SELECT polname, polpermissive, polcmd,
           pg_get_expr(polqual, polrelid)      AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS with_check_expr
    FROM pg_policy WHERE polrelid = '<table>'::regclass;

    SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='<table>' ORDER BY grantee, privilege_type;

    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='<table>' ORDER BY 1;

    SELECT to_regclass('public.<table>') IS NOT NULL AS exists,
           pg_relation_size('public.<table>')        AS bytes;

    -- Liveness / deletion probe. NOT an equality assertion — see below.
    SELECT n_tup_ins, n_tup_del FROM pg_stat_user_tables WHERE relname='<table>';
    SELECT max(<created_or_submitted_at>) FROM <table>;
    ```

    **Split the invariant — "byte-identical" applies to _shape_, never to _rows_ (corrected 2026-08-02).**
    - **Strict equality (any diff ⇒ stop and investigate):** `relrowsecurity`, `relforcerowsecurity`,
      `relowner`, the full `pg_policy` row set, the `role_table_grants` set, the `pg_indexes` list, and
      `to_regclass(...) IS NOT NULL`. The flip runs no DDL, so a diff here means something ran DDL that
      should not have. This is a **DROP/DDL tripwire** and that is all it is.
    - **NOT equality — monotonicity:** the row count. An earlier draft demanded "`SELECT count(*)` … must
      be identical before and after"; in production that is **guaranteed to be violated**, because the
      flip's entire premise is that C# is already the live sole writer.
      `apps/web/lib/platform-api/engagement.ts:511-522` (`useEngagementSubmitSurveyResponse`) POSTs to
      `/engagement/surveys/{surveyId}/responses` unconditionally, driven by
      `apps/web/app/(admin)/dashboard/survey-take-modal.tsx:41` — every employee submission inserts a
      `survey_responses` row while the before/after window is open. Following the old rule produces either
      a **false rollback of a correct flip**, or an operator trained to ignore the one check that would
      catch a real DROP. Assert instead: `count_after >= count_before`, the timestamp column advancing, and
      `pg_stat_user_tables.n_tup_del` **not** jumping. `count(*)` is also a full sequential scan — at real
      `survey_responses` volume it is the wrong probe to run twice against prod; prefer
      `pg_relation_size > 0` plus the `n_tup_del` delta.

7.  **The C# writer still works.** `scripts/parity/cli.ts verify-write <surface>` against the live
    surface. The flip does not change the write path, so this is a regression check, not a new proof.

8.  **Clean-checkout bootstrap still produces the table (§0 P8).** On a **scratch** DB, from a clean
    checkout of the flip branch, run the documented bootstrap — `pnpm db:push` (which now routes through
    `scripts/db/guard-prod-ddl.sh`) followed by the table's extracted DDL:

    ```bash
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/Tims.Platform/db/flip-ddl/<name>.sql
    ```

    Generate that file with `node scripts/db/extract-table-ddl.mjs` if it does not exist yet (#128 — it is
    already committed for #64's and #66's tables). Then assert:

    ```sql
    SELECT to_regclass('public.<table>') IS NOT NULL;   -- must be true
    ```

    and confirm `packages/db/prisma/seed-demo.ts` and `scripts/parity/seed.ts` still run green against it.
    Deleting the Prisma model can remove the repo's **only** DDL definition of the table; this step is the
    check that it did not.

9.  **EF write-value compatibility against the live column types (§0 P10).** For the flipped table, diff
    the EF property mappings against `information_schema.columns` on prod:

    ```sql
    SELECT column_name, data_type, datetime_precision, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='<table>' ORDER BY ordinal_position;
    ```

    Every EF property must pin a matching `HasColumnType(...)` or be `ValueGeneratedOnAdd`. This is what
    makes §6's "same column shape" claim true — the absence of an EF migration does not.

---

## 6. Rollback

> **Status: VERIFIED for an option-(c) flip, 2026-08-03.** `git revert` of flip #1 was **executed** on
> the branch (not simulated), and the reverted tree was put through the full gate: ledger check,
> `prisma validate` + `generate` (the back-relations return with no `P1012`), the `accessReview` delegate
> reappearing in the generated client, both `tsc` jobs, 2636 tests, and `/gate` check 16. Transcript in
> **§7 → "Rollback — TESTED"**. §8 Q0 is closed.
>
> **The scope of that verification, stated precisely:** it proves pure `git revert` is a _complete_
> rollback when **no DDL ever moved** — which is what §4 option (c) guarantees and what check 16 proved
> held. It does **not** verify rollback after a DDL change to a flipped table; that case is still
> unobserved, and per the point-of-no-return below it is not a `git revert` at all but a
> restore-from-backup. Everything in this section past that line remains reasoning, not transcript.

### What a revert does and does not cover

`git revert` restores **the repository**. It does not restore **production**, and it addresses exactly
one failure class. P1 requires zero TS writers _before_ the flip PR opens (for `surveys`, §7 records the
writers were deleted 2026-07-29, weeks earlier), so at flip time no TS write path exists to restore — a
revert restores **reads only**.

| Failure class                                           | Does `git revert` help?                          | Actual response                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Flip broke the TS build / a TS read path                | **Yes** — this is the only class it is for       | Revert, redeploy, verify (below)                                                                                        |
| C# writer producing wrong data                          | **No** — there is no TS writer to route back to  | Fix forward in C#, or restore-from-backup for the corrupted rows                                                        |
| C# service unavailable                                  | **No** — the read path is C#-only post-flip      | Standard service rollback (`PROD-DEPLOY-RUNBOOK-gate-g3.md:239-241`); **do not** use `cutover.sh --rollback`, see below |
| Divergence discovered post-flip                         | Partially — restores TS **readers**, not writers | Re-canary is not available; treat as fix-forward with a parity re-verify                                                |
| Someone ran `db push`/`migrate dev`/`migrate diff` (§2) | **No**                                           | Restore-from-backup — and see the BC-DR caveat below                                                                    |

`phase-5-strangler.md:36-37`'s "**Rewind beats forward-fix** — if canary diverges, route back to TS, fix,
re-canary" is a real guarantee for steps 1-5 and **expires at step 6**. Steps 4-5 are the last point at
which it holds. A reader arriving here mid-incident will otherwise over-estimate what the revert buys.

### When to roll back

A rollback procedure with no decision rule is not exercisable under pressure. This flip's highest-risk
reader degrades **with no error signal** (§7: the alert cron's `active_surveys` metric returns `null`
silently — it does not throw, is not counted `skipped`, and is not logged), on a daily 06:00 cron. So:

- **Decision owner:** Federico (the only person who can merge, deploy and read prod). Named, not implied.
- **Watch window:** must span **at least one full 06:00 cron cycle** after the deploy, i.e. the flip is
  not "done" until the morning after.
- **Trigger conditions — any one of these ⇒ revert:**
  - `tsc` or any CI job red on `main` after the merge;
  - any of the four `getExecutiveKpis` dashboards erroring or rendering empty;
  - `scripts/parity/cli.ts verify` failing on the affected surface;
  - the `alert_rules` post-check in §7 showing a rule that can no longer fire;
  - the §5 step 6 **shape** query diffing (that is a DROP, not a degradation — revert _and_ escalate).
- **Maximum time to decision:** 60 minutes from trigger. **Revert is the default** if the decision has
  not been made by then; forward-fix must be an affirmative choice with a stated ETA.

### The precondition — and the fact that it is not directly detectable

**Precondition:** nobody ran `pnpm db:push` / `npx prisma db push` / `pnpm db:migrate`, or applied a
`migrate diff`-generated script, against a live database in the interval (§2).

**This precondition cannot be checked directly**, by this runbook's own admission: §8 Q4 records that
"`db push` leaves no trace either." So make it **positively detectable** instead — immediately pre-flip,
snapshot `pg_class.relfilenode`, the `pg_indexes` list and the row count, and re-read them at rollback
time. A `db push` table rebuild changes `relfilenode`; that turns an assumed-absent event into an observed
one.

**And do not present restore-from-backup as a solved fallback.** It is not:
`docs/architecture/compliance/00-compliance-by-design-roadmap.md:36` marks Availability / BC-DR as a
**Gap** — "Supabase PITR; add restore _tests_ + DR runbook" — and `:72` (CB-7) asks for "Automated backup
**restore tests** (prove RTO/RPO, not just PITR)." No backup or PITR reference exists anywhere else in
`docs/architecture/csharp-migration/`. **Before the flip PR merges, confirm PITR retention covers the
entire watch window**, and record the confirmation in the ledger note.

### Do NOT run `cutover.sh --rollback` on a flipped or TS-deleted domain

An earlier draft described `scripts/deploy/README-cutover.md:25`'s `--rollback` as merely insufficient
("only flips a backend flag"). That understates it — **for a flipped or TS-deleted domain it is an outage
button.** For engagement the FE flags are already dead and the wrapper calls C# **unconditionally**
(`apps/web/lib/platform-api/engagement.ts:11-13`), while the C# endpoints are mapped **only when the
`Platform:*Enabled` flag is on** (`EngagementWriteEndpoints.cs:38`, `EngagementReadEndpoints.cs:28`). So
`cutover.sh <domain> --rollback --yes` unmaps the endpoints the frontend is unconditionally calling. That
script is exactly what muscle memory reaches for in an incident, and this is the document that has to
forbid it. A guard in `cutover.sh` (refuse `--rollback` for surfaces whose status is TS_DELETED or
flipped, and surface that status in `--list`) is on the side-quest list.

### Also not reversible by revert

- Data written by C# after the flip is fine (same shape — see the note below), but any _rows deleted_ by a
  dropped table are gone.
- Any DDL change to the flipped table by any of the three §4 paths — that is the point of no return (§4).

**Where the "same column shape" guarantee actually comes from (corrected 2026-08-02).** An earlier draft
said it was "guaranteed precisely because the flip adds no EF migration." That is a non-sequitur: the
absence of a migration guarantees no **DDL** change, and says nothing about the **values EF writes**.
Write-value compatibility comes from hand-written per-context mappings, and those are inconsistent across
the repo with no check enforcing them — `EngagementWriteDbContext.cs:41-47,56` pins nine
`HasColumnType("timestamp")` and explains why at `:9-11`, while `AccessReviewDbContext.cs:52-55,76-80`
pins zero and is safe only because its datetime columns are `HasDefaultValueSql("now()").ValueGeneratedOnAdd()`
(`:117`, `:124`). 8 of 28 strangler `DbContext`s carry no pins at all. §0 P10 / §5 step 9 is the check
that makes this claim true; it is not free.

### Rollback steps, concretely

Local checks alone are **not** a rollback — a flip PR deletes tRPC procedures in `packages/api` and
repoints readers in `apps/web`, both of which are **deployed to Vercel**, and push-to-`main` has more than
once failed to auto-deploy in this project.

```bash
# 1. Repository
git revert <flip-commit-sha>          # restores schema + ledger + readers together
cd packages/db && npx prisma generate --schema=prisma/schema
pnpm --filter @tims/api exec tsc --noEmit && (cd apps/web && npx tsc --noEmit)
node scripts/table-ownership.mjs      # back to green from the other direction
npx vitest run                        # full suite, not just the governance test

# 2. Production — the repository is not the product
gh pr create --fill && gh pr merge --squash        # merge the revert
vercel --prod                                      # trigger the deploy EXPLICITLY; do not assume
vercel inspect <deployment-url> | grep -i commit   # confirm the deployed SHA is the revert
```

**Target: production restored within 30 minutes of the decision** (merge + deploy + smoke). If it cannot
be met, the rollback is not a real safety valve and the flip should not have shipped.

**3. Verify functionally — not with the shape query.** Re-running §5 step 6 and confirming the DB is
"still byte-identical" is **tautological**: by this runbook's own argument the flip ships zero DDL, so that
output is invariant under the flip _and_ under the revert. It cannot distinguish a successful rollback from
a failed one. Keep it, but label it honestly — **it is a DROP-TABLE tripwire, not rollback verification.**

The real post-rollback verification is the §7 functional set:

- both `tsc` jobs and the full `npx vitest run` green on the reverted `main`;
- `scripts/parity/cli.ts verify` passing on the affected surface;
- the four `getExecutiveKpis` dashboards smoke-tested in a browser;
- one **full** 06:00 alert-cron cycle observed, verified the §7 way (query `alert_rules` for
  `condition->>'metric' = '<metric>'` and confirm each rule still fires or the set is empty) — **not** by
  comparing "the same numbers," which the cron does not emit.

---

## 7. Worked example — **EXECUTED**: `access_reviews` (#63, #65)

> **Status: TRANSCRIPT. Flip #1 was executed 2026-08-03.** This is what actually happened, not a
> procedure. #63's "worked example executed end-to-end" and "rollback tested, not just written"
> acceptance criteria are satisfied by this section. The `surveys`/`survey_responses` material that
> used to occupy §7 is preserved below as **§7b** — it is the intended _second_ flip and is still
> blocked.

### What was flipped, and why this table

`access_reviews`: `efcoreStranglerWrite[]` → `efcore[]`. Sole owner is now `AccessReviewDbContext`
(`services/Tims.Platform/src/Tims.Infrastructure/AccessReview/AccessReviewDbContext.cs:112`).

The pilot choice held up under investigation. Grep-verified couplings to unwind — **all zero**:

| Coupling category (§1 step 6 lists five)            | Count |
| --------------------------------------------------- | ----- |
| Prisma delegate use (`db.accessReview.*`)           | **0** |
| `Prisma.AccessReview*` generated types              | **0** |
| access-registry (`entity-policies`, `scoped-probe`) | **0** |
| `packages/db/src` enum re-exports                   | **0** |
| `vi.mock('@tims/db')` delegate mocks                | **0** |

So flip #1 repointed **no readers at all** — the cleanest possible first execution. The whole TS
access-review layer (router + `.schemas` + service + repository) had already been deleted 2026-07-31,
after both `Platform:AccessReviewReadEnabled` and `...WriteEnabled` were confirmed live in prod and
parity-verified (12/12 reads, 3/3 writes). The surviving `apps/web` hits are i18n keys
(`t.accessReview.*`) and the C#-backed hooks in `lib/platform-api/access-review.ts`; neither touches
the database.

### The edits — four files, code only

1. `packages/db/prisma/schema/system.prisma` — deleted `model AccessReview` (was `:47-67`), replaced
   with a comment recording where the table went, that it still exists in prod, and **not to re-add it**.
2. `packages/db/prisma/schema/user.prisma:31` — deleted `User.accessReviews`.
3. `packages/db/prisma/schema/organization.prisma:49` — deleted `Organization.accessReviews`.
   Both back-relations are hard `P1012` failures if left; the ownership check does **not** catch them
   (it only greps `@@map`).
4. `docs/architecture/table-ownership.md` — moved the name between lists (copied, not retyped) and added
   the flip note.

**One PR, and it is forced rather than chosen.** Verified by reading `scripts/table-ownership.mjs`, per
#63's AC: `efcore[] ∩ prismaSet` is a `cross-owner collision` (`:113-117`) **and**
`efcoreStranglerWrite[]` requires the table _be_ in `prismaSet`. Either half alone is a red build, so no
two-PR sequence exists that stays green.

### DDL home — §4 option (c), as predicted

**No production DDL ran.** The table in prod is byte-identical before and after, and that is now
_assertable_ rather than asserted: `/gate` **check 16** (#115) diffs the live schema against the
committed baseline and stayed green throughout. EF holds no migration and no snapshot for
`access_reviews`, and none was created — `AccessReviewDbContext` maps 7 tables of which 6 remain
Prisma-owned, so a migration on it would try to `CreateTable` all seven.

**§0 P10 counter-caveat — RESOLVED, was safe.** The caveat warned that `AccessReviewDbContext` pins zero
`HasColumnType`, and that this was only _believed_ safe. Verified against the baseline:

```
prod:  reviewed_at  timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
       created_at   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
       notes        character varying(2000)
EF:    ReviewedAt / CreatedAt → HasDefaultValueSql("now()").ValueGeneratedOnAdd()
       Notes      → HasMaxLength(2000)
```

Safe for the reason hoped: both datetimes are `ValueGeneratedOnAdd`, so EF **never sends a value** and
the DB default fills them; Npgsql reads `timestamp without time zone` into `DateTime` correctly, and
`HasMaxLength(2000)` matches. Note EF declares the default as `now()` where prod says
`CURRENT_TIMESTAMP` — semantically identical in Postgres, and inert here because EF emits no DDL. It is
also a concrete illustration of why option (c) matters: were EF ever to scaffold a migration for this
table, that cosmetic mismatch is one of the things it would try to `ALTER`.

### Verification actually run

| Check                                                      | Result                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| §5 step 0 — `/gate` check 16 (schema drift)                | ✅ clean, before and after — proves no DDL moved                |
| §5 step 1 — `node scripts/table-ownership.mjs`             | ✅ `table-ownership check passed.`                              |
| §5 step 1 — `tests/governance/table-ownership.test.ts`     | ✅ 16 tests                                                     |
| §5 step 2 — `prisma validate` + `generate`                 | ✅ no `P1012`                                                   |
| §5 step 3 — `tsc` api + web                                | ✅ both clean — no surviving Prisma reader                      |
| §5 step 4 — `npx vitest run`                               | ✅ 2636 tests / 283 files                                       |
| §5 step 5 — every `efcore[]` entry has a real EF `ToTable` | ✅ all 7 confirmed                                              |
| Generated client no longer exposes the delegate            | ✅ `get accessReview` 0 occurrences (`get auditLog` 1, control) |

### Rollback — TESTED, not just written (#63 AC)

`git revert` of the flip commit was **executed** on the branch, verified, and then unwound:

| After `git revert`                     | Result                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| Files restored                         | ✅ all 4, cleanly — no conflicts                            |
| `table-ownership.mjs`                  | ✅ passed (back to `efcoreStranglerWrite[]`, model present) |
| `prisma validate` + `generate`         | ✅ clean — the back-relations return without `P1012`        |
| `get accessReview` in generated client | ✅ back to 1                                                |
| `tsc` api + web                        | ✅ both clean                                               |
| `npx vitest run`                       | ✅ 2636 / 283                                               |
| `/gate` check 16                       | ✅ still clean                                              |

**Pure `git revert` is a complete rollback for an option-(c) flip, and check 16 staying green in both
directions is the proof of why:** nothing in prod ever changed, so there is no schema for the restored
Prisma model to disagree with. This is exactly the property §4's point-of-no-return warns you lose the
moment any DDL touches a flipped table, by any path.

### Post-flip finding — the flip leaves DEAD PRIVILEGE, exactly as §3(b) predicts

Queried after the flip, `access_reviews` in prod:

```
rls_enabled      true          force_rls   true
policies         tenant_isolation           (unchanged — no DDL moved)
foreign keys     access_reviews_organization_id_fkey, access_reviews_reviewer_id_fkey
grants           app_tenant: SELECT, INSERT, UPDATE, DELETE
                 postgres:   SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
```

`app_tenant` holds **full DML on a table no TypeScript code touches**, whose only reader and writer is
`AccessReviewDbContext` on the **privileged** connection — never `TenantScope`, so never as `app_tenant`.
This is not a new exposure (RLS is FORCE'd and `tenant_isolation` still confines `app_tenant` to its own
org, and no code path assumes that role for this table) but it is unnecessary standing privilege on a
SOC-2 compliance-evidence table.

It arrived exactly the way §3(b) says: `ALTER DEFAULT PRIVILEGES` grants full DML to `app_tenant` on
every new table in `public`, so the grant was never _decided_, and a flip cannot narrow it — only an
explicit `REVOKE` can.

**The §3(f) safety check, run:** no policy anywhere in `public` references `access_reviews` in either its
`USING` or `WITH CHECK` clause (`pg_get_expr` scan over all of `pg_policy` → 0 rows). So unlike the
`calibration_*` parent/child case §3(f) warns about, a `REVOKE` here would break no subquery policy.

Not done in this PR: a `REVOKE` is production DDL, so it needs its own reviewed script, a `.ROLLBACK.sql`,
and a baseline re-capture per `ddl-governance.md`. Tracked as **#126**. **Generalise this** — expect every
flip to leave the same dead privilege, and make the `pg_policy` scan a standard post-flip step.

### What this flip does NOT prove

Being explicit, because #64 is a materially harder case and this transcript should not be over-read:

- **No reader repointing was exercised.** All five coupling categories were zero. §1 step 6 remains
  untested by execution, and it is where #64's real work sits.
- **No DDL transfer was exercised.** Option (c) was chosen precisely to avoid it; options (a) and (b)
  in §4 are still unexecuted, and §8 Q6 (does `dotnet ef migrations add` even work on a strangler
  context) is still open.
- **No cross-domain reader existed.** The `efcore`-but-still-Prisma-read state that #63 predicted the
  ledger's four categories express poorly did not arise here. It will for other tables.

---

## 7c. Flip #2 — **EXECUTED**: `critical_roles` + `successors` (#69)

> Executed 2026-08-04. Code-only, no DDL. This is a transcript, not a procedure.
> **`surveys`/`survey_responses` (§7b below) is still the next candidate and is still blocked** — flip #2
> went to succession instead, because #58 (PR #130) had already removed every TS writer there.

### Why succession, and what #69's own text got wrong

#69 was titled as though it were ready, and it was not. Both it and #58 inherited a claim from this
repo's ledger that "nothing outside `packages/api/src/routers/succession.ts` touches critical_roles/
successors — 19 hits, all in one file, zero foreign readers." That grep used
`.(successor|criticalRole).<op>`, which **requires a trailing `.<operation>`** and therefore missed the
access-registry entries entirely. The real state at the start of this flip, via
`\b(db|tenantDb|prisma|tx)\.(successor|criticalRole)\b`, was **two readers and zero writers**:

| Reader                                       | Disposition                                       |
| -------------------------------------------- | ------------------------------------------------- |
| `access/scoped-probe.ts:55-56` (`DELEGATES`) | **Removed** — a by-id probe needs a live delegate |
| `prisma/seed-demo.ts:913-945`                | **Ported to raw SQL** (`$queryRaw`/`$executeRaw`) |

Also verified zero, and worth running as a checklist: `Prisma.CriticalRole*`/`Prisma.Successor*`
generated types, `packages/db/src` re-exports, `vi.mock('@tims/db')` delegate lists,
`select-for.ts`/`classification.ts` `Record<string,…>` entries. `scripts/parity/seed.ts` writes both
tables but via raw `pg`, so it survived mechanically.

### The mistake this flip made, and the correction it produced

Following §1 step 6 literally — "clean the access-registry triple" — **broke 6 tests and would have
caused a silent cross-stack regression.** See the correction now inlined at §1 step 6. Short version:
`scopeWhereFor` is pure, its fixtures are a cross-stack contract that pins the **C#** implementation, and
only `DELEGATES` needs the Prisma model. The fix was to keep both entities in `ScopedEntity` and make the
distinction compile-enforced via `ProbeableEntity`.

The 6 failures came from `contracts/access-fixtures/scope-where.json` — invisible to `tsc` and to all
five P2 greps, which are `.ts`-scoped. That is why P2 now has a **sixth** strategy for `*.json`.

### DDL home + P8

§4 option (c), same as flip #1: both tables stay on the hand-applied SQL path, EF holds no migration and
no snapshot. **Unlike flip #1, P8 was live here** — neither table had a `CREATE TABLE` anywhere in
`packages/db/prisma/{migrations,manual}` or `services/Tims.Platform/db/`; the only definitions were C#
test fixtures. `services/Tims.Platform/db/flip-ddl/succession.sql` was generated from the committed
baseline (#128) **before** the models were deleted. This is the first flip to actually need that tool.

### Verification actually run

`/gate` check 16 exit 0 before the change, on the change, and on the tested revert (proving no DDL moved)
· ledger check passed · `prisma validate` + `generate` clean, both delegates confirmed absent from the
generated client · api/web tsc clean · vitest 284 files / 2664 tests green · ghost `efcore[]` entries `[]`
and both names resolve to real EF `ToTable`s · P10: both datetime columns pin
`HasColumnType("timestamp")` against prod's `timestamp(3) without time zone`.

Live prod shape captured (§5 step 6): RLS enabled **and forced** on both, owner `postgres`, exactly one
**fail-closed** `tenant_isolation` policy each (no `org_isolation`/`allow_all` residue from #111), 10
indexes across the pair, `app_tenant` = `SELECT,INSERT,UPDATE,DELETE`.

### Rollback — TESTED

Real `git revert` of the flip commit, then the full set on the reverted tree: ledger check passed,
`prisma validate` clean (**the three `user.prisma` back-relations return with no P1012**), both delegates
reappear in the regenerated client, api tsc clean, 2664 tests green, check 16 exit 0. Then unwound with a
second revert and the client regenerated. Pure revert is complete **because no DDL moved**.

### Post-flip findings

- **#126 confirmed again, and a REVOKE is safe.** `app_tenant` retains blanket
  `SELECT,INSERT,UPDATE,DELETE` on both tables — dead DML, exactly as §3(b) predicts. The §3(f)
  pre-REVOKE scan returned **0 policies** referencing either table.
- **The flipped pair is dependency-isolated.** Zero views, zero matviews, zero functions reference
  either table, and the only inbound FK is `successors.critical_role_id → critical_roles` — internal to
  the pair, so both sides moved together. Worth adding to the standard pre-flip scan: a view or a
  `plpgsql` function over a flipped table is a raw-SQL reader invisible to `tsc`, to the ownership check
  and to every P2 grep.

### What flip #2 adds over flip #1

Flip #1 proved the mechanics with **no** reader repointing and **no** P8. Flip #2 is the first to
repoint real readers, the first to need the extracted-DDL tool, and the first to hit a **cross-stack
contract** — which is the finding worth carrying: a flipped table's _scope policy_ outlives its Prisma
model, because the C# owner is held to the same fixtures. §8 **Q6** (EF design-time factory) is still
open and still untouched; both flips deliberately avoided it.

---

## 7d. Flip #3 — **EXECUTED**: `calibration_sessions` + `calibration_members` + `calibration_votes` (#70)

> Executed 2026-08-06 on `feat/flip-calibration-ownership`, off `main` `efb7553f`. Code-only, no DDL.
> This is a transcript, not a procedure. **Read the "not verified here" list at the end before treating
> it as a completed flip** — four of §5's steps need a live database and did not run.

### Why calibration, and what was different about it

#57 (PR #144, merged minutes before this flip started) deleted `packages/api/src/routers/ninebox.ts`
outright, taking `submitCalibrationVote` and `finalizeCalibration` — the last two TS writers — with it.
That is the merge that unblocked #70, and it is the same shape as flip #2: the flip becomes possible the
moment a _separate_ TS-deletion PR lands, not because anything in the flip itself removes a writer.

Re-grepped at flip time rather than trusted from the issue (§0 preamble), and **all zero**:

| Coupling category                                         | Count                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Prisma delegate use (`.calibrationSession\|Member\|Vote`) | **0** (only the governance test's own quoted patterns) |
| `Prisma.Calibration*` generated types                     | **0**                                                  |
| access registry (`entity-policies` / `scoped-probe`)      | **0**                                                  |
| `contracts/access-fixtures/scope-where.json`              | **0**                                                  |
| `packages/db/src` enum re-exports                         | **0**                                                  |
| `vi.mock('@tims/db')` delegate mocks                      | **0**                                                  |
| `packages/db/prisma/seed-demo.ts`                         | **0**                                                  |

**The single biggest difference from flip #2: calibration was never a `ScopedEntity`.** There is no
`calibration` anywhere in `packages/api/src/access/` or `contracts/access-fixtures/`, so the
`FlippedEntity` / `ProbeableEntity` / `DELEGATES` / `scope-where.json` machinery that dominated §7c
**did not apply at all** and was deliberately not touched. A flip is not automatically the previous
flip; re-derive the coupling table rather than porting it.

`scripts/parity/seed.ts` and `scripts/parity/write-surfaces.ts` write and read all three tables, but via
raw `pg` SQL, so they survive model deletion mechanically — the same disposition §7c gave them.
`seed-demo.ts` needed **no** port because it never referenced calibration (contrast §7c, where it did):
§8 **Q9's post-flip seed hazard simply does not arise for this domain.**

### The non-standard tenancy, which is the real hazard here

`calibration_members` and `calibration_votes` have **no `organization_id` column**. Their live
`tenant_isolation` policy is a parent subquery over `calibration_sessions` on **both** `USING` and
`WITH CHECK` (baseline `packages/db/baseline/prod-public-schema.sql:7480-7499`), and the C# write
entities deliberately carry no `OrganizationId`. **That `WITH CHECK` on the session linkage IS the
tenant guard.** Normalising these tables — adding `organization_id` to "fix" the asymmetry — would
silently replace a working guard with an unenforced column. It was not done.

This is the case §0 P9 and §3(e) were written for, and this flip is the one that makes them live:
two `efcore[]` tables now exist that `EnableTenantRls()` **structurally cannot serve**. The ledger's
standing rule (`table-ownership.md` "The rule") has been amended with an explicit carve-out in this PR —
side-quest 6, closed for the ledger half. **Still open:** the same carve-out in `TenantRls.cs:10-13`'s
docstring, which still claims "the emitted block matches the live Prisma policy". Not done here because
this flip deliberately touched no C# file.

### GRANTs — deliberately untouched, and why that is not laziness

§8 **Q7 stays OPEN.** `app_tenant` keeps `SELECT,INSERT,UPDATE,DELETE` on all three tables. Revoking is
**not** the safe default here, for two independent reasons:

1. **The discriminator for `app_tenant` DML is RLS, not ownership.** The C# strangler writes _as_
   `app_tenant` (`TenantScope.cs` → `SET LOCAL ROLE app_tenant`), so revoking DML on an RLS-protected
   EF-owned table breaks production writes. That mistake was made once already (#126).
2. **§3(f) applies literally and by name here.** `calibration_sessions` is _referenced by_ the subquery
   policies on `calibration_members` and `calibration_votes`, and Postgres evaluates a policy expression
   **as the querying role**. Revoking `app_tenant`'s `SELECT` on the parent breaks the children's
   policies — the exact scenario §3(f) uses this table trio to illustrate.

So the standing post-flip "expect dead privilege, consider a REVOKE" advice from §7/§7c **does not
generalise to this trio**, and the ledger note says so.

### DDL home + P8

§4 option (c), same as flips #1 and #2: all three stay on the hand-applied SQL path; EF holds no
migration and no snapshot. **P8 was live**, as it was for flip #2:
`grep -rniE 'create table[^;]*calibration_' packages/db/prisma/migrations/ packages/db/prisma/manual/ services/Tims.Platform/db/`
returned **nothing** — the only `CREATE TABLE`s were C# integration-test fixtures
(`NineBoxReadFixture.cs`, `NineBoxWriteFixture.cs`), which no bootstrap path applies. So
`services/Tims.Platform/db/flip-ddl/calibration.sql` was generated from the committed baseline
**before** the models were deleted, and appears before them in the diff.

**P10 (EF write-value compatibility), read from source:** `NineBoxWriteDbContext.cs:39-43,54` pins
`HasColumnType("timestamp")` on `scheduled_at`, `completed_at`, `created_at`, `updated_at` and members'
`created_at`, against prod's `timestamp(3) without time zone`. `calibration_votes` has **no EF write
mapping at all** — `NineBoxWriteRepository.cs:187` upserts it with a parameterised raw
`INSERT … ON CONFLICT`, binding `ToTimestamp()` (`:382-386`), which returns
`DateTimeKind.Unspecified` truncated to whole milliseconds, so Npgsql sends `timestamp` at matching
precision. Note this means the §5-step-5 ghost check resolves `calibration_votes` through
`NineBoxReadDbContext.cs:116`, not through a write context.

### The §2 warning, verbatim, for these three tables

> **After this PR, `pnpm db:push` / `npx prisma db push` / `pnpm db:migrate` will DROP
> `calibration_sessions`, `calibration_members` and `calibration_votes`, and
> `prisma migrate diff --from-schema-datasource` will EMIT a `DROP TABLE` for each of them into every
> migration script authored against a live DB.** Do not run any of them against a database that holds
> real data — including preview and staging — and do not commit a generated migration script without
> grepping it for `DROP`/`ALTER` on a flipped table, until these tables' Prisma models are restored or
> the commands are guarded.

`pnpm db:push` / `pnpm db:migrate` route through `scripts/db/guard-prod-ddl.sh`, which refuses a
non-local host — but that guard covers neither the raw `npx prisma db push` form documented in
`CLAUDE.md:32` nor the `migrate diff --from-schema-datasource` path at all. **Side-quests 8 and 9 are
still open after three flips**: `docs/superpowers/plans/2026-07-08-company-entitlements-slice-1.md:130-137`
still prescribes the unqualified `migrate diff --from-schema-datasource` recipe with no `--exclude-tables`
and no mandatory `DROP` grep, and it now endangers **six** flipped tables instead of one.

### Verification actually run

| Check                                                  | Result                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| §5 step 1 — `node scripts/table-ownership.mjs`         | ✅ `table-ownership check passed.`                                       |
| §5 step 1 — `tests/governance/table-ownership.test.ts` | ✅                                                                       |
| §5 step 2 — `prisma validate` + `generate`             | ✅ no `P1012`; all three delegates absent from the generated client      |
| §5 step 3 — `tsc` api + web                            | ✅ both exit 0                                                           |
| §5 step 4 — `npx vitest run`                           | ✅ 291 files / 2746 tests, unchanged from `main`                         |
| §5 step 5 — ghost `efcore[]` entries                   | ✅ `[]`; all three resolve to real EF `ToTable`s                         |
| Mutation: restore one `user.prisma` back-relation      | ✅ observed `P1012` exit 1, then reverted                                |
| Mutation: drop `calibration_votes` from `efcore[]`     | ✅ observed the inverted ledger assertion go red, then reverted          |
| Mutation: hand-edit `calibration.sql`                  | ✅ observed `extract-table-ddl.test.ts` "stale or hand-edited", reverted |
| Rollback — real `git revert`                           | ✅ see below                                                             |

### Rollback — TESTED

Real `git revert` of the flip commit, then the full set on the reverted tree: `prisma validate` clean
(**all four `user.prisma` back-relations return with no `P1012`**), all three delegates reappear in the
regenerated client, ledger check passed, api + web `tsc` clean, full vitest green. Then unwound with a
second revert and the client regenerated. Pure revert is complete **because no DDL moved**.

### §5 step 8 — RUN AND PASSED on a throwaway cluster

**Correcting this section's own first draft**, which listed step 8 alongside the prod-credentialed steps
and called all four "Federico-only". Step 8 is a _clean-checkout bootstrap_: it needs a scratch database,
not production. Filing it as Federico-only would have burned a prod session on a check that never needed
one — and left the artifact that is now the repo's ONLY executable definition of three production tables
unexecuted. It was run instead (PostgreSQL 17.10, scratch cluster on TCP 55432-range, torn down after):

| Step                                         | Result                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `prisma db push` on an empty DB              | **0** `calibration_*` tables created — §0 P8 was live, confirmed empirically rather than by grep alone |
| `psql -v ON_ERROR_STOP=1 -f calibration.sql` | exit **0**                                                                                             |
| Re-apply (idempotency)                       | exit **0**, catalog state unchanged                                                                    |
| Structure                                    | all 3 tables, `relrowsecurity = true`, exactly 1 policy each                                           |
| Policy text                                  | `USING` and `WITH CHECK` match `prod-public-schema.sql:7480-7499`                                      |

A **functional** isolation probe was then run as a `NOBYPASSRLS` `app_tenant` role over two seeded orgs —
and made non-vacuous first by confirming 2 sessions and 2 members actually existed, because "0 rows
because isolation works" and "0 rows because the seed failed" are indistinguishable (the seed DID fail
twice, on `users.supabase_user_id` and `calibration_members.status`, and the first probe run passed
vacuously as a result):

| Probe                                     | Result                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| OrgA GUC set                              | sees exactly **1** session + **1** member of the 2 that exist      |
| **GUC unset**                             | **0** rows — fails closed; the #111 fail-open shape is not present |
| OrgA inserts a member into OrgB's session | **REFUSED** — `new row violates row-level security policy`         |

That last row is the direct evidence for this flip's central claim: for `calibration_members` and
`calibration_votes`, which have no `organization_id`, the session-linkage `WITH CHECK` **is** the tenant
guard. Previously that was reasoning from the policy text; now it has been observed.

> A caveat that survives: this proves the DDL reproduces prod's isolation **on a fresh database**. It says
> nothing about whether prod's live shape still matches the baseline — that is §5 step 0, below.

### NOT verified here — three §5 steps need the LIVE PRODUCTION database

This environment has no prod credentials (local Prisma has been P1000 for weeks), so these remain
Federico-only:

- **§5 step 0 / `/gate` check 16** — schema-baseline drift, before and after. Every other check compares
  the flip against an expected schema; this is the one that proves the expected schema is still real.
  Flips #1 and #2 both ran it in both directions. **This flip did not.**
- **§5 step 5b — `pre-flip-scan.ts`.** The important gap: **views, matviews and functions** referencing
  the three tables are raw-SQL readers that survive model deletion and are invisible to `tsc`, to the
  ownership check and to every P2 grep. Flip #2 found zero; that is not evidence about these tables.
  > **Since #132 this step is `/gate` check 18** (`npx tsx scripts/db/pre-flip-scan.ts --flip-diff`), and
  > the note above understates what running it would have to show. The hand-run version of these queries
  > returned empty for the calibration tables, but the view/matview arm searched a `public` schema
  > containing **zero** views — a correct answer that no control had established. The script now reports
  > every arm's population, proves each text matcher against a row it must match, and exits **2** rather
  > than 0 when it cannot. Re-running it for these three tables is therefore still outstanding, and a
  > result that says an arm was NOT EXERCISED must be recorded as such, not as "clean".
- **§5 step 6 — the live before/after shape diff** (RLS flags, policy set, grants, indexes, `n_tup_del`).
  The DROP-TABLE tripwire.
  Run all three before merging. Steps 0 and 5b are the two that could still turn up a blocker.

**Also not covered, and not fixable by any of the above:** §6 prescribes a pre-flip
`pg_class.relfilenode` / `pg_indexes` / row-count snapshot as the only way to _detect_ that a table was
rebuilt under the §2 `db push` hazard during the watch window. No such snapshot was taken for these three
tables, so this flip's "pure `git revert` is complete" claim rests on the premise that no DDL runs against
them before the revert — a premise that is currently **assumed, not detectable**. Take the snapshot if the
branch sits unmerged for any length of time.

### What flip #3 adds over flips #1 and #2

- The first flip whose tables' **RLS is a parent subquery**, which is what turns §3(e)/§3(f) and §0 P9
  from warnings into the ledger's carve-out and the Q7 decision recorded above.
- The first flip where a **test that pinned the pre-flip era had to be inverted** rather than left alone:
  `tests/governance/calibration-no-ts-writers.test.ts`'s last case asserted the tables were _still_
  `efcoreStranglerWrite`. Inverted, not deleted — post-flip it is the thing that catches a Prisma model
  being quietly re-added, which nothing else does on its own. **Generalise this:** every flip should
  expect to find at least one test written as "not yet" and should invert it, because deleting it
  removes a guard exactly when the guard starts being useful.
- The first flip to run with **none of §5's live-DB steps**, which is a gap, not a simplification.

---

## 7e. Flip #4 — **EXECUTED**: `review_cycles` + `rater_assignments` + `rater_responses` (#67)

> Executed 2026-08-06 on `feat/flip-evaluation360-ownership`, branched off `chore/delete-orphaned-evaluation360-ts`
> (#54, head `14a642d6`, **unmerged** — three commits ahead of `origin/main` `ff735f3f`). Code-only, no DDL.
> This is a transcript, not a procedure. **Read the "not verified here" list at the end before treating
> it as a completed flip** — three of §5's steps need a live database and did not run.

### Why this one, and the one precondition that was NOT met by `main`

Same shape as flips #2 and #3: the flip becomes possible the moment a _separate_ TS-deletion lands.
Here that deletion is **#54, and it is not on `main` yet** — this branch is stacked on it. Branching
from `origin/main` instead would have made the flip's precondition simply false, because
`packages/api/src/repositories/evaluation360.repository.ts` held **every** TS Prisma writer of the
three tables (`reviewCycle.create`, three guarded `reviewCycle.updateMany`, `raterAssignment.createMany`,
`raterAssignment.updateMany`, `raterResponse.createMany`). Verified before starting:
`git log --oneline origin/main..HEAD` shows the three #54 commits.

Re-grepped at flip time rather than trusted from the issue (§0 preamble), and **all zero**:

| Coupling category                                                    | Count                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Prisma delegate use (`.reviewCycle\|raterAssignment\|raterResponse`) | **0** (only the governance test's own quoted patterns) |
| `Prisma.ReviewCycle*` / `RaterAssignment*` / `RaterResponse*` types  | **0**                                                  |
| access registry (`packages/api/src/access/`)                         | **0**                                                  |
| `contracts/access-fixtures/`                                         | **0**                                                  |
| `vi.mock('@tims/db')` delegate mocks                                 | **0**                                                  |
| `packages/db/prisma/seed.ts` / `seed-users.ts` / `seed-demo.ts`      | **0**                                                  |

**evaluation360 was never a `ScopedEntity`** — same as calibration (§7d), unlike succession (§7c). The
`FlippedEntity` / `ProbeableEntity` / `DELEGATES` / `scope-where.json` machinery **did not apply and was
not touched**. `tests/evaluation360/evaluation360-router-self-service.test.ts:81` asserts
`raterAssignment` is _deliberately_ not registered, because identity-anchoring
(`raterUserId`/`subjectUserId === ctx.user.id`) is its only guard by design. That test passes unchanged.

`scripts/parity/seed.ts` and `scripts/parity/write-surfaces.ts` write and read all three tables via raw
`pg` SQL, so they survive model deletion mechanically — same disposition as §7c and §7d.

### The enums were KEPT, and that is the decision this flip adds

`evaluation360.prisma` is now an **enums-only** schema file: `ReviewCycleStatus`, `RaterRelationship`
and `RaterAssignmentStatus` stay, the three models are gone. Reasons, recorded in the file itself and in
the ledger note: `packages/db/src/index.ts:16-18` re-exports all three from `@tims/db`;
`scripts/parity/seed.ts:799,817,1388` casts to the Postgres types by name; and keeping them narrows the
§2 hazard (`migrate diff` emits `DROP TABLE` but no `DROP TYPE`).

The **cost is real and is stated rather than discovered later**: `prisma db push` still creates those
three types on a fresh database, i.e. Prisma still emits a little DDL for an EF-owned domain. Measured
on the scratch cluster — after `db push`, all three `CREATE TYPE`s had run and **zero** of the three
tables existed. Both orders are safe because `evaluation360.sql` guards every `CREATE TYPE` on `pg_type`;
both were exercised. Changing an enum **value** is a genuine schema change to an EF-owned domain and must
go through `ddl-governance.md`.

### §0 P8 was **NOT live** — the first flip since #1 where that is true

`grep -rniE 'create table[^;]*(review_cycles|rater_assignments|rater_responses)' packages/db/prisma/migrations/ packages/db/prisma/manual/ services/Tims.Platform/db/`
returns **`packages/db/prisma/migrations/20260713150000_add_evaluation360/migration.sql:8,22,36`** — a
real migration with all three `CREATE TABLE`s plus enums, indexes, FKs and RLS. That is the
`access_reviews` situation (§7), not the `calibration_*` one, and by the letter of P8 no artifact was
required.

**`services/Tims.Platform/db/flip-ddl/evaluation360.sql` was generated anyway, before the models were
deleted.** The justification is not P8-as-written but the thing P8 is _for_, and it was measured rather
than argued:

> `prisma db push` — the bootstrap step `CLAUDE.md:32` and `README.md` document — **does not apply
> `packages/db/prisma/migrations/` at all**. On an empty PostgreSQL 17.10 database from this branch it
> created **0 of the 3** tables while creating 93 others. So post-flip the migration file is an
> executable definition that nothing executes, and a freshly bootstrapped dev database has no
> evaluation360 tables from either source.

The extracted artifact is also the better of the two: read from the committed prod baseline rather than
from migration source (§0 P0/P4 — #111 proved those differ), and idempotent, atomic, GRANT-complete and
Supabase-guarded, none of which the migration is.

**Consequence for `REQUIRED_FLIP_DDL` in `tests/db/extract-table-ddl.test.ts`:** `evaluation360.sql` is
added, but the assertion's message was **corrected in the same commit**, because it claimed every listed
artifact is "the repository's ONLY executable definition … they have no CREATE TABLE in any migration".
That is true of the other four and **false of this one**. The message now distinguishes _uniqueness_
(four files) from _bootstrap reachability_ (all five). Do not let the list's premise drift back.

### Tenancy — STANDARD, unlike flip #3

All three tables **have** an `organization_id`, and their live `tenant_isolation` policy is a plain
**column predicate** on both `USING` and `WITH CHECK` (baseline `prod-public-schema.sql:7837,7843,7861`).
So §0 P9's subquery hazard, the §3(e) `EnableTenantRls()` carve-out and the §3(f) parent-policy hazard
**do not apply here** — checked, not assumed: grepped across every `CREATE POLICY` in the baseline, no
other table's policy references any of the three.

Also checked and clean: **none of the three carries the fail-open `org_isolation` policy** of §3(a)/#111.
The committed baseline (captured `2026-08-04T17:30:30Z`) contains **zero** occurrences of `org_isolation`
repo-wide, and these three have exactly one policy each. Worth flagging for whoever owns §3(a): that
paragraph still describes 67 tables carrying it, and the current baseline does not support that. Not
investigated here — it is not this flip's question, and the baseline is not the live database.

### GRANTs — deliberately untouched

§8 **Q7 stays OPEN.** `app_tenant` keeps `SELECT,INSERT,UPDATE,DELETE` on all three (baseline
`:8618,:8624,:8642`). The discriminator for `app_tenant` DML is **RLS, not ownership** — the C# strangler
writes as `app_tenant` via `TenantScope`'s `SET LOCAL ROLE`, so revoking DML on an RLS-protected EF-owned
table breaks production writes (#126). The §3(f) half of §7d's reasoning does **not** apply here (no
parent-subquery policies), but reason 1 alone is sufficient.

### DDL home

§4 option (c), same as flips #1–#3: all three stay on the hand-applied SQL path; EF holds no migration
and no snapshot, and none was created. **No DDL ran in this flip.**

**P10 (EF write-value compatibility), read from source:** `Evaluation360WriteDbContext` pins
`HasColumnType("timestamp")` on the datetime properties it maps, against prod's
`timestamp(3) without time zone`. `Evaluation360ReadDbContext` maps all three tables
(`:41`, `:55`, `:72`), so the §5-step-5 ghost check resolves all three.

### The §2 warning, verbatim, for these three tables

> **After this PR, `pnpm db:push` / `npx prisma db push` / `pnpm db:migrate` will DROP `review_cycles`,
> `rater_assignments` and `rater_responses`, and `prisma migrate diff --from-schema-datasource` will
> EMIT a `DROP TABLE` for each of them into every migration script authored against a live DB.** Do not
> run any of them against a database that holds real data — including preview and staging — and do not
> commit a generated migration script without grepping it for `DROP`/`ALTER` on a flipped table, until
> these tables' Prisma models are restored or the commands are guarded.

**Side-quests 8 and 9 are still open after four flips.**
`docs/superpowers/plans/2026-07-08-company-entitlements-slice-1.md:130-137` still prescribes the
unqualified `migrate diff --from-schema-datasource` recipe, and it now endangers **nine** flipped tables.

### Tests that pinned the pre-flip era — INVERTED, not deleted

Two files did, and the second was **not** named in this flip's brief. Finding it was the point of the
P6 sweep:

1. **`tests/governance/evaluation360-no-ts-writers.test.ts`** (the #54 tripwire). Its ledger case
   asserted `efcoreStranglerWrite`, and its schema case asserted the three Prisma models **still exist**.
   Both inverted per their own docblocks' instructions. Three further "un-flip" cases were **added**,
   because the file's original scans walk `.ts` only and are blind to step one of an un-flip: the
   generated client carrying a delegate again, a `.prisma` file re-declaring a model (scanned across
   **all** schema files, not just this domain's), and `user.prisma` re-declaring a deleted back-relation.
2. **`tests/db/evaluation360-schema.test.ts`** — six cases asserting the three models' shape against
   `Prisma.dmmf`. Every one became false. Inverted rather than deleted: the model cases now assert
   **absence** from the generated client, and the column/constraint/RLS guarantees they encoded are
   re-pointed at `flip-ddl/evaluation360.sql`, which is a strictly better oracle (the model described
   what Prisma intended; the artifact describes what production has). The enum case survives unchanged
   and is now the guard on the keep-the-enums decision.

**Generalising §7d's lesson:** it said "every flip should expect to find at least one test written as
'not yet'". Make that **at least one, found by sweep**. This flip's brief named one file; the sweep
found two, and the unnamed one carried six failing assertions.

### Verification actually run

| Check                                                          | Result                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 step 1 — `node scripts/table-ownership.mjs`                 | ✅ `table-ownership check passed.`                                                                                                                                                                                  |
| §5 step 1 — `tests/governance/table-ownership.test.ts`         | ✅                                                                                                                                                                                                                  |
| §5 step 2 — `prisma validate` + `generate`                     | ✅ no `P1012`; all three delegates absent from the generated client, all three enums present                                                                                                                        |
| §5 step 3 — `tsc` api + web                                    | ✅ both exit 0                                                                                                                                                                                                      |
| §5 step 4 — `npx vitest run`                                   | ✅ 290 files / **2728** tests, exit 0. Measured baseline on this branch BEFORE the flip: 2723 / 290 — so **+5 net**, all from the inverted/added assertions. `/gate` check 3's anchor bumped to the measured value. |
| §5 step 5 — ghost `efcore[]` entries                           | ✅ `[]`; all three resolve to real EF `ToTable`s                                                                                                                                                                    |
| Mutation: restore `raterAssignmentsAsRater` in user.prisma     | ✅ observed `P1012` exit 1 at `user.prisma:129`, then reverted                                                                                                                                                      |
| Mutation: drop `review_cycles` from `efcore[]`                 | ✅ observed the inverted ledger assertion go red, then reverted                                                                                                                                                     |
| Mutation: re-add `model RaterResponse` to **ninebox**.prisma   | ✅ observed the new re-declaration case go red (proving the scan is repo-wide, not domain-scoped) **and** `table-ownership.mjs` report a cross-owner collision; reverted                                            |
| Mutation: restore `reviewCyclesCreated` in user.prisma         | ✅ observed the new back-relation case go red, then reverted                                                                                                                                                        |
| Mutation: delete `enum RaterAssignmentStatus`                  | ✅ observed both enum guards go red after `prisma generate`, then reverted                                                                                                                                          |
| Mutation: hand-edit `evaluation360.sql` (`comment … NOT NULL`) | ✅ observed `extract-table-ddl.test.ts` "stale or hand-edited" **and** the re-pointed nullable-`comment` assertion go red; reverted byte-identical                                                                  |
| Mutation: delete `evaluation360.sql`                           | ✅ observed `REQUIRED_FLIP_DDL` go red — deletion is no longer a green change                                                                                                                                       |
| Rollback — real `git revert`                                   | ✅ see below                                                                                                                                                                                                        |

### §5 step 8 — RUN AND PASSED on a throwaway cluster

PostgreSQL 17.10, scratch cluster on TCP 55437 (TCP not a unix socket — the scratchpad path exceeds the
103-byte socket limit), torn down afterwards.

| Step                                           | Result                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prisma db push` on an empty DB                | **0** of the three tables created, **93** other tables created (so the run was not a no-op); all three `CREATE TYPE`s DID run |
| `psql -v ON_ERROR_STOP=1 -f evaluation360.sql` | exit **0**                                                                                                                    |
| Re-apply (idempotency)                         | exit **0**, catalog state unchanged                                                                                           |
| Structure                                      | all 3 tables, `relrowsecurity = t`, `relforcerowsecurity = t`, exactly **1** policy each                                      |
| Policy text vs `prod-public-schema.sql`        | `diff` exit **0** — byte-identical to production on both `USING` and `WITH CHECK`                                             |
| Indexes vs baseline                            | **9/9** identical; plus 3/3 PKs and **8/8** FKs                                                                               |

A **functional** isolation probe was then run as a `NOBYPASSRLS` `app_tenant` role over two seeded orgs.
Non-vacuity was established **first** — 2 rows confirmed in each table as owner, and `pg_roles` confirmed
`rolbypassrls = f` — because "0 rows because isolation works" and "0 rows because the seed failed" are
indistinguishable, which is exactly how flip #3's first probe passed vacuously:

| Probe                                               | Result                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Org A GUC set                                       | sees exactly **1** cycle, **1** assignment, **1** response of the 2 that exist — and it is the right one (`Cycle A`) |
| **GUC unset**                                       | **0** rows on all three — fails closed; the #111 fail-open shape is not present                                      |
| Org A inserts a response onto Org B's assignment    | **REFUSED** — `new row violates row-level security policy`                                                           |
| Org A inserts a cycle labelled Org B (`WITH CHECK`) | **REFUSED** — same                                                                                                   |
| Org A updates Org B's cycle                         | `UPDATE 0`; Org B's row verified unchanged                                                                           |
| **Control:** Org A inserts a cycle labelled Org A   | **SUCCEEDS** (`INSERT 0 1`) — so the refusals above are the policy discriminating, not a blanket denial              |

That control row is the half flip #3's transcript did not have. Without it, a policy that denied
_everything_ would produce an identical-looking pass.

> A caveat that survives: this proves the DDL reproduces prod's isolation **on a fresh database**. It
> says nothing about whether prod's live shape still matches the baseline — that is §5 step 0, below.

### Rollback — TESTED

Real `git revert` of the flip commit `a8d29b99`, then the full set on the reverted tree:

| Check on the reverted tree         | Result                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `prisma validate`                  | ✅ clean — **all three `user.prisma` back-relations return, no `P1012`** |
| `prisma generate`                  | ✅ all three delegates reappear in the client                            |
| `node scripts/table-ownership.mjs` | ✅ passed                                                                |
| `tsc` api + web                    | ✅ both exit 0                                                           |
| `npx vitest run`                   | ✅ 290 files / **2724** tests, exit 0                                    |

2724, not 2723, is correct and worth stating: the revert targets **only** the flip commit, leaving the
preceding `evaluation360.sql` commit in place, and that commit's one extra `REQUIRED_FLIP_DDL` case is
the difference. The artifact surviving a rollback is the desired behaviour — it describes tables that
exist in production either way.

**One honest note on how that run was read.** The first full-suite run on the reverted tree came back
`3 failed | 2721 passed`: `tests/security/verify-tenant-grants-failure-paths.test.ts`,
`tests/vacancy/update-fit-requirements.test.ts` and `tests/vacancy/update-role-family.test.ts`, at
5025 ms / 5111 ms / 7345 ms — timeouts, none of them touching evaluation360. Re-run in isolation: 3
files / 10 tests, exit 0. Re-run as a full suite on the **identical commit**: 290 / 2724, exit 0. That
is the known concurrent-vitest contention on this machine, not a rollback defect — recorded rather than
quietly re-run until green.

The revert and its reapply were then collapsed (`git reset --hard` back to the flip commit) after
confirming the reapplied tree hash was **byte-identical** to the flip commit's
(`648ec6a4…` both sides), so the branch carries no cancelling no-op commits. Pure revert is complete
**because no DDL moved**.

### NOT verified here — three §5 steps need the LIVE PRODUCTION database

This environment has no prod credentials, so these remain Federico-only and **must be run before merge**:

- **§5 step 0 / `/gate` check 16** — schema-baseline drift, before and after. Every other check compares
  the flip against an expected schema; this is the one that proves the expected schema is still real.
  Flips #1 and #2 ran it in both directions; flips #3 and #4 did not.
- **§5 step 5b — `pre-flip-scan.ts`.** The important gap: **views, matviews and functions** referencing
  the three tables are raw-SQL readers that survive model deletion and are invisible to `tsc`, to the
  ownership check and to every P2 grep. The committed baseline contains only two functions
  (`current_org_id`, `tims_append_only_guard`) and no views at all, neither referencing these tables —
  suggestive, but that is the baseline, not the live scan.
- **§5 step 6 — the live before/after shape diff** (RLS flags, policy set, grants, indexes, `n_tup_del`).
  The DROP-TABLE tripwire.

**Also not covered:** §6's pre-flip `pg_class.relfilenode` / `pg_indexes` / row-count snapshot, the only
way to _detect_ that a table was rebuilt under the §2 `db push` hazard during the watch window. None was
taken, so this flip's "pure `git revert` is complete" claim rests on the premise that no DDL runs against
these three before a revert — **assumed, not detectable**. Take the snapshot if the branch sits unmerged.

### What flip #4 adds over #1–#3

- The first flip where **§0 P8 was not live** but an artifact was generated anyway, on a _measured_
  bootstrap-reachability argument rather than the letter of the precondition — and the first to correct
  `REQUIRED_FLIP_DDL`'s premise instead of quietly widening a list whose message no longer fit.
- The first flip to **keep a domain's enums** after deleting its models, with the cost stated.
- The first whose era-pinning test was found **by sweep rather than by brief** — and the first to add a
  functional-probe **control row**, without which a deny-everything policy looks like a pass.

---

## 7b. The second flip — `surveys` + `survey_responses` (#64), still BLOCKED

> Retained from the pre-execution draft. This is analysis for a _future_ flip, not a transcript.
> **Numbering note:** written when `surveys` was expected to be flip #2. It was not — §7c above is the
> real flip #2. This section's "the second flip" title is kept for link stability.

### Why these two, and one correction to the issue

Both tables are org-scoped with ordinary `organization_id` columns and standard `tenant_isolation`
policies — no session-subquery RLS (unlike `calibration_*`), no cross-domain writers (unlike
`subscriptions`), no external traffic (unlike `preemployment_validations`).

**Zero TS writers — confirmed 2026-08-02.** `createSurvey`/`activateSurvey`/`submitSurveyResponse` were
deleted 2026-07-29; `EngagementWriteRepository` is the sole writer (`EngagementWriteDbContext.cs:33,52`
map `surveys`/`survey_responses`). The only write-shaped hits left are
`packages/db/prisma/seed-demo.ts:1207,1226` (seed) and a comment at
`apps/web/lib/platform-api/engagement.ts:426`.

**Correction to issue #64:** it lists `dei.ts` as a surviving reader. It is not — the DEI survey reads
were deleted in the 2026-07-31 pass; `grep -rn survey packages/api/src/{routers/dei.ts,services/dei*.ts,repositories/dei*.ts}`
returns nothing. `monitoring.ts` and the alert cron _are_ real.

### #64 IS BLOCKED TODAY — `access_reviews` is the pilot (corrected 2026-08-02)

An earlier draft said "#64 as specified is executable, it is just not small," and offered `access_reviews`
as a parenthetical recommendation. **That contradicted this runbook's own P2 precondition and is retracted.**
P2: "**Blocked** — no C# read surface exists yet ⇒ the flip does not start." Two of the readers below are
labelled **Blocker** by this very section, and monitoring "has no C# counterpart at all — no
`apps/web/lib/platform-api/monitoring.ts`, no `Platform:Monitoring*` flag" (both confirmed). There is no
CI-green path: once `model Survey` is deleted, keeping `monitoring.ts:23` fails `Type Check (api)`, and
deleting the procedure fails `Type Check (web)` at five call sites (four `useQuery` + one `.invalidate()`)
and reddens `tests/monitoring/executive-kpis-vacancy-status.test.ts`.

> **#64 is BLOCKED under P2** until (a) a C# monitoring read surface exists and (b) a **privileged
> cross-org** C# read exists for the alert cron. Both are prerequisite slices — see §8 Q0b, ranked above Q1.

**`access_reviews` is flip #1.** It has **zero** TS Prisma readers (`grep -rn accessReview packages/api/src`
→ one comment in `packages/api/src/access/access-review-kernel.ts:4`), no seed writes, one prod row, only
two back-relation lines (`user.prisma:31`, `organization.prisma:49`) — **and, unlike `surveys`, it has a
real `CREATE TABLE` migration in the repo** (`packages/db/prisma/migrations/20260717170000_add_access_reviews/migration.sql:4`),
so it does not trip §0 P8. `surveys`/`survey_responses` have no `CREATE` anywhere in
`packages/db/prisma/migrations/` and eleven production read sites including four live dashboards, an
invalidate-only cache consumer, and a cross-org cron. #64 is the better **second** flip.

_(Counter-caveat for `access_reviews`: `AccessReviewDbContext` pins **zero** `HasColumnType` — see §0 P10.
It is believed safe only because its two datetime columns are `ValueGeneratedOnAdd`. Verify, don't assume.)_

### Cross-reader inventory (must all be dispositioned before the PR)

| Site                                                                 | Read                                                                                                                          | FE consumer                                                                                                                                                                                                                        | Disposition                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/api/src/routers/engagement.ts:36`                          | `survey.findMany` (`listSurveys`)                                                                                             | **1 invalidate-only call** (`engagement/climate/launch-survey-modal.tsx:58`) **+ 1 static tripwire** (`tests/tier1/s2-engagement-wiring.test.ts:33`)                                                                               | Delete procedure — **but see edits 1b/3/4**; it is not consumer-free                           |
| `…/engagement.ts:53`                                                 | `survey.count`                                                                                                                | none                                                                                                                                                                                                                               | Delete with the same procedure                                                                 |
| `…/engagement.ts:74` + `:83`                                         | `survey.findFirst` with nested `responses: { select: { answers: true } }` (`getSurveyResults`)                                | none                                                                                                                                                                                                                               | Delete, **or** repoint — needs a C# by-id read (see below)                                     |
| `…/engagement.ts:122` + `:126`                                       | `survey.findFirst` with nested `responses: { select: { answers, user: { companyId, businessUnitId } } }` (`getResultsByArea`) | none                                                                                                                                                                                                                               | Same; **note the join into `users`** (Prisma-owned)                                            |
| `packages/api/src/routers/monitoring.ts:23`                          | `survey.count` (`getExecutiveKpis`)                                                                                           | **5**: 4 `useQuery` (`dashboard/hr-exec-dashboard.tsx:34`, `dashboard/org-command-center.tsx:28`, `monitoring/monitoring-bottom.tsx:41`, `monitoring/page.tsx:16`) **+ 1 `.invalidate()`** (`monitoring/alert-rules-modal.tsx:82`) | **Blocker** — must be repointed                                                                |
| `packages/api/src/routers/monitoring.ts:232`                         | `surveyResponse.count` (`getCrossModuleTrend`, `metric==='engagement'` branch only)                                           | reachable by any `monitoring:read` holder; the only FE caller hardcodes `metric:'headcount'`                                                                                                                                       | **Repoint, or drop the metric from the Zod enum — NEVER "just delete the branch"** (see below) |
| `packages/api/src/repositories/alert-evaluation.repository.ts:120`   | `survey.count`, metric `active_surveys`                                                                                       | cron                                                                                                                                                                                                                               | **Blocker** — privileged cross-org, see below                                                  |
| `packages/api/src/access/select-for.ts:13` · `classification.ts:120` | `surveyResponse` registry entries                                                                                             | —                                                                                                                                                                                                                                  | Hand-clean — `Record<string, …>`, will **not** fail `tsc` (§1 step 6)                          |
| `packages/db/prisma/seed-demo.ts:1202,1207,1226`                     | `survey.findFirst` / `.create` / `surveyResponse.create`                                                                      | —                                                                                                                                                                                                                                  | Port to raw SQL or drop from the demo seed                                                     |
| `scripts/parity/seed.ts:1111,1118,1127,1766,1773,1790,1896`          | raw SQL via `pg`                                                                                                              | —                                                                                                                                                                                                                                  | Survives mechanically; no change needed                                                        |

Two of these are genuinely hard:

- **`monitoring.getExecutiveKpis`** backs four live dashboards, and **monitoring has no C# counterpart at
  all** — no `apps/web/lib/platform-api/monitoring.ts`, no `Platform:Monitoring*` flag. Repointing it
  means either building a C# read (a slice of its own) or having monitoring call the engagement C# read
  surface. **This is the true gating item for #64.**
- **The alert-evaluation cron** uses the privileged `db` client, not `tenantDb`, and iterates every org
  (`alert-evaluation.repository.ts:1`, header `:5-7`; driven by `alert-evaluation.service.ts:59-71`;
  entrypoint `apps/web/app/api/cron/evaluate-alerts/route.ts:23`, daily 06:00 per `apps/web/vercel.json`).
  It cannot be served by a `TenantScope`/RLS-scoped EF read — it needs a privileged cross-org C# read
  surface, or the cron ports to C# wholesale.

  **Its failure mode is worse than "degrades with no error" (corrected 2026-08-02).** An earlier draft
  said "the service catches per-rule failures and counts them `skipped`." **The `skipped` counter never
  moves.** Removing the `case 'active_surveys'` from the switch at
  `alert-evaluation.repository.ts:119-130` does not throw — it falls to `default: return null`; then
  `alert-evaluation.service.ts:12` (`if (value === null) return false;`) and `:71`
  (`if (!evaluateCondition(...)) continue;`) skip the rule with a **plain `continue`, outside** the
  `catch` that increments `skipped` at `:84-89`. So: **no exception, no `skipped` increment, no log
  line** — the metric silently returns `null` forever and the rule can never fire again. Meanwhile
  `ALERT_METRIC_KEYS` still contains `'active_surveys'` (`packages/shared/src/constants/index.ts:112`)
  and `ALERT_METRIC_MODULE` still maps it to `'engagement'` (`:124`), so `parseCondition` keeps
  validating it and `monitoring.configureAlertRules` (`z.enum(ALERT_METRIC_KEYS)`) keeps **letting
  admins create new rules on a metric that is permanently dead.**

  **Required if `active_surveys` is not repointed, in the same PR:** remove it from `ALERT_METRIC_KEYS`
  and `ALERT_METRIC_MODULE`, and migrate or deactivate existing `alert_rules` rows using it — so
  `parseCondition` rejects them and `skipped` actually increments.

- **`getCrossModuleTrend`'s engagement branch — "delete the branch" is struck as an option.** Deleting
  `packages/api/src/routers/monitoring.ts:228-250` (the `metric === 'engagement'` early-`return`) does
  **not** produce an error. Control falls through to the non-sensitive loop at `:252-277`, where
  `let value: number | null = 0;` is followed by `if (metric === 'headcount') … else if (metric === 'alerts') …`
  **with no `else`** — so `value` stays `0` and every point is pushed with `suppressed: false`. The Zod
  input enum at `:186` still accepts `'engagement'`, so the procedure stays callable by **any** holder of
  `monitoring:read`, and returns a **200 with a fabricated all-zero, unsuppressed engagement trend**. The
  fact that the only FE caller hardcodes `metric:'headcount'`
  (`apps/web/app/(admin)/monitoring/monitoring-bottom.tsx:9`) makes "delete" look free; it is not.

  If the metric is not repointed: remove `'engagement'` from the Zod enum at `monitoring.ts:186` **and**
  from the returned type, so callers get a validation error rather than zeros — then **update**
  `tests/monitoring/monitoring-suppression.test.ts` (which mocks `surveyResponse.count` at `:20,34` and
  asserts the monthly-differencing guard at `:99-198`) rather than deleting it alongside the branch.

`survey_responses` reads at `engagement.ts:83` and `:126` are **relation traversals nested inside
`db.survey.findFirst`** — they never appear in a `.surveyResponse.` grep. They are also why the two
tables cannot flip independently: the surviving readers join them in one query.

### The edits

**1. Prisma schema — two files.**

- Delete `packages/db/prisma/schema/engagement.prisma:1-39` (`model Survey`, `model SurveyResponse`).
  Keep `model ActionPlan` (`:41+`) — `action_plans` is **not** flipping; it is still written by the TS
  engagement router's two zero-FE-consumer mutations.
- Delete `packages/db/prisma/schema/user.prisma:105-106`:
  ```prisma
  createdSurveys               Survey[]                @relation("SurveyCreator")
  surveyResponses              SurveyResponse[]        @relation("SurveyResponseUser")
  ```
  Verified with `grep -rn 'Survey' packages/db/prisma/schema/` — those are the only two inbound
  references; `SurveyResponse.survey` and `SurveyResponse.user` are internal to the deleted block.
- **First, satisfy §0 P8** — there is no `CREATE TABLE "surveys"` anywhere in
  `packages/db/prisma/migrations/`, so deleting these models removes the repo's only bootstrap-able
  definition of the two tables. Commit the hand-authored idempotent `CREATE`+GRANT+RLS script into
  `services/Tims.Platform/db/manual/` in the same PR, **before** the model deletion in the diff order.

**1b. The FE cache consumer.** Remove the `utils.engagement.listSurveys.invalidate();` line at
`apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx:58` (and its explanatory comment at
`:55-57`). The adjacent `queryClient.invalidateQueries({ queryKey: ['platform-api','engagement','dashboard-kpis'] })`
already covers the cache the modal actually needs to refresh. Then update
`tests/tier1/s2-engagement-wiring.test.ts:27-33` — drop the
`expect(modal).toMatch(/utils\.engagement\.listSurveys\.invalidate/)` assertion and rewrite the surrounding
comment, exactly the way the 2026-07-31 pass rewrote the `createSurvey`/`activateSurvey` assertions in that
same file. Skipping this reddens `Type Check (web)`, `Type Check (api)` (the tsconfig finding in §1) and
`Security Audit (56 tests)`.

**1c. The `vi.mock('@tims/db')` delegate lists** (§1 step 6): `tests/monitoring/executive-kpis-vacancy-status.test.ts:7`
and `tests/monitoring/alert-evaluation.test.ts:8,16`. Both mock `survey.count` and both execute the
readers this flip repoints — a repoint to a C# fetch makes the first hit an unmocked network call inside a
real tRPC caller, and leaves the second wired to a delegate that no longer exists. `tests/access/scoped-probe.test.ts`
is **not** affected by this flip (no survey delegate).

**2. Ledger — `docs/architecture/table-ownership.md`.** In the single ```json block: remove `"surveys"`and`"survey_responses"`from`efcoreStranglerWrite[]`(currently`:86-87`) and add them to `efcore[]`
(`:30-37`). Keep `"action_plans"` where it is. Add the flip note per §1 step 5, including the §4 option-(c)
DDL statement.

> Keep this runbook in its own file. `parseLedger` takes the **first** ```json block in
`table-ownership.md` (`table-ownership.mjs:20`); adding a JSON example above the ledger block would
> silently hijack the parse.

**3. Tripwires — enumerate them with the P6 sweep, do not copy this list.** Line numbers in
`tests/access/scope-wiring-sensitive-data.test.ts` drift on every engagement pass; run
`grep -n 'engagement\|[Ss]urvey' tests/access/scope-wiring-sensitive-data.test.ts` and disposition **every**
hit. As of 2026-08-02 that is at minimum:

- **`:445-457`** — the `no surveyResponse.findMany` assertion, and
  `expect(scoped.length).toBeGreaterThanOrEqual(1)` on `responses: { select: { answers: true } }`. The
  latter **requires at least one surviving relation read in `engagement.ts`**, so deleting
  `getSurveyResults` and `getResultsByArea` fails it.
- **`:176-190`** — _missing from an earlier draft of this list._
  `it('the router DELEGATES its surviving aggregates to the golden-fixtured shared kernels…')` runs
  `for (const kernel of ['summarizeSurveyResults','buildResultsByArea']) expect(src, …).toMatch(new RegExp(\`\\b${kernel}\\(\`))`against`packages/api/src/routers/engagement.ts`. This flip deletes `getSurveyResults`
(`engagement.ts:64-97`, the **only** `summarizeSurveyResults(`caller, at`:93`) and `getResultsByArea`
(`:105-152`, the only `buildResultsByArea(`caller) — so **both** regexes fail and`Security Audit (56 tests)` goes red.
- **`:228`** (the runbook previously cited `:220`; the line has drifted) —
  `expect(matches.length).toBeGreaterThanOrEqual(5)` on `requireOrgScope(ctx.access)` occurrences. With
  both procedures gone the count drops from **5 to 3**, so this fails outright. It must be **re-anchored**,
  not merely "re-checked."

Retire or re-anchor each, exactly as the file's existing `UPDATE 2026-07-29/2026-07-31` amendments did
(the C#-side equivalent guarantees live in
`services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementReadEndpointTests.cs`).
§0 P6 warns that tripwires are literal source greps; under-enumerating them is the failure this list has
already suffered once.

**4. Parity surfaces — CORRECTED 2026-08-05 (#57): dropping `tsProcedure` is now the PREFERRED edit.**

> **This item has been wrong twice, in opposite directions. Read the whole thing before acting.**
>
> An early draft said "remove the `tsProcedure` side, or the CLI 404s" — right conclusion, wrong reason.
> A later draft then declared the property **required** and the edit illegal, which was true of the type
> at the time and produced a worse outcome: on the nine-box surface it was read as licence to delete the
> whole surface, which silently retired that surface's RLS Mode-A cross-tenant IDOR probe and its RBAC
> deny assertions against endpoints that were still deployed. A parity surface is not only a TS-vs-C#
> diff; it is also where the cross-tenant and permission probes are registered, and those take
> `callCsharp` alone (`checks/rls.ts`, `checks/rbac.ts` — neither reads `tsProcedure`).
>
> **`tsProcedure` is now optional** (`scripts/parity/surfaces.ts`, `tsProcedure?: string`). So when a
> domain's TS side is deleted:
>
> - **Do** drop the `tsProcedure` property and KEEP the endpoint registered. Parity then reports
>   `[WEAK]` with a stated reason and is counted in a separate `weak` bucket in the summary; RLS and
>   RBAC keep running for real and still fail the command.
> - **Do not** delete the endpoint or the surface merely because the TS side is gone. That is a
>   security-coverage regression, and it will not show up as a failing test — it shows up as one fewer
>   test.
> - Deleting is right only when the C# endpoints themselves are gone.

`scripts/**` **is** type-checked in CI (§1, the tsconfig finding), so historically deleting the property from the
`surveys` endpoint at `:279-281` was a type error → `Type Check (api)` red. That is no longer so. Deleting the whole endpoint
instead reddens `Security Audit (56 tests)`, because `scripts/parity/surfaces.test.ts:53-58` asserts
`expect(s.endpoints.map((e) => e.name).sort()).toEqual(['rotation-risk','surveys'])` and `:64-66` asserts
the `surveys` endpoint's `expectedByRole['hrbp']` is `200` — and `vitest.config.ts:50` includes
`'scripts/**/*.test.ts'`, so `npx vitest run` executes them.

Two legal edits; pick one:

- **(a)** Make the field optional (`tsProcedure?: string`) and teach the parity CLI to skip C#-only
  endpoints; or
- **(b)** Remove the `surveys` endpoint entirely **and** update `scripts/parity/surfaces.test.ts:53-58` to
  `['rotation-risk']` and drop the `:64` `hrbp` assertion.

**5. Repo-wide staleness grep** (§1 step 8): `grep -rni 'surveys\|survey_responses' docs/ scripts/ --include='*.md' --include='*.sh'`.

### Verification for this flip

Everything in §5, plus the live assertion pinned to these two tables:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('surveys','survey_responses');

SELECT polrelid::regclass AS tbl, polname, polpermissive,
       pg_get_expr(polqual,polrelid) AS using_expr
FROM pg_policy WHERE polrelid IN ('surveys'::regclass,'survey_responses'::regclass);
-- EXPECT TWO policies per table today: tenant_isolation AND the untracked org_isolation (§3a).
-- If org_isolation is still present and unexplained, that is a §8 Q2/Q3 blocker, not a flip finding.

-- Liveness, NOT equality (§5 step 6): C# is the live sole writer, so survey_responses grows during the
-- window — `useEngagementSubmitSurveyResponse` (platform-api/engagement.ts:511-522) POSTs on every
-- employee submission from dashboard/survey-take-modal.tsx:41. Assert monotonicity, not a fixed count.
SELECT to_regclass('public.surveys')          IS NOT NULL AS surveys_exists,
       to_regclass('public.survey_responses') IS NOT NULL AS responses_exists;
SELECT relname, n_tup_ins, n_tup_del FROM pg_stat_user_tables
WHERE relname IN ('surveys','survey_responses');
SELECT max(submitted_at) FROM survey_responses;   -- must advance, never regress
```

Then, functionally:

- **Smoke-test the five `getExecutiveKpis` consumers** — the four dashboards **and** the alert-rules modal
  whose `.invalidate()` (`monitoring/alert-rules-modal.tsx:82`) refreshes them after a rule change.
- **Verify the alert cron with an observable check, not "the same numbers."** An earlier draft asked the
  operator to "confirm the 06:00 alert cron's next run produces the same `active_surveys` numbers." **The
  cron emits no metric values anywhere** — it only writes dedup'd `alerts` rows, and
  `hasActiveAlertForRule` suppresses repeats, so there are no numbers to compare. Do this instead:

  ```sql
  -- Must be empty if active_surveys was retired from ALERT_METRIC_KEYS (the required edit above).
  SELECT id, organization_id, condition FROM alert_rules
  WHERE condition->>'metric' = 'active_surveys' AND is_active = true;
  ```

  If the set is non-empty, each remaining rule must be individually shown to still fire — a silent `null`
  produces no error, no `skipped` increment and no log line (see the corrected failure mode above).

---

## 8. Open questions

Ordered by how much they block the first flip.

**Q0 — ~~Has a flip revert ever been executed end-to-end?~~ → CLOSED 2026-08-03. Yes, once.** The flip #1
revert was executed for real on the branch and passed the full gate — transcript in §7, and §6's
UNVERIFIED label is dropped. "Rewind beats forward-fix" now has one piece of evidence behind it instead of
none.

**What remains open, narrowed:** the rehearsal covered an **option-(c)** flip, where no DDL moved and
check 16 proved it. Rollback after a DDL change to a flipped table is still unobserved — and by §4's
point-of-no-return it is not a `git revert` at all, so it needs a restore-from-backup drill, not a repeat
of this one. Nothing blocks flip #2 on this account.

**Q0b — Who builds the C# monitoring read, and the privileged cross-org read for the alert cron?**
These are **named prerequisite slices**, not open questions in the usual sense: without them #64 is
blocked under P2 (§7). Monitoring has no `apps/web/lib/platform-api/monitoring.ts`, no
`Platform:Monitoring*` flag, and no C# endpoint; the alert cron additionally needs a **privileged
cross-org** read that a `TenantScope`/RLS-scoped EF read cannot serve. Ranked above Q1 because Q1 gates
_how_ flip #1 is done, while this gates _whether #64 can be flip #2 at all_. _Resolve:_ scope both as
their own slices, or accept `access_reviews` as flip #1 and defer #64 behind them.

> **RESOLVED-BY-ROUTING-AROUND, 2026-08-04.** #64 was **not** flip #2 — succession (§7c, #69) was, because
> #58 had already removed every TS writer there and its only readers were two local ones. So Q0b no longer
> blocks _making progress on flips_; it blocks **#64 and #66 specifically**, and it is still entirely
> unbuilt. Both prerequisite slices remain open work: there is still no C# monitoring read surface and no
> privileged cross-org read for the alert cron. This question stays OPEN — only its urgency changed.

**Q1 — What does `prisma migrate dev` do against a DB with no `_prisma_migrations` and heavy drift?**
Still unverified — it may offer a full reset rather than a targeted `DROP`. _Resolve:_ the throwaway-DB
procedure in §2.

**Partly answered 2026-08-03 (#115):** what Prisma _wants_ to do is now known exactly, because
`migrate diff` is read-only and was run. Against prod today it generates `DROP TABLE` ×17 (all four
`hris_*`, `fx_rates`, all eleven `qrtz_*`, and `__EFMigrationsHistory` itself), one `DROP COLUMN`, 16
`DROP CONSTRAINT` and 6 `ALTER COLUMN ... DROP DEFAULT`. The open part is only whether `migrate dev`
_escalates_ that to a reset. **The guard has shipped** (`scripts/db/guard-prod-ddl.sh`), so this no longer
blocks flip #1 — it is now a "know your tools" item rather than a precondition.

**Q2 — Is the untracked `org_isolation` policy actually fail-open?** The conclusion follows from
Postgres semantics (permissive policies OR'd; the USING clause contains `OR current_org_id() IS NULL`)
and from the verified policy definition, but it was **never observed running** — the direct test
(`BEGIN; SET LOCAL ROLE app_tenant; SELECT count(*) FROM surveys; ROLLBACK;`) was blocked by the
permission classifier. **Possibly the single most important thing to resolve before any flip.**
_Resolve:_ run exactly that transaction with the org GUC unset, on a throwaway DB seeded with two orgs'
rows, or read-only against prod with Federico present. Escalate as a security issue on its own merits,
independent of this runbook.

**Q3 — ~~Where did `org_isolation` and `current_org_id()` come from?~~ → RESOLVED 2026-08-03 (#115).**
Both were created by the **Supabase dashboard SQL editor**, recorded as
`supabase_migrations.schema_migrations` row `20260531055730 enable_rls_all_tables` — a migration with no
repo counterpart. `org_isolation` is gone (#112). `current_org_id()` still exists but is now fully
orphaned: **0** policies call it (all 100 `tenant_isolation` policies read the GUC directly) and it has
**0** `pg_depend` dependents. It is a latent hazard rather than a live one — a future policy written
against it silently reintroduces the fail-open shape. Removal tracked as its own issue; not needed before
a flip.

**Q4 — How is prod DDL actually applied? → RESOLVED. Has `prisma db push` ever been pointed at it? →
PARTLY (#115, 2026-08-03).** All four paths are now reconciled — see
[`../ddl-reconciliation-2026-08-03.md`](../ddl-reconciliation-2026-08-03.md) §5. The "has `db push` run
against prod" half remains formally unanswerable, because `db push` leaves no trace by design. But it is
now better evidenced: **~100 of the 102 Prisma tables have no `CREATE TABLE` in any migration file** —
the earliest migration is `20260604000000`, and nothing creates the base tables.

Be careful with that inference, though: it rules out the Prisma-migration path, not the other two. Bulk
hand-applied psql or the Supabase dashboard could equally have created those tables, and the dashboard
demonstrably created objects with no repo counterpart (Q3). So the honest statement is **"consistent with
`db push`, and not attributable to any single path"** — the base tables' provenance is genuinely unknown,
which is itself the finding. Either way, treat the §2 hazard as **real, not hypothetical**.
`scripts/db/guard-prod-ddl.sh` now refuses `pnpm push`/`pnpm migrate` against a non-local host. If the
guard is bypassed, `/gate` check 16 **would surface** the damage — but only when someone runs `/gate`;
it is local-only and not in CI (#124), so it is not continuous detection. The real recovery path for a
bypassed guard is a database backup, not the check.

**Q5 — ~~Does prod's column/FK/constraint shape actually match the Prisma models?~~ → RESOLVED: NO
(#115, 2026-08-03).** Measured with `prisma migrate diff` in both directions against the live URL. Three
drift classes, all sharing one root cause — the `migrations/*.sql` files are hand-written and were never
reconciled back into the datamodel:

- **11 undeclared FKs** — `hire_predictions` ×7 (the model declares zero `@relation` blocks) plus
  `organization_id` FKs on `rater_assignments`, `rater_responses`, `review_cycles`,
  `role_family_weight_profiles`.
- **6 `gen_random_uuid()` `id` defaults** the datamodel does not declare.
- **1 FK definition skew** — `role_family_weight_profiles_organization_id_fkey` is `ON UPDATE NO ACTION`
  in prod because `20260710140000_add_fit_engine_schema/migration.sql:26` omitted `ON UPDATE`.

Plus one column with **no provenance at all**: `nine_box_evaluations.updated_at`, absent from every repo
file, every commit, and all three migration-history tables.

Going forward, do not re-derive this per table: diff against
[`packages/db/baseline/prod-public-schema.sql`](../../../packages/db/baseline/prod-public-schema.sql) (§0
P0), which is the whole-schema answer and is kept current by check 16.

**Q6 — Does `dotnet ef migrations add --context <StranglerContext>` even succeed?** Those contexts have
no design-time factory; whether EF resolves them through the `Tims.Api` host's service provider is
unknown. Also unverified: whether a third migrating context sharing one `__EFMigrationsHistory` causes
problems (EF filters by the `[DbContext]` attribute, so it _should_ be fine — reasoning, not an observed
run). _Resolve:_ only needed if §4 option (a) or (b) is chosen; try it on a scratch branch.

**Q7 — Should a flipped, EF-solely-written table keep its `app_tenant` INSERT/UPDATE/DELETE grant?**
No decision exists anywhere in the repo. Keeping it means "one writer" stays code-only; revoking it
hardens the flip but breaks any residual Prisma read path and needs its own verification.
**Scope correction (2026-08-02):** an earlier draft scoped the blast radius to direct **readers of** the
flipped table. It must also cover tables whose **RLS policy references** the flipped table in a subquery —
revoking `app_tenant`'s SELECT on a flipped `calibration_sessions` would break every read _and_
write of `calibration_members`/`calibration_votes` (§3f). _Resolve:_ explicit
decision, recorded in the ledger, before flip #2 — preceded by the `pg_policy` reference scan in §3(f).

> **Answered for ONE trio, still open in general — flip #3, 2026-08-06 (§7d).** For
> `calibration_sessions` / `calibration_members` / `calibration_votes` the decision is recorded in the
> ledger as **KEEP the grant**, and it is not a deferral: (1) the C# strangler writes _as_ `app_tenant`
> (`TenantScope` → `SET LOCAL ROLE`), so ownership is not the discriminator for DML — RLS is, and
> revoking here breaks production writes exactly as #126 did; (2) §3(f) applies by name, since the
> children's policies subquery the parent and are evaluated as the querying role. **Do not generalise
> §7/§7c's "expect dead privilege, consider a REVOKE" to this trio.** The general question — for tables
> whose C# owner uses the _privileged_ connection, like `access_reviews` — is unchanged and still open
> as #126.

**Q8 — Is the `efcoreStranglerWrite` → `efcore` move supposed to be gated on a runtime flag being live
first?** Every ledger list change is a pure text edit with no link to `Platform:*Enabled` config, and no
CI check ties them together. Today this is a human step. _Resolve:_ state the policy here — the
recommendation is **yes, the write flag must be confirmed live in prod and the TS writer deleted before
the flip PR opens**, which is exactly the P1 precondition.

**Q9 — Is `packages/db/prisma/seed-demo.ts` ever run against a live environment?** Its writes to four
strangler tables are a post-flip hazard only if so. Invocation wiring not found. _Resolve:_ grep CI/ops
scripts; ask Federico.

> **Not applicable to flip #3 (2026-08-06, §7d) — checked, not assumed.** `seed-demo.ts` has **zero**
> occurrences of `calibration`, so none of the three flipped tables was ever seeded there and nothing
> needed porting. Contrast flip #2, where `seed-demo.ts:913-945` did write the flipped tables and was
> ported to raw SQL. The question itself stays open for `surveys`/`survey_responses` and the
> compensation pair.

**Q10 — Is `salary_bands` writer-free?** It is joined from `employee_compensations`
(`compensation.service.ts:71`) and read at `compensation.ts:129`, but it is not in the flip-ready set and
its writers were never audited. If it is not flip-ready, `employee_compensations` cannot flip cleanly
(§0 P3). _Resolve:_ run the P1 grep against it.

**Q11 — Does the repo's Prisma migration for `assessment_norm_scoring` byte-match what the Supabase
migration `20260801041056_assessment_norm_scoring` actually applied?** If those two paths can diverge,
the repo's migration directory is not a reliable record of prod even for changes made this week.

**Q12 — Who owns reconciling the three DDL paths?** `00-master-plan.md:68` ("One DDL path") is factually
untrue today (§4). Either amend the standard or pick one path and say so. No doc anywhere acknowledges
the Supabase path exists.

---

## Side-quests worth folding into the first flip PR

Cheap, in-scope, and each one prevents a future reader from being misled:

1. `table-ownership.md:152-162` — rewrite the stale "What the CI check enforces (Phase 1)" section
   (2 rules / 1 table → 6 rule families / 56 tables).
2. `table-ownership.md:108` and `Fx/FxRateDbContext.cs:7` — the fx migration id is wrong. The real id is
   `20260723032952_fx_rates` (matches `__EFMigrationsHistory`); both docs say `20260722000000_fx_rates`,
   which would read as "never applied" to anyone verifying against the history table.
3. `.claude/rules/db.md:66` — annotate that prod is not `prisma migrate`-managed and that
   `prisma migrate dev`/`deploy` must never target it (§0 P7).
4. Promote §5 step 5 (ghost-`efcore[]`-entry assertion) into `checkOwnership()` as a seventh rule.
5. Correct the `succession` flip-readiness claim in the ledger's Slice-14 note: it says
   "grep-confirmed nothing outside `packages/api/src/routers/succession.ts` touches
   critical_roles/successors", but `packages/db/prisma/seed-demo.ts:914,919,932` also uses those
   delegates.
6. **Carve out the subquery-policy tables from the `EnableTenantRls()` rule.** — **HALF DONE 2026-08-06
   (flip #3, §7d).** `docs/architecture/table-ownership.md` ("ships its RLS block via
   `EnableTenantRls()`") now carries the carve-out, with the FORCE-RLS-with-zero-policies failure mode
   spelled out. **Still open:** `services/Tims.Platform/src/Tims.Domain/Rls/TenantRls.cs:10-13` ("The
   emitted block matches the live Prisma policy") is still false for `calibration_members` /
   `calibration_votes`, which have no `organization_id` column (§3e). Flip #3 touched no C# file, so it
   was left. This is now more urgent than when it was written, because both tables are `efcore[]` and
   the rule applies to them for real.
7. **Guard `cutover.sh --rollback`.** Make it refuse for surfaces whose status is TS_DELETED or flipped
   — on those it unmaps endpoints the FE calls unconditionally, i.e. it is an outage button, not a rewind
   (§6). Surface that status in `--list` too.
8. **Amend the migration-authoring convention.**
   `docs/superpowers/plans/2026-07-08-company-entitlements-slice-1.md:130-137` prescribes
   `prisma migrate diff --from-schema-datasource`, which after any flip emits `DROP TABLE` for the flipped
   table (§2). Require `--exclude-tables` for every `efcore[]` table, or a mandatory `DROP`/`ALTER` grep of
   the generated script before it is committed.
9. **Move the `db push` guard to command level** and update `CLAUDE.md:32` + `README.md:80,96-97`, which
   both document the unguarded raw form that a `package.json` rename does not cover (§2).
