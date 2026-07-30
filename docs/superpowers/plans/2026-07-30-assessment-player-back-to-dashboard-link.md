# Assessment Player — Back to Dashboard Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "back to dashboard" link to the assessment player, closing GitHub issue #277 — visible on every player state except the active timed question wizard.

**Architecture:** One new tiny presentational component (`AssessmentBackLink`) rendered conditionally from `assessment-player-shell.tsx`'s existing 8 early-return branches (all except `in_progress`). No backend changes, no new routes.

**Tech Stack:** Next.js 15 (Client Component, `next/link`), the existing `useI18n()` hook, Vitest + `@testing-library/react` (the `web-components` project — already configured).

## Global Constraints

- **i18n is mandatory, enforced by a gate:** `tests/security/i18n-no-hardcoded-strings.test.ts` source-scans `apps/web/app` for hardcoded JSX text. The link's label MUST go through `t.assessmentPlayer.backToDashboard`.
- **`tests/i18n/parity.test.ts`** requires `en.json`/`es.json` to have byte-identical key paths — the new key must land in both in the same step.
- **File size limits (CLAUDE.md):** max 300 lines/component. Both touched/created files are tiny; no risk.
- **Route depth:** `assessment-back-link.tsx` lives in the same `_components/` directory as every other component in this route (`assessment-error-messages.ts`, `assessment-consent-gate.tsx`, etc.), so its relative import to `lib/i18n` is the same 8-`../` chain already used by its siblings (confirmed by reading `assessment-error-messages.ts` and `assessment-player-shell.tsx`, both of which use `'../../../../../../../../lib/i18n'` from this exact directory).
- **No backend changes, no new routes** — the link points at the already-existing `/careers/[orgSlug]/dashboard` route (Slice 4, merged).

---

### Task 1: `AssessmentBackLink` component + wiring into `AssessmentPlayerShell`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link.tsx`
- Test: `tests/portal/assessment-back-link.test.tsx`
- Modify: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-player-shell.tsx`
- Modify: `tests/portal/assessment-player-shell.test.tsx`
- Modify: `apps/web/lib/i18n/en.json:3486-3487`, `apps/web/lib/i18n/es.json:3486-3487`

**Interfaces:**

- Produces: `AssessmentBackLink({ orgSlug }: { orgSlug: string })` — renders a `next/link` to `/careers/${orgSlug}/dashboard`, labeled `t.assessmentPlayer.backToDashboard`. Consumed by `AssessmentPlayerShell`.
- Consumes: `t.assessmentPlayer.backToDashboard` (new i18n key, added in this task).

- [ ] **Step 1: Add the i18n key to both locale files**

In `apps/web/lib/i18n/en.json`, `assessmentPlayer` is the last top-level key in the file (lines 3452-3487). Change:

```
old_string:     "errorGeneric": "Something went wrong. Please try again."
  }
}
new_string:     "errorGeneric": "Something went wrong. Please try again.",
    "backToDashboard": "Back to dashboard"
  }
}
```

In `apps/web/lib/i18n/es.json` (identical structure, same line numbers):

```
old_string:     "errorGeneric": "Algo salio mal. Intenta de nuevo."
  }
}
new_string:     "errorGeneric": "Algo salio mal. Intenta de nuevo.",
    "backToDashboard": "Volver al panel"
  }
}
```

Run: `npx vitest run tests/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing component test**

Create `tests/portal/assessment-back-link.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentBackLink } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link';

function renderLink(orgSlug: string) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentBackLink orgSlug={orgSlug} />
    </I18nProvider>,
  );
}

describe('AssessmentBackLink', () => {
  it('renders a translated link to the org-scoped dashboard route', () => {
    renderLink('tims');
    const link = screen.getByRole('link', { name: en.assessmentPlayer.backToDashboard });
    expect(link).toHaveAttribute('href', '/careers/tims/dashboard');
  });

  it('scopes the href to whichever orgSlug is passed', () => {
    renderLink('acme');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/careers/acme/dashboard');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-back-link.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement `AssessmentBackLink`**

Create `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../../../../lib/i18n';

export function AssessmentBackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/careers/${orgSlug}/dashboard`}
      className="text-[13px] text-[#8B8B8B] hover:text-[#585858] hover:underline"
    >
      {t.assessmentPlayer.backToDashboard}
    </Link>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-back-link.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the link into every branch of `AssessmentPlayerShell` except `in_progress`**

In `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-player-shell.tsx`:

```
old_string: import { AssessmentConsentGate } from './assessment-consent-gate';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { AssessmentResultScreen } from './assessment-result-screen';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
new_string: import { AssessmentConsentGate } from './assessment-consent-gate';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { AssessmentResultScreen } from './assessment-result-screen';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
import { AssessmentBackLink } from './assessment-back-link';
```

```
old_string:   if (assessmentsQuery.isLoading) {
    return <p className="text-center text-[13px] text-[#8B8B8B] p-8">{t.assessmentPlayer.loading}</p>;
  }
  if (assessmentsQuery.isError) {
    return <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>;
  }

  const assignment = (assessmentsQuery.data ?? []).find((item) => item.id === assignmentId);
  if (!assignment) {
    return <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notFound}</p>;
  }

  if (assignment.status === 'cancelled') {
    return <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.cancelled}</p>;
  }

  if (assignment.status === 'completed') {
    return (
      <AssessmentResultScreen
        normalizedScore={assignment.result?.normalizedScore ?? null}
        hasPending={assignment.result?.hasPending ?? false}
      />
    );
  }
new_string:   if (assessmentsQuery.isLoading) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#8B8B8B] p-8">{t.assessmentPlayer.loading}</p>
      </>
    );
  }
  if (assessmentsQuery.isError) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>
      </>
    );
  }

  const assignment = (assessmentsQuery.data ?? []).find((item) => item.id === assignmentId);
  if (!assignment) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notFound}</p>
      </>
    );
  }

  if (assignment.status === 'cancelled') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.cancelled}</p>
      </>
    );
  }

  if (assignment.status === 'completed') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <AssessmentResultScreen
          normalizedScore={assignment.result?.normalizedScore ?? null}
          hasPending={assignment.result?.hasPending ?? false}
        />
      </>
    );
  }
```

```
old_string:   if (assignment.status === 'assigned') {
    return (
      <AssessmentConsentGate
        isSubmitting={startMutation.isPending}
        errorMessage={consentError}
        onStart={() => {
          setConsentError(null);
          startMutation.mutate({ orgSlug, assignmentId, consentAccepted: true });
        }}
      />
    );
  }

  // Any other status (e.g. seed-data's 'pending' — not yet assigned/started) isn't
  // handled by the branches above. Falling through to the consent gate here would
  // let the candidate click Start and hit a confusing assignment_not_startable
  // backend error, so render a plain message instead.
  return <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notStartable}</p>;
}
new_string:   if (assignment.status === 'assigned') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <AssessmentConsentGate
          isSubmitting={startMutation.isPending}
          errorMessage={consentError}
          onStart={() => {
            setConsentError(null);
            startMutation.mutate({ orgSlug, assignmentId, consentAccepted: true });
          }}
        />
      </>
    );
  }

  // Any other status (e.g. seed-data's 'pending' — not yet assigned/started) isn't
  // handled by the branches above. Falling through to the consent gate here would
  // let the candidate click Start and hit a confusing assignment_not_startable
  // backend error, so render a plain message instead.
  return (
    <>
      <AssessmentBackLink orgSlug={orgSlug} />
      <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notStartable}</p>
    </>
  );
}
```

Note: the `in_progress` branch (status === 'in_progress', renders `<AssessmentQuestionWizard>`) is **deliberately left unchanged** — no `AssessmentBackLink` there, per the design's decision to hide the link during the active timed wizard.

- [ ] **Step 7: Extend `tests/portal/assessment-player-shell.test.tsx`**

Add one assertion to each existing test case (except the `in_progress` one, which gets an absence assertion instead):

```
old_string:   it('renders a not-found message when assignmentId matches nothing in the list', () => {
    assessmentsQueryData = [{ id: 'other', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notFound)).toBeInTheDocument();
  });

  it('renders the consent gate for status=assigned', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.consentTitle)).toBeInTheDocument();
  });

  it('renders the question wizard for status=in_progress', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'in_progress',
        startedAt: new Date(),
        expiresAt: null,
        assessmentType: { duration: null },
        result: null,
      },
    ];
    renderShell();
    expect(screen.getByText('wizard-stub')).toBeInTheDocument();
  });

  it('renders the result screen for status=completed, using the list item result directly (no extra fetch)', () => {
    assessmentsQueryData = [
      { id: 'a1', status: 'completed', result: { normalizedScore: 90, percentile: 80, hasPending: false } },
    ];
    renderShell();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
  });

  it('renders a plain cancelled message for status=cancelled', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'cancelled', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.cancelled)).toBeInTheDocument();
  });

  it('renders a fallback message (not the consent gate) for an unrecognized status like pending', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'pending', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notStartable)).toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.consentTitle)).not.toBeInTheDocument();
  });
new_string:   it('renders a not-found message when assignmentId matches nothing in the list', () => {
    assessmentsQueryData = [{ id: 'other', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notFound)).toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.backToDashboard)).toBeInTheDocument();
  });

  it('renders the consent gate for status=assigned', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.consentTitle)).toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.backToDashboard)).toBeInTheDocument();
  });

  it('renders the question wizard for status=in_progress, WITHOUT the back-to-dashboard link', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'in_progress',
        startedAt: new Date(),
        expiresAt: null,
        assessmentType: { duration: null },
        result: null,
      },
    ];
    renderShell();
    expect(screen.getByText('wizard-stub')).toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.backToDashboard)).not.toBeInTheDocument();
  });

  it('renders the result screen for status=completed, using the list item result directly (no extra fetch)', () => {
    assessmentsQueryData = [
      { id: 'a1', status: 'completed', result: { normalizedScore: 90, percentile: 80, hasPending: false } },
    ];
    renderShell();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.backToDashboard)).toBeInTheDocument();
  });

  it('renders a plain cancelled message for status=cancelled', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'cancelled', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.cancelled)).toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.backToDashboard)).toBeInTheDocument();
  });

  it('renders a fallback message (not the consent gate) for an unrecognized status like pending', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'pending', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notStartable)).toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.consentTitle)).not.toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.backToDashboard)).toBeInTheDocument();
  });
```

Note: this test file has no dedicated loading/error test cases today (the mocked `trpc.candidatePortal.getMyAssessments.useQuery` always returns `isLoading: false, isError: false` — see the file's `vi.mock` block) — so the `AssessmentBackLink`'s rendering in those two branches is covered structurally by Step 4-5's own component test, not by this file. Do not add loading/error cases here; that would require restructuring this file's mock beyond this task's scope.

- [ ] **Step 8: Run to verify all tests pass**

Run: `npx vitest run tests/portal/assessment-player-shell.test.tsx tests/portal/assessment-back-link.test.tsx`
Expected: PASS (all 8 tests: 6 in `assessment-player-shell.test.tsx`, 2 in `assessment-back-link.test.tsx`).

- [ ] **Step 9: Run the i18n hardcoded-strings gate and the full suite + both tsc checks**

Run: `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS (same 270 files / 2599+4 tests as the post-Slice-4 baseline, plus the 6 new assertions/2 new test cases added in this task).

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS (this task touches no backend code, but re-run per CLAUDE.md's "both must pass before any commit").

- [ ] **Step 10: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link.tsx" "apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-player-shell.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/portal/assessment-back-link.test.tsx tests/portal/assessment-player-shell.test.tsx
git commit -m "$(cat <<'EOF'
feat(assessment-player): add back-to-dashboard link

Closes GitHub issue #277, filed during the Slice 4 whole-branch review —
the player had zero in-app navigation back to the candidate dashboard,
which became a real gap once Slice 4 made the dashboard the intended
entry point. Hidden only during the active timed question wizard, to
avoid tempting an accidental early exit.
EOF
)"
```
