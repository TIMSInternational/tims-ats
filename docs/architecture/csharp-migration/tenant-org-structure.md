# Tenant org structure + vacancy-scoped approvers (`/tenant/org-structure`) — PR #310, DARK

**Status:** built, integration-tested against real PostgreSQL under production-shaped RLS, **not deployed, not
flipped.** Parity-registered 2026-10-01 (all 11 routes — see "Before flipping"), but **no verify has ever run**, so
nothing here is prod-verified. Stacked on PR #304 (tenant people directory).

## Why it exists

Leader- and unit-scoped vacancy approvals anchor on `teams.leader_id` and `user_business_units`, but no UI could
create teams, set leaders or assign unit members, and the vacancy wizard could not place a vacancy on a unit/team.
So every scoped approver was unreachable: `submitForApproval` rejected them for every vacancy.

## What ships UNGATED on merge (tRPC / web, no flag)

- Vacancy wizard: business unit / team / hiring-manager fields. With the org-structure web flag off they read the
  existing tRPC `organization.listCompanies`/`listTeams` (`organization:read`; a recruiter sees a "cannot read org
  structure" hint instead of the selects). The hiring-manager picker uses the people directory hook, so with the
  people flag off it is tRPC `user.list` (`user:read`; recruiters see the forbidden state).
- Wizard: `autoPublish` and `requireApproval` are mutually exclusive (turning approval on clears auto-publish —
  the server already rejected the combination); create errors are shown inline; submit-approval errors surfaced.
- `vacancy.create` / `vacancy.update` placement checks (`packages/api/src/routers/vacancy/org-placement.ts`):
  company, business unit, team and assignee must be ACTIVE rows of the caller's organization; the team must belong
  to the effective unit and the unit to the effective company. On update an omitted anchor keeps its current value,
  so a unit-only change whose CURRENT team belongs to another unit is rejected (change or clear the team in the same
  write). Consistency is only enforced for pairs the write touches (legacy rows are not blocked on unrelated edits).
  The check is not in the write transaction — accepted: a deactivation racing the write leaves the same state as a
  deactivation one second later, which does not cascade to vacancies either.

## Behind flags

| Flag                                                    | Where          | Default | Gates                                                                                                          |
| ------------------------------------------------------- | -------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `Platform__TenantOrgStructureEnabled`                   | C# App Runner  | false   | all 11 `/tenant/org-structure` routes                                                                          |
| `NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP`           | Vercel (build) | unset   | business units management screen (legacy viewer when unset) AND the wizard's unit/team options (C# `/options`) |
| `Platform__TenantPeopleDirectoryEnabled` (#304)         | C# App Runner  | false   | `?vacancyId=` on `/tenant/people/assignable`, `vacancy_assignee`                                               |
| `NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP` (#304) | Vercel (build) | unset   | scoped approver picker + hiring manager via C#                                                                 |

Flip **C# first**, verify, then the web flag (build-time → redeploy). With the web flag on and C# off the business
units screen shows the error state and the wizard shows the "could not load" hint; neither falls back to tRPC.

**Before flipping in production — parity registration (done 2026-10-01, never run):** all 11 routes are registered
fixture-first and off the coverage allowlist, as three harness surfaces behind the one flag:

| Harness key | Command | Routes | Probe | Denied |
| --- | --- | --- | --- | --- |
| `tenant-org-structure` (read) | `verify tenant-org-structure` | `GET /`, `GET /options` | hr_admin (organization:read) | org_admin both; hrbp on `GET /` only (it reaches `/options` via vacancy:create/update@unit) |
| `tenant-org-structure` (write) | `verify-write tenant-org-structure` | POST/PATCH business units, POST teams | super_admin (the only MATRIX holder of organization:create/update) | hr_admin + hrbp, grant-level |
| `tenant-org-people` (write) | `verify-write tenant-org-people` | leader-only PATCH team, PUT/DELETE member, PUT/DELETE unit assignee, PUT home unit | hr_admin (user:*) | hrbp, grant-level |

Grants come from `seedOrgStructureGrants` (MATRIX scopes, not invented); write fixtures are dedicated fixed-UUID
rows (`WRITE_ORG_STRUCTURE`, prefix `e0000367…`) reset by `seedOrgStructureWritePreconditions` before every
`verify-write`, so re-runs need no teardown. Every assignment write probes BOTH cross-tenant vectors (org-B
container + org-A user, and org-A container + org-B user) and must get 404 with no row written. Run the read verify
and both write verifies with `Platform__TenantOrgStructureEnabled=true` at canary, BEFORE the web flag. Not covered
remotely: the PATCH-team RENAME form (one VERB+path registers once; the leader-only form is the registered one) and
a narrow-scope organization grant — both are in `OrgStructureEndpointTests`' 403 table. ⚠️ `seed --teardown` after
any audited `verify-write` is refused by the append-only `audit_logs` guard (see `scripts/parity/README.md`).

## Authorization — mirrors today's tRPC capabilities

Every route except `/options` needs organization/company scope (a team/unit-scoped grant is 403).

| Route(s)                                                         | Gate                                                                   | Seeded holders (MATRIX)   | tRPC today                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------- | ----------------------------------------- |
| `GET /tenant/org-structure`                                      | `organization:read`                                                    | super_admin, hr_admin     | `listBusinessUnits`/`listTeams`           |
| `POST/PATCH /business-units`, `POST /teams`, `PATCH /teams/{id}` | `organization:create` / `organization:update`                          | super_admin               | `createBusinessUnit`/`createTeam`         |
| `PATCH /teams/{id}` with ONLY `leaderUserId`                     | `organization:update` OR `user:update`                                 | super_admin, hr_admin     | — (new)                                   |
| `PUT` / `DELETE` team member, unit assignee                      | `user:create` / `user:delete`                                          | super_admin, hr_admin     | `assignUserToUnit`/`unassignUserFromUnit` |
| `PUT /users/{userId}/business-unit`                              | `user:update`                                                          | super_admin, hr_admin     | — (new)                                   |
| `GET /options`                                                   | `organization:read` OR `vacancy:create` OR `vacancy:update`, any scope | + recruiter, leader, hrbp | — (no people data)                        |

Chosen over granting hr_admin `organization:create/update` because it preserves every seeded role's capability
without a production data change (no seed edit, no backfill of `role_permissions`). The screen shows exactly the
actions the caller's grants allow (`use-org-abilities.ts`).

Team-member writes row-lock the team (`FOR UPDATE`), as team updates and unit writes already lock their row.

## Tests

- `services/Tims.Platform/tests/Tims.IntegrationTests/OrgStructure/` — grants are MATRIX rows; four enumerated
  divergences in `OrgStructureFixture.cs` (unit-scoped approve on hrbp, a narrow-scope org/user grant + legacy
  `'all'` approve on committee, a deactivated hr_admin role copy, Globex subset). Seed-shaped hr_admin manages
  assignments but gets 403 on structure; 403 table over all routes for a no-grant role and a narrow-scope role;
  vacancy-scoped approvers for anchored, UNANCHORED, inactive-team/unit and other-unit vacancies; caller-scope 404.
- `tests/vacancy/org-placement.test.ts`, `tests/vacancy/create-wizard-*.test.tsx`,
  `tests/organization/business-units-*.test.tsx`.

## Not done

- Existing companies have no teams/leaders/unit assignees, so after the flip every existing vacancy is unanchored
  and only org-wide approvers are eligible until an admin builds the structure (backfill issue drafted in PR #310).
- `roles.is_active` is still ignored by the authorization kernels (see `tenant-people-directory.md`).
