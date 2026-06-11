# Wave 2.5 — Full Access-Control Layer (design)

> Status: APPROVED (decisions locked Jun 11 2026, Federico). Implements the role/scope
> model the Architecture doc has prescribed since day one but was never built.
> Canonical status: `docs/REMAINING-WORK.md`.

## Why (audit findings, Jun 11)

Two parallel audits (frontend + backend) found:

- **UI has zero role awareness.** `(admin)/sidebar.tsx` is a static list — every staff
  role (super_admin→employee) sees identical nav incl. compensation/billing/DEI. Only
  per-role logic in the whole client: `isPlatformOwner ? PlatformSidebar : Sidebar`.
  No page guards; unauthorized pages render then break with a FORBIDDEN toast.
  `auth.getSessionInfo` returns roles+permissions but is never called by the client.
- **RBAC is module:action only, ~80% covered.** `permissionProcedure` works and
  leader/employee are correctly denied, BUT: `notification.create`/`bulkCreate`,
  `portal.uploadDocument`/`startAssessment`/`acceptOffer` (dead staff stubs),
  `organization.list*`, `engagement.submitSurveyResponse` are plain
  `protectedProcedure` (any staff role). `hr_admin` bypasses the DB check via a
  hard-coded 20-module allowlist.
- **RLS = tenant isolation only (by design, and it is fully live).** ~85 tables
  ENABLE+FORCE fail-closed by `organization_id`. No role/row gating inside an org —
  the docs' RLS plan explicitly scopes that to the app layer.
- **The schema already anticipated this**: `RolePermission.scope` exists (seeded
  `'all'`, never read).

## What the docs prescribe (now adopted as spec)

- **9 roles** (Architecture.md §745-759): `super_admin`(org), `hr_admin`(org),
  `hrbp`(unit), `recruiter`(org, ATS modules only), `leader`(team), `committee`
  (panel), `employee`(own), `candidate`(own, portal), `external`(api).
- **Permission model** `module:action:scope`, scope ∈ `own|team|unit|company|organization`.
- **Sensitive-data matrix** (§2472-2553): per data-class × role access
  (FULL/READ/AGGREGATE/OWN/OWN-TEAM/NONE) with `+AUDIT` (data_access_logs) and
  `+CONSENT` modifiers; aggregate anonymity threshold = min 5 records.
- **Module×role matrix**: API-SPEC.md per-endpoint annotations + the synthesized
  matrix (recruiter = org-wide ATS; leader = own team + assigned vacancies;
  employee = self-service; hr_admin = all HR modules, NOT billing/integration/audit).

## Decisions (Federico, Jun 11)

1. **Scope**: everything now — 9 roles + scope engine + role-aware UI + endpoint
   hardening + the full sensitive-data layer (field rules, +AUDIT, min-5 aggregates,
   consent). One wave, 7 slices.
2. **Enforcement**: app-layer scopes; **RLS stays org-only** (follows the docs).
   UI gating is UX only — the API remains the enforcement boundary.
3. **Engine**: Approach A — hand-rolled central policy module (`packages/api/src/access/`),
   no new authz dependency (CASL rejected: new dep in the security path).
4. **Role stacking** (docs gap): **union of grants, widest scope wins** per module:action.
5. **Applicant visibility invariant**: an org always sees candidates applying to its
   positions — recruitment modules are org-scope for recruiter/hr_admin/super_admin and
   candidate rows carry `organizationId`. Candidate self-scoping stays on
   `candidateProcedure` (untouched).

## Architecture — `packages/api/src/access/`

| File | Responsibility (pure unless noted) |
|---|---|
| `types.ts` | `Scope`, `AccessDecision = {allowed, scope, roles}` — **carries the contributing role slugs** (codex F4: field-level rules are per-ROLE, not per-scope; widest-scope stacking alone would lose which role granted access), anchor types |
| `resolve.ts` | `resolveAccess(grants, module, action)` — deny-by-default; union/widest-scope stacking; returns contributing roles |
| `entity-policies.ts` | **Per-entity policy builders** (codex F3): a registry `scopeWhereFor(entity, scope, anchors)` that knows each entity's anchor relations — e.g. `Vacancy`: team→`{OR:[{teamId:{in}},{assignedTo:userId}]}`; `Candidate`: scoped via applications→vacancy anchors (no direct userId); `Interview`: committee→`{evaluators:{some:{userId}}}`; people entities→`{userId:{in:teamMemberIds}}`/`{userId}`. Repos call their entity's builder — still one centralized, tested place; a generic one-size `where` is explicitly rejected as unable to express these relations |
| `anchors.ts` | IMPURE: anchor loader (teams the user **leads** → member ids; hrbp assigned unit ids; committee panel ids). **Request-local memoization ONLY — never TTL-cached across requests** (codex F5: a revoked leader/hrbp/committee member must lose access on the next request; anchors are 1-2 indexed queries, acceptable per-request cost) |
| `classification.ts` | data-class registry: entity+field → `public/internal/confidential/restricted` × per-role visibility (from the sensitive-data matrix) |
| `select-for.ts` | `selectFor(access.roles, entity)` builds repo `select`s per **role × data-class × field, fail-closed** (no explicit field grant → not selected); fields a role can't see are never selected. With multiple roles, a field is selected iff ANY contributing role grants it (union — consistent with stacking) |
| `audit.ts` | `data_access_logs` writer; fail-closed for `restricted` (audit-write failure aborts the read) |
| `aggregate.ts` | min-5 anonymity: groups <5 → `{suppressed: true}` |

**Middleware**: `permissionProcedure(module, action)` resolves `{allowed, scope, roles}`
and injects `ctx.access`. **Delete `HR_ADMIN_MODULES` allowlist.** hr_admin's seeded
grants = **the docs matrix, NOT the current allowlist** (codex F6 — these differ and
the break is INTENTIONAL): hr_admin **loses** `audit` and `feature_flags` (today's
allowlist grants them; docs say super_admin-only) and `organization` becomes
**read-only**; keeps `monitoring` and all HR modules at org scope. Regression tests
assert each removal. Privileged bypass semantics: see "Privileged users are NOT a
hole" below.

## Schema (additive, idempotent RLS migrations — same pattern as assessment_questions)

- **`UserBusinessUnit`** — hrbp↔unit assignment (the one missing anchor; Team.leaderId
  + UserTeam + InterviewEvaluator + calibration_members already exist).
- **`DataAccessLog`** — org, actorId, dataType, recordId, action, ip/ua, timestamps.
  RLS'd. 7-yr retention (policy note; purge job = follow-on).
- **`DataConsent`** — subjectUserId, consentType, textVersion, agreedAt, withdrawnAt
  (mirrors AssessmentConsent). Withdrawal hides data; 30-day anonymization job =
  follow-on, tracked honestly in REMAINING-WORK.
- **Seeds**: roles `hrbp`, `committee`, `external` (+ formalized `candidate`); the FULL
  docs matrix as `rolePermission` rows with real `scope` values.

## Enforcement data flow (every staff endpoint)

```
permissionProcedure('performance','read')
  → resolveAccess(cachedGrants, module, action)        // {allowed, scope, roles}
  → ctx.access = { scope, roles, anchors: lazyRequestLocal }
router → service(orgId, ctx.access, input) → repo:
  where: { AND: [ { organizationId }, scopeWhereFor(entity, access), inputFilters ] }
```

Invariants:
1. **Composition is `AND: [...]`, NEVER object spread** (codex F1 — critical):
   spreading `{...access.where, ...inputFilters}` lets caller-supplied keys
   (`userId`, `teamId`, `businessUnitId`, `assignedTo`, `organizationId`) OVERWRITE
   the scope fragment. Existing endpoints already accept these keys
   (vacancy/crud.ts:163-185, performance routers). Every repo composes
   `AND: [{organizationId}, scopeFragment, inputFilters]` so user filters can only
   intersect. A lint-grep gate (`/gate` check) forbids spreading `access` fragments.
2. **Repos never build scope filters** — they call `scopeWhereFor(entity, access)`.
3. **Ownership probes on every by-id mutation**: `findFirst({ AND: [{id},
   {organizationId}, scopeWhereFor(entity, access)] })` — a leader cannot update an
   OKR outside their team by id-guessing.
4. Write semantics: own→self-anchored rows only; team→within led-team member set;
   unit→within assigned units; approve actions stay explicit (`vacancy:approve`).

**Privileged users are NOT a hole** (codex F2 — critical): the platform-owner /
super_admin bypass must still produce an explicit decision —
`ctx.access = {scope:'organization', roles:[...], where:{}}` — so repos that require
`ctx.access` never receive undefined and never silently fall back to unscoped reads.
super_admin remains org-bound by `withTenantContext` (RLS GUC). A platform owner
calling TENANT routers without an impersonated org context is REJECTED
(BAD_REQUEST: choose/impersonate an org) instead of running on the privileged
unscoped client; `/platform` routers are unaffected. Tests cover direct tRPC calls
(not just UI paths) for both privileged classes.

## Sensitive-data layer

- Registry rules from the docs' matrix, e.g.: `EmployeeCompensation.salary` — hr FULL,
  leader OWN-TEAM read, employee OWN, recruiter NONE; psychometric RAW
  (`AssessmentResult.breakdown` detail) — super_admin only; DEI/engagement responses —
  AGGREGATE only (min-5) below hr_admin; demographics — consent-gated.
- Sensitive repos build `select` via `selectFor` (never select-then-null).
- `confidential`/`restricted` reads → `data_access_logs` (+AUDIT). Restricted =
  fail-closed on audit failure.
- Engagement/DEI aggregates route through `aggregate.ts`; <5 → suppressed.

## Role-aware UI

- Admin shell fetches `auth.getSessionInfo` once → `PermissionsProvider`;
  `useCan(module, action)`, `useScope(module)`.
- Sidebar items declare their `module`; render iff `useCan(module,'read')`. Role name
  replaces the hardcoded "admin" label.
- `<RequireAccess module action>` page guards → clean es/en AccessDenied screen
  (replaces broken-page+toast). `/platform/*` gets a server-side layout gate.
- Candidate portal + `(portal)` routes untouched.

## `external` role

API-key-authenticated, results-only read surface (assessment results / webhooks per
API-SPEC "external: api"). No session UI. Keys managed in integrations admin (slice 7).

## Testing (TDD throughout)

- Pure table-driven: `resolveAccess` (deny-by-default, stacking, contributing roles),
  `scopeWhereFor` (entity×scope×anchor incl. Vacancy OR-anchors, Candidate
  via-application, Interview evaluator-join), `selectFor` (role×data-class×field,
  fail-closed), aggregate suppression.
- Integration per seeded role — critical regressions: employee→peer compensation =
  DENIED/empty; leader→non-led team = empty; recruiter→compensation = FORBIDDEN;
  employee→notification.create = FORBIDDEN; restricted read writes audit row; group
  of 4 → suppressed; candidate portal still self-scoped.
- Codex-driven regression classes (design review Jun 11): **filter-overwrite attack**
  (caller passes `userId`/`teamId`/`assignedTo`/`organizationId` in input → must
  intersect, never replace scope); **privileged direct-tRPC** (super_admin gets
  org-scoped `ctx.access`; platform owner on tenant router w/o org context →
  BAD_REQUEST, never unscoped); **anchor revocation is immediate** (remove
  Team.leaderId / UserBusinessUnit / InterviewEvaluator row → next request loses
  access, no TTL window); **hr_admin removals** (audit, feature_flags, organization
  writes → FORBIDDEN after migration).
- Existing 56 security tests + tenant-isolation tests stay green (RLS untouched).

## Slices (each = TDD → /gate → codex → PR; deploy as a coherent wave)

1. **Engine + schema + seeds** — `access/` pure core, 3 new models + migration,
   9 roles + scoped matrix seeded, middleware reads scope, hr_admin allowlist deleted.
2. **Endpoint hardening** — ungated mutations → `permissionProcedure`
   (notification.create/bulkCreate, organization.list*, engagement.submitSurveyResponse
   self-scoping), remove dead portal staff stubs, `/platform` server gate.
3. **Scope enforcement: recruitment** — vacancy/pipeline/candidate/interview/offer/
   assessment repos compose `access.where` (recruiter org-wide per docs; leader =
   assigned vacancies; committee = panel reads).
4. **Scope enforcement: people** — performance/onboarding/coaching/learning/
   compensation (own/team/unit live here).
5. **Role-aware UI** — PermissionsProvider, filtered sidebars, page guards,
   AccessDenied, role label.
6. **Sensitive-data layer** — classification registry, `selectFor` on sensitive repos,
   +AUDIT data_access_logs, min-5 aggregates (engagement/DEI), consent checks.
7. **New-role surfaces** — hrbp unit-assignment admin, committee panel wiring,
   `external` API keys + key management UI.

## Out of scope (recorded, not faked)

- Role-based RLS policies (docs non-goal; app-layer owns scopes).
- Consent 30-day anonymization job + audit-log purge job (follow-ons in REMAINING-WORK).
- Field-level encryption (medical/psychometric AES-256) — separate security wave.
- Candidate→employee role transition flow (docs gap #4) — needs product definition.
- Per-user rate limits on bulk ops (docs gap #8).

## Doc gaps resolved here

#12 stacking = union/widest. "Own team" (leader) = members of teams where
`Team.leaderId = user` (not inherited hierarchies — none exists in schema). hrbp
assignment = new `UserBusinessUnit` (covers gap #3: visibility = currently-assigned
units only). Committee panel scope = `InterviewEvaluator` + `calibration_members`
rows (gap #5).
