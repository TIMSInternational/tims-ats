# Assessment Player Slice 4 — Dashboard Entry Point (+ `/me` → `/dashboard` rename) Design

> Status: APPROVED (Federico, 2026-07-30, conversational approval — see brainstorming
> session). Continues [[Assessment Player Slice 3]] (Player UI, merged to `main` at
> `e18ff65`). Closes `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`'s Slice 4 ("`/me`
> integration") and GitHub issue #247. **Scope was explicitly expanded beyond the
> original issue text during brainstorming**: Federico asked that the candidate
> dashboard route not be named `/me` at all, so this slice also renames the route
> (and everything under it) from `/me` to `/dashboard`, repo-wide, with a permanent
> redirect for backward compatibility.

## Context

The candidate portal (`docs/WAVE-1-CANDIDATE-PORTAL.md`) is marked **REAL** in
`docs/REMAINING-WORK.md` — it has been live to real candidates since Wave 1 (job
board, apply, magic-link login, status dashboard). The Assessment Player (Slices
1–3) is newer and, per GitHub issue #275, has never been exercised by a real
candidate in a browser — it is currently reachable only by direct URL
(`/careers/[orgSlug]/me/assessments/[assignmentId]`). This slice:

1. Adds a "My Assessments" section + entry point to the candidate dashboard, so
   the Player is reachable from the dashboard instead of direct-URL-only.
2. Renames the dashboard route from `/me` to `/dashboard` (URL, files,
   components, i18n namespace — full rename, not just the URL segment), because
   the existing route (and everything live in it) predates this slice and
   Federico wants "me" gone from the naming entirely.

**No new backend work.** `candidatePortal.getMyAssessments` already exists
(shipped in Slice 2) and returns everything the new section needs.

## Rename scope

- `apps/web/app/(portal)/careers/[orgSlug]/me/` → `.../dashboard/`, including the
  nested `assessments/[assignmentId]` subtree (moves as-is, no internal changes
  beyond the path itself).
- File/component/i18n renames (full rename, matching everywhere `me` currently
  appears in this tree):
  - `me-shell.tsx` / `PortalMeShell` → `dashboard-shell.tsx` / `PortalDashboardShell`
  - `me-applications.tsx` / `MeApplications` → `dashboard-applications.tsx` / `DashboardApplications`
  - `me-interviews.tsx` / `MeInterviews` → `dashboard-interviews.tsx` / `DashboardInterviews`
  - `me-offer.tsx` / `MeOffer` → `dashboard-offer.tsx` / `DashboardOffer`
  - `me-faq-chat.tsx` / `MeFaqChat` → `dashboard-faq-chat.tsx` / `DashboardFaqChat`
  - i18n namespace `t.portalMe.*` → `t.portalDashboard.*` in both `en.json`/`es.json`
    (key names inside the namespace are unchanged, only the namespace itself moves)
- `login/page.tsx`'s `emailRedirectTo` target changes from `.../me` to `.../dashboard`.
- Legacy redirect (see below) is the only new "me"-named file — everything else
  moves.
- Every existing test file that imports these paths gets its import updated in
  place (mechanical — same test bodies, same coverage): `candidate-faq-ui.test.ts`,
  `candidate-procedure.test.ts`, and the nine `tests/portal/assessment-*.test.ts*`
  files that import from the `assessments/[assignmentId]` subtree.
- `tests/auth/portal-next.test.ts` keeps its existing `/me` cases (still valid
  generic same-origin-path coverage for `isSafePortalNext`, which is path-agnostic
  and needs no logic change) and gains equivalent `/dashboard` cases.
- Docs `docs/WAVE-1-CANDIDATE-PORTAL.md` and `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`
  get their `/me` references corrected to `/dashboard`.

`isSafePortalNext` (`apps/web/lib/portal-auth.ts`) and the auth middleware's
`PUBLIC_PATHS`/staff-auth-page logic are both generic over any `/careers/*` path
— confirmed by reading both — so **no logic changes are needed there**, only the
literal path strings used in call sites (login redirect target) and tests.

## Legacy redirect

`.../me/page.tsx` is replaced with a thin redirect (not deleted — the path must
keep resolving):

```tsx
import { redirect } from 'next/navigation';

export default async function LegacyMeRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug } = await params;
  const qs = new URLSearchParams((await searchParams) as Record<string, string>).toString();
  redirect(`/careers/${orgSlug}/dashboard${qs ? `?${qs}` : ''}`);
}
```

Only the top-level `/me` entry point gets a legacy redirect. The
`assessments/[assignmentId]` subtree does **not** — per issue #275, Slice 3 was
never smoke-tested by a real candidate, so no real assessment-taking link exists
in the wild yet to preserve.

## New "My Assessments" component

`dashboard-assessments.tsx` / `DashboardAssessments`, added to the dashboard
shell's section list after Interviews, before Offer (matches pipeline order:
apply → interview → assessment → offer).

- Query: `trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug })` (existing,
  unchanged). Shape: `Array<{ id, status, startedAt, completedAt, expiresAt,
assessmentType: { name, duration }, result: { normalizedScore, percentile,
hasPending } | null }>`.
- Loading/error/empty states mirror `dashboard-interviews.tsx` (post-rename)
  exactly: same wrapper classes, same section header pattern.
- Per-assignment card:
  - `status ∈ {assigned, in_progress}` and **not expired**
    (`expiresAt === null || expiresAt > now`) → primary button ("Start" for
    `assigned`, "Continue" for `in_progress`) linking to
    `/careers/[orgSlug]/dashboard/assessments/[assignmentId]`.
  - `status ∈ {assigned, in_progress}` and **expired** (`expiresAt` in the past)
    → muted "Expired" badge, no button (avoids a dead click into a route that
    would just reject with `assignment_expired`).
  - `status === 'completed'` → shows `result.normalizedScore` when present, or a
    "pending review" note when `result.hasPending` is true; no action button
    (no result-history re-view in this slice's scope).
  - `status === 'cancelled'` → muted badge, no action.
- New i18n keys under `t.portalDashboard.assess*` (loading/error/empty, per-status
  labels, start/continue/expired, score display, pending-review note), following
  the existing `int*`/`offer*` prefix convention in the same namespace.

## Testing plan

TDD per repo convention:

- `tests/auth/portal-next.test.ts` — add `/dashboard` cases alongside the
  existing `/me` cases; add a case (or a separate small test) covering the
  legacy redirect page.
- New `tests/portal/dashboard-assessments.test.tsx` — mirrors
  `dashboard-interviews.test.tsx`'s (post-rename) structure: loading, error,
  empty, and one case per status variant (assigned/startable, in-progress,
  expired, completed-with-score, completed-pending, cancelled). Uses the
  `web-components` Vitest project, same as every other Slice 3 component test.
- All renamed test files: import paths updated in place, bodies unchanged — no
  coverage lost, no coverage gained beyond the two new test files above.

## Out of scope (explicitly deferred)

- Any change to `isSafePortalNext` or middleware auth logic (neither needs one).
- A legacy redirect for the `assessments/[assignmentId]` subtree (no real link to
  preserve — see above).
- Re-visitable result history / detail view for `completed` assignments (not
  part of Slice 4 per the original design doc's "result display" — a summary
  only, not a full past-results page).
- Wave 1.5b (webcam proctoring) and Wave 3 (essay-scoring agent) — unrelated,
  already tracked separately (issues #248/#249).
