# Tenant people directory for pickers (`GET /tenant/people/assignable`) — PR #304, DARK

**Status:** built, integration-tested against real PostgreSQL under production-shaped RLS, **not deployed,
not flipped.** Parity-registered 2026-10-01 (`verify tenant-people`), but no verify has ever run — nothing here is
prod-verified.

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

| Flag                                             | Where          | Default |
| ------------------------------------------------ | -------------- | ------- |
| `Platform__TenantPeopleDirectoryEnabled`         | C# App Runner  | false   |
| `NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP` | Vercel (build) | unset   |

Flip **C# first**, verify, then the web flag (build-time, so it needs a redeploy). With the web flag on and the C#
flag off every picker shows the "unavailable" state — the hook never falls back to tRPC by design. The FE zod
schema is `.strict()`: web and C# must be on the same side of #304 (both with or both without `roleSlugs`).

**Before flipping in production — parity registration (done 2026-10-01, never run):** registered in
`scripts/parity/surfaces.ts` as `tenant-people` and removed from the coverage allowlist. A route registers once,
so it is registered on `purpose=interview_evaluator&limit=50` — the unfiltered whole-org directory, and the purpose
with the whole-directory scope rule. `seedTenantPeopleGrants` copies MATRIX: hr_admin interview:create@organization
(the probe — a real grant, the same shape recruiter holds), hrbp interview:create@unit (seeded so its 403 is the
SCOPE rule firing on a passed grant check, not a missing grant), org_admin nothing (grant-level 403). RLS Mode B
compares the two parity orgs' directories. Run `verify tenant-people` with `Platform__TenantPeopleDirectoryEnabled=true`
at canary, before the web flag. Still NOT covered remotely: the approver purposes and `?vacancyId=` (no approver or
vacancy fixture; `TenantPeopleEndpointTests` covers them) and a seeded `recruiter` role (hr_admin holds the same
grant shape).

## Tests

`services/Tims.Platform/tests/Tims.IntegrationTests/People/` — fixture grants are the MATRIX rows (divergences
enumerated in `TenantPeopleFixture.cs`), callers recruiter/hr_admin/hrbp/leader/committee/employee, cross-tenant,
drifted foreign-role row, deactivated role, LIKE-metacharacter search, limit, 400/401/404 matrix;
`AssignablePeopleRepositoryTests` proves the repository filters on the rule's eligibility module AND action.
