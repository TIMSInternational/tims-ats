# Bulk invitation delivery — issue #218

The existing TypeScript bulk-invite endpoint now persists pending invitations, sends their actual stored acceptance token through SES, and marks sent only after provider acceptance. Provider failure/abort is reported as unconfirmed, never successful delivery. Existing resend now also honors failed delivery and cannot overwrite an accepted/revoked state during the provider call. Organization/role text and URL attributes are HTML-escaped.

## Request and concurrency behavior

The endpoint remains synchronous **best effort**, not a durable dispatch queue. Its existing 200-recipient input cap and global 30-second route timeout remain unchanged. Four workers share an 18-second service work budget. New reservations stop when fewer than six seconds remain; unattempted recipients receive explicit errors in the original input order. Provider calls carry an SDK abort signal capped at four seconds and remaining budget. Database units use one-second transaction acquisition, two-second transaction lifetime and 1.5-second statement timeout limits. This leaves response headroom in ordinary operation, but is not a hard end-to-end SLA for auth/network/database failure. Reliable guaranteed processing of an entire large batch still requires durable dispatch.

Each reservation locks a PostgreSQL advisory key derived from normalized organization UUID + email, rechecks active invitation statuses, and inserts pending in the same transaction. Concurrent bulk submissions therefore cannot both reserve that recipient. The lock is released before SES is called. This coordinates this bulk writer; older single-invitation writers do not acquire the same lock and need follow-up consolidation for a platform-wide uniqueness guarantee.

A failed or unconfirmed send remains pending and is recovered through the existing resend action; resubmitting the same bulk list identifies it as a duplicate. Abort can race provider acceptance: these results deliberately say unconfirmed, so this patch makes no exactly-once delivery guarantee. Recipients not attempted because of budget exhaustion have no reservation and can be submitted again.

## Verification

- 14 focused Vitest tests passed across `bulk-invitation-delivery`, `bulk-invitation-repository` and `ses-abort`.
- Service tests include a 200-recipient simulated slow-provider run, four-call concurrency maximum, partial-work reporting, provider failure, resend failure and status races.
- Repository tests verify transaction/lock/check/insert ordering, normalized lock key, duplicate rejection and lock-failure behavior. These are mocked transaction contract tests; no real PostgreSQL concurrency test was run for this patch.
- SES transport test verifies abort-signal forwarding and unconfirmed return on rejection. All sender tests are mocked; no external emails sent.
- API TypeScript check and `git diff --check` passed.

Changes are local, not deployed. C# invitation write migration remains a separate task.
