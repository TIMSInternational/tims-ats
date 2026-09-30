# Tenant team invitations (F8) — PR #307

Status: implemented, default disabled, not deployed. No live email was sent and no production configuration
was changed by this work.

## What it is

A company admin (super_admin, hr_admin, or anyone holding `user:create` at organization scope) invites
people into **their own** organization from the web "Equipo" page (`/settings/users`). This is greenfield
C#: no tRPC twin exists. It is separate from the platform-owner invitation console (`/platform/invitations/*`,
see `invitation-resend.md` and `organization-invitation-create.md`), which stays cross-organization.

| Route                                      | Purpose                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `GET /tenant-invitations`                  | Keyset-paged open invitations, `status=all\|active\|expired` |
| `GET /tenant-invitations/roles`            | Roles this caller may grant                     |
| `POST /tenant-invitations`                 | Create + send (`{email, roleSlug}` only)        |
| `POST /tenant-invitations/{id}/resend`     | Resend, 7 more days of validity                 |
| `POST /tenant-invitations/{id}/revoke`     | Revoke a pending/sent/expired invitation        |

The organization always comes from the resolved principal. A body carrying `organizationId` (or any extra
key) is a 400, not ignored. Every statement runs in `TenantScope` AND filters `organization_id`, because the
production login role bypasses RLS.

## Authorization

`TenantInvitationGate`: resolved org-user staff principal (platform owners use their own console → 403),
`user:create` at **organization** scope (unit/team/own grants → 403), and no mutation under impersonation.
Auth runs before any input parsing, so garbage input cannot suppress a 401/403 audit row.

**Grant policy** (`Tims.Domain.Identity.InvitationGrantPolicy`, TS port
`packages/shared/src/types/invitation-grant-policy.ts`): super_admin grants every assignable staff role;
hr_admin every one except super_admin; anyone else only the staff roles they hold, plus `employee`. Never
`external`, `candidate`, `platform_owner` or an unknown slug. Both runtimes assert the same golden matrix,
`contracts/identity-fixtures/invitation-grant-policy.json`.

- Create and resend enforce it (resend re-grants the stored role, so an hr_admin cannot revive a super_admin
  invitation). The resend delivery repository re-checks the role inside its own SQL.
- **Revoke is deliberately not role-gated.** Removing a pending grant can never escalate anyone. An hr_admin
  may revoke a pending super_admin invitation. This is pinned by an integration test so that changing it is a
  decision, not a "consistency fix".
- The same policy now guards tRPC `user.create` and `user.assignRole`. Before PR #307's panel follow-up,
  those two procedures accepted any assignable slug, which made the C# control bypassable.

Other role-writing paths, and why they are outside this policy:

| Path | Why it is not covered |
| ---- | --------------------- |
| `platform.users.changeOrgUserRole` (tRPC) | `platformProcedure`, which only platform owners can call. They are cross-organization by design. |
| `offer.lifecycle` hire (tRPC) | Always grants `employee`, which every caller may grant. |
| `apps/web/app/auth/callback/route.ts` | Org creation: the founder becomes super_admin of the new org. |
| C# `InvitationOnboardingRepository` | Acceptance grants the invitation's stored role, which was checked at create/resend. |
| `prisma/seed*.ts` | Local/dev seeders, not a runtime path. |

## Resend cooldown

A resend within **5 minutes** of the last delivery (the initial send counts) is refused with **429** and a
`Retry-After` header. Nothing is sent or written, and the refusal is audited as `invitation_resend` with
`{outcome: Cooldown}`. The 5 minutes match the TS `REMINDER_COOLDOWN_MS` precedent.

The rule is enforced twice. First, the use case checks it before any email. Second, the org-bound
repository's guarded mark-sent `UPDATE` requires `sent_at IS NULL OR sent_at <= now - 5 min`. That second
check means a request that raced past the first cannot record a second delivery inside the window. Two truly
concurrent clicks can still both reach the email provider before one loses the guarded update; that is the
no-outbox limitation described in `invitation-resend.md`. A revoked or accepted row is not masked by the
cooldown and still returns 400. The platform-owner resend path is unchanged.

**Not implemented (follow-up):** a per-organization daily invitation cap. The global `RateLimitMiddleware`
bounds request rate, but not the number of emails one tenant can trigger per day.

## Audit

| Event | When |
| ----- | ---- |
| `user_invitation_created` | Created. Written in the same transaction as the row. |
| `user_invitation_delivery {outcome, surface:"tenant"}` | After a create's delivery attempt. |
| `user_invitation_denied {reason:"role_not_grantable", roleSlug[, operation:"resend"]}` | Create or resend refused by the grant policy. |
| `invitation_resend {outcome, surface:"tenant"}` | Every resend outcome, including NotFound and Cooldown. |
| `user_invitation_revoked {previousStatus}` | Revoked. Written in the same transaction as the update. |
| `user_invitation_revoke_refused {outcome, surface:"tenant"}` | Unknown/foreign id (NotFound) or terminal state (InvalidStatus). |

Rows are always written against the **caller's** organization. A foreign id never produces a row in the
foreign org.

## Flags and activation

- Backend: `Platform__TenantInvitationsEnabled` (default false) maps all five routes. Create and resend need
  the email boundary configured (`csharp-email-delivery.md`) and `Invitations__AppOrigin`.
- Frontend: `NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP=true` at build time plus
  `NEXT_PUBLIC_TIMS_PLATFORM_API_URL`. With it off, the page shows an "unavailable" notice, and the sidebar
  "Equipo" entry and the dashboard checklist "invite your team" link are hidden. The members roster (tRPC
  `user.list`, active and non-deleted users only) stays reachable by URL.
- No `scripts/deploy/cutover.sh` row. None of the invitation slices has one, and this flag has no TS twin
  to retire.

## Parity harness

`scripts/parity/surfaces.ts` registers `tenant-invitations` with the **list** endpoint only, C#-only
(`[WEAK]` parity by design). RBAC: super_admin/hr_admin 200, hrbp 403 (a grant-level deny). The
`seedTenantInvitationGrants` fixture gives hr_admin `user:create@organization`, copied from
`seed-access-matrix.ts`. On a fresh seed, RLS Mode B is inconclusive, because neither org has an invitation.

The other four routes are on the coverage allowlist in
`tests/governance/parity-registry-covers-deployed-routes.test.ts`, for two reasons:

- `/roles` returns an id-less catalogue that is identical across the two parity orgs, so Mode B would fail a
  correct endpoint.
- The POSTs mutate and send real email.

## Evidence

- `Tims.IntegrationTests/PlatformInvitations/TenantInvitationEndpointTests.cs` runs a real host against
  Postgres with signed JWTs and a fake sender. It covers the gate matrix, impersonation, unit scope, the grant
  policy on create and resend, cross-tenant 404s, cooldown (endpoint and repository guard), audits, and paging
  (including the id tie-break).
- `Tims.UnitTests/PlatformInvitations/TenantInvitationsUseCaseTests.cs` and
  `Identity/InvitationGrantPolicyFixtureTests.cs` cover the use case and the shared grant matrix.
- The TS side has `tests/access/invitation-grant-policy-fixtures.test.ts`,
  `tests/settings/user-role-grant-policy.test.ts`, `tests/settings/*`, `tests/nav/*` and
  `tests/dashboard/setup-checklist.test.ts`.
