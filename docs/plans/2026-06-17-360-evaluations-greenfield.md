# 360° Evaluations (Fase 7) — greenfield scoping + recommendation

**Status: NOT built this session — recommended as its own milestone.** Unlike the other
Slice 5+ items (which had backends to surface), 360 is fully greenfield: no model, router,
or service exists (`grep 360|multiRater|peerReview` → no domain hits). Half-building it
(e.g. a stub UI or a single table) would violate the "architecturally complete, not minimal"
bar and leave a misleading partial feature. This doc is the blueprint to execute later.

## Why it's a milestone, not a slice
A real 360 needs a **cycle → rater-set → per-rater response → aggregation → publish** pipeline
with three distinct actor experiences (admin runs cycles; raters complete assignments;
subjects read their published report) and new RBAC. That's schema migration + 3–4 routers +
services + 3 UI surfaces + i18n + a new permission module + grant re-seed. ~5–6 vertical slices.

## Existing primitives to build on (not reuse wholesale)
- `Feedback` (`performance.prisma:92`): `fromUserId/toUserId/type/message/isAnonymous` — a
  single-rater row. It's the conceptual ancestor of a 360 *response* but lacks cycle binding,
  rater relationship, competency structure, and rating scale. Use as a shape reference, not the table.
- `Recognition` (`performance.prisma:111`) — same org-wide peer pattern; not applicable.
- Own-scope house pattern: `scopeWhereFor(entity, ctx.access, ctx.user.id)` AND-composed for
  registered entities; new entities must be added to the `ScopedEntity` union + `ENTITIES` set +
  switch in `packages/api/src/access/entity-policies.ts` with their anchor column.

## Proposed schema (new file `packages/db/prisma/schema/evaluation360.prisma`)
- **`ReviewCycle`**: `id, organizationId, name, status (DRAFT|OPEN|CLOSED|PUBLISHED), opensAt,
  closesAt, createdById`. Org-scoped. `@@index([organizationId])`.
- **`RaterAssignment`**: `id, organizationId, cycleId, subjectUserId, raterUserId,
  relationship (SELF|PEER|MANAGER|REPORT), status (PENDING|SUBMITTED), submittedAt`.
  `@@unique([cycleId, subjectUserId, raterUserId])`, `@@index([raterUserId])`,
  `@@index([subjectUserId])`. This is the anchor for both rater-scope and subject-scope.
- **`RaterResponse`**: `id, organizationId, assignmentId, competencyKey, rating (Int),
  comment (String?)`. `@@index([assignmentId])`. (Competencies from a config/enum, reusing the
  LIA competency taxonomy if one exists.)
- Prisma enums for every status/relationship field (db.md). Explicit `onDelete` cascades.
- Migration via `prisma db execute --file=<sql>` against prod (prod is NOT migrate-managed — see
  [[tims-build-roadmap]]).

## RBAC (new module)
- Add module `evaluation360` (or `review_cycle`) to the Module union in `seed-access-matrix.ts`
  + the Action/Module types. (Slice 0 removed the dead `evaluation` module; this is a real
  re-add with a live surface.)
- Grants: `hr_admin`/`super_admin` → `manage@organization` (run cycles); `leader` →
  `read@team` (monitor team completion, optional); raters/subjects use **scope-aware** reads
  keyed on `RaterAssignment.raterUserId` / `subjectUserId` (own/assigned scope) — register
  `raterAssignment` in `entity-policies.ts` with anchor `raterUserId` (for the rater task list)
  and a subject-anchored read for the published report.

## Routers/services
- `evaluation360` router: `createCycle/openCycle/closeCycle/publishCycle` (org-scoped admin),
  `assignRaters` (org-scoped), `listCycleProgress` (admin monitor). Service + repository layers.
- Rater-facing: `myRaterTasks` (assignments where `raterUserId = ctx.user.id`, status PENDING),
  `submitRatings` (own assignment only; transaction).
- Subject-facing: `myReport` (aggregated, anonymized per-relationship averages; ONLY when cycle
  status = PUBLISHED; min-N suppression like the Wave 2.5 k-anonymity layer — never expose a
  single peer's raw rating). Reuse the `suppressedValue`/min-5 invariant from
  [[tims-wave-2.5-access-control]].

## UI surfaces
- **Employee participant** ("My 360"): pending rater tasks + (when published) my report. New
  participant section.
- **hr_admin/super_admin** (admin shell): 360 admin — create cycle, assign raters, monitor
  completion %, publish. New page under People/Talent.
- All i18n es/en; Loading/Error/Empty per frontend.md.

## Recommended sequencing (separate milestone)
1. Schema + migration + RBAC module + grant re-seed.
2. Admin cycle CRUD + rater assignment (org-scoped).
3. Rater task list + submission (assigned-scope, own-only).
4. Aggregation + publish + subject report (k-anon min-N).
5. Participant "My 360" UI + admin monitor UI.
6. Adversarial review of the anonymity invariant (a 360 leaks individual peer ratings if
   aggregation is naive — this is the highest-risk part, mirror the Wave 2.5 codex rounds).

**Decision for Federico:** approve as the next milestone after the Slice 5+ surfacing work, or
defer. Do not ship a partial 360.
