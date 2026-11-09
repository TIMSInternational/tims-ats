# AS-5: the TIMS Assessments provider connector

Status: implemented, dark (`Platform:AssessmentProvidersEnabled=false`). The migration is committed and **not applied**.
Proven locally on 2026-11-09, not in production: against a real tims-suite `/v1` (release/assessments-v1 at b8e3b6dc,
contract e583dd8) running on one machine, `apps/web/e2e/assessments-cross` drives binding, the vacancy's tests, apply,
assign, candidate consent (with and without the optional voice consents), the hosted player for LIA, English and
Personality, signed webhooks, result intake, FIT v2, the HR and team-leader (D6) views, cancel, expiry, consent
withdrawal and DSAR export and erasure: 14 of 14 hops pass. Not proven: anything that needs AWS (the English speaking
upload and its AI scoring, the ITC-IA judge), the framed player, approved (non-draft) consent texts, and any
production deployment. Production remains unproven.

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

| Route                                                                                                 | Who                                                                             | Notes                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /assessments/provider-assignments`                                                              | staff, `assessment:create` plus the vacancy IDOR probe                          | 1–6 instruments, the reason for each, the accommodations, an optional expiry. Each item echoes the locale, multiplier and aids in force                                |
| `POST /assessments/provider-assignments/{attemptId}/cancel`                                           | staff, `assessment:update` plus the vacancy IDOR probe on the attempt's vacancy | Cancels an attempt whose sitting has not finished, at the provider first. Unknown, foreign and out-of-scope ids are the same 404                                       |
| `POST /platform/assessment-providers/bindings`                                                        | platform owner                                                                  | Creates or reuses the provider tenant (idempotent on the org) and sets the enabled instruments                                                                         |
| `GET /assessments/provider-catalog?vacancyId=`                                                        | staff, `assessment:read` (+ the vacancy scope probe with `vacancyId`)           | The instruments this org may assign (binding AND catalog for selection), with delivery, locales, consents, versions and the version the vacancy is pinned to           |
| `GET /assessments/provider-attempts?candidateId=`                                                     | staff, `assessment:read`; out-of-scope vacancies omitted                        | Status chip, how the vacancy counts it (D3, D20) and the result (validity, reviewPending, minimum met). D6: below company scope, no level, reasons or accommodation    |
| `POST /portal/assessment-attempts/{attemptId}/launch`                                                 | the candidate, by confirmed email                                               | Optional per-purpose consents and `embedded`. Returns the hosted launch (D16): the player's single-use URL and its frame ancestors, body only. Rate limit: `auth` tier |
| `GET /portal/assessment-attempts?organizationSlug=`                                                   | the candidate, by confirmed email                                               | The candidate's own attempts at that org, one coarse status each (D9), the consent purposes still missing, the start deadline                                          |
| `GET /portal/assessment-attempts/{attemptId}/consent-templates?locale=es\|en`                         | the candidate, by confirmed email                                               | The provider's consent templates for the purposes the attempt still needs; 404 unless it is the candidate's and needs consent                                          |
| `POST /webhooks/tims-assessments`                                                                     | anonymous, HMAC                                                                 | `TIMS-Signature`, a 300 s replay window; a `TIMS-Event-Id` that differs from the signed body is a 400; de-duplication on the body's `event_id`                         |
| `GET /platform/assessment-providers/organizations/{organizationId}/candidates/{candidateId}/export`   | platform owner                                                                  | DSAR access: the ATS's provider tables for one candidate plus the provider's own export of each of its subjects, audited fail-closed, `no-store` (D15)                 |
| `POST /platform/assessment-providers/organizations/{organizationId}/candidates/{candidateId}/erasure` | platform owner                                                                  | `DELETE /v1/subjects/{id}` for each provider subject of the candidate; 202 when all were accepted, 503 to retry (D15)                                                  |

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
    consents when the session starts, not at launch.
  - So the ATS keeps the provider's `missing_consents` on the attempt (at create, on every poll, on a launch's
    `consent_required`, minus each purpose a launch recorded), and the portal shows **consent needed** until it is
    empty: the provider's counsel-reviewed templates (`GET /v1/catalog/consent-templates/{purpose}`) as plain text, one
    acceptance each, then the launch records each purpose against the exact `text_version` shown.
- **No automatic rejection.** Nothing here rejects a candidate. Results feed FIT v2 as values or as `needs_review`.
- **Server-authoritative timing and scoring; no keys on the wire.** These are the provider's job by contract.
  - The ATS stores only the typed result (percentile / CEFR / level, versions, validity) and the provider's `scores`
    object for HR.
  - The parser refuses `scores` on a summary projection.
- **Age attestation.** The amended contract requires `age_attestation` on every create, and the provider never
  defaults it. HR attests the band on the assign request (`ageBand`: `18_plus` or `16_17`, required; never an age or a
  date of birth); it is stored on the attempt (part of its terms: another band is a terms conflict) and sent with every
  create. A pending attempt without one is refused locally (`age_attestation_required`) before anything is sent; 422
  `age_band_not_supported` is a definitive refusal.
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

- **Same version for every candidate of a vacancy** (design §6.3). A new attempt takes the version the EARLIEST
  attempt of the same vacancy and instrument carries (any state), stored on the row at reserve so every re-send of its
  create carries the same body, and the create sends it as `instrument_version`. The vacancy's first attempt sends
  none (the provider pins its current GA); the provider also refuses a different version for the vacancy
  (409 `vacancy_version_mismatch`).
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

## Hosted launch (D16)

Every launch is `mode: hosted`. The response is checked against the amended contract: the mode echoed, an https
`hosted_url`, `frame_ancestors` as at most 20 registered origins for a native launch, and **no** candidate token or
token type (refused as off contract: a hosted launch never hands the host a credential for the sitting). The URL carries
a single-use launch code: it goes to the candidate's own response body only, and every `ToString` redacts it.

- `return_url` = `AssessmentProviders:PortalBaseUrl` (an https origin registered at the provider) +
  `/careers/{org slug}/dashboard`, unless the portal asked for an **embedded** launch (it will frame the player, and the
  portal refuses to be framed, so the player ends on its own screen). The portal asks for one only for a native
  instrument with a configured player origin, and if the launch then cannot be framed it launches again top-level (the
  new launch revokes the unused first code), so a top-level sitting always returns to the dashboard.
- The portal frames the player only when the launch's frame ancestors include its own origin AND the URL is on
  `NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN`, the only origin added to the portal's CSP `frame-src` and delegated camera and
  microphone. Otherwise it links out (top-level, same tab). A URL that is not https is never opened.
- **#312 inside the candidate lock.** `LaunchUnderCandidateLockAsync` takes the attempt lock and then the per-candidate
  lock the withdrawal takes (the order result storage uses), re-reads the attempt and the withdrawn-consent predicate,
  calls the provider with both locks held, and records the launch before committing. A withdrawal committed first stops
  the launch before any provider call; one that starts during the call waits and then stages the launched attempt. The
  record is conditional (`withdrawal_state IS NULL`): a same-email sibling's withdrawal takes only its own candidate
  lock, so if it staged the attempt during the call, nothing is recorded and the URL never reaches the candidate (the
  cascade cancels the assignment, revoking the unused code).
- **Erasure.** An attempt whose provider subject has an accepted erasure is never launched again: refused before any
  consent capture (the capture announcement is conditional on it too), under the locks, and by the same conditional
  record if the erasure is accepted during the provider call (it marks the attempt under the subject lock only).
  The ATS's own stored results for the subject are erased as soon as the provider accepts the request (or confirms
  the subject gone), never waiting on `subject.erased`: that event may never arrive, and the poller skips attempts
  under an erasure request. Its handler repeats the local erasure idempotently when it lands. The local erasure runs
  before the erasure marker (separate transactions), so an interruption between them leaves the results deleted and
  the run incomplete (retry). A create announced before the markers may still create a NEW provider subject (the
  provider forgot the erased subject's external_ref): the erasure re-reads the candidate after its markers and stays
  incomplete (503) while such a create is live or recorded a subject the run did not erase; an unanswered create
  with no recorded subject makes the next run resolve (tenant, candidate id) again.
- **Portal status (D9).** A finished attempt that holds a result shows as completed even when a later revision voided
  it; "needs review" is only a sitting voided before any result (D4).

## Polling fallback (D17)

Webhooks stay the primary signal; `ProviderAttemptPollHostedService` (every 5 minutes, registered only with the
connector on) re-reads stale attempts so nothing depends on a webhook arriving:

- **Claimable:** mapped, not in a #312 cascade, no erasure requested, no orphan cleanup pending; a sitting state
  (`created`, `launched`, `in_progress`, `completed`) untouched for 15 minutes (`created`/`launched` only until a week
  after the start deadline), or an attempt that HOLDS a stored result (`result_ready`, or `voided`/`expired` by a
  revision) re-read every 6 hours for 30 days after completion: a later void, or a review overturning one, is a new
  result revision (D12).
- **Lease:** one conditional `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` claims ONE attempt for this
  process's owner id, lease free or expired (10 minutes, database clock); the poll of that attempt is cancelled after 4
  minutes, then the lease is released, and the next is claimed (at most 25 per organization per run). The lease
  therefore always outlives the work done under it: two App Runner instances never poll the same attempt, and neither
  waits on the other. The release is conditional on the owner and stamps `last_polled_at`; an instance that dies frees
  its lease when it expires.
- **Per attempt:** `GET /v1/assignments/{id}` (checked: tenant, subject, instrument, external ref), the missing consents
  recorded, the status applied through the same forward-only locked write a lifecycle webhook uses, and `result_id`
  fetched through `ProviderResultIntake`, the same guarded, revision-ordered path as `result.ready`. A 404 (confirmed or
  not) changes nothing. A withdrawn candidate's attempt is staged for the cascade and nothing is fetched.
- `listResults` is not needed: `result_id` is stable across revisions and `GET /v1/results/{id}` returns the latest.

## Webhook inbox (contract step 6: acknowledge first, process asynchronously)

`POST /webhooks/tims-assessments` does only what must precede the 2xx: the signature over the raw body (300 s window),
the envelope and header checks, the tenant lookup, and ONE committed insert into `assessment_provider_webhook_inbox`
(unique on org + event id) with `next_attempt_at` = now (database clock). It answers 200 `queued` (or `duplicate` for an
event already processed or ignored) without any provider call, well inside the sender's 10 s timeout. The row is the
durable record: a crash after the commit loses nothing.

`ProviderInboxWorkerHostedService` (registered only with the connector on) applies the events. It runs as soon as the
route commits a row (an in-process wake-up) and at least every 15 s otherwise, so a retry that comes due or an event
another instance received is picked up without a wake-up:

- **Lease:** one conditional `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` claims the org's oldest
  due row for this process's owner id, lease free or expired (15 minutes, database clock). Processing is cancelled after
  10 minutes, so the lease outlives the work; an instance that dies frees the row when the lease expires. The completion
  is conditional on the owner.
- **Outcome:** processed or ignored rows become final (`next_attempt_at` NULL). A transient failure (an outage, a #312
  cascade still pending, an exception, a run past the budget) is rescheduled: 30 s, doubling, capped at 1 hour, for 72
  hours from receipt (the sender's own retry window), then left `failed` with `retry_exhausted` for operators. A
  failure no retry can fix (`invalid_data`) is final at once. A redelivery of a row that is not final makes it due
  again.
- **Backstop:** the D17 poller re-reads every stale attempt whatever happened to its events.

Migration `20261109055548_assessment_provider_queues` adds `next_attempt_at`, `lease_owner`, `lease_until` (CHECK: both
or neither) and the partial index `ix_assessment_provider_webhook_inbox_due`, and makes rows recorded before it that are
not final due at once.

## Idempotency key in use

The amended contract makes 409 `idempotency_key_in_use` a contract code: an earlier request with the same key and body
is still being processed and nothing was done for this one. It is transient, never a definitive refusal (a
`pending_create` attempt stays pending). The client waits it out once in place, with the same key and body, when
`Retry-After` is at most 2 s (1 s when absent); otherwise it returns the delay to the caller. A consent capture
answered with it counts as unanswered, so the launch leaves the capture announced for the #312 fence.

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

Two later migrations alter `assessment_provider_attempts` only (no grant or RLS change; the table's grants and policy
cover new columns): `20261108224533_assessment_provider_consent_capture` (the consent-capture fence) and
`20261109010328_assessment_provider_attempt_poll` (`missing_consents` with a CHECK against the four purposes,
`poll_lease_owner`, `poll_lease_until` with a CHECK that both are set or both null, `last_polled_at`, the partial index
`ix_assessment_provider_attempts_poll`, and `age_band` with a CHECK against `18_plus`/`16_17`). Each has its own
idempotent script in `db/manual`, applied in order.

## Configuration

`AssessmentProviders:*`, set out of band as App Runner env from Secrets Manager:

- `BaseUrl`: an https origin or base path. Owner default D18: the suite serves `/v1` under `/api`, so production is
  `https://www.timssuite.com/api`. Every call path (`v1/...`) is joined relative to it.
- `TokenUrl`
- `ClientId`
- `ClientSecret`
- `Scopes` (default `catalog:read assignments:write subjects:write results:read`). The DSAR export asks for a
  separate token with `subjects:export` ALONE, so no ordinary call carries it.
- `PortalBaseUrl` (optional, an https origin): the candidate portal the hosted player returns to (D16)
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
provider result committed before its read. A provider attempt's state change or a stored provider result now
enqueues a FIT v2 recompute of that candidate's row for the vacancy, in the same transaction (EF migration
`20261109011531_fit_v2_provider_recompute`, triggers only, no model change; it calls the Prisma-owned
`fit_v2_request_recompute` only when that function exists, so the two migrations apply in either order). See
`fit-v2-per-instrument.md`, "Recompute on change".

## Unconfirmed 404s

A provider that does not serve a route answers its catch-all 404 with the same `not_found` code as "no such
resource". The callers of the cancel route clear their cleanup marker on a 404, and erasure counts a 404 as done, so
the client confirms a 404 first: `GET /v1/assignments/{id}` for a cancel (404/410 confirms; an assignment already
`cancelled` is returned as the success), `GET /v1/subjects/{id}` for an erasure (404 confirms, 410 is returned as
already erased). The #312 cascade's consent calls follow the same rule: a consent-list 404 is confirmed by the subject
lookup, and a withdrawal 404 by re-listing the subject's consents (absent: the 404 stands; no longer `active`: the
success; still active: unconfirmed). Anything unconfirmed is the transient `provider_not_found_unconfirmed`, which no
caller reads as gone, so the attempt's cascade stays pending.

## Consent captures and the withdrawal cascade (completion fence)

A launch records consents at the provider; a #312 withdrawal's cascade lists and withdraws them. Two races could leave
a consent active behind a completed (`done`) cascade: a pass that listed before a racing capture landed and then
completed, and a launch cancelled (or failing) after the provider stored a consent but before its re-check. Migration
`20261108224533_assessment_provider_consent_capture` adds the fence that closes both:

1. Before sending any capture, the launch announces it with ONE conditional write: it bumps
   `consent_capture_generation` and `consent_captures_in_flight` and stamps `consent_capture_started_at` (database
   clock), only while `withdrawal_state IS NULL`. An attempt already in a withdrawal is refused (nothing is captured or
   launched). Row locking orders this write against the withdrawal's staging write.
2. When every capture of the launch got an HTTP answer, the launch ends it (generation bumped again, in-flight count
   decremented). A capture without an answer (timeout, outage, cancellation, crash) stays in flight: the provider may
   still store it.
3. A pass reads each attempt's fence (generation, in flight, stale = in flight and started more than 10 minutes before,
   by the database clock) BEFORE it lists consents, and `done` is a conditional write on it: same generation, and no
   capture in flight unless it was already stale at that read. Otherwise the attempt stays pending, and a later pass
   (listing after the capture landed) withdraws the consent.

The post-capture #312 re-check stays: it keeps a withdrawn candidate from getting a token and drives the cascade at
once. A pending attempt is retried by the scheduled sweep (see Known gaps) without waiting for its next webhook or
the org's next withdrawal.

### The create fence

The same race exists for a create: a pass whose lookup by `external_ref` came back empty while `POST /v1/assignments`
was still in flight, then completed, would leave the assignment live at the provider if the ATS died before recording
the create's answer (Codex P1). Migration `20261109055548_assessment_provider_queues` adds `create_started_at`:

1. Before the create is sent, ONE conditional write stamps it (database clock), only while the attempt is
   `pending_create`, not in a withdrawal and not under an erasure request; refused otherwise, and nothing is sent.
2. Recording the provider's answer clears it (the mapping, or the orphan with its cleanup marker); so does a definitive
   refusal. A create without an answer leaves it in place: the provider may still create the assignment.
3. A pass reads it with the consent fence, BEFORE any lookup. While it is set and not stale (10 minutes), the attempt
   stays pending unless that pass found and recorded the assignment; `done` is also conditional on it at the database.

### The cascade's lease

Every pass (after a withdrawal, from a webhook, from a launch, or the scheduled sweep) claims the pending attempts it
works on with `withdrawal_lease_owner` / `withdrawal_lease_until` (one conditional UPDATE with `FOR UPDATE SKIP
LOCKED`, 15 minutes, database clock), is cut off after 8 minutes, and releases them when it ends. Two instances never
send the same cancels and withdrawals at once; the sweep's organization listing skips attempts under a live lease.

## Optional consents: English speaking

The English instrument administers its speaking section only when the optional purposes `voice` and `ai_scoring` are
active. The portal offers them on the consent step of an English attempt, apart from the required texts, each with its
own UNTICKED checkbox, with the D22 "draft pending counsel" note: leaving them unticked never blocks the start. The
launch records the ticked ones at the provider like any consent, and the attempt keeps the candidate's decision
(`granted_optional_consents`, `declined_optional_consents`, migration `20261109055548`). An attempt shows "consent
needed" until the candidate has decided. HR's attempt row reads "speaking not assessed (no voice consent)" (or "no
AI-scoring consent") when the candidate declined. The provider's consent texts themselves are the provider's and
pending counsel (D2, D22).

## ITC-IA review flag

`requires_human_review` is a top-level field of `ItciaResultV1`, not part of `scores`, so a summary projection carries
it too. A present non-boolean value is off contract and the result is refused.

## Known gaps (not done here)

- The withdrawal cascade's scheduled retry (`ProviderWithdrawalSweepHostedService`, registered only with the connector
  on) sweeps every 10 minutes: it lists, pre-tenant, the organizations holding pending attempts not under a live lease
  and propagates each under its own tenant scope, several passes while they make progress. Each pass works only on the
  attempts it claimed (see "The cascade's lease"). A sweep handles at most 200 organizations and 20 passes of 50
  attempts per organization. Attempts blocked at the head of an organization's queue hold the rest of that queue until
  they clear.
- The poller handles at most 200 organizations and 25 attempts per organization per run; more waits for the next run.
  A provider that answers 404 forever for an assignment keeps that attempt polled every 15 minutes (until a week past
  its start deadline for one that never started).
- Erasure and export resolve the candidate's provider subject through the provider's idempotent (tenant, candidate id)
  subject key, so a subject created by a failed or crashed assignment is covered too. If the candidate never had a
  subject, that call creates an empty one (no names or email). A stored erasure is terminal: once every attempt of the
  candidate is erased or under an accepted erasure request, the subject is NOT resolved again (the provider forgets its
  external_ref when erasure is requested, so resolving would create a fresh, empty subject), and a subject whose
  `subject.erased` is recorded is listed as `erased` without calling the provider.
- The provider-held export must fit the client's 256 KiB response cap; a larger one fails the export closed (503).
- D2 (the effects of a withdrawal on completed results and media) is the provider's, and pending counsel.

## Owner steps, in order

1. Review the SQL. Apply the files in `services/Tims.Platform/db/manual`, in this order, with psql on the direct
   connection (`:5432`): `20261107232524_assessment_providers.sql`, `20261108224533_assessment_provider_consent_capture.sql`,
   `20261109010328_assessment_provider_attempt_poll.sql`, `20261109011531_fit_v2_provider_recompute.sql`,
   `20261109030506_fit_v2_provider_erasure_recompute.sql`, then `20261109055548_assessment_provider_queues.sql`.
2. Re-capture `packages/db/baseline/prod-public-schema.sql` in the same change and read the diff (it should be these
   four tables, their policies, grants and indexes). Then run `/gate` checks 14, 16 and 17.
   - Check 18 (`pre-flip-scan --flip-diff`) will list the four tables as "newly efcore-owned". They are new tables,
     not flips.
3. Register the ATS as an OAuth client at the provider. The provider refuses a token request for any scope the client
   was not granted (`invalid_scope`), and the ATS then gets no token at all, so grant every one:
   - `catalog:read`, `assignments:write`, `subjects:write`, `results:read` (the ATS's default `Scopes`; `subjects:write`
     includes subject enrichment);
   - `subjects:export` (the DSAR export, which the ATS requests ALONE in a separate token);
   - `events:subscribe` (managing the webhook subscription in step 4; the ATS's own calls never request it);
   - as the client's registered origin, the candidate portal's https origin, exactly `AssessmentProviders__PortalBaseUrl`
     (the hosted player's `return_url`, CORS, and the `frame_ancestors` that let the portal frame the player).
4. Create the webhook subscription (nothing automates it): with a client-credentials token for that client requesting
   `events:subscribe`, `POST {BaseUrl}/v1/webhook-subscriptions` with the URL `https://<api>/webhooks/tims-assessments`
   and the event types `assignment.started`, `session.completed`, `session.voided`, `result.ready`,
   `assignment.expired`, `assignment.voided`, `subject.erased`, sending an `Idempotency-Key` header. The signing secret
   is returned ONCE, in that create's response: store it as `AssessmentProviders__WebhookSigningSecret`. On a rotation
   the provider signs with both secrets for 24 hours; keep the old one in `...Previous` meanwhile.
5. Store the secrets: `AssessmentProviders__ClientSecret` and `AssessmentProviders__WebhookSigningSecret`. Watch
   for the placeholder trap. Set `AssessmentProviders__PortalBaseUrl` to the portal origin registered in step 3.
6. Bind each org (platform owner), then set `Platform__AssessmentProvidersEnabled=true`.
7. On Vercel, set `NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP=true` to show the portal section, and only if the player
   is to be framed, `NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN` (the hosted player's https origin). Both are build-time.
