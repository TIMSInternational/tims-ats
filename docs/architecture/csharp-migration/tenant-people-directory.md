# Tenant people directory for pickers (`GET /tenant/people/assignable`) — PR #304, #310, #337

**Status (2026-10-01):** **LIVE in production.** Both flags were flipped on 2026-10-01
(`Platform__TenantPeopleDirectoryEnabled` and `NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP`). Integration-tested
against real PostgreSQL under production-shaped RLS. Still **not parity-registered** (see below). Since #337 every
`UserPicker` in the app passes a `purpose`, so no picker reads tRPC `user.list` in production.

## Why it exists

The recruiter-facing pickers (interview evaluators, vacancy approvers, offer approvers) read tRPC
`user.list`, which requires `user:read` — a grant recruiters deliberately do not hold (seed-access-matrix.ts).
So those pickers 403 for the role that uses them most. This endpoint authorizes on the permission of the
**mutation each picker feeds** instead, and returns only the fields a picker renders
(`id, firstName, lastName, email, avatarUrl`; `avatarUrl` is always present, null when absent).

## Authorization (the rule, and why)

| `purpose`             | Caller must hold                       | Caller scope needed    | Listed people                                                        |
| --------------------- | -------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `interview_evaluator` | `interview:create` (`schedule`)        | organization / company | every active, non-deleted member of the org                          |
| `vacancy_approver`    | `vacancy:update` (`submitForApproval`) | any granted scope      | staff holding `vacancy:approve` via an ACTIVE role, or `super_admin` |
| `offer_approver`      | `offer:create` (`submitForApproval`)   | any granted scope      | staff holding `offer:approve` via an ACTIVE role, or `super_admin`   |
| `vacancy_assignee`    | `vacancy:create` (`vacancy.create`)    | organization / company | every active, non-deleted member of the org (PR #310)                |
| `colleague` (#337)    | **nothing** — any staff role, or a platform owner with a home org | n/a | active members holding an ACTIVE staff role |
| `performance_subject` | `performance:create` (OKR / coaching / commitment) | any (subject-scoped) | staff; narrow callers: their subject set |
| `learning_enrollee`   | `learning:create` (`enrollUser`)       | any (subject-scoped)   | staff; narrow callers: their subject set                             |
| `onboarding_hire`     | `onboarding:create` (`onboarding.create`) | any (subject-scoped) | staff; narrow callers: their subject set                             |
| `succession_candidate`| `succession:create` (add successor)    | any (subject-scoped)   | staff; narrow callers: their subject set                             |
| `evaluation360_participant` | `evaluation360:create` (assign raters) | organization / company | active members holding an ACTIVE staff role                 |
| `ninebox_committee_member`  | `ninebox:update` (add committee member) | organization / company | active members holding an ACTIVE staff role               |
| `org_structure_member`| `user:create` (team member / unit assignee / user unit) | organization / company | active members holding an ACTIVE staff role |

- **#337 purposes (`StaffOnly`).** Every purpose added in #337 lists only people holding at least one ACTIVE staff
  role in the organization, so an external-only principal (or a platform owner with no staff role) is never
  enumerated. The four recruitment purposes above predate this and still list every active member.
- **Subject-scoped purposes** mirror `assertSubjectInScope` / C# `SubjectInScope`: an org/company-scoped caller
  sees the whole staff list; a narrower caller sees only their subject set — own → self, team → self + members of
  the teams they lead, unit → members of their assigned units (direct `users.business_unit_id` or via a team of the
  unit) — resolved with the same `IAnchorLoader` the mutations use. They get a working picker instead of a 403.
- **`colleague` (decision accepted by the maintainer, 2026-10-01).** It relaxes the whole-directory scope rule:
  any staff member may list every active staff colleague (id, name, email, avatar). This matches
  `submitFeedback` / `giveRecognition`, which are protectedProcedure and accept any org member by design, and is
  also used for the onboarding buddy and coaching leader pickers. External principals are refused (403); an
  org-less platform owner gets 400.

- **Whole-directory scope rule.** `interview_evaluator` has no eligibility filter, so it IS the staff directory.
  A team/unit-scoped `interview:create` holder (leader, committee, hrbp) is refused (403) rather than shown people
  outside their scope. Filtering to the caller's team instead was rejected: `interview.schedule` accepts ANY org
  member as evaluator, so a filtered list would silently hide valid choices. No regression: today's `user.list`
  already 403s these roles (no `user:read`). A team/unit-filtered evaluator directory is a follow-up, not built.
- **Approver lists** contain only approve-permission holders, which a narrow-scoped submitter (hrbp holds
  `vacancy:update` at unit scope) legitimately needs; any granted scope suffices.
- **Deliberately not split:** the evaluators modal feeds `interview.addEvaluator` (`interview:update`). The
  org-wide callers the scope rule admits (super_admin, hr_admin, recruiter) hold both create and update in the
  matrix. `offer.submitForApproval` accepts `offer:update` OR `offer:create`; every matrix holder of update also
  holds create.
- **Eligibility is permission-based, not scope-aware.** A leader with team-scoped `offer:approve` is listed for any
  offer; `submitForApproval` re-checks each approver's scope against the specific record and rejects with a
  user-visible error (PR #310 adds a `vacancyId` filter for vacancy approvers).
- **`vacancy_assignee` (PR #310)** feeds the vacancy wizard's "hiring manager" (`vacancy.create` `assignedTo`),
  which accepts any active member — so it has no eligibility filter and, like `interview_evaluator`, needs org-wide
  scope. It replaced `vacancy_approver` there: a hiring manager need not hold `vacancy:approve`, and that purpose is
  gated on `vacancy:update`, which a leader creating a vacancy lacks. A team-scoped leader is refused this picker,
  exactly as the legacy `user.list` refuses them.
- **`?vacancyId=` (PR #310, `vacancy_approver` only)** keeps only approvers whose resolved `vacancy:approve` scope
  covers that vacancy (`VacancyApproverScope`, a port of `assertScoped`). The CALLER's own `vacancy:update` scope
  must cover the vacancy first — as `submitForApproval` requires — otherwise 404, identical to an unknown or foreign
  id (no in-tenant existence oracle). Deactivated roles, teams and units anchor nobody. A unit's assignees are read
  up to 1000 (ordered by user id); past that a warning is logged and the overflow is omitted — it can only hide a
  unit-scoped approver, never add one.
- **`roles.is_active`:** the directory ignores deactivated roles. The authorization kernels do NOT (TS
  `buildAccessForUser` and the route's role list, C# `IdentityRepository`/`PermissionService` never read
  `roles.is_active`), so the directory is stricter than submit/approve — it can only hide a person. Kernel fix is
  a separate follow-up.

## Flags and flip order

| Flag                                             | Where          | Default | Production (2026-10-01) |
| ------------------------------------------------ | -------------- | ------- | ----------------------- |
| `Platform__TenantPeopleDirectoryEnabled`         | C# App Runner  | false   | **true**                |
| `NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP` | Vercel (build) | unset   | **true**                |

Flip **C# first**, verify, then the web flag (build-time, so it needs a redeploy). With the web flag on and the C#
flag off every picker shows the "unavailable" state — the hook never falls back to tRPC by design. The FE zod
schema is `.strict()`: web and C# must be on the same side of #304 (both with or both without `roleSlugs`).

**Still outstanding (the flip happened without it):** register the surface in `scripts/parity/surfaces.ts` (fixture-first) and
remove it from the `UNREGISTERED_ALLOWLIST` in `tests/governance/parity-registry-covers-deployed-routes.test.ts`.
Not done in #304: the parity seed has no `recruiter` role and no interview/vacancy/offer create/update grants, and
a super_admin/org_admin-only registration would prove only the privileged branch, not the recruiter or scope paths
this surface exists for.

## Tests

`services/Tims.Platform/tests/Tims.IntegrationTests/People/` — fixture grants are the MATRIX rows (divergences
enumerated in `TenantPeopleFixture.cs`), callers recruiter/hr_admin/hrbp/leader/committee/employee, cross-tenant,
drifted foreign-role row, deactivated role, LIKE-metacharacter search, limit, 400/401/404 matrix;
`AssignablePeopleRepositoryTests` proves the repository filters on the rule's eligibility module AND action.
