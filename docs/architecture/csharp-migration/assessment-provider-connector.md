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

| Route                                                 | Who                                                    | Notes                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `POST /assessments/provider-assignments`              | staff, `assessment:create` plus the vacancy IDOR probe | 1–6 instruments, the reason for each, the accommodations, an optional expiry                         |
| `POST /platform/assessment-providers/bindings`        | platform owner                                         | Creates or reuses the provider tenant (idempotent on the org) and sets the enabled instruments       |
| `POST /portal/assessment-attempts/{attemptId}/launch` | the candidate, by confirmed email                      | Optional per-purpose consents. Returns the candidate token in the body only. Rate limit: `auth` tier |
| `POST /webhooks/tims-assessments`                     | anonymous, HMAC                                        | `TIMS-Signature`, a 300 s replay window, de-duplication on `TIMS-Event-Id`                           |

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
  - A provider `consent_required` answer returns the missing purposes.
- **No automatic rejection.** Nothing here rejects a candidate. Results feed FIT v2 as values or as `needs_review`.
- **Server-authoritative timing and scoring; no keys on the wire.** These are the provider's job by contract.
  - The ATS stores only the typed result (percentile / CEFR / level, versions, validity) and the provider's `scores`
    object for HR.
  - The parser refuses `scores` on a summary projection.
- **Accommodations.**
  - Stored and sent: a `time_multiplier` from 1 to 3, and allowed `aids` codes.
  - Never stored or sent: a reason or a diagnosis.
- **Integrity.** `ProviderFitMapping` rules:
  - Only a `valid` `selection` result on a `result_ready` attempt that is not flagged for review is `Valid`.
  - Voided or review results are `NeedsReview`, with no value.
  - `development` results are never reported.
- **Visibility.** Results are fetched with `audience=tenant_hr`, and the provider enforces the level. A
  `result_not_visible` answer stores nothing.
- **Audit.** Every write appends its `audit_logs` row in the same transaction. The cases:
  - assign;
  - a provider refusal;
  - consent capture;
  - launch;
  - each state change;
  - a received result;
  - an erasure;
  - a binding.

  Metadata holds ids, versions and states only.

- **In-flight sessions.**
  - The provider pins the instrument and content version on the assignment.
  - The ATS stores both on the attempt and on the result.

## Idempotency and crash safety

- **Assign.**
  1. Reserve `pending_create` attempts in one transaction: all instruments or none. A partial unique index allows
     at most one open attempt per candidate + vacancy + instrument.
  2. Call the provider with `Idempotency-Key = ats-attempt-<attemptId>`.
  3. On an outage, the attempt stays `pending_create`. Re-sending the same request replays the same key.
  4. A 4xx refusal cancels the attempt.
- **Subject and tenant keys** carry a hash of the request body, because the contract rejects one key with two bodies.
- **Webhooks.**
  - The inbox row is unique on (org, event_id).
  - A transient failure answers 503, so the provider's 72 h retries are the queue.
  - Lifecycle events move an attempt forward only (`ProviderAttemptStates.CanTransition`).
  - A result revision never overwrites a newer one.
  - An event for an unknown assignment is reconciled before it is ignored: `GET /v1/assignments/{id}` returns
    `external_ref` (the attempt id), so an attempt left in `pending_create` by a crash gets its provider id and the
    event is applied. A provider outage during that check answers 503.
- **One lock per attempt.** Every webhook write, the launch and the subject erasure of one attempt take the same
  `pg_advisory_xact_lock` on `assessment-provider-attempt:<id>`:
  - a launch never rewinds a state a webhook already set;
  - a result write checks for `erased` and `cancelled` under the lock, before inserting anything, so a result fetched
    before a `subject.erased` committed is never stored after it.

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
