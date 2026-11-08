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

| Route                                                       | Who                                                                             | Notes                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /assessments/provider-assignments`                    | staff, `assessment:create` plus the vacancy IDOR probe                          | 1–6 instruments, the reason for each, the accommodations, an optional expiry. Each item echoes the locale, multiplier and aids in force |
| `POST /assessments/provider-assignments/{attemptId}/cancel` | staff, `assessment:update` plus the vacancy IDOR probe on the attempt's vacancy | Cancels an attempt whose sitting has not finished, at the provider first. Unknown, foreign and out-of-scope ids are the same 404        |
| `POST /platform/assessment-providers/bindings`              | platform owner                                                                  | Creates or reuses the provider tenant (idempotent on the org) and sets the enabled instruments                                          |
| `POST /portal/assessment-attempts/{attemptId}/launch`       | the candidate, by confirmed email                                               | Optional per-purpose consents. Returns the candidate token in the body only. Rate limit: `auth` tier                                    |
| `POST /webhooks/tims-assessments`                           | anonymous, HMAC                                                                 | `TIMS-Signature`, a 300 s replay window, de-duplication on `TIMS-Event-Id`                                                              |

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
  2. Call the provider with `Idempotency-Key = ats-attempt-<attemptId>`.
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
  A new key updates nothing: an existing subject comes back unchanged, and the contract has no subject update.
- **Subject PII.** Names and email go to the provider for every subject of an org whose binding enables a link-out
  instrument (PCA), and never otherwise. It cannot be decided per request: a subject first created for a native
  instrument without names would make a later PCA unlaunchable (422 `subject_data_required`). A PCA whose provider
  subject still lacks them (created before the org enabled PCA) is refused locally, before any assignment exists.
- **Webhooks.**
  - The inbox row is unique on (org, event_id).
  - A transient failure answers 503, so the provider's 72 h retries are the queue.
  - Lifecycle events move an attempt forward only (`ProviderAttemptStates.CanTransition`).
  - A result revision never overwrites a newer one. A corrected (non-voided) revision for a voided or expired attempt
    restores it, unless a newer attempt that was not cancelled exists (HR re-assigned the instrument, whatever became
    of the replacement since): then the revision is kept and the attempt is not reopened. This is FIT's rule for the
    current attempt.
  - An event for an unknown assignment is reconciled before it is ignored: `GET /v1/assignments/{id}` returns
    `external_ref` (the attempt id), so an attempt left in `pending_create` by a crash gets its provider id and the
    event is applied. An attempt the assign request mapped to this very assignment meanwhile is applied too. A
    cancelled attempt with no provider ids means the assignment is an orphan, and it is cancelled at the provider. A
    provider outage during that check answers 503.
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
  - The subject lock's interleaving (an erasure racing a mapping) is argued, not tested: the tombstone tests are
    sequential.

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

- `BaseUrl` (https origin)
- `TokenUrl`
- `ClientId`
- `ClientSecret`
- `Scopes` (default `catalog:read assignments:write results:read`)
- `WebhookSigningSecret`
- `WebhookSigningSecretPrevious` (during a rotation)
- `RequestTimeoutSeconds` (default 6)

A blank value or the terraform placeholder makes the client unconfigured:

- calls answer `provider_unconfigured`;
- webhooks are refused.

## FIT v2

`feat/fit-v2-per-instrument` was not merged when this was written. `IProviderAssessmentResultSource` has FIT v2's
`IAssessmentResultSource` signature, and `ProviderInstrumentResult` has its `InstrumentResult` fields. Once both
merge, its stub `ProviderAssessmentResultSource` becomes a one-to-one adapter over this port.

## Known gaps (not done here)

- A #312 withdrawal does not reach provider attempts. Results of a withdrawn candidate are still fetched and stored,
  open provider assignments are not cancelled, and no provider consent withdrawal is sent. The launch's #312 check
  runs outside the candidate lock. Needed before the flag is on.
- The provider tables are not in the DSAR export, and nothing on the ATS side asks the provider to erase a subject
  (`DELETE /v1/subjects/{id}`). Only a provider-initiated `subject.erased` reaches these tables.
- The contract has no subject update, so names and email cannot be added to a subject created before its org enabled
  PCA. Such a PCA is refused (`subject_data_required`) until the contract gains one.

## Owner steps, in order

1. Review the SQL. Apply it with psql on the direct connection (`:5432`).
2. Re-capture `packages/db/baseline/prod-public-schema.sql` in the same change and read the diff (it should be these
   four tables, their policies, grants and indexes). Then run `/gate` checks 14, 16 and 17.
   - Check 18 (`pre-flip-scan --flip-diff`) will list the four tables as "newly efcore-owned". They are new tables,
     not flips.
3. Register the ATS as an OAuth client at the provider:
   - the scopes;
   - the ATS portal origin in its CORS allow-list;
   - a webhook subscription to `https://<api>/webhooks/tims-assessments`.
4. Store the secrets: `AssessmentProviders__ClientSecret` and `AssessmentProviders__WebhookSigningSecret`. Watch
   for the placeholder trap.
5. Bind each org (platform owner), then set `Platform__AssessmentProvidersEnabled=true`.
