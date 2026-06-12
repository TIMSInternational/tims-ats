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

**Slice 2 SHIPPED (branch feat/access-endpoint-hardening): endpoint hardening.**
`notification.create`/`bulkCreate` → `permissionProcedure('notification','create')`
(was: any staffer could notify anyone — phishing vector); `organization.list*` →
`organization:read` (`getCurrent` deliberately stays protected — own-org lookup);
`engagement.submitSurveyResponse` → `engagement:create` + bounded answers record
(≤100 keys, ≤200-char keys, ≤5000-char strings; respondent identity was already
ctx-derived; duplicate submissions now map P2002 → CONFLICT instead of 500; the
caller-controlled `anonymous` flag was REMOVED — responses are always
identity-keyed);
ALL EIGHT dead staff-session portal stubs deleted (uploadDocument,
getMyAssessments, startAssessment, acceptOffer, declineOffer, updateProfile,
requestDataDeletion, submitNps — zero callers; live flows are candidatePortal +
/offers/sign/[token]; pre-completes the Wave 1.5a slice-2 stub removal);
server-side `/platform` layout gate (non-owners redirect to /dashboard before
render; checks the REAL identity; gate also denies while an impersonation cookie
is active (consistency with platformProcedure)). Static tripwire
tests in tests/access/endpoint-hardening.test.ts +
tests/security/platform-layout-gate.test.ts. Tests 282 → 298.

**Slice 3 SHIPPED (branch feat/access-scope-recruitment): scope enforcement —
recruitment.** `packages/api/src/access/entity-policies.ts` (`scopeWhereFor`:
vacancy team→OR(led-team ids, assignedTo); unit→businessUnitId∈units;
candidate via applications.some.vacancy — `some` is the invariant-#5 shape;
interview adds the evaluators-some panel arm; offer/application/
assessmentAssignment wrap the vacancy fragment; organization/company→`{}` =
the deploy-neutrality invariant) + `assertScoped` by-id ownership probe
(NOT_FOUND, entity-specific messages, soft-delete guard for vacancy/candidate)
+ `ledTeamIds` anchor. Wired through ALL SIX recruitment modules: vacancy +
interview + offer + assessment router-inline; candidate + pipeline threaded
router→service→repository (services take a required `scopeWhere` param — never
defaulted, a default would fail open). Child-id endpoints use fetch-then-probe
hops (org-scoped child → parent probe): offer validations/legal checks,
pipeline stages, proctoring sessions, candidate documents. Bulk endpoints
(bulkMove/bulkTag/compare) use deduped scoped count-checks. submitScorecard now
requires an ASSIGNED evaluator (slice-1 codex carry-over CLOSED). Public offer
token flows + assessment question bank deliberately untouched. Tests 298 → 358
(entity-policies behavior table + per-module AND-composition tripwires).

**Slices 4–7 pending** (each gets its own plan): 4 scope enforcement: people (own/team/unit live here) ·
5 role-aware UI (PermissionsProvider, filtered sidebars, page guards, AccessDenied) ·
6 sensitive-data layer (selectFor, +AUDIT data_access_logs, min-5 aggregates, consent) ·
7 new-role surfaces (hrbp unit admin, committee wiring, external API keys).

**⚠️ WAVE 2.5 DEPLOY-ORDERING (fail-open hazard — do NOT partially deploy):**
Code auto-deploys on merge (verified Jun 12: #67/#68 → prod deploys within
seconds of the main merge). Every slice is behavior-neutral pre-seed
(org-equivalent grants → `{}` fragments — prod's 104 legacy rows are all
scope `'all'`). RECRUITMENT scopes are enforced from slice 3; PEOPLE-module
narrow grants (employee compensation:read@own etc.) remain fail-open until
slice 4 lands — `seed-access.ts --apply` therefore stays FORBIDDEN until
slice 4 is merged+deployed. At wave-DATA deploy (after slice 4): (1) migration
`npx prisma db execute --file=packages/db/prisma/migrations/20260612000000_access_control_models/migration.sql`
(not yet run; the 3 new tables are dormant until narrow scopes exist);
(2) `npx tsx packages/db/prisma/seed-access.ts --apply` (review the DELETIONS
block of a dry-run first); (3) cache flush (`tims:access:*`). Until the seed
runs, every legacy role — INCLUDING hr_admin — works through the build.ts
compat mapping over the 104 existing `'all'`-scope rows (verified against prod
Jun 12: hr_admin has 32 rows; the earlier "hr_admin breaks without the seed"
claim assumed zero rows and was wrong).

**Wave 2.5 follow-ups (recorded, not faked):** `data_access_logs` purge job + the
`@@index([organizationId, createdAt])` it needs (add WITH the job); shared const/Zod
unions for dataType/action/consentType values when the writers land (slice 6); consent
30-day anonymization job; field-level encryption (separate security wave); candidate→
employee role transition (needs product definition); `tims:perm:` legacy cache-prefix
removal after deploy.
Slice-2/3 review carry-overs: scoped `organization:read` grants for
recruiter/hrbp/leader must be added to seed-access.ts WHEN a later slice
introduces team/unit picker dropdowns (today only hr_admin/super_admin hold it —
a future picker 403 would be a seeds gap, not a regression); the submit endpoint
no longer accepts an `anonymous` flag (codex: userId NULL bypassed the @@unique
dedup — ballot-stuffing); responses are always identity-keyed and
display-anonymity + targetGroups enforcement land with the slice-6
aggregation/anonymity layer (respondentKey hash if product wants true stored
anonymity); candidate self-service
data deletion (right-to-erasure) lost its last code marker with the
requestDataDeletion stub — platform-side subject EXPORT exists, deletion is
manual (backlog if product commits to self-service); NPS submission has no
backing feature anymore (deleted submitNps stub was its last trace).
Slice-3 carry-overs: `recruitment-analytics` module aggregates stay org-scoped
(no per-resource input; scope-aware analytics = later slice, flagged by
quality review); narrow-scope WRITE semantics (may a team-scope leader create
vacancies outside their team?) = slice-4 write-rules — create endpoints are
deliberately unprobed (no target row); child-existence oracle on
fetch-then-probe hops (a narrow-scoped caller can distinguish "out-of-scope
parent has child X" vs "has none" via NOT_FOUND message differences) =
accepted uniform tradeoff, revisit only if id-enumeration becomes a concern;
applyToVacancy duplicate application still surfaces raw P2002 (pre-existing,
@@unique exists — map to CONFLICT in a cleanup pass).

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
