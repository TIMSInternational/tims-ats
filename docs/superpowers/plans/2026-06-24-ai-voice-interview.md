# AI Voice Interview — Implementation Plan (Slice 1: screen loop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter launch a live, conversational AI voice pre-screen of a candidate (ElevenLabs Conversational AI) that, on completion, stores a transcript and produces an AI summary + bias check + fit score for the recruiter — with a real-candidate consent floor.

**Architecture:** A new interview *type* with its own candidate-portal voice room (sidesteps the broken `createVideoRoom`). ElevenLabs' built-in LLM drives the live call via a server-minted signed URL; a post-call HMAC webhook stores the transcript and runs transcript-fed analysis through the existing `invokeAgent` gate. State lives on a new `AiInterviewSession` row off the existing `Interview`.

**Tech Stack:** Next.js 15 / tRPC / Prisma (Supabase) / AWS Bedrock (Claude) via `packages/ai` / `@elevenlabs/react` (new) / ElevenLabs Conversational AI REST + webhook / vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-ai-voice-interview-design.md`

## Global Constraints

- TypeScript strict, **no `any`** (use `unknown` + narrow; `inferRouterOutputs` for FE types). No `@ts-ignore`.
- **Zod on every boundary** (tRPC inputs, the ElevenLabs webhook payload, agent outputs). Bounded strings (`.max()`), bounded arrays.
- **Explicit Prisma `select`** on every query (never return full records). Every tenant model has `organizationId` + `@@index([organizationId])`; every FK `@@index`; explicit `onDelete`.
- Clean architecture: Router (Zod) → Service (logic) → Repository (Prisma). Routers never import `db`. Services never import tRPC types.
- File size: components/services ≤300 lines, routers ≤500.
- **No hardcoded user-facing strings** — all via `apps/web/lib/i18n` (`es.json` typed source-of-truth + `en.json` parity; `tests/i18n/parity.test.ts` enforces).
- Secrets server-only; never expose `ELEVENLABS_API_KEY` to the client. Verify any new npm package on npmjs before `pnpm add` (exact version, lockfile committed).
- Verify before claiming done: `pnpm --filter @tims/api exec tsc --noEmit`, `cd apps/web && npx tsc --noEmit`, `npx vitest run`, `cd apps/web && npx next build`.
- Commit per step. Branch: `feat/ai-voice-interview` (already created; spec committed there).

---

### Task 1: Data model — `AiInterviewSession` + enums + voice-agent seed

**Files:**
- Create: `packages/db/prisma/schema/ai-interview.prisma`
- Modify: `packages/db/prisma/schema/interview.prisma` (add back-relation), `packages/db/prisma/schema/organization.prisma` (back-relation if Prisma requires)
- Create migration SQL: `packages/db/prisma/migrations/<ts>_ai_interview_session/migration.sql`
- Modify: `packages/db/prisma/seed-ai-agents.ts` (or the seed that creates `AiAgent` rows) — add an `ai-voice-interview` agent
- Test: `tests/db/ai-interview-schema.test.ts`

**Interfaces:**
- Produces: model `AiInterviewSession` with fields per spec §Data model; enums `AiInterviewStatus` (`pending|in_progress|completed|failed|expired`), `AiAnalysisStatus` (`pending|completed|failed`). Prisma client type `AiInterviewSession`.

- [ ] **Step 1: Write the schema.** In `ai-interview.prisma`:

```prisma
enum AiInterviewStatus { pending in_progress completed failed expired }
enum AiAnalysisStatus  { pending completed failed }

model AiInterviewSession {
  id                       String            @id @default(uuid()) @db.Uuid
  organizationId           String            @map("organization_id") @db.Uuid
  interviewId              String            @unique @map("interview_id") @db.Uuid
  candidateId              String            @map("candidate_id") @db.Uuid
  vacancyId                String            @map("vacancy_id") @db.Uuid
  status                   AiInterviewStatus @default(pending)
  elevenlabsAgentId        String?           @map("elevenlabs_agent_id")
  elevenlabsConversationId String?           @unique @map("elevenlabs_conversation_id")
  guideQuestions           Json              @map("guide_questions")
  transcript               Json?
  audioUrl                 String?           @map("audio_url")
  durationSeconds          Int?              @map("duration_seconds")
  consentedAt              DateTime?         @map("consented_at")
  consentTextVersion       String?           @map("consent_text_version")
  analysisStatus           AiAnalysisStatus  @default(pending) @map("analysis_status")
  summary                  Json?
  biasReport               Json?             @map("bias_report")
  fitScore                 Int?              @map("fit_score")
  analysisModel            String?           @map("analysis_model")
  createdAt                DateTime          @default(now()) @map("created_at")
  updatedAt                DateTime          @updatedAt @map("updated_at")

  interview    Interview    @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([candidateId])
  @@map("ai_interview_sessions")
}
```
Add `aiInterviewSession AiInterviewSession?` back-relation on `Interview`, and the relation on `Organization`.

- [ ] **Step 2: Generate client + push to a shadow/dev DB to validate.** Run: `cd packages/db && npx prisma validate --schema=prisma/schema && npx prisma generate`. Expected: validates, client generates with `AiInterviewSession`.
- [ ] **Step 3: Write the failing test** `tests/db/ai-interview-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
it('AiInterviewSession is a known Prisma model with the expected fields', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AiInterviewSession');
  expect(model, 'AiInterviewSession model exists').toBeTruthy();
  const fields = model!.fields.map((f) => f.name);
  for (const f of ['organizationId','interviewId','candidateId','status','guideQuestions','transcript','consentedAt','analysisStatus','fitScore'])
    expect(fields, f).toContain(f);
});
```
- [ ] **Step 4: Run** `npx vitest run tests/db/ai-interview-schema.test.ts` → PASS (after generate).
- [ ] **Step 5: Author the migration SQL** (`CREATE TYPE` for both enums + `CREATE TABLE ai_interview_sessions` with the columns/indexes/FKs above). Prod is NOT prisma-migrate-managed → it is applied via `npx prisma db execute --file=<migration.sql>` at deploy (note in §Deploy).
- [ ] **Step 6: Seed the voice agent.** Add to the AiAgent seed an agent `slug: 'ai-voice-interview'`, name "AI Voice Interview", so `AiAgentOrgConfig.monthlyBudget` can gate it. Idempotent upsert.
- [ ] **Step 7: Commit.** `git add packages/db && git commit -m "feat(db): AiInterviewSession model + enums + voice-agent seed"`

---

### Task 2: ElevenLabs integration client + config gate

**Files:**
- Create: `packages/api/src/lib/elevenlabs.ts` (config gate)
- Create: `packages/api/src/integrations/elevenlabs.ts` (client)
- Test: `tests/integrations/elevenlabs.test.ts`

**Interfaces:**
- Produces:
  - `isElevenLabsConfigured(): boolean` — true iff `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` + `ELEVENLABS_WEBHOOK_SECRET` all present.
  - `getSignedUrl(opts: { agentId: string; dynamicVariables: Record<string,string>; maxDurationSeconds: number }): Promise<{ signedUrl: string; conversationId: string }>` — calls ElevenLabs `GET /v1/convai/conversation/get-signed-url`; throws `TRPCError('SERVICE_UNAVAILABLE')` on failure. Reads the API key from env (server-only).
  - `verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean` — HMAC-SHA256 of the raw body with `ELEVENLABS_WEBHOOK_SECRET`, timing-safe compare; false if missing/mismatch. (Mirror the HMAC pattern in `packages/api/src/lib/impersonation.ts`.)

- [ ] **Step 1: Write the failing test** `tests/integrations/elevenlabs.test.ts` — cover (a) `verifyWebhookSignature` returns true for a body signed with the secret and false for a tampered body / missing header; (b) `isElevenLabsConfigured` reflects env presence. Use `vi.stubEnv`. (Do NOT hit the network — `getSignedUrl`'s fetch is mocked via `vi.spyOn(globalThis,'fetch')` asserting it never receives the key in the URL and returns the parsed `signed_url`/`conversation_id`.)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
beforeEach(() => { vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', 'whsec_test'); });
it('verifyWebhookSignature accepts a correctly-signed body, rejects tampering', async () => {
  const { verifyWebhookSignature } = await import('../../packages/api/src/integrations/elevenlabs');
  const body = JSON.stringify({ type: 'post_call', conversationId: 'c1' });
  const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex');
  expect(verifyWebhookSignature(body, sig)).toBe(true);
  expect(verifyWebhookSignature(body + 'x', sig)).toBe(false);
  expect(verifyWebhookSignature(body, null)).toBe(false);
});
```
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/elevenlabs.ts` (config gate) and `integrations/elevenlabs.ts` (client). `verifyWebhookSignature` uses `crypto.createHmac('sha256', secret).update(rawBody).digest()` + `timingSafeEqual` (fail-closed if secret/header absent). `getSignedUrl` does `fetch('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=...', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } })`, posting the dynamic-variable/override config per ElevenLabs' current API (confirm exact field names against ElevenLabs docs via context7/web at implementation time), returns `{ signedUrl, conversationId }`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(api): ElevenLabs integration client + config gate + HMAC verify"`

---

### Task 3: Repository + service — create session & getResult

**Files:**
- Create: `packages/api/src/repositories/ai-interview.repository.ts`
- Create: `packages/api/src/services/ai-interview.service.ts`
- Test: `tests/access/ai-interview-service.test.ts`

**Interfaces:**
- Consumes: `AiInterviewSession` (Task 1); `generateGuide` service (existing, `packages/api/src/routers/interview/ai.ts` / its service) to produce `guideQuestions`.
- Produces (service):
  - `createAiInterviewSession(deps, { interviewId, organizationId, scopeWhere }): Promise<{ sessionId: string; candidateLink: string }>` — verifies the interview is in scope, runs `generateGuide`, creates the session (`status: pending`, `guideQuestions`, `elevenlabsAgentId` from env), returns the candidate magic-link (reuse the candidate-portal token mechanism from Wave 1).
  - `getAiInterviewResult(deps, { sessionId, organizationId, scopeWhere }): Promise<AiInterviewResultDTO>` — explicit-select read (transcript/summary/biasReport/fitScore/status), tenant + scope filtered.
- Repository: thin Prisma wrappers with explicit `select`.

- [ ] **Step 1: Failing test** — `createAiInterviewSession` calls `generateGuide` and persists `guideQuestions` + `status:'pending'`; `getAiInterviewResult` returns only the DTO fields and filters by `organizationId` (mock the repo/db; assert the where-clause includes `organizationId`). 
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** repository + service. Reuse the candidate magic-link token util (find it via the Wave 1 candidate-portal code, e.g. `packages/api/.../candidate-portal` token signing). DTO is a typed object, no `any`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

---

### Task 4: tRPC router — `create`, `recordConsent`, `start` (gates + signed URL), `getResult`

**Files:**
- Create: `packages/api/src/routers/ai-interview.ts`
- Modify: `packages/api/src/routers/root.ts` (mount `aiInterview`)
- Test: `tests/access/ai-interview-router.test.ts`

**Interfaces:**
- Consumes: service (Task 3), ElevenLabs client (Task 2), consent helpers (`packages/api/src/access/consent.ts`), budget (`AiAgentOrgConfig`).
- Produces (tRPC procedures):
  - `aiInterview.create` — `permissionProcedure('interview','create')` + `assertScoped('interview', input.interviewId)`; input `{ interviewId: uuid }`; → `{ sessionId, candidateLink }`.
  - `aiInterview.recordConsent` — `candidateProcedure`; input `{ sessionId: uuid, textVersion: string.max(50) }`; writes `consentedAt`/`consentTextVersion` on the session (only the candidate who owns it) + upserts `DataConsent` (`subjectUserId = candidateId`, `consentType:'ai_interview'`). 
  - `aiInterview.start` — `candidateProcedure`; input `{ sessionId: uuid }`; **gates in order**: (1) session belongs to this candidate and is `pending`; (2) `consentedAt` set; (3) org voice budget remaining (`AiAgentOrgConfig.monthlyBudget` for `ai-voice-interview` minus spend > 0) — else `FORBIDDEN`/`PAYMENT_REQUIRED`; then `getSignedUrl(...)`, persist `elevenlabsConversationId`, set `status:'in_progress'`, return `{ signedUrl }` (NEVER the key).
  - `aiInterview.getResult` — `permissionProcedure('interview','read')` + scoped; → result DTO.

- [ ] **Step 1: Failing tests** (static + behavioral): `start` throws when consent missing; throws when budget exhausted; returns a `signedUrl` and NEVER includes `ELEVENLABS_API_KEY` in its output; `create` uses `permissionProcedure('interview','create')`; `recordConsent` only writes for the owning candidate. Mock the ElevenLabs client + service.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the router; mount in `root.ts`. Gates fail-closed and in the specified order.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @tims/api exec tsc --noEmit` clean.
- [ ] **Step 5: Commit.**

---

### Task 5: Post-call webhook route (HMAC, idempotent, store transcript, decrement budget)

**Files:**
- Create: `apps/web/app/api/elevenlabs/webhook/route.ts`
- Create: service method `processPostCallWebhook(deps, payload)` in `ai-interview.service.ts`
- Test: `tests/access/ai-interview-webhook.test.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature` (Task 2), repository (Task 3), the analysis trigger (Task 6 — call it but tolerate it being a no-op stub until Task 6 lands).
- Produces: `POST /api/elevenlabs/webhook` → 200 on success, 401 on bad signature, 200 (idempotent no-op) on a duplicate `conversationId`.

- [ ] **Step 1: Failing test** — reads the **raw body**, rejects (401) when the HMAC header is wrong; on a valid signed payload looks up the session by `elevenlabsConversationId`, stores `transcript`/`durationSeconds`/`audioUrl`, sets `status:'completed'`, decrements org budget by `minutes → $`; a second identical delivery is a no-op (no double-store, no double-decrement). Use a crafted body + `createHmac`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The Next route handler reads `await req.text()` (raw) BEFORE JSON-parsing (HMAC needs the raw bytes), verifies, Zod-parses the payload, calls `processPostCallWebhook`. Idempotency: guard on `status !== 'completed'` (or a processed flag) inside a `$transaction`. Budget decrement: `durationSeconds/60 * RATE` recorded as spend (store on the session; org remaining computed from the sum). Trigger analysis (Task 6) after store; analysis failure must NOT fail the webhook (catch → `analysisStatus:'failed'`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

---

### Task 6: Transcript-fed post-call analysis (fit-score agent + summarizer/bias reuse, through the gate)

**Files:**
- Create: `packages/ai/src/agents/interview-fit-score.ts` (prompt + Zod output schema, registered like other agents)
- Create: `packages/api/src/services/ai-interview-analysis.service.ts` (orchestrates the 3 agents over the transcript)
- Modify: `packages/ai/src/registry.ts` (register `interview-fit-score`)
- Test: `tests/ai/interview-fit-score.test.ts`, `tests/access/ai-interview-analysis.test.ts`

**Interfaces:**
- Consumes: `invokeAgent` (existing gate, `packages/ai`); existing `interview-summarizer` + `bias-detector` agent definitions; the stored `transcript`.
- Produces: `analyzeAiInterview(deps, { sessionId }): Promise<void>` — builds a transcript text, runs summarizer + bias-detector + fit-score through `invokeAgent` (budget/PII/Zod/audit), persists `summary`/`biasReport`/`fitScore`/`analysisModel`, sets `analysisStatus:'completed'` (or `'failed'` on any error). `interview-fit-score` output schema: `{ score: number().int().min(0).max(100), rationale: string().max(2000) }`.

- [ ] **Step 1: Failing test** — `analyzeAiInterview` invokes the three agents through `invokeAgent` (mock it), persists the fit score (0–100) + summary + bias, sets `analysisStatus:'completed'`; on an `invokeAgent` throw it sets `analysisStatus:'failed'` and does not throw. The fit-score agent's Zod schema rejects a score >100.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Reuse the summarizer/bias agents by feeding a transcript-derived prompt input (NOT the scorecard path). Everything goes through `invokeAgent` — no direct Bedrock calls (the CI grep-gate forbids Bedrock outside `packages/ai`).
- [ ] **Step 4: Run** → PASS; wire Task 5's trigger to call `analyzeAiInterview`.
- [ ] **Step 5: Commit.**

---

### Task 7: Candidate frontend — consent screen + live voice room

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/page.tsx` (or the existing candidate-portal route group — match Wave 1's structure)
- Create: `apps/web/.../ai-interview/consent-screen.tsx`, `.../ai-interview/voice-room.tsx`
- Modify: `apps/web/lib/i18n/es.json` + `en.json`
- Modify: `apps/web/package.json` (add `@elevenlabs/react`, exact version)
- Test: `tests/access/ai-interview-ui.test.ts`

**Interfaces:**
- Consumes: `aiInterview.recordConsent`, `aiInterview.start` (Task 4) via the candidate-portal tRPC client.

- [ ] **Step 1: Verify + add the dependency.** Confirm `@elevenlabs/react` on npmjs; `cd apps/web && pnpm add @elevenlabs/react@<exact>`. Commit the lockfile.
- [ ] **Step 2: Failing test** (static-source, matching the repo's UI test style): the page renders a consent screen gating the room; the room calls `useConversation` with the `signedUrl` from `start` and is **only** mounted after consent; no hardcoded strings; the API key never appears client-side.
- [ ] **Step 3: Implement.** Consent screen → `recordConsent` then enables Start → `start` → `useConversation({ signedUrl })` with mic-permission handling, live transcript, End. Loading/Error/Empty. i18n es+en (disclosure text is a versioned constant referenced by `textVersion`).
- [ ] **Step 4: Run** vitest + `cd apps/web && npx tsc --noEmit` + `npx next build` → all green.
- [ ] **Step 5: Commit.**

---

### Task 8: Recruiter entry point + result view + final verification

**Files:**
- Modify: the interview detail/list surface (`apps/web/app/(admin)/recruitment/interviews/...`) — add "Start AI screen" (calls `aiInterview.create`, surfaces the candidate link) + a result panel (calls `aiInterview.getResult`)
- Create: `apps/web/.../interviews/ai-screen-result.tsx`
- Modify: i18n es+en
- Test: `tests/access/ai-interview-recruiter-ui.test.ts`

**Interfaces:**
- Consumes: `aiInterview.create`, `aiInterview.getResult`.

- [ ] **Step 1: Failing test** — the result panel renders transcript/summary/strengths/concerns/bias/fitScore from `getResult`; "Start AI screen" calls `create`; "re-run analysis" shown when `analysisStatus==='failed'`. No hardcoded strings.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the entry point + result view.
- [ ] **Step 4: Full gate** — `pnpm --filter @tims/api exec tsc --noEmit`, `cd apps/web && npx tsc --noEmit`, `npx vitest run`, `cd apps/web && npx next build`. All green.
- [ ] **Step 5: Commit.**

---

## Deploy notes

- Migration: prod is NOT prisma-migrate-managed → apply `migration.sql` via `npx prisma db execute --file=<migration.sql>` against prod before/with the merge; re-seed adds the `ai-voice-interview` AiAgent (idempotent).
- Config handoff (Federico): set `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET` in Vercel prod; create the ElevenLabs Conversational-AI agent (Claude model, system-prompt template using the injected dynamic variables, max-duration, post-call webhook → `https://tims-ats.vercel.app/api/elevenlabs/webhook`). Until set, `isElevenLabsConfigured()` fails the feature closed.
- Per the repo's deploy convention: git push → merge to main → Vercel git auto-deploy; CI red is the known billing trap (local `/gate` is the real gate).

## Self-review (against the spec)

- §Architecture (new room, candidate portal, sidesteps createVideoRoom) → Tasks 1,7. ✅
- §Data model → Task 1. ✅  §Backend (router/service/integration/webhook) → Tasks 2–5. ✅
- §Post-call analysis (transcript-fed, gate, reuse agents) → Task 6. ✅
- §Frontend (candidate take + recruiter result) → Tasks 7,8. ✅
- §Consent (per-session evidence + DataConsent, fail-closed `start`) → Tasks 4,7. ✅
- §Budget (AiAgentOrgConfig $ gate, decrement, max-duration) → Tasks 1,4,5. ✅
- §Error handling (HMAC, idempotency, analysis-failure isolation, PII via gate) → Tasks 5,6. ✅
- §Security (key server-only, signed URL, tenant/scope) → Tasks 2,4. ✅
- §Testing → every task is TDD. ✅
- §Config handoff → Deploy notes. ✅
- Deferred items (custom-LLM live, scheduling, proctoring, question banks, full data-rights, fixing createVideoRoom) → NOT in any task (correctly out of scope). ✅
