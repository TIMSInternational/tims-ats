# Assessment Player Slice 4 — Dashboard Entry Point (+ /me → /dashboard rename) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the candidate dashboard route from `/careers/[orgSlug]/me` to `/careers/[orgSlug]/dashboard` (files, components, i18n namespace, with a permanent backward-compat redirect), then add a "My Assessments" section to it so the already-merged Assessment Player (Slice 3) is reachable from the dashboard instead of direct-URL-only.

**Architecture:** Task 1 is a mechanical, atomic rename (route folder + 7 component files + i18n namespace + every existing reference) — TypeScript's `t` type is inferred directly from `en.json` (`apps/web/lib/i18n/index.tsx:8`), so any missed `t.portalMe.*` reference becomes a compile error, making `tsc --noEmit` the authoritative completeness check. Task 2 adds a legacy redirect page at the old `/me` path (the candidate portal is live to real candidates — `docs/REMAINING-WORK.md` marks it **REAL**). Task 3 is a new presentational component (`DashboardAssessments`) consuming the already-existing `candidatePortal.getMyAssessments` query (built in Slice 2, unchanged) — no backend work. Task 4 corrects stale doc references.

**Tech Stack:** Next.js 15 App Router (Server + Client Components), tRPC + React Query, Vitest 4.1 (`node` + `web-components` projects, both already exist), Tailwind, `@testing-library/react`.

## Global Constraints

- **File size limits (CLAUDE.md):** max 300 lines/component. Every touched/new file here is well under that.
- **i18n is mandatory and enforced by a gate:** `tests/security/i18n-no-hardcoded-strings.test.ts` source-scans `apps/web/app` for hardcoded JSX text. Every user-facing string in the new `DashboardAssessments` component MUST go through `t.portalDashboard.*`.
- **`tests/i18n/parity.test.ts`** requires `en.json`/`es.json` to have byte-identical key paths — every key added to one MUST be added to the other in the same step.
- **The `t` type is inferred directly from `en.json`** (`type Translations = typeof es` matched against `en`, `apps/web/lib/i18n/index.tsx`). This means Task 1's rename is self-checking: `tsc --noEmit` fails on any leftover `t.portalMe.*` reference. Treat a clean `tsc --noEmit` as proof the rename is complete, not just a formality.
- **Route depth is unchanged by the rename.** `me` → `dashboard` is a same-position single-segment swap — every existing relative import (e.g. `assessment-error-messages.ts`'s 8-`../` chain to `lib/i18n/en.json`) stays correct with zero `../` count changes. Verified by reading the file — do not "fix" these paths, they don't need it.
- **The candidate portal is REAL/live** (`docs/REMAINING-WORK.md`) — real candidates may have magic-link emails or bookmarks pointing at the old `/me` path. Task 2's redirect is not optional polish, it is a production-compat requirement.
- **`isSafePortalNext` (`apps/web/lib/portal-auth.ts`) and the auth middleware's `PUBLIC_PATHS` (`apps/web/middleware.ts`) are already generic over any `/careers/*` path** — confirmed by reading both. Neither needs a logic change for this rename, only new test coverage (Task 2).
- **No new backend endpoint or schema change.** `candidatePortal.getMyAssessments` (Slice 2) is consumed as-is.
- **superjson is the tRPC transformer** — `expiresAt`/`startedAt`/`completedAt` arrive on the client as real `Date` objects, not strings. Do not re-wrap with `new Date(...)`.

---

### Task 1: Rename the candidate dashboard route from `/me` to `/dashboard`

**Why this task exists:** Federico explicitly asked (during brainstorming) that the candidate dashboard not be named `/me` anywhere — not just the URL, but every file, component, and i18n key under it. This must land as one atomic change: the six sibling files all import each other by their old `me-*` names, and `t.portalMe.*` references would become compile errors if the i18n key were renamed before its consumers.

**Files:**

- Move: `apps/web/app/(portal)/careers/[orgSlug]/me/` → `apps/web/app/(portal)/careers/[orgSlug]/dashboard/` (git mv, whole directory — carries the `assessments/[assignmentId]` subtree along unchanged)
- Move+modify: `.../dashboard/me-shell.tsx` → `.../dashboard/dashboard-shell.tsx`
- Move+modify: `.../dashboard/me-applications.tsx` → `.../dashboard/dashboard-applications.tsx`
- Move+modify: `.../dashboard/me-application-timeline.tsx` → `.../dashboard/dashboard-application-timeline.tsx`
- Move+modify: `.../dashboard/me-interviews.tsx` → `.../dashboard/dashboard-interviews.tsx`
- Move+modify: `.../dashboard/me-offer.tsx` → `.../dashboard/dashboard-offer.tsx`
- Move+modify: `.../dashboard/me-faq-chat.tsx` → `.../dashboard/dashboard-faq-chat.tsx`
- Modify: `.../dashboard/page.tsx` (moved, not renamed — stays `page.tsx`)
- Modify: `apps/web/lib/i18n/en.json:2771`, `apps/web/lib/i18n/es.json:2771`
- Modify: `apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx`
- Modify: `tests/portal/candidate-faq-ui.test.ts`
- Modify: `tests/portal/candidate-procedure.test.ts`
- Modify: `tests/portal/assessment-error-messages.test.ts`, `tests/portal/assessment-submit-confirm.test.tsx`, `tests/portal/use-assessment-countdown.test.tsx`, `tests/portal/assessment-question-card.test.tsx`, `tests/portal/assessment-result-screen.test.tsx`, `tests/portal/assessment-player-shell.test.tsx`, `tests/portal/assessment-draft-storage.test.tsx`, `tests/portal/assessment-question-wizard.test.tsx`, `tests/portal/assessment-consent-gate.test.tsx`

**Interfaces:**

- Produces: `PortalDashboardShell`, `DashboardApplications`, `DashboardApplicationTimeline`, `DashboardInterviews`, `DashboardOffer`, `DashboardFaqChat`, `PortalDashboardPage` (default export of `dashboard/page.tsx`) — same props/behavior as their `Me*`-named predecessors, just renamed. `t.portalDashboard.*` — same keys as the old `t.portalMe.*`, same values, renamed namespace only.
- Consumes: nothing new. Task 3 consumes `t.portalDashboard.*` and adds `DashboardApplications`'s sibling `DashboardAssessments` into `dashboard-shell.tsx`.

- [ ] **Step 1: Confirm the baseline suite passes before touching anything**

Run: `npx vitest run && (cd apps/web && npx tsc --noEmit) && pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS — this is the pre-rename baseline; if it's already red, stop and report instead of proceeding.

- [ ] **Step 2: Move the whole directory**

```bash
git mv "apps/web/app/(portal)/careers/[orgSlug]/me" "apps/web/app/(portal)/careers/[orgSlug]/dashboard"
```

- [ ] **Step 3: Rename the six sibling files inside it**

```bash
cd "apps/web/app/(portal)/careers/[orgSlug]/dashboard"
git mv me-shell.tsx dashboard-shell.tsx
git mv me-applications.tsx dashboard-applications.tsx
git mv me-application-timeline.tsx dashboard-application-timeline.tsx
git mv me-interviews.tsx dashboard-interviews.tsx
git mv me-offer.tsx dashboard-offer.tsx
git mv me-faq-chat.tsx dashboard-faq-chat.tsx
cd -
```

(`page.tsx` keeps its name — only its _contents_ change, in Step 10.)

- [ ] **Step 4: Edit `dashboard-shell.tsx`**

Using Edit with `replace_all: true` for each pair, in `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell.tsx`:

| old_string            | new_string                   |
| --------------------- | ---------------------------- |
| `PortalMeShell`       | `PortalDashboardShell`       |
| `'./me-applications'` | `'./dashboard-applications'` |
| `MeApplications`      | `DashboardApplications`      |
| `'./me-interviews'`   | `'./dashboard-interviews'`   |
| `MeInterviews`        | `DashboardInterviews`        |
| `'./me-offer'`        | `'./dashboard-offer'`        |
| `MeOffer`             | `DashboardOffer`             |
| `'./me-faq-chat'`     | `'./dashboard-faq-chat'`     |
| `MeFaqChat`           | `DashboardFaqChat`           |
| `t.portalMe.`         | `t.portalDashboard.`         |

(Order matters only in that each row's `old_string` must still be present when you apply it — applying them in the table order above works, since none of these strings are substrings of another row's `old_string`.)

- [ ] **Step 5: Edit `dashboard-applications.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-applications.tsx`, `replace_all: true` for each:

| old_string                    | new_string                           |
| ----------------------------- | ------------------------------------ |
| `MeApplications`              | `DashboardApplications`              |
| `'./me-application-timeline'` | `'./dashboard-application-timeline'` |
| `MeApplicationTimeline`       | `DashboardApplicationTimeline`       |
| `t.portalMe.`                 | `t.portalDashboard.`                 |

- [ ] **Step 6: Edit `dashboard-application-timeline.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-application-timeline.tsx`, `replace_all: true`:

| old_string              | new_string                     |
| ----------------------- | ------------------------------ |
| `MeApplicationTimeline` | `DashboardApplicationTimeline` |
| `t.portalMe.`           | `t.portalDashboard.`           |

- [ ] **Step 7: Edit `dashboard-interviews.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-interviews.tsx`, `replace_all: true`:

| old_string     | new_string            |
| -------------- | --------------------- |
| `MeInterviews` | `DashboardInterviews` |
| `t.portalMe.`  | `t.portalDashboard.`  |

- [ ] **Step 8: Edit `dashboard-offer.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-offer.tsx`, `replace_all: true`:

| old_string    | new_string           |
| ------------- | -------------------- |
| `MeOffer`     | `DashboardOffer`     |
| `t.portalMe.` | `t.portalDashboard.` |

- [ ] **Step 9: Edit `dashboard-faq-chat.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-faq-chat.tsx`, `replace_all: true`:

| old_string    | new_string           |
| ------------- | -------------------- |
| `MeFaqChat`   | `DashboardFaqChat`   |
| `t.portalMe.` | `t.portalDashboard.` |

- [ ] **Step 10: Edit `dashboard/page.tsx`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/page.tsx`:

```
old_string: export default async function PortalMePage({
new_string: export default async function PortalDashboardPage({
```

```
old_string: import { PortalMeShell } from './me-shell';
new_string: import { PortalDashboardShell } from './dashboard-shell';
```

```
old_string:     <PortalMeShell
new_string:     <PortalDashboardShell
```

- [ ] **Step 11: Rename the i18n namespace key in both locale files**

In `apps/web/lib/i18n/en.json`:

```
old_string:   "portalMe": {
new_string:   "portalDashboard": {
```

In `apps/web/lib/i18n/es.json`:

```
old_string:   "portalMe": {
new_string:   "portalDashboard": {
```

(Only the key changes — every sub-key/value inside the object is untouched.)

- [ ] **Step 12: Update the login redirect target**

In `apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx`:

```
old_string: options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/careers/${orgSlug}/me` },
new_string: options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/careers/${orgSlug}/dashboard` },
```

```
old_string: // "check your email" confirmation regardless of whether the email maps to a
// candidate (no account enumeration); access is gated downstream at /me by the
// Candidate lookup.
new_string: // "check your email" confirmation regardless of whether the email maps to a
// candidate (no account enumeration); access is gated downstream at /dashboard by the
// Candidate lookup.
```

- [ ] **Step 13: Fix `tests/portal/candidate-faq-ui.test.ts`**

```
old_string: const WIDGET = read('apps/web/app/(portal)/careers/[orgSlug]/me/me-faq-chat.tsx');
const SHELL = read('apps/web/app/(portal)/careers/[orgSlug]/me/me-shell.tsx');
new_string: const WIDGET = read('apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-faq-chat.tsx');
const SHELL = read('apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell.tsx');
```

```
old_string:     expect(SHELL).toContain("import { MeFaqChat } from './me-faq-chat'");
    expect(SHELL).toContain('<MeFaqChat orgSlug={orgSlug} />');
new_string:     expect(SHELL).toContain("import { DashboardFaqChat } from './dashboard-faq-chat'");
    expect(SHELL).toContain('<DashboardFaqChat orgSlug={orgSlug} />');
```

```
old_string:       expect(EN.portalMe[key]).toBeTruthy();
      expect(ES.portalMe[key]).toBeTruthy();
new_string:       expect(EN.portalDashboard[key]).toBeTruthy();
      expect(ES.portalDashboard[key]).toBeTruthy();
```

- [ ] **Step 14: Fix `tests/portal/candidate-procedure.test.ts`**

```
old_string: const ME_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx');
new_string: const DASHBOARD_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/dashboard/page.tsx');
```

```
old_string: describe('portal /me SSR gate — no privileged candidate read', () => {
  it('reads the candidate through the tenant-scoped service, not the privileged db', () => {
    // The /me server component must not touch db.candidate directly — that bypasses
    // RLS. It resolves the org by slug (db is fine for that) but the candidate read
    // goes through candidatePortalService (runWithTenant + tenantDb).
    expect(ME_PAGE).not.toMatch(/db\.candidate\b/);
    expect(ME_PAGE).toContain('candidatePortalService');
  });
});
new_string: describe('portal /dashboard SSR gate — no privileged candidate read', () => {
  it('reads the candidate through the tenant-scoped service, not the privileged db', () => {
    // The /dashboard server component must not touch db.candidate directly — that
    // bypasses RLS. It resolves the org by slug (db is fine for that) but the
    // candidate read goes through candidatePortalService (runWithTenant + tenantDb).
    expect(DASHBOARD_PAGE).not.toMatch(/db\.candidate\b/);
    expect(DASHBOARD_PAGE).toContain('candidatePortalService');
  });
});
```

- [ ] **Step 15: Fix the nine assessment-player test files' import paths**

In each of these nine files, use Edit with `replace_all: true`:

```
old_string: /careers/[orgSlug]/me/assessments/
new_string: /careers/[orgSlug]/dashboard/assessments/
```

- `tests/portal/assessment-error-messages.test.ts`
- `tests/portal/assessment-submit-confirm.test.tsx`
- `tests/portal/use-assessment-countdown.test.tsx`
- `tests/portal/assessment-question-card.test.tsx`
- `tests/portal/assessment-result-screen.test.tsx`
- `tests/portal/assessment-player-shell.test.tsx` (two occurrences in this file — a `vi.mock(...)` path string and an `import` — `replace_all: true` catches both)
- `tests/portal/assessment-draft-storage.test.tsx`
- `tests/portal/assessment-question-wizard.test.tsx` (two occurrences — same as above)
- `tests/portal/assessment-consent-gate.test.tsx`

- [ ] **Step 16: Verify the full suite and both `tsc` checks pass**

Run: `npx vitest run`
Expected: PASS — same 269 files (now with 9 fixed import paths + 2 renamed test files), same pass count as the Step 1 baseline.

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS. If this fails on a leftover `t.portalMe.*` or `Me*` reference, that's the compiler catching an incomplete rename — find it with `grep -rn "portalMe\|MeApplications\|MeInterviews\|MeOffer\|MeFaqChat\|MeApplicationTimeline\|PortalMeShell" apps/web tests` (expected: zero matches) and fix it.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS (this task touches no backend code, but re-run per CLAUDE.md's "both must pass before any commit").

- [ ] **Step 17: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/dashboard" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json "apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx" tests/portal/candidate-faq-ui.test.ts tests/portal/candidate-procedure.test.ts tests/portal/assessment-error-messages.test.ts tests/portal/assessment-submit-confirm.test.tsx tests/portal/use-assessment-countdown.test.tsx tests/portal/assessment-question-card.test.tsx tests/portal/assessment-result-screen.test.tsx tests/portal/assessment-player-shell.test.tsx tests/portal/assessment-draft-storage.test.tsx tests/portal/assessment-question-wizard.test.tsx tests/portal/assessment-consent-gate.test.tsx
git commit -m "$(cat <<'EOF'
refactor(portal): rename candidate dashboard route from /me to /dashboard

Federico asked that the candidate dashboard not be named "me" anywhere —
route, files, components, and the i18n namespace all move together
(git mv preserves history). The old /me path is intentionally left
unresolvable by this commit alone; Task 2 adds a permanent redirect
since the candidate portal is live to real candidates.
EOF
)"
```

---

### Task 2: Legacy `/me` → `/dashboard` redirect

**Why:** The candidate portal is marked **REAL**/live in `docs/REMAINING-WORK.md`. A real candidate may have an already-sent magic-link email or a saved bookmark pointing at the now-gone `/careers/[orgSlug]/me` path. This task makes that path permanently redirect instead of 404ing.

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx` (new file, at the path Task 1 vacated)
- Modify: `tests/portal/candidate-procedure.test.ts`
- Modify: `tests/auth/portal-next.test.ts`

**Interfaces:**

- Produces: a `page.tsx` at the legacy path that only calls `redirect()`, never touches `db`/`candidatePortalService`. Consumes nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `tests/portal/candidate-procedure.test.ts`, near the top alongside the other `read(...)` constants (after the `DASHBOARD_PAGE` line from Task 1):

```
old_string: const DASHBOARD_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/dashboard/page.tsx');
new_string: const DASHBOARD_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/dashboard/page.tsx');
const LEGACY_ME_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx');
```

Add a new `describe` block at the end of the file (after the last existing `describe`):

```ts
describe('legacy /me → /dashboard redirect', () => {
  it('redirects to the new dashboard path, preserving orgSlug', () => {
    expect(LEGACY_ME_PAGE).toContain('redirect(`/careers/${orgSlug}/dashboard');
  });

  it('is a thin redirect only — does not duplicate the candidate SSR lookup', () => {
    expect(LEGACY_ME_PAGE).not.toContain('candidatePortalService');
    expect(LEGACY_ME_PAGE).not.toMatch(/db\.candidate\b/);
  });
});
```

Add to `tests/auth/portal-next.test.ts`, right after the existing `'accepts a same-origin /careers/ path'` test (inside the same `describe('isSafePortalNext', ...)` block):

```ts
it('accepts the new candidate dashboard path (and its assessment sub-routes)', () => {
  expect(isSafePortalNext('/careers/tims-international/dashboard')).toBe('/careers/tims-international/dashboard');
  expect(isSafePortalNext('/careers/acme/dashboard/assessments/a1')).toBe('/careers/acme/dashboard/assessments/a1');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/portal/candidate-procedure.test.ts tests/auth/portal-next.test.ts`
Expected: FAIL — `tests/portal/candidate-procedure.test.ts`'s two new tests fail because `apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx` doesn't exist yet (`read()` throws `ENOENT`); the `portal-next.test.ts` addition should already PASS (it exercises existing, unchanged logic) — if it doesn't, stop and investigate before continuing.

- [ ] **Step 3: Create the legacy redirect page**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

// Legacy entry point. The candidate dashboard moved from /me to /dashboard
// (2026-07-30) — the candidate portal is live to real candidates
// (docs/REMAINING-WORK.md marks it REAL), so this permanent redirect protects
// any already-sent magic-link email or saved bookmark that still points at
// the old path. Preserves the query string so nothing is silently dropped.
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

- [ ] **Step 4: Run to verify all three new tests pass**

Run: `npx vitest run tests/portal/candidate-procedure.test.ts tests/auth/portal-next.test.ts`
Expected: PASS (all tests in both files, not just the new ones).

- [ ] **Step 5: Run the full suite + tsc**

Run: `npx vitest run`
Expected: PASS.

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx" tests/portal/candidate-procedure.test.ts tests/auth/portal-next.test.ts
git commit -m "feat(portal): add legacy /me -> /dashboard redirect for backward compat

The candidate portal is live to real candidates (REMAINING-WORK.md marks
it REAL) — a stale magic-link email or bookmark pointing at the old /me
path must not 404 after the Task 1 rename."
```

---

### Task 3: "My Assessments" section on the candidate dashboard

**Why:** Closes GitHub issue #247 — the Assessment Player (Slice 3, merged) is currently reachable only by direct URL. This adds the entry point.

**Files:**

- Modify: `apps/web/lib/i18n/en.json`, `apps/web/lib/i18n/es.json`
- Create: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-assessments.tsx`
- Test: `tests/portal/dashboard-assessments.test.tsx`
- Modify: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell.tsx`

**Interfaces:**

- Consumes: `trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug })` — existing, unchanged. Returns `Array<{ id: string; status: string; expiresAt: Date | null; assessmentType: { name: string; duration: number | null }; result: { normalizedScore: number | null; percentile: number | null; hasPending: boolean } | null }>` (per `packages/api/src/repositories/candidate-assessment.repository.ts`'s `assignmentSummarySelect` + `packages/api/src/services/candidate-assessment.service.ts`'s `withPendingFlag`).
- Produces: `DashboardAssessments({ orgSlug }: { orgSlug: string })`. Links to `/careers/${orgSlug}/dashboard/assessments/${assignmentId}` (the already-existing Slice 3 player route, now under its renamed parent).

- [ ] **Step 1: Add the i18n keys**

In `apps/web/lib/i18n/en.json`, find the (Task-1-renamed) `portalDashboard` object's last entry and its closing brace:

```
old_string:     "faqSourceOffers": "offers"
  },
new_string:     "faqSourceOffers": "offers",
    "assessments": "My Assessments",
    "assessLoading": "Loading your assessments…",
    "assessError": "We couldn't load your assessments.",
    "assessEmpty": "You don't have any assessments yet.",
    "assessMinutes": "min",
    "assessStatusAssigned": "Not started",
    "assessStatusInProgress": "In progress",
    "assessStatusCompleted": "Completed",
    "assessStatusExpired": "Expired",
    "assessStatusCancelled": "Cancelled",
    "assessStart": "Start",
    "assessContinue": "Continue",
    "assessScoreLabel": "Score",
    "assessPendingNotice": "Pending review"
  },
```

In `apps/web/lib/i18n/es.json`, the same spot:

```
old_string:     "faqSourceOffers": "ofertas"
  },
new_string:     "faqSourceOffers": "ofertas",
    "assessments": "Mis evaluaciones",
    "assessLoading": "Cargando tus evaluaciones…",
    "assessError": "No se pudieron cargar tus evaluaciones.",
    "assessEmpty": "Todavía no tienes evaluaciones.",
    "assessMinutes": "min",
    "assessStatusAssigned": "Sin iniciar",
    "assessStatusInProgress": "En proceso",
    "assessStatusCompleted": "Completada",
    "assessStatusExpired": "Expirada",
    "assessStatusCancelled": "Cancelada",
    "assessStart": "Iniciar",
    "assessContinue": "Continuar",
    "assessScoreLabel": "Puntaje",
    "assessPendingNotice": "En revisión"
  },
```

Run: `npx vitest run tests/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing component tests**

Create `tests/portal/dashboard-assessments.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

let assessmentsQueryData: unknown[] = [];
let queryState = { isLoading: false, isError: false };

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidatePortal: {
      getMyAssessments: {
        useQuery: () => ({ ...queryState, data: assessmentsQueryData }),
      },
    },
  },
}));

import { DashboardAssessments } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-assessments';

function renderSection() {
  // Matches the pattern used by every sibling component test — I18nProvider
  // defaults to ES otherwise.
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <DashboardAssessments orgSlug="tims" />
    </I18nProvider>,
  );
}

describe('DashboardAssessments', () => {
  beforeEach(() => {
    assessmentsQueryData = [];
    queryState = { isLoading: false, isError: false };
  });

  it('shows the loading message', () => {
    queryState = { isLoading: true, isError: false };
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessLoading)).toBeInTheDocument();
  });

  it('shows the error message', () => {
    queryState = { isLoading: false, isError: true };
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessError)).toBeInTheDocument();
  });

  it('shows the empty message when there are no assignments', () => {
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessEmpty)).toBeInTheDocument();
  });

  it('shows a Start link into the player for an assigned, unexpired assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'assigned',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    const link = screen.getByRole('link', { name: en.portalDashboard.assessStart });
    expect(link).toHaveAttribute('href', '/careers/tims/dashboard/assessments/a1');
  });

  it('shows a Continue link for an in_progress, unexpired assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'in_progress',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByRole('link', { name: en.portalDashboard.assessContinue })).toBeInTheDocument();
  });

  it('shows an Expired badge and no action link for an assigned assignment past its expiresAt', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'assigned',
        expiresAt: new Date(Date.now() - 1000),
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessStatusExpired)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the score for a completed assignment with no pending review', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'completed',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: { normalizedScore: 85, percentile: null, hasPending: false },
      },
    ];
    renderSection();
    expect(screen.getByText(`${en.portalDashboard.assessScoreLabel}: 85`)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the pending-review notice for a completed assignment with essays still unscored', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'completed',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: { normalizedScore: 40, percentile: null, hasPending: true },
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessPendingNotice)).toBeInTheDocument();
  });

  it('shows the Cancelled badge and no action link for a cancelled assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'cancelled',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessStatusCancelled)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/portal/dashboard-assessments.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement `DashboardAssessments`**

Create `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-assessments.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

// "My Assessments" section of the candidate dashboard (Wave 1.5a Slice 4). Lists
// the signed-in candidate's assessment assignments and links a startable one into
// the Slice 3 player. Data comes from candidatePortal.getMyAssessments, scoped
// server-side to this candidate; orgSlug is the only input.
export function DashboardAssessments({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError } = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const header = <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.assessments}</h2>;

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.assessLoading}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#B42318]">{t.portalDashboard.assessError}</p>
      </section>
    );
  }

  const assignments = data ?? [];

  const statusLabel = (status: string, expired: boolean) => {
    if (expired) return t.portalDashboard.assessStatusExpired;
    switch (status) {
      case 'assigned':
        return t.portalDashboard.assessStatusAssigned;
      case 'in_progress':
        return t.portalDashboard.assessStatusInProgress;
      case 'completed':
        return t.portalDashboard.assessStatusCompleted;
      case 'cancelled':
        return t.portalDashboard.assessStatusCancelled;
      default:
        return status;
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}

      {assignments.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.assessEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {assignments.map((assignment) => {
            const expired = ACTIVE_STATUSES.has(assignment.status) && isExpired(assignment.expiresAt);
            const active = ACTIVE_STATUSES.has(assignment.status) && !expired;
            return (
              <li key={assignment.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">
                      {assignment.assessmentType.name}
                    </p>
                    {assignment.assessmentType.duration !== null && (
                      <p className="text-[11px] text-[#8B8B8B] mt-1">
                        {assignment.assessmentType.duration} {t.portalDashboard.assessMinutes}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F4F1FF] px-2.5 py-1 text-[11px] font-medium text-[#1F114C]">
                    {statusLabel(assignment.status, expired)}
                  </span>
                </div>

                {assignment.status === 'completed' && (
                  <p className="text-[12px] text-[#585858] mt-2">
                    {assignment.result?.hasPending
                      ? t.portalDashboard.assessPendingNotice
                      : `${t.portalDashboard.assessScoreLabel}: ${assignment.result?.normalizedScore ?? '—'}`}
                  </p>
                )}

                {active && (
                  <Link
                    href={`/careers/${orgSlug}/dashboard/assessments/${assignment.id}`}
                    className="mt-3 inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition"
                  >
                    {assignment.status === 'in_progress'
                      ? t.portalDashboard.assessContinue
                      : t.portalDashboard.assessStart}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/portal/dashboard-assessments.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire it into the dashboard shell**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell.tsx`:

```
old_string: import { DashboardInterviews } from './dashboard-interviews';
new_string: import { DashboardInterviews } from './dashboard-interviews';
import { DashboardAssessments } from './dashboard-assessments';
```

```
old_string:             <DashboardApplications orgSlug={orgSlug} />
            <DashboardInterviews orgSlug={orgSlug} />
            <DashboardOffer orgSlug={orgSlug} />
new_string:             <DashboardApplications orgSlug={orgSlug} />
            <DashboardInterviews orgSlug={orgSlug} />
            <DashboardAssessments orgSlug={orgSlug} />
            <DashboardOffer orgSlug={orgSlug} />
```

- [ ] **Step 7: Run the i18n hardcoded-strings gate**

Run: `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full suite + both tsc checks**

Run: `npx vitest run`
Expected: PASS.

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json "apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-assessments.tsx" "apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell.tsx" tests/portal/dashboard-assessments.test.tsx
git commit -m "feat(assessment-player): add My Assessments section to the candidate dashboard

Closes the Slice 3 -> Slice 4 gap (GitHub issue #247) — the Player was
reachable only by direct URL until now. Consumes the existing (Slice 2)
candidatePortal.getMyAssessments query as-is; no backend changes."
```

---

### Task 4: Correct stale `/me` references in design docs

**Why:** `docs/WAVE-1-CANDIDATE-PORTAL.md` and `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md` both describe the route as `/me`, which is now wrong. This repo's established convention (from every prior TS-deletion/rename session) is to fix stale docs in the same change that causes the staleness, not leave them to rot.

**Files:**

- Modify: `docs/WAVE-1-CANDIDATE-PORTAL.md`
- Modify: `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`

**Interfaces:** None — documentation only, no code/test impact.

- [ ] **Step 1: Fix `docs/WAVE-1-CANDIDATE-PORTAL.md`**

```
old_string: 1. `/careers/[orgSlug]/login` — email → `supabase.auth.signInWithOtp({ email, emailRedirectTo: …/me })`.
new_string: 1. `/careers/[orgSlug]/login` — email → `supabase.auth.signInWithOtp({ email, emailRedirectTo: …/dashboard })`.
```

```
old_string: 3. `/careers/[orgSlug]/me` (server component): verify session; resolve `Candidate{orgId,email}`; absent →
new_string: 3. `/careers/[orgSlug]/dashboard` (server component): verify session; resolve `Candidate{orgId,email}`; absent →
```

```
old_string: 4. Middleware: allow `/careers/*/login` + `/careers/*/me`; `/me` requires a session but must **not** redirect
new_string: 4. Middleware: allow `/careers/*/login` + `/careers/*/dashboard`; `/dashboard` requires a session but must **not** redirect
```

```
old_string: 1. **Candidate session** — `candidateProcedure` + login page + OTP + `/me` shell. *Security-sensitive → fresh review.*
new_string: 1. **Candidate session** — `candidateProcedure` + login page + OTP + `/dashboard` shell. *Security-sensitive → fresh review.*
```

- [ ] **Step 2: Fix `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`**

```
old_string:   status, expiresAt, result summary (score if completed). Surfaces in `/me`.
new_string:   status, expiresAt, result summary (score if completed). Surfaces in `/dashboard`.
```

```
old_string: Route under the candidate portal (logged-in): `/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]`
new_string: Route under the candidate portal (logged-in): `/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]`
```

```
old_string: 4. **/me integration** — "My Assessments" section + entry point + result display. Keeps
new_string: 4. **/dashboard integration** — "My Assessments" section + entry point + result display. Keeps
```

- [ ] **Step 3: Verify no stale `/me` references remain in either doc**

Run: `grep -n '/me' docs/WAVE-1-CANDIDATE-PORTAL.md docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`
Expected: no output (zero matches).

- [ ] **Step 4: Commit**

```bash
git add docs/WAVE-1-CANDIDATE-PORTAL.md docs/WAVE-1.5a-ASSESSMENT-PLAYER.md
git commit -m "docs(assessment): update /me references to /dashboard"
```
