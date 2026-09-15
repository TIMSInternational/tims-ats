# C# invitation resend — #75 / #217

Status: implemented, default disabled; depends on the email boundary in PR #258. No live mail sent or production configuration changed in this slice.

## Contract

`POST /platform/invitations/{id}/resend` is a platform-owner operation, intentionally cross-organization like the existing invitation console. Ordinary staff, candidate/API-key principals and impersonated owners are not permitted. The existing JWT/principal/MFA/rate-limit middleware applies. The handler checks ownership before validating the string-bound UUID. No request body is required.

For pending, sent or expired invitations, the use case sends the reminder using `IEmailSender`. It preserves the original token, encodes the token in the acceptance link, HTML-encodes the organization name and uses the configured HTTPS application origin. The sender's contract distinguishes SES acceptance from actual inbox delivery. Accepted/revoked invitations never send. Missing records return 404; terminal states return 400.

Only provider acceptance permits a conditional database update. The comparison includes invitation ID, token, updated-at timestamp and eligible status. This prevents overwriting acceptance, revocation, token rotation or another observed update. Updated-at advances by at least one millisecond so two snapshots cannot both succeed within the same timestamp tick. The response contains only `id`, `status`, `sentAt`, `expiresAt`, with UTC millisecond timestamps. No invitation token, recipient or organization detail is returned.

Provider failure/uncertainty returns 503 and performs no state update. A changed snapshot returns 409 after provider acceptance. A database failure after acceptance returns a distinct 503 explaining that invitation status is unconfirmed; a timeout may have followed a commit, so it does not assert that delivery or the update failed. The user should refresh before manually resending. No automatic retry or backend fallback occurs in the new frontend hook.

The operation holds no database transaction/lock during delivery. Two concurrent explicit resend requests can both send an email before one loses the conditional update. This port does not claim exactly-once delivery or provide a durable outbox. The deadline/dispatch cap/circuit controls from PR #258 still apply. Distributed delivery deduplication and reconciliation remain separate work.

## Audit and ownership

Known targets are audited against the invitation's organization, not the owner's organization. Metadata contains only a fixed outcome enum. The actor and invitation ID are recorded; email, HTML and bearer token are excluded. Audit uses the existing bounded fail-soft security writer with `CancellationToken.None`, including database-state uncertainty after provider acceptance. Genuinely org-less invitations with org-less actors have no representable organization in the existing audit schema and follow the established skip behavior; a platform-wide org-less audit store is not introduced here.

`platform_invitations` moves from `efcoreReadOnly` to `efcoreStranglerWrite` in the coexistence ledger because a C# mutation now exists. This does not transfer schema ownership or authorize two active resend paths. Prisma remains the DDL owner. Other TS invitation writers and related consumers remain in place; no migration or production DDL is needed for this slice.

## Activation and retirement

1. Merge/deploy PR #258's email boundary and this slice through the normal checks/review process. Verify the actual web origin and sender identity.
2. Configure the consuming runtime's narrow SES grant and `Email__*` settings. No email attempt is made by this implementation task.
3. Set `Invitations__AppOrigin` to the real HTTPS frontend origin; the default is `https://tims-ats.vercel.app`. Origins with credentials, a non-root path, query or fragment fail startup validation.
4. Enable backend `Platform__PlatformInvitationResendEnabled`; it defaults false and is independent of invitation read enablement.
5. Perform controlled authenticated API tests with a designated test invitation/recipient. Never run the generic remote parity harness against real invitations; this route has an explicit coverage-gap entry pending safe mail fixtures.
6. Enable `NEXT_PUBLIC_INVITATION_RESEND_VIA_CSHARP=true` with `NEXT_PUBLIC_TIMS_PLATFORM_API_URL` configured and rebuild the frontend. A missing platform URL while the switch is on fails closed; the false/unset switch selects tRPC. C# failures never select tRPC or retry.
7. Verify the actual console resend action, list/KPI cache refresh, audit row and failure UI. Disable/remove the TS resend entry point as part of that controlled cutover and retain a documented reversal path before retirement. This PR does not flip either route switch or remove TS.

Creation, bulk delivery, revocation and token acceptance are not enabled by this flag. Organization creation has additional provisioning/subscription dependencies; #75 and #217 remain open.

## Evidence

Unit tests characterize eligibility, no write on unconfirmed delivery, sensitive-value encoding, safe response fields, conflict and uncertain DB commit. HTTP integration tests use the real .NET host, signed JWTs and a dedicated PostgreSQL container with native invitation enums, millisecond timestamps and forced RLS. The privileged owner path intentionally bypasses tenant RLS; the real gate is therefore tested with denial cases. Email is replaced with a controlled fake, so these tests establish application state handling, not live SES delivery. Frontend hook tests cover both switches, malformed IDs/responses, callback handling and no retry/fallback.
