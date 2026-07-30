# Assessment Player Slice 3 — Player UI Design

> Status: APPROVED (Federico, 2026-07-29, conversational approval — see brainstorming
> session). Continues [[Assessment Player Slice 2]] (candidate take-flow backend,
> merged to `main` at `e2b9f0d`). Builds toward `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`'s
> Slice 3 (Player UI). **Slice 4 (`/me` dashboard entry point) is explicitly NOT part
> of this design** — this page is reachable only via direct URL
> (`/careers/[orgSlug]/me/assessments/[assignmentId]`) until Slice 4 wires up an
> entry point from the candidate dashboard, matching the design doc's own vertical
> slice ordering.

## Context

Slice 2 shipped the full backend: `candidatePortal.getMyAssessments/startAssessment/
getAssessmentQuestions/submitAssessment` (`packages/api/src/routers/candidate-portal.ts`),
with stable error codes and DTO shapes. Nothing in `apps/web` consumes it yet. This
slice builds the candidate-facing page that does.

**No new backend work in this slice.** Everything below builds against the
Slice-2 contract as-is.

## Decisions from brainstorming (2026-07-29)

1. **Question navigation: one question per screen** (wizard/quiz style), not a
   single scrollable page with every question. Rationale: clearer progress signal,
   simpler mobile layout, natural fit for a per-question timer focus.
2. **Autosave is client-side only** (`localStorage`), not a new server endpoint.
   The backend has exactly one write (`submitAssessment`, called once at the end);
   "per-question local autosave" means answers survive a refresh/tab-close via
   `localStorage`, then all get sent in one `submitAssessment` call.
3. **Timer expiry auto-submits.** When the client-side countdown hits 0:00, the
   page automatically calls `submitAssessment` with whatever's answered so far
   (unanswered questions are handled the same way the backend already handles any
   unanswered question — scored 0, still counted in the denominator). No "time's
   up, please hurry" limbo state. If the server's own `expiresAt` check _also_
   rejects the attempt (`assignment_expired` — e.g. clock skew, or the assignment's
   absolute deadline was tighter than the visible countdown), show a clear
   "time's up" message instead of a raw error.

## Route & page structure

New page: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/page.tsx`.

(The design doc's "`(assessment)` route group" doesn't exist in the repo — confirmed
via `find apps/web/app`. Using the concrete path under the existing `me/` tree
instead, matching every other Wave-1 portal feature's organization — e.g.
`me/page.tsx` → `me-applications.tsx`, `me-offer.tsx`, etc.)

Server component (`page.tsx`) resolves org + Supabase auth exactly like the
existing `me/page.tsx` (`getUser()` → redirect to login if unauthenticated;
`db.organization.findUnique` by slug → `notFound()` if missing/inactive), then
renders a client shell with `orgSlug` and `assignmentId` as props. No candidate
resolution happens server-side here (unlike `me/page.tsx`, which needs the display
name) — the client shell's first query does that implicitly.

## No dedicated "get one assignment" backend query — resolved by reusing the list

**Concrete resolution of a gap found while writing this spec:** neither
`getMyAssessments` (a list) nor `getAssessmentQuestions`/`startAssessment` (which
require the assignment to already be `assigned`/`in_progress`) gives a clean
"fetch this one assignment's current status" read to bootstrap the page. Rather
than add a new backend endpoint (out of scope — Slice 2's backend is closed), the
shell calls `getMyAssessments({ orgSlug })` and finds the matching item by
`assignmentId` client-side. Candidate lists are small (a handful of assigned
assessments at most), so this is cheap and keeps this slice frontend-only.

## Components

All new files under `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/`
unless noted. Client components (`'use client'`), following the `trpc.candidatePortal.*`

- `useI18n()` pattern from `me-applications.tsx`/`me-offer.tsx`.

* **`page.tsx`** (server) — auth/org resolution, renders `<AssessmentPlayerShell>`.
* **`assessment-player-shell.tsx`** — owns the state machine. Calls
  `trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug })`, finds the item
  matching `assignmentId`. Branches on `status`:
  - not found in the list → "assessment not found" message (mirrors
    `offer-sign`'s `StatusScreen` pattern for a bad link)
  - `'assigned'` → renders `<AssessmentConsentGate>`
  - `'in_progress'` → renders `<AssessmentQuestionWizard>`
  - `'completed'` → renders `<AssessmentResultScreen>`, using the list item's
    already-present `result.normalizedScore`/`result.percentile` — **no extra
    fetch needed**, `assignmentSummarySelect` already includes them
    (`packages/api/src/repositories/candidate-assessment.repository.ts`)
  - `'cancelled'` → plain "this assessment was cancelled" message
  - query loading/error → loading spinner / generic error card (matches
    `me-applications.tsx`'s `isLoading`/`isError` branches)

  After a successful `startAssessment` mutation (from the consent gate) or
  `submitAssessment` mutation (from the wizard), the shell calls
  `utils.candidatePortal.getMyAssessments.invalidate()` so the list re-fetches
  and the state machine naturally advances — no manual state transition needed.

* **`assessment-consent-gate.tsx`** — full-page card (styled like
  `offers/sign/[token]/page.tsx`'s content card, not a dashboard `<section>`
  card) showing the versioned Habeas-Data data-processing text (es/en, under a
  new `t.assessmentPlayer.consentText*` i18n key — actual legal copy TBD by
  Federico/legal, not a frontend engineering decision) + a checkbox + a "Start
  assessment" button disabled until checked. `trpc.candidatePortal.startAssessment
.useMutation` on click with `consentAccepted: true`.

* **`assessment-question-wizard.tsx`** — fetches
  `trpc.candidatePortal.getAssessmentQuestions.useQuery({ orgSlug, assignmentId })`.
  Owns: current-question-index state, the localStorage draft (see below), and the
  timer (see below). Renders `<AssessmentQuestionCard>` for the current question
  plus Back/Next (or "Review & Submit" on the last question) and the `Q{n} of
{total}` + progress-bar header. Back/Next never hit the server.

* **`assessment-question-card.tsx`** — pure/presentational. Props: `question`
  (the `getAssessmentQuestions` DTO shape — `id, order, type, prompt, options,
points`, never `correctOptionIds`), current draft answer, `onChange`. Renders
  radio inputs for `single_choice`, checkboxes for `multi_choice` (from
  `options: {id,label}[]`), a bounded `<textarea>` for `free_text` (client-side
  `maxLength` matching the backend's `MAX_FREE_TEXT` bound, imported from
  `@tims/shared`'s exported constant if made public, else duplicated as a
  documented literal — implementer's call, prefer importing).

* **`assessment-submit-confirm.tsx`** — a confirmation step (not a browser
  `confirm()`, matching the polish level of the rest of the portal) shown when
  "Review & Submit" is clicked. Lists any unanswered question numbers ("Questions
  3, 7 are unanswered — submit anyway?"). Confirm calls
  `trpc.candidatePortal.submitAssessment.useMutation`. Skipped entirely on
  timer-triggered auto-submit (submits immediately, no confirmation step).

* **`assessment-result-screen.tsx`** — renders `normalizedScore` prominently
  (e.g. "You scored 82%"), an honest "pending review" notice when `hasPending`
  is true (essays awaiting manual grading — this project's rule #4: never
  fabricate a score for what isn't graded yet), and a plain-language summary.
  No raw `breakdown` JSON dump.

* **`lib/assessment-draft-storage.ts`** (colocated under the route, or
  `apps/web/lib/` if a pattern for route-scoped libs doesn't exist — check
  `apps/web/lib/` structure at implementation time) — small pure module:
  `readDraft(assignmentId)`, `writeDraft(assignmentId, answers)`,
  `clearDraft(assignmentId)`. Storage key: `` `assessment-draft:${assignmentId}` ``.
  Shape: `{ answers: Record<string, { selectedOptionIds?: string[]; freeText?: string
}>, updatedAt: string }`. Cleared on successful `submitAssessment`. No TTL needed
  — an assignment's own `expiresAt`/`completed` status naturally makes a stale
  draft irrelevant (the shell won't render the wizard for a completed/expired
  assignment, so a leftover draft is just inert unused storage).

* **`use-assessment-countdown.ts`** (colocated hook) — computes remaining seconds
  from `min(startedAt + assessmentType.duration*60s, expiresAt ?? Infinity) - now`,
  re-evaluated every second. **Both signals matter, not just `duration`**: an
  assignment's `expiresAt` (an absolute deadline set at assignment time) can be
  _tighter_ than what `duration` alone would suggest (e.g. assigned with 3 days to
  start, but only 60 minutes once started, with an org-configured hard deadline
  sooner than that) — the visible countdown must reflect whichever cutoff comes
  first, or it can show time that the server will reject anyway. If
  `assessmentType.duration` is `null`, no timer renders at all (untimed
  assessment type) — but `expiresAt` alone doesn't drive a visible countdown in
  that case (per the design doc, `expiresAt` is deliberately "soft"/server-side
  only when there's no explicit duration to count down from; showing a bare
  deadline-countdown for an "untimed" type would contradict its own labeling).
  Fires an `onExpire` callback (auto-submit) at 0.

## i18n

New namespace `t.assessmentPlayer.*` in `apps/web/lib/i18n/en.json` and `es.json`,
following the existing `t.portalMe.*`/`t.offers.*` convention. Must cover: consent
gate copy, wizard chrome (progress, timer, Back/Next/Submit), submit-confirmation
copy, result screen copy, and a translated message per backend error code:
`consentRequired`, `assignmentExpired`, `assignmentNotStartable`,
`assignmentNotInProgress`, `assignmentAlreadyCompleted` (this one is NOT shown as
an error — see below), `questionNotInAssessment`, `answerTypeMismatch`.

## Error handling

A small mapping (`assessment-error-messages.ts` or inline in the shell) from the
backend's stable snake_case `TRPCError.message` codes to `t.assessmentPlayer.*`
keys — no raw backend error string is ever shown to a candidate. Special case:
`assignment_already_completed` is not an error state in the UI — if a mutation
ever returns it (e.g. a stale tab race), the shell just re-fetches
`getMyAssessments` and lands on the result screen, since that code means exactly
"this is already done."

## Testing

**Concrete finding from writing this spec:** `apps/web` has zero component-
rendering test tooling today — no `@testing-library/react`, no jsdom/happy-dom.
Every existing test touching `apps/web` code (e.g. `tests/portal/candidate-
procedure.test.ts`) is static-source pattern matching against raw file text, not
actual rendering. Decision (Federico, 2026-07-29): **add real component-rendering
tests for this slice** rather than stay static-source-only, since this slice has
real interactive/behavioral properties (timer auto-submit, checkbox-gated button,
localStorage draft persistence) that static-source matching structurally cannot
verify — it can confirm the code SHAPE exists, not that it BEHAVES correctly.

**New infra this introduces (its own small setup step when this becomes a plan):**
add `@testing-library/react` + `happy-dom` (lighter than jsdom) as new
devDependencies, and a second Vitest project/config for DOM-environment component
tests (the existing root `vitest.config.ts` runs `environment: 'node'` — component
tests need `environment: 'happy-dom'` or equivalent, likely via Vitest's
multi-project `workspace` config so backend tests keep their fast node
environment and don't pay the DOM-environment cost). Verify the exact mechanism
against the installed Vitest 4.1.7's current multi-project API at plan time.

Component/behavior tests: cover per state — consent gate (checkbox gates the
button, calls `startAssessment` with `consentAccepted: true`), wizard navigation
(Back/Next don't call the server, draft persists to `localStorage` and survives a
simulated remount), timer auto-submit (fake timers, assert `submitAssessment` is
called at 0:00 with no confirmation step), result screen (renders `hasPending`
honestly, no fabricated score for pending essays), and error-code mapping (every one of the 7
codes above renders a translated message, never the raw string). Where relevant,
follow Slice 2's static-source security-assertion style (e.g. a regex check that
no component ever passes a client-computed score into `submitAssessment` — the
mutation input is `{ orgSlug, assignmentId, answers }` only, scoring happens
server-side).

## Explicitly out of scope for this slice

- Slice 4: the `/me` dashboard "My Assessments" section + entry point linking
  into this page. This page is direct-URL-only until Slice 4 lands.
- Webcam proctoring (Wave 1.5b, separate milestone).
- Any new backend endpoint or schema change — this slice is frontend-only against
  the Slice-2 contract as merged.
- `assessment.getExplainability` / AI essay scoring (Wave 3).
