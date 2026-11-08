# AS-5: the TIMS Assessments provider connector

Status: implemented, dark (`Platform:AssessmentProvidersEnabled=false`). The migration is committed and **not applied**.
Nothing here has run against a real provider: the TIMS Assessments API v1 exists only as a contract.

Sources:

- the AS-5 work package in `assessments-integration-2026-11-06` §7.C;
- the headless direction in `assessment-platform-headless-2026-11-07` §2.4 and §6;
- the contract on `TIMSInternational/tims-interop` branch `feat/assessments-v1-contract`: `contracts/openapi/tims-assessments.v1.yaml`, `schemas/assessments/**` and `contracts/events/assessments-*`.

## What changed from the AS-5 plan

The 11-06 plan had native MIL instruments in the ATS, and it wrote one `assessment_assignments` row per instrument.
Here every instrument is a **remote** provider, and provider attempts live only in the new tables:

- **`assessment_assignments` and `assessment_results` are not written.** The TS candidate portal lists those rows
  and would try to run a provider attempt as a native quiz. Keeping them apart means the native-quiz flow, and its
  in-flight sessions, are untouched. The HR read surfaces (AS-7) read the new tables.
- **The per-org instrument enablement is a column of the binding** (`enabled_instruments`), not its own table.
- **There is no local catalog.** The provider's `GET /v1/catalog/instruments` is the catalog. A binding may enable
  only instruments that the catalog offers for `selection`.

## Routes (all dark)

| Route                                                                                                 | Who                                                                             | Notes                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /assessments/provider-assignments`                                                              | staff, `assessment:create` plus the vacancy IDOR probe                          | 1–6 instruments, the reason for each, the accommodations, an optional expiry. Each item echoes the locale, multiplier and aids in force        |
| `POST /assessments/provider-assignments/{attemptId}/cancel`                                           | staff, `assessment:update` plus the vacancy IDOR probe on the attempt's vacancy | Cancels an attempt whose sitting has not finished, at the provider first. Unknown, foreign and out-of-scope ids are the same 404               |
| `POST /platform/assessment-providers/bindings`                                                        | platform owner                                                                  | Creates or reuses the provider tenant (idempotent on the org) and sets the enabled instruments                                                 |
| `POST /portal/assessment-attempts/{attemptId}/launch`                                                 | the candidate, by confirmed email                                               | Optional per-purpose consents. Returns the candidate token in the body only. Rate limit: `auth` tier                                           |
| `POST /webhooks/tims-assessments`                                                                     | anonymous, HMAC                                                                 | `TIMS-Signature`, a 300 s replay window; a `TIMS-Event-Id` that differs from the signed body is a 400; de-duplication on the body's `event_id` |
| `GET /platform/assessment-providers/organizations/{organizationId}/candidates/{candidateId}/export`   | platform owner                                                                  | DSAR access to the ATS's provider tables for one candidate (attempts and stored results), audited fail-closed, `no-store` (D15)                |
| `POST /platform/assessment-providers/organizations/{organizationId}/candidates/{candidateId}/erasure` | platform owner                                                                  | `DELETE /v1/subjects/{id}` for each provider subject of the candidate; 202 when all were accepted, 503 to retry (D15)                          |

## Hiring guardrails, and where each one is enforced

- **Job-relatedness.**
  - The vacancy must list the instrument in `job_profiles.fit_requirements.assessments[]`.
  - The vacancy's `reason` wins over HR's. With neither, the request is refused.
  - Implemented in `JobRelatedness` and `AssignProviderInstrumentsUseCase`.
- **#312 withdrawal.**
  - Checked at assign, and again inside the reserve transaction under the withdrawal's own
    `pg_advisory_xact_lock(hashtextextended(candidate_id))`.
  - Checked again at **every** launch.
  - The predicate is the FIT engine's: the candidate, or a same-org candidate with the same `lower(btrim(email))`.
  - **It reaches the provider (owner default D15, 2026-11-08).** The withdrawal's own transaction, under the same
    candidate lock, runs `ProviderWithdrawalSql`: every attempt of the candidate (and of a same-email sibling) gets
    `withdrawal_state = pending`; one that has not finished is cancelled, and one mapped to a provider assignment gets
    `provider_cancel_pending`. Registered only when `Platform:AssessmentProvidersEnabled` is on (the tables must exist).
    After the commit, `ProviderConsentWithdrawalUseCase` looks up unmapped attempts by `external_ref`, cancels the
    orphans, withdraws every active provider consent of each subject (`POST .../consents/{id}/withdrawal`) and only
    then moves the attempt to `done` by a conditional write. A failed step stays `pending`: every webhook for such an
    attempt drives another pass and answers 503 until it is confirmed (the provider's redelivery is the queue).
  - No result is fetched for an attempt in the cascade, and `StoreResultAsync` re-checks the withdrawal under the
    candidate lock (lock order subject -> attempt -> candidate), so a result fetched before a withdrawal committed is
    not stored after it.
- **Consent per purpose.**
  - The portal sends the purposes the candidate accepted.
  - Each one is recorded at the provider, with an `audit_logs` row whose id is the provider's `host_record_ref`.
  - Where the gate is enforced is the provider's. For a **link-out** instrument (PCA) the launch itself answers
    `consent_required`, and the ATS returns the missing purposes. For a **native** instrument the contract checks
    consents when the candidate's browser starts the session (`POST /v1/sessions`), not at launch: the ATS launch
    succeeds with consents missing and the provider refuses the session. The ATS does not pre-check them.
- **No automatic rejection.** Nothing here rejects a candidate. Results feed FIT v2 as values or as `needs_review`.
- **Server-authoritative timing and scoring; no keys on the wire.** These are the provider's job by contract.
  - The ATS stores only the typed result (percentile / CEFR / level, versions, validity) and the provider's `scores`
    object for HR.
  - The parser refuses `scores` on a summary projection.
- **Accommodations.**
  - Stored and sent: a `time_multiplier` from 1 to 3, and allowed `aids` codes.
  - Never stored or sent: a reason or a diagnosis.
  - A re-send whose accommodation (or locale, or reason) differs from the open attempt's is a 409
    `open_attempt_terms_differ` naming that attempt, never a 200 that keeps the old terms. HR cancels the attempt
    (the cancel route) and assigns again. The expiry is not compared; the response echoes the one in force.
- **Integrity.** `ProviderFitMapping` rules:
  - One entry per instrument: the most recently assigned attempt that was not cancelled decides.
  - Only a `valid` `selection` result on a `result_ready` attempt that is not flagged for review, sat at exactly the
    time multiplier it was assigned with, is `Valid`.
  - Voided or review results, and a multiplier mismatch, are `NeedsReview`, with no value.
  - `development` results are never reported.
- **Visibility.** Results are fetched with `audience=tenant_hr`, and the provider enforces the level. A
  `result_not_visible` answer stores nothing.
- **Audit.** Every write to an attempt, a result or a binding appends its `audit_logs` row in the same transaction.
  The cases:
  - assign (the reserve);
  - the provider ids attached (`created`, or `erased` when a tombstone exists);
  - a failed create, refused (cancelled) or still pending;
  - consent capture;
  - launch;
  - each webhook state change;
  - a received result;
  - a staff cancel;
  - an erasure;
  - a binding.

  The webhook inbox is not audited row by row: it is itself the delivery record. Metadata holds ids, versions,
  codes and states only.

- **In-flight sessions.**
  - The provider pins the instrument and content version on the assignment.
  - The ATS stores both on the attempt and on the result.

## Idempotency and crash safety

- **Assign.**
  1. Reserve `pending_create` attempts in one transaction: all instruments or none. A partial unique index allows
     at most one open attempt per candidate + vacancy + instrument.
  2. Call the provider with `external_ref = <attemptId>` and `Idempotency-Key = ats-attempt-<attemptId>`. An attempt
     that was already sent once (not reserved by this request) is first looked up with
     `GET /v1/assignments?tenant_id=&external_ref=<attemptId>` (owner default D11, 2026-11-08): a found assignment is
     recorded, and only an empty lookup sends the create. A failed lookup keeps the attempt pending and sends nothing.
     This closes the case where the 24 h `Idempotency-Key` window expired; the provider also keeps
     (tenant, external_ref) unique permanently.
  3. Only a contract refusal that proves nothing was created (`ProviderFailure.IsDefinitiveRefusal`:
     `invalid_request`, `not_found`, `vacancy_version_mismatch`, the 422 validation codes, ...) cancels the attempt.
  4. Everything else keeps it `pending_create`, and re-sending the same request replays the same key: an outage, a
     timeout, 429, 5xx, a concurrent request still creating it (409 `idempotency_key_in_use`), a reused key, an
     off-contract 2xx, an unknown code.
  5. A staff cancel of a `pending_create` attempt is local. A local cancel lands only while the attempt still names
     the provider assignment the caller cancelled (or none): if the create was answered between the caller's read
     and its lock, that assignment is cancelled at the provider first.
  6. If the create was still in flight when the attempt was cancelled, its answer is recorded on the cancelled
     attempt (provider ids, `last_error_code = provider_cancel_pending`, audited) and cancelled at the provider. Only
     a confirmed cancel (or a 404/410) clears the marker. Until then the staff cancel route retries it (503 while the
     provider is down) and so does any webhook for that assignment (503 to the sender, which redelivers). A crash
     before the answer was recorded is caught by reconciliation instead.
- **Subject and tenant keys** carry a hash of the request body, because the contract rejects one key with two bodies.
  A new key updates nothing: an existing subject comes back unchanged; only `PATCH /v1/subjects/{id}` changes it.
- **Subject PII.** Names and email go to the provider for every subject of an org whose binding enables a link-out
  instrument (PCA), and never otherwise. A PCA whose provider subject lacks them (created before the org enabled
  PCA) is enriched with `PATCH /v1/subjects/{id}` (scope `subjects:write`) before the assignment is created, and a
  link-out launch answered 422 `subject_data_required` is patched and launched once more. Only a candidate with no
  usable names or email is refused locally (`subject_data_required`), before any assignment exists.
- **Webhooks.**
  - The inbox row is unique on (org, event_id).
  - A transient failure answers 503, so the provider's 72 h retries are the queue.
  - Lifecycle events move an attempt forward only (`ProviderAttemptStates.CanTransition`).
  - `assignment.voided` (the only void signal for a link-out sitting, which has no session) voids the attempt like
    `session.voided`. An in-progress session is relaunched past `expires_at` (it bounds only the start); the provider
    decides.
  - Once a result is stored, its revisions alone decide validity: a `session.voided` never moves an attempt out of
    `result_ready`, nor lands on any attempt that holds a stored result (checked on the fresh read under the attempt
    lock that result storage also takes). The provider finalizes a sitting once (voided XOR completed with a result)
    and re-publishes a later void as a new result revision, so such a `session.voided` is a reordered delivery;
    applying it would undo a corrected revision that no re-fetch could restore.
  - A result revision never overwrites a newer one. A corrected (non-voided) revision for a voided or expired attempt
    restores it, unless a newer attempt that was not cancelled exists (HR re-assigned the instrument, whatever became
    of the replacement since): then the revision is kept and the attempt is not reopened. This is FIT's rule for the
    current attempt.
  - An event for an unknown assignment is reconciled before it is ignored: `GET /v1/assignments/{id}` returns
    `external_ref` (the attempt id), so an attempt left in `pending_create` by a crash gets its provider id and the
    event is applied. An attempt the assign request mapped to this very assignment meanwhile is applied too. A
    cancelled attempt with no provider ids means the assignment is an orphan: it is first recorded on the attempt (ids
    - `provider_cancel_pending`, under the attempt lock), then cancelled at the provider through the same cleanup as
      a recorded orphan, so a failed cancel stays retryable by the staff cancel route and later events. A refusal a
      redelivery would not change is acknowledged and recorded as failed in the inbox; the marker stays. A provider
      outage during reconciliation or the cancel answers 503.
- **Locks, fresh reads, and the erasure tombstone.**
  - Every webhook write, the launch and the subject erasure of one attempt take the same
    `pg_advisory_xact_lock` on `assessment-provider-attempt:<id>`. Mapping (`MarkCreatedAsync`), result storage and
    erasure first take `assessment-provider-subject:<provider subject id>`, always before the attempt lock.
  - Under the lock, every write clears the request's EF change tracker and re-reads, so a value tracked before the
    lock (for example the `pending_create` row the reserve left) is never written back over a committed transition.
  - A recorded `subject.erased` inbox row is the erasure tombstone, matched on `lower(data->>'subject_id')` (the
    payload is stored verbatim, and a UUID may arrive in any case). A mapping that commits after it leaves the attempt
    `erased`, and a result for that subject is never stored, even when the erasure ran before the attempt had its
    provider ids.
  - A launch or a staff cancel never rewinds a state a webhook already set.
  - The subject lock's interleaving is tested both ways (`AssessmentProviderWithdrawalTests`): an erasure waiting on
    a mapping in flight erases the attempt that mapping commits, and a mapping waiting on an erasure in flight leaves
    the attempt erased. Each test goes red when its method's subject lock is removed.

## Tables: migration `20261107232524_assessment_providers`

The tables:

- `assessment_provider_bindings`
- `assessment_provider_attempts`
- `assessment_provider_results`
- `assessment_provider_webhook_inbox`

All four are org-scoped, with ENABLE + FORCE RLS and the `tenant_isolation` policy.

Privileges:

- `anon` and `authenticated` are revoked, behind a guard on whether those roles exist.
- `app_tenant` gets:
  - SELECT only on bindings, which the platform owner writes on the privileged connection;
  - no DELETE on the inbox;
  - full DML on attempts and results.

The generated idempotent SQL is `services/Tims.Platform/db/manual/20261107232524_assessment_providers.sql`. It came
from `dotnet ef migrations script --idempotent --context AssessmentProviderDbContext`, with the BOM stripped.

## Configuration

`AssessmentProviders:*`, set out of band as App Runner env from Secrets Manager:

- `BaseUrl`: an https origin or base path. Owner default D18: the suite serves `/v1` under `/api`, so production is
  `https://www.timssuite.com/api`. Every call path (`v1/...`) is joined relative to it.
- `TokenUrl`
- `ClientId`
- `ClientSecret`
- `Scopes` (default `catalog:read assignments:write subjects:write results:read`)
- `WebhookSigningSecret`
- `WebhookSigningSecretPrevious` (during a rotation)
- `RequestTimeoutSeconds` (default 6)

A blank value or the terraform placeholder makes the client unconfigured:

- calls answer `provider_unconfigured`;
- webhooks are refused.

## FIT v2

Both are on `release/assessments-fit-provider`. `Tims.Application.FitEngine.ProviderFitResultSource` adapts
`IProviderAssessmentResultSource` to FIT v2's `IAssessmentResultSource`: a field-for-field copy of each
`ProviderInstrumentResult`, keeping only the six provider instruments (never `native_quiz`), no value on a
needs-review result, and the source tag `provider`. It is composed into FIT's source only with
`Platform:AssessmentProvidersEnabled` on, because the provider tables exist only once the migration is applied; with
the connector off, a provider instrument a vacancy lists shows as `no_result`.

It reads the provider tables on their own connection, under `TenantScope`, while FIT v2 holds its
per-(organization, candidate, vacancy) advisory lock, so a compute that follows another compute's commit reads every
provider result committed before its read. Nothing recomputes FIT when a provider result arrives; the next compute
picks it up, as for every other FIT input.

## Unconfirmed 404s

A provider that does not serve a route answers its catch-all 404 with the same `not_found` code as "no such
resource". The callers of the cancel route clear their cleanup marker on a 404, and erasure counts a 404 as done, so
the client confirms a 404 first: `GET /v1/assignments/{id}` for a cancel (404/410 confirms; an assignment already
`cancelled` is returned as the success), `GET /v1/subjects/{id}` for an erasure (404 confirms, 410 is returned as
already erased). Anything else is the transient `provider_not_found_unconfirmed`, which no caller reads as gone.

## ITC-IA review flag

`requires_human_review` is a top-level field of `ItciaResultV1`, not part of `scores`, so a summary projection carries
it too. A present non-boolean value is off contract and the result is refused.

## Known gaps (not done here)

- The withdrawal cascade has no scheduled sweeper: a pass runs after each withdrawal and on every webhook for an
  attempt in the cascade. An attempt whose provider never sends another event, and whose org sees no further
  withdrawal, stays `pending` (results stay stopped; the provider-side withdrawal is not sent) until one of those
  happens. A worker that runs `PropagateAsync` per org would close it.
- The launch's #312 check runs outside the candidate lock. A launch that records consent re-checks #312 after the
  provider recorded it: a withdrawal seen then re-opens the attempt's cascade, which withdraws that consent, and
  nothing is launched; a withdrawal committed after the re-check lists consents after this one exists. A launch
  without new consents that races a withdrawal can still mint a token; the cascade cancels the assignment.
- Erasure resolves the candidate's provider subject through the provider's idempotent (tenant, candidate id) subject
  key, so a subject created by a failed or crashed assignment is erased too. If the candidate never had a subject,
  that call creates an empty one (no names or email) that is then erased.
- The DSAR export covers the ATS's own provider tables. What the provider itself holds (media, its access log) is its
  `GET /v1/subjects/{id}/export`, which needs the `subjects:export` scope and is not called here.
- D2 (the effects of a withdrawal on completed results and media) is the provider's, and pending counsel.

## Owner steps, in order

1. Review the SQL. Apply it with psql on the direct connection (`:5432`).
2. Re-capture `packages/db/baseline/prod-public-schema.sql` in the same change and read the diff (it should be these
   four tables, their policies, grants and indexes). Then run `/gate` checks 14, 16 and 17.
   - Check 18 (`pre-flip-scan --flip-diff`) will list the four tables as "newly efcore-owned". They are new tables,
     not flips.
3. Register the ATS as an OAuth client at the provider:
   - the scopes, including `subjects:write` (subject enrichment);
   - the ATS portal origin in its CORS allow-list;
   - a webhook subscription to `https://<api>/webhooks/tims-assessments`.
4. Store the secrets: `AssessmentProviders__ClientSecret` and `AssessmentProviders__WebhookSigningSecret`. Watch
   for the placeholder trap.
5. Bind each org (platform owner), then set `Platform__AssessmentProvidersEnabled=true`.
