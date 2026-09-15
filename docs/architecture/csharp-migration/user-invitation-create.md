# C# individual-user invitations — #75 / #217

Implemented, default disabled. Stacked on organization invitation creation (#260), resend (#259) and email (#258). No production email, flags, IAM or DDL changed.

## API and persistence

`POST /platform/invitations/users` accepts email (<=254), organizationId (nonempty UUID), and optional roleSlug (1–50, no control characters). An absent role is allowed; explicit null/empty is rejected. PlatformOwnerGate runs before the bounded 8 KiB body parse. Duplicate keys are rejected; unknown keys are ignored. Existing JWT/MFA and impersonation controls apply.

Inside the target organization's TenantScope, the repository verifies the organization is active and not deleted, and checks any selected role belongs to that organization and is active. Missing/inactive/deleted organization returns 404; unavailable role returns 400 without inserting or emailing. Pending invitation and creation audit commit together. This is intentionally stricter than TS, which accepts arbitrary role strings and checks only that the organization exists. Email bound is 254 to match the sender instead of TS's 255. No roles or memberships are created by this operation.

`GET /platform/invitations/organizations/{id}/roles` uses the same gate/flag and target TenantScope. It returns at most 100 active roles ordered by name and slug, projecting only slug/name. Both frontend entry points use these results instead of fixed role choices when C# is selected. More than 100 roles requires a later paginated selector; arbitrary hidden roles are not invented as fallback choices.

Role and organization checks are point-in-time validations at invitation creation. They do not reserve the role through future acceptance. Acceptance must revalidate membership and role rules; its migration remains open.

## Delivery and retries

`InitialInvitationDelivery` is extracted from the prior organization invitation use case and reused by both flows. Dispatch begins after creation commit, outside any database transaction. Provider acceptance gates the existing guarded sent update. HTTP 200 contains only id, organizationId and delivery: accepted, unconfirmed, changed or state_unconfirmed. Provider acceptance does not prove inbox delivery. Responses/audit omit token, recipient and email content. Template values are encoded; the user invitation email uses a fixed subject to avoid treating organization text as a mail header.

Creation audit is fail-closed in the transaction; post-commit delivery audit uses the existing bounded fail-soft writer. Cancellation/transport failure after creation is reported as unconfirmed, not rolled-back creation. A failure acknowledging the initial database commit can remain ambiguous; refresh before retrying.

There is no automatic retry, fallback, outbox or idempotency key. Unlike organization creation, user invitations have no unique slug protecting repeated submissions: separate explicit requests can create multiple invitations and send multiple emails. Duplicate/member detection and durable deduplication are not claimed in this slice.

## UI and rollout

`NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP` defaults false; the backend switch is `Platform__PlatformUserInvitationCreateEnabled`. Both the invitation console modal and the users wizard's single mode select exactly one writer. Missing platform URL fails closed; failed C# writes never fall back to tRPC. Creation with delivery uncertainty shows an EN/ES warning and triggers the existing refresh callback. Organization changes clear selected role and replace role choices; failed role lookup shows retry without fixed-role fallback. The flag-off path retains legacy role choices and delivery semantics. The successor [bulk invitation slice](bulk-invitation-create.md) migrates the wizard's bulk mode behind its own flag.

Merge prerequisites, retarget/recheck, deploy disabled, configure the existing email sender/application origin, test designated recipients and roles, verify actual browser acceptance/audit, then enable the frontend and retire/disable the TS operation through controlled cutover. No live activation or completed acceptance journey is claimed here. Prisma retains all table ownership.

## Evidence

Tests use the real HTTP host and PostgreSQL fixture with enums, timestamp(3), foreign keys and forced tenant RLS. They cover no-role/valid-role creation, cross-tenant/inactive/missing roles, unavailable organization, pending commit before dispatch, audit rollback, disabled sender, body validation, authorization, role lookup isolation and flags. Unit tests cover bounded inputs, shared delivery outcomes and encoding. UI tests submit both entry points, test warnings and ensure role choices follow organization selection. SES acceptance is simulated; these tests do not prove production grants, live inbox delivery or acceptance behavior.
