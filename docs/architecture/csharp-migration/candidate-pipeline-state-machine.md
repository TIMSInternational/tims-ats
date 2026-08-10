# Candidate pipeline state machine — design spike (#103)

> **Status**: design + inventory only. No code in scope. Written 2026-08-10 against `main` `013a86bd`
> ("docs(parity): tsProcedure is OPTIONAL …", #194) on branch `docs/102-103-design-spikes`.
>
> Every claim below was re-derived from source at the cited `file:line`. Where this doc contradicts
> issue #103, issue #88, issue #30, or `docs/REMAINING-WORK.md`, both sides are cited and the
> contradiction is called out explicitly.
>
> **Corrected 2026-08-10 after a claim-audit pass.** The first draft stated the base commit as
> `fc1770fb`, which is five commits behind `013a86bd`; at `fc1770fb` the `docs/REMAINING-WORK.md` row
> cited in §8 sits at `:527`, not `:534`, so a verifier following the old header would have landed on
> a blank line. Ten other claims were corrected; the ones that changed a **conclusion** rather than
> only a line number carry an inline `> **Corrected 2026-08-10.**` note where they appear (§1.1, §1.2,
> §2, §3, §D1). Deviations from #103's acceptance criteria are collected in §7.1 rather than left
> implicit.

---

## 0. Three corrections to #103's premises

#103's body is wrong on all three of its load-bearing claims. Since the issue proposes sequencing work
around those claims, they are corrected first.

### 0.1 `pipeline/movements.ts` and `pipeline/stages.ts` are NOT the scatter

#103 states: _"the stage transition logic is procedural code spread across `pipeline/movements.ts`,
`pipeline/stages.ts`, and the consuming domains."_

Those two files are the **centralized, correctly layered** part of this domain. Verified:

- `packages/api/src/routers/pipeline/movements.ts` is 88 lines, contains **6 procedures**, imports no
  `db` (`:1-5`), and every mutation delegates to `pipelineService` (`:30`, `:44`, `:55`, `:79-86`).
- `packages/api/src/routers/pipeline/stages.ts` is 92 lines, **6 procedures**, imports no `db`
  (`:1-5`), delegates to `pipelineStagesService`.
- Neither file writes `currentStageId` or `stage_movements`. The **only** stage-transition writes in
  either file's call graph land in one repository: `pipeline.repository.ts:158` (movement row),
  `:169-171` (`currentStageId` flip), `:188-197` (bulk movement rows), `:199-202` (bulk
  `currentStageId` flip), `:209-220` (reject). Both multi-write paths are wrapped in
  `runTenantTransaction` (`:157`, `:187`) with an in-code citation of #45 / prisma#17948.

Correction on the task brief's own citation list: `pipeline.repository.ts:357` is **not** a write. It
is the `RETURNING id, current_stage_id …` clause of the checklist-item `UPDATE` (`:343-358`), which
touches `checklist_progress` only. It is a _read_ of the current stage, included in the response.

**Verdict: `pipeline/*` is the model of what the rest of this domain should look like, not the
problem.**

### 0.2 The genuine scatter, which #103 does not name

Three write paths outside `pipeline/*` set or should-have-set an application's pipeline position:

| Site                                | What it does                                                   |
| ----------------------------------- | -------------------------------------------------------------- |
| `candidate.service.ts:199-215`      | Sets the initial `currentStageId` (`:212`); writes no movement |
| `routers/portal.ts:234-244`         | Sets the initial `currentStageId` (`:240`); writes no movement |
| `routers/offer/lifecycle.ts:92-167` | Hires the person; never touches the application at all         |

Each is verified in §2 and §4. `routers/portal.ts` additionally violates the repository rule in
`.claude/rules/api-security.md` — it imports `db` directly at `portal.ts:4` and issues
`db.application.create` at `:235`, with no service and no repository between the tRPC handler and
Prisma.

### 0.3 "Should precede #88" — there is no code dependency, in either direction

#103 Dependencies says _"Should precede #88."_ #88's Hazards says the reverse framing: _"Consider
doing #103's design work **first** and treating this port as its implementation."_

Searched for an actual dependency. There is none, in either direction:

- **No C# pipeline code exists.** `services/Tims.Platform/src` maps `applications`,
  `pipeline_stages` and `stage_movements` in exactly one context — `Reporting/ReportingReadDbContext.cs`,
  `DbSet`s at `:23,:25,:27` and `ToTable` at `:52-54`, `:70-72`, `:85-87` — which is documented
  `AsNoTracking` / `SaveChanges` never called (`ReportingReadDbContext.cs:8-9`) — a read surface, not a
  writer.
- **No parity fixture exists** for this surface. `contracts/` contains 20 fixture directories; none
  is `pipeline-fixtures`. The nearest, `contracts/reporting-fixtures/funnel-view.json`, pins the
  _org-wide reporting_ funnel, which is a different query (§2.5).
- **Nothing in `pipeline/*` blocks on a C# artifact**, and nothing in C# blocks on a TS change.

**Verdict: #103 is a de-risking design doc, not a blocker on #88.** It can land before, during or
after #88 without changing what either has to do. The reason to do it first is judgement, not
sequencing: §3 and §4 identify defects that would otherwise be ported into a C# contract and then have
to be redesigned there.

One correction to the sequencing argument's _scope_, though. #103's genuine subject matter is not
contained by #88. Of the three scattered writers in §0.2, **zero** are in #88's file list: the initial
stage-set lives in `candidate/*` (#84) and `portal.ts` (#91), and the hire event lives in `offer/*`
(#87). If this design constrains a port, it constrains **four** issues (#84, #87, #88, #91), not one.

---

## 1. The actual states

There is **no state enum in the schema or in any shared package** — nothing in
`packages/db/prisma/schema`, `packages/shared` or `packages/api` declares the set of legal values for
either axis. Both axes of an application's position are free-form strings, and one of them is
per-tenant, per-vacancy data.

> **Corrected 2026-08-10.** The first draft said "no state enum **anywhere in this codebase**". That
> is too strong: three frontend files enumerate the status set informally (§1.2), and one frontend
> file enumerates stage _names_ (below). None of them is authoritative and none is imported by the
> backend — but "anywhere" was false, and the qualifier changes what §5's proposal has to reconcile:
> promoting `status` to an enum has to agree with **three** existing informal status enumerations in
> `apps/web`, not zero.

### 1.1 Axis A — pipeline stage (`applications.current_stage_id`)

A stage is a **row**, not a constant: `PipelineStage` in
`packages/db/prisma/schema/pipeline.prisma:1-21`. It carries `name` (`:5`, unconstrained `String`),
`order` (`:6`, `Int`), `slaHours` (`:7`), `checklist` (`:8`, `Json?`), `isDefault` (`:9`), and a
**required** `vacancyId` (`:4`) — every stage belongs to exactly one vacancy, so there are no
org-level stage templates.

`applications.currentStageId` is a required FK to it (`pipeline.prisma:28,48`). The DB constraint is
`ON UPDATE CASCADE ON DELETE RESTRICT` (`packages/db/baseline/prod-public-schema.sql:5651-5655`).

**Consequence: the set of states is per-vacancy, unbounded, user-defined, and renameable.** Any
transition table keyed on stage _name_ is not sound. See §5.1.

Stage rows are created at exactly **3** sites in application code:

1. `routers/pipeline/stages.ts:38-50` → `pipeline.repository.ts:254-266` — the operator-facing CRUD.
2. `routers/vacancy/crud.ts:478-490` — vacancy duplication copies the source vacancy's stages.
3. `packages/db/prisma/seed-demo.ts:681-693` — demo seed only.

Test-code carve-out, stated rather than assumed: §2 declares a grep scope that includes `services`,
and that scope contains a **fourth** `INSERT INTO pipeline_stages`, at
`services/Tims.Platform/tests/Tims.IntegrationTests/Reporting/ReportingReadFixture.cs:253`. It is raw
SQL in an xUnit fixture, alongside `INSERT INTO applications` (`:259`) and `INSERT INTO stage_movements`
(`:269`) in the same file and `INSERT INTO applications` at `AnchorProbeFixture.cs:245`. Those four
statements are test scaffolding, so the design conclusion is unchanged — but "exactly 3" is a
production-code-only count, and every quantifier in this doc that says "application code" or
"production code" excludes exactly those C# integration fixtures and nothing else.

`vacancy.create` (`routers/vacancy/crud.ts:244-332`) creates **no** stages, on either branch
(`:303-325` autoPublish, `:328-331` plain). A freshly created vacancy therefore has zero stages until
someone calls `pipeline.createStage`. See defect D3 in §4.

Two hardcoded stage-name lists exist, and **they disagree with each other**:

| Where                                             | Names                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `seed-demo.ts:658-666` (7)                        | `Aplicado`, `Screening`, `Entrevista RRHH`, `Prueba Tecnica`, `Entrevista Final`, `Oferta`, `Contratado` |
| `apps/web/lib/pipeline-next-actions.ts:34-41` (6) | `postulado`, `preseleccion`, `evaluaciones`, `entrevistas`, `oferta`, `contratado`                       |

Neither is a domain constant: nothing in `packages/api` or `packages/shared` references either list,
and no production tenant is bound to either. But the overlap is **2 of 7** — a database seeded by
`seed-demo.ts` matches the frontend's table only on `Oferta` and `Contratado`, so 5 of the 7 demo
stages fall through to the `null` branch at `pipeline-next-actions.ts:57`.

> **Corrected 2026-08-10.** The first draft said the seed's list was "the only enumerable stage list
> in the repo". It is not, and the second list is the live instance of the defect this doc's §5.1 is
> designed around — see immediately below.

**Name-keyed stage logic in application code today** (the concrete instances §5.1 proposes to
eliminate; this inventory was missing from the first draft):

1. **Live behaviour, admin pipeline.** `apps/web/app/(admin)/recruitment/pipeline/page.tsx:94` —
   `getNextActionForStage(destinationStage.name)`, run in the `moveCandidate` `onSuccess` handler, to
   pick the post-move "next action" toast and its deep link. The implementation
   (`apps/web/lib/pipeline-next-actions.ts:50-57`) normalizes the name (trim, lowercase, strip
   diacritics) and does an exact lookup in the 6-entry table at `:34-41`; an unmatched name returns
   `null` and the UI falls back to a bare toast (`page.tsx:101-105`). The file's own header comment
   (`:5-18`) names the hazard — `PipelineStage.name` is org-configurable and there is no `stageType`
   column — and asks for the match to move onto a real column if one is ever added. Renaming a stage
   (§2.7) silently switches this off; it is the FE-behaviour case §6 Step 1's risk assessment should
   have covered and did not.
2. **Display only, table view.** `pipeline-table-view.tsx:225` renders `→ {nextStage.name}` as the
   advance-button label. Name-derived text, not name-derived logic — listed so the inventory is
   complete, not because it needs changing.
3. **Aggregation key, org-wide funnel.** `packages/shared/src/reporting.ts:43-48` keys its merge map
   on `s.name` (`const merged = new Map<string, …>`; `merged.get(s.name)`), documented at `:33` as
   "stages MERGED BY NAME (same-name stages across pipelines …)" and fed by
   `recruitment-analytics.repository.ts:61-68`, whose doc comment at `:60` says the same. Two
   vacancies whose equivalent stages are spelled differently therefore produce separate funnel rows.
   Listed because it is a second, independent name-keyed behaviour; the org-wide funnel is otherwise
   out of scope (§7).

There is **no name-keyed logic in `packages/api`'s transition path**: `grep -n '\.name'` over
`pipeline.service.ts` returns 0 hits, and over `pipeline.repository.ts` returns only `:258` and `:270`
— the stage-CRUD create and update that _write_ the name. The transition code keys on ids and `order`
only. The defect class is entirely in `apps/web` and in the analytics merge.

### 1.2 Axis B — application status (`applications.status`)

`status String @default("active")` — `pipeline.prisma:30`. Again no Prisma enum, contrary to
`.claude/rules/db.md` § Schema Conventions ("Prisma enums for all status/type fields").

Counted every writer of the column across `packages`, `apps` and `workers`:

| Value       | Written at                                                         |
| ----------- | ------------------------------------------------------------------ |
| `active`    | schema default `pipeline.prisma:30`; seed `seed-demo.ts:756`       |
| `rejected`  | `pipeline.repository.ts:213` (the single `rejectApplication` path) |
| `hired`     | **nowhere** — 0 writers                                            |
| `withdrawn` | **nowhere** — 0 writers                                            |

`hired` and `withdrawn` are nevertheless rendered by the candidate-facing portal:
`apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-applications.tsx` maps both to localized
labels (`:25-26` `hired`, `:27-28` `withdrawn`) and to colours (`:34` `hired`, `:35`
`rejected || withdrawn`). Those branches are dead code today; the i18n keys `statusHired` /
`statusWithdrawn` exist for states no code can produce.

`getBoard` exposes a third vocabulary — the filter enum `z.enum(['active','rejected','all'])` at
`routers/pipeline/movements.ts:15`. It is the only place in **`packages/api`** where a status set is
written down, and it is an _input filter_, not a domain type: it contains the non-status pseudo-value
`'all'` and omits two real values.

> **Corrected 2026-08-10.** The first draft called `movements.ts:15` "the only place in the stack
> where the legal status set is written down". That is false, and it is refuted by a file this doc
> cites two paragraphs earlier. Counted across `apps/web`, **three** frontend files enumerate the full
> four-value set independently, and each is strictly more complete than the backend filter:
>
> | File                                                                           | Lines              | Values                                     |
> | ------------------------------------------------------------------------------ | ------------------ | ------------------------------------------ |
> | `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-applications.tsx` | `:20-28`, `:34-35` | `active`, `rejected`, `hired`, `withdrawn` |
> | `apps/web/app/(admin)/recruitment/pipeline/pipeline-table-view.tsx`            | `:54-59`           | `active`, `rejected`, `withdrawn`, `hired` |
> | `apps/web/app/(admin)/recruitment/pipeline/pipeline-list-view.tsx`             | `:53-58`           | `active`, `rejected`, `withdrawn`, `hired` |
>
> This changes a conclusion, not just a number: the enum promotion proposed in §5.4 has three existing
> frontend enumerations to reconcile — two of which are byte-identical duplicates of each other and
> should collapse into one shared map as part of that work.

### 1.3 What "the pipeline" therefore is, today

`(stage_id ∈ stages(vacancy), status ∈ {active, rejected})`, with the two axes fully independent and
neither one guarded against the other. §3 shows nothing constrains their product.

---

## 2. Every write path that moves a candidate between stages

Exhaustive over application code. Derived by grepping `currentStageId` / `current_stage_id` /
`CurrentStageId`, `stageMovement`, and `application.create|update|updateMany` across `packages`,
`apps`, `workers` and `services` (excluding `node_modules`, `.next` build output, and
`.claude/worktrees`), with the C# integration-fixture carve-out stated in §1.1.

**Seven** application-row writers exist in application code. **Six** are listed below (§2.1, §2.2,
§2.3, §2.4a, §2.4b, §2.6); the seventh, `pipeline.repository.ts:343-358` (`setChecklistItem`), writes
only `checklist_progress` and is not a transition.

The seven, in grep order:

| #   | Site                             | Section | Writes                                                 |
| --- | -------------------------------- | ------- | ------------------------------------------------------ |
| 1   | `seed-demo.ts:749`               | §2.6    | row insert (demo only)                                 |
| 2   | `routers/portal.ts:235`          | §2.4b   | row insert                                             |
| 3   | `candidate.repository.ts:551`    | §2.4a   | row insert                                             |
| 4   | `pipeline.repository.ts:169`     | §2.1    | `current_stage_id`                                     |
| 5   | `pipeline.repository.ts:199`     | §2.2    | `current_stage_id` (bulk `updateMany`)                 |
| 6   | `pipeline.repository.ts:210`     | §2.3    | `status`, `rejected_at`, `rejected_reason`, `feedback` |
| 7   | `pipeline.repository.ts:343-358` | —       | `checklist_progress` (raw SQL `UPDATE`)                |

> **Corrected 2026-08-10.** The first draft said "**Six** … in total. Five are listed below", under a
> heading that says "Exhaustive." Both numbers were wrong by one, in the same direction: the seed
> writer at `seed-demo.ts:749` is documented in §2.6 but was dropped from the tally, and rows 1–6 are
> six listed subsections, not five. Rows 1–6 are the Prisma-client calls the declared grep returns;
> row 7 is raw SQL and is found by the `current_stage_id` leg of the same grep, not the
> `application.create|update|updateMany` leg — which is how it came to be counted separately in the
> first place. Test scaffolding is excluded per the carve-out in §1.1 (`ReportingReadFixture.cs:259`,
> `AnchorProbeFixture.cs:245`).

### 2.1 `pipeline.moveCandidate` — the canonical transition

`routers/pipeline/movements.ts:22-31` → `services/pipeline.service.ts:81-107` →
`repositories/pipeline.repository.ts:146-175`.

- Authz: `permissionProcedure('pipeline','update')` (`movements.ts:22`) +
  `assertScoped('application', …)` (`movements.ts:29`).
- Guards in the service: application exists in org (`pipeline.service.ts:82-83`); target stage belongs
  to the application's vacancy (`:85-87`).
- Writes, atomically under `runTenantTransaction` (`pipeline.repository.ts:157`): one
  `stage_movements` row with `fromStageId`/`toStageId`/`movedBy`/`reason` (`:158-167`), then
  `applications.current_stage_id = toStageId` (`:169-173`).
- Returns `warnings` from the **soft** checklist gate (`pipeline.service.ts:89-93,106`).

### 2.2 `pipeline.bulkMove` — same write, weaker guards, no UI

`routers/pipeline/movements.ts:35-45` → `services/pipeline.service.ts:111-140` →
`repositories/pipeline.repository.ts:178-206`.

- Authz differs from 2.1: **no `assertScoped`**. Scope is enforced by composing
  `scopeWhereFor('application', …)` in the router (`movements.ts:43`) and count-checking it in the
  service (`pipeline.service.ts:120-123`) — a documented, equivalent pattern, not a gap.
- Extra guard: all applications must share one vacancy (`pipeline.service.ts:128-133`).
- Weaker than 2.1 in one respect: `findApplications` does **not select `status`**
  (`pipeline.repository.ts:113-118`), where `findApplication` does (`:106-111`). Neither caller reads
  it (§3), but the bulk path could not even if it wanted to.
- Bounded `.max(50)` (`movements.ts:37`), deduped (`:42`).
- **Zero frontend consumers.** `grep -rn bulkMove apps/web --include=*.ts --include=*.tsx` (excluding
  the `.next` build output) returns 0 hits. It is a live, permissioned, unused mutation.

### 2.3 `pipeline.rejectCandidate` — status-only, stage untouched

`routers/pipeline/movements.ts:47-56` → `services/pipeline.service.ts:143-149` →
`repositories/pipeline.repository.ts:209-220`.

Sets `status='rejected'`, `rejectedAt`, `rejectedReason`, `feedback`. It does **not** change
`currentStageId` and does **not** write a `stage_movements` row — so the rejection itself is invisible
in the movement history that `getMovementHistory` (`pipeline.repository.ts:223-229`) and the candidate
portal (`candidate-portal.repository.ts:144-147`) render.

This is the **only** guard in the domain that reads `status`: `pipeline.service.ts:145` rejects a
non-`active` application.

### 2.4 Application creation — two entry points, both bypassing the movement log

**(a) Staff-side.** `routers/candidate/timeline.ts:16-25` → `services/candidate.service.ts:199-215` →
`repositories/candidate.repository.ts:544-562`. The initial stage is
`findFirstStage` = lowest `order` (`candidate.repository.ts:536-542`), set at
`candidate.service.ts:212`. `createApplication` (`candidate.repository.ts:551-561`) writes the
`applications` row and nothing else.

**(b) Public apply form.** `routers/portal.ts:149` `applyToVacancy`, a `publicProcedure` (Turnstile-
gated, `portal.ts:14-29`). Stage resolution at `portal.ts:223-232`, create at `:235-244`. Also writes
no movement row. Also imports `db` directly (`portal.ts:4`), bypassing the service/repository layers.

Neither path is transactional with anything, because neither writes a second row.

### 2.5 `offer.convertToEmployee` — the hire, which does not close the application

`routers/offer/lifecycle.ts:20-168`. Inside one `runTenantTransaction` (`:92`) it creates the `User`
(`:94-108`), an `OnboardingPlan` with default tasks (`:114-131`), an optional `UserTeam` (`:136-142`),
sets `offers.status='converted'` (`:146-149`), and writes the hire-prediction snapshot (`:155-164`).

It never reads or writes `applications`. Detailed in §4, defect D1.

### 2.6 Seed

`packages/db/prisma/seed-demo.ts:749-762` creates applications with an arbitrary `stageIdx`
(`:754`) and an arbitrary `status` (`:756`) directly. Demo data only, but note it reproduces the same
gap: no `stage_movements` rows are seeded, so a seeded database exercises the empty-audit-trail path
on every read.

### 2.7 Stage-configuration writes that change the meaning of existing rows

Not transitions, but they mutate the state space under live applications and belong in any state
machine's threat model:

- `pipeline.updateStage` (`routers/pipeline/stages.ts:54-67` → `pipeline.repository.ts:268-281`) can
  change a stage's `order` or `name` with applications sitting in it. Reordering silently rewrites
  every historical funnel and "advance" affordance; renaming breaks any name-keyed logic (§5.1).
- `pipeline.deleteStage` (`stages.ts:69-74` → `pipeline-stages.service.ts:46-57`) refuses only when
  `_count.applications > 0` (`:49-54`) — i.e. when applications are _currently_ in it. History is not
  consulted. See defect D4.

### 2.8 Who reads the result

- **`stage_movements` — TS.** `pipeline.repository.ts:223-229` (history), `:365-379` and `:382-397`
  (`movements[0].movedAt` = entered-stage time for SLA), `:429-433` (funnel `everReachedCount`,
  `distinct: ['applicationId']`); `recruitment-analytics.repository.ts:115-119`, `:163-167`.
- **`stage_movements` — C#.** `Reporting/ReportingReadDbContext.cs:27,85-87` mapping;
  `Reporting/ReportingReadRepository.cs:166`, `:191` (`LastMovedAt`). Read-only.
- **Candidate portal.** `candidate-portal.repository.ts:135-150` returns `currentStage.name` plus the
  full descending movement list to `candidatePortal.applicationStatus`
  (`routers/candidate-portal.ts:39-43`).
- **AI.** `pipeline.getNextBestAction` (`routers/pipeline/analytics.ts:16-21` →
  `pipeline-analytics.service.ts:70-90`) feeds `currentStage.name`/`.order` to the
  `pipeline-optimizer` Bedrock agent. It is a **query**, pulled on demand — not a fan-out from a move.

Two ownership facts: `applications`, `pipeline_stages` and `stage_movements` are all
`efcoreReadOnly` (`docs/architecture/table-ownership.md:78,80,81`), i.e. Prisma owns the DDL and the
writes; C# only SELECTs.

### 2.9 What does NOT happen on a transition — correcting #30

#30 states: _"pipeline stage movements fan out into analytics, notifications, audit, AI agents, and
the candidate portal."_ Two of those five are false as descriptions of the _write_ path:

- **Notifications: none.** `packages/api/src/services/email.service.ts` has 6 methods
  (`:5,:22,:41,:54,:66,:79`), all interview- or offer-related; the only callers are
  `routers/offer/signing.ts:66,215,309` and `routers/interview/crud.ts:217,288,392`. There is no
  `notification.create` and no `sendEmail` anywhere in the pipeline call graph.
- **Audit: none.** `withAudit` (`trpc.ts:153-178`) is applied only by `auditedProcedure`
  (`trpc.ts:237`), and `grep -rn auditedProcedure packages apps` (`.ts`/`.tsx`, excluding
  `node_modules` and `.claude/worktrees`) returns **exactly one hit — its own
  definition**. Zero routers use it. `permissionProcedure` is
  `protectedProcedure.use(requirePermission(...))` (`trpc.ts:328-330`) with no audit middleware, so a
  stage move writes **no `audit_logs` row**. The `stage_movements` table is the entire audit trail for
  this domain — which is why the two gaps in §4 matter more than they look.

Analytics, the AI agent and the portal do read the result (§2.8) — but all three **pull**. Nothing is
pushed. That is a useful property for the port: there is no existing fan-out contract to preserve, so
the event-driven-vs-direct-call decision #103 asks for is a **greenfield** choice (§5.5), not a
migration of something live.

---

## 3. Headline finding — CONFIRMED: there is no legal-transition guard

**Claim under test (#103 comment): _"there is no legal-transition guard at all —
`pipeline.service.ts:82-108` only emits soft warnings. Any stage can move to any stage."_**

**Confirmed, and it is broader than stage-to-stage.**

`pipeline.service.ts:81-107` in full contains exactly three checks:

| Line     | Check                                   | Fails how                   |
| -------- | --------------------------------------- | --------------------------- |
| `:82-83` | application exists in this org          | `NOT_FOUND`                 |
| `:85-87` | `toStageId` belongs to the same vacancy | `BAD_REQUEST`               |
| `:89-93` | source stage's checklist complete?      | **never fails** — see below |

The third is explicitly non-blocking. `getIncompleteChecklistWarnings`
(`pipeline.service.ts:39-50`) returns labels; the service attaches them to the response at `:106` and
`:103-105`'s comment states the shape is deliberately static so tRPC infers one type. The comment at
`:76-80` states the intent outright: _"the move still proceeds … Never throws for this."_ Wired to the
UI as a warning toast, `apps/web/app/(admin)/recruitment/pipeline/page.tsx:83-84` (the first draft
cited `:101-105`, which is the logical complement — the `else if (!data.warnings || …)` branch that
fires the bare success toast when there is nothing to warn about).

What is therefore **not** checked, verified by reading the whole function:

1. **Order.** Nothing compares `stage.order` of source and target. `Oferta → Aplicado` is legal.
   `Aplicado → Contratado` in one hop is legal.
2. **Self-transition.** Nothing compares `toStageId` to `application.currentStageId`. Moving a card
   onto its own stage writes a `from == to` movement row (`pipeline.repository.ts:158-167`), which
   **resets the SLA clock** — `enteredStageAt` is `movements[0]?.movedAt ?? app.appliedAt`
   (`pipeline.service.ts:70`, `pipeline-analytics.service.ts:23,39`). A recruiter can clear an overdue
   flag by dragging a card onto its own column. The Kanban view blocks the gesture client-side
   (`kanban-board.tsx:32`), but the mutation does not, and `bulkMove` has no equivalent check at any
   layer.
3. **Status.** `moveCandidate` fetches `status` (`pipeline.repository.ts:109`) and **never reads it**.
   A `rejected` application can be moved through stages indefinitely. `bulkMove` cannot even see it
   (`:113-118`). Only `rejectCandidate` (`pipeline.service.ts:145`) consults `status`, and only to
   prevent double-rejection.
4. **Terminality.** No stage is marked terminal. `isDefault` (`pipeline.prisma:9`) marks a
   start-ish stage, is never read by any service in `packages/api/src/services/pipeline*.ts`, and has
   no `isFinal` counterpart.

**No guard exists in any other layer either.** The routers validate shape only
(`movements.ts:23-27`, `:36-40`); the repository has no conditional logic; the DB has one FK
(`prod-public-schema.sql:5651-5655`) and no `CHECK`.

The frontend partially compensates and thereby hides the gap: the list and table views each offer a
single forward affordance, while the Kanban board allows any drop except onto the same column
(`kanban-board.tsx:30-34`). Three views, three different implied rule sets, none of them enforced.

> **Corrected 2026-08-10.** The first draft said both views advance to `stages[stageIdx + 1]` and
> labelled both "Avanzar →". Neither half is right, and the difference matters:
>
> | View                      | Next stage computed as                                                            | Button label                  |
> | ------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
> | `pipeline-list-view.tsx`  | `stages[stageIdx + 1]` (`:89`), button `:128-135`                                 | `Avanzar →` (`:133`)          |
> | `pipeline-table-view.tsx` | `stageList.find(s => s.order === app.stageOrder + 1)` (`:181`), button `:223-227` | `→ {nextStage.name}` (`:225`) |
>
> The table view resolves the next stage by **`order` arithmetic**, not by array position. Those agree
> only when `order` values are contiguous and unique — which nothing enforces (§5.6 Q4). On a vacancy
> whose stages are ordered `0,1,3`, the list view's advance button still works and the table view's
> disappears. This is a second, independent argument for Q4 that the first draft missed by collapsing
> the two implementations into one citation.

---

## 4. Data-integrity defects

### D1 — `convertToEmployee` hires without closing the application (CONFIRMED)

`routers/offer/lifecycle.ts:92-167`. The transaction writes `users`, `onboarding_plans`,
`onboarding_tasks`, `user_teams`, `offers.status='converted'` and `hire_predictions`. It never
touches `applications`.

The link is available and already in scope: `offer.applicationId` is passed to the snapshot writer at
`lifecycle.ts:161`. Adding the application write would cost one statement inside the existing
transaction.

Verified consequences:

- The application stays `status='active'` (§1.2 — nothing writes `hired`) and stays in whatever stage
  it was in when the offer was signed. It remains on the Kanban board as a live candidate.
- It keeps counting as active everywhere: `pipeline.repository.ts:423` (funnel `currentCount`),
  `:367` and `:384` (SLA sets), `recruitment-analytics.repository.ts:75,158`,
  `Reporting/ReportingReadRepository.cs:67`.
- It keeps **accruing SLA overdue time forever**. `getOrgSlaOverdueCount`
  (`pipeline-analytics.service.ts:16-27`) compares elapsed time against the stage SLA (`:21-26`); the
  `status: 'active'` predicate that puts the row in that set is one layer down, in
  `getActiveApplicationsForOrgSla` (`pipeline.repository.ts:367`) — the same line cited two bullets
  above. Every hire permanently inflates the dashboard KPI strip.
- The candidate's own portal keeps showing the application as in-progress
  (`dashboard-applications.tsx:22`, since `hired` is unreachable).
- Reporting counts hires from `offers.status='accepted'` instead: C#
  `ReportingReadRepository.cs:74-75` (`_db.Offers.CountAsync(o => … o.Status == AcceptedStatus)`), TS
  equivalent `recruitment-analytics.repository.ts:47-49` (`countOffersAcceptedAllTime`, predicate at
  `:48`) — so the _reports_ are right and the _pipeline_ is wrong, which is exactly the shape of bug
  that survives a long time.

> **Corrected 2026-08-10.** The first draft cited `recruitment-analytics.repository.ts:100` as the TS
> hire count. That line is `take: 10_000`, a memory cap inside `hireSources` (`:93-102`) — a function
> that returns application _sources_, not a count, and so is not the equivalent of C#'s `totalHired` at
> all. The correct counterpart is `countOffersAcceptedAllTime` (`:47-49`), a different function this
> doc did not previously cite. The conclusion (reporting derives hires from `offers`, never from
> `applications`) is unchanged and now rests on a function that actually does that.

Note the asymmetry with rejection, which is handled (`pipeline.repository.ts:209-220`). The pipeline
has a loss terminal and no win terminal.

### D2 — applications are created with an empty audit trail (CONFIRMED)

Both creation paths (§2.4) write `applications.current_stage_id` and **no** `stage_movements` row:
`candidate.repository.ts:551-561` and `portal.ts:235-244`. `stage_movements.fromStageId` is nullable
precisely for this case (`pipeline.prisma:65`) and is never used.

Verified consequences:

- **`pipeline.getFunnel` undercounts its own first stage.** `everReachedCount` is
  `stage_movements.distinct(applicationId)` where `toStageId = stage.id`
  (`pipeline.repository.ts:429-433`). An application that has never moved contributes to no stage's
  `everReachedCount`. Since stage 0's `conversionRate` divides `everReached` by `totalApplications`
  (`pipeline-analytics.service.ts:101-105`), a brand-new vacancy where nobody has been moved yet
  reports **0% conversion into the stage every applicant is already in**, and every downstream stage's
  rate is computed off that zero.
  Scope note: this is the **per-vacancy** funnel. The org-wide reporting funnel groups on
  `currentStageId` instead (`recruitment-analytics.repository.ts:72-78`, C#
  `ReportingReadRepository.cs:66-70`) and is unaffected — two different funnels with two different
  definitions of "reached", which is itself worth resolving during the port.
- **The candidate sees an empty timeline.** `findApplicationDetail`
  (`candidate-portal.repository.ts:135-150`) returns `currentStage.name` plus `movements[]`. Until
  someone moves the card, the candidate is shown a current stage with no history explaining how they
  got there.
- **Time-in-stage silently falls back.** `movements[0]?.movedAt ?? app.appliedAt` appears at four
  sites, all verified by grep: `pipeline.service.ts:70` (board), `pipeline-analytics.service.ts:23`
  (org SLA count) and `:39` (per-vacancy SLA status), and
  `alert-evaluation.repository.ts:257` (SLA-breach alert rule). This masks D2 for SLA purposes —
  correct behaviour, but it means the missing row produces a _wrong number_ in one place and a
  _right number_ in another, so it will not show up as a consistent symptom.

  > **Corrected 2026-08-10.** The first draft cited `pipeline.repository.ts:70` for this expression,
  > three times (here, §3 item 2, and §6 Step 4). Lines `:68-70` of that file are a
  > `// ---` comment separator; the repository object opens at `:72`. The expression is in the
  > **service**, `pipeline.service.ts:70`. The substance survives — the fallback is real and is now
  > cited at four sites instead of three — but §6 Step 4's decision to ship D2's fix **without a
  > backfill** rested entirely on this evidence, and a reviewer opening the cited line would have found
  > a comment and been unable to check it.

- **`movedBy` is the obstacle to a clean fix.** `stage_movements.movedBy` is a required FK to `users`
  (`pipeline.prisma:67,74`; DB `ON DELETE RESTRICT`,
  `prod-public-schema.sql:6586`). The public apply flow has **no user** — `portal.applyToVacancy` is a
  `publicProcedure` (`portal.ts:149`). Any fix must either make `movedBy` nullable or mint a system
  actor. This is a schema decision, and it is the reason D2 is not a one-line fix. See §5.4.

### D3 — a vacancy with no stages fails two different ways (found while verifying §1.1)

`vacancy.create` seeds no stages (`routers/vacancy/crud.ts:244-332`). Applying to such a vacancy:

- staff path → a clean `BAD_REQUEST` with a Spanish message (`candidate.service.ts:201-206`);
- public path → `db.pipelineStage.findFirstOrThrow` (`portal.ts:227-232`), i.e. an unhandled Prisma
  `P2025` surfacing as a 500 on an **unauthenticated public endpoint**.

Same precondition, two behaviours, one of them a stack-trace-shaped error on the public apply form.

### D4 — `deleteStage` consults current occupancy but not history (found while verifying §2.7)

`pipeline-stages.service.ts:46-57` blocks deletion only when `_count.applications > 0`. A stage that
has no current occupants but appears in historical movements is deletable, and the DB then applies:

- `stage_movements.from_stage_id` → `ON DELETE SET NULL` (`prod-public-schema.sql:6579`) — history is
  silently rewritten, "moved from Screening" becomes "moved from ∅";
- `stage_movements.to_stage_id` → `ON DELETE RESTRICT` (`prod-public-schema.sql:6593`) — so the
  delete actually _fails_, with a raw Prisma FK error rather than the friendly guard at `:50-54`,
  because `pipeline.repository.ts:290-292` has no error handling.

The Prisma schema (`pipeline.prisma:72-73`) declares no explicit `onDelete`, so these are Prisma's
implicit defaults (SetNull for the optional relation, Restrict for the required one) — they match the
live DB, but they were never a decision. Contrast `.claude/rules/db.md`: _"Cascades: explicit
`onDelete:` on every `@relation`."_

Also note `stage_movements.application_id` is `ON DELETE CASCADE`
(`prod-public-schema.sql:6572`): hard-deleting an application destroys its audit trail. No code
hard-deletes applications today (§2 lists no delete), so this is latent, not live.

---

## 5. Proposed state machine

Design target: **one transition kernel, two stacks, one truth.** Everything below is a proposal for
review, not a decided architecture.

### 5.1 Stages stay data; the state machine keys on `order` and role, never on `name`

Given §1.1 — stages are tenant-authored rows with editable names — a hardcoded stage graph is not
possible without a migration that would break every existing tenant. The proposal is a **stage-role
overlay** on the existing rows:

| Concept            | Where it comes from                                                  |
| ------------------ | -------------------------------------------------------------------- |
| Position           | `pipeline_stages.order` (exists, `pipeline.prisma:6`)                |
| Entry stage        | `isDefault` (exists, `pipeline.prisma:9`, currently read by nothing) |
| Terminal-win stage | **new** `isTerminalWin` — does not exist today                       |
| Lifecycle state    | `applications.status`, promoted to a Prisma enum                     |

The transition kernel then operates on `(fromOrder, toOrder, status, stageRole)` — all
tenant-agnostic — and never sees a stage name. The three places that key on a name today are
inventoried in §1.1; only the first of them (`page.tsx:94` → `pipeline-next-actions.ts`) is behaviour,
and it is a display-layer nudge that already degrades to `null` on an unmatched name, so it does not
block the kernel — it is simply the live proof that the hazard is not hypothetical.

### 5.2 Proposed legal transitions

**Status axis** (`applications.status`, proposed enum `ACTIVE | REJECTED | HIRED | WITHDRAWN`):

```
ACTIVE ─→ REJECTED    (pipeline.rejectCandidate — exists today)
ACTIVE ─→ HIRED       (offer.convertToEmployee — MISSING today, defect D1)
ACTIVE ─→ WITHDRAWN   (no writer exists today; the FE already renders it — §1.2)
REJECTED ─→ ACTIVE    (reinstatement; needs an explicit decision, see §5.6 Q3)
HIRED ─→ *            forbidden (terminal)
```

**Stage axis**, legal only while `status = ACTIVE`:

```
∅            ─→ entry stage           (application created; MUST write a movement — D2)
order = n    ─→ order = n+1           forward one step        — always legal
order = n    ─→ order > n+1           forward skip            — legal, WARN + require reason
order = n    ─→ order < n             backward                — legal, require reason
order = n    ─→ order = n             self                    — REJECT (currently allowed, §3.2)
any          ─→ any                   while status ≠ ACTIVE   — REJECT (currently allowed, §3.3)
```

Rationale for keeping skips and backward moves legal: recruiting genuinely does both, and today they
are unrestricted, so forbidding them is a behaviour change that would break live tenants. Making them
_require a reason_ converts an invisible action into an auditable one at zero migration cost — `reason`
already exists on the wire (`movements.ts:26`) and on the row (`pipeline.prisma:68`), it is simply
optional.

#### Side effects — what each transition WRITES

_Added 2026-08-10._ #103's AC#2 asks for "states, legal transitions, guards, **and side effects**".
The first draft delivered the first three and treated §5.5's fan-out discussion as the fourth; fan-out
is notification, not a write contract, so the port had nothing to implement against. Every row below
is the observed behaviour at the cited lines, followed by what the proposal changes.

| Transition                        | Entry point                      | Writes TODAY                                                                                                                                                                                                                         | Atomic?                                                       | Proposal adds                                                                                                 |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `∅ → entry stage` (staff)         | `candidate.service.ts:199-215`   | 1 `applications` row (`candidate.repository.ts:551-561`), `current_stage_id` = lowest `order` (`:536-542`)                                                                                                                           | single write, so trivially                                    | + 1 `stage_movements` row, `from_stage_id = NULL` (D2), in one tx                                             |
| `∅ → entry stage` (public)        | `portal.ts:223-244`              | 1 `applications` row (`:235-244`); then, if `cvFileKey` is in this org's prefix, a `candidate_documents` row + CV parse (`portal.ts:255-262` → `portal-application.service.ts:45,53-54`), non-fatal on failure (`:59-68`)            | no — CV ingest is outside any tx and deliberately best-effort | + 1 `stage_movements` row (D2), which needs a `movedBy` decision (Q2)                                         |
| `stage n → stage m` (single)      | `pipeline.service.ts:81-107`     | 1 `stage_movements` row (`pipeline.repository.ts:158-167`) + `applications.current_stage_id` (`:169-173`)                                                                                                                            | yes — `runTenantTransaction` (`:157`)                         | nothing new; guards only                                                                                      |
| `stage n → stage m` (bulk, ≤50)   | `pipeline.service.ts:111-140`    | N `stage_movements` rows (`pipeline.repository.ts:188-197`) + N `current_stage_id` via `updateMany` (`:199-202`)                                                                                                                     | yes — `runTenantTransaction` (`:187`)                         | nothing new; guards only                                                                                      |
| `ACTIVE → REJECTED`               | `pipeline.service.ts:143-149`    | `applications.status='rejected'`, `rejected_at`, `rejected_reason`, `feedback` (`pipeline.repository.ts:209-220`). **No movement row. No stage change.**                                                                             | single write                                                  | + a movement row, so rejection appears in the timeline it currently skips                                     |
| `ACTIVE → HIRED`                  | `offer/lifecycle.ts:20-168`      | `users` (`:94-108`), `onboarding_plans` + default `onboarding_tasks` (`:114-131`), optional `user_teams` (`:136-142`), `offers.status='converted'` (`:146-149`), `hire_predictions` (`:155-164`). **Nothing on `applications`** (D1) | yes — `runTenantTransaction` (`:92`)                          | + `applications.status='hired'` and, if Q1 says yes, a terminal stage move + movement row, inside the same tx |
| `ACTIVE → WITHDRAWN`              | —                                | no writer exists (§1.2)                                                                                                                                                                                                              | n/a                                                           | whole transition is new                                                                                       |
| checklist tick (not a transition) | `pipeline.repository.ts:343-358` | `applications.checklist_progress` only                                                                                                                                                                                               | single statement                                              | unchanged; feeds guard 2's soft warning                                                                       |

Three write-contract facts fall out of the table and belong in the C# port's spec:

1. **No transition writes an `audit_logs` row, on either stack** (§2.9), so `stage_movements` is the
   entire trail — and of the six transitions that exist today, **four write no `stage_movements` row
   at all**: both entry paths, rejection, and the hire. Only the single and bulk stage moves do.
2. **`ACTIVE → HIRED` is the only transition that writes outside the pipeline's own tables**, and it
   writes six of them. If the kernel is to own the transition, D1's fix must stay inside
   `offer/lifecycle.ts`'s existing transaction rather than becoming a second call.
3. **The public entry path is the only one with a non-transactional side effect** (CV ingest). That is
   deliberate and documented; the port must not "fix" it into the transaction, or a flaky S3 fetch
   starts rolling back applications.

### 5.3 Guards, and which are new

| #   | Guard                                             | Today                                       | Proposed  |
| --- | ------------------------------------------------- | ------------------------------------------- | --------- |
| 1   | target stage belongs to the application's vacancy | enforced, `pipeline.service.ts:85-87`       | keep      |
| 2   | source-stage checklist complete                   | soft warn, `pipeline.service.ts:89-93`      | keep soft |
| 3   | `status = ACTIVE`                                 | **absent**                                  | hard fail |
| 4   | `toStageId ≠ currentStageId`                      | **absent** (FE-only, `kanban-board.tsx:32`) | hard fail |
| 5   | backward / skip requires a non-empty `reason`     | **absent**                                  | hard fail |
| 6   | no transition out of a terminal status            | **absent**                                  | hard fail |
| 7   | entry into the pipeline writes a movement row     | **absent** (D2)                             | invariant |

Guards 3, 4 and 6 are strictly narrowing and can ship independently of the port. Guard 5 is a UX
change and needs product sign-off.

### 5.4 Where the guard lives — the cross-stack contract

Follow the established golden-fixture pattern — `contracts/` holds **20** `*-fixtures` directories
today (plus `contracts/openapi/`), so this is the house pattern, not a new one. Verified end-to-end
against the reporting slice:

1. **A pure kernel in `packages/shared`** — sibling of `packages/shared/src/reporting.ts`,
   `compensation.ts`, `dei.ts`, `engagement.ts`, `ninebox.ts`, `succession.ts`, `team-intel.ts`.
   Signature shape: `evaluateTransition(input) → { allowed, code, warnings }`. Pure: no `db`, no
   `TRPCError`, no clock, no I/O.
2. **A mirror kernel in `Tims.Domain`** — sibling of `Tims.Domain.Reporting`.
3. **A golden fixture at `contracts/pipeline-fixtures/transition-kernel.json`**, asserted by both
   sides from the one file. The mechanism is already wired: the TS side reads it directly
   (`tests/reporting/funnel-view-fixtures.test.ts:20`) and the C# side links `contracts/*` into the
   test assembly (`tests/Tims.UnitTests/Tims.UnitTests.csproj:67-68`) and reads it from
   `AppContext.BaseDirectory` (`Fixtures/KpiViewFixtureTests.cs:21`). A `pipeline-fixtures` glob needs
   one more `<Content Include>` entry in that `.csproj`.
4. **The DB stays the last line, not the only one.** `applications.status` becomes a Prisma enum
   (`.claude/rules/db.md` § Schema Conventions), which makes `hired`/`withdrawn` representable and
   makes typos unrepresentable. Order/status _combinations_ stay in the kernel — a `CHECK` constraint
   cannot see the stage row.

Callers of the kernel, all of which must go through it once it exists: `pipeline.service.ts` (2.1,
2.2), `candidate.service.ts` (2.4a), `portal.ts` (2.4b, which needs a service+repository first — §0.2),
`offer/lifecycle.ts` (2.5).

Fixture cases the kernel must pin, at minimum, one per row of §5.2 plus: same-stage rejection;
transition attempted on a `REJECTED` row; forward-skip with and without a reason; entry with a null
`fromStageId`; and a stage whose `order` ties another stage's `order` (nothing prevents duplicate
`order` values today — `stages.ts:42` validates only `min(0)`).

### 5.5 Fan-out — recommendation: keep it pull-based

#103 asks for an event-driven vs direct-call decision. §2.9 establishes that **there is nothing to
migrate**: no notification, no audit write, and no push of any kind happens on a transition today.
Analytics, the AI agent and the portal all read on demand.

Recommendation: **do not introduce a message bus as part of this port.** Preserve pull. Introduce the
`stage_movements` row as the single append-only event record it already is, and if a future feature
needs push (candidate stage-change emails are the obvious one), add it then, as its own issue, with
the coexistence rule satisfied by the owning stack writing its own table.

The one thing the port **must** add is the missing audit coverage — §2.9 shows `permissionProcedure`
carries no audit middleware, so a stage transition currently produces no `audit_logs` row on either
stack. That is a compliance question, not a design preference, and it should be raised separately
rather than absorbed silently here.

### 5.6 Open questions requiring a human decision

- **Q1.** Should `convertToEmployee` set `status = HIRED` **and** move the application to a terminal
  stage, or only set the status? Setting only the status leaves the card sitting in "Oferta" on the
  board with a `HIRED` badge. Moving it requires knowing which stage is terminal, which requires
  `isTerminalWin` (§5.1), which requires a per-tenant backfill.
- **Q2.** What `movedBy` does the public apply flow use (D2)? Nullable column, or a seeded system
  user per org? Nullable is a smaller migration; a system user keeps the FK honest and every
  `stage_movements` row attributable.
- **Q3.** Is `REJECTED → ACTIVE` reinstatement a supported operation? `pipeline.service.ts:145`
  currently forbids re-rejecting but nothing un-rejects, and `rejectedAt`/`rejectedReason` have no
  clearing path.
- **Q4.** Should stage `order` be made unique per vacancy? Nothing enforces it today
  (`pipeline.prisma:1-21` has no `@@unique([vacancyId, order])`), and ties make "forward one step"
  ambiguous.

---

## 6. Migration path that does not break existing rows

Ordered so that each step is independently shippable and independently revertable. No step requires a
backfill that can fail on live data.

**Step 1 — narrowing guards only, no schema change.** Add guards 3, 4 and 6 (§5.3) in
`pipeline.service.ts`. These reject inputs that are currently accepted; they cannot corrupt existing
rows because they only ever refuse a _new_ write. Risk: a client that today relies on same-stage moves
starts getting `BAD_REQUEST` — verified as low, since `kanban-board.tsx:32` already suppresses the
gesture and `bulkMove` has zero FE callers (§2.2). The remaining FE surface to check is the
`moveCandidate` `onSuccess` handler at `page.tsx:77-106`: it fires two independent toasts and calls
`getNextActionForStage(destinationStage.name)` (`:94`, §1.1). A guard that turns a move into a
`BAD_REQUEST` short-circuits to the `onError` handler at `:73-76` — which rolls the optimistic move
back from the query cache (`:74`) and shows the server message — and never reaches either toast, so
the narrowing is safe there too — but that path was not covered by the first draft's "verified as low"
and is now.

**Step 2 — extract the kernel, behaviour-identical.** Move the Step-1 predicates into
`packages/shared`, add the golden fixture, add the C# mirror. Pure refactor on the TS side; the fixture
is the proof. No production behaviour change.

**Step 3 — close D1.** One statement in the existing `runTenantTransaction` at
`offer/lifecycle.ts:92`, writing the application's terminal state. Forward-only: existing already-
converted offers stay as they are. A separate, reversible backfill script can then reconcile
historical rows by joining `offers.status='converted'` → `offers.application_id`; it should be
reviewed and run once, not embedded in the deploy.

**Step 4 — close D2, additively.** Resolve Q2, then write the entry movement row in both creation
paths inside a transaction with the application insert. **Do not backfill.** Every reader already
tolerates a missing movement via `movements[0]?.movedAt ?? app.appliedAt` — all four sites:
`pipeline.service.ts:70`, `pipeline-analytics.service.ts:23,39`, `alert-evaluation.repository.ts:257`
(corrected from `pipeline.repository.ts:70`, a comment separator — see the note in §D2) — so
historical rows keep working untouched. The funnel undercount (§D2) heals forward for new
applications; whether to synthesize historical entry rows from `applications.applied_at` is a
separate, optional, reviewable script.

**Step 5 — `status` becomes a Prisma enum.** Only safe after Step 3, because the enum must contain
`HIRED`/`WITHDRAWN` and the column must contain no value outside the enum. Verify against prod first:
`SELECT DISTINCT status FROM applications` — expected `{active, rejected}` per §1.2, but **verify, do
not assume**; nothing has ever constrained this column. Per `.claude/rules/db.md` § Migration
Discipline, this lands as reviewed SQL applied via psql, with `packages/db/baseline/prod-public-schema.sql`
re-captured in the same PR and `/gate` check 16 passing.

**Step 6 — `isTerminalWin` (Q1), if Q1 says yes.** Nullable/defaulted boolean, backfilled per tenant
by an operator, not by a script guessing at stage names.

**Step 7 — the C# port (#88)** then implements against a specified machine instead of a described one.

Ordering constraint worth stating plainly: Steps 1–4 are **TS-only and unblocked today**. None of them
requires #88, and #88 does not require them. They can proceed in parallel with any other Phase-5 work.

---

## 7. Scope: what is deliberately NOT in this spike

#103's acceptance criteria include _"Golden-fixture the transition kernel across both stacks before
any endpoint work."_ **That is L-sized code work and does not belong under a `type:spike` label.** It
means: a new `packages/shared` kernel, a new `Tims.Domain` assembly, a new `contracts/pipeline-fixtures/`
directory, a new `<Content Include>` in `tests/Tims.UnitTests/Tims.UnitTests.csproj:67-68`, vitest
coverage on one side and xUnit on the other, and refactoring four call sites (§5.4) onto it. It should
be filed as its own issue, blocked on this doc, and sized alongside #88.

This doc also does **not** cover:

- the six pipeline-stage-configuration procedures (`routers/pipeline/stages.ts`) beyond §2.7's
  observation that they mutate the state space;
- `pipeline.getNextBestAction`'s Bedrock agent (#43 notes its live smoke test was never run);
- the three analytics reads (`routers/pipeline/analytics.ts:8,16,23`), except where they consume
  movement rows;
- the `portal.ts` layering violation (§0.2), which needs its own fix regardless of this design.

### 7.1 Deviations from #103's acceptance criteria, stated rather than left implicit

_Added 2026-08-10._ Four of #103's requirements are not met as written. A deviation that is argued is
a decision; a deviation that is silent is a defect, and all four were silent in the first draft.

| #103 requirement                                                                            | Status here                                                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| AC#1: write `docs/architecture/csharp-migration/phase-5-slice-20-pipeline-state-machine.md` | **Not met — this file should be renamed.** See below.                                                     |
| AC#2: states, transitions, guards **and side effects**                                      | Met as of 2026-08-10; the side-effect contract is the table in §5.2. It was missing from the first draft. |
| AC#5: golden-fixture the kernel across both stacks                                          | **Deliberately declined** (§7 above) and **not yet tracked** — no follow-up issue exists.                 |
| Verification block: two `tsc` runs, `npx vitest run`, `dotnet test`, gitleaks, tier record  | N/A for a text-only change, except the tier record, which is a PR-body requirement — see below.           |

**AC#1 — the filename.** #103 names an exact path and this doc does not use it. Of the 44 files in
`docs/architecture/csharp-migration/`, 32 are `phase-*` (21 of them `phase-5-slice-*`) and 12 use a
topic name or a runbook name instead, so the convention is dominant but not universal — which is
presumably how the deviation went unnoticed. It is not defensible here:
#103's AC names the file explicitly, `slice-18` is the highest number in use so `slice-20` is free, and
nothing in the repo links to the current name (`grep -rn candidate-pipeline-state-machine` over `*.md`,
`*.ts`, `*.tsx`, `*.json` returns only this file). **It should be renamed to
`phase-5-slice-20-pipeline-state-machine.md` before this lands** — a single `git mv`, with the
`docs/REMAINING-WORK.md:534` row (§8) pointed at the new path in the same commit. It is left unrenamed
in this editing pass only because the pass was scoped to the file's contents.

**AC#5 — declined here, and now filed as #196.** §7 argues the golden-fixture work out of scope for a
`type:spike`: it is L-sized code, not design. It is tracked as **#196** ("Golden-fixture the pipeline
transition kernel across both stacks"), so the criterion has an owner rather than sitting deferred
inside this document.

> **Corrected 2026-08-10.** This paragraph previously said no such issue existed and cited
> `gh issue list --state open` as matching "only #103 and #88" on `pipeline|kernel|transition|fixture`.
> Re-run against open issue TITLES, that pattern returns **three**: #88, #103 and **#122** (which matches
> on _fixture_ — it is C# test-fixture drift, not a golden-fixture kernel harness). The conclusion held,
> but the command was not reproducible as written, which is the defect class this section exists to close.

**Verification tier.** `.claude/rules/verification.md` requires the PR body to carry a
`## Verification` section naming **which tier actually ran**, or CI's `verification-gate` job fails the
PR; and it requires that a tier-2/tier-3 fallback is not described as "cross-model". Nothing in this
doc records that, and a text-only doc does not exempt the PR from it.

**Baseline reconciliation.** #103's Verification block pins the suite at "282 files / 2615 tests green
at `eaac76eb`". That is stale by a wide margin: the current anchor is **3046 passing across 310 files**
(`.claude/commands/gate.md:48`, as of 2026-08-10) — **431 tests and 28 files** above #103's figure.
Anyone re-running #103's checklist against its own stated baseline risks "correcting" the anchor
downward, which is the same defect class as a gate that cannot fail. Use the gate's number, not the
issue's.

## 8. Claims in the source material this doc contradicts

| Source                                                                                   | This doc                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| #103: transition logic is "spread across `pipeline/movements.ts`, `pipeline/stages.ts`"  | §0.1 — those two files are the centralized part; the scatter is elsewhere                  |
| #103: "Should precede #88"                                                               | §0.3 — no code dependency in either direction                                              |
| #88 Hazards: implies #103's subject is contained by the `pipeline/*` port                | §0.3 — it spans #84, #87, #88 and #91                                                      |
| #30: movements "fan out into analytics, notifications, audit, AI agents, and the portal" | §2.9 — notifications and audit do not exist; the other three pull, nothing is pushed       |
| `docs/REMAINING-WORK.md:534` (at `013a86bd`): "No sub-plan exists yet."                  | true when written; this doc is that sub-plan and that row should be updated in the same PR |
| #103 Verification: "baseline is 282 files / 2615 tests green at `eaac76eb`"              | §7.1 — stale; the anchor is 3046 tests / 310 files (`.claude/commands/gate.md:48`)         |
| #103 AC#1: write `phase-5-slice-20-pipeline-state-machine.md`                            | §7.1 — this file uses a topic name and should be renamed before it lands                   |
| `.claude/rules/db.md` § Schema Conventions: "Prisma enums for all status/type fields"    | §1.2 — `applications.status` is a bare `String` (`pipeline.prisma:30`)                     |
| `.claude/rules/db.md`: "explicit `onDelete:` on every `@relation`"                       | §D4 — `pipeline.prisma:72-73` rely on implicit defaults                                    |
| `.claude/rules/api-security.md` § Service Layer: routers import no Prisma                | §0.2 — `portal.ts:4,235` imports and calls `db` directly                                   |
