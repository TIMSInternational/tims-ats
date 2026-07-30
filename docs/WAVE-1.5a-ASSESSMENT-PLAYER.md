# Wave 1.5a — Assessment-taking Player (design)

> Status: APPROVED (decisions locked Jun 10 2026). The "core differentiator" — lets a
> candidate actually TAKE an assigned assessment. Webcam proctoring is split out to
> **Wave 1.5b** (its own milestone). Builds on the Wave 1 candidate portal
> (`candidateProcedure`, magic-link identity). Canonical status: `docs/REMAINING-WORK.md`.

## Decisions (Federico, Jun 10)

1. **Split**: 1.5a = Player (questions/responses/submit/auto-scoring + Habeas-Data
   consent), **no webcam**. 1.5b = webcam proctoring (snapshots→S3, browser-integrity,
   retention, staff review) — deferred.
2. **Question types**: multiple-choice (single + multi select, incl. Likert as styled
   MCQ) **auto-scored**, plus **free-text/essay** stored for later scoring. No coding.
3. **Scoring**: auto-score MCQ now (deterministic ✓/✗ → raw/normalized). Essays stored
   **unscored**; result marked **partial/pending** until the Wave 3 `assessment-evaluator`
   agent (or manual staff scoring). No fabricated AI scores (rule #4).
4. **Taking auth**: logged-in **candidateProcedure** (Wave 1 magic-link session, orgSlug
   input, server-resolved email→Candidate, RLS via `runWithTenant`); Player lives under
   the candidate portal. Ownership verified by `candidateId`.

## What exists (Explore, Jun 10) vs missing

- **Exists**: `AssessmentType` (catalog, `duration`, `config` JSON), `AssessmentAssignment`
  (status string assigned→in_progress→completed→cancelled, `candidateId`, `expiresAt`),
  `AssessmentResult` (rawScore/normalizedScore/percentile/breakdown JSON/interpretation
  JSON/modelVersion), rich staff API (assign/bulkAssign/results/listPending/compare).
- **Missing (from scratch)**: `AssessmentQuestion`, `AssessmentResponse`, consent model;
  candidate take endpoints (only a STUB `portal.startAssessment` returning
  `/assessments/session/stub` exists, on the candidate-unreachable staff `protectedProcedure`);
  the Player UI (the `(assessment)` route group is empty). No `assessment-evaluator` agent.

## New schema (additive migration; idempotent SQL like prior migrations)

- **enum `QuestionType`**: `single_choice | multi_choice | free_text`.
- **`AssessmentQuestion`**: `id`, `organizationId`(@@index), `assessmentTypeId`(FK,@@index),
  `order` Int, `type` QuestionType, `prompt` Text, `options` Json (`[{id,label}]`, empty for
  free_text), `correctOptionIds` Json (**server-only — NEVER sent to a candidate**),
  `points` Int @default(1), `isActive` Bool, timestamps.
- **`AssessmentResponse`**: `id`, `organizationId`(@@index), `assignmentId`(FK,@@index),
  `questionId`(FK), `selectedOptionIds` Json?, `freeText` Text?, `isCorrect` Boolean?,
  `pointsAwarded` Float?, `submittedAt`, timestamps. `@@unique([assignmentId, questionId])`
  (one response per question per attempt — idempotent re-submit).
- **`AssessmentConsent`**: `id`, `organizationId`, `assignmentId`(FK,@@unique),
  `candidateId`, `consentType` (`habeas_data`), `textVersion` String, `agreedAt`,
  `ipAddress` String?, `userAgent` String?, timestamps. (Data-processing consent for storing
  responses; webcam consent is a separate 1.5b record.) RLS-enabled like every tenant table.
- **`AssessmentResult`** reused: on submit compute `rawScore` = Σ auto `pointsAwarded`,
  `normalizedScore` = raw / maxAutoPoints × 100, `breakdown` = `{autoScored, pendingManual:
  [questionIds]}`, `interpretation` null (until AI/manual), `modelVersion` null.

## Backend (clean arch: candidateProcedure → candidate-portal.service → repo)

All candidate endpoints take `orgSlug`, resolve org (→NOT_FOUND), run under
`runWithTenant(org.id)`; ownership scoped by `candidateId`; explicit `select` (rule: no
correctOptionIds to candidates). New `candidatePortal.*` (remove the dead staff stubs):

- **`getMyAssessments(orgSlug)`** — assignments for the candidate: type name, duration,
  status, expiresAt, result summary (score if completed). Surfaces in `/dashboard`.
- **`startAssessment({orgSlug, assignmentId, consentAccepted})`** — verify ownership +
  not expired + status ∈ {assigned, in_progress}; require `consentAccepted` (record
  `AssessmentConsent` w/ ip/ua + textVersion on first start); set `startedAt` + status
  `in_progress`. Idempotent if already in_progress.
- **`getAssessmentQuestions({orgSlug, assignmentId})`** — verify ownership + in_progress +
  not expired; return questions **without `correctOptionIds`** (DTO: id, order, type,
  prompt, options[{id,label}], points), ordered by `order`.
- **`submitAssessment({orgSlug, assignmentId, answers[]})`** — ATOMIC ($transaction under
  tenant): verify ownership + in_progress + not expired; reject double-submit (completed →
  CONFLICT); validate each `questionId` belongs to the assignment's `assessmentTypeId`;
  upsert one `AssessmentResponse` per question; **auto-score MCQ** (`selectedOptionIds`
  set-equals `correctOptionIds` → isCorrect/pointsAwarded), free_text → isCorrect/points
  null; compute+upsert `AssessmentResult` (partial when essays present); set `completedAt`
  + status `completed`. Bounded: `answers` `.max(N)`, `freeText` `.max(...)`,
  `selectedOptionIds` `.max(...)`. Returns result summary (auto score; essays pending).

**Pure, TDD-first functions** (no DB/network): `scoreChoice(selectedIds, correctIds, points)`
→ `{isCorrect, pointsAwarded}` (set-equality, order-independent); `computeResult(graded)` →
`{rawScore, normalizedScore, hasPending}`.

**Staff question authoring** (so questions exist to take): minimal `assessment.*`
(`permissionProcedure`) — `createQuestion / listQuestions / updateQuestion / deleteQuestion`
(bounded, validates type/options/correctOptionIds coherence) + a small authoring panel under
the staff assessments area. (Open: full authoring UI vs seed-only — proposed minimal CRUD;
confirm at slice 1.)

## Frontend (Player)

Route under the candidate portal (logged-in): `/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]`
(or the empty `(assessment)` group, scoped to candidates). States: loading/error/empty.
- **Consent gate** first: Habeas-Data data-processing text (es/en, versioned) + checkbox →
  `startAssessment`. Blocks the test until accepted.
- **Player**: question navigator + progress, **timer** from `AssessmentType.duration`
  (soft — server re-checks `expiresAt`), MCQ (radio/checkbox from options), free-text
  (textarea, bounded), per-question local autosave, submit confirmation.
- **Result screen**: auto score + breakdown; "pending review" for essays. i18n es/en.

## Vertical slices (each = gate + codex review, merge; deploy with the wave)

1. **Schema + staff authoring** — 3 new models + enum + migration; `assessment.*` question
   CRUD + minimal authoring UI. TDD: option/correct coherence validation.
2. **Candidate take backend** — `getMyAssessments / startAssessment(consent) /
   getAssessmentQuestions / submitAssessment(auto-score)` via candidateProcedure; remove
   dead `portal.getMyAssessments`/`startAssessment` stubs (ALREADY REMOVED — Wave 2.5 slice 2 deleted all eight dead staff-session portal
   stubs; this step is a no-op, skip it.). TDD: `scoreChoice`,
   `computeResult`, ownership/expiry/no-correct-leak/double-submit guards.
   **Carry-over from slice-1 codex review (medium):** the `submitAssessment` writer
   MUST enforce, in-transaction, that every `questionId` belongs to the assignment's
   `assessmentTypeId` and that response org == assignment org (no DB composite FK in
   slice 1 — the response table has no writer yet; enforce here before any write).
3. **Player UI** — consent gate + navigator + timer + MCQ/essay + submit + result; i18n.
4. **/dashboard integration** — "My Assessments" section + entry point + result display. Keeps
   `assessment.getExplainability` NOT_IMPLEMENTED (Wave 3).

## Security / invariants

candidateProcedure + ownership by candidateId + `runWithTenant` RLS; `getAssessmentQuestions`
NEVER returns `correctOptionIds`; submit validates question↔assignment type, enforces expiry,
blocks double-submit, bounds all inputs; consent recorded with ip/ua + version for
non-repudiation; honest scoring (essays pending, never faked).

## Deferred (NOT in 1.5a)

- **Wave 1.5b**: webcam proctoring (`ProctoringEvent`/`WebcamCapture`/S3/retention/staff
  review UI/webcam consent) — promotes the existing `ProctoringSession` JSON shell.
- **Wave 3**: `assessment-evaluator` AI agent (essay scoring; lights up `getExplainability`).
- Coding questions (Monaco editor).
