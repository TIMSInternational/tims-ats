# Known Issues & Remaining Work

> Single backlog/status reference (rule #1: docs are code — update in the SAME PR as the change).
> Originally CLAUDE.md §9; truthed-up 2026-06-06 (PRs #1–#41), then 2026-06-08 (PRs #43–#53 + Bedrock guardrail).
> **`docs/PRODUCT-MAP.md` is STALE — this file is canonical for status.** Roadmap detail: the build roadmap (5-agent audit, Jun 8) tracks Waves 0–4.

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

### June 8 session — analytics, AI agents, Wave 0 integrity, platform console 100%, guardrail
- [x] **recruitment/analytics data-wired** — was fabricated (inline literal KPIs); now real aggregation endpoints (TTF/TTH, accept rate, funnel, sources, trend, SLA) (PR #43)
- [x] **Interview AI agents** through the gate: interview-summarizer, interview-guide, bias-detector (PR #44)
- [x] **Wave 0 integrity** — 5 fake-AI endpoints + fake billing usage + mock Stripe-esign stubs → honest `NOT_IMPLEMENTED`/real counts (PRs #45–#46)
- [x] **Platform console → 100%** — real password reset, AI per-org budget editor, audit JSON export + org filter, honest health panel, GDPR/Habeas-Data subject export, REAL signed-cookie impersonation (PRs #47–#50)
- [x] **MFA/TOTP** for platform owners + super_admins — Supabase Auth MFA, `/mfa` enroll+step-up, enforcement gate (env-flag `MFA_ENFORCED`, default off, fail-open flag/fail-closed gate) (PR #51)
- [x] **Alert-rule evaluation backend** — Vercel cron `/api/cron/evaluate-alerts` (fail-closed `CRON_SECRET`), per-org metric engine (6 real metrics), + rule-config UI replacing "coming soon" (PR #52)
- [x] **Session force-logout** — `platform.forceLogoutUser` revokes a user's Supabase sessions (auth.sessions delete), surfaced in support console (PR #53)
- [x] **Bedrock Guardrail wired** — `tims-ats-pii` (us-east-2) ANONYMIZE financial/SSN-class PII (not name/email/phone — cv-parser must extract those); `BEDROCK_GUARDRAIL_ID`/`_VERSION` set in Vercel → MASK defense-in-depth ACTIVE
- [x] Tests 103 → **141**

## WAVE 2.5 — Full access-control layer (design: docs/WAVE-2.5-ACCESS-CONTROL.md)

**Slice 1 SHIPPED (branch feat/access-engine): engine + schema + seeds + middleware.**
`packages/api/src/access/` (resolveAccess deny-by-default kernel w/ union/widest stacking
+ malformed-scope rejection; request-local anchor loader team/unit/panel), 3 new RLS'd
models (UserBusinessUnit, DataAccessLog, DataConsent) + migration `20260612000000`,
reconciling `seed-access.ts` (9 roles × full scoped matrix; DRY-RUN default), middleware
rewrite (`ctx.access` injection; **HR_ADMIN_MODULES allowlist DELETED** — hr_admin is
DB-checked; privileged users get explicit org-scope decisions; org-less platform owner
on tenant modules → BAD_REQUEST; **org-bearing platform owners now run under the RLS
GUC** — was silently unscoped/BYPASSRLS). 281 tests. AND-composition tripwire in CI.

**Slices 2–7 pending** (each gets its own plan): 2 endpoint hardening (ungated
notification.create/bulkCreate, organization.list*, dead portal stubs, /platform server
gate) · 3 scope enforcement: recruitment (entity policy builders) · 4 scope enforcement:
people (own/team/unit live here) · 5 role-aware UI (PermissionsProvider, filtered
sidebars, page guards, AccessDenied) · 6 sensitive-data layer (selectFor, +AUDIT
data_access_logs, min-5 aggregates, consent) · 7 new-role surfaces (hrbp unit admin,
committee wiring, external API keys).

**⚠️ WAVE 2.5 DEPLOY-ORDERING (fail-open hazard — do NOT partially deploy):**
the new matrix's own/team/unit grants (employee compensation:read@own etc.) behave
**org-wide** under scope-ignorant code — repos only compose scope filters from slice
3-4 onward. Therefore: (1) `seed-access.ts --apply` MUST NOT run against prod until
slices 1–4 deploy TOGETHER; (2) at wave deploy, order is: migration
(`npx prisma db execute --file=packages/db/prisma/migrations/20260612000000_access_control_models/migration.sql`)
→ `npx tsx packages/db/prisma/seed-access.ts --apply` (review the DELETIONS block of a
dry-run first) → code deploy. The allowlist deletion needs hr_admin's seeded grants
present or hr_admin breaks (fail-closed). Slice-1 code WITHOUT the seed: legacy
'all'-scope roles keep working via the build.ts compat mapping (behavior-neutral);
hr_admin breaks fail-closed (allowlist gone, no rows) until the seed runs. Narrow
(own/team/unit) grants MUST NOT be seeded before slices 3-4 enforce them (fail-open).
In practice: hold the whole wave; deploy order migration → seed --apply → cache flush
→ code.

**Wave 2.5 follow-ups (recorded, not faked):** `data_access_logs` purge job + the
`@@index([organizationId, createdAt])` it needs (add WITH the job); shared const/Zod
unions for dataType/action/consentType values when the writers land (slice 6); consent
30-day anonymization job; field-level encryption (separate security wave); candidate→
employee role transition (needs product definition); `tims:perm:` legacy cache-prefix
removal after deploy.

## Remaining — code work

| Priority | Task |
|----------|------|
| **SECURITY / HIGH** | **Staff/candidate auth boundary — email-based account linking** (codex adversarial review, Wave 1 Slice 2). Four sites recognize/link a staff `User` to a Supabase identity BY EMAIL: the tRPC context builder (`apps/web/app/api/trpc/[trpc]/route.ts`), `/auth/callback`, `(admin)/layout.tsx`, `(admin)/dashboard/page.tsx`. Invited staff rows are created with `supabaseUserId: ''` (`user.ts:128`), and `User.email` is unique only **per org**, so a verified Supabase session (incl. a candidate portal magic-link, or a cross-tenant collision) whose email matches an unclaimed staff row can be promoted into that staff role. The context-builder link is ALSO load-bearing: password-login staff (`signInWithPassword`, which skips `/auth/callback`) get linked there — so it can't simply be removed (would strand staff). **Fix = dedicated PR**: invitation/onboarding-token-based linking that verifies email + org + unclaimed-row state, never overwrites an existing `supabaseUserId`, applied consistently across all four sites, with staff password/recovery + candidate-collision regression tests. Slice-1 added a claim-only guard (blocks re-pointing an already-claimed row) but the unclaimed-`''` path remains open. |
| HIGH | **Wave 1 — Authenticated candidate portal** (chosen portal-first, Jun 8): passwordless magic-link/OTP candidate session + dashboard (My Applications + stage timeline, My Interviews + join link, My Offer → links to existing `/offers/sign/[token]`). **Slice 1 (auth + /me shell) + Slice 2 (`candidateProcedure` + My Applications + stage timeline) SHIPPED.** Remaining: Slice 3 (My Interviews + join link), Slice 4 (My Offer → `/offers/sign/[token]`). See `docs/WAVE-1-CANDIDATE-PORTAL.md`. |
| HIGH | **Wave 1.5 — Assessment completion ("Player")** — PRODUCT-MAP Priority 2 / core differentiator. ENTIRE backend missing: no question/response/submit/scoring schema. Includes **full webcam proctoring** (ProctoringSession, Habeas-Data consent, review UI). Deferred after Wave 1 per Jun 8 decision. |
| MEDIUM | Wire next AI agents through the gate (22 of 32 still stubbed; cv-parser, screener, interview-summarizer/guide/bias-detector live). Remaining mock stubs to truth-up: pipeline `getNextBestAction`, candidate `getRecommendations` |
| MEDIUM | Surface the interview AI endpoints in the UI (generate-guide / summary / bias buttons on interview detail — backend live, no consumers yet) |
| MEDIUM | Google Calendar OAuth for interviews (currently .ics only) |
| MEDIUM | Real-time notifications (websocket/SSE) for pipeline updates |
| LOW | Talent-pool mobile filter drawer (filters hidden <md — deliberate tradeoff) |
| LOW | Honest-unavailable panels await backing features: external market salary feed (compensation), NLP service (climate wordcloud/sentiment), platform telemetry (integrations system-health) |

## Remaining — blocked on user / product decisions

| Owner | Task |
|-------|------|
| Federico | **Activate MFA** — enroll a TOTP factor at `/mfa`, then set `MFA_ENFORCED=true` in Vercel prod to enforce 2FA for platform owners + super_admins (built but off by default so it can't lock you out) |
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
