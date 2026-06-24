# AI Voice Interview — Design Spec (Slice 1: the screen loop)

> Status: DESIGN APPROVED (brainstorm, 2026-06-24). Next: writing-plans.
> Scope: the FIRST slice only — a recruiter-launched, live AI voice pre-screen of a
> candidate, with consent, that produces a scored write-up. Larger ambitions
> (scheduling, proctoring, recruiter-authored question banks, full data-rights) are
> explicitly deferred (see §Out of scope).

## Goal

Let a recruiter run a **live, conversational AI voice pre-screen** of a candidate and get
back a transcript + AI summary + bias check + fit score — reusing TIMS's existing
interview-AI agents and AI safety gate, with a real-candidate-grade consent floor.

## Locked decisions (from brainstorm)

1. **Live conversational** voice (not async-recorded) → **ElevenLabs Conversational AI**.
2. Use case: **candidate pre-screen** (recruitment).
3. MVP = the **full screen loop** end-to-end (reuse existing AI pieces), not a thin PoC.
4. **Brain split**: the live conversation runs on **ElevenLabs' built-in LLM** (select a
   Claude model in the ElevenLabs agent); the sensitive **post-call analysis** runs through
   TIMS's existing **`invokeAgent` gate** (budget/PII/audit). A custom-LLM-via-gate proxy
   for the live turns is a deferred hardening slice.
5. **Compliance floor = real candidates**: explicit consent + AI-disclosure before the call,
   stored per-session consent evidence + a withdrawable `DataConsent` record.

## Architecture

An AI voice screen is a **new interview type** with its own candidate-facing room, separate
from the human video room. This deliberately **sidesteps the broken `interview.createVideoRoom`
video provider** — ElevenLabs handles the media (WebRTC) itself. The candidate joins through
the **existing candidate portal** (Wave 1 magic-link, `candidateProcedure` = `publicProcedure`
+ `isCandidate`); candidates are `Candidate` rows, not staff `User`s.

It hangs off the existing `Interview` (candidate + vacancy + application) so recruiters see
the AI screen alongside other interviews; voice-specific data lives on a 1:1 child row.

## End-to-end flow

1. **Recruiter** → on a candidate's interview, "Start AI screen." Backend runs existing
   **`interview.generateGuide`** to produce questions, creates an `AiInterviewSession`
   (status `pending`), and issues the candidate a magic-link to the take page.
2. **Candidate** opens the link → **consent + AI-disclosure screen** → agrees → per-session
   consent evidence is written (and a withdrawable `DataConsent` upserted) → "Start."
3. Client → **`aiInterview.start`** (`candidateProcedure`). Backend **re-checks**: session is
   `pending`/owned by this candidate, consent recorded, **org voice budget remaining**. Then
   calls ElevenLabs **get-signed-url** (API key server-side only), passing **dynamic variables**
   (candidate first name, role/vacancy title, the guide questions, org disclosure text) and a
   per-conversation **max-duration** cap. Returns the signed URL; session → `in_progress`.
4. Client connects via **`@elevenlabs/react` `useConversation({ signedUrl })`** → live two-way
   voice; live transcript rendered; "End" button.
5. Call ends → ElevenLabs fires the **post-call webhook** → **`POST /api/elevenlabs/webhook`**:
   verify **HMAC** signature, look up the session by ElevenLabs conversation id, store
   transcript + audio reference + duration, decrement org voice budget, set status
   `completed`. Then run **post-call analysis through `invokeAgent`** (see below).
6. **Recruiter** sees transcript + summary + bias + fit score on the interview/candidate page.

## Data model (`packages/db`)

New `AiInterviewSession` (tenant-scoped, indexed on `organizationId`):

- `id`, `organizationId`, `interviewId` (FK → Interview), `candidateId`, `vacancyId`
- `status`: enum `pending | in_progress | completed | failed | expired`
- `elevenlabsConversationId` (nullable until started), `elevenlabsAgentId`
- `guideQuestions` (Json — the generated questions injected as dynamic variables)
- `transcript` (Json — turn list, set on webhook), `audioUrl` (nullable ref), `durationSeconds`
- **Consent evidence (per-session, authoritative)**: `consentedAt`, `consentTextVersion`
- `analysisStatus`: enum `pending | completed | failed`; `summary` (Json), `biasReport` (Json),
  `fitScore` (Int, **0–100**), `analysisModel`
- timestamps; explicit `onDelete` on the Interview relation.

Reuse **`DataConsent`** for the *withdrawable global* state: `consentType: 'ai_interview'`,
`subjectUserId = candidateId` (soft uuid, no FK — survives deletion), versioned `textVersion`.
Per-session consent lives on the session row (the `@@unique([subjectUserId, consentType])` on
DataConsent prevents multiple rows per candidate, so the session row is the per-interview
evidence; DataConsent is the current-state/withdrawal record).

Budget: register an **`ai-voice-interview` `AiAgent`** and reuse its **`AiAgentOrgConfig.monthlyBudget`**
($ cap) — ElevenLabs minutes are converted to $ at a configured per-minute rate and decremented
per session. (This reuses the existing budget mechanism rather than adding a parallel one.)

## Backend (`packages/api`)

New `aiInterview` router + service (Router → Service → Repository per repo convention):

- **`create`** (staff `permissionProcedure('interview','create')` + `assertScoped('interview')`):
  runs `generateGuide`, creates the session, returns the candidate magic-link.
- **`recordConsent`** (`candidateProcedure`): writes per-session consent + upserts DataConsent.
- **`start`** (`candidateProcedure`): the gates (ownership, consent, budget) → mint ElevenLabs
  signed URL with dynamic variables → return URL. **Never returns the API key.**
- **`getResult`** (staff, scoped): transcript + analysis for the recruiter view.
- **`webhook` handler** (`POST /api/elevenlabs/webhook`, a Next route — NOT tRPC): HMAC verify,
  idempotent on conversation id, store transcript/audio/duration, decrement budget, trigger
  analysis.
- **`elevenlabs` integration client** (`packages/api/src/integrations/elevenlabs.ts`):
  `getSignedUrl(agentId, dynamicVars, maxDurationSec)`, `verifyWebhookSignature(body, sig)`.
  Config-gated like Stripe (`isElevenLabsConfigured` → features fail closed when keys absent).

## Post-call AI analysis (`packages/ai`, through the gate)

A **new transcript-fed analysis** path — NOT the existing `generateSummary`/`detectBias`
endpoints, which key off human *scorecards* that an AI screen doesn't have. It **reuses the
underlying agents** (`interview-summarizer`, `bias-detector` in `packages/ai`) by feeding them
the transcript, plus a **new `interview-fit-score` agent**, all wrapped by `invokeAgent`
(budget → PII/Bedrock-guardrail → Zod-validate → audit). Output persisted on the session;
`analysisStatus` reflects success/failure independently of the call (transcript is never lost).

## Frontend (`apps/web`)

- **Candidate take page** (candidate-portal route, magic-link auth): (a) consent + disclosure
  screen → `recordConsent`; (b) live room — `@elevenlabs/react` `useConversation`, mic-permission
  prompt, live transcript, Start/End, graceful states. New dependency: `@elevenlabs/react`
  (verify on npm before adding, per AI-code dependency rule).
- **Recruiter result view**: on the interview/candidate page — transcript + summary +
  strengths/concerns + bias indicators + fit score; "re-run analysis" if `analysisStatus=failed`.
- All strings i18n es/en. Loading/Error/Empty throughout.

## Consent & compliance

- Disclosure states: AI-conducted, **recorded** (audio + transcript), purpose (evaluation),
  retention. Explicit agree (checkbox + button). Versioned text.
- `start` is **fail-closed** on missing consent. Audio/transcript retained per consent.
- Deferred to the "full compliance" slice: candidate erasure/data-rights, per-org configurable
  disclosure text, NYC LL144 bias-audit logging hooks, EU AI Act high-risk documentation.

## Budget & cost controls

- Per-org voice budget in **$** (`AiAgentOrgConfig.monthlyBudget` for the `ai-voice-interview`
  agent; minutes→$ at a configured rate). **`start` checks remaining budget before minting the
  URL** → fail-closed with a friendly "AI screening unavailable." Per-conversation
  **max-duration** cap on the ElevenLabs agent. Spend decremented from the webhook's reported
  duration. Surface remaining budget in the platform AI-agents admin.

## Error handling

- Webhook: reject unsigned/invalid HMAC; **idempotent** on conversation id (ElevenLabs retries);
  analysis failure still stores the transcript (`completed` + `analysis failed`, re-runnable).
- Signed-URL mint failure (ElevenLabs down) → friendly error, session stays `pending`, retryable.
- Candidate drops mid-call → partial transcript reconciled via webhook; session not stuck (an
  `expired` sweep for `in_progress` sessions with no webhook after the max-duration + grace).
- **PII**: transcripts pass through the existing Bedrock guardrail/sanitization before
  storing/analysis, per the AI-safety rules.

## Security

- ElevenLabs API key **server-only**; client only ever receives a short-lived **signed URL**.
- Webhook HMAC-verified; reject otherwise. Idempotency prevents double-processing/double-spend.
- Tenant isolation: a session belongs to one org; staff reads scoped via `assertScoped`;
  candidate reads limited to their own session via `candidateProcedure` identity.
- No `any`, explicit Prisma `select`, Zod on all boundaries (incl. the webhook payload),
  bounded inputs — per CLAUDE.md AI-code-safety rules.

## Testing

- Unit (vitest, mocked ElevenLabs client — no real calls): consent gate (no consent → `start`
  throws), budget gate (over budget → throws), **webhook HMAC** (bad sig → reject),
  **idempotency** (dup webhook → no double-analysis/double-spend), transcript→analysis wiring,
  **API key never reaches the client payload**, tenant isolation, `expired` sweep.
- Static tripwires consistent with the repo's access tests where applicable.
- Final **manual live smoke** (one real call end-to-end) — gated on the ElevenLabs account.

## Config / dependencies (handoff from Federico)

Built and unit-tested **dark** (like Stripe), but a live call needs:
`ELEVENLABS_API_KEY`, the **Conversational-AI agent id** (created in the ElevenLabs dashboard
with a Claude model + system prompt template + max-duration + post-call-webhook configured),
and `ELEVENLABS_WEBHOOK_SECRET` — set in Vercel prod env. `isElevenLabsConfigured` fails the
feature closed until present.

## Out of scope (deferred — separate slices)

- Custom-LLM-via-gate proxy for the **live** turns (MVP uses ElevenLabs built-in).
- Candidate self-scheduling / email-invite automation; webcam **proctoring**.
- Recruiter-authored question banks per vacancy (MVP uses `generateGuide`).
- Full data-rights/erasure, per-org disclosure text, LL144/EU-AI-Act documentation.
- Fixing the human-interview `createVideoRoom` video provider (separate finding/ticket).

## Open questions (resolved for this slice)

- **Consent keying for candidates**: per-session evidence on `AiInterviewSession`
  (`consentedAt`/`consentTextVersion`) + a `DataConsent` row keyed `subjectUserId = candidateId`.
- **Where the candidate joins**: the existing candidate portal (magic-link), not the admin room.
- **Analysis reuse**: agent-level (summarizer/bias), via a new transcript-fed entry point;
  `generateSummary`/`detectBias` (scorecard-keyed) are NOT reused as-is.
