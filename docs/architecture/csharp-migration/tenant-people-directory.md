# Tenant people directory for pickers (`GET /tenant/people/assignable`) — PR #304, DARK

**Status:** built, integration-tested against real PostgreSQL under production-shaped RLS, **not deployed,
not flipped, not parity-registered.** Nothing here is prod-verified.

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

**Before flipping in production:** register the surface in `scripts/parity/surfaces.ts` (fixture-first) and
remove it from the `UNREGISTERED_ALLOWLIST` in `tests/governance/parity-registry-covers-deployed-routes.test.ts`.
Not done in #304: the parity seed has no `recruiter` role and no interview/vacancy/offer create/update grants, and
a super_admin/org_admin-only registration would prove only the privileged branch, not the recruiter or scope paths
this surface exists for.

## Tests

`services/Tims.Platform/tests/Tims.IntegrationTests/People/` — fixture grants are the MATRIX rows (divergences
enumerated in `TenantPeopleFixture.cs`), callers recruiter/hr_admin/hrbp/leader/committee/employee, cross-tenant,
drifted foreign-role row, deactivated role, LIKE-metacharacter search, limit, 400/401/404 matrix;
`AssignablePeopleRepositoryTests` proves the repository filters on the rule's eligibility module AND action.
