# Known Issues & Remaining Work

> Single backlog/status reference (rule #1: docs are code — update in the SAME PR as the change).
> Originally CLAUDE.md §9; truthed-up 2026-06-06 against the June 4–6 hardening/feature sessions (PRs #1–#41).

## DONE (June 2026 sessions — verified, not aspirational)

### Security
- [x] SQL injection in RLS middleware; IDOR fixes (user, onboarding, okrs, offer/interview/assessment parents)
- [x] **RLS tenant isolation LIVE** — migration `20260604100000`, fail-closed policy on 81 tables, `tenantDb` + `SET LOCAL ROLE app_tenant`, `RLS_ENFORCED=true` in prod, verified cross-org fail-closed (PRs #4–#9)
- [x] `hr_admin` denylist → **fail-closed allowlist** (20 modules) (PR #3)
- [x] **Turnstile CAPTCHA** on public `applyToVacancy` (env-gated, fail-closed) (PR #3)
- [x] **Nonce-based CSP** — prod drops `'unsafe-inline'`/`'unsafe-eval'` from script-src (PR #11)
- [x] Rate limiter → Upstash sliding window (tenant/user/expensive tiers)
- [x] Email HTML escaping (stored-XSS via public apply), offer-signing expiry, webhook secret redaction, open-redirect validation (PR #2)
- [x] 56 security tests → 103 total tests, CI grep-gates (any/raw-SQL/XSS/ts-ignore/eval/service_role/AI-door)

### AI (Phases 0–2)
- [x] **Single gated door** `invokeAgent`: budget(fail-closed $25 default)→cache(org-scoped TTL)→PII(sanitize+wrap+env-gated Bedrock Guardrails MASK)→circuit→Zod-validate→log (PRs #15–#19)
- [x] CI grep-gate + Vitest test enforce "no Bedrock outside `packages/ai`" (PR #19)
- [x] **cv-parser** (`candidate.parseCV`, text-based) + **candidate-screener** (`candidate.screen` → FitScore) wired through the gate (PRs #20–#21) + candidate-detail AI cards UI (PR #30)

### Architecture / quality
- [x] God components split (largest now ≤365 LOC); `platform.ts` split into sub-routers (PR #12 + prior)
- [x] Service layer live on candidate, pipeline, dei, candidate-ai, email, video, calendar — **standard for all new features**
- [x] Sentry (env-gated, source-maps pending token) + Pino structured logging; pino worker-thread fatal fixed (PRs #13, #14, #37)
- [x] Caching layer (`lib/cache.ts`, Upstash + in-mem fallback); permission checks cached 5 min w/ invalidation (PR #29)
- [x] Supavisor pooling in prod (`pooler.supabase.com:6543`, pgbouncer mode)
- [x] i18n complete: es/en parity 1802 keys, CI-guarded (PRs #24–#28)
- [x] DEI vertical slice live (EmployeeDemographics, aggregates-only, live-DB seeded) (PRs #22–#23)
- [x] 4 HR shells data-wired: compensation, climate, monitoring, integrations (PRs #25–#28)
- [x] **Full mobile sweep** — all ~35 routes + modals/wizards QA'd @390×844, zero overflow (PRs #31–#36, #38)
- [x] Vercel prod deploy + alias (tims-ats.vercel.app); Prisma serverless engine fix (PR #10)
- [x] Agentic tooling: `/gate` `/ship` `/mobile-qa`, CLAUDE.md→`.claude/rules/` split, prettier hook, allowlist (PRs #39–#41)

## Remaining — code work

| Priority | Task |
|----------|------|
| HIGH | **recruitment/analytics is fabricated** — zero tRPC calls, inline literal KPIs/funnel/trends (rule #4 violation, visible to TIMS). Wire to real aggregation endpoints. *(IN PROGRESS 2026-06-06)* |
| HIGH | Assessment completion interface — candidate-facing assessment UI (product map next feature) |
| MEDIUM | Wire next AI agents through the gate (25 of 32 still stubbed — interview-summarizer, interview-guide, bias-detector wired 2026-06-06; next picks need product input). Remaining mock stubs to truth-up: pipeline `getNextBestAction`, candidate `getRecommendations` |
| MEDIUM | Surface the interview AI endpoints in the UI (generate-guide / summary / bias buttons on interview detail — backend live, no consumers yet) |
| MEDIUM | Google Calendar OAuth for interviews (currently .ics only) |
| MEDIUM | Real-time notifications (websocket/SSE) for pipeline updates |
| LOW | Talent-pool mobile filter drawer (filters hidden <md — deliberate tradeoff) |
| LOW | Honest-unavailable panels await backing features: external market salary feed (compensation), NLP service (climate wordcloud/sentiment), platform telemetry (integrations system-health) |

## Remaining — blocked on user / product decisions

| Owner | Task |
|-------|------|
| Federico | **GitHub Actions billing** — every CI job fails in seconds; fix at github.com/settings/billing (merges currently use the local `/gate`) |
| Federico | GitHub Pro → enable branch protection on `main` (saved PUT call with 6 required checks ready) |
| Federico | Phone re-test of mobile sweep → report findings for surgical fixes |
| Federico | `SENTRY_AUTH_TOKEN` → readable stack traces (add to `apps/web/.env.sentry-build-plugin` + Vercel) |
| TIMS/product | Per-org `AiAgentOrgConfig` budgets (default fail-closed $25 cap applies until set) |
| TIMS/product | Trim audit/feature_flags/monitoring/organization from `hr_admin` allowlist (needs product confirm) |

## Deferred by design (rule #9 — build for the trigger, not the dream)

- Presidio PII strip/re-inject (input sanitization + Bedrock Guardrails MASK cover today's scale)
- Real CV file→text extraction (S3 + PDF/DOCX pipeline)
- Trigger.dev background workers
- AI gateway microservice (Docker + ECS) — in-process `packages/ai` door is the current implementation
- Supabase sa-east-1 migration; Prisma read replicas
