# C# bulk invitations — #75 / #217

Implemented, default disabled. Stacked on individual invitations (#261). No production email, IAM, flags or DDL changed.

## Contract

`POST /platform/invitations/bulk` authorizes the platform owner before parsing at most 128 KiB. It accepts a nonempty organization UUID and 1–200 recipients, each with email (ASCII, <=254), optional roleSlug (1–50, no controls), and optional firstName/lastName (<=100). Names are validated but not persisted, matching the existing CSV writer. Explicit null fields and duplicate JSON keys are rejected. Missing/inactive/deleted organization returns 404. Each recipient revalidates the target organization and active tenant-owned role before creation.

Each worker owns its own DI scope and EF context. At most four workers run per request, not globally. The 18-second batch and 6-second item budgets request cooperative cancellation. New work stops when less than six seconds remain. These are not hard HTTP latency guarantees; dependencies and the post-batch audit can extend elapsed time. Provisioning commands have a two-second timeout; the separate delivery-state context retains its own defaults.

## Duplicate coordination and delivery

Within a batch, case-insensitive repeated emails produce `duplicate_row`, meaning repeated input even if the original later fails or is not attempted. For unique rows, the repository takes the same transaction advisory lock as TS bulk: `hashtextextended(lowercase-organization-id + ':' + lowercase-email, 0)`. Parameterized, tenant-bound literal email equality checks pending/sent/accepted invitations; expired/revoked invitations permit a new creation. Statement timeout is 1500 ms inside that transaction.

Pending invitation and creation audit commit atomically per recipient, not per batch. Mail runs after commit with no database lock. Provider acceptance gates the existing token/status/version guarded sent update. An uncertain delivery leaves a pending record, so a subsequent bulk import detects a duplicate instead of sending again. Individual C#/TS creation does not use this lock; there is no universal deduplication or idempotency guarantee against those writers. There is no outbox or automatic retry.

Every submitted row receives its original index/email and sent/duplicate/error outcome; sent means provider acceptance plus confirmed state update, not inbox delivery. Reasons distinguish repeated input, existing invitation, unavailable role/organization, delivery uncertainty, changed/uncertain state, unattempted work and uncertain operation. Summary counts derive from those rows. Per-invitation creation audits are transactional; the post-batch delivery audit records counts only using the existing fail-soft writer. It is not a separate per-recipient delivery audit.

## Frontend and rollout

`Platform__PlatformBulkInvitationEnabled` and `NEXT_PUBLIC_BULK_INVITATION_VIA_CSHARP` default false. The wizard selects one writer, validates row identities/order and summary counts, and never falls back or retries a failed mutation. The legacy path normalizes its old result contract. The EN/ES results table shows each submitted row and directs operators to inspect pending invitations before retrying uncertain work. Existing CSV parsing still filters invalid email rows before submission; results cover submitted rows.

Deploy disabled after prerequisite PRs, configure the email boundary, exercise designated live recipients and acceptance, and verify audit/state before enabling the UI flag and retiring TS bulk. Acceptance/revocation, production activation and TS retirement remain separate work.

## Evidence and limits

Real HTTP/PostgreSQL tests cover authorization, disabled route, body/batch bounds, partial role failure, tenant-scoped duplicate checks, concurrent C# batches, pending recovery and allowed expired/revoked replacements. TS advisory protocol compatibility is source-verified; actual mixed TS/C# contention is not tested. Unit tests cover worker concurrency, cancellation and ordered partial results. Frontend tests cover both writer paths, malformed/correlated responses, no retry/fallback and CSV submission through the result screen. Email provider acceptance is simulated; no live inbox or production acceptance claim.

Review uses the required three-lens same-model fallback. External cross-model review was unavailable following automatic approval rejection; this is not cross-model verification.
