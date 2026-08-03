# Ownership Flip Runbook — strangler step 6 (Prisma → EF Core)

Date: 2026-08-02 (rev. 2 — adversarial review pass) · Status: **Written, NEVER EXECUTED.** No table has
ever been flipped, and no flip has ever been reverted (§6 is UNVERIFIED; see §8 Q0).

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

**P2 — Cross-domain Prisma READERS enumerated and each one dispositioned.** **Five** grep strategies,
all of them (a `.model.method` grep alone is not sufficient — see §7's relation-traversal reads):

```bash
grep -rnE '\.<model>\.[a-zA-Z]+\(' packages/ apps/web/ workers/ scripts/ --include='*.ts'   # delegates
grep -rn '<backRelationFieldName>' packages/api apps/web                                     # relation traversal
grep -rniE '\b<table>\b' packages/ apps/web/ workers/ scripts/                               # raw SQL / strings
grep -rnE "'<model>'" packages/api/src/access/                                               # dynamic delegate map
grep -rnE 'utils\.[a-zA-Z]+\.<procedure>\.(invalidate|fetch|prefetch|setData)' apps/web      # tRPC CACHE consumers
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
  "Repoint" applies: the surrounding procedure stays on tRPC and the one read must be served
  server-to-server from the C# read surface. Worked counterexample the taxonomy previously had no slot
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
alarm with a green suite. Note also that `employee_compensations` has **four** Prisma read sites, not the
one P3 cites: `routers/compensation.ts:30`, `routers/compensation.ts:80`,
`services/compensation.service.ts:62`, and `routers/platform/data-requests.ts:94`.

**Do not** convert a Prisma read to `$queryRaw` to make `tsc` pass. `scripts/table-ownership.mjs` is
blind to raw SQL (§1, discovery), so this silently reintroduces a second reader of an EF-owned table
with zero CI signal. It is the single easiest way to make this runbook worthless.

**P3 — Cross-stack relation joins identified.** A flipped table joined to a Prisma-owned table in one
query cannot stay one query. `survey_responses ⋈ users` (§7) and `employee_compensations ⋈ salary_bands`
(`packages/api/src/services/compensation.service.ts:71` — **one of four** `employeeCompensation` read
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

The fix, before the Prisma model is deleted: commit a hand-authored idempotent
`CREATE TABLE IF NOT EXISTS` — plus its indexes, FKs, GRANTs and the **exact live** `tenant_isolation`
policy read from `pg_catalog`, not from the migration source — into `services/Tims.Platform/db/manual/`,
and wire the `db push` bootstrap path to apply it. Verify it with the new §5 step 8.
_(`access_reviews` does **not** have this problem — it has a real migration file at
`packages/db/prisma/migrations/20260717170000_add_access_reviews/migration.sql:4`. That is one more
reason it is the better pilot; see §7.)_

**P9 — Per-table RLS _shape_ classified from the live DB.** Read
`pg_get_expr(polqual, polrelid)` for every policy on the candidate table and classify it as a
**column predicate** (`organization_id = …`) or a **subquery** (`EXISTS (SELECT 1 FROM parent …)`).
`services/Tims.Platform/src/Tims.Domain/Rls/TenantRls.cs:18,31-32` hardcodes
`OrgColumn = "organization_id"` and can only emit the column-predicate form, so
**`EnableTenantRls()` structurally cannot serve a subquery-policy table.** Two tables in
`efcoreStranglerWrite[]` are exactly that: `calibration_members` and `calibration_votes` have **no
`organization_id` column at all** (`packages/db/prisma/schema/ninebox.prisma:41-77`) and their live
policies are parent subqueries (`…/20260604100000_enable_rls_tenant_isolation/migration.sql:326,330`).
See §3(e) for what goes wrong if the ledger's standing "ships its RLS block via `EnableTenantRls()`" rule
is followed literally on those two.

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
   Prisma delegates; generated `Prisma.<Model>WhereInput` types; the access-registry triple
   (`entity-policies.ts` union + set, `scoped-probe.ts` `NOT_FOUND_MESSAGES` + `DELEGATES`); hand-rolled
   `vi.mock('@tims/db')` delegate lists; and `packages/db/src/index.ts` enum re-exports.

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
     for the two legal edits (`tsProcedure` is a **required** field — `surfaces.ts:7` — so "just remove
     the `tsProcedure` side" is not one of them);
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

**(e) `EnableTenantRls()` structurally cannot serve two of the sixteen `efcoreStranglerWrite[]` tables,
and the ledger's standing rule tells you to use it anyway.** `docs/architecture/table-ownership.md:18`
("The rule") says every EF-owned table "ships its RLS block via `EnableTenantRls()` (org-scoped tables
only)" — and `TenantRls.cs`'s own docstring (`:10-13`) asserts "The emitted block matches the live Prisma
policy (migration 20260604100000…)". **Both are untrue for `calibration_members` and `calibration_votes`:**

- Neither table has an `organization_id` column at all — `packages/db/prisma/schema/ninebox.prisma:41-77`
  gives them only `sessionId`/`userId`.
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
if `calibration_sessions` (also in `efcoreStranglerWrite[]`, and a plausible flip candidate **ahead of its
children**) were flipped and then had `app_tenant`'s privileges revoked, the subquery policies on the
still-Prisma-owned `calibration_members`/`calibration_votes` (`migration.sql:326,330`) could no longer
evaluate — **breaking every Prisma read and write of those two tables**, neither of which is a reader of
the flipped table.

Standing rules, therefore:

- Before any REVOKE, scan `pg_get_expr(polqual, polrelid)` across **all** of `pg_policy` for the candidate
  table's name, not just the rows where `polrelid` is the candidate. Record the result in the ledger note.
- **A table referenced by another table's RLS policy keeps `app_tenant` `SELECT` regardless of flip
  status**, unless the referencing policy is first rewritten to go through a `SECURITY DEFINER` function.

---

## 4. What "EF owns the DDL" means here

Three DDL paths reach prod today, and the `00-master-plan.md:68-70` "One DDL path" standard only
acknowledges two:

| Path                                                                       | Evidence                                                                               | Tracked in                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Prisma, hand-written idempotent SQL applied via `prisma db execute`/`psql` | migration files say so, e.g. `…/20260624000000_ai_interview_session/migration.sql:4-5` | nothing — 25 dirs on disk, zero rows anywhere |
| EF, `dotnet ef migrations script --idempotent` applied via `psql`          | `services/Tims.Platform/db/manual/20260723032952_fx_rates.sql`                         | `__EFMigrationsHistory` — **exactly one row** |
| Supabase's own migration mechanism                                         | `list_migrations` → 4 rows, 2 with no repo counterpart                                 | `supabase_migrations`                         |

So: EF has applied DDL to prod **once**, to one global RLS-exempt table with no data dependencies and no
Prisma reader. The four `hris_*` tables in `efcore[]` **do not exist in prod at all** — that precedent is
code-and-Testcontainers only. Plan the first flip as first-of-kind, not as a repeat.

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

0. **Schema drift, FIRST (#115).** Everything below compares the flip against an expected schema; this
   proves the expected schema is still the real one.
   ```bash
   bash scripts/db/schema-baseline.sh check   # 0 = matches, 1 = drift, 2 = DID NOT RUN
   ```
   A flip PR normally changes **no** DDL, so this must be a clean exit 0 both before and after. If the
   flip does move DDL (§4 option (a)/(b)), re-capture the baseline and commit it in the flip PR — the
   baseline diff is then the reviewable record of exactly what the flip did to prod. **Exit 2 is not a
   pass**; resolve it before continuing rather than proceeding on an unverified schema.
1. **Ledger check, directly.**
   ```bash
   node scripts/table-ownership.mjs        # expect: "table-ownership check passed." exit 0
   npx vitest run tests/governance/table-ownership.test.ts
   ```
2. **Prisma schema still validates and generates.** This is the real gate for missed back-relations.
   ```bash
   cd packages/db && npx prisma validate --schema=prisma/schema
   npx prisma generate --schema=prisma/schema
   ```
3. **Both type checks.**
   ```bash
   pnpm --filter @tims/api exec tsc --noEmit
   cd apps/web && npx tsc --noEmit
   ```
   This — not the ownership check — is what catches a surviving Prisma reader.
4. **Full suite + build.** `npx vitest run` at root, then `/gate`. Remember §0 P6: a green suite is not
   evidence the flip is clean, because the tripwires are static source greps.
5. **Manual assertion the check cannot make — every `efcore[]` entry maps to a real EF `ToTable`:**
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
6. **Live DB assertion — the table survived, unchanged.** Run against prod (read-only) before and after
   the PR merges, and diff:

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

7. **The C# writer still works.** `scripts/parity/cli.ts verify-write <surface>` against the live
   surface. The flip does not change the write path, so this is a regression check, not a new proof.

8. **Clean-checkout bootstrap still produces the table (§0 P8).** On a **scratch** DB, from a clean
   checkout of the flip branch, run the documented bootstrap (`pnpm db:push` / the guarded equivalent plus
   whatever applies `services/Tims.Platform/db/manual/`), then assert:

   ```sql
   SELECT to_regclass('public.<table>') IS NOT NULL;   -- must be true
   ```

   and confirm `packages/db/prisma/seed-demo.ts` and `scripts/parity/seed.ts` still run green against it.
   Deleting the Prisma model can remove the repo's **only** DDL definition of the table; this step is the
   check that it did not.

9. **EF write-value compatibility against the live column types (§0 P10).** For the flipped table, diff
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

> **Status: UNVERIFIED — never rehearsed.** No table has ever been flipped, therefore no flip has ever
> been reverted, not even on a scratch DB. Everything below is reasoning about what `git revert` would
> restore, in the same register as §7's status block and §4's option-(a) note. The one property the whole
> strangler approach's safety rests on is the one property this document has never observed. **§8 Q0 is
> the item that fixes that, and it is nearly free** — fold the rehearsal into the throwaway-DB procedure
> §2 already mandates for Q1.

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

## 7. Worked example — `surveys` + `survey_responses` (issue #64)

> **Status: procedure, not a transcript. This flip has not been executed.** Issue #63's acceptance
> criteria require a worked example _executed_ end-to-end; that has not happened, and this section must
> be replaced with the real transcript when it does.

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

**4. Parity surfaces — the previously prescribed edit is not legal.** An earlier draft said "remove the
`tsProcedure` side, or the CLI 404s," framing this purely as a runtime concern. `tsProcedure` is a
**required** field (`scripts/parity/surfaces.ts:7` declares `tsProcedure: string;`, non-optional), and
`scripts/**` **is** type-checked in CI (§1, the tsconfig finding), so deleting the property from the
`surveys` endpoint at `:279-281` is a type error → `Type Check (api)` red. Deleting the whole endpoint
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

**Q0 — Has a flip revert ever been executed end-to-end? No.** Not in prod, not on a scratch DB, not once.
`grep -niE 'rehears|drill|dry.?run'` over this file returned nothing before this revision. The single
property the whole strangler approach's safety rests on — "rewind beats forward-fix" — is the one property
this runbook asserts without evidence, and §6 is now labelled accordingly. **Blocks flip #1.**
_Resolve — nearly free, fold it into the Q1 procedure:_ after step 3 of the §2 throwaway-DB procedure,
`git revert` the scratch flip, then re-run `prisma generate`, both `tsc`, `npx vitest run`,
`node scripts/table-ownership.mjs`, and a functional read against the throwaway DB. **Record the verbatim
transcript in §6** and drop its UNVERIFIED label.

**Q0b — Who builds the C# monitoring read, and the privileged cross-org read for the alert cron?**
These are **named prerequisite slices**, not open questions in the usual sense: without them #64 is
blocked under P2 (§7). Monitoring has no `apps/web/lib/platform-api/monitoring.ts`, no
`Platform:Monitoring*` flag, and no C# endpoint; the alert cron additionally needs a **privileged
cross-org** read that a `TenantScope`/RLS-scoped EF read cannot serve. Ranked above Q1 because Q1 gates
_how_ flip #1 is done, while this gates _whether #64 can be flip #2 at all_. _Resolve:_ scope both as
their own slices, or accept `access_reviews` as flip #1 and defer #64 behind them.

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
revoking `app_tenant`'s SELECT on a flipped `calibration_sessions` would break every Prisma read _and_
write of the still-Prisma-owned `calibration_members`/`calibration_votes` (§3f). _Resolve:_ explicit
decision, recorded in the ledger, before flip #2 — preceded by the `pg_policy` reference scan in §3(f).

**Q8 — Is the `efcoreStranglerWrite` → `efcore` move supposed to be gated on a runtime flag being live
first?** Every ledger list change is a pure text edit with no link to `Platform:*Enabled` config, and no
CI check ties them together. Today this is a human step. _Resolve:_ state the policy here — the
recommendation is **yes, the write flag must be confirmed live in prod and the TS writer deleted before
the flip PR opens**, which is exactly the P1 precondition.

**Q9 — Is `packages/db/prisma/seed-demo.ts` ever run against a live environment?** Its writes to four
strangler tables are a post-flip hazard only if so. Invocation wiring not found. _Resolve:_ grep CI/ops
scripts; ask Federico.

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
6. **Carve out the subquery-policy tables from the `EnableTenantRls()` rule.**
   `docs/architecture/table-ownership.md:18` ("ships its RLS block via `EnableTenantRls()`") and
   `services/Tims.Platform/src/Tims.Domain/Rls/TenantRls.cs:10-13` ("The emitted block matches the live
   Prisma policy") are both **false for `calibration_members` / `calibration_votes`**, which have no
   `organization_id` column (§3e). Amend both, and state that following the rule literally on those two
   leaves a FORCE-RLS table with zero policies.
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
