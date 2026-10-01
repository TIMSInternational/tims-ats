# ADR: candidate-portal email verification (2026-10-01, #312 follow-up of #302)

**Status:** accepted. **Decision owner:** Federico (one production setting below is his to confirm).

## Context

The candidate portal identifies a candidate by **email within the organization** — there is no candidate account:
`candidateProcedure` resolves `ctx.supabaseAuth.email` (packages/api/src/trpc.ts:77-89) and the dashboard looks the
candidate up by the session email (apps/web/app/(portal)/careers/[orgSlug]/dashboard/page.tsx). Whoever holds a
Supabase session for an address therefore sees that address's application history, interviews, offers and
assessments, and — since #312 — can revoke its data-processing authorization. PR #302 left open whether that
session must prove ownership of the inbox.

How sessions come to exist on this Supabase project:

| Path | Proves inbox ownership? | Evidence |
| --- | --- | --- |
| Portal login (passwordless magic link) | Yes — the session exists only after the emailed link is opened | `signInWithOtp`, apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx:28 |
| `/register` email + password sign-up | Only if the project's **Confirm email** setting is ON | `supabase.auth.signUp`, apps/web/app/(auth)/register/register-form.tsx:34 |
| `/register` Google / Microsoft OAuth | Delegated to the identity provider | register-form.tsx (`signUpGoogle`, `signUpMicrosoft`) |
| Staff invitation set-up | Yes (`email_confirm: true` after the emailed invitation token) | services/Tims.Platform/src/Tims.Infrastructure/PlatformInvitations/InvitationIdentityProvider.cs |

So the magic-link flow alone guarantees ownership, but it is not the only way to obtain a session for an address.

## Decision

1. **Applying stays frictionless.** `portal.applyToVacancy` is public and needs no session; nothing changes there.
2. **Application history and self-service privacy actions require a CONFIRMED email**, enforced server-side in
   three places:
   - tRPC context: `supabaseAuth` is only populated when `email_confirmed_at` is set
     (apps/web/app/api/trpc/[trpc]/route.ts:111), so every `candidateProcedure` read refuses an unconfirmed session.
   - Dashboard page: an unconfirmed session gets a "verify your email" notice and **no candidate lookup**
     (dashboard/page.tsx:21); the assessment player redirects there (assessments/[assignmentId]/page.tsx:20).
   - C# `POST /portal/consent/withdrawal` re-asks Supabase's `/auth/v1/user` for `email_confirmed_at` (it does not
     trust the token's claims) and requires the returned user id to equal the token's `sub`
     (services/Tims.Platform/src/Tims.Api/CandidateConsent/CandidateConsentEndpoints.cs).
3. **The gate is only as strong as the project's Confirm-email setting.** With *Confirm email* OFF, Supabase
   auto-confirms password sign-ups (sets `email_confirmed_at` immediately) — the local E2E stack runs that way
   (`e2e/supabase/config.toml:73`, `enable_confirmations = false`). **Production must keep Authentication →
   Providers → Email → "Confirm email" ON.** This cannot be verified from the repository; it is listed as an owner
   step in the PR.

## Consequences / residuals

- A staff member signed in with a password whose staff email equals a candidate email can see that candidate's
  portal (same person, confirmed email) — unchanged by this decision.
- Stronger alternative not taken: require the session's `amr` to include `otp`/`magiclink` (proof of inbox access
  regardless of project settings). It would lock out OAuth sign-ins and staff who are also candidates; revisit if
  the Confirm-email setting cannot be guaranteed.
