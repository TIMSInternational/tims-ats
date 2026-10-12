# Runbook — Supabase Auth email: redirect URLs, custom SMTP, rate limits (#50)

> **Owner-run.** Everything below is Supabase Dashboard or AWS console configuration for the project's
> Supabase Auth and the AWS account the platform sends email from. None of it can be done from code.

## What the code now guarantees (and what it cannot)

Every Supabase call that **emails a link** builds its redirect from the configured app origin
(`NEXT_PUBLIC_APP_URL`, via `getAppUrl()` / `getAuthRedirectUrl()` in `packages/shared/src/app-url.ts`) —
never from `window.location`, never from the request `Host` header:

| Flow                                     | Call site                                                 | Redirect sent to Supabase                            |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Self-serve password reset                | `apps/web/app/(auth)/forgot-password/page.tsx`            | `{APP}/auth/callback?recovery=1`                     |
| Invitation "forgot password"             | `apps/web/app/accept-invitation/invitation-setup-api.ts`  | `{APP}/auth/callback?invitation=<uuid>&recovery=1`   |
| Sign-up confirmation                     | `apps/web/app/(auth)/register/register-form.tsx`          | `{APP}/auth/callback`                                |
| Candidate portal magic link              | `apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx`  | `{APP}/auth/callback?next=/careers/<slug>/dashboard` |
| Platform-owner "send reset"              | `packages/api/src/routers/platform/users.ts`              | `{APP}/reset-password`                               |
| Staff invite (Supabase invite email)     | `packages/api/src/services/staff-provisioning.service.ts` | `{APP}/reset-password?setup=1`                       |
| C# invitation emails (SES, not Supabase) | `Invitations:AppOrigin` (HTTPS-only, validated at start)  | `{APP}/accept-invitation?token=…`                    |

`getAppUrl()` **throws in a production build when `NEXT_PUBLIC_APP_URL` is unset** (`AppOriginConfigError`, issue
`missing`), and on a Vercel deployment (`VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` = production/preview) it also rejects
`http:` (`insecure_http`) and loopback hosts (`loopback_on_deployed_host`). These are issue codes of the same
`checkAppOrigin()` that the #351 bearer-link rule and the boot-time check in `apps/web/lib/env.ts` use, so the
three cannot drift. Boot-time validation does not require the variable to be set; a missing value fails at
link time, so it breaks email links rather than the whole app.
Caveat for the browser: `VERCEL_ENV` is server-only, and Vercel exposes `NEXT_PUBLIC_VERCEL_ENV` to client
bundles only when the project's _Automatically expose System Environment Variables_ setting is on. So the
guard does not hinge on that setting, `apps/web/next.config.ts` mirrors `VERCEL_ENV` into
`NEXT_PUBLIC_VERCEL_ENV` at build time, and, independently, a production bundle running in a browser on a
non-loopback host refuses a loopback `NEXT_PUBLIC_APP_URL` whatever either variable says. That second check
covers the four client call sites (forgot-password, register, portal magic link, invitation recovery). It does
NOT catch a non-loopback but wrong `https:` origin (for example a preview URL in the Production env); only
the value set in Vercel prevents that. In
any production build it rejects non-loopback `http:`, and everywhere it rejects a value that is not a bare origin
(credentials, path, query or fragment) — the #343/#351 bearer-link rule itself. The
pages show `auth.authEmailLinkUnavailable` instead of silently sending a wrong link. Because an unset value now
throws in a production build, set `NEXT_PUBLIC_APP_URL` in Vercel for both **Production** and **Preview** before
deploying (`vercel env ls` lists what is set).

**What code cannot fix:** if a `redirectTo` is _not on the Supabase allow-list_, Supabase silently ignores it
and falls back to the **Site URL**. A wrong Site URL therefore produces wrong-host links no matter what the
code sends. That is step 1 below.

OAuth (`signInWithOAuth`) redirects intentionally still use `window.location.origin`: they send no email,
and the PKCE verifier lives in a cookie on the _current_ origin, so redirecting elsewhere would break login.

### The landing pages (verified to exist)

- `/auth/callback` (`apps/web/app/auth/callback/route.ts`) exchanges the PKCE `code` for a session; with
  `recovery=1` it sets a 5-minute httpOnly proof cookie and redirects to `/reset-password?recovery=<proof>`.
- `/reset-password` (`apps/web/app/(auth)/reset-password/page.tsx`) accepts that proof **or** an
  implicit-flow fragment (`#access_token…&type=recovery|invite`, which is what the server-side admin
  reset/invite produce), then posts the new password to `/api/auth/password-update`, shows
  `auth.passwordUpdated` and continues to `/dashboard` (or back to the invitation). es + en strings exist.
- PKCE caveat (unchanged, inherent): a self-serve reset link must be opened **in the same browser** that
  requested it. A link opened elsewhere lands on `/login?error=auth_callback_error`; request a new one.

## 1. URL configuration — Supabase Dashboard → Authentication → URL Configuration

1. **Site URL:** `https://tims-ats.vercel.app`
   (no trailing slash; this is the fallback for any non-allow-listed redirect and the `{{ .SiteURL }}` in templates).
2. **Redirect URLs** — add exactly these entries (`**` matches any path/query suffix):

   | Entry                                          | Needed by                                                                          |
   | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
   | `https://tims-ats.vercel.app/auth/callback**`  | reset, invitation recovery, sign-up confirm, portal magic link, OAuth              |
   | `https://tims-ats.vercel.app/reset-password**` | platform-owner reset (`/reset-password`), staff invite (`/reset-password?setup=1`) |

   Optional, only if you want them to work:
   - `http://localhost:3000/**` — local dev, only if a local app is pointed at this Supabase project. It is
     an allow-list entry, not the Site URL, so it can never become a production fallback.
   - Preview deployments build links from the **Preview** value of `NEXT_PUBLIC_APP_URL`, and a self-serve
     reset only completes on the origin that requested it (PKCE). To test resets on previews, set Preview's
     `NEXT_PUBLIC_APP_URL` to the preview domain and allow-list `https://tims-ats-*-<team-slug>.vercel.app/**`.

3. The Site URL must never be a `localhost` address.

### Email templates — Authentication → Emails → Templates

For _Reset password_, _Confirm signup_, _Magic link_ and _Invite user_, the link must be
`{{ .ConfirmationURL }}` (which honours `redirectTo`). A template that hand-builds a link from
`{{ .SiteURL }}` ignores the app's redirect entirely — replace it with `{{ .ConfirmationURL }}`.

## 2. Custom SMTP via AWS SES — Authentication → Emails → SMTP Settings

The built-in Supabase mailer is for testing only (a handful of emails per hour, project-wide). Point Supabase
at the SES account and region the platform already sends from: the same values as the API's `Email__Region` /
`Email__FromAddress` (TS: `AWS_REGION` / `PLATFORM_EMAIL_FROM`). Before switching, confirm in the SES console that
the account has production access (out of the sandbox) and that the sender's domain identity is verified.

Settings to enter (no secrets in this file):

| Field                     | Value                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Custom SMTP        | on                                                                                                                                                                                                                                                                                                                                                                            |
| Sender email              | the platform's SES sender (`Email__FromAddress`); any address on a verified SES domain identity works — keep it consistent with the C# SES sender                                                                                                                                                                                                                             |
| Sender name               | `TIMS`                                                                                                                                                                                                                                                                                                                                                                        |
| Host                      | `email-smtp.<region>.amazonaws.com` (the `Email__Region` value)                                                                                                                                                                                                                                                                                                               |
| Port                      | `587` (STARTTLS) — `465` (implicit TLS) also works                                                                                                                                                                                                                                                                                                                            |
| Username / Password       | **SES SMTP credentials** — create them in _SES console (that region) → SMTP settings → Create SMTP credentials_. This creates a dedicated IAM user limited to `ses:SendRawEmail`; the SMTP password is _derived_ and shown once. It is **not** an IAM access-key secret — do not reuse the App Runner role or any existing key. Store the pair in your password manager only. |
| Minimum interval per user | keep `60` seconds (anti-abuse)                                                                                                                                                                                                                                                                                                                                                |

Then send yourself a reset from `/forgot-password` and confirm: the mail arrives from the SES sender,
and the link host is the production app origin.

Deliverability check (one-time): the sending domain should have SPF/DKIM aligned for SES and a DMARC record —
check _SES → Identities → <domain> → Authentication_ before switching senders.

## 3. Rate limits — Authentication → Rate Limits

Available once custom SMTP is on (the email limit is not editable on the built-in mailer):

| Setting                                                 | Recommended                                                          | Why                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Rate limit for sending emails (per hour, project-wide)  | **100** (raise later as tenants grow, within the SES account quota)  | covers reset + signup + magic-link + invite bursts during onboarding |
| Rate limit for token verifications (per 5 min per IP)   | keep default (30)                                                    | brute-force protection of OTP/magic links                            |
| Rate limit for sign-ups and sign-ins (per 5 min per IP) | keep default (30); raise only if a customer onboards from one NAT IP | an office behind one IP is the realistic trigger                     |
| Rate limit for token refreshes                          | keep default                                                         |                                                                      |

## 4. Acceptance (from #50)

- [ ] Site URL = `https://tims-ats.vercel.app`; both allow-list entries present.
- [ ] Custom SMTP (SES) enabled; email rate limit raised.
- [ ] From a real inbox: `/forgot-password` → email → link host is `tims-ats.vercel.app` → `/reset-password`
      → new password accepted → "password updated" → `/dashboard`. Then sign in with the new password.
- [ ] Platform owner → Users → "send reset" → email → `/reset-password` (fragment flow) → same result.
