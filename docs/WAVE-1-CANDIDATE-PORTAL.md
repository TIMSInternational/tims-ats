# Wave 1 — Authenticated Candidate Portal (Design)

> Status: approved Jun 8 2026 (portal-first). Companion: `docs/REMAINING-WORK.md` (canonical status),
> `docs/API-SPEC.md` §24 (portal endpoints), `docs/PRODUCT-MAP.md` (phased plan — note it is stale).

## Goal
Let an applicant sign in and see their own pipeline — applications, interviews, offer — closing the
recruitment loop's candidate-facing end. Org-scoped, passwordless, no new staff surface.

## Decisions (interview, Jun 8)
- **Auth:** passwordless magic-link / OTP (Supabase `signInWithOtp`). No password.
- **Scope:** dashboard (My Applications + stage timeline · My Interviews + join link · My Offer) + offer
  accept via the **existing** token flow. **Assessment-taking + full webcam proctoring → Wave 1.5.**
- **Offer accept:** portal links to the existing `/offers/sign/[token]` page — no new accept backend.

## Alignment note
`API-SPEC.md` §24 documents this dashboard (`getMyApplications` → "Candidate dashboard", `getApplicationStatus`
→ "Status tracker", `getMyInterviews`, `getMyOffer`). The spec frames candidates as a `candidate` RBAC role;
in reality applicants are not org members, so this design uses a **dedicated candidate session** (email→Candidate)
instead of an RBAC role — a deliberate mechanism divergence. `PRODUCT-MAP` ranks Assessment Integration above the
dashboard; portal-first was chosen anyway (Jun 8) to ship a lower-risk visible slice before the large
assessment backend build.

## Core problem & approach
The existing `portal.getMy*` are `protectedProcedure`, which assumes a **staff `User` with `organizationId`**.
Applicants have only a `Candidate` row — no `User`, no org membership — so those endpoints are currently
**unreachable by real candidates**.

**Approach: a new, org-scoped candidate session — never a staff user.**
- The portal is **org-scoped** (lives under `careers/[orgSlug]`). A candidate resolves as
  **(Supabase-verified email) × (org from the route)** → the `Candidate` row in that org. Sidesteps multi-org
  ambiguity and fits the endpoints' single-org assumption.
- New tRPC `candidateProcedure`: requires a Supabase session, reads the target org (from `x-org-slug` header /
  input), looks up `Candidate{ organizationId, email }`; if none → `FORBIDDEN`. Sets a candidate-scoped ctx
  `{ candidateId, organizationId, email }` and runs inside `runWithTenant(orgId)` so RLS applies. Exposes **no
  roles/permissions** — staff `protectedProcedure`/`permissionProcedure` and platform routes reject a candidate
  session by construction (`ctx.user` stays null for them).
- `getMy*` move/duplicate onto `candidateProcedure` (read-only, candidate's own rows only).

## Auth flow
1. `/careers/[orgSlug]/login` — email → `supabase.auth.signInWithOtp({ email, emailRedirectTo: …/dashboard })`.
   Rate-limited. Always "check your email" (no account enumeration).
2. Magic link → existing `/auth/callback` exchanges the code → Supabase session cookie.
3. `/careers/[orgSlug]/dashboard` (server component): verify session; resolve `Candidate{orgId,email}`; absent →
   friendly "no applications for this email at {org}" + sign-out. Else render dashboard.
4. Middleware: allow `/careers/*/login` + `/careers/*/dashboard`; `/dashboard` requires a session but must **not** redirect
   candidates into the staff app.

## Data contract (reuse existing returns; no shape changes)
- `getMyApplications` → `[{ id, appliedAt, vacancy{title,company}, currentStage{name} }]`
- `getApplicationStatus(applicationId)` → `{ status, movements[{toStage,movedAt}] }` (timeline)
- `getMyInterviews` → `[{ id, type, status, scheduledAt, duration, location, meetingUrl, vacancy{title} }]`
  (`meetingUrl` = Daily.co join link)
- `getMyOffer(offerId)` → offer fields; portal shows details + "Review & sign" deep-link to
  `/offers/sign/[token]` when a signing token exists, else "awaiting signing link"

## Vertical slices (one PR each — /ship + fresh review)
1. **Candidate session** — `candidateProcedure` + login page + OTP + `/dashboard` shell. *Security-sensitive → fresh review.*
2. **My Applications** — list + stage-timeline detail.
3. **My Interviews** — schedule list + join link (+ ICS/"add to calendar" if cheap).
4. **My Offer** — details + deep-link to the existing signing page.

## Explicitly deferred → Wave 1.5
- Assessment-taking ("Player"): `AssessmentQuestion`/`AssessmentResponse` schema, `submitAssessment`, scoring
  (auto vs `assessment-evaluator` agent), taking UI. (PRODUCT-MAP Priority 2 / core differentiator.)
- **Full webcam proctoring** (rides with assessment-taking): webcam snapshots + browser-integrity events →
  `ProctoringSession`, **Habeas-Data/GDPR consent**, image storage, staff review UI. Likely its own milestone.

## Cross-cutting / risks
- **RLS:** candidate queries run via `tenantDb` under `runWithTenant(orgId)` — same fail-closed path as staff.
  Verify a candidate session reads **only** its own `Candidate`'s rows.
- **Enumeration/abuse:** OTP send rate-limited; login responses don't reveal whether an email exists.
- **i18n + mobile:** acceptance criteria for the new pages (es/en parity, responsive).
- **No assessment links** surface in Wave 1 (taking flow deferred) — dashboard omits assessments to avoid dead ends.
- Documented-but-out-of-scope portal endpoints: `requestDataDeletion` (Habeas-Data), `submitNps`.
