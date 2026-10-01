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

| Path                                   | Proves inbox ownership?                                        | Evidence                                                                                         |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Portal login (passwordless magic link) | Yes — the session exists only after the emailed link is opened | `signInWithOtp`, apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx:28                       |
| `/register` email + password sign-up   | Only if the project's **Confirm email** setting is ON          | `supabase.auth.signUp`, apps/web/app/(auth)/register/register-form.tsx:34                        |
| `/register` Google / Microsoft OAuth   | Delegated to the identity provider                             | register-form.tsx (`signUpGoogle`, `signUpMicrosoft`)                                            |
| Staff invitation set-up                | Yes (`email_confirm: true` after the emailed invitation token) | services/Tims.Platform/src/Tims.Infrastructure/PlatformInvitations/InvitationIdentityProvider.cs |

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
3. **The gate is only as strong as the project's Confirm-email setting.** With _Confirm email_ OFF, Supabase
   auto-confirms password sign-ups (sets `email_confirmed_at` immediately) — the local E2E stack runs that way
   (`e2e/supabase/config.toml:73`, `enable_confirmations = false`). **Production must keep Authentication →
   Providers → Email → "Confirm email" ON.** This cannot be verified from the repository; it is listed as an owner
   step in the PR.
4. **The C# withdrawal route checks that setting itself and fails closed.** Point 3 is the one assumption the
   `email_confirmed_at` check cannot verify, so `POST /portal/consent/withdrawal` reads the project's auth
   settings before trusting it. With `Platform:CandidateConsentEnabled` on, the API fetches
   `${Invitations:SupabaseUrl}/auth/v1/settings` (`apikey` header = the service key) and caches the answer for
   about 5 minutes. If `mailer_autoconfirm` is `true` — Supabase then marks every email sign-up confirmed
   without any proof of inbox ownership, so `email_confirmed_at` proves nothing — **or** the settings cannot be
   fetched or parsed, the route answers 503 with code `self_service_unavailable` (and a Spanish message telling
   the candidate to contact the organization) and withdraws nothing. The same 503 body is returned when the
   Supabase identity check is not configured at all. At startup, with the flag on and `Invitations:SupabaseUrl` /
   `Invitations:SupabaseServiceKey` missing or still `REPLACE_ME_OUT_OF_BAND`, the API logs a WARNING (it does not
   refuse to start). This guards
   only the C# route: the tRPC context and dashboard checks in point 2 still rely on the setting being right.

## Consequences / residuals

- A staff member signed in with a password whose staff email equals a candidate email can see that candidate's
  portal (same person, confirmed email) — unchanged by this decision.
- Stronger alternative not taken: require the session's `amr` to include `otp`/`magiclink` (proof of inbox access
  regardless of project settings). It would lock out OAuth sign-ins and staff who are also candidates; revisit if
  the Confirm-email setting cannot be guaranteed.
- **OAuth sessions are only as trustworthy as the identity provider's email claim. NOT mitigated in code.**
  The settings guard in point 4 covers email sign-ups only. For Google / Microsoft sign-ins Supabase sets
  `email_confirmed_at` from what the IdP returns, so the C# check passes whenever the provider says the email is
  confirmed. Azure AD / Entra ID can return an `email` claim that was never verified for some account types — the
  publicly reported "nOAuth" class of account takeover, where an app trusts a mutable, unverified email claim. A
  person who controls such a Microsoft account could set its email to a candidate's address, sign in to the
  portal, see that address's history and withdraw its consent. Until one of the options below is done, enabling
  the Microsoft provider on the production project widens who can act as a candidate. Nothing in the repository
  checks `xms_edov` or `amr` today. Options, none implemented by this PR:
  - restrict the Azure provider to a single-tenant / verified-domain setup and require the `xms_edov` (email
    domain owner verified) optional claim before trusting the address;
  - or require the session's `amr` to include a magic-link / email-OTP method for the portal withdrawal route
    (the stronger alternative above, applied to that route only).
