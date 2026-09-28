# Invitation account onboarding

## Goal

An invited person can follow one link, establish or authenticate a Supabase identity, receive the intended organization role, and later sign in again. An invitation is not accepted until the authenticated identity and tenant access are both durable.

## Implemented flow

1. The browser previews a UUID invitation through a same-origin, capability-scoped relay. The emailed token remains in the setup URL, while setup, callback and recovery responses disable caching and referrer propagation.
2. A new recipient chooses a 12–128 character password. The C#/.NET 10 API creates a confirmed Supabase identity through the server-side admin API, but grants no TIMS access yet.
3. Existing recipients authenticate with their current password, recovery email, Google or Microsoft. Recovery and OAuth callbacks return to the original invitation.
4. The browser sends the current Supabase access token to the completion endpoint. The API independently verifies that token with Supabase and compares its confirmed email to the invitation.
5. One Postgres transaction locks the identity and invitation, validates the active organization and role, creates the `users` and `user_roles` rows, marks the invitation accepted, and appends `invitation_account_completed` to `audit_logs`.
6. Replays are idempotent only when the same linked user and completion audit still exist. A deleted or conflicting tenant account is never silently restored.

Legacy `acceptInvitation` is intentionally closed with `PRECONDITION_FAILED`; it could mark an invitation accepted without creating an account. Pending/sent invitations may become expired during lookup, while accepted and revoked terminal states are preserved.

## Security boundaries

- Preview and registration are possession-of-token capabilities with strict JSON fields, duplicate-key rejection and an 8 KiB body limit.
- Completion requires a valid Supabase bearer token. The tenant organization always comes from the locked invitation, never request input.
- The web relay has a fixed three-action allowlist, checks same origin, forwards no cookies and returns generic upstream failures.
- Passwords only transit browser → web relay → C# API → Supabase and are never stored, logged or returned by TIMS.
- Database writes execute under `app_tenant` with the invitation organization GUC. Advisory and row locks serialize concurrent completion.

## Verification

- Application unit tests cover password bounds, terminal invitations, existing identities, wrong identities and separate authenticated finalization.
- Provider tests pin Supabase URLs, headers, confirmed-email parsing and fail-closed origin validation.
- HTTP tests cover anonymous capability routes, authenticated completion, body bounds, duplicate/unexpected fields, no-store responses and the default-dark flag.
- Testcontainers tests use native invitation enums and RLS to prove role mapping, atomic tenant provisioning, cross-tenant conflict refusal and concurrent idempotency.
- Browser tests cover new accounts, existing-account failure, recovery-ready sessions and legacy accepted invitations. Middleware and relay tests cover public entry, private-route protection and cookie stripping.

## Production rollout

1. Merge only after TypeScript, .NET 10, integration, build, audit, secret and ownership gates pass.
2. Deploy the C# service with `Invitations__SupabaseUrl`, the secret reference for `Invitations__SupabaseServiceKey`, and `Invitations__SetupEnabled=true`. Keep the existing web `NEXTAUTH_SECRET` and C# `Platform__ImpersonationSecret` relay-signing values synchronized so anonymous recipients retain distinct trusted rate-limit attribution.
3. Verify API health and a non-mutating malformed-token preview before deploying the web application.
4. Deploy Vercel, then smoke `/login`, `/accept-invitation` without a token, and the public careers page.
5. Send one fresh invitation to the authorized test recipient. Confirm provider acceptance, open the link, choose a private password, complete onboarding, sign out and sign back in.
6. Verify exactly one tenant user, intended role, accepted invitation and completion audit. Retain the legacy invitation route in its closed state.

Rollback disables `Invitations__SetupEnabled` and redeploys the previous web release. Identity creation without completion is safe: it has no TIMS tenant grant, and the recipient can later continue as an existing account.
