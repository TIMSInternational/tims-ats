# Public-application CV recovery (.NET 10)

Status: draft implementation for #333. The retry schema, lease repository,
bounded PDF/DOCX extraction, ETag-pinned S3 reader, guarded Bedrock Converse
parser, per-organization budget/usage ledger and API-hosted loop are implemented.
The loop is **disabled by default and not deployed/activated**. It must remain
off until the migration, AWS permissions, alert and synthetic production canary
below are verified. The existing post-response TypeScript parse handles new
applications first; .NET recovers only visible unparsed rows.

## Existing boundary

`portal.applyToVacancy` commits the application, consent evidence and an unparsed
`candidate_documents` row together. Its post-response TypeScript task retrieves the
uploaded object, extracts PDF/DOCX text and calls the gated CV agent. A terminated
function, S3 error, budget denial or model error leaves `parsed_data` null. The
document must remain visible to staff and application submission must still succeed.
The AI door now distinguishes validated output from its empty fallback; malformed
output must not mark the document parsed or enter the cache.

## Runtime decision

Run the reconciler in the **deployed .NET 10 API host** behind
`Platform__CvParseRecoveryEnabled=false` by default.
`Tims.Workers` has a Quartz host in source but no production deployment; registering a
job there alone cannot close the gap. The host owns dedicated S3, Bedrock and
database clients, catches transient failures without stopping the API and coordinates across App
Runner instances through PostgreSQL leases. Move the loop to `Tims.Workers` only
after that host is deployed and the API loop is disabled.

The .NET processor uses the S3 reader, bounded PDF/DOCX extractor and guarded
Bedrock Converse parser. It never calls a tRPC procedure or mints a staff token.
The parser requires an explicit guardrail ID and version, sanitizes the bounded
prompt, validates every result field, rejects an empty structured response and
records token usage before accepting output. Invalid or guardrail-blocked output
is a failed attempt, never an empty success. The existing Haiku 4.5 US inference
profile is the default; no raw-CV cache exists. The budget defaults to $25 per
organization per month, matching the TypeScript gate. Because the TS and .NET
callers can overlap, this pre-call budget check is a conservative control, not
an atomic cross-runtime spend reservation; measure actual cost at canary.

## Durable state and concurrency

The `candidate_documents` migration adds attempt count, next eligible time,
lease token/expiry and a bounded reason code. `parsed_data` remains the success
indicator. A partial index on unparsed CV rows eligible for retry avoids scanning
the entire documents table. Apply this DDL before deploying code that reads the
new columns. The Prisma model and migration travel together.

The repository claims at most 10 CVs older than two minutes with `FOR UPDATE SKIP LOCKED`,
then commits the claims before doing network work. Claim increments the attempt
count and sets a unique lease token. Completion or rescheduling requires that token,
the exact document id and organization id; a stale worker cannot overwrite a newer
result. Check the candidate is active, the application consent is not withdrawn and
the S3 key begins `cv-uploads/{organizationId}/` before fetching. Immediately
before inference, recheck the current lease and consent under the same candidate
advisory lock used by withdrawal. Hold a transaction-scoped lock through the
bounded parse (30 seconds total, including a 20-second Bedrock call) so the
guarantee survives Supavisor transaction pooling; this reserves one database
connection per active inference. Verify pool capacity and idle-in-transaction
timeout before enabling the two-per-instance loop. Completion
rechecks consent and `parsed_data IS NULL`. A withdrawn or deleted subject is
never sent to Bedrock after withdrawal has committed. Preserve the document and
staff visibility on failure.

Transient failures back off (5, 20, then 60 minutes) with a fixed maximum of four
recovery attempts. Corrupt/empty files are terminal with a reason code; no raw CV text, email,
filename or provider error message is stored in retry state or logs. The worker
logs PII-free claimed/completed/failed/ineligible counts and, every five minutes,
due/leased/exhausted counts and oldest due age. A stable `CV_RECOVERY_ALERT`
warning fires when an exhausted document exists or oldest due age exceeds ten
minutes. Configure a CloudWatch log metric filter and SNS alarm for that warning
before activation; App Runner 5xx alarms cannot detect a stalled background loop.
Each API instance runs at most two concurrent Bedrock calls. Measure spend under
the 25-candidate beta load before raising it.

## Activation order (no production mutation in this PR)

1. Merge prerequisite #356, then apply Prisma migration
   `20261010180000_cv_parse_retry_leases` to production and verify its five
   columns and partial index. **Apply before deploying an image built from the
   updated Prisma model.** Keep the recovery flag off.
2. Grant the running App Runner instance role `s3:GetObject` only on the CV
   bucket's `cv-uploads/*` prefix, including a cross-account bucket policy if
   needed. Alternatively, supply a dedicated least-privilege
   `CV_UPLOADS_AWS_ACCESS_KEY_ID`/`CV_UPLOADS_AWS_SECRET_ACCESS_KEY` pair from
   the runtime secret store. The currently configured AWS account does not list
   the CV bucket, and the instance role currently has no CV S3 policy, so its
   ownership and access must be confirmed before activation. Grant Bedrock model
   invocation on the chosen inference profile and all its routed foundation-model
   Regions, plus the selected guardrail. If Bedrock uses a separate account,
   store only its dedicated key pair in the runtime secret store. AWS documents the
   [inference-profile IAM scope](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html)
   and [guardrail permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions.html).
   The read-only 2026-10-10 check found only a DRAFT guardrail in the current
   CLI account; confirm the actual inference account and publish/select an
   immutable guardrail version before setting the runtime variable.
3. Supply `CV_UPLOADS_BUCKET`, `CV_UPLOADS_REGION`, `BEDROCK_AWS_REGION`,
   `BEDROCK_GUARDRAIL_ID`, and pinned `BEDROCK_GUARDRAIL_VERSION` to App Runner.
   Optionally supply `AI_DEFAULT_MONTHLY_BUDGET_USD`. The model is pinned to
   Haiku 4.5 so token metering cannot silently understate another model's price.
   Verify the guardrail's PII policy, AWS quota and model access in that account.
   The 2026-10-10 read-only App Runner check found none of these CV recovery
   variable names present; add them without replacing its existing env/secret map.
4. Configure/confirm the alert recipient with `scripts/ops/create-alarms.sh`.
   The existing SNS topic had **zero confirmed subscriptions** in the read-only
   2026-10-10 check. Dry-run `scripts/ops/create-cv-recovery-alarm.sh`, then run
   it with `--apply` only after a confirmed subscription exists (the script
   refuses to mutate otherwise). Verify SNS delivery with a controlled alarm
   test, then enable
   `Platform__CvParseRecoveryEnabled=true` on a canary instance. Use a clearly
   synthetic application whose first parse fails; verify the one existing
   document later gains valid `parsed_data`, one candidate profile is updated,
   one usage row is charged, and no duplicate application/document is created.
   Verify malformed output, disabled budget, withdrawn consent and S3 errors
   retain a visible unparsed document without leaking CV text into logs.
5. Observe due/exhausted counts and actual Bedrock cost for the 25-candidate
   beta load. Leave the switch off or roll it back if alerts, cost or latency
   exceed the agreed beta thresholds.

## Acceptance

Local tests against real PostgreSQL with forced RLS and two worker instances cover one claim
per document, expired-lease recovery, stale-token rejection, tenant key isolation,
withdrawal before and after a claim, retry cap and idempotent completion. Test
PDF/DOCX extraction with small synthetic files, malformed model output, budget
denial, withdrawal before inference and during the consent gate, and end-to-end
synthetic PDF processing. A 2026-10-10 operator-profile smoke through the real
Haiku inference profile and DRAFT guardrail returned a valid fenced JSON parse
for a fictional CV (162 input, 169 output tokens); the .NET parser test accepts
that fence shape. This proves model/guardrail behavior in that operator account,
not App Runner IAM or a published guardrail version. A real S3/application canary,
model timeout under real AWS and shutdown between claim and completion still
require activation-stage testing.
The flag stays off until migration, IAM, alert and canary are verified.
