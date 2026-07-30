# Assessment Player Slice 3 — Player UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the candidate-facing assessment-taking page (`/careers/[orgSlug]/me/assessments/[assignmentId]`) that consumes the Slice-2 backend contract (`candidatePortal.getMyAssessments/startAssessment/getAssessmentQuestions/submitAssessment`) end to end — consent, timed question wizard with local draft autosave, and a result screen.

**Architecture:** A server `page.tsx` resolves auth/org (mirrors `me/page.tsx`) and renders a client `AssessmentPlayerShell` state machine keyed off `getMyAssessments`'s per-assignment `status` (`assigned` → consent gate, `in_progress` → question wizard, `completed` → result screen, `cancelled`/not-found → plain message). No new backend endpoints; one small backend DTO fix (below) closes a real gap the spec's own claim didn't account for.

**Tech Stack:** Next.js 15 App Router (Server + Client Components), tRPC + React Query (`trpc.candidatePortal.*`), Zod (existing `@tims/shared` schemas), Tailwind, Vitest 4.1 with a new `happy-dom` project + `@testing-library/react` for the first real component-rendering tests in `apps/web`.

## Global Constraints

- **File size limits (CLAUDE.md):** max 300 lines/component, max 300 lines/service file. Every file below is well under that; do not fold components together to save files.
- **No `any`, no `z.any()`.** `AssessmentResult.breakdown` is a Prisma `Json?` — narrow it with an explicit type guard (Task 1), never cast to `any`.
- **i18n is mandatory and enforced by an existing gate:** `tests/security/i18n-no-hardcoded-strings.test.ts` source-scans every file under `apps/web/app` for hardcoded JSX text/placeholder/aria-label/ternary/setter string literals. Every user-facing string in every new component MUST go through `t.assessmentPlayer.*` (verified: this scanner treats candidate/auth-facing surfaces as already fully clean — no grandfathering here). Bare symbols with no letters (e.g. `%`, spaces) are exempt by the scanner's own `looksLikeProse` letter-requirement — confirmed safe to use directly.
- **`tests/i18n/parity.test.ts`** requires `en.json` and `es.json` to have byte-identical key paths. Every key added to one MUST be added to the other in the same task.
- **superjson is the tRPC transformer** (`packages/api/src/trpc.ts`, `apps/web/lib/trpc-provider.tsx`) — Prisma `Date` fields (`startedAt`, `expiresAt`, `completedAt`) arrive on the client as real `Date` objects, NOT strings. Do not `new Date(...)`-wrap them again.
- **Naming convention actually in use under `apps/web/app`:** newer routes colocate private files under `_components/` (e.g. `(admin)/recruitment/offers/_components/`, `(portal)/careers/[orgSlug]/_components/`) — a Next.js "private folder" (leading underscore is excluded from routing). This plan follows that convention for both components and pure-logic files (`_lib/`), not the older flat-file style seen in the pre-existing `me/` folder.
- **Route depth:** `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/` is 6 levels under `app/`. Relative imports to `apps/web/lib/*` are **7** `../` from `page.tsx`, **8** `../` from anything in `_components/` or `_lib/` (verified with `os.path.relpath`, not by hand-counting).
- **No new backend endpoint or schema change** (spec's own out-of-scope line) — Task 1 widens an existing `select` and adds a pure derivation in the service layer. That is a query/DTO change, not a new endpoint or a `schema.prisma` migration.

---

### Task 1: Fix the `hasPending` gap in `getMyAssessments` (backend)

**Why this task exists:** The spec claims the result screen can render `hasPending` "using the list item's already-present `result.normalizedScore`/`result.percentile` — no extra fetch needed, `assignmentSummarySelect` already includes them." This is **false** — verified by reading `packages/api/src/repositories/candidate-assessment.repository.ts`: `assignmentSummarySelect`'s `result` sub-select is `{ normalizedScore: true, percentile: true }` only. `hasPending` is currently computed ephemerally inside `submitAssessment`'s transaction (`computeResult()` in `packages/shared/src/validators/assessment.ts`) and returned only from that one mutation call — it is never persisted as its own column. The only persisted trace is `AssessmentResult.breakdown` (`Json?`, shaped `{ autoScored: number, pendingManual: string[] }` per `candidateAssessmentWriteRepo.upsertResultInTx`'s caller). This task widens the select to include `breakdown` and derives `hasPending` server-side, so the frontend never has to parse raw internal JSON.

**Files:**

- Modify: `packages/api/src/repositories/candidate-assessment.repository.ts:17-25` (`assignmentSummarySelect`)
- Modify: `packages/api/src/services/candidate-assessment.service.ts:23-30` (`getMyAssessments`)
- Modify: `tests/assessment/candidate-assessment-service.test.ts:53-72` (update the one existing pass-through test + add 2 new cases)

**Interfaces:**

- Produces: `candidateAssessmentService.getMyAssessments(email, orgSlug)` now returns each assignment with `result: { normalizedScore: number | null; percentile: number | null; hasPending: boolean } | null` (was previously `{ normalizedScore, percentile } | null` with no `hasPending`, and never stripped `breakdown` because it was never selected). Every other field on the assignment (`id`, `status`, `startedAt`, `completedAt`, `expiresAt`, `assessmentType`) is unchanged.
- Consumes (Task 15/frontend): the frontend reads `assignment.result?.hasPending` and `assignment.result?.normalizedScore` — no `breakdown` field is ever exposed to the client.

- [ ] **Step 1: Write the failing tests**

Add to `tests/assessment/candidate-assessment-service.test.ts`, inside the existing `describe('candidateAssessmentService.getMyAssessments', ...)` block (after the `"returns the candidate's assignments"` test):

```ts
it('derives hasPending=true and strips breakdown when the result has pending manual questions', async () => {
  vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
  vi.mocked(candidateAssessmentRepo.findAssignmentsForCandidate).mockResolvedValue([
    {
      id: 'a1',
      status: 'completed',
      result: { normalizedScore: 80, percentile: null, breakdown: { autoScored: 3, pendingManual: ['q1'] } },
    },
  ] as never);
  const result = await candidateAssessmentService.getMyAssessments(EMAIL, SLUG);
  expect(result).toEqual([
    { id: 'a1', status: 'completed', result: { normalizedScore: 80, percentile: null, hasPending: true } },
  ]);
});

it('derives hasPending=false when breakdown.pendingManual is empty', async () => {
  vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
  vi.mocked(candidateAssessmentRepo.findAssignmentsForCandidate).mockResolvedValue([
    {
      id: 'a2',
      status: 'completed',
      result: { normalizedScore: 100, percentile: 90, breakdown: { autoScored: 3, pendingManual: [] } },
    },
  ] as never);
  const result = await candidateAssessmentService.getMyAssessments(EMAIL, SLUG);
  expect(result).toEqual([
    { id: 'a2', status: 'completed', result: { normalizedScore: 100, percentile: 90, hasPending: false } },
  ]);
});
```

Update the existing `"returns the candidate's assignments"` test (it currently mocks a bare `{ id: 'a1' }` with no `result` key, which is unrealistic — `assignmentSummarySelect` always selects `result`, so a real row without one yet is `result: null`):

```ts
it("returns the candidate's assignments", async () => {
  vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
  vi.mocked(candidateAssessmentRepo.findAssignmentsForCandidate).mockResolvedValue([
    { id: 'a1', status: 'assigned', result: null },
  ] as never);
  expect(await candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).toEqual([
    { id: 'a1', status: 'assigned', result: null },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts -t "getMyAssessments"`
Expected: FAIL — the two new tests fail because `hasPending`/`breakdown` handling doesn't exist yet; the updated existing test currently passes trivially (pure pass-through) but will start failing once Step 3's mapping is added if the mapping isn't a correct no-op for `result: null` — re-run after Step 3 to confirm.

- [ ] **Step 3: Widen the select and add the mapping**

In `packages/api/src/repositories/candidate-assessment.repository.ts`, change:

```ts
const assignmentSummarySelect = {
  id: true,
  status: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  assessmentType: { select: { id: true, name: true, duration: true } },
  result: { select: { normalizedScore: true, percentile: true } },
} satisfies Prisma.AssessmentAssignmentSelect;
```

to:

```ts
const assignmentSummarySelect = {
  id: true,
  status: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  assessmentType: { select: { id: true, name: true, duration: true } },
  // breakdown is selected ONLY so candidateAssessmentService.getMyAssessments can derive
  // hasPending (Wave 1.5a slice 3) — it is stripped before the DTO leaves the service,
  // never returned to the client as raw JSON.
  result: { select: { normalizedScore: true, percentile: true, breakdown: true } },
} satisfies Prisma.AssessmentAssignmentSelect;
```

In `packages/api/src/services/candidate-assessment.service.ts`, add near the top (after the existing helper functions, before `STARTABLE_STATUSES`):

```ts
import type { Prisma } from '@tims/db';

// AssessmentResult.breakdown is a Prisma Json? column shaped { autoScored, pendingManual }
// (see candidateAssessmentWriteRepo's upsertResultInTx caller in submitAssessment below) — but
// Json has no compile-time shape, so this is a runtime guard, never a cast to `any`.
function hasPendingManualReview(breakdown: Prisma.JsonValue | null | undefined): boolean {
  if (breakdown === null || breakdown === undefined || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return false;
  }
  const pendingManual = (breakdown as Record<string, unknown>).pendingManual;
  return Array.isArray(pendingManual) && pendingManual.length > 0;
}

interface AssignmentResultSummary {
  normalizedScore: number | null;
  percentile: number | null;
  breakdown: Prisma.JsonValue | null;
}

// Strips the internal `breakdown` JSON and replaces it with a derived `hasPending` boolean —
// the candidate-facing result screen (Wave 1.5a slice 3) must never receive raw breakdown JSON.
function withPendingFlag<T extends { result: AssignmentResultSummary | null }>(assignment: T) {
  const { result, ...rest } = assignment;
  if (!result) return { ...rest, result: null };
  const { breakdown, ...resultRest } = result;
  return { ...rest, result: { ...resultRest, hasPending: hasPendingManualReview(breakdown) } };
}
```

Change `getMyAssessments`:

```ts
  async getMyAssessments(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      const assignments = await candidateAssessmentRepo.findAssignmentsForCandidate(org.id, candidate.id);
      return assignments.map(withPendingFlag);
    });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: PASS (all tests in the file, not just the 3 touched — confirm no other test in this file broke)

- [ ] **Step 5: Run the static-source security tests that reference `assignmentSummarySelect`/the repo file**

Run: `npx vitest run tests/portal/candidate-procedure.test.ts`
Expected: PASS — `assignmentSummarySelect`'s indexOf is used only as a text-slice boundary marker for an unrelated `correctOptionIds` leak check; confirm it still passes (it should, since the identifier name and its position relative to `candidateQuestionSelect` are unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/candidate-assessment.repository.ts packages/api/src/services/candidate-assessment.service.ts tests/assessment/candidate-assessment-service.test.ts
git commit -m "fix(assessments): derive hasPending in getMyAssessments instead of leaving it unreachable

The Slice 3 Player UI design assumed assignmentSummarySelect already exposed
enough to render an honest 'pending review' notice on the result screen. It
didn't — hasPending was only ever a transient value returned from
submitAssessment's mutation response, never persisted as its own field, and
the read-side select never selected breakdown (where it can be derived from)."
```

---

### Task 2: Export `MAX_FREE_TEXT` from `@tims/shared`

**Why:** the spec calls for the free-text question textarea's client-side `maxLength` to mirror the backend's bound, "imported from `@tims/shared`'s exported constant if made public, else duplicated as a documented literal — implementer's call, prefer importing." It is currently a module-private `const` in `packages/shared/src/validators/assessment.ts:145` (`const MAX_FREE_TEXT = 20000;`), not exported, not re-exported by `packages/shared/src/index.ts` (`export * from './validators'`).

**Files:**

- Modify: `packages/shared/src/validators/assessment.ts:145`
- Modify: `tests/assessment/assessment-scoring.test.ts` (add one assertion)

**Interfaces:**

- Produces: `MAX_FREE_TEXT: number` (value `20000`), importable as `import { MAX_FREE_TEXT } from '@tims/shared'`. Consumed by Task 9 (`AssessmentQuestionCard`).

- [ ] **Step 1: Write the failing test**

Add to `tests/assessment/assessment-scoring.test.ts` (top-level `describe` block, alongside the existing `scoreChoice`/`computeResult` tests):

```ts
import { MAX_FREE_TEXT } from '../../packages/shared/src/validators/assessment';

describe('MAX_FREE_TEXT', () => {
  it('is exported for the frontend free_text textarea bound to mirror', () => {
    expect(MAX_FREE_TEXT).toBe(20000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: FAIL — `MAX_FREE_TEXT` is not exported from the module.

- [ ] **Step 3: Export it**

In `packages/shared/src/validators/assessment.ts`, change:

```ts
const MAX_FREE_TEXT = 20000;
```

to:

```ts
export const MAX_FREE_TEXT = 20000;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/assessment.ts tests/assessment/assessment-scoring.test.ts
git commit -m "chore(shared): export MAX_FREE_TEXT so the frontend can mirror the backend's bound"
```

---

### Task 3: Add component-rendering test infrastructure (devDeps + Vitest `projects` + setup file)

**Why:** `apps/web` has zero component-rendering test tooling today (verified: no `@testing-library/react`, no `happy-dom`/`jsdom` anywhere in `package.json` or `apps/web/package.json`; every existing `apps/web`-touching test is static-source pattern matching). The spec calls for real rendering tests. Verified this session against the installed Vitest 4.1.7 / docs for 4.1.6 via context7: the `workspace` option and separate `vitest.workspace.ts` file are deprecated since Vitest 3.2 in favor of an inline `test.projects` array in the single root `vitest.config.ts` — do NOT create a `vitest.workspace.ts`.

Package versions below are pinned exact (per CLAUDE.md's "lock all dependency versions" policy) and were checked against both the npm registry (`npm view <pkg> version`) and this repo's `pnpm-lock.yaml`, which resolves `vite@8.0.14` — `@vitejs/plugin-react@6.0.4`'s peer range is `vite: '^8.0.0'`, the correct match (the `5.x` line only supports through `^7.0.0` and would mismatch).

**Files:**

- Modify: `package.json` (devDependencies)
- Modify: `vitest.config.ts`
- Create: `tests/setup/component-test-setup.ts`

**Interfaces:**

- Produces: a Vitest project named `web-components` matching `tests/**/*.test.tsx`, `environment: 'happy-dom'`, with `@testing-library/jest-dom` matchers auto-registered and DOM auto-cleanup after each test. The existing `node` project (renamed from the implicit root config) keeps matching `tests/**/*.test.ts` and `scripts/**/*.test.ts` under `environment: 'node'`, unchanged behavior.
- Consumes (later tasks): Tasks 9-14's `.test.tsx` files run under this new project. Tasks 6-7's `.test.ts` files use a per-file `@vitest-environment happy-dom` docblock override instead (see Task 6/7) — they don't need JSX or jest-dom matchers, only a DOM global (`window.localStorage`) and `@testing-library/react`'s `renderHook`, so they stay in the `node` project's `.test.ts` glob with the docblock override, keeping the new project's surface area minimal.

- [ ] **Step 1: Add the devDependencies**

In `package.json`, add to `devDependencies` (alphabetically, matching the existing sorted list):

```json
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
```

(insert between `"@supabase/supabase-js"` and `"@types/pg"`)

```json
    "@vitejs/plugin-react": "6.0.4",
```

(insert between `"@typescript-eslint/parser"` and `"eslint"`)

```json
    "happy-dom": "20.11.1",
```

(insert between `"eslint-config-prettier"` and `"husky"`)

Run: `pnpm install`
Expected: lockfile updates, no errors. If pnpm reports a peer-dependency conflict on `@vitejs/plugin-react`'s `vite` peer, re-check `pnpm-lock.yaml`'s resolved `vite@` version (`grep -E '^  vite@[0-9]' pnpm-lock.yaml`) and adjust the plugin-react version to match its peer range — do not silently force/ignore a peer conflict.

- [ ] **Step 2: Create the shared component-test setup file**

Create `tests/setup/component-test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
```

- [ ] **Step 3: Restructure `vitest.config.ts` into two projects**

Replace the full contents of `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source so vi.mock('@tims/...') works
      // reliably without pnpm symlink path mismatches.
      '@tims/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@tims/api': resolve(__dirname, 'packages/api/src/root.ts'),
      '@tims/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@tims/ai': resolve(__dirname, 'packages/ai/src/index.ts'),
      // Allow tests to import @trpc/server (hosted under packages/api's node_modules via pnpm)
      '@trpc/server': resolve(__dirname, 'packages/api/node_modules/@trpc/server'),
      // Allow tests to import @prisma/client directly (e.g. Prisma.PrismaClientKnownRequestError
      // for P2002 error-shaped mocks), hosted under packages/api's node_modules via pnpm.
      '@prisma/client': resolve(__dirname, 'packages/api/node_modules/@prisma/client'),
      // `import 'server-only'` throws when imported outside the Next.js server bundler
      // (its default export is a hard `throw`). Alias it to an empty module so the
      // pure, unit-testable core of server-only helpers can be imported under vitest.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: { label: 'node', color: 'green' },
          environment: 'node',
          include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: { label: 'web-components', color: 'magenta' },
          environment: 'happy-dom',
          include: ['tests/**/*.test.tsx'],
          setupFiles: ['./tests/setup/component-test-setup.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Verify the existing suite still passes under the restructured config**

Run: `npx vitest run`
Expected: PASS — every existing `.test.ts` file still collects under the `node` project with identical behavior (no `.test.tsx` files exist yet, so the `web-components` project matches zero files at this point, which is fine).

If this fails specifically on the `web-components` project's `plugins: [react()]` placement (i.e. Vitest rejects a non-`test` key inside a project entry), the fallback is to move `web-components`' config to its own file `vitest.web.config.ts` (containing `plugins: [react()]` + the `test` block) and reference it in `projects` as a path string alongside the inline `node` entry — do this only if Step 4 actually fails, not preemptively.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/setup/component-test-setup.ts
git commit -m "chore(test): add happy-dom + Testing Library as a second Vitest project

apps/web has had zero component-rendering test tooling until now — every
existing apps/web-touching test is static-source pattern matching. Slice 3's
timer/checkbox/localStorage behaviors need real rendering, so this adds a
'web-components' Vitest project (Vitest 4's test.projects, NOT the deprecated
workspace/vitest.workspace.ts) alongside the existing node project."
```

---

### Task 4: Add the `assessmentPlayer` i18n namespace

**Files:**

- Modify: `apps/web/lib/i18n/en.json`
- Modify: `apps/web/lib/i18n/es.json`

**Interfaces:**

- Produces: `t.assessmentPlayer.*` — consumed by every component task below (9-14).

**Note:** confirmed via `git show main:apps/web/lib/i18n/en.json` that a top-level `"assessments"` namespace already exists but is the **staff authoring UI** (create/edit questions — keys like `selectType`, `noQuestions`, `promptRequired`). `assessmentPlayer` is a distinct new namespace, no collision. The consent-gate body copy below is placeholder text — the spec explicitly defers the real Habeas-Data legal copy to Federico/legal, not an engineering decision; do not treat this as unfinished plan work.

- [ ] **Step 1: Add to `apps/web/lib/i18n/en.json`**

Insert a new top-level key (anywhere in the object — file is not alphabetically ordered; append after the last key, before the final closing `}`, adding a comma after the previous last entry):

```json
  "assessmentPlayer": {
    "loading": "Loading...",
    "loadError": "Something went wrong loading your assessment.",
    "notFound": "We couldn't find that assessment.",
    "cancelled": "This assessment was cancelled.",
    "consentTitle": "Before you begin",
    "consentBody": "This assessment will collect your responses and, where applicable, timing data to evaluate your application. By continuing, you agree to this processing of your data for recruitment purposes, in line with our data protection policy. (Placeholder copy pending legal review.)",
    "consentCheckboxLabel": "I have read and agree to the data processing terms above.",
    "consentStartButton": "Start assessment",
    "consentStarting": "Starting...",
    "questionLabel": "Question",
    "ofLabel": "of",
    "timerLabel": "Time remaining:",
    "wizardBack": "Back",
    "wizardNext": "Next",
    "wizardReviewSubmit": "Review & submit",
    "questionCardFreeTextPlaceholder": "Type your answer here...",
    "submitConfirmTitle": "Submit your assessment?",
    "submitConfirmUnansweredPrefix": "Unanswered questions:",
    "submitConfirmBody": "Once submitted, you cannot change your answers.",
    "submitConfirmCancelButton": "Keep reviewing",
    "submitConfirmConfirmButton": "Submit",
    "submitConfirmSubmitting": "Submitting...",
    "resultTitle": "Assessment complete",
    "resultScoreLabel": "You scored",
    "resultPendingNotice": "Some of your answers are still awaiting manual review — your final score may change.",
    "resultSummary": "Thank you for completing this assessment. Our team will follow up with next steps.",
    "errorConsentRequired": "You must accept the data processing terms to continue.",
    "errorAssignmentExpired": "This assessment's time window has expired.",
    "errorAssignmentNotStartable": "This assessment can no longer be started.",
    "errorAssignmentNotInProgress": "This assessment isn't currently in progress.",
    "errorQuestionNotInAssessment": "One of your answers referenced a question that isn't part of this assessment.",
    "errorAnswerTypeMismatch": "One of your answers doesn't match its question's expected format.",
    "errorGeneric": "Something went wrong. Please try again."
  }
```

- [ ] **Step 2: Add the identical key structure to `apps/web/lib/i18n/es.json`**

```json
  "assessmentPlayer": {
    "loading": "Cargando...",
    "loadError": "Ocurrio un error al cargar tu evaluacion.",
    "notFound": "No encontramos esa evaluacion.",
    "cancelled": "Esta evaluacion fue cancelada.",
    "consentTitle": "Antes de comenzar",
    "consentBody": "Esta evaluacion recopilara tus respuestas y, cuando aplique, datos de tiempo para evaluar tu postulacion. Al continuar, aceptas este tratamiento de tus datos con fines de reclutamiento, conforme a nuestra politica de proteccion de datos. (Texto provisional pendiente de revision legal.)",
    "consentCheckboxLabel": "He leido y acepto los terminos de tratamiento de datos anteriores.",
    "consentStartButton": "Iniciar evaluacion",
    "consentStarting": "Iniciando...",
    "questionLabel": "Pregunta",
    "ofLabel": "de",
    "timerLabel": "Tiempo restante:",
    "wizardBack": "Atras",
    "wizardNext": "Siguiente",
    "wizardReviewSubmit": "Revisar y enviar",
    "questionCardFreeTextPlaceholder": "Escribe tu respuesta aqui...",
    "submitConfirmTitle": "Enviar tu evaluacion?",
    "submitConfirmUnansweredPrefix": "Preguntas sin responder:",
    "submitConfirmBody": "Una vez enviada, no podras cambiar tus respuestas.",
    "submitConfirmCancelButton": "Seguir revisando",
    "submitConfirmConfirmButton": "Enviar",
    "submitConfirmSubmitting": "Enviando...",
    "resultTitle": "Evaluacion completada",
    "resultScoreLabel": "Obtuviste",
    "resultPendingNotice": "Algunas de tus respuestas aun estan en revision manual — tu puntaje final puede cambiar.",
    "resultSummary": "Gracias por completar esta evaluacion. Nuestro equipo dara seguimiento con los proximos pasos.",
    "errorConsentRequired": "Debes aceptar los terminos de tratamiento de datos para continuar.",
    "errorAssignmentExpired": "El tiempo de esta evaluacion ha expirado.",
    "errorAssignmentNotStartable": "Esta evaluacion ya no se puede iniciar.",
    "errorAssignmentNotInProgress": "Esta evaluacion no esta en progreso actualmente.",
    "errorQuestionNotInAssessment": "Una de tus respuestas hace referencia a una pregunta que no es parte de esta evaluacion.",
    "errorAnswerTypeMismatch": "Una de tus respuestas no coincide con el formato esperado de su pregunta.",
    "errorGeneric": "Algo salio mal. Intenta de nuevo."
  }
```

- [ ] **Step 3: Verify both files are still valid JSON and parity holds**

Run: `npx vitest run tests/i18n/parity.test.ts`
Expected: PASS (both new `it`s — "every es key exists in en" / "every en key exists in es" — pass because the key sets are now identical)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json
git commit -m "feat(i18n): add assessmentPlayer namespace for the Slice 3 candidate player UI"
```

---

### Task 5: Add `trpc-types.ts` convenience types

**Files:**

- Modify: `apps/web/lib/trpc-types.ts`

**Interfaces:**

- Produces: `AssignmentSummary`, `AssessmentQuestionDto` — consumed by Tasks 9, 13, 14.

**Note:** confirmed via `grep -n "candidatePortal" apps/web/lib/trpc-types.ts` that this is the first `candidatePortal` entry in the file.

- [ ] **Step 1: Add the types**

Append to `apps/web/lib/trpc-types.ts` (after the last existing block):

```ts
// Candidate portal — assessment player (Wave 1.5a slice 3)
export type AssignmentSummary = RouterOutput['candidatePortal']['getMyAssessments'][number];
export type AssessmentQuestionDto = RouterOutput['candidatePortal']['getAssessmentQuestions'][number];
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS (no new errors — these are pure type aliases against the already-updated `AppRouter` output shape from Task 1)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/trpc-types.ts
git commit -m "chore(web): add AssignmentSummary/AssessmentQuestionDto trpc-types for the assessment player"
```

---

### Task 6: `_lib/assessment-draft-storage.ts` (pure localStorage module)

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage.ts`
- Test: `tests/portal/assessment-draft-storage.test.ts`

**Interfaces:**

- Produces: `readDraft(assignmentId): AssessmentDraft | null`, `writeDraft(assignmentId, answers): void`, `clearDraft(assignmentId): void`, and the `AssessmentDraftAnswer`/`AssessmentDraft` types. Consumed by Task 12 (`AssessmentQuestionWizard`).

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-draft-storage.test.ts`:

```ts
// @vitest-environment happy-dom
//
// This module is pure logic but touches the browser `localStorage` global, so it
// needs a DOM environment even though it has no JSX — an override docblock keeps
// it in the fast `node` project's .test.ts glob instead of moving it to .tsx.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readDraft,
  writeDraft,
  clearDraft,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage';

describe('assessment-draft-storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns null when nothing is stored for this assignment', () => {
    expect(readDraft('a1')).toBeNull();
  });

  it('round-trips a written draft', () => {
    writeDraft('a1', { q1: { selectedOptionIds: ['opt1'] } });
    const draft = readDraft('a1');
    expect(draft?.answers).toEqual({ q1: { selectedOptionIds: ['opt1'] } });
  });

  it('scopes drafts by assignmentId', () => {
    writeDraft('a1', { q1: { freeText: 'hello' } });
    expect(readDraft('a2')).toBeNull();
  });

  it('clears a draft', () => {
    writeDraft('a1', { q1: { freeText: 'hello' } });
    clearDraft('a1');
    expect(readDraft('a1')).toBeNull();
  });

  it('returns null for corrupted stored JSON instead of throwing', () => {
    window.localStorage.setItem('assessment-draft:a1', '{not json');
    expect(() => readDraft('a1')).not.toThrow();
    expect(readDraft('a1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-draft-storage.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage.ts`:

```ts
export interface AssessmentDraftAnswer {
  selectedOptionIds?: string[];
  freeText?: string;
}

export interface AssessmentDraft {
  answers: Record<string, AssessmentDraftAnswer>;
  updatedAt: string;
}

const draftKey = (assignmentId: string) => `assessment-draft:${assignmentId}`;

function isAssessmentDraft(value: unknown): value is AssessmentDraft {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.updatedAt === 'string' && typeof candidate.answers === 'object' && candidate.answers !== null;
}

export function readDraft(assignmentId: string): AssessmentDraft | null {
  const raw = window.localStorage.getItem(draftKey(assignmentId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAssessmentDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDraft(assignmentId: string, answers: Record<string, AssessmentDraftAnswer>): void {
  const draft: AssessmentDraft = { answers, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(draftKey(assignmentId), JSON.stringify(draft));
}

export function clearDraft(assignmentId: string): void {
  window.localStorage.removeItem(draftKey(assignmentId));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-draft-storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage.ts" tests/portal/assessment-draft-storage.test.ts
git commit -m "feat(assessment-player): add pure localStorage draft module"
```

---

### Task 7: `_lib/use-assessment-countdown.ts` (timer hook)

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/use-assessment-countdown.ts`
- Test: `tests/portal/use-assessment-countdown.test.ts`

**Interfaces:**

- Produces: `useAssessmentCountdown({ startedAt: Date, expiresAt: Date | null, durationMinutes: number | null, onExpire: () => void }): number | null`. `null` return means "no timer" (untimed assessment type). Fires `onExpire` exactly once when the countdown reaches 0. Consumed by Task 12.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/use-assessment-countdown.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssessmentCountdown } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/use-assessment-countdown';

describe('useAssessmentCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns null and never fires onExpire when durationMinutes is null (untimed)', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useAssessmentCountdown({ startedAt: new Date(), expiresAt: null, durationMinutes: null, onExpire }),
    );
    expect(result.current).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('counts down from duration and fires onExpire exactly once at 0:00', () => {
    const onExpire = vi.fn();
    const startedAt = new Date();
    const { result } = renderHook(() =>
      useAssessmentCountdown({ startedAt, expiresAt: null, durationMinutes: 1, onExpire }),
    );
    expect(result.current).toBe(60);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('uses expiresAt when it is tighter than duration', () => {
    const onExpire = vi.fn();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 10_000);
    const { result } = renderHook(() => useAssessmentCountdown({ startedAt, expiresAt, durationMinutes: 5, onExpire }));
    expect(result.current).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/use-assessment-countdown.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/use-assessment-countdown.ts`:

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseAssessmentCountdownArgs {
  startedAt: Date;
  expiresAt: Date | null;
  durationMinutes: number | null;
  onExpire: () => void;
}

// Both cutoffs matter: an assignment's expiresAt (an absolute deadline set at
// assignment time) can be TIGHTER than what durationMinutes alone would suggest.
// If durationMinutes is null, no timer renders at all (untimed assessment type) —
// expiresAt alone never drives a visible countdown in that case.
export function useAssessmentCountdown({
  startedAt,
  expiresAt,
  durationMinutes,
  onExpire,
}: UseAssessmentCountdownArgs): number | null {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const firedRef = useRef(false);

  const deadline = useMemo(() => {
    if (durationMinutes === null) return null;
    const durationDeadline = new Date(startedAt.getTime() + durationMinutes * 60_000);
    if (expiresAt !== null && expiresAt.getTime() < durationDeadline.getTime()) return expiresAt;
    return durationDeadline;
  }, [startedAt, expiresAt, durationMinutes]);

  const computeRemaining = useCallback(() => {
    if (deadline === null) return null;
    return Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000));
  }, [deadline]);

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(computeRemaining);

  useEffect(() => {
    firedRef.current = false;
    setRemainingSeconds(computeRemaining());
    if (deadline === null) return;
    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setRemainingSeconds(remaining);
      if (remaining !== null && remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline, computeRemaining]);

  return remainingSeconds;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/use-assessment-countdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/use-assessment-countdown.ts" tests/portal/use-assessment-countdown.test.ts
git commit -m "feat(assessment-player): add countdown hook honoring both duration and expiresAt"
```

---

### Task 8: `_components/assessment-error-messages.ts` (error-code mapper)

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-error-messages.ts`
- Test: `tests/portal/assessment-error-messages.test.ts`

**Interfaces:**

- Produces: `mapAssessmentErrorMessage(rawMessage: string | undefined, t: AssessmentPlayerT): string`. Never returns a raw backend error string. `assignment_already_completed` is deliberately NOT in the map (callers must special-case it before calling this — see Task 12/13). Consumed by Tasks 12, 13.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-error-messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from '../../apps/web/lib/i18n/en.json';
import { mapAssessmentErrorMessage } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-error-messages';

const t = en.assessmentPlayer;

describe('mapAssessmentErrorMessage', () => {
  const cases: [string, string][] = [
    ['consent_required', t.errorConsentRequired],
    ['assignment_expired', t.errorAssignmentExpired],
    ['assignment_not_startable', t.errorAssignmentNotStartable],
    ['assignment_not_in_progress', t.errorAssignmentNotInProgress],
    ['question_not_in_assessment', t.errorQuestionNotInAssessment],
    ['answer_type_mismatch', t.errorAnswerTypeMismatch],
  ];

  it.each(cases)('maps backend code %s to its translated message', (code, expected) => {
    expect(mapAssessmentErrorMessage(code, t)).toBe(expected);
  });

  it('never returns a raw/unmapped backend string, falls back to errorGeneric', () => {
    expect(mapAssessmentErrorMessage('some_unmapped_code', t)).toBe(t.errorGeneric);
    expect(mapAssessmentErrorMessage(undefined, t)).toBe(t.errorGeneric);
  });

  it('does not map assignment_already_completed (callers must special-case it, not render it as an error)', () => {
    expect(mapAssessmentErrorMessage('assignment_already_completed', t)).toBe(t.errorGeneric);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-error-messages.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-error-messages.ts`:

```ts
import type en from '../../../../../../../lib/i18n/en.json';

export type AssessmentPlayerT = (typeof en)['assessmentPlayer'];

// Deliberately excludes assignment_already_completed — per the Slice 3 design,
// that code is not an error state in the UI. A caller that receives it should
// re-fetch getMyAssessments and land on the result screen, never call this mapper.
const ERROR_MESSAGE_KEYS: Record<string, keyof AssessmentPlayerT> = {
  consent_required: 'errorConsentRequired',
  assignment_expired: 'errorAssignmentExpired',
  assignment_not_startable: 'errorAssignmentNotStartable',
  assignment_not_in_progress: 'errorAssignmentNotInProgress',
  question_not_in_assessment: 'errorQuestionNotInAssessment',
  answer_type_mismatch: 'errorAnswerTypeMismatch',
};

export function mapAssessmentErrorMessage(rawMessage: string | undefined, t: AssessmentPlayerT): string {
  const key = rawMessage ? ERROR_MESSAGE_KEYS[rawMessage] : undefined;
  return key ? t[key] : t.errorGeneric;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-error-messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-error-messages.ts" tests/portal/assessment-error-messages.test.ts
git commit -m "feat(assessment-player): add backend-error-code to i18n-key mapper"
```

---

### Task 9: `_components/assessment-question-card.tsx` (presentational)

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-card.tsx`
- Test: `tests/portal/assessment-question-card.test.tsx`

**Interfaces:**

- Produces: `AssessmentQuestionCard`, `QuestionCardQuestion`, `QuestionCardAnswer` types. Never receives or renders `correctOptionIds`. Consumed by Task 12.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-question-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import {
  AssessmentQuestionCard,
  type QuestionCardQuestion,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-card';

const singleChoiceQuestion: QuestionCardQuestion = {
  id: 'q1',
  order: 0,
  type: 'single_choice',
  prompt: 'Pick one',
  points: 1,
  options: [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B' },
  ],
};

function renderCard(props: React.ComponentProps<typeof AssessmentQuestionCard>) {
  return render(
    <I18nProvider>
      <AssessmentQuestionCard {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentQuestionCard', () => {
  it('renders radio inputs for single_choice and reports exactly one selected id', () => {
    const onChange = vi.fn();
    renderCard({ question: singleChoiceQuestion, answer: undefined, onChange });
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith({ selectedOptionIds: ['b'] });
  });

  it('renders checkboxes for multi_choice and toggles ids in the array', () => {
    const onChange = vi.fn();
    const question: QuestionCardQuestion = { ...singleChoiceQuestion, type: 'multi_choice' };
    renderCard({ question, answer: { selectedOptionIds: ['a'] }, onChange });
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith({ selectedOptionIds: ['a', 'b'] });
  });

  it('renders a bounded textarea for free_text and reports freeText', () => {
    const onChange = vi.fn();
    const question: QuestionCardQuestion = {
      id: 'q2',
      order: 1,
      type: 'free_text',
      prompt: 'Explain your reasoning',
      points: 5,
      options: [],
    };
    renderCard({ question, answer: undefined, onChange });
    const textarea = screen.getByPlaceholderText(en.assessmentPlayer.questionCardFreeTextPlaceholder);
    fireEvent.change(textarea, { target: { value: 'my answer' } });
    expect(onChange).toHaveBeenCalledWith({ freeText: 'my answer' });
    expect(textarea).toHaveAttribute('maxlength', '20000');
  });

  it('never renders correctOptionIds even if accidentally present on the question object', () => {
    const onChange = vi.fn();
    const question = { ...singleChoiceQuestion, correctOptionIds: ['a'] } as QuestionCardQuestion;
    const { container } = renderCard({ question, answer: undefined, onChange });
    expect(container.innerHTML).not.toContain('correctOptionIds');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-question-card.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-card.tsx`:

```tsx
'use client';

import { MAX_FREE_TEXT } from '@tims/shared';
import { useI18n } from '../../../../../../../lib/i18n';

export interface QuestionCardOption {
  id: string;
  label: string;
}

export interface QuestionCardQuestion {
  id: string;
  order: number;
  type: 'single_choice' | 'multi_choice' | 'free_text';
  prompt: string;
  options: QuestionCardOption[];
  points: number;
}

export interface QuestionCardAnswer {
  selectedOptionIds?: string[];
  freeText?: string;
}

interface AssessmentQuestionCardProps {
  question: QuestionCardQuestion;
  answer: QuestionCardAnswer | undefined;
  onChange: (answer: QuestionCardAnswer) => void;
}

export function AssessmentQuestionCard({ question, answer, onChange }: AssessmentQuestionCardProps) {
  const { t } = useI18n();
  const selected = answer?.selectedOptionIds ?? [];

  if (question.type === 'free_text') {
    return (
      <div className="space-y-3">
        <p className="text-[14px] font-medium text-[#1F114C]">{question.prompt}</p>
        <textarea
          value={answer?.freeText ?? ''}
          maxLength={MAX_FREE_TEXT}
          onChange={(e) => onChange({ freeText: e.target.value })}
          placeholder={t.assessmentPlayer.questionCardFreeTextPlaceholder}
          rows={6}
          className="w-full rounded-xl border border-[#E5E5E5] p-3 text-[13px] text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
        />
      </div>
    );
  }

  const toggleSingle = (optionId: string) => onChange({ selectedOptionIds: [optionId] });
  const toggleMulti = (optionId: string) => {
    const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
    onChange({ selectedOptionIds: next });
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-[#1F114C]">{question.prompt}</p>
      <ul className="space-y-2">
        {question.options.map((option) => (
          <li key={option.id}>
            <label className="flex items-center gap-3 rounded-xl border border-[#EDEDED] p-3 cursor-pointer hover:border-[#1F114C]/40">
              <input
                type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                name={`question-${question.id}`}
                checked={selected.includes(option.id)}
                onChange={() => (question.type === 'single_choice' ? toggleSingle(option.id) : toggleMulti(option.id))}
                className="h-4 w-4 text-[#1F114C] focus:ring-[#1F114C]"
              />
              <span className="text-[13px] text-[#333]">{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-question-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the i18n hardcoded-strings gate on this one new file**

Run: `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-card.tsx" tests/portal/assessment-question-card.test.tsx
git commit -m "feat(assessment-player): add presentational question card (radio/checkbox/free_text)"
```

---

### Task 10: `_components/assessment-consent-gate.tsx`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-consent-gate.tsx`
- Test: `tests/portal/assessment-consent-gate.test.tsx`

**Interfaces:**

- Produces: `AssessmentConsentGate({ onStart, isSubmitting, errorMessage })`. Consumed by Task 13 (`AssessmentPlayerShell`).

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-consent-gate.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentConsentGate } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-consent-gate';

function renderGate(props: Partial<React.ComponentProps<typeof AssessmentConsentGate>> = {}) {
  return render(
    <I18nProvider>
      <AssessmentConsentGate onStart={vi.fn()} isSubmitting={false} errorMessage={null} {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentConsentGate', () => {
  it('disables the start button until the checkbox is checked', () => {
    renderGate();
    const button = screen.getByRole('button', { name: en.assessmentPlayer.consentStartButton });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('calls onStart when the checked button is clicked', () => {
    const onStart = vi.fn();
    renderGate({ onStart });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.consentStartButton }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the submitting label and disables the button while isSubmitting', () => {
    renderGate({ isSubmitting: true });
    expect(screen.getByRole('button', { name: en.assessmentPlayer.consentStarting })).toBeDisabled();
  });

  it('renders a translated error message when provided', () => {
    renderGate({ errorMessage: en.assessmentPlayer.errorConsentRequired });
    expect(screen.getByText(en.assessmentPlayer.errorConsentRequired)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-consent-gate.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-consent-gate.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../../lib/i18n';

interface AssessmentConsentGateProps {
  onStart: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export function AssessmentConsentGate({ onStart, isSubmitting, errorMessage }: AssessmentConsentGateProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full space-y-5">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.consentTitle}</h1>
        <p className="text-[13px] text-[#585858] leading-relaxed whitespace-pre-line">
          {t.assessmentPlayer.consentBody}
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#D1D5DB] text-[#1F114C] focus:ring-[#1F114C]"
          />
          <span className="text-[13px] text-[#585858]">{t.assessmentPlayer.consentCheckboxLabel}</span>
        </label>
        {errorMessage && <p className="text-[12px] text-[#B42318]">{errorMessage}</p>}
        <button
          type="button"
          onClick={onStart}
          disabled={!checked || isSubmitting}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold hover:bg-[#2a1a5e] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? t.assessmentPlayer.consentStarting : t.assessmentPlayer.consentStartButton}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-consent-gate.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-consent-gate.tsx" tests/portal/assessment-consent-gate.test.tsx
git commit -m "feat(assessment-player): add Habeas-Data consent gate"
```

---

### Task 11: `_components/assessment-submit-confirm.tsx`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-submit-confirm.tsx`
- Test: `tests/portal/assessment-submit-confirm.test.tsx`

**Interfaces:**

- Produces: `AssessmentSubmitConfirm({ unansweredOrders, isSubmitting, onConfirm, onCancel })`. Consumed by Task 12 (`AssessmentQuestionWizard`) — never rendered on timer-triggered auto-submit (that path calls `submitAssessment` directly, skipping this confirmation step entirely, per spec).

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-submit-confirm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentSubmitConfirm } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-submit-confirm';

function renderConfirm(props: Partial<React.ComponentProps<typeof AssessmentSubmitConfirm>> = {}) {
  return render(
    <I18nProvider>
      <AssessmentSubmitConfirm
        unansweredOrders={[]}
        isSubmitting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('AssessmentSubmitConfirm', () => {
  it('lists unanswered question numbers when there are any', () => {
    renderConfirm({ unansweredOrders: [3, 7] });
    expect(screen.getByText(/3, 7/)).toBeInTheDocument();
  });

  it('renders no unanswered-question notice when everything is answered', () => {
    renderConfirm({ unansweredOrders: [] });
    expect(screen.queryByText(en.assessmentPlayer.submitConfirmUnansweredPrefix)).not.toBeInTheDocument();
  });

  it('calls onConfirm on the submit button and onCancel on the cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderConfirm({ onConfirm, onCancel });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmCancelButton }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows the submitting label while isSubmitting', () => {
    renderConfirm({ isSubmitting: true });
    expect(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmSubmitting })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmCancelButton })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-submit-confirm.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-submit-confirm.tsx`:

```tsx
'use client';

import { useI18n } from '../../../../../../../lib/i18n';

interface AssessmentSubmitConfirmProps {
  unansweredOrders: number[];
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AssessmentSubmitConfirm({
  unansweredOrders,
  isSubmitting,
  onConfirm,
  onCancel,
}: AssessmentSubmitConfirmProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full space-y-4">
        <h2 className="text-base font-semibold text-[#1F114C]">{t.assessmentPlayer.submitConfirmTitle}</h2>
        {unansweredOrders.length > 0 && (
          <p className="text-[13px] text-[#B45309]">
            {t.assessmentPlayer.submitConfirmUnansweredPrefix} {unansweredOrders.join(', ')}
          </p>
        )}
        <p className="text-[13px] text-[#585858]">{t.assessmentPlayer.submitConfirmBody}</p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-xl border border-[#E5E5E5] text-[13px] font-medium text-[#585858] hover:bg-[#FAFAFA] disabled:opacity-40"
          >
            {t.assessmentPlayer.submitConfirmCancelButton}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-40"
          >
            {isSubmitting ? t.assessmentPlayer.submitConfirmSubmitting : t.assessmentPlayer.submitConfirmConfirmButton}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-submit-confirm.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-submit-confirm.tsx" tests/portal/assessment-submit-confirm.test.tsx
git commit -m "feat(assessment-player): add submit confirmation step listing unanswered questions"
```

---

### Task 12: `_components/assessment-result-screen.tsx`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-result-screen.tsx`
- Test: `tests/portal/assessment-result-screen.test.tsx`

**Interfaces:**

- Produces: `AssessmentResultScreen({ normalizedScore, hasPending })`. Consumed by Task 13.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-result-screen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentResultScreen } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-result-screen';

function renderResult(props: React.ComponentProps<typeof AssessmentResultScreen>) {
  return render(
    <I18nProvider>
      <AssessmentResultScreen {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentResultScreen', () => {
  it('renders the rounded score', () => {
    renderResult({ normalizedScore: 82.4, hasPending: false });
    expect(screen.getByText(/82%/)).toBeInTheDocument();
  });

  it('renders the pending-review notice honestly when hasPending is true', () => {
    renderResult({ normalizedScore: 50, hasPending: true });
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });

  it('does not render the pending-review notice when hasPending is false', () => {
    renderResult({ normalizedScore: 100, hasPending: false });
    expect(screen.queryByText(en.assessmentPlayer.resultPendingNotice)).not.toBeInTheDocument();
  });

  it('never fabricates a score when normalizedScore is null (all-essay, nothing auto-graded yet)', () => {
    renderResult({ normalizedScore: null, hasPending: true });
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-result-screen.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-result-screen.tsx`:

```tsx
'use client';

import { useI18n } from '../../../../../../../lib/i18n';

interface AssessmentResultScreenProps {
  normalizedScore: number | null;
  hasPending: boolean;
}

export function AssessmentResultScreen({ normalizedScore, hasPending }: AssessmentResultScreenProps) {
  const { t } = useI18n();
  const roundedScore = normalizedScore !== null ? Math.round(normalizedScore) : null;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.resultTitle}</h1>
        {roundedScore !== null && (
          <p className="text-3xl font-bold text-[#1F114C]">
            {t.assessmentPlayer.resultScoreLabel} {roundedScore}%
          </p>
        )}
        {hasPending && (
          <p className="text-[13px] text-[#B45309] bg-[#FFFBEB] rounded-xl p-3">
            {t.assessmentPlayer.resultPendingNotice}
          </p>
        )}
        <p className="text-[13px] text-[#585858]">{t.assessmentPlayer.resultSummary}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-result-screen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-result-screen.tsx" tests/portal/assessment-result-screen.test.tsx
git commit -m "feat(assessment-player): add result screen (honest pending-review notice, no fabricated scores)"
```

---

### Task 13: `_components/assessment-question-wizard.tsx`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard.tsx`
- Test: `tests/portal/assessment-question-wizard.test.tsx`

**Interfaces:**

- Consumes: `AssessmentQuestionCard` (Task 9), `AssessmentSubmitConfirm` (Task 11), `mapAssessmentErrorMessage` (Task 8), `readDraft/writeDraft/clearDraft` (Task 6), `useAssessmentCountdown` (Task 7), `trpc.candidatePortal.getAssessmentQuestions.useQuery`, `trpc.candidatePortal.submitAssessment.useMutation`.
- Produces: `AssessmentQuestionWizard({ orgSlug, assignmentId, startedAt: Date, expiresAt: Date | null, durationMinutes: number | null, onSubmitted: () => void })`. Consumed by Task 14.

**Mocking approach (matches this codebase's existing mocking-heavy service-test style):** mock the relative `lib/trpc` module directly rather than wiring a full tRPC + React Query provider tree — this repo has no existing precedent for provider-based component tests, and mocking the client hooks is simpler and sufficient to test behavior.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-question-wizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

const mutateSubmit = vi.fn();
const invalidate = vi.fn();
let submitOnSuccess: (() => void) | undefined;
let submitOnError: ((error: { message: string }) => void) | undefined;

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidatePortal: { getMyAssessments: { invalidate } } }),
    candidatePortal: {
      getAssessmentQuestions: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: [
            {
              id: 'q1',
              order: 0,
              type: 'single_choice',
              prompt: 'Q1?',
              points: 1,
              options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
            },
            { id: 'q2', order: 1, type: 'free_text', prompt: 'Q2?', points: 5, options: [] },
          ],
        }),
      },
      submitAssessment: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => {
          submitOnSuccess = opts.onSuccess;
          submitOnError = opts.onError;
          return { mutate: mutateSubmit, isPending: false };
        },
      },
    },
  },
}));

import { AssessmentQuestionWizard } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard';

function renderWizard(overrides: Partial<React.ComponentProps<typeof AssessmentQuestionWizard>> = {}) {
  return render(
    <I18nProvider>
      <AssessmentQuestionWizard
        orgSlug="tims"
        assignmentId="a1"
        startedAt={new Date()}
        expiresAt={null}
        durationMinutes={null}
        onSubmitted={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe('AssessmentQuestionWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mutateSubmit.mockClear();
    invalidate.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('Back/Next navigate between questions without ever calling the server', () => {
    renderWizard();
    expect(screen.getByText('Q1?')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit, hidden: true }) ??
        screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }),
    );
    expect(screen.getByText('Q2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardBack }));
    expect(screen.getByText('Q1?')).toBeInTheDocument();
    expect(mutateSubmit).not.toHaveBeenCalled();
  });

  it('persists a draft to localStorage on answer change and it survives a remount', () => {
    const { unmount } = renderWizard();
    fireEvent.click(screen.getByText('A'));
    unmount();
    renderWizard();
    const optionA = screen.getByText('A').previousElementSibling as HTMLInputElement;
    expect(optionA.checked).toBe(true);
  });

  it('auto-submits with no confirmation step when the timer reaches 0:00', () => {
    renderWizard({ durationMinutes: 1 });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mutateSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.assessmentPlayer.submitConfirmTitle)).not.toBeInTheDocument();
  });

  it('never includes a client-computed score/isCorrect in the submitAssessment payload', () => {
    renderWizard();
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.change(screen.getByPlaceholderText(en.assessmentPlayer.questionCardFreeTextPlaceholder), {
      target: { value: 'my answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    const payload = mutateSubmit.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['orgSlug', 'assignmentId', 'answers']);
    for (const answer of payload.answers) {
      expect(Object.keys(answer).sort()).toEqual(['freeText', 'questionId', 'selectedOptionIds'].sort());
    }
  });

  it('renders a translated error message from a mutation failure', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    act(() => submitOnError?.({ message: 'assignment_expired' }));
    expect(screen.getByText(en.assessmentPlayer.errorAssignmentExpired)).toBeInTheDocument();
  });

  it('re-fetches and calls onSubmitted (not an error) on assignment_already_completed', () => {
    const onSubmitted = vi.fn();
    renderWizard({ onSubmitted });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    act(() => submitOnError?.({ message: 'assignment_already_completed' }));
    expect(invalidate).toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalled();
    expect(screen.queryByText(en.assessmentPlayer.errorGeneric)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-question-wizard.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { trpc } from '../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../lib/i18n';
import { AssessmentQuestionCard, type QuestionCardAnswer } from './assessment-question-card';
import { AssessmentSubmitConfirm } from './assessment-submit-confirm';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
import { readDraft, writeDraft, clearDraft } from '../_lib/assessment-draft-storage';
import { useAssessmentCountdown } from '../_lib/use-assessment-countdown';

interface AssessmentQuestionWizardProps {
  orgSlug: string;
  assignmentId: string;
  startedAt: Date;
  expiresAt: Date | null;
  durationMinutes: number | null;
  onSubmitted: () => void;
}

export function AssessmentQuestionWizard({
  orgSlug,
  assignmentId,
  startedAt,
  expiresAt,
  durationMinutes,
  onSubmitted,
}: AssessmentQuestionWizardProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const questionsQuery = trpc.candidatePortal.getAssessmentQuestions.useQuery({ orgSlug, assignmentId });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionCardAnswer>>(
    () => readDraft(assignmentId)?.answers ?? {},
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submitMutation = trpc.candidatePortal.submitAssessment.useMutation({
    onSuccess: () => {
      clearDraft(assignmentId);
      utils.candidatePortal.getMyAssessments.invalidate();
      onSubmitted();
    },
    onError: (error: { message: string }) => {
      if (error.message === 'assignment_already_completed') {
        utils.candidatePortal.getMyAssessments.invalidate();
        onSubmitted();
        return;
      }
      setShowConfirm(false);
      setErrorMessage(mapAssessmentErrorMessage(error.message, t.assessmentPlayer));
    },
  });

  const buildSubmission = useCallback(
    () =>
      Object.entries(answers).map(([questionId, a]) => ({
        questionId,
        selectedOptionIds: a.selectedOptionIds,
        freeText: a.freeText,
      })),
    [answers],
  );

  const doSubmit = useCallback(() => {
    submitMutation.mutate({ orgSlug, assignmentId, answers: buildSubmission() });
  }, [orgSlug, assignmentId, buildSubmission, submitMutation]);

  // Fires doSubmit at 0:00 with whatever's answered so far — no confirmation step
  // on timer expiry, per the Slice 3 design ("no time's-up-please-hurry limbo state").
  const remainingSeconds = useAssessmentCountdown({ startedAt, expiresAt, durationMinutes, onExpire: doSubmit });

  const handleAnswerChange = (questionId: string, answer: QuestionCardAnswer) => {
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    writeDraft(assignmentId, next);
  };

  if (questionsQuery.isLoading) {
    return <p className="text-center text-[13px] text-[#8B8B8B] p-8">{t.assessmentPlayer.loading}</p>;
  }
  if (questionsQuery.isError || !questionsQuery.data) {
    return <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>;
  }

  const questions = questionsQuery.data;
  const total = questions.length;
  const question = questions[currentIndex];
  const isLast = currentIndex === total - 1;
  const unansweredOrders = questions
    .filter((q) => {
      const a = answers[q.id];
      const hasChoice = Array.isArray(a?.selectedOptionIds) && a.selectedOptionIds.length > 0;
      const hasText = typeof a?.freeText === 'string' && a.freeText.length > 0;
      return !hasChoice && !hasText;
    })
    .map((q) => q.order + 1);

  return (
    <div className="min-h-screen bg-[#FAFAFA] p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg p-6 space-y-5">
        <div className="flex items-center justify-between text-[12px] text-[#8B8B8B]">
          <span>
            {t.assessmentPlayer.questionLabel} {currentIndex + 1} {t.assessmentPlayer.ofLabel} {total}
          </span>
          {remainingSeconds !== null && (
            <span>
              {t.assessmentPlayer.timerLabel} {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:
              {String(remainingSeconds % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[#EDEDED]">
          <div
            className="h-1.5 rounded-full bg-[#1F114C]"
            style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
          />
        </div>

        {errorMessage && <p className="text-[12px] text-[#B42318]">{errorMessage}</p>}

        <AssessmentQuestionCard
          question={question}
          answer={answers[question.id]}
          onChange={(a) => handleAnswerChange(question.id, a)}
        />

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
            className="flex-1 h-10 rounded-xl border border-[#E5E5E5] text-[13px] font-medium text-[#585858] disabled:opacity-40"
          >
            {t.assessmentPlayer.wizardBack}
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold"
            >
              {t.assessmentPlayer.wizardReviewSubmit}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i + 1)}
              className="flex-1 h-10 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold"
            >
              {t.assessmentPlayer.wizardNext}
            </button>
          )}
        </div>
      </div>

      {showConfirm && (
        <AssessmentSubmitConfirm
          unansweredOrders={unansweredOrders}
          isSubmitting={submitMutation.isPending}
          onConfirm={doSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-question-wizard.test.tsx`
Expected: PASS. If the "persists a draft ... survives a remount" test is flaky against the DOM structure assumption (`previousElementSibling`), replace that assertion with a `getByRole('radio')` query scoped by `name`/label association instead of DOM sibling traversal — fix the test, not the component, since the component's job is only to reflect `answers` state, which is already covered by the round-trip in Task 6's test.

- [ ] **Step 5: Run the i18n hardcoded-strings gate**

Run: `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard.tsx" tests/portal/assessment-question-wizard.test.tsx
git commit -m "feat(assessment-player): add question wizard (draft autosave, timer auto-submit, error mapping)"
```

---

### Task 14: `_components/assessment-player-shell.tsx`

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-player-shell.tsx`
- Test: `tests/portal/assessment-player-shell.test.tsx`

**Interfaces:**

- Consumes: `AssessmentConsentGate` (10), `AssessmentQuestionWizard` (13), `AssessmentResultScreen` (12), `mapAssessmentErrorMessage` (8), `trpc.candidatePortal.getMyAssessments.useQuery`, `trpc.candidatePortal.startAssessment.useMutation`.
- Produces: `AssessmentPlayerShell({ orgSlug, assignmentId })` — the full state machine. Consumed by Task 15 (`page.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/assessment-player-shell.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

let assessmentsQueryData: unknown[] = [];
const invalidate = vi.fn();
const mutateStart = vi.fn();

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidatePortal: { getMyAssessments: { invalidate } } }),
    candidatePortal: {
      getMyAssessments: {
        useQuery: () => ({ isLoading: false, isError: false, data: assessmentsQueryData }),
      },
      startAssessment: {
        useMutation: (_opts: unknown) => ({ mutate: mutateStart, isPending: false }),
      },
    },
  },
}));
vi.mock(
  '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard',
  () => ({ AssessmentQuestionWizard: () => <div>wizard-stub</div> }),
);

import { AssessmentPlayerShell } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-player-shell';

function renderShell() {
  return render(
    <I18nProvider>
      <AssessmentPlayerShell orgSlug="tims" assignmentId="a1" />
    </I18nProvider>,
  );
}

describe('AssessmentPlayerShell', () => {
  beforeEach(() => {
    mutateStart.mockClear();
    invalidate.mockClear();
  });

  it('renders a not-found message when assignmentId matches nothing in the list', () => {
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/portal/assessment-player-shell.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-player-shell.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../lib/i18n';
import { AssessmentConsentGate } from './assessment-consent-gate';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { AssessmentResultScreen } from './assessment-result-screen';
import { mapAssessmentErrorMessage } from './assessment-error-messages';

interface AssessmentPlayerShellProps {
  orgSlug: string;
  assignmentId: string;
}

export function AssessmentPlayerShell({ orgSlug, assignmentId }: AssessmentPlayerShellProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [consentError, setConsentError] = useState<string | null>(null);
  const assessmentsQuery = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const startMutation = trpc.candidatePortal.startAssessment.useMutation({
    onSuccess: () => utils.candidatePortal.getMyAssessments.invalidate(),
    onError: (error: { message: string }) =>
      setConsentError(mapAssessmentErrorMessage(error.message, t.assessmentPlayer)),
  });

  if (assessmentsQuery.isLoading) {
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

  if (assignment.status === 'in_progress') {
    return (
      <AssessmentQuestionWizard
        orgSlug={orgSlug}
        assignmentId={assignmentId}
        // Backend invariant (candidateAssessmentRepo.markStarted): startedAt is set on the
        // FIRST assigned -> in_progress transition, so it is always non-null once in_progress.
        startedAt={assignment.startedAt as Date}
        expiresAt={assignment.expiresAt}
        durationMinutes={assignment.assessmentType.duration}
        onSubmitted={() => utils.candidatePortal.getMyAssessments.invalidate()}
      />
    );
  }

  // status === 'assigned'
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/portal/assessment-player-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the i18n hardcoded-strings gate**

Run: `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-player-shell.tsx" tests/portal/assessment-player-shell.test.tsx
git commit -m "feat(assessment-player): add top-level state machine shell"
```

---

### Task 15: `page.tsx` — route entry (server component) + final integration verification

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/page.tsx`

**Interfaces:**

- Consumes: `AssessmentPlayerShell` (Task 14), `@tims/auth/server`'s `getUser`, `@tims/db`'s `db`, `next/navigation`'s `redirect`/`notFound`.
- No dedicated test for this file — matches the existing precedent: `me/page.tsx` (the server component it mirrors) has zero test coverage of its own either; its logic is a thin, already-battle-tested auth/org resolution pattern.

- [ ] **Step 1: Implement**

Create `apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/page.tsx`:

```tsx
import 'server-only';
import { getUser } from '@tims/auth/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@tims/db';
import { AssessmentPlayerShell } from './_components/assessment-player-shell';

// Direct-URL-only entry point (Wave 1.5a slice 3). Slice 4 (the /me dashboard
// "My Assessments" section) will link here; until then this page has no
// discoverable entry point from the candidate dashboard, matching the design
// doc's vertical slice ordering.
export default async function AssessmentPlayerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; assignmentId: string }>;
}) {
  const { orgSlug, assignmentId } = await params;

  const supabaseUser = await getUser();
  if (!supabaseUser?.email) redirect(`/careers/${orgSlug}/login`);

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, isActive: true },
  });
  if (!org || !org.isActive) notFound();

  return <AssessmentPlayerShell orgSlug={orgSlug} assignmentId={assignmentId} />;
}
```

- [ ] **Step 2: Type-check both packages**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS — this is the first point every new file across Tasks 1-15 is type-checked together; fix any cross-file type mismatch surfaced here before proceeding (e.g. a prop type drift between `AssessmentPlayerShell` and `AssessmentQuestionWizard`).

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — every test across both Vitest projects (`node` and `web-components`), including the pre-existing suite untouched by this plan (verifies no regression, per this project's standing "verify full suite before merge" rule — CI alone is not a safety net here).

- [ ] **Step 4: Manual smoke test in a real browser**

Run: `cd apps/web && pnpm dev`

Using an existing QA candidate login (reuse the Slice 2 test-account setup, or the reusable QA login documented from the billing-invoices FE consumer session) and a manually-assigned assessment (via the staff authoring UI or a direct DB insert into `assessment_assignments` with `status: 'assigned'`), navigate to `/careers/<orgSlug>/me/assessments/<assignmentId>` and walk the golden path:

1. Consent gate renders; Start is disabled until checked; clicking Start transitions to the wizard.
2. Back/Next navigate; refresh the page mid-wizard and confirm answers survive (localStorage draft).
3. Submit with at least one question unanswered; confirm the submit-confirmation step lists it; confirm; result screen renders.
4. (Optional, if time allows) assign a second, short-duration (`duration: 1` minute) assessment and let the timer expire naturally to confirm auto-submit fires with no confirmation dialog.

Report the outcome in prose (pass/fail per step) — do not claim this task complete without having actually run this in a browser, per this project's standing rule that UI features need a real browser check, not just `tsc`/`vitest` green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/page.tsx"
git commit -m "feat(assessment-player): add route entry — Slice 3 Player UI complete

Direct-URL-only for now (/careers/[orgSlug]/me/assessments/[assignmentId]);
Slice 4 wires up the /me dashboard entry point. Consent gate -> timed question
wizard with localStorage draft autosave -> result screen, against the Slice 2
backend contract as merged, plus one backend DTO fix (hasPending derivation)."
```

---

## Self-Review

**Spec coverage:**

- Route & page structure → Task 15. ✅
- No-dedicated-endpoint resolution (reuse `getMyAssessments`, find by id client-side) → Task 14. ✅
- All 7 named components (`page.tsx`, `assessment-player-shell`, `assessment-consent-gate`, `assessment-question-wizard`, `assessment-question-card`, `assessment-submit-confirm`, `assessment-result-screen`) → Tasks 9-15. ✅
- `lib/assessment-draft-storage.ts` and `use-assessment-countdown.ts` → Tasks 6-7. ✅
- i18n namespace + every named error code → Task 4 + Task 8. ✅
- Error handling mapping + `assignment_already_completed` special-case → Task 8 (mapper) + Tasks 12/13 (special-case before calling the mapper). ✅
- Testing section's concrete finding (zero component-rendering tooling) + decision (add real tests) → Task 3. ✅
- Explicitly out-of-scope items (Slice 4 entry point, proctoring, new backend endpoints/schema, AI essay scoring) → untouched by this plan, confirmed no task creates any of them. ✅
- **Gap found beyond the spec's own text:** the spec's claim that `hasPending` is already available from `assignmentSummarySelect` was checked against the actual repository code and found false — fixed in Task 1, flagged explicitly rather than silently "fixed" without explanation.

**Placeholder scan:** no `TBD`/`TODO`/"add appropriate X" phrases in any step; the one deliberately-placeholder text (consent legal copy) is explicitly called out as non-engineering-scope, matching the spec's own framing, not a plan gap.

**Type consistency:** `startedAt`/`expiresAt` are `Date`/`Date | null` consistently from Task 13 (wizard props) through Task 14 (shell passing `assignment.startedAt`/`assignment.expiresAt`) — verified against the confirmed superjson transformer behavior, not assumed. `QuestionCardAnswer` (`{ selectedOptionIds?, freeText? }`) is the same shape in Tasks 6 (draft storage), 9 (question card), and 13 (wizard's `answers` state) — no drift.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-assessment-player-slice3-player-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
