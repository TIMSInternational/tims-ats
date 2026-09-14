# C# organization invitation creation — #75 / #217

> 2026-09-14 successor: [individual-user invitation creation](user-invitation-create.md) is now implemented separately, still disabled. The remaining-work list below records this organization-only slice.

Implemented, default disabled. Depends on the email sender (#258) and guarded resend (#259). No production flags, IAM, schema or email deliveries changed in this slice.

## Contract and transaction

`POST /platform/invitations/organizations` ports `platform.createOrgInvitation`. PlatformOwnerGate authorizes before the bounded 8 KiB JSON read. Staff, impersonated owners and callers failing the existing JWT/MFA controls are denied. Inputs preserve email <=254, organization name 2–100, slug 2–63 lowercase letters/digits/hyphens, and the four plans; absent plan defaults to trial. Duplicate JSON keys, control characters in names and oversized bodies are rejected. Unknown keys are ignored like the existing Zod object. All SQL values are bound parameters.

`OrganizationBundleWriter` shares the existing direct-organization creation sequence: organization, company, business unit, team, ats-base entitlement catalogue, super_admin role, subscription. The caller owns the transaction. Both creation routes retain existing plan rules, 14-day trial for trial plans, default hierarchy, and seeded entitlement limits. An empty catalogue still grants zero entitlements; this inherited behavior is not a claim of operational readiness. Role permission assignments, membership and account creation remain part of the existing onboarding/acceptance behavior, not new work in this slice.

The new repository uses the existing provisioning DbContext and TenantScope on the newly generated organization ID. Bundle, pending invitation and creation audit commit together. Invitation/audit failure rolls back setup. Only the named organizations_slug_key constraint becomes 409. Tokens are generated privately; ID/token/timestamps are provided explicitly because Prisma defaults are client-side. Prisma retains all DDL ownership.

## Delivery and response

After commit, the email template HTML-encodes organization names and URL-encodes the token. Provider acceptance permits the existing conditional sent update: eligible status, token and timestamp must still match. No database lock is held while sending.

HTTP 200 contains only `id`, `organizationId`, and `delivery`:

- `accepted`: provider accepted and sent-state update succeeded; not proof of inbox arrival.
- `unconfirmed`: email acceptance was not confirmed; the created invitation remains available for inspection/resend. Cancellation or transport error does not pretend creation rolled back.
- `changed`: invitation changed during delivery; state was not overwritten.
- `state_unconfirmed`: provider accepted but database commit acknowledgement failed; refresh before resending.

Creation audit is fail-closed within the transaction, contains no token or recipient. Post-commit delivery audit uses the existing bounded fail-soft writer with cancellation-independent cancellation token. Audit availability does not undo a committed creation. A connection loss during the creation commit itself remains ambiguous; callers must refresh before retrying. The unique slug prevents a repeated request with that slug from creating a second organization or sending again, but is not a general idempotency key. There is no durable outbox, automatic retry, or exactly-once delivery guarantee.

These deliberately improve the TS sequence, which commits setup before inserting its invitation and labels it sent before checking email acceptance. This is not byte-for-byte behavioral parity; no generic remote parity run may create organizations or send real emails without designated fixtures.

## Frontend and cutover

The organization invitation modal uses one mutation selector, `NEXT_PUBLIC_ORG_INVITATION_CREATE_VIA_CSHARP` (default false). Enabled selects C# only; missing API configuration fails closed, errors never retry or fall back. The UI distinguishes committed creation with uncertain delivery from confirmed send and refreshes the invitation list through the existing success callback. EN/ES messages are included. The false switch retains the legacy writer and its delivery semantics.

After #258 and #259 merge, retarget/recheck this change against main. Deploy with the backend `Platform__PlatformOrganizationInvitationCreateEnabled` off. Configure/verify the sender and `Invitations__AppOrigin`, enable the backend for controlled test recipients, verify provisioning/invitation/acceptance/audit in the actual browser, then enable the frontend switch and disable/retire this TS operation through the normal cutover process. No production activation is claimed here.

User invitations, bulk invitations, revoke, token acceptance, runtime retirement and production end-to-end acceptance remain outstanding. Existing organization provisioning is reused, not declared a completed application migration.

## Validation scope

Real PostgreSQL fixtures include native enums, timestamp(3), foreign keys, no client-side ID/timestamp defaults, and forced RLS with app_tenant scopes for setup and invitation insertion. Tests cover the four plans, hierarchy, entitlements, initial pending commit, audit/insert rollback, duplicate/concurrent slugs, state changes during delivery and real-host authorization/body handling. Provider acceptance is simulated; disabled sender behavior is exercised without SES. Local unit and frontend hook tests cover uncertain outcomes and no retry/fallback. Production RLS/grants and inbox delivery still require the controlled cutover checks.
