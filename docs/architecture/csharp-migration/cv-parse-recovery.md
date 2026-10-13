# Public-application CV recovery (.NET 10)

Status: draft implementation for #333. The retry schema, lease repository,
bounded PDF/DOCX extraction, ETag-pinned S3 reader, guarded Bedrock Converse
parser, per-organization budget/usage ledger and API-hosted loop are implemented.
The loop is **disabled by default and not activated**. It stays off until the
migration, AWS permissions, published guardrail, `cv-parser` agent activation,
alarms and a synthetic canary are verified (owner apply procedure, kept outside
this repository). The existing post-response TypeScript parse handles new
applications first; .NET recovers only visible unparsed rows.

## Existing boundary

`portal.applyToVacancy` commits the application, consent evidence and an unparsed
`candidate_documents` row together. Its post-response TypeScript task retrieves the
uploaded object, extracts PDF/DOCX text and calls the gated CV agent. A terminated
function, S3 error, budget denial or model error leaves `parsed_data` null. The
document must remain visible to staff and application submission must still succeed.
The AI door distinguishes validated output from its empty fallback; malformed
output never marks the document parsed or enters the cache.

## Runtime decision

Run the reconciler in the **deployed .NET 10 API host** behind
`Platform__CvParseRecoveryEnabled=false` by default.
`Tims.Workers` has a Quartz host in source but no production deployment; registering a
job there alone cannot close the gap. The host owns dedicated S3, Bedrock and
database clients, catches transient failures without stopping the API and coordinates
across App Runner instances through PostgreSQL leases. Move the loop to `Tims.Workers`
only after that host is deployed and the API loop is disabled.

## Output contract (identical to TypeScript)

`CvParsedResult` implements exactly the TS contract: `invoke.ts` extracts
`/\{[\s\S]*\}/` (first `{` to last `}`), `JSON.parse`s it and validates it with
`cvParserOutputSchema` (`packages/ai/src/agents/cv-parser.ts`, Zod strip mode). Every
key is required, strings/numbers are unbounded and may be empty, unknown keys are
dropped, duplicate keys resolve last-wins and an all-empty CV is valid with confidence 0. The persisted `parsed_data` has the same keys and values the TS service writes.
`contracts/cv-parser-fixtures/cases.json` is generated from the TS schema and asserted
on both sides (`tests/ai/cv-parser-contract.test.ts`, `CvParserContractTests`).
Transport checks stay outside the contract: a guardrail intervention or truncated turn
is never a parse. Documented non-decisive differences: 256k-character model text cap
(the call is capped at 2048 output tokens), 256-level nesting cap, and lone UTF-16
surrogate escapes are rejected (PostgreSQL `jsonb` cannot store them either).

## AI door

The parser requires an explicit guardrail ID and a **published numeric guardrail
version**; `DRAFT` (the mutable working copy) is refused at registration and at call
time. It sanitizes the bounded prompt, meters every response (with the same `success`
flag the TS usage log records) before inspecting it, and pins Haiku 4.5 so token
metering cannot understate another model's price. The budget defaults to $25 per
organization per month, matching the TypeScript gate. Because the TS and .NET callers
can overlap, the pre-call budget check is a conservative control, not an atomic
cross-runtime spend reservation.

## Durable state and concurrency

The `candidate_documents` migration adds attempt count, next eligible time, lease
token/expiry and a bounded reason code. `parsed_data` remains the success indicator.
A partial index on unparsed CV rows eligible for retry avoids scanning the entire
documents table. Apply this DDL before deploying code that reads the new columns.

The repository claims at most 10 CVs older than two minutes with `FOR UPDATE SKIP
LOCKED`, oldest **due** time first (a document returning from a deferral queues behind
work that became due before it), then commits the claims before doing network work.
Claim increments the attempt count and sets a unique lease token. Completion, failure
or deferral requires that token, the exact document id and organization id; a stale
worker cannot overwrite a newer result.

Eligibility, enforced in SQL and again before any S3 call:

- the candidate is active and the application consent is not withdrawn;
- the object key is exactly the portal-generated shape
  `cv-uploads/{organizationId}/{uuid}.{pdf|docx}` (`CvObjectKey`), not merely a
  tenant prefix;
- the document was created after the **activation cut-off**
  (`CV_RECOVERY_CREATED_AFTER`, ISO-8601 UTC; default host start minus one hour).
  Enabling the loop therefore never sweeps the historical backlog. Set the variable
  explicitly at activation so a redeploy does not move it;
- the organization has not turned `cv-parser` off
  (`ai_agent_org_configs.enabled = false`). An opted-out tenant's CVs are neither
  claimed nor counted in the backlog signals; re-enabling the agent makes them
  eligible again.

Immediately before inference, the lease and consent are rechecked under the same
candidate advisory lock used by withdrawal, held through the bounded parse.
Completion rechecks consent and `parsed_data IS NULL`. A withdrawn or deleted subject
is never sent to Bedrock after withdrawal has committed.

## Failure handling

| Failure                                               | Effect                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Invalid document (bad key, size, unreadable, no text) | terminal, `invalid_document`                                       |
| S3 fetch error                                        | retry with backoff, consumes an attempt                            |
| Extraction over its 15 s wall-clock budget            | retry with backoff (`extraction_error`), consumes an attempt       |
| Two earlier extractions still overrunning             | **deferred 10 min, attempt refunded**; alert raised                |
| Monthly budget spent                                  | **deferred to next UTC month, attempt refunded** (`budget_denied`) |
| Agent inactive, or tenant opted out after the claim   | **deferred 1 h, attempt refunded** (`budget_denied`)               |
| Model error / invalid output                          | retry with backoff, consumes an attempt                            |

The budget gate runs before the CV is fetched or decoded, so a denied tenant costs one
query, not an S3 GET and a decode; the parser re-checks immediately before the model
call. A spent budget cannot recover before the ledger's monthly reset, so it is not
re-claimed sooner. Raising a tenant's budget mid-month therefore does not resume its
deferred CVs until the 1st (UTC) unless their `cv_parse_next_at` is cleared.

Backoff is 5, 20, then 60 minutes with a maximum of four attempts. PDF/DOCX decoding
runs off the hosted loop; the caller stops waiting at the deadline. A decoder stuck
inside one page cannot be interrupted in-process, so at most two overrun extractions
may run at once before new ones are deferred. No raw CV text, email, filename or
provider message is stored in retry state or logs.

## Health signals and alarms

Every five minutes the loop logs `CV_RECOVERY_HEARTBEAT` with due, leased, deferred
and exhausted counts and the oldest due age. `CV_RECOVERY_ALERT` is logged only while
a problem is current: a document became terminal in the last 15 minutes, the oldest
due document is older than ten minutes, or extractions are stuck. Two CloudWatch log
alarms (`scripts/ops/create-cv-recovery-alarm.sh`, mirrored in
`deploy/terraform/cv-recovery.tf`):

- **alert** — `RecoveryAlertCount >= 1` in 5 minutes; missing data is not breaching,
  so it returns to OK once the condition clears;
- **heartbeat** — `RecoveryHeartbeatCount < 1` for 15 minutes; missing data is
  breaching, so a stalled loop or unreachable database pages.

Create both only when enabling the flag; with the loop off the heartbeat alarm fires
by design. App Runner 5xx alarms cannot detect a stalled background loop.

## Design notes (accepted, not fixed here)

- **Two database connections per inference.** The consent-gate transaction holds one
  connection through the bounded call, and the budget/usage ledger opens another.
  With two concurrent inferences per instance that is four connections per instance;
  verify pool capacity and the idle-in-transaction timeout before enabling.
- **No per-instance canary on App Runner.** Enabling the flag enables every instance
  together. The canary is a synthetic application whose first parse fails, observed
  through the heartbeat/alert signals, with an immediate flag rollback.

## Acceptance

Integration tests run against real PostgreSQL whose tables, row-level-security
policies and `app_tenant` grants are extracted verbatim from the committed production
baseline (`packages/db/baseline/prod-public-schema.sql`), followed by the
post-baseline migrations. They cover one claim per document across two workers,
expired-lease recovery, stale-token rejection, tenant key isolation, withdrawal before
and after a claim and during inference, the retry cap, idempotent completion, budget
deferral without attempt consumption (gate before fetch, next-month deferral for a spent
budget), opted-out tenants excluded from claims and stats, due-time claim order,
extraction timeout and saturation, the activation cut-off, strict key shapes,
recent-only alerting, the published-guardrail requirement and the shared output
contract. A real S3/application canary, model
timeout under real AWS and shutdown between claim and completion still require
activation-stage testing.
