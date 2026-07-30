# Assessment Player — Back to Dashboard Link Design

> Status: APPROVED (Federico, 2026-07-30, conversational approval — see brainstorming
> session). Closes GitHub issue #277, filed during the Slice 4 whole-branch review
> ("Assessment Player Slice 4 — dashboard entry point", merged to `main` at `ee59fe6`).

## Context

Slice 4 made the candidate dashboard (`/careers/[orgSlug]/dashboard`) the intended entry
point into the assessment player (`.../dashboard/assessments/[assignmentId]`) via a new
"My Assessments" section. The player itself has zero `href`/`Link`/`router` usage anywhere
in its `_components/` tree — a candidate who clicks in has no in-app way back except browser
back/forward. This was harmless while the player was direct-URL-only (Slice 3); it's a real
gap now that the dashboard is the intended entry point.

## Decision from brainstorming

The link is hidden while the timed question wizard (`status: 'in_progress'`) is active, and
shown on every other state (loading, error, not-found, cancelled, completed/result screen,
assigned/consent gate, not-startable). Rationale: avoid tempting an accidental early exit
from a running, timed assessment — the wizard was deliberately built (Slice 3) with no
back-out affordance, and this shouldn't reintroduce one. Every surrounding state has no such
concern.

## Implementation

**New file**: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link.tsx`
— a small presentational component:

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

Styled to match the existing "back to jobs" link on the login page
(`apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx`) for visual consistency across the
candidate portal's secondary-navigation links.

**Wiring**: `assessment-player-shell.tsx` (86 lines) has 8 independent early-return
branches. `<AssessmentBackLink orgSlug={orgSlug} />` is added immediately before the
returned content in every branch **except** `in_progress` — preserving the file's existing
guard-clause style rather than restructuring into a single wrapped-content pattern. This
keeps each branch's diff small and independently reviewable.

**i18n**: new key `t.assessmentPlayer.backToDashboard` in both `en.json`/`es.json`
(`"Back to dashboard"` / `"Volver al panel"`), added to the existing `assessmentPlayer`
namespace.

## Testing

Extend the existing `tests/portal/assessment-player-shell.test.tsx` (already has one `it`
per status branch) — add one assertion per existing test case confirming
`en.assessmentPlayer.backToDashboard` is present via `screen.getByText`, except the
`in_progress` case, which asserts `screen.queryByText(...)` is absent.

## Out of scope

No backend changes. No change to the wizard's own internal navigation (question
Back/Next). No confirmation dialog on the link (unlike the submit-confirm step, leaving via
this link doesn't submit or lose anything — the draft autosaves to `localStorage` and no
`in_progress` state permits this link's rendering in the first place).
