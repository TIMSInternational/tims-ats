# Engagement-Write TS-Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the three dead TypeScript engagement WRITE procedures (`createSurvey`, `activateSurvey`, `submitSurveyResponse`) and their now-unreachable FE fallback paths, leaving C# as the sole implementation — the 8th and FINAL domain of the S5 item-4 TS-deletion sequence.

**Architecture:** TIMS ATS is mid-migration from a TypeScript tRPC backend (`packages/api`) to a C#/.NET service (`services/Tims.Platform`). Each migrated surface ships behind a pair of flags: a backend `Platform:*Enabled` flag that maps the C# routes, and a browser-side `NEXT_PUBLIC_*_VIA_CSHARP` flag read by a thin "platform-api wrapper" hook in `apps/web/lib/platform-api/*.ts`. While a wrapper is _dual-path_ it calls BOTH the tRPC hook and a C# `useQuery`/`useMutation` and returns whichever the flag selects. Once the FE flag is confirmed literally `"true"` in Vercel production, the tRPC branch is provably unreachable, and this kind of change deletes it: the TS procedure, the wrapper's dead branch, and every test/doc that asserted the TS side's behavior. For engagement the flag split is asymmetric — the WRITE flag is live, the READ flag does not exist in Vercel at all — so only the write side is deleted and all 14 reads stay fully TypeScript-served.

**Tech Stack:** TypeScript (strict), tRPC, Prisma (PostgreSQL/Supabase), Next.js 15 App Router, React Query (`@tanstack/react-query`), Vitest, C#/.NET 8 minimal APIs + EF Core (destination, untouched here).

---

## Global Constraints

- Branch is already created: `refactor/ts-deletion-engagement-write`, cut from `main` @ `44f7273` ("merge: land compensation TS-deletion"). Do not branch again.
- Every Bash command must be prefixed with `cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && `. This is a plain repo checkout, NOT a git worktree; the working directory resets between tool calls.
- **`NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP` is confirmed literally `"true"` in Vercel production** (verified 2026-07-29 by `vercel env pull` to a scratchpad temp file, value read, file deleted immediately). This is the fact that makes the 3 tRPC mutation branches provably dead. Do NOT re-run `vercel env pull` into the repo — two secret-leak incidents are on record in this migration.
- **`NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP` is confirmed ABSENT from Vercel production.** All 14 TS read procedures and all 8 dual-path read hooks are the LIVE prod path. Touching any of them is out of scope and would be a production regression.
- **DELETE exactly 3 router procedures:** `createSurvey`, `activateSurvey`, `submitSurveyResponse`. Nothing else.
- **KEEP untouched:** the 14 read procedures, and `createActionPlan` + `updateActionPlan` (zero FE call sites repo-wide; unrelated pre-existing dead code, same treatment as succession's `addCriticalRole` and nine-box's `submitCalibrationVote`).
- **ZERO imports become dead** in `packages/api/src/routers/engagement.ts`. The import block (lines 1–13) must be byte-unchanged. Do NOT prune imports; `tsc` is the proof.
- **THE THREE `invalidate()` CALLS MUST NOT BE REMOVED.** `launch-survey-modal.tsx:53` (`utils.engagement.listSurveys.invalidate()`), `launch-survey-modal.tsx:54` (`utils.engagement.getDashboardKpis.invalidate()`), and `survey-take-modal.tsx:43` (`utils.engagement.myPendingSurveys.invalidate()`) all target SURVIVING, still-tRPC-served reads. This is the single most dangerous habit-carryover in this plan: every one of the seven predecessor domains removed dead `invalidate()` calls, and copying that step here would break cache invalidation in live production. Neither `launch-survey-modal.tsx` nor `survey-take-modal.tsx` is modified at all by this plan. See also the restatement in Step 4b and Step 17.
- **No `any`, no unnarrowed `unknown`, no `@ts-ignore`** (CLAUDE.md). The hand-declared `JsonValue` alias in Step 4a exists specifically to satisfy this.
- **Preserve all hook return shapes byte-for-byte.** `CreateSurveyOutput` keeps its full 13 fields (not narrowed to `{ id }`), preserving the migration invariant every prior commit message asserted.
- **Do NOT reflow, reorder, or reformat surviving router code.** Two surgical interior excisions only. Do NOT touch the section-header comments at router line 16 (`// ── Surveys ──`) or line 291 (`// ── eNPS ──`).
- **Do NOT edit `.env.example`.** Neither engagement flag was ever listed there (unlike compensation's read flag, which WAS listed and required a `RETIRED` block). Established precedent for unlisted flags is silence.
- **Do NOT edit any C# source, `apps/web/lib/platform-api/schema.d.ts` (generated), or `apps/web/lib/trpc-types.ts` (zero engagement entries).**
- **MANDATORY SECURITY REVIEW NOTE** (CLAUDE.md: "Security changes require explicit review note"). This change deletes 9 TypeScript tests that are today the only TS-side assertions of: (1) **provenance non-spoofability** — `createdById` stamped from `ctx.user.id`, never an input; (2) **cross-org isolation on activate** — scoped `findFirst`, missing/cross-org → `NOT_FOUND`, never an existence leak; (3) **ballot-stuffing prevention / identity anchoring on submit** — `userId: ctx.user.id` always, with no client-supplied `userId` or `anonymous` flag (a NULL `userId` would bypass `@@unique([surveyId, userId])` because Postgres NULLs never collide) — the sharpest guarantee in the set; (4) **the intentional ABSENCE of `requireOrgScope` on `submitSurveyResponse`** (an org-gate would wrongly FORBID the own-scoped employee); (5) **input bounds** — answers key `.max(200)`, string value `.max(5000)`, ≤100 keys; (6) **§21 minimal-select** — the write response never echoes the confidential `answers` JSON (`select: { id, submittedAt }`); (7) **duplicate-response CONFLICT mapping** — P2002 → clean `CONFLICT`, not a 500. After deletion these guarantees live in exactly two places: (a) the C# implementation (`EngagementWriteEndpoints.cs` / `EngagementWriteUseCase.cs` / `EngagementWriteRepository.cs`) with `services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs` + `EngagementWriteEndpointAuthTests.cs`; and (b) `scripts/parity/write-surfaces.ts`'s `engagementSurface`, whose raw-SQL readbacks assert provenance attribution (`created_by_id`), identity anchoring (`user_id` = caller), and the no-mutation / RBAC-deny cases against the LIVE C# API. **The input-bounds concern is RESOLVED, not open:** `services/Tims.Platform/src/Tims.Api/Engagement/EngagementWriteEndpoints.cs:59-61,435` enforces `MaxAnswerKeyLength = 200`, `MaxAnswerStringLength = 5000`, `MaxAnswers = 100` at runtime, returning 400 Bad Request — real enforcement, not a doc comment, and an exact match for the deleted Zod bounds. Coverage is therefore equivalent, not regressed; the TS side is being retired, not weakened. This note must appear in the Task header, in Step 3, and verbatim-in-substance in the final commit message (Step 19).
- **Verification gates (all must pass before commit):** `pnpm --filter @tims/api exec tsc --noEmit`, `cd apps/web && npx tsc --noEmit`, `npx vitest run` (from repo root).

---

### Task 1: Delete the 3 dead TS engagement write procedures and truth-up every downstream reference

> **SECURITY REVIEW NOTE (CLAUDE.md):** This task deletes authorization- and integrity-relevant TypeScript code and 9 tests asserting provenance non-spoofability, cross-org isolation, ballot-stuffing prevention / identity anchoring, the deliberate absence of `requireOrgScope` on the self-service submit, input bounds, §21 minimal-select, and duplicate-response CONFLICT mapping. All seven guarantees are preserved by the C# implementation + its integration tests and by `scripts/parity/write-surfaces.ts`'s `engagementSurface` raw-SQL readbacks. The input-bounds guarantee specifically is confirmed equivalent (`EngagementWriteEndpoints.cs:59-61,435`, runtime-enforced 400) — **no security regression**. Full text in Global Constraints above; reproduce it in the commit message.

**Files:**

- Modify: `packages/api/src/routers/engagement.ts:68-121` and `packages/api/src/routers/engagement.ts:242-290` (two interior excisions; imports at 1–13 untouched)
- Modify: `apps/web/lib/platform-api/engagement.ts:54-56` (type aliases → hand-declared), `:345-363` (write-section header), `:365` (delete dead const), `:406-475` (3 hooks → C#-only)
- Delete: `tests/tier1/s2-activate-survey.test.ts` (entire 153-line file)
- Modify: `tests/access/scope-wiring-engagement-write.test.ts:5-14` (header) and `:20-45` (delete 4 tests)
- Modify: `tests/access/endpoint-hardening.test.ts:45-77` (delete the engagement describe block)
- Modify: `tests/access/scope-wiring-sensitive-data.test.ts:412-422` (comment trim, describe rename, delete 1 test)
- Modify: `tests/tier1/s2-engagement-wiring.test.ts:14-17` (comment only)
- Modify: `tests/access/survey-take-ui.test.ts:38-41` (comment only)
- Modify: `tests/access/survey-question-parse.test.ts:19` and `:39` (comments only)
- Modify: `scripts/parity/write-surfaces.ts:884-889` (comment only)
- Modify: `scripts/deploy/cutover.sh:113` (note text; status token stays `COEXISTENCE`)
- Modify: `scripts/deploy/README-cutover.md:53-64` (worked-example paragraph) and `:137` (table row note)
- Modify: `docs/architecture/table-ownership.md:109` (one prose clause inside the `efcoreStranglerWrite` note)
- Modify: `docs/REMAINING-WORK.md:94-95`, `:132`, `:163-177`, `:270`, `:316`
- Read-only verification (NO edits): `tests/access/scope-wiring-survey-take.test.ts`, `tests/access/scope-wiring-employee-self-service.test.ts`, `scripts/parity/surfaces.ts`, `scripts/parity/surfaces.test.ts`, `scripts/parity/write-surfaces.test.ts`, `apps/web/lib/trpc-types.ts`, `.env.example`, `tools/test-apis.sh`, `apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx`, `apps/web/app/(admin)/dashboard/survey-take-modal.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces — these three exported hook names and their option/return signatures MUST stay stable, because their FE call sites are NOT modified:
  - `useEngagementCreateSurvey(options?: MutationOptions<CreateSurveyOutput>)` — consumer `apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx:61`, which chains `create.onSuccess: (survey) => activate.mutate({ id: survey.id })`, so the resolved data must still carry `.id`.
  - `useEngagementActivateSurvey(options?: MutationOptions<ActivateSurveyOutput>)` — consumer `launch-survey-modal.tsx:51`.
  - `useEngagementSubmitSurveyResponse(options?: MutationOptions<SubmitSurveyResponseOutput>)` — consumer `apps/web/app/(admin)/dashboard/survey-take-modal.tsx:41`.
  - Supporting types that must exist with exactly these names after the rewrite: `JsonValue`, `CreateSurveyOutput`, `ActivateSurveyOutput`, `SubmitSurveyResponseOutput`, `MutationOptions<TData>`, `useCSharpMutation`, `CreateSurveyQuestionShape`, `CreateSurveyInputShape`, `ActivateSurveyInputShape`, `SubmitSurveyResponseInputShape`.
- Also produces (unchanged, must still compile and still be exported): all 8 read hooks — `useEngagementMyPendingSurveys`, `useEngagementSurveyForResponse`, `useEngagementEnps`, `useEngagementClimateHeatmap`, `useEngagementLowClimateAlerts`, `useEngagementListActionPlans`, `useEngagementListLeaderCommitments`, `useEngagementDashboardKpis`.

---

- [ ] **Step 1: Record the verification baseline.**

Run all three gates on the untouched branch and write the numbers down — Step 18 asserts against them.

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && pnpm --filter @tims/api exec tsc --noEmit && echo "API TSC OK"
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats/apps/web && npx tsc --noEmit && echo "WEB TSC OK"
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && npx vitest run 2>&1 | tail -12
```

Record the exact `Test Files  N passed (N)` and `Tests  M passed (M)` numbers.

**Baseline actually measured on this exact branch tip while writing this plan (2026-07-29):**

```
 Test Files  257 passed (257)
      Tests  2503 passed (2503)
```

The expected post-change state is therefore **256 files / 2484 tests** (−1 file, −19 tests). Still re-measure anyway: if your Step 1 numbers differ from 257/2503 the branch has drifted, and every downstream expectation in this plan must be re-derived before you cut anything. At Step 18, assert against YOUR measured `M − 19`, not against a hard-coded constant.

- [ ] **Step 2: Re-verify the router excision line numbers before cutting.**

Line drift would silently delete the wrong code. Confirm the exact boundaries:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && wc -l packages/api/src/routers/engagement.ts && grep -n "createSurvey:\|activateSurvey:\|getSurveyResults:\|submitSurveyResponse:\|── eNPS ──\|── Surveys ──" packages/api/src/routers/engagement.ts
```

Expected exactly (verified 2026-07-29 on this commit):

```
702 packages/api/src/routers/engagement.ts
16:  // ── Surveys ────────────────────────────────────────────────────────
68:  createSurvey: permissionProcedure('engagement', 'create')
107:  activateSurvey: permissionProcedure('engagement', 'create')
122:  getSurveyResults: permissionProcedure('engagement', 'read')
242:  submitSurveyResponse: permissionProcedure('engagement', 'create')
291:  // ── eNPS ───────────────────────────────────────────────────────────
```

If any number differs, STOP and re-derive the two spans from the anchors before proceeding.

- [ ] **Step 3: Excise the two spans from `packages/api/src/routers/engagement.ts`.**

> Carries the security note in the Task header — this is the deletion step it refers to.

**Excision A — lines 68–121 inclusive** (`createSurvey` + `activateSurvey` + the trailing blank line at 121). Delete this entire block:

```ts
  createSurvey: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(200),
        type: z.enum(['pulse', 'enps', 'climate', 'custom']),
        questions: z.array(
          z.object({
            text: z.string().min(1).max(500),
            type: z.enum(['scale', 'text', 'multiple_choice', 'yes_no']),
            options: z.array(z.string().max(200)).max(100).optional(),
            required: z.boolean().default(true),
            category: z.string().max(100).optional(),
          }),
        ).min(1),
        targetGroups: z.object({
          companyIds: z.array(z.string().uuid()).max(1000).optional(),
          businessUnitIds: z.array(z.string().uuid()).max(1000).optional(),
          teamIds: z.array(z.string().uuid()).max(1000).optional(),
        }).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return db.survey.create({
        data: {
          title: input.title,
          type: input.type,
          questions: input.questions as unknown as Prisma.JsonArray,
          targetGroups: input.targetGroups as unknown as Prisma.JsonObject ?? undefined,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'draft',
        },
      });
    }),

  activateSurvey: permissionProcedure('engagement', 'create')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.survey.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: { id: true, startsAt: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      return db.survey.update({
        where: { id: existing.id },
        data: { status: 'active', startsAt: existing.startsAt ?? new Date() },
        select: { id: true, status: true },
      });
    }),

```

Resulting adjacency — `listSurveys` closes at old line 66, one blank line at old 67, then `getSurveyResults:`:

```ts
      return { items, total, page, limit };
    }),

  getSurveyResults: permissionProcedure('engagement', 'read')
```

**Excision B — lines 242–290 inclusive** (`submitSurveyResponse` + the trailing blank at 290). Delete this entire block:

```ts
  submitSurveyResponse: permissionProcedure('engagement', 'create')
    .input(
      z.object({
        surveyId: z.string().uuid(),
        answers: z
          .record(z.string().max(200), z.union([z.string().max(5000), z.number()]))
          .refine((obj) => Object.keys(obj).length <= 100, {
            message: 'Demasiadas respuestas (max 100)',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Existence/active check only — select the id alone (no Survey scalars, esp. not
      // responseCount) so the unselected-findFirst rule holds and no sensitive scalar
      // is even read here.
      const survey = await db.survey.findFirst({
        where: {
          id: input.surveyId,
          organizationId: ctx.user.organizationId,
          status: 'active',
        },
        select: { id: true },
      });

      if (!survey) {
        throw new Error('Encuesta no encontrada o no activa');
      }

      try {
        // §21 minimal-select: a write response must never echo the confidential
        // `answers` JSON back. The caller (the respondent) only needs a submission
        // confirmation — id + submittedAt — not the row it just wrote.
        return await db.surveyResponse.create({
          data: {
            surveyId: input.surveyId,
            userId: ctx.user.id,
            answers: input.answers as unknown as Prisma.JsonObject,
            organizationId: ctx.user.organizationId,
          },
          select: { id: true, submittedAt: true },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Ya respondiste esta encuesta' });
        }
        throw err;
      }
    }),

```

Resulting adjacency — `getSurveyForResponse` closes at old line 240, one blank at old 241, then the `// ── eNPS ──` header comment (which must SURVIVE):

```ts
      return survey;
    }),

  // ── eNPS ───────────────────────────────────────────────────────────
  getEnps: permissionProcedure('engagement', 'read')
```

Then verify the mechanical outcome:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && wc -l packages/api/src/routers/engagement.ts && git diff --stat packages/api/src/routers/engagement.ts && sed -n '1,13p' packages/api/src/routers/engagement.ts && grep -c "createSurvey\|activateSurvey\|submitSurveyResponse" packages/api/src/routers/engagement.ts
```

Expected: **599 lines** (702 − 103), the diff shows `103 deletions(-)`, **0 insertions**, the printed import block is byte-identical to the current lines 1–13, and the grep count is **0**. Also confirm both section headers survive:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -n "── Surveys ──\|── eNPS ──" packages/api/src/routers/engagement.ts
```

- [ ] **Step 4a: Rewrite `apps/web/lib/platform-api/engagement.ts` — hand-declare the 3 write output types.**

Lines 54–56 currently derive the three write output types from the now-deleted procedures and will no longer compile:

```ts
type CreateSurveyOutput = RouterOutput['engagement']['createSurvey'];
type ActivateSurveyOutput = RouterOutput['engagement']['activateSurvey'];
type SubmitSurveyResponseOutput = RouterOutput['engagement']['submitSurveyResponse'];
```

Replace those three lines with the block below. **Lines 45–53 (the `RouterOutput` alias and the 8 READ aliases) stay exactly as they are** — unlike compensation, the `inferRouterOutputs<AppRouter>` import at line 40 is still load-bearing here because all 8 read hooks remain dual-path.

```ts
// ── Hand-declared write output shapes (2026-07-29) ─────────────────────────
// The 3 TS mutations these hooks used to fall back to (engagement.createSurvey /
// activateSurvey / submitSurveyResponse) were DELETED, so RouterOutput['engagement'][…] no longer
// resolves for them. The shapes below reproduce, field for field, exactly what those procedures
// returned (source of truth: packages/db/prisma/schema/engagement.prisma's Survey + SurveyResponse
// models and the deleted procedures' `select` clauses), so every consumer's return type is
// byte-identical to before the deletion.
//
// `questions` / `targetGroups` are Prisma `Json` / `Json?` columns; the deleted tRPC output typed
// them as `Prisma.JsonValue`. apps/web does not import @prisma/client, and CLAUDE.md bans `any` and
// unnarrowed `unknown`, so the recursive JSON union is declared locally.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// createSurvey called `db.survey.create({ data: … })` with NO select → the full 13-field Survey row.
interface CreateSurveyOutput {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  status: string;
  questions: JsonValue;
  targetGroups: JsonValue | null;
  startsAt: Date | null;
  endsAt: Date | null;
  responseCount: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

// §21 minimal-select: activateSurvey returned `select: { id: true, status: true }`.
interface ActivateSurveyOutput {
  id: string;
  status: string;
}

// §21 minimal-select: submitSurveyResponse returned `select: { id: true, submittedAt: true }` — it
// deliberately never echoed the confidential `answers` JSON back to the respondent.
interface SubmitSurveyResponseOutput {
  id: string;
  submittedAt: Date;
}
```

Type-safety note for the implementer: the generated contract types `SurveyRow.questions` and `SurveyRow.targetGroups` as `components["schemas"]["JsonNode"]`, and `JsonNode` is `unknown` (`apps/web/lib/platform-api/schema.d.ts:2797`). A cast from `unknown` to `JsonValue` is always legal in TypeScript, so the existing `raw.questions as CreateSurveyOutput['questions']` / `raw.targetGroups as CreateSurveyOutput['targetGroups']` casts in Step 4c continue to compile unchanged.

- [ ] **Step 4b: Rewrite the write-section header (lines 345–363) and delete the dead flag const (line 365).**

The current header makes three claims that become false: that the FE write flag still gates anything, that the hooks are dual-path, and (implicitly, by describing a tRPC fallback) that the `PlatformApiError` message-passthrough note is only one of two paths. Replace lines 345–365 (header block + the blank line + the `ENGAGEMENT_WRITE_VIA_CSHARP` const) with:

```ts
// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 16) — C#-ONLY. All three TS tRPC mutations
// (engagement.createSurvey / activateSurvey / submitSurveyResponse) were deleted on 2026-07-29;
// NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP was confirmed live in prod on 2026-07-28 (value re-read
// directly from Vercel production on 2026-07-29) and is no longer read here — the FE flag is
// retired. It was never listed in .env.example, so there is nothing to retire there. The BACKEND
// flag `Platform:EngagementWriteEnabled` is still real and still gates the C# routes.
//
// Of the 5 C# mutations, only these 3 have live FE consumers — createSurvey + activateSurvey
// (climate/launch-survey-modal.tsx) and submitSurveyResponse (dashboard/survey-take-modal.tsx). A
// full-repo grep still confirms createActionPlan/updateActionPlan have ZERO call sites anywhere
// (same situation as succession's addCriticalRole), so they are intentionally NOT wrapped here —
// and, for the same reason, their TS procedures were deliberately left undeleted.
//
// Each hook keeps trpc's useMutation option shape ({ onSuccess?, onError?, onSettled? }), so both
// call sites are unchanged. MutationOptions stays generic over TData (like ninebox's, unlike
// compensation's void-only) because launch-survey-modal.tsx chains
// `create.onSuccess: (survey) => activate.mutate({ id: survey.id })` off the created survey's id.
//
// ⚠️ THE READS ABOVE ARE UNAFFECTED, AND THAT HAS A CONSEQUENCE: NEXT_PUBLIC_ENGAGEMENT_READ_VIA_
// CSHARP still does not exist in Vercel, so all 8 read hooks stay dual-path and TypeScript is their
// LIVE prod path. Therefore both consumers' `utils.engagement.*.invalidate()` calls — listSurveys +
// getDashboardKpis in launch-survey-modal.tsx, myPendingSurveys in survey-take-modal.tsx — are STILL
// LIVE and must NOT be removed. This is the one domain in the TS-deletion sequence where those calls
// did not die alongside the mutation; do not "clean them up" by analogy with the other domains.
//
// submitSurveyResponse's CONFLICT toast: survey-take-modal.tsx distinguishes the duplicate-response
// case by matching `err.message` against the exact backend text ('Ya respondiste esta encuesta' /
// DuplicateResponseMessage), rather than the tRPC-specific `err.data?.code === 'CONFLICT'` shape the
// C# path can't produce. `PlatformApiError` parses the response body's `message` field (client.ts),
// so this match works correctly — and it is now the ONLY path, which makes that note load-bearing.
// ---------------------------------------------------------------------------
```

Everything else in the write section STAYS unchanged — do not delete any of it while rewriting the hooks in Step 4c: `interface MutationOptions<TData = void>` (367–371), `function useCSharpMutation` (373–383), `CreateSurveyQuestionShape` (385–391), `CreateSurveyInputShape` (393–400), `ActivateSurveyInputShape` (437–439) and `SubmitSurveyResponseInputShape` (454–457). All six are still used by the 3 surviving C#-only hooks; the last two sit _between_ the hook definitions, so a careless whole-range replacement in Step 4c would take them out.

- [ ] **Step 4c: Convert the 3 write hooks to C#-only.**

For each hook, delete the `viaCSharp` line, the `trpcMutation` line, and the ternary `return`; return the `useCSharpMutation(...)` call directly. Everything inside the mutation function body is unchanged.

`useEngagementCreateSurvey` (currently 406–435) becomes:

```ts
export function useEngagementCreateSurvey(options?: MutationOptions<CreateSurveyOutput>) {
  return useCSharpMutation(async (input: CreateSurveyInputShape) => {
    const raw = await platformPost('/engagement/surveys', {
      title: input.title,
      type: input.type,
      questions: input.questions,
      targetGroups: input.targetGroups,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return {
      id: raw.id,
      organizationId: raw.organizationId,
      title: raw.title,
      type: raw.type,
      status: raw.status,
      questions: raw.questions as CreateSurveyOutput['questions'],
      targetGroups: raw.targetGroups as CreateSurveyOutput['targetGroups'],
      startsAt: toDateOrNull(raw.startsAt),
      endsAt: toDateOrNull(raw.endsAt),
      responseCount: num(raw.responseCount),
      createdById: raw.createdById,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt),
    } satisfies CreateSurveyOutput;
  }, options);
}
```

`useEngagementActivateSurvey` (currently 442–452) becomes:

```ts
export function useEngagementActivateSurvey(options?: MutationOptions<ActivateSurveyOutput>) {
  return useCSharpMutation(async (input: ActivateSurveyInputShape) => {
    const raw = await platformPost('/engagement/surveys/{surveyId}/activate', undefined, {
      surveyId: input.id,
    });
    return { id: raw.id, status: raw.status } satisfies ActivateSurveyOutput;
  }, options);
}
```

`useEngagementSubmitSurveyResponse` (currently 460–475) becomes:

```ts
export function useEngagementSubmitSurveyResponse(options?: MutationOptions<SubmitSurveyResponseOutput>) {
  return useCSharpMutation(async (input: SubmitSurveyResponseInputShape) => {
    const raw = await platformPost(
      '/engagement/surveys/{surveyId}/responses',
      // The generated contract types `answers` as `Record<string, never>` (an openapi-typescript
      // fallback artifact for the C# `IReadOnlyDictionary<string, object>` body) — cast through
      // `unknown`, matching the ninebox/dei precedent for widened wire-type casts.
      { answers: input.answers as unknown as Record<string, never> },
      { surveyId: input.surveyId },
    );
    return { id: raw.id, submittedAt: toDate(raw.submittedAt) } satisfies SubmitSurveyResponseOutput;
  }, options);
}
```

The doc-comments immediately above each hook (`/** STAFF: create a survey … */` etc.) stay unchanged. Then confirm the file is internally consistent — the read side must be untouched and `trpc` must still be imported and used:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -c "trpc\.engagement\." apps/web/lib/platform-api/engagement.ts && grep -n "ENGAGEMENT_WRITE_VIA_CSHARP\|ENGAGEMENT_VIA_CSHARP\|inferRouterOutputs" apps/web/lib/platform-api/engagement.ts
```

Expected: the `trpc.engagement.` count drops from 11 to **8** (the 8 surviving read hooks); `ENGAGEMENT_WRITE_VIA_CSHARP` returns **no hits**; `ENGAGEMENT_VIA_CSHARP` (the READ flag, line 60) and `inferRouterOutputs` (line 40) are both **still present**.

Finally, prove the two consumers were not touched:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && git diff --stat "apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx" "apps/web/app/(admin)/dashboard/survey-take-modal.tsx"
```

Expected: **empty output** (no changes). If either file appears here, revert it — the 3 `invalidate()` calls must survive verbatim.

- [ ] **Step 5: Delete `tests/tier1/s2-activate-survey.test.ts` outright.**

All 10 tests in this 153-line file are about `activateSurvey`: a `createCallerFactory` + mocked-`@tims/db` behavioral harness (lines 22–67), a 3-test behavioral `describe` (71–110), and a 7-test static-invariants `describe` (116–153) whose source slice is `router.indexOf('activateSurvey') → router.indexOf('getSurveyResults')`. After the deletion `indexOf('activateSurvey')` returns `-1`, so the slice collapses to `''` and all 7 assertions fail on an empty string. There is no salvageable subset, and retargeting the file at the C# endpoint is not possible in vitest (it would require a live C# service — that is the parity harness's job, not vitest's).

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && git rm tests/tier1/s2-activate-survey.test.ts
```

**Acknowledgment to carry into the commit message (required):** this is the FIRST whole behavioral-test-file deletion in this migration — every prior domain's test surgery pruned static tripwires only. It is also mildly counter-directional to `docs/REMAINING-WORK.md:316`'s standing wish to "tighten DEI/engagement tests toward behavioral", since `s2-activate-survey.test.ts` was the domain's only behavioral engagement test. State this plainly: it is an accepted tradeoff — the TS-deletion migration's goal (retire the dead TS stack) takes precedence over that unrelated, separately-tracked testing wish, and the behavior itself is now covered by `EngagementWriteTests.cs` and the parity harness.

- [ ] **Step 6: Prune `tests/access/scope-wiring-engagement-write.test.ts` — 4 of 8 tests + header rewrite.**

The 8 tripwires partition cleanly: tests 1–4 (lines 20–44) target the 3 deleted mutations; tests 5–8 (lines 46–87) target the surviving `createActionPlan`/`updateActionPlan`.

**(a)** Replace the header, lines 5–14:

```ts
// Phase-5 Slice 16 — static tripwires for the engagement WRITE surface (the 5 mutations) + the H1 both-stacks
// hardening. Engagement's router calls the tenant `db` inline (no service layer), so — like the compensation /
// succession scope-wiring tripwires — behavior is guarded by source tripwires rather than a behavioral db mock.
//
// Write taxonomy:
//   createSurvey          → grant-only; createdById = ctx.user.id (provenance)
//   activateSurvey        → grant-only; 404 on missing/cross-org; startsAt preserve-else-now
//   submitSurveyResponse  → IDENTITY-anchored (userId = ctx.user.id); P2002 → CONFLICT; NO requireOrgScope
//   createActionPlan      → assertSubjectInScope(responsibleId) + H1 in-org backstop
//   updateActionPlan      → assertScoped('actionPlan') + (reassign → assertSubjectInScope + H1 in-org backstop)
```

with:

```ts
// Phase-5 Slice 16 — static tripwires for the engagement WRITE surface + the H1 both-stacks
// hardening. Engagement's router calls the tenant `db` inline (no service layer), so — like the compensation /
// succession scope-wiring tripwires — behavior is guarded by source tripwires rather than a behavioral db mock.
//
// UPDATE 2026-07-29: the surface was 5 mutations. createSurvey / activateSurvey / submitSurveyResponse
// had their TS side DELETED (NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP is live in prod; C# is the sole
// implementation), and their 4 tripwires went with them. The equivalent guarantees — provenance
// stamping, cross-org 404, identity anchoring, P2002 → CONFLICT — are now asserted against the live
// C# API by scripts/parity/write-surfaces.ts's engagementSurface raw-SQL readbacks and by
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs.
//
// Write taxonomy (the 2 mutations that remain in TS — both zero-FE-consumer dead code, deliberately kept):
//   createActionPlan      → assertSubjectInScope(responsibleId) + H1 in-org backstop
//   updateActionPlan      → assertScoped('actionPlan') + (reassign → assertSubjectInScope + H1 in-org backstop)
```

**(b)** Delete lines 20–45 inclusive (the 4 tests plus the blank line after the last one), so that line 19's `describe('engagement write scope wiring', () => {` is immediately followed by `  it('createActionPlan + updateActionPlan gate the target via assertSubjectInScope', …`. The deleted tests are, in order:

- `it('createSurvey stamps createdById = ctx.user.id (provenance, never an input)', …)`
- `it('activateSurvey 404s on missing/cross-org and preserves-else-stamps startsAt', …)`
- `it('submitSurveyResponse is identity-anchored (userId = ctx.user.id) with NO requireOrgScope', …)`
- `it('submitSurveyResponse maps the P2002 unique(surveyId,userId) violation to CONFLICT', …)`

The `describe` name at line 19 (`engagement write scope wiring`) stays valid — 2 write mutations remain. Delta: **−4 tests**; the file survives with 4.

- [ ] **Step 7: Prune `tests/access/endpoint-hardening.test.ts` — delete the `submitSurveyResponse` describe block.**

Delete lines 45–77 inclusive (the whole `describe('engagement.submitSurveyResponse hardening', …)` block plus the trailing blank line), so line 44's blank is followed directly by `describe('portal router contains only public career-site procedures', () => {`. The 4 deleted tests are:

- `it('is gated by engagement:create', …)`
- `it('respondent identity comes from ctx, never from input; no anonymous bypass', …)` — the ballot-stuffing guard
- `it('answers record is bounded (max 100 keys, bounded key/value sizes)', …)` — the input-bounds guard, now equivalently enforced at `EngagementWriteEndpoints.cs:59-61,435`
- `it('maps duplicate-submission P2002 to a clean CONFLICT (not a 500)', …)`

The block-local `const src = () => read('packages/api/src/routers/engagement.ts');` at line 46 is scoped INSIDE this describe, so it goes with it. The shared `read` helper at line 9 is used by the notification / organization / portal describes and STAYS. After the edit the file must be 65 lines and contain zero engagement references:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && wc -l tests/access/endpoint-hardening.test.ts && grep -c "engagement" tests/access/endpoint-hardening.test.ts
```

Expected: `65` and `0` (grep exits 1 with count 0 — that is the pass condition). Delta: **−4 tests**.

- [ ] **Step 8: Prune `tests/access/scope-wiring-sensitive-data.test.ts` — 1 test + comment trim + describe rename.**

Replace lines 412–422, which currently read:

```ts
// ── FIX 3 (slice 6 round 8): no raw/unselected surveyResponse rows ──────────
// submitSurveyResponse must not echo the confidential answers JSON; getEnps (and
// the other readers) must select only the fields the aggregation consumes — never
// a bare unselected findMany / include of full response rows.
describe('surveyResponse reads/writes use explicit minimal selects (FIX 3)', () => {
  it('submitSurveyResponse create selects only id + submittedAt (no answers echoed)', () => {
    expect(readEngagement()).toMatch(
      /surveyResponse\.create\([\s\S]*?select:\s*\{\s*id:\s*true,\s*submittedAt:\s*true\s*\}/,
    );
  });

```

with:

```ts
// ── FIX 3 (slice 6 round 8): no raw/unselected surveyResponse rows ──────────
// getEnps (and the other readers) must select only the fields the aggregation
// consumes — never a bare unselected findMany / include of full response rows.
// UPDATE 2026-07-29: the submitSurveyResponse write-side clause was retired together with the TS
// procedure itself (deleted; C# is the sole implementation). Its `select: { id, submittedAt }`
// no-answers-echoed guarantee is now asserted by
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs.
describe('surveyResponse reads use explicit minimal selects (FIX 3)', () => {
```

The three surviving tests in this describe — `getEnps findMany selects only answers`, `no surveyResponse.findMany without an explicit select remains in engagement.ts`, and `survey readers select responses.{answers} instead of include: responses: true` — are all still satisfied after the router excision (`getEnps`'s findMany survives; `getSurveyResults` at old 141 and `getClimateHeatmap` at old 364 both survive, keeping the `≥ 2` count). The helpers `readEngagement` (line 34) and `readEngagementKernels` (line 39) both STAY. Delta: **−1 test**.

- [ ] **Step 9: Comment-only fixes in three test files (0 test-count change).**

**(a)** `tests/tier1/s2-engagement-wiring.test.ts` lines 14–17. Replace:

```ts
// Cut over to the dark platform-api wrapper (apps/web/lib/platform-api/engagement.ts,
// Phase-5 Slice-16 write wrapper) — it still calls trpc.engagement.createSurvey.useMutation
// internally on the default (non-C#) path, so this assertion follows the refactor rather
// than the raw call (same pattern as tests/access/survey-take-ui.test.ts's engagement fix).
```

with:

```ts
// Cut over to the platform-api wrapper (apps/web/lib/platform-api/engagement.ts, Phase-5
// Slice-16 write wrapper). As of 2026-07-29 that wrapper is C#-ONLY for this mutation —
// trpc.engagement.createSurvey was deleted — so this assertion targets the wrapper hook name
// rather than a raw trpc call (same pattern as tests/access/survey-take-ui.test.ts's fix).
```

Do NOT touch the `it('invalidates listSurveys and getDashboardKpis', …)` test at lines 27–30 — it is the regression guard that proves the still-needed `invalidate()` calls were not removed. It must stay green.

**(b)** `tests/access/survey-take-ui.test.ts` lines 38–41. Replace:

```ts
// Cut over to the dark platform-api wrapper (apps/web/lib/platform-api/engagement.ts,
// Phase-5 Slice-16 write wrapper) — it still calls trpc.engagement.submitSurveyResponse.useMutation
// internally on the default (non-C#) path, so this assertion follows the refactor rather
// than the raw call (same pattern as this file's getSurveyForResponse wrapper assertion above).
```

with:

```ts
// Cut over to the platform-api wrapper (apps/web/lib/platform-api/engagement.ts, Phase-5
// Slice-16 write wrapper). As of 2026-07-29 that wrapper is C#-ONLY for this mutation —
// trpc.engagement.submitSurveyResponse was deleted — so this assertion targets the wrapper hook
// name rather than a raw trpc call. Contrast the getSurveyForResponse assertion above: the READ
// wrapper is STILL dual-path, because NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP is still dark.
```

Leave lines 31–33 (the `getSurveyForResponse` comment) alone — it is still true. Leave line 9's file-header prose alone — "submits answers keyed by question TEXT via submitSurveyResponse" describes the user-facing flow, and the C# endpoint is still conceptually `submitSurveyResponse`.

**(c)** `tests/access/survey-question-parse.test.ts`, two prose citations of the deleted Zod schema. On line 19, replace:

```ts
// ~1162-1198) plus the authoring shape (createSurvey Zod in engagement.ts).
```

with:

```ts
// ~1162-1198) plus the authoring shape — since 2026-07-29 owned by C#
// (services/Tims.Platform/src/Tims.Api/Engagement/EngagementWriteModels.cs), mirrored FE-side by
// CreateSurveyQuestionShape in apps/web/lib/platform-api/engagement.ts.
```

On line 39, replace:

```ts
// Authoring shape produced by createSurvey's Zod.
```

with:

```ts
// Authoring shape accepted by the C# create-survey endpoint (EngagementWriteModels.cs; FE mirror:
// CreateSurveyQuestionShape in apps/web/lib/platform-api/engagement.ts).
```

This is the "worked-example / generic-doc citation goes stale" pattern that has now hit five domains in a row — it is not optional.

- [ ] **Step 10: Re-run `tests/access/scope-wiring-survey-take.test.ts` — NO EDIT, but the run is mandatory.**

This file needs no change, but it is the one file whose _passing_ depends on a slice boundary that this deletion moves. Its `procedureBody()` helper (lines 16–22) slices from `getSurveyForResponse:` to the next `\n  <name>:\s*(permissionProcedure|protectedProcedure|router)` boundary. Today that boundary is `submitSurveyResponse:`; after Excision B it becomes `getEnps:`, so the isolated body widens by ~2 lines to include the `// ── eNPS ──` divider comment. The four negative assertions at lines 36, 40, 71 and 73 (`not.toMatch(/requireOrgScope/)`, `not.toMatch(/scopeWhereFor/)`, `not.toMatch(/responseCount:\s*true/)`, `not.toMatch(/responses:\s*\{\s*select/)`) were each checked against the widened slice and none of them matches the divider comment — but verify empirically:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && npx vitest run tests/access/scope-wiring-survey-take.test.ts tests/access/scope-wiring-employee-self-service.test.ts
```

Expected: **2 files, 10 + all passing, zero failures.** (`scope-wiring-employee-self-service.test.ts` reads the same router but only for `myPendingSurveys`, whose boundary is `getSurveyForResponse:` — unaffected by either excision. It is included here as a cheap second check.) If either goes red, the excision boundaries in Step 3 were wrong; fix the excision, do not loosen the test.

- [ ] **Step 11: Confirm the parity READ harness needs no change (verification only, no edit).**

`scripts/parity/surfaces.ts`'s `engagement` read surface registers 9 endpoints, every one a `tsProcedure` that survives (`listSurveys`, `myPendingSurveys`, `getEnps`, `getClimateHeatmap`, `getLowClimateAlerts`, `listActionPlans`, `listLeaderCommitments`, `getDashboardKpis`, `getRotationRisk`). No entry is removed and no count changes, so `scripts/parity/surfaces.test.ts` needs no change either. This is a deliberate contrast with compensation, which had to drop 5 of 7 read endpoints and fix its count assertion.

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -n "engagement\.\(createSurvey\|activateSurvey\|submitSurveyResponse\)" scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts scripts/parity/write-surfaces.test.ts tools/test-apis.sh apps/web/lib/trpc-types.ts .env.example; echo "exit=$?"
```

Expected: **no matches** (`exit=1`). If anything matches, stop and reassess — the investigation asserts all six of these files are unchanged.

- [ ] **Step 12: Add the UPDATE clause to `scripts/parity/write-surfaces.ts:884-889` (comment-only, no functional change).**

`engagementSurface` drives literal C# HTTP paths and asserts side effects with raw SQL readbacks — it never touches the TS router, so `verify-write engagement` is fully unaffected. Per the precedent set by compensation's `484d390` (+9 comment lines to this exact file), append an UPDATE clause. Replace lines 884–889:

```ts
// 5 writes under ONE flag Platform__EngagementWriteEnabled (COEXISTENCE, not a flip — TS monitoring/dei/
// alert-cron still read these tables). createSurvey (grant-only; created_by attributed → allow-live) +
// activateSurvey (by-id draft→active; cross-org → 404) + submitSurveyResponse (identity userId=caller +
// create grant; cross-org survey → 404; user_id attributed → allow-live) + createActionPlan (assertSubject
// InScope + H1 cross-org responsibleId → 403) + updateActionPlan (assertScoped by-id → 404). hrbp is
// ungranted → every write 403 at the gate.
```

with:

```ts
// 5 writes under ONE flag Platform__EngagementWriteEnabled (COEXISTENCE, not a flip — TS monitoring/dei/
// alert-cron still read these tables). createSurvey (grant-only; created_by attributed → allow-live) +
// activateSurvey (by-id draft→active; cross-org → 404) + submitSurveyResponse (identity userId=caller +
// create grant; cross-org survey → 404; user_id attributed → allow-live) + createActionPlan (assertSubject
// InScope + H1 cross-org responsibleId → 403) + updateActionPlan (assertScoped by-id → 404). hrbp is
// ungranted → every write 403 at the gate.
//
// UPDATE 2026-07-29: the TS counterparts of createSurvey / activateSurvey / submitSurveyResponse were
// DELETED (the FE write flag is confirmed live in prod; C# is the sole implementation). This surface is
// UNAFFECTED — it hits the C# HTTP endpoints directly and never went through the TS router — but the
// readbacks below are now the ONLY automated assertion of provenance stamping (created_by_id = caller),
// identity anchoring (user_id = caller, never an input) and the duplicate-response 409 CONFLICT, outside
// the C# integration tests. Treat them as security-load-bearing; do not weaken them.
// createActionPlan / updateActionPlan still have live TS twins (zero-FE-consumer dead code, deliberately
// retained), so those two rows continue to describe a genuine two-stack surface.
```

- [ ] **Step 13: Fix the `engagement-write` note in `scripts/deploy/cutover.sh:113`.**

The current note ends with a false non-sequitur that this deletion exposes: `COEXISTENCE` classifies TABLE OWNERSHIP, not TS-code existence, so "the TS router can't be deleted yet" never followed from it. **The status token stays `COEXISTENCE`** — the underlying reason is verified still true (`packages/api/src/routers/monitoring.ts:23,158,232`, `packages/api/src/routers/dei.ts:100`, and `packages/api/src/repositories/alert-evaluation.repository.ts:120` all still read the engagement tables directly via Prisma). Replace line 113:

```sh
      echo "write|EngagementWriteEnabled|verify-write|engagement|NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #12 — the flag flip itself is documented as canary-safe today (byte-identical rows both stacks), but COEXISTENCE for the terminal state: monitoring.ts/dei.ts/the alert cron still call Prisma models directly, so the TS router can't be deleted yet."
```

with:

```sh
      echo "write|EngagementWriteEnabled|verify-write|engagement|NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #12 — the flag flip itself is documented as canary-safe (byte-identical rows both stacks), and COEXISTENCE describes the terminal state. UPDATE 2026-07-29: the flag IS confirmed live in prod and 3 of the 5 TS mutations (createSurvey/activateSurvey/submitSurveyResponse) have now been DELETED; the other 2 (createActionPlan/updateActionPlan) have zero FE consumers and are untouched, unrelated dead code. This note previously ended '...so the TS router can't be deleted yet' — that clause was a NON-SEQUITUR and has been struck: COEXISTENCE classifies TABLE OWNERSHIP, not TS-code existence. The accurate reasoning is two separate facts: (a) the TS engagement ROUTER stays alive because 14 reads + 2 zero-consumer mutations still live in it (and NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP still does not exist in Vercel, so those 14 reads are the LIVE prod path); and (b) surveys/survey_responses/action_plans stay efcoreStranglerWrite because monitoring.ts/dei.ts/the alert-evaluation repository still read them via Prisma. verify-write is unaffected either way — write-surfaces.ts's engagementSurface hits the C# HTTP endpoints directly and asserts side effects with raw SQL, never via the TS router."
```

Do NOT change the separate `engagement` (read) row at lines 88–90 — its `FLIP_READY` status is still correct. Lines 7, 124 (`ALL_SURFACES=…`) and 249 (the Terraform gap list) are all still accurate. Then confirm the script still parses and the row still resolves:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && bash -n scripts/deploy/cutover.sh && echo "SYNTAX OK" && ./scripts/deploy/cutover.sh --list 2>&1 | grep -c "engagement"
```

Expected: `SYNTAX OK` and a non-zero grep count (both engagement rows still listed).

- [ ] **Step 14: Fix `scripts/deploy/README-cutover.md` — the worked-example paragraph and the table row.**

**(a)** The `dei`-worked-example rationale paragraph (lines 53–64) enumerates which surfaces have had TS deleted. Engagement-write now joins that list, but engagement READ remains the clean named backup — and that distinction must be explicit so a future reader does not conclude the engagement read example went stale. Replace the sentence at lines 62–64:

```
`verify dei` runs a real 10-endpoint parity/RLS/RBAC check. (`engagement` read is in the same state
and substitutes cleanly if DEI ever flips first.) One DEI caveat, also printed by `--list`:
```

with:

```
`verify dei` runs a real 10-endpoint parity/RLS/RBAC check. (`engagement` read is in the same state
and substitutes cleanly if DEI ever flips first — engagement's 2026-07-29 TS deletion touched ONLY
its WRITE side, 3 of 5 mutations, leaving all 14 reads and the real 9-endpoint `verify engagement`
check fully intact. `engagement-write` itself is therefore now a partial-TS-deletion surface too,
but that does not affect the read worked example.) One DEI caveat, also printed by `--list`:
```

**(b)** Line 137, the `engagement-write` table row. Change the last column from bare `COEXISTENCE` to `COEXISTENCE (flag live; 3 of 5 TS mutations deleted — see cutover.sh)`, mirroring how the `compensation-write` row on line 136 reads. **Pad with spaces so the trailing `|` stays column-aligned with the rest of the table** — copy the alignment of line 136 exactly. Confirm afterwards:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && awk 'NR>=125 && NR<=139 {print length($0)}' scripts/deploy/README-cutover.md | sort -u
```

Expected: a single value (all rows in the block are the same width).

Lines 89 (Terraform-gap list), 129 (the `engagement` read row, still `FLIP-READY`) and 205 ("Only evaluation360/succession/nine-box/compensation/engagement/access-review actually have a write flag today") are all still accurate — leave them.

- [ ] **Step 15: Fix `docs/architecture/table-ownership.md:109` (the OQ-6 read, already performed).**

**This read was performed while writing this plan; the result is recorded here so no reviewer has to re-derive it.**

_Ownership state — NO CHANGE NEEDED._ The machine-readable JSON block lists `"surveys"`, `"survey_responses"` and `"action_plans"` in `efcoreStranglerWrite` (lines 86–88) and `"leader_commitments"` in `efcoreReadOnly` (line 67). Those arrays are correct and must stay byte-identical: the tables remain Prisma-OWNED for DDL and are still read through Prisma by `monitoring.ts` / `dei.ts` / the alert-evaluation cron, so nothing moves toward `efcore`. `scripts/table-ownership.mjs` parses this block and `tests/governance/table-ownership.test.ts` asserts it — do not disturb the JSON structure or introduce an unescaped `"` (the note string already contains escaped `\"jsonb\"`).

_Prose — ONE CLAUSE BECOMES FALSE and MUST be corrected._ Inside the single-line `"efcoreStranglerWrite"` note value on **line 109**, the Slice-16 passage currently asserts:

> `All three tables are Prisma-OWNED (DDL/migrations) AND still written by the TS engagement router, so the ownership flip is BLOCKED (the whole write surface must flip together) — a COEXISTENCE write.`

After this change that is false for two of the three tables: `surveys` (written only by the deleted `createSurvey`/`activateSurvey`) and `survey_responses` (written only by the deleted `submitSurveyResponse`) have NO remaining TS engagement-router writer. Only `action_plans` still does, via the surviving `createActionPlan`/`updateActionPlan`. Replace that sentence — it is uniquely anchored by the phrase "still written by the TS engagement router" (`grep -n` returns exactly one hit, on line 109; the eval360 / ninebox / succession passages say "TS evaluation360 router" / "TS ninebox router" / "TS succession router") — with:

> `All three tables are Prisma-OWNED (DDL/migrations), so the ownership flip is BLOCKED (the whole write surface must flip together) — a COEXISTENCE write. UPDATE 2026-07-29: the TS side of createSurvey/activateSurvey/submitSurveyResponse was DELETED (the FE write flag is confirmed live in prod), so C# is now the SOLE writer of surveys + survey_responses; only action_plans is still written by the TS engagement router, via the two zero-FE-consumer mutations createActionPlan/updateActionPlan that were deliberately left in place. The COEXISTENCE classification is UNCHANGED and the tables stay here: ownership is about the DDL and the full read/write surface, not about which TS procedures exist, and all three are still Prisma-owned and still read in TypeScript.`

Leave the immediately following sentences alone — `All three are ALSO still READ by EngagementReadDbContext (Slice-11) AND by the LIVE TS monitoring.ts / dei.ts / alert-evaluation cron…`, `leader_commitments + alerts stay efcoreReadOnly (not written by these 5).` and the `One-active-writer is a runtime FACT…` clause are all still true.

Also leave the Slice-11 passage's `(Only the 14 reads are ported; the 5 writes — createSurvey/activateSurvey/submitSurveyResponse/createActionPlan/updateActionPlan — stay on TS.)` alone: it is a historical record of what Slice-11's scope was, and the Slice-16 passage that follows it already supersedes it.

**Noted, deliberately OUT OF SCOPE:** the Slice-12 passage on the same line 109 still says compensation's tables are `still written by TS paths (the compensation router's own create/approve + org-provisioning comp writes)`. The parenthetical example is stale as of compensation's 2026-07-29 deletion, but the top-level claim remains true (the org-provisioning comp writes still exist), so it is a pre-existing cosmetic inaccuracy in another domain's passage — recorded here so a reviewer knows it was seen and not missed, not fixed on this branch.

Verify the JSON block still parses after editing:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && node -e "const fs=require('fs');const m=fs.readFileSync('docs/architecture/table-ownership.md','utf8').match(/\`\`\`json\n([\s\S]*?)\n\`\`\`/);JSON.parse(m[1]);console.log('JSON OK')" && npx vitest run tests/governance/table-ownership.test.ts
```

Expected: `JSON OK` and a fully green governance test file.

- [ ] **Step 16: Update `docs/REMAINING-WORK.md` — the CLOSING truth-up for the whole S5 item-4 sequence.**

**(a) Lines 94–95.** Replace:

```
  - Engagement — read (#166) + write (#173). **Write flipped and live in prod** (2026-07-28) —
    `NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP=true`. Read flag does not exist in Vercel — still dark.
```

with:

```
  - Engagement — read (#166) + write (#173). **Write flipped and live in prod** (2026-07-28) —
    `NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP=true` (value re-read directly from Vercel production on
    2026-07-29). TS side deleted 2026-07-29 for the 3 FE-consumed mutations (`createSurvey`,
    `activateSurvey`, `submitSurveyResponse`); `createActionPlan`/`updateActionPlan` are untouched
    zero-FE-consumer dead code. Read flag does not exist in Vercel — still dark, so all 14 TS reads
    are DELIBERATELY RETAINED (TypeScript is their live prod path).
```

**(b) Line 132.** Change `deleted (succession, nine-box, compensation) the hook is now C#-only` to `deleted (succession, nine-box, compensation, engagement) the hook is now C#-only`. **KEEP** the `engagement's createActionPlan` zero-consumer citation at lines 133–134 — it is still the canonical example and still true.

**(c) Lines 163–177 — the headline change.** On line 163, change the exact string `TS-code deletion (step 7) has now happened for 7 of the now-12 live` to `TS-code deletion (step 7) has now happened for 8 of the now-12 live` (single character: `7` → `8`). Then replace the tail of that same sentence, currently:

```
  `getEmployeeComp` remain untouched zero-consumer dead code) — the one remaining live surface,
  engagement write, still has its TS fallback code sitting dead-but-undeleted behind its
  (now-always-true) flag. Flipping a
```

with:

```
  `getEmployeeComp` remain untouched zero-consumer dead code), and engagement (2026-07-29,
  **partially** deleted — 3 of 5 write procedures, `createSurvey`/`activateSurvey`/
  `submitSurveyResponse`; `createActionPlan`/`updateActionPlan` remain untouched zero-consumer dead
  code, and ALL 14 read procedures are DELIBERATELY RETAINED because
  `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP` still does not exist in Vercel and TypeScript is their
  live prod path — structurally the same reason compensation retained its 3 FX reads). **This closes
  the S5 item-4 TS-deletion sequence: 8 of 12 live surfaces have had their dead TS code deleted, and
  ZERO live surfaces are left with undeleted TS fallback code sitting behind an always-true flag.**
  Flipping a
```

**(d) Line 270.** Following the precedent set one line down at 271 (compensation's history row, which compensation's branch DID annotate), replace:

```
- **Engagement** — Create + Launch Survey (`createSurvey` + new `activateSurvey` draft→active). ✅
```

with:

```
- **Engagement** — Create + Launch Survey (originally `createSurvey` + `activateSurvey` draft→active; now the C# `POST /engagement/surveys` + `POST /engagement/surveys/{id}/activate` behind `useEngagementCreateSurvey`/`useEngagementActivateSurvey` — both TS procedures were deleted 2026-07-29). ✅
```

**(e) Line 316.** In the "Wave 2.5 follow-ups (recorded, not faked)" bullet, replace the final clause `tighten DEI/engagement tests toward behavioral.` with:

```
tighten DEI/engagement tests toward behavioral (note: engagement's ONLY behavioral test, `tests/tier1/s2-activate-survey.test.ts`, was retired on 2026-07-29 together with its subject — the deleted `activateSurvey` TS procedure — so the remaining engagement tests are all static-tripwire or pure-kernel; the behavioral coverage now lives in `EngagementWriteTests.cs` and the parity harness).
```

Line 109 (the dark-cutover-wrapper domain list), line 157 (`**Live now:** … engagement write.`), line 160 (`**Still dark:** … engagement read …`) and line 257 (Federico's per-domain flip-ownership row) are all still accurate — leave them.

- [ ] **Step 17: Repo-wide staleness grep for the 3 deleted procedure names.**

The recurring lesson from every prior domain is that generic doc/help-text goes stale, not just the per-surface row. Sweep the whole repo:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -rn "createSurvey\|activateSurvey\|submitSurveyResponse" \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.sh" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=.git \
  . | grep -v "^./services/Tims.Platform/" | grep -v "^./apps/web/lib/platform-api/schema.d.ts"
```

Every surviving hit must fall into one of these ACCEPTABLE buckets — read each one and confirm:

- `apps/web/lib/platform-api/engagement.ts` — the rewritten C#-only hooks and their new comments.
- `apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx` and `apps/web/app/(admin)/dashboard/survey-take-modal.tsx` — hook-name references only, untouched by design.
- `scripts/parity/write-surfaces.ts`, `scripts/parity/seed.ts` — C# HTTP-path drivers, correct as-is.
- `scripts/deploy/cutover.sh`, `scripts/deploy/README-cutover.md`, `docs/REMAINING-WORK.md`, `docs/architecture/table-ownership.md` — the rows/prose updated in Steps 13–16.
- `docs/architecture/csharp-migration/phase-5-slice-16-engagement-write.md` and `phase-5-slice-11-engagement-read.md` — historical build records, deliberately LEFT (matching compensation's `484d390`, which did not touch its slice-12 doc).
- `docs/plans/2026-06-*.md`, `docs/superpowers/plans/*`, `docs/superpowers/specs/*`, `docs/WAVE-2.5-ACCESS-CONTROL.md`, `docs/API-SPEC.md` — historical plan/spec records and pre-existing `API-SPEC.md` staleness, all deliberately LEFT (nine-box and compensation both explicitly deferred `API-SPEC.md`; follow that precedent).
- The three test files comment-fixed in Step 9, plus `tests/access/scope-wiring-survey-take.test.ts` (surviving read).

**ZERO hits are permitted in `packages/api/src/` or `apps/web/lib/trpc-types.ts`.** Verify that explicitly:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -rn "createSurvey\|activateSurvey\|submitSurveyResponse" packages/ apps/web/lib/trpc-types.ts --exclude-dir=node_modules; echo "exit=$?"
```

Expected: **no output, `exit=1`.**

Also re-assert the invalidate constraint one final time — this is the second of the two mandated restatements (the first is in Global Constraints; a third is embedded in the wrapper header written in Step 4b):

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && grep -n "utils\.engagement\..*\.invalidate" "apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx" "apps/web/app/(admin)/dashboard/survey-take-modal.tsx"
```

Expected — **exactly these three lines, all still present**:

```
launch-survey-modal.tsx:53:      utils.engagement.listSurveys.invalidate();
launch-survey-modal.tsx:54:      utils.engagement.getDashboardKpis.invalidate();
survey-take-modal.tsx:43:      utils.engagement.myPendingSurveys.invalidate();
```

If any of the three is missing, restore it. They target surviving, still-tRPC-served reads and are LIVE production code.

_(Known follow-up, deliberately NOT fixed here: when the engagement READ flag eventually flips, these three calls will invalidate a dead tRPC cache instead of the `['platform-api','engagement',…]` query keys. That latent bug already exists today for every dual-path wrapper in this migration and is not introduced by this change. Record it in the PR description; do not fix it on this branch.)_

- [ ] **Step 18: Full verification.**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && pnpm --filter @tims/api exec tsc --noEmit && echo "API TSC OK"
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats/apps/web && npx tsc --noEmit && echo "WEB TSC OK"
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && npx vitest run 2>&1 | tail -12
```

Pass criteria:

1. Both `tsc --noEmit` runs are clean. The API one specifically proves the "zero dead imports" claim from Step 3 — if it reports an unused import, the excision removed more than it should have.
2. Vitest: **zero failures**, test-file count = `baseline files − 1`, test count = `baseline tests − 19`. **Assert the REAL measured number against your Step 1 baseline.** Against the verified 257/2503 baseline the expected lines are `Test Files  256 passed (256)` and `Tests  2484 passed (2484)` — but the acceptance criterion is the DELTA against what YOU measured, not those constants. If the delta is not exactly −19, reconcile it before committing: −10 from Step 5, −4 from Step 6, −4 from Step 7, −1 from Step 8, 0 from Steps 9–10.
3. Also run the git-level sanity check:

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && git status --short && git diff --stat HEAD
```

Expected changed-file set (16 files: 15 modified, 1 deleted) — `packages/api/src/routers/engagement.ts`, `apps/web/lib/platform-api/engagement.ts`, `tests/tier1/s2-activate-survey.test.ts` (D), `tests/access/scope-wiring-engagement-write.test.ts`, `tests/access/endpoint-hardening.test.ts`, `tests/access/scope-wiring-sensitive-data.test.ts`, `tests/tier1/s2-engagement-wiring.test.ts`, `tests/access/survey-take-ui.test.ts`, `tests/access/survey-question-parse.test.ts`, `scripts/parity/write-surfaces.ts`, `scripts/deploy/cutover.sh`, `scripts/deploy/README-cutover.md`, `docs/architecture/table-ownership.md`, `docs/REMAINING-WORK.md`, and this plan file. Nothing else — in particular no `.env.example`, no modal `.tsx`, no `scripts/parity/surfaces*.ts`, no C# file.

- [ ] **Step 19: Commit.**

```bash
cd /Users/federicotafur/Desktop/NexaDev/clients/tims-international/tims-ats && git add -A && git commit -F - <<'EOF'
refactor(engagement): delete dead TS write mutations (3 of 19 procedures) + close the TS-deletion sequence

NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP is confirmed literally "true" in Vercel production
(re-verified 2026-07-29), so the tRPC fallback branches for createSurvey, activateSurvey and
submitSurveyResponse were provably unreachable. Deleted:

  - packages/api/src/routers/engagement.ts — two interior excisions (createSurvey +
    activateSurvey; submitSurveyResponse), 103 lines, 702 -> 599. ZERO imports became dead:
    every import is also used by a surviving read, so the import block is byte-unchanged.
  - apps/web/lib/platform-api/engagement.ts — the 3 write hooks are now C#-only; the dead
    ENGAGEMENT_WRITE_VIA_CSHARP const is gone. Their output types are hand-declared (a local
    recursive JsonValue alias covers the two Prisma Json columns, since apps/web cannot import
    @prisma/client and CLAUDE.md bans any/unnarrowed unknown), preserving all three hook return
    shapes byte-for-byte — including CreateSurveyOutput's full 13 fields.

DELIBERATELY RETAINED: all 14 read procedures and all 8 dual-path read hooks.
NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP still does not exist in Vercel, so TypeScript is the LIVE
prod path for every engagement read — structurally the same reason compensation kept its 3 FX
reads. createActionPlan/updateActionPlan are untouched zero-FE-consumer dead code.

The three utils.engagement.*.invalidate() calls in launch-survey-modal.tsx and
survey-take-modal.tsx were NOT removed. Unlike every predecessor domain in this sequence, they
target surviving, still-tRPC-served reads (listSurveys, getDashboardKpis, myPendingSurveys) and
are live production code. Neither consumer file is modified by this commit.

Tests: deleted tests/tier1/s2-activate-survey.test.ts outright (all 10 tests were about
activateSurvey; its static-invariant slice would collapse to an empty string post-deletion, and
retargeting it at C# is impossible in vitest). This is the FIRST whole behavioral-test-file
deletion in this migration, and it is mildly counter-directional to docs/REMAINING-WORK.md's
standing wish to "tighten DEI/engagement tests toward behavioral" — an accepted tradeoff: the
TS-deletion goal takes precedence over that unrelated, separately-tracked wish, and the behavior
is now covered by EngagementWriteTests.cs and the parity harness. Also pruned 4 tests from
scope-wiring-engagement-write, 4 from endpoint-hardening, 1 from scope-wiring-sensitive-data, and
fixed stale comments in 3 more files. Net -19 tests, -1 file.

SECURITY REVIEW NOTE (CLAUDE.md: "Security changes require explicit review note"): this deletes 9
TypeScript tests that were the only TS-side assertions of (1) provenance non-spoofability
(createdById stamped from ctx.user.id, never an input), (2) cross-org isolation on activate
(scoped findFirst; missing/cross-org -> NOT_FOUND, never an existence leak), (3) ballot-stuffing
prevention / identity anchoring on submit (userId: ctx.user.id always; no client-supplied userId
or anonymous flag — a NULL userId would bypass @@unique([surveyId, userId]) because Postgres NULLs
never collide; this is the sharpest guarantee in the set), (4) the INTENTIONAL absence of
requireOrgScope on submitSurveyResponse (an org-gate would wrongly FORBID the own-scoped
employee), (5) input bounds (answers key .max(200), string value .max(5000), <=100 keys), (6) §21
minimal-select (the write response never echoes the confidential answers JSON), and (7)
duplicate-response P2002 -> clean CONFLICT rather than a 500. All seven now live in exactly two
places: the C# implementation (EngagementWriteEndpoints/UseCase/Repository, with
EngagementWriteTests.cs + EngagementWriteEndpointAuthTests.cs), and scripts/parity/
write-surfaces.ts's engagementSurface raw-SQL readbacks, which assert provenance attribution,
identity anchoring and the no-mutation/RBAC-deny cases against the LIVE C# API. The input-bounds
concern is RESOLVED, not left open: EngagementWriteEndpoints.cs:59-61,435 enforces
MaxAnswerKeyLength=200, MaxAnswerStringLength=5000 and MaxAnswers=100 at runtime (400 Bad
Request) — real enforcement matching the deleted Zod bounds exactly. Coverage is equivalent, not
regressed; the TS side is being retired, not weakened.

Tooling/docs truthed up: cutover.sh's engagement-write note keeps its COEXISTENCE status but the
false "so the TS router can't be deleted yet" clause is struck (COEXISTENCE classifies TABLE
OWNERSHIP, not TS-code existence) and replaced with the two accurate reasons; write-surfaces.ts
gains a comment recording that its readbacks are now the only automated assertion of provenance
and identity anchoring; README-cutover.md's dei worked-example paragraph and engagement-write row;
table-ownership.md's Slice-16 passage (C# is now the SOLE writer of surveys + survey_responses;
only action_plans still has a TS writer — ownership state itself is unchanged); and
REMAINING-WORK.md now records 8 of 12 live surfaces TS-deleted with ZERO live surfaces left
holding undeleted TS fallback code, closing the S5 item-4 sequence.

Verified: pnpm --filter @tims/api exec tsc --noEmit, apps/web tsc --noEmit, npx vitest run.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

## Investigation coverage map

Every section and open question of `.superpowers/sdd/engagement-write-investigation.md` is accounted for:

| Source                                                             | Where handled                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1.1 procedure inventory / §1.2 excision spans                     | Steps 2, 3                                                                                                                                                                                                                                                                           |
| §1.3 import table (zero dead imports)                              | Step 3 verification + Step 18 gate 1                                                                                                                                                                                                                                                 |
| §1.4 no service/repo/shared/index changes                          | Out of scope by construction — engagement has no service or repository file; the router object survives, only 3 keys are removed                                                                                                                                                     |
| §2 flag state                                                      | Global Constraints (both flags), Steps 4b, 13, 16                                                                                                                                                                                                                                    |
| §3.1 read header stays                                             | Step 4a ("lines 45–53 stay"), Step 4b (write header only)                                                                                                                                                                                                                            |
| §3.2 per-hook categorization                                       | Step 4c (3 writes) + Interfaces (8 reads unchanged)                                                                                                                                                                                                                                  |
| §3.3 (a)–(e) wrapper edits                                         | Steps 4a, 4b, 4c                                                                                                                                                                                                                                                                     |
| §3.4 / §12.1 `CreateSurveyOutput` + `JsonValue`                    | Step 4a (full 13-field shape, per OQ-4)                                                                                                                                                                                                                                              |
| §4 invalidate calls                                                | Global Constraints, Step 4b header text, Step 4c consumer check, Step 17                                                                                                                                                                                                             |
| §5 `trpc-types.ts`                                                 | Steps 11, 17 (assert zero hits)                                                                                                                                                                                                                                                      |
| §6.1–§6.10 test surgery                                            | Steps 5, 6, 7, 8, 9, 10, 18                                                                                                                                                                                                                                                          |
| §7.1 `surfaces.ts` / `surfaces.test.ts`                            | Step 11 (no change, verified)                                                                                                                                                                                                                                                        |
| §7.2 `write-surfaces.ts`                                           | Step 12 (comment-only)                                                                                                                                                                                                                                                               |
| §7.3 `seed.ts`                                                     | Step 11 grep + Step 17 acceptable-bucket list (no change)                                                                                                                                                                                                                            |
| §8.1 `cutover.sh`                                                  | Step 13                                                                                                                                                                                                                                                                              |
| §8.2 COEXISTENCE reasoning re-verified                             | Step 13 (cited readers) + Step 15                                                                                                                                                                                                                                                    |
| §8.3 `README-cutover.md`                                           | Step 14                                                                                                                                                                                                                                                                              |
| §9 `.env.example`                                                  | Global Constraints (no edit, per OQ-5) + Step 18 file-set assertion                                                                                                                                                                                                                  |
| §10 `REMAINING-WORK.md`                                            | Step 16 (a)–(e)                                                                                                                                                                                                                                                                      |
| §11.1 sibling FE wrappers                                          | No change — `compensation.ts:23`, `dei.ts:11-13` and `billing.ts:304-305` all cite engagement as the canonical dual-path exemplar and remain TRUE because the 8 read hooks stay dual-path. Confirm in review; Step 18's file-set assertion catches an accidental edit                |
| §11.2 `tools/test-apis.sh`                                         | Step 11 grep (no change — both smoke-tested procedures are surviving reads)                                                                                                                                                                                                          |
| §11.3 `schema.d.ts`                                                | Global Constraints (generated, never hand-edited); consulted read-only in Step 4a                                                                                                                                                                                                    |
| §11.4 C# sources                                                   | Global Constraints (untouched); Step 17 excludes them from the sweep                                                                                                                                                                                                                 |
| §11.5 docs                                                         | Step 15 (table-ownership), Step 17 acceptable-bucket list (slice docs, API-SPEC, historical plans all deliberately LEFT). `scripts/parity/README.md` was checked while writing this plan: `grep -n engagement scripts/parity/README.md` returns **zero hits**, so it needs no change |
| §12.2 / §12.3 output shapes                                        | Step 4a                                                                                                                                                                                                                                                                              |
| §12 helper liveness (`toDate`, `toDateOrNull`, `num`, `numOrNull`) | Step 4c keeps all four in use; Step 18's web `tsc` proves none went dead                                                                                                                                                                                                             |
| §13 security note                                                  | Global Constraints, Task header, Step 3, Step 19                                                                                                                                                                                                                                     |
| OQ-1 write flag value                                              | RESOLVED — literally `"true"`, Global Constraints                                                                                                                                                                                                                                    |
| OQ-2 read flag unchanged                                           | RESOLVED informational — Global Constraints                                                                                                                                                                                                                                          |
| OQ-3(a) mid-file excision approach                                 | CONFIRMED — Step 3 (exact spans, no reflow, headers at 16/291 preserved)                                                                                                                                                                                                             |
| OQ-3(b) behavioral test-file deletion                              | CONFIRMED — Step 5, with the explicit `REMAINING-WORK.md:316` acknowledgment; also Step 16(e) and the commit message                                                                                                                                                                 |
| OQ-4 `CreateSurveyOutput` shape                                    | RESOLVED — preserve all 13 fields via local `JsonValue`, Step 4a                                                                                                                                                                                                                     |
| OQ-5 `.env.example`                                                | RESOLVED — no edit, Global Constraints                                                                                                                                                                                                                                               |
| OQ-6 `table-ownership.md`                                          | DONE while writing this plan — Step 15 records the arrays checked, the exact false clause found, and the fix                                                                                                                                                                         |
| OQ-7 C# input bounds                                               | RESOLVED — `EngagementWriteEndpoints.cs:59-61,435`, runtime-enforced, no regression; Global Constraints + Step 19                                                                                                                                                                    |
| OQ-8 corrected predictions                                         | Folded into Steps 6 (clean 4-test prune, not a "major rewrite") and 13 (status token unchanged, false clause struck)                                                                                                                                                                 |
| OQ-9 last domain in the sequence                                   | Step 16(c) — the closing "8 of 12 / zero remaining" assertion                                                                                                                                                                                                                        |
