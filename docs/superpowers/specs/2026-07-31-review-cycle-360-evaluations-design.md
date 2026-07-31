# 360° Evaluations ("Review Cycle") Design

> Status: APPROVED (Federico, 2026-07-31, conversational approval — see brainstorming
> session). Builds on `docs/plans/2026-06-17-360-evaluations-greenfield.md` (superseded by
> this doc for implementation purposes; kept for its original rationale).

## Context

360° evaluations (a structured multi-rater review cycle) are fully greenfield in TIMS — no
model, router, or service exists (`grep 360|multiRater|reviewCycle` → no domain hits before
this work). This was identified as the next highest-leverage AI-doable item on the platform
roadmap: Assessment Player (slices 2-4) and candidate CV upload have both shipped, and the
three remaining C# migration blockers (compensation FX-read, external-vendor write re-test,
Stripe live-key cutover) are all Federico-only and unresolved as of this session.

Note: the existing `evaluation360` permission module (`packages/shared/src/types/permissions.ts`)
and its C# migration domain are an **unrelated** feature (continuous peer feedback
read/write, already flipped and TS-deleted). This work introduces a separate module,
`review_cycle`, to avoid colliding with that name.

Existing primitives this builds near but does not reuse wholesale:

- `Feedback` (`packages/db/prisma/schema/performance.prisma`) — single-rater row, conceptual
  ancestor of a 360 response, but lacks cycle binding, rater relationship, and competency
  structure.
- `packages/api/src/access/aggregate.ts` — the existing min-5 k-anonymity suppression helper
  (`suppressBelowMin5`, `aggregateGroups`), used today by engagement/DEI/compensation. Reused
  directly for the published 360 report.
- `packages/api/src/access/entity-policies.ts` — the per-entity scope registry
  (`scopeWhereFor`), registers `raterAssignment` as a new `ScopedEntity`.

## Decisions from brainstorming

1. **Manager/self rater handling is configurable per cycle.** The draft's blanket "min-5
   suppress everything" rule breaks down for MANAGER and SELF relationships, which are
   always N=1 per subject — literally suppressed forever under a uniform rule. hr_admin sets
   a per-cycle flag (`showManagerSelfIndividually`): when true, manager/self ratings are
   shown individually (unaggregated, since a subject already knows who their manager is and
   self-ratings are always safe to show back); when false, they're folded into the same
   anonymized pool as PEER/REPORT and suppressed alongside them. PEER and REPORT groups are
   never shown individually — they always go through min-5 suppression regardless of the
   flag.
2. **Full milestone now**, sliced like Assessment Player (schema/RBAC → admin CRUD → rater
   flow → aggregation/publish → UI polish → dedicated anonymity review) — not trimmed to a
   partial first slice. Matches the "architecturally complete, not minimal" bar from the
   original draft.
3. **Competencies are org-defined per cycle**, not sourced from the (nonexistent) LIA
   taxonomy. hr_admin defines a named competency list when creating a cycle. No dependency
   on the unbuilt LIA band/norm work.
4. **hr_admin picks specific subjects per cycle** — a cycle targets an explicit employee
   list (e.g. "Q3 leadership review"), not the whole org automatically.
5. **hr_admin assigns all raters manually** — no subject self-nomination workflow in v1.
6. **No minimum-responses-per-subject publish gate.** hr_admin can publish any subject's
   report at any time; the existing min-5 suppression on each competency/relationship group
   already hides anything too small to be safe.
7. **1-5 numeric rating scale** per competency, optional bounded (`.max(1000)`) free-text
   comment. Matches the scale convention already used by engagement/compensation/DEI.
8. **Leader "team completion %" read is dropped from v1** (YAGNI) — the original draft
   called it optional. Can be added as a fast-follow if requested later.
9. **Publish is per-subject, not per-cycle** — a deliberate structural change from the
   original draft (which put `PUBLISHED` on `ReviewCycle.status`). Different subjects in the
   same cycle publish at different times as hr_admin reviews each one, so publish state lives
   on a new `CycleSubject` join model instead of overloading cycle-wide status.

## Schema (new file `packages/db/prisma/schema/review-cycle.prisma`)

All models: `id (uuid)`, `organizationId` with `@@index`, explicit `onDelete` cascades,
Prisma enums for status/relationship fields (per `db.md`).

- **`ReviewCycle`**: `id, organizationId, name, status (DRAFT|OPEN|CLOSED),
showManagerSelfIndividually (Boolean, default true), createdById, opensAt?, closesAt?,
createdAt, updatedAt`.
- **`Competency`**: `id, organizationId, cycleId, key, label, sortOrder`. Org/cycle-scoped
  list hr_admin defines at cycle creation. `@@unique([cycleId, key])`.
- **`CycleSubject`**: `id, organizationId, cycleId, subjectUserId, publishedAt (DateTime?),
createdAt`. Which employees are included in a cycle + their individual publish state.
  `@@unique([cycleId, subjectUserId])`.
- **`RaterAssignment`**: `id, organizationId, cycleId, subjectUserId, raterUserId,
relationship (SELF|PEER|MANAGER|REPORT), status (PENDING|SUBMITTED), submittedAt?,
createdAt`. `@@unique([cycleId, subjectUserId, raterUserId])`, `@@index([raterUserId])`,
  `@@index([subjectUserId])`.
- **`RaterResponse`**: `id, organizationId, assignmentId, competencyId, rating (Int, 1-5),
comment (String?, bounded)`. `@@unique([assignmentId, competencyId])`,
  `@@index([assignmentId])`.

Migration via `prisma db execute --file=<sql>` against prod (prod is not
prisma-migrate-managed — see `[[tims-build-roadmap]]` / existing migration discipline docs).

## RBAC

New module `review_cycle` added to `MODULES` (`packages/shared/src/types/permissions.ts`),
distinct from the existing unrelated `evaluation360` module. `ACTIONS` already includes
`publish` — no new action needed.

Grants: `hr_admin`/`super_admin` → `create/read/update/publish/delete@organization`.

Register `raterAssignment` as a new `ScopedEntity` in `entity-policies.ts`: own-scope
anchored on `raterUserId` via simple equality (`{ raterUserId: userId }`) — simpler than the
existing OR-based patterns (feedback, coachingSession) since a rater assignment has exactly
one rater. Powers `myRaterTasks`.

The subject's own report (`myReport`) is a bespoke procedure, not a `scopeWhereFor`-gated
list query — it looks up `CycleSubject` by `subjectUserId = ctx.user.id` and requires
`publishedAt` to be set, mirroring how other "my X" reads work elsewhere in the codebase.

## Routers/services (`packages/api/src/routers/review-cycle.ts` + service + repository)

Split three ways, same clean-architecture flow (router → service → repository) as every
other domain:

- **Admin** (`permissionProcedure('review_cycle', ...)`, org-scoped): `createCycle`
  (name + competency list + `showManagerSelfIndividually`), `updateCycle` (while DRAFT),
  `openCycle`, `closeCycle`, `addSubjects(cycleId, subjectUserIds[])`,
  `assignRaters(cycleId, subjectUserId, raters[])`, `listCycleProgress(cycleId)`
  (completion % per subject), `publishSubject(cycleId, subjectUserId)`.
- **Rater-facing**: `myRaterTasks` (`protectedProcedure`, `scopeWhereFor('raterAssignment',
...)`, status = PENDING), `submitRatings(assignmentId, responses[])` — verifies the
  assignment belongs to `ctx.user.id`, wraps the multi-row `RaterResponse` insert + status
  update in `$transaction`.
- **Subject-facing**: `myReport(cycleId)` — requires `CycleSubject.publishedAt` set;
  aggregates `RaterResponse` grouped by relationship + competency; applies the
  `showManagerSelfIndividually` branch (manager/self shown as their own labeled row when
  true, folded into the anonymized pool when false); PEER/REPORT groups always go through
  `suppressBelowMin5`/`aggregateGroups` from the existing `packages/api/src/access/aggregate.ts`
  — never expose a single peer's raw rating, and never disclose a total N alongside a
  suppressed group (per that helper's documented caller responsibility).

## UI surfaces

- **`apps/web/app/(admin)/review-cycles/`** — hr_admin: cycle list, cycle detail (competency
  config, subject list, rater-assignment matrix, per-subject completion %, publish button
  per subject).
- **Employee "My 360"** — new participant section: pending rater tasks + rating form
  (1-5 scale + optional comment per competency) + (once published) my report view.
- All i18n es/en; Loading/Error/Empty states per `frontend.md`.

## Sequencing (6 slices, same cadence as Assessment Player)

1. Schema + migration + RBAC module (`review_cycle`) + grant seed +
   `raterAssignment` entity-policy registration.
2. Admin cycle CRUD + competency config + subject selection + rater assignment (backend +
   minimal admin UI).
3. Rater task list + submission flow (backend + rater UI, `$transaction`-wrapped writes).
4. Aggregation + publish + subject report endpoint — the `showManagerSelfIndividually`
   branch and min-5 suppression logic — plus the admin progress/publish UI.
5. Participant "My 360" UI polish + admin monitor dashboard UI.
6. **Dedicated adversarial review of the anonymity invariant** — a naive aggregation leaks
   individual peer ratings; mirror the Wave 2.5 codex review rounds. Highest-risk slice,
   reviewed on its own rather than folded into slice 4's regular review pass.

## Testing

- Repository/service unit tests per domain convention (vitest).
- A pinned-fixture test suite for the aggregation/suppression logic specifically (mirrors
  `access-review-kernel`'s pattern of being kept as a contract spec) — this is the part most
  likely to have a subtle k-anonymity bug, so it needs golden fixtures covering: a group of
  exactly 4 (suppressed), exactly 5 (shown), a suppressed group where the total-N guard must
  also suppress the total, and both `showManagerSelfIndividually` branches.
- Full `pnpm --filter @tims/api exec tsc --noEmit`, web `tsc --noEmit`, and `npx vitest run`
  gates before merge, per every prior domain in this codebase.
