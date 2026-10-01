# Candidate data-processing consent: evidence and withdrawal (#313, #312) — 2026-10-01, not deployed

Colombia, Ley 1581 de 2012 / Decreto 1377 de 2013: the authorization must be prior, express and informed; the
controller must **keep proof** of it; the data subject may **revoke** it and request **deletion (supresión)**.

> **PENDING LEGAL REVIEW.** The consent sentence (`packages/shared/src/constants/application-consent.ts`, es/en
> `portal.consentCheckbox*`) and every new withdrawal text (`candidateConsent.*`, `portalConsentWithdrawal.*` in
> apps/web/lib/i18n) are product drafts. They have not been reviewed by Colombian counsel.

## What ships

| Piece | Where | Gate |
| --- | --- | --- |
| Per-application evidence row written in the application transaction | TS `portal.applyToVacancy` (minimal hook; the endpoint already wrote consent) | always on once the migration is applied |
| Consent status + evidence read | C# `GET /tenant/candidates/{id}/consent` (`candidate:read`, org scope) | `Platform__CandidateConsentEnabled` |
| Staff-recorded withdrawal | C# `POST /tenant/candidates/{id}/consent/withdrawal` (`candidate:update`, org scope) | same |
| Candidate self-service withdrawal | C# `POST /portal/consent/withdrawal` (confirmed-email session) | same |
| Candidate detail card, dashboard "Revocar autorización" | apps/web | `NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP` |
| Email suppression after withdrawal | TS assessment assign/reminder, offer signing link, interview emails | always on |
| DSAR export includes consents, evidence, requests | TS `platform.dataRequests.exportSubjectData` | always on |

### Evidence (#313)

`application_consent_evidence`, one row per `(application_id, consent_type)`: `text_version`; `text_sha256` =
SHA-256 of the exact sentence shown, computed **server-side** from the canonical text of that version, the form's
locale and the organization name (`renderApplicationConsentText`; a test fails if the i18n copy drifts from it);
`agreed_at`; `ip_hash` = SHA-256 of `<organizationId>:<client IP>` (pseudonymous: checkable against a known IP,
never stored raw); `user_agent` (control characters stripped, ≤512); `captcha_verified` (true only when Turnstile
actually verified). The subject-level `data_consents` row stays the **current status**. Existing applications are
backfilled from that row with `is_backfilled = true` and no hash/metadata. Soft references (no FK), like
`data_consents.subject_user_id`: proof must outlive the erasure of what it authorized.

### Withdrawal (#312) — what it does

- Marks `data_consents` withdrawn (`withdrawn_at`, `withdrawal_channel`, `withdrawal_reason`,
  `withdrawn_by_user_id`; NULL = the data subject). A candidate with no row gets a marker row
  `text_version = none:withdrawal-only` whose `agreed_at` is **not** an authorization date (the read hides it).
- Optionally (staff) / always (self-service) files a pending `data_subject_requests` deletion request.
- Audits `candidate_consent_withdrawn` in the same transaction (the free-text reason is not copied into the audit).
- Idempotent, serialized per candidate by a transaction-scoped advisory lock.
- After it: the public apply flow refuses that email (existing #302 check, uniform response) — a new application
  needs a fresh authorization the organization re-enables manually; assessment assignment/reminders and offer
  signing links are refused (`PRECONDITION_FAILED`); interview emails skip the candidate (evaluators still get them).
- **Nothing is deleted automatically.** Retention duties may apply; a human resolves the deletion request.
- Self-service withdraws every exact, case-insensitive email match in that organization (soft-deleted included,
  like the apply check), never a LIKE match, never another tenant's candidate. The answer is a uniform `202
  {received:true}` whether or not a candidate exists. Rate-limited on the strict `auth` tier.

## Not done (follow-ups)

- A staff queue/resolution UI for `data_subject_requests` (today: visible per candidate, resolvable only by SQL).
- Stopping AI scoring / CV parsing triggered by staff on already-received applications of a withdrawn candidate,
  and interview scheduling itself (only its emails are suppressed).
- Parity registration of the two staff routes (allowlisted, see the parity test) before the production flip.

## Activation order

1. Apply `packages/db/prisma/migrations/20261001120000_consent_evidence_withdrawal/migration.sql` via psql
   (additive, idempotent, includes the backfill) — **before** merging, because the TS apply flow writes the new
   table immediately.
2. Confirm Supabase *Confirm email* is ON (see `../candidate-portal-email-verification.md`).
3. Deploy C#; set `Platform__CandidateConsentEnabled=true` (needs `Invitations__SupabaseUrl` and
   `Invitations__SupabaseServiceKey` for the self-service email check; without them that route answers 503).
4. Then set `NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP=true` on the web.
