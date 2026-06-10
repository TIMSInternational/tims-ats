# Security — Staff/Candidate Auth-Link Boundary

> Status: **RESOLVED — Approach B2 shipped (2026-06-10).** Codex adversarial review:
> 8 rounds → `approve`. Owner: NexaDev.

## The problem (codex adversarial review, Wave 1)

A staff `User` used to be connected to its Supabase identity by a **global, unscoped
email match** in four places (tRPC context builder, `/auth/callback`, `(admin)/layout.tsx`,
`(admin)/dashboard/page.tsx`). Invited staff rows were created with an unclaimed
sentinel (`supabaseUserId: ''` from `user.create`, or `pending-<candidateId>` from
employee conversion), and `User.email` is unique only **per org**. So a Supabase
session — including a **candidate** portal magic-link session, or a cross-tenant email
collision — whose email matched an unclaimed staff row could be silently promoted into
that staff role. The email-link was also **load-bearing**: password-login staff
(`signInWithPassword`, which skips `/auth/callback`) were linked by it, so it couldn't
simply be removed.

## Approaches considered
- **A — single claim chokepoint** (claim at `/auth/callback` + a new `/auth/link`,
  recognize-by-id elsewhere). **Abandoned**: codex showed the chokepoints were still
  ambient-reachable by candidate sessions (vector not closed) and the change stranded
  password/recovery staff + raced. Spike kept unmerged on `fix/staff-auth-link-chokepoint`.
- **B — link at invite time (B2, CHOSEN).** Create/lookup the Supabase identity when
  staff are invited and stamp `supabaseUserId` on the row immediately, eliminating the
  email-join entirely.

## Approach B2 — as shipped
- `packages/api/src/services/staff-provisioning.service.ts` — `resolveStaffSupabaseUserId(email)`:
  reuse the existing `auth.users` id for the email (case-insensitive) else
  `admin.inviteUserByEmail`; returns only an UNOWNED id — clean `CONFLICT` if a REAL
  staff row (org-scoped or platform owner) owns it; a legacy org-less artifact owning
  it is tombstoned inline to free the globally-unique id.
- `user.create` + offer employee-conversion stamp that id at creation, with a
  **case-insensitive** duplicate pre-check BEFORE provisioning (no orphaned invites).
  No more `''` / `pending-*` sentinels.
- ALL recognition sites match by `supabaseUserId` ONLY — no email-join. A staff
  identity must be **active AND (org-scoped OR platform owner)**. `/auth/callback` no
  longer mints candidate `User` rows.
- New `/logout` route = the non-looping exit for an unlinked authenticated session.
- `/register` is **company-only** (candidates apply via an employer careers link +
  portal magic-link; they never get a `User` row).
- One-time backfill `packages/api/scripts/backfill-staff-supabase-links.ts`: PASS 1
  tombstones legacy org-less rows (frees ids), PASS 2 links active org-scoped sentinel
  rows. Conflict-aware, DRY-RUN by default, and in `--apply` **fails closed**
  (non-zero exit) if any row is left unresolved.

## PROD HANDOFFS (required before the invite flow works end-to-end)
1. **`SUPABASE_SERVICE_ROLE_KEY`** set in Vercel prod (server-side identity creation).
2. **Supabase email delivery** configured (the "set your password" invite email).
3. **Run the backfill** (`pnpm --filter @tims/api exec tsx scripts/backfill-staff-supabase-links.ts --apply`)
   against prod to link any pre-existing unclaimed rows, BEFORE relying on id-only
   recognition. It exits non-zero if anything is unresolved.

## Regression coverage
`tests/auth/staff-auth-link.test.ts` — invite-time linking, no sentinels, recognize-by-id
at all sites, no email-join, active+org/owner guard, CONFLICT on real-staff ownership,
legacy tombstone reclaim, duplicate-before-provision ordering.
