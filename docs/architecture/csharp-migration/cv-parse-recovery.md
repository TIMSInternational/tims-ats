# Public-application CV recovery (.NET 10)

Status: implementation contract for #333. The retry schema, .NET lease repository
and bounded PDF/DOCX text extraction are implemented. S3 retrieval, the guarded
Bedrock parser and hosted loop are **not yet deployed**.

## Existing boundary

`portal.applyToVacancy` commits the application, consent evidence and an unparsed
`candidate_documents` row together. Its post-response TypeScript task retrieves the
uploaded object, extracts PDF/DOCX text and calls the gated CV agent. A terminated
function, S3 error, budget denial or model error leaves `parsed_data` null. The
document must remain visible to staff and application submission must still succeed.
The AI door now distinguishes validated output from its empty fallback; malformed
output must not mark the document parsed or enter the cache.

## Runtime decision

Run the reconciler in the **deployed .NET 10 API host** behind a default-off flag.
`Tims.Workers` has a Quartz host in source but no production deployment; registering a
job there alone cannot close the gap. The host must resolve its own scoped run on each
tick, catch transient failures without stopping the API and coordinate across App
Runner instances through PostgreSQL leases. Move the loop to `Tims.Workers` only
after that host is deployed and the API loop is disabled.

The .NET processor must own S3 retrieval, the bounded PDF/DOCX text extractor and
the Bedrock CV parser. It must not call an end-user tRPC procedure or mint a staff token.
Before the flag is enabled, port the current AI door's monthly budget, guardrail,
bounded prompt, schema validation and usage accounting to a shared .NET AI service.
Use the existing Haiku inference profile and no raw-CV cache. A malformed response is
a failed attempt, never an empty success. Keep credentials in the runtime secret
store and IAM scoped to the CV bucket and Bedrock model/guardrail.

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
the S3 key begins `cv-uploads/{organizationId}/` before fetching. Recheck consent
and `parsed_data IS NULL` in the final transaction. A withdrawn or deleted subject
is never sent to Bedrock. Preserve the document and staff visibility on failure.

Transient failures back off (5, 20, then 60 minutes) with a fixed maximum of four
recovery attempts. Corrupt/empty files are terminal with a reason code; no raw CV text, email,
filename or provider error message is stored in retry state or logs. The worker
emits counts and oldest-age metrics for unparsed, leased, exhausted and successful
jobs. Alert on an exhausted job or a backlog older than the grace window. Limit
concurrent Bedrock calls to two initially and measure cost under the 25-candidate
beta load before raising it.

## Acceptance

Test against real PostgreSQL with forced RLS and two worker instances: one claim
per document, expired-lease recovery, stale-token rejection, tenant key isolation,
withdrawal before and after a claim, retry cap and idempotent completion. Test
PDF/DOCX extraction with small synthetic files, malformed model output, Bedrock
timeout, budget denial and shutdown between claim and completion. A production
canary needs an explicitly synthetic application whose first parse fails, whose
retry later succeeds, and whose candidate/document count remains one. The flag
stays off until those tests, migration, IAM and operational alert are verified.
