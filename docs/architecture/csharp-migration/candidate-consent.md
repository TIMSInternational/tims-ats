# Candidate data-processing consent: evidence and withdrawal (#313, #312) — 2026-10-01, not deployed

Colombia, Ley 1581 de 2012 / Decreto 1377 de 2013: the authorization must be prior, express and informed; the
controller must **keep proof** of it; the data subject may **revoke** it and request **deletion (supresión)**.

> **PENDING LEGAL REVIEW.** The consent sentence (`packages/shared/src/constants/application-consent.ts`, es/en
> `portal.consentCheckbox*`) and every new withdrawal text (`candidateConsent.*`, `portalConsentWithdrawal.*` in
> apps/web/lib/i18n) are product drafts. They have not been reviewed by Colombian counsel.

## What ships

| Piece                                                               | Where                                                                                                                      | Gate                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Per-application evidence row written in the application transaction | TS `portal.applyToVacancy` (minimal hook; the endpoint already wrote consent)                                              | always on once the migration is applied    |
| Consent status + evidence read                                      | C# `GET /tenant/candidates/{id}/consent` (`candidate:read`, org scope)                                                     | `Platform__CandidateConsentEnabled`        |
| Staff-recorded withdrawal                                           | C# `POST /tenant/candidates/{id}/consent/withdrawal` (`candidate:update`, org scope)                                       | same                                       |
| Candidate self-service withdrawal                                   | C# `POST /portal/consent/withdrawal` (confirmed-email session; fails closed with 503 when Supabase auto-confirms sign-ups) | same                                       |
| Staff notification of a new deletion request                        | in-app `notifications` row (same transaction) + email after commit, to the org's active `hr_admin` / `super_admin` users   | same                                       |
| Pending deletion-request queue                                      | C# `GET /tenant/data-subject-requests?status=pending` (`candidate:update`, org scope) + web `/settings/data-requests`      | same                                       |
| Scoring guard                                                       | FitEngine refuses / skips scoring for a candidate whose recruitment consent is withdrawn                                   | same                                       |
| Candidate detail card, dashboard "Revocar autorización"             | apps/web                                                                                                                   | `NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP` |
| Processing/email stop after withdrawal (every case-variant row of the email) | TS assessment assign/bulkAssign/reminder, offer signing link, staff applyToVacancy, AI screening, CV parsing, AI-interview session create (all `PRECONDITION_FAILED consent_withdrawn[:n]`, translated in the web toast); interview emails skip the candidate and staff are told; C# FitEngine vacancy compute skips them | always on |
| DSAR export includes consents, evidence, requests                   | TS `platform.dataRequests.exportSubjectData`                                                                               | always on                                  |

### Evidence (#313)

`application_consent_evidence`, one row per `(application_id, consent_type)`: `text_version`; `text_sha256` =
SHA-256 of the exact sentence shown, computed **server-side** from the canonical text of that version, the form's
locale and the organization name (`renderApplicationConsentText`; a test fails if the i18n copy drifts from it);
`agreed_at`; `ip_hash` = HMAC-SHA256 of `<organizationId>:<client IP>` keyed by the server-held
`CONSENT_EVIDENCE_IP_HMAC_KEY` (web/Vercel env, ≥32 chars; whoever holds the key can check a known IP against it,
nobody can recover the IP by enumeration without it; when the key is absent NO IP-derived value is stored — an
unkeyed hash of an IPv4 address is reversible by brute force, so it is never used); `user_agent` (control characters stripped, ≤512); `captcha_verified` (true only when Turnstile
actually verified). The subject-level `data_consents` row stays the **current status**. Existing applications are
backfilled from that row with `is_backfilled = true` and no hash/metadata — only applications created at or after
the consent's `agreed_at`, never from a withdrawn consent or a withdrawal-only marker (scratch-verified twice: a
pre-consent application, a withdrawn candidate, a marker and a no-consent candidate get no row). The table is
insert-only for `app_tenant` (UPDATE/DELETE revoked, like `audit_logs`; also revoked from `anon`/`authenticated`).

**Deploy safety.** The evidence insert runs behind a SAVEPOINT: if the table or a column is missing (code deployed
before the migration) the savepoint is rolled back, an error is logged and the application still commits — so the
pre-merge check is `SELECT to_regclass('public.application_consent_evidence') IS NOT NULL;`. Any other insert
error aborts the application. The apply transaction also takes the same per-candidate advisory lock as the C#
withdrawal, so an application cannot commit against a consent being revoked at that instant. Soft references (no FK), like
`data_consents.subject_user_id`: proof must outlive the erasure of what it authorized.

### Withdrawal (#312) — what it does

- Marks `data_consents` withdrawn (`withdrawn_at`, `withdrawal_channel`, `withdrawal_reason`,
  `withdrawn_by_user_id`; NULL = the data subject). A candidate with no row gets a marker row
  `text_version = none:withdrawal-only` whose `agreed_at` is **not** an authorization date (the read hides it).
- Optionally (staff) / always (self-service) files a pending `data_subject_requests` deletion request.
- Audits `candidate_consent_withdrawn` in the same transaction (the free-text reason is not copied into the audit).
- Idempotent, serialized per candidate by a transaction-scoped advisory lock.
- After it: the public apply flow refuses that email (existing #302 check, uniform response) — a new application
  cannot be re-authorized from the public form (today only a manual database change re-opens it — follow-up); assessment assignment/reminders and offer
  signing links are refused (`PRECONDITION_FAILED`); interview emails skip the candidate (evaluators still get them).
- **Nothing is deleted automatically.** Retention duties may apply; a human resolves the deletion request.
- Self-service withdraws every exact, case-insensitive email match in that organization (soft-deleted included,
  like the apply check), never a LIKE match, never another tenant's candidate. The answer is a uniform
  `202 {received:true}` whether or not a candidate exists. Rate-limited on the strict `auth` tier.
- Self-service is refused, not weakened, when the email proof cannot be trusted: the route reads Supabase's
  `/auth/v1/settings` (cached ~5 minutes) and answers `503 { code: "self_service_unavailable", message }` (Spanish:
  contact the organization) if `mailer_autoconfirm` is `true` or the settings cannot be read, and the same body
  when the identity check is not configured. With the flag on and `Invitations__SupabaseUrl` /
  `Invitations__SupabaseServiceKey` missing or `REPLACE_ME_OUT_OF_BAND`, startup logs a WARNING. Why: see
  `../candidate-portal-email-verification.md` (decision point 4).
- When a withdrawal **creates** a new `data_subject_requests` row (not on an idempotent repeat), every active
  `hr_admin` / `super_admin` user of that organization gets an in-app `notifications` row in the same transaction
  and, after commit, an email. Email failures are logged without personal data and never fail the request. The
  notice states the 15-business-day answer period of Ley 1581 de 2012, art. 15.
- Scoring honours withdrawal: FitEngine refuses (or skips) scoring a candidate whose recruitment consent is
  withdrawn.

### Pending-request queue

`GET /tenant/data-subject-requests?status=pending` (`candidate:update`, org scope, same flag) returns up to 200
pending requests of the caller's organization with a computed `dueAt` = `createdAt` + 15 business days, counting
Monday–Friday only. **Colombian public holidays are NOT excluded**, so `dueAt` can be EARLIER than the legal
deadline — deliberately conservative, never later. The web page `/settings/data-requests` lists them and
highlights the overdue ones. It is read-only: resolving is the runbook below.

### Resolving a request (manual runbook — there is no endpoint)

Before marking a request `completed`, a human decides what is actually deleted or anonymized and does it: Ley
1581 permits keeping data the organization has a legal or contractual duty to retain, so this stays a judgement,
never an automatic delete. Record that decision outside this table (the request row has no notes column), then
close the request and audit it in one transaction:

```sql
BEGIN;
SET LOCAL app.current_org_id = '<org uuid>';  -- harmless as a BYPASSRLS owner; needed under app_tenant
UPDATE data_subject_requests
   SET status = 'completed',            -- or 'rejected'
       resolved_at = now() AT TIME ZONE 'utc',
       resolved_by_user_id = '<staff user uuid>',
       updated_at = now() AT TIME ZONE 'utc'
 WHERE id = '<request uuid>'
   AND organization_id = '<org uuid>'
   AND status = 'pending';
-- expect: UPDATE 1 (UPDATE 0 = wrong id/org, or already resolved: ROLLBACK and check)
INSERT INTO audit_logs (id, organization_id, user_id, actor_id, action, entity, entity_id, metadata, created_at)
VALUES (gen_random_uuid(), '<org uuid>', '<staff user uuid>', '<staff user uuid>',
        'data_subject_request_resolved', 'data_subject_request', '<request uuid>',
        '{"status":"completed","channel":"runbook"}'::jsonb, now() AT TIME ZONE 'utc');
COMMIT;
```

Notes, checked against the schema: both tables store **UTC wall-clock time in `timestamp(3) without time zone`**
(the C# writers store `DateTime.UtcNow` with Kind=Unspecified), hence `now() AT TIME ZONE 'utc'` — a bare `now()`
would be converted to the session time zone. `data_subject_requests.updated_at` has no database default (Prisma
`@updatedAt`) and must be set by hand; neither table has a database default for `id`, hence `gen_random_uuid()`.
`audit_logs.metadata` is `jsonb`; `audit_logs.user_id` / `actor_id` reference `users(id)`, so `<staff user uuid>`
must be the staff member's `users.id`. `status` is a free `VARCHAR(20)` with no check constraint — type
`completed` / `rejected` exactly. Keep `"status"` in the audit metadata equal to the value written.

## Not done (follow-ups)

- A resolution endpoint/UI for `data_subject_requests` (the queue is read-only; resolving is the SQL runbook above).
- Holiday-aware `dueAt` (Colombian public holidays) for the queue.
- Interview scheduling itself is not blocked (only its candidate emails are suppressed, and staff are told). The TS
  `fit-engine.service.ts` compute path and existing `fit_scores` rows of withdrawn candidates are not yet guarded
  (the C# FitEngine compute skips them). The automatic CV processing of the public apply flow cannot run for a
  withdrawn email (the apply is refused first).
- OAuth (Microsoft / Entra ID) email-claim trust for self-service withdrawal — residual, not mitigated in code; see
  `../candidate-portal-email-verification.md`.
- Parity registration of the staff routes (the two withdrawal/read routes are allowlisted, see the parity test; the
  new pending-request queue route needs the same decision) before the production flip.

## Activation order

1. Apply `packages/db/prisma/migrations/20261001120000_consent_evidence_withdrawal/migration.sql` via psql
   (additive, idempotent, includes the backfill) — **before** merging, because the TS apply flow writes the new
   table immediately.
   Pre-merge check: `SELECT to_regclass('public.application_consent_evidence') IS NOT NULL;` must return `t`.
   Set `CONSENT_EVIDENCE_IP_HMAC_KEY` (≥32 random chars, server-only) in the web environment; without it no IP
   pseudonym is stored.
2. Confirm Supabase _Confirm email_ is ON (see `../candidate-portal-email-verification.md`).
3. Deploy C#; set `Platform__CandidateConsentEnabled=true` (needs `Invitations__SupabaseUrl` and
   `Invitations__SupabaseServiceKey` for the self-service email check; without them that route answers 503
   `self_service_unavailable` and startup logs a WARNING). The same 503 is returned while the project auto-confirms
   sign-ups (`mailer_autoconfirm`), so step 2 must be done first.
4. Then set `NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP=true` on the web.
