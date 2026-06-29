# Known Issues & Remaining Work

> Single backlog/status reference (rule #1: docs are code — update in the SAME PR as the change).
> **Truthed-up 2026-06-29 against HEAD `main` (PR #96, commit `5115a83`)** via a 4-area audit
> (docs, AI, frontend, integrations) + direct prod verification. Supersedes the prior truth-up
> (which only covered PRs #1–#53 and had drifted materially).
> **`docs/PRODUCT-MAP.md` is STALE — this file is canonical for status.** Per-feature detail lives
> in the wave/spec docs cited below.

---

## ✅ DONE (verified in code + prod, not aspirational)

Detail for each lives in its wave/spec doc; this is the scannable status roll-up.

### Platform foundation
- **Security:** RLS tenant isolation LIVE (`RLS_ENFORCED=true`, fail-closed policies); SQL-injection/IDOR fixes; `hr_admin` fail-closed allowlist; Turnstile on public apply; nonce CSP; Upstash rate limiting; CI grep-gates (any/raw-SQL/XSS/ts-ignore/eval/service_role/AI-door). (PRs #2–#11)
- **AI safety:** single gated door `invokeAgent` (fail-closed budget → cache → PII sanitize + Bedrock Guardrails MASK → circuit breaker → Zod-validate → usage log); CI + vitest enforce "no Bedrock outside `packages/ai`". (PRs #15–#19, guardrail wired #53)
- **Architecture:** Router→Service→Repository standard; god-components split; Sentry (token pending) + Pino; caching layer; Supavisor pooling; mobile sweep (~35 routes @390×844); Vercel prod + alias.
- **MFA/TOTP** for platform owners + super_admins (built; `MFA_ENFORCED` off by default). (PR #51)
- **Platform console → 100%** (real reset, AI budget editor, audit export, signed-cookie impersonation, GDPR/Habeas-Data export, force-logout, alert-rule cron engine). (PRs #47–#53)

### Wave 2.5 — Access control — **COMPLETE + LIVE IN PROD** (`docs/WAVE-2.5-ACCESS-CONTROL.md`)
- All 7 slices shipped (PRs #67–#74): deny-by-default kernel, endpoint hardening, scope enforcement (recruitment + people), role-aware UI, sensitive-data k-anonymity (min-5, codex-hardened 14 rounds), membership admin, **external API-key auth (7b, #74)**.
- **✅ Wave-DATA deploy IS APPLIED in prod** (verified 2026-06-29 by direct query): the `seed-access --apply` matrix ran — 9 roles with correct scoped grants (super_admin/hr_admin/recruiter/external→`organization`, hrbp→`unit`, leader/committee→`team`, employee→`own`) replicated across all 11 orgs (98 permissions × roles); legacy recruiter over-grants (`offer:approve`, `vacancy:approve`) removed. The role matrix is genuinely enforced. *(The prior doc's "seed not yet run" note was stale.)*

### Role-native experience — **COMPLETE** (`docs/ROLE-EXPERIENCE-REBUILD-SPEC.md`)
- Slices 0–4 shipped (PRs #75–#80 + follow-ups #81–#90): manifest-driven IA, all 7 org roles + platform_owner have distinct purpose-built tRPC-backed shells + landings; impersonation propagates effective identity to RSCs (#83).

### Recruitment ATS (the spine) — **REAL**
- Pipeline, vacancies, candidates, interviews, assessment *authoring*, offers, talent pools, recruitment analytics — all functional with working mutations.

### Candidate portal — **REAL** (`docs/WAVE-1-CANDIDATE-PORTAL.md`)
- Job board, apply (Turnstile), magic-link login, status dashboard (My Applications/Interviews/Offers + timelines), offer e-signing. (Slices 1–4)
- **Staff/candidate auth boundary RESOLVED** — token-based linking (B2), `docs/SECURITY-staff-candidate-auth-linking.md`. *(Prior doc listed this as an open SECURITY/HIGH; it shipped 2026-06-10.)*

### AI Voice Interview (ElevenLabs) — **COMPLETE** (specs 2026-06-24/26/28)
- Live conversational pre-screen (Slice 1, #92), Zoom-style call redesign (#94), **paid per-org add-on + per-type duration caps (#95)**. Gated, billed (frozen per-minute usage + add-on fee), platform-admin controlled. Ships dark per org until enabled.

### i18n enforcement — **COMPLETE** (#96, `tests/security/i18n-no-hardcoded-strings.test.ts`)
- Absolute vitest gate blocking hardcoded user-facing strings in `apps/web` (CI Security-Audit + local `/gate`). ~393 hardcoded strings across 86 files swept to `t.*` (both locales). *(The prior doc's "i18n complete, 1802 keys" was inaccurate — strings were leaking; now genuinely enforced.)* See [[tims-i18n-enforcement]].

### 8 live gate-wired AI agents
- cv-parser, candidate-screener, vacancy-writer, inclusive-language, interview-guide, interview-summarizer, bias-detector, ai-voice-interview. Interview AI endpoints surfaced in the room UI (#89).

---

## 🔧 REMAINING — by tier (effort × impact)

### Tier 0 — Operational flips & config (cheap, high-leverage; mostly owner-action)
| Owner | Item |
|---|---|
| Federico | **Stripe go-live** — set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_STARTER` + `STRIPE_PRICE_PROFESSIONAL` (latter two missing from `.env.example`), register webhook, configure Billing Portal. Code is complete + verified in test mode (`docs/WAVE-2-STRIPE-BILLING.md`); dormant until keys set. |
| Federico | **`DAILY_API_KEY`** — human video interviews (`interview.createVideoRoom`) are code-complete (Daily.co) but throw at runtime without the key (absent from `.env.example`). The AI voice interview uses ElevenLabs and is unaffected. |
| Federico | **Fix Bedrock payment instrument (AWS acct 747814092517)** — Sonnet 4.5 Marketplace subscription can't activate; 5 analysis agents (interview-summarizer/guide, bias-detector, interview-fit-score, candidate-screener) are downgraded to Haiku 4.5 as a stopgap. Restore to Sonnet in `registry.ts` once billing clears. |
| Federico | **MFA enforce** — enroll TOTP at `/mfa`, set `MFA_ENFORCED=true` in Vercel prod. |
| Federico | **GitHub Actions billing** — every CI job fails in ~3s (empty steps); merges use admin-override + local `/gate`. Fix at github.com/settings/billing. |
| Federico | Branch protection on `main` (6 required checks ready); `SENTRY_AUTH_TOKEN` for readable stack traces. |
| TIMS/product | **Per-org `AiAgentOrgConfig` budgets** — a fail-closed $25/mo cap applies until set (AI silently stops at the cap). |
| TIMS/product | **ai-voice-interview activation** per org (platform admin → AI Agents → Orgs: enable + `billableUsdPerMinute`/`addonMonthlyFeeUsd`/caps). |

### Tier 1 — Last-mile UI wiring (backends EXIST; primary buttons are `toast('próximamente')`)
Highest value-per-effort: the mutations are real, no UI invokes them. Wire the action UI for:
- **Succession** — Add Successor / Export (`addSuccessor`/`addCriticalRole` exist).
- **Engagement** — Launch Survey (create flow; survey-TAKING already works on the employee dashboard).
- **Learning** — enroll / complete (backend exists; UI read-only).
- **Compensation** — approve adjustment / simulate (mutations exist, unwired).
- **Performance** — create OKR / commitment / coaching session (commitments UI is read-only).
- **Onboarding** — task-toggle / create / export.

### Tier 2 — Fabricated / mock data surfaced as real (violates the "no fake data" rule)
- **`integration.getSystemHealth`** returns hardcoded uptime 99.97 / latency 42ms / 3 connections as if real → return honest nulls or real metrics.
- **Learning** course progress = `Math.random()` (`course-catalog.tsx:110`).
- **Performance** OKR on-target/at-risk KPI split = invented ratios (`activeOkrs*0.53/0.32`).
- **Team-Intelligence** page = mostly `DEMO_*` arrays + `getBalanceAlerts`/`getRecommendedHires` throw `NOT_IMPLEMENTED` (the least-real module).

### Tier 3 — Big unbuilt features (net-new product scope)
| Priority | Feature |
|---|---|
| HIGH (core differentiator) | **Assessment Player** (`docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`, approved, slice 1 authoring shipped #65). Slices 2–4 unbuilt: candidate take-flow backend + UI + auto-scoring. **No scoring engine exists in TIMS** — `AssessmentResult` is only INGESTED via the external API (#74), never produced internally; **no band/norm/item-bank tables exist** (ties to the LIA gap). + **Wave 1.5b webcam proctoring** (deferred, own milestone). + Wave 3 `assessment-evaluator` agent for essay scoring (lights up `assessment.getExplainability`, currently honest 501). |
| MEDIUM | **360° Evaluations** (`docs/plans/2026-06-17-360-evaluations-greenfield.md`) — fully greenfield (no model/router/service), ~5–6 slices. *(Continuous peer feedback already exists + is real; the structured 360 cycle is what's missing.)* |
| MEDIUM | **Commitments** — backend real, UI read-only (no create form). |
| MEDIUM | **Candidate CV/resume upload + real CV→text extraction** (S3 + PDF/DOCX) — apply is text-only today, yet `parseCV` expects CVs. |

### Tier 4 — Infrastructure (deferred by design / scale-gated)
- **Background workers (`workers/`)** — empty one-line stub; no Trigger.dev jobs. Caps batch AI, async scoring, scheduled jobs (billing automation, data-retention purges). Emails/exports run in-process today.
- **Real export generation** — audit, candidate-pool CSV, DEI report are stubs returning fake statuses; no CSV/XLSX pipeline wired.
- **AI agents** — 22 of 32 catalog agents are pure stubs (`assessment-evaluator`, candidate-matcher, interview-question-gen, email-composer, etc.); `interview-fit-score` is **dead code** (implemented, no router → wire an endpoint or remove). Mock stubs to truth-up: pipeline `getNextBestAction`, candidate `getRecommendations`. Catalog `status` is hardcoded `'stub'` for all 32 even though 8 are live → drive from the registry.
- **Automated invoice generation + usage metering** — invoicing is MANUAL via `platform.createInvoice`; the AI add-on bills through it. `getUsage` returns null for storage/apiCalls (no metering source); plan limits not enforced; Stripe `invoice.*` webhooks not handled.
- **AI gateway microservice** (`services/ai-gateway`, Docker/ECS) — does not exist; in-process `packages/ai` door is the implementation.

### Tier 5 — External integration blockers
- **PCA auto-email read endpoints — MISSING** (active external blocker): the external service needs list-companies + list-candidates/results exposing **email + PcaCod + completion**. The `external` router exposes assessment results with `completedAt` only — **no email, no PcaCod, no companies/candidates listing**. See [[tims-pca-auto-email]].
- **LIA band/norm tables — MISSING** (ties to Assessment Player scoring + the nexa-platform LIA battery). See [[lia-assessment-gap-analysis]].
- **Google Calendar OAuth** for interviews (currently .ics only).
- **Real-time notifications** (websocket/SSE) for pipeline updates.

### Hygiene / recorded debt
- **ElevenLabs config**: the live gate (`routers/ai-interview.ts`) omits `ELEVENLABS_WEBHOOK_SECRET` (a missing secret → interviews run but never bill/analyze); the 3-var `lib/elevenlabs.ts` helper is dead. Consolidate; add EL vars to `.env.example` + `lib/env.ts`; rotate any committed secrets.
- **i18n stragglers** the scanner can't catch (precision-first): a handful of detector-missed literals (e.g. a `'Iniciar Sesion'`-class button) + 2 server→client conversions (`auth/layout.tsx`, `why-work-section.tsx`) made to use the hook; `global-error.tsx` keeps a hardcoded ES fallback (no `I18nProvider` in scope) — allowlisted.
- **Wave 2.5 follow-ups (recorded, not faked):** `data_access_logs` purge job + its `@@index([organizationId, createdAt])`; consent 30-day anonymization job (matrix-compliant deferral); shared Zod/const unions for dataType/action/consentType; `tims:perm:` legacy cache-prefix removal; candidate→employee role transition (needs product def); several accepted k-anonymity residuals (org-wide ratio denominators, `getBenefitsUtilization` head-count, `getEnps` div-guard artifact); tighten DEI/engagement tests toward behavioral.
- **Talent-pool mobile filter drawer** (filters hidden <md — deliberate tradeoff).
- **Honest-unavailable panels** awaiting backing features: external market salary feed (compensation), NLP service (climate wordcloud/sentiment).
- **Nine-box** grid is select-only (no drag-to-persist; "Simulador" is a declared backend stub).

---

## Remaining — blocked on user / product decisions
| Owner | Task |
|-------|------|
| TIMS/product | Trim audit/feature_flags/monitoring/organization from `hr_admin` allowlist (needs product confirm). |
| TIMS/product | Candidate self-service data deletion (right-to-erasure) — subject EXPORT exists; deletion is manual (backlog if product commits to self-service). |
| Federico | Phone re-test of the mobile sweep → report findings for surgical fixes. |

## Deferred by design (rule #9 — build for the trigger, not the dream)
- Presidio PII strip/re-inject (input sanitization + Bedrock Guardrails MASK cover today's scale).
- Supabase sa-east-1 migration; Prisma read replicas; pgvector (Phase 4+).
- Payroll/IT-provisioning integrations, external LMS, external eval vendors, custom connector SDK (per Architecture doc exclusions, Phase 10+).
