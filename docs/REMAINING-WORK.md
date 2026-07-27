# Known Issues & Remaining Work

> Single backlog/status reference (rule #1: docs are code — update in the SAME PR as the change).
> **Truthed-up 2026-07-25 against HEAD `main` (commit `27249b18a3f92460f5a3b0f0841e0eb70c6e183f`, the docs
> commit immediately after PR #194)** — this truth-up covers PRs #97–#194 (2026-06-30 → 2026-07-25): the
> C# backend strangler-fig migration (Phases 1–5, in progress) and the CB-1/1b/1c/2a/2b compliance work.
> Supersedes the 2026-06-29 truth-up (PR #96, commit `5115a83`), which predates the C# migration entirely —
> that prior version did not mention it at all.
> **Partial truth-up 2026-07-27 (Phase-5 section only — everything else in this doc is still dated
> 2026-07-25, not re-verified in this pass):** PRs #195–#212 shipped the C# audit-log (Slice-17, #195) and
> access-review (Slice-18, #196) backend ports, AND — a previously undocumented layer — dark FE/TS
> cutover-prep wrappers (`apps/web/lib/platform-api/*.ts` + 2 server-side proxies) for ALL 12 read domains
> and ALL 8 write-capable domains, gated behind their own `NEXT_PUBLIC_<DOMAIN>_{READ,WRITE}_VIA_CSHARP`
> flags. See the Phase-5 bullet below for detail; this closes out ALL AI-doable FE/API cutover-prep work —
> what remains is the per-domain flag-flip/canary/delete-TS cycle itself (Federico-only).
> **`docs/PRODUCT-MAP.md` is STALE — this file is canonical for status.** Per-feature detail lives
> in the wave/spec docs cited below, and — for the C# migration specifically — in
> `docs/architecture/csharp-migration/00-master-plan.md`, `phase-5-strangler.md`, and
> `docs/architecture/table-ownership.md` (the authoritative per-table/per-domain ledger).

---

## ✅ DONE (verified in code + prod, not aspirational)

Detail for each lives in its wave/spec doc; this is the scannable status roll-up.

### Platform foundation

- **Security:** RLS tenant isolation LIVE (`RLS_ENFORCED=true`, fail-closed policies); SQL-injection/IDOR fixes; `hr_admin` fail-closed allowlist; Turnstile on public apply; nonce CSP; Upstash rate limiting; CI grep-gates (any/raw-SQL/XSS/ts-ignore/eval/service_role/AI-door). (PRs #2–#11)
- **AI safety:** single gated door `invokeAgent` (fail-closed budget → cache → PII sanitize + Bedrock Guardrails MASK → circuit breaker → Zod-validate → usage log); CI + vitest enforce "no Bedrock outside `packages/ai`". (PRs #15–#19, guardrail wired #53)
- **Architecture:** Router→Service→Repository standard; god-components split; Sentry (token pending) + Pino; caching layer; Supavisor pooling; mobile sweep (~35 routes @390×844); Vercel prod + alias.
- **MFA/TOTP** for platform owners + super_admins (built; `MFA_ENFORCED` off by default). (PR #51) — CB-2a (PR #148) later closed the tRPC + impersonation enforcement-path bypass; see Compliance-by-design below. The flag itself is still off in prod — see Tier 0.
- **Platform console → 100%** (real reset, AI budget editor, audit export, signed-cookie impersonation, GDPR/Habeas-Data export, force-logout, alert-rule cron engine). (PRs #47–#53)

### C# Backend Migration — Phases 1–4 COMPLETE; Phase 5 (strangler) IN PROGRESS, built + parity-verified + DARK

Master plan: converge the backend fully onto C#/.NET via a 7-phase strangler-fig migration
(`docs/architecture/2026-07-15-csharp-backend-target-architecture.md` is the what/why;
`docs/architecture/csharp-migration/00-master-plan.md` is the how/when/order/gates). Frontend stays
Next.js/React; `ai-gateway` stays a separate polyglot inference service by design — never migrated.
Verified directly in code (`services/Tims.Platform/src/Tims.Api/Program.cs`): every Phase-5 route below is
wrapped in `if (options.<X>Enabled || isOpenApiDocGeneration) { ... }`, defaulting `false`.

- **Phase 1 — runway + spikes — DONE.** `Tims.Platform` C# solution scaffolded; Spike A proved EF Core can
  hold Postgres RLS/GUC under Supavisor transaction-pooling (Testcontainers); Spike B proved the TS and C#
  authz kernels agree on the same golden fixtures. Table-ownership ledger (`docs/architecture/table-ownership.md`) and its CI enforcement are live. (PR #132)
- **Phase 2 — identity/auth plane — DONE.** C# validates Supabase JWTs (ES256, exp/iss/aud/JWKS) and `tims_`
  API keys; resolves all 4 principal types (platform-owner/org-user/candidate/external-key) + impersonation;
  permission/scope (RBAC) parity; rate-limiting on shared Redis keys. (PRs #133–#136)
- **Phase 3 — first real domain, HRIS — DONE, greenfield.** HRIS is the first EF-owned product domain
  (`hris_*` tables, RLS-wrapped) — the proof the C# stack delivers value before any working TS domain is
  touched. (PR #137)
- **Phase 4 — C# workers — DONE.** `Tims.Workers` host + Quartz scheduler + resilient-job framework running
  a recurring HRIS sync job; Slice 2 added a clustered/persistent Quartz ADO(Postgres) store for scheduler HA
  (dark behind `Workers:ClusteredSchedulerEnabled` — needs Federico to apply the DDL + flip it). (PRs #138, #152)
- **Phase 5 — strangler (migrate working domains one at a time) — IN PROGRESS.** Per
  `docs/architecture/table-ownership.md` (the authoritative ledger), every domain below is at the SAME
  stage — C# read and/or write surface implemented, golden-parity fixtured against TS, RLS/RBAC-proven in
  Testcontainers, **FLIP-READY** — but deployed dark behind a feature flag defaulting `false`. TS remains the
  sole active reader/writer of every one of these tables in prod today:
  - External-vendor assessment — read (#139) + write (#140); the staff `updateValidation` write (#151) made
    BOTH writers C#, so this table is FLIP-READY.
  - Billing — invoice read (#141) + usage/plan/config read (#142) + Stripe-webhook write (#145) + tenant
    self-serve billing (#146).
  - Reporting / recruitment-analytics — read (#150).
  - Team-intel — read (#153). **CONFIRMED FLIPPED AND LIVE in prod** (2026-07-27, verbal confirmation from
    Federico) — `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP=true` in Vercel prod and `Platform:TeamIntelReadEnabled=true`
    on App Runner. This is the ONE exception to "TS remains the sole active reader" above and to the "NOT DONE
    for ANY domain" note below — `dashboard-kpis` and the rest of the team-intel reads are served by C# today.
    The flip attempt is visible in the repo as commit `49c74d3` (CORS, #183) and commit `cf83fba` (CSP fix,
    #184) on 2026-07-24; neither the flag value nor the App Runner env config is committed to git, so this
    status can only be confirmed by asking, not by reading the repo — now confirmed.
  - Evaluation360 — read (#158) + write (#170).
  - Succession — read (#160) + write (#171).
  - Compensation — FX-free read (#162) + FX-gateway/FX-dependent reads (#168) + write (#169).
  - Nine-box — read (#164) + calibration write (#172).
  - Engagement — read (#166) + write (#173).
  - DEI — read (#167).
  - Audit-log (Phase-5 Slice-17) — read (#195). Dark; the C# service has never been independently
    deployed, so this has no live traffic either way.
  - Access-review (Phase-5 Slice-18) — read + write (#196). Platform-owner-only, fixed-org-id surface;
    **zero FE consumers in either stack** (no UI page exists to cut over) — will stay dark until a UI is
    scoped, independent of the flip-readiness of every other domain.
  - **Cutover-verification harness** (`scripts/parity/`, PRs #177–#194): a TypeScript CLI proving
    parity/RLS/RBAC for each surface against the real Supabase prod DB before any flag flips.
  - **FE/TS dark-cutover wrapper layer (2026-07-27, PRs #197–#212) — now fully COMPLETE, both reads and
    writes.** A previously-undocumented layer distinct from the backend PRs above: every domain's tRPC
    consumers can now route through the C# service one flag at a time. READS — all 12 domains (external-
    vendor, billing, reporting, team-intel, evaluation360, succession, compensation, nine-box, engagement,
    DEI, audit-log, FX-dependent compensation/DEI reads) have a dark `useX()` hook per read, mirroring the
    exact tRPC output type. WRITES — all 8 write-capable domains (external-vendor, evaluation360,
    succession, nine-box, compensation, engagement, billing-webhook, billing-self-serve) have a dark
    `useXMutation()` hook per write MUTATION THAT HAS A LIVE FE CALL SITE — several procedures per domain
    (e.g. succession's `addCriticalRole`, engagement's `createActionPlan`) have zero consumers and were
    intentionally left unwrapped (dead code otherwise). The billing Stripe-webhook write is a proxy inside
    `packages/api/src/services/billing-webhook.service.ts`, not a browser wrapper — Stripe calls the Next.js
    route directly, so the flag lives entirely server-side. A real bug was found and fixed in this pass
    (#212): the browser `PlatformApiError` never surfaced the C# error response body's `message` field,
    only a generic placeholder — any consumer checking specific backend error text would have silently
    broken once a write flag flipped live. Fixed before any write domain's flag actually flips.
  - **First C# prod deploy** — AWS App Runner (Terraform IaC, PR #157; Gate-G3 runbook, PRs #154/#174). A
    2026-07-27 prep pass (`docs/architecture/csharp-migration/PROD-DEPLOY-PREP-2026-07-27.md`, PR #201)
    verified the Docker image builds and runs locally against the runbook's exact steps, and drafted the
    compliance-SQL/MFA-timing/DB-role decisions — but **explicitly executed none of it against real
    infrastructure** (Federico-only: DB password rotation, the 3 SQL files, `aws ecr`/App Runner itself).
    _(RESOLVED 2026-07-27: the EARLIER deployment attempt — commits `cf83fba`/`1606118`/`49c74d3`, 2026-07-24 —
    was the team-intel read flip; Federico confirmed it completed and is still live in prod. This does NOT
    mean the broader App Runner deployment is otherwise fully verified/stable — only that this one specific
    surface is confirmed receiving live traffic.)_
- **DONE for exactly ONE domain (team-intel read, see above); NOT DONE for the other 12 pieces — do not
  overstate the rest as shipped.** The production ownership flip (recipe step 6) and TS-code deletion (step 7)
  have not happened for any OTHER domain as of this truth-up — team-intel's read is C#-live, but its TS
  `teamIntel`/`team-intel-metrics` router has NOT been deleted (step 7 is still pending even for the one
  flipped surface), and `okrs`/etc. correctly stay `efcoreReadOnly` (not `efcore`) in the ownership ledger
  since a READ flip never transfers DDL ownership. Flipping a domain's flag in prod is explicitly
  **Federico-only, at canary** (`docs/superpowers/plans/2026-07-24-cutover-verification-harness.md`) — a
  manual owner decision, made for team-intel's read surface only. "Built + parity-verified + dark" is still
  the correct description for the other 12 read/write pieces; don't generalize team-intel's exception to them.

### Compliance-by-design — CB-1/1b/1c/2a/2b — **SHIPPED** (`docs/architecture/compliance/00-compliance-by-design-roadmap.md`)

First slices of the SOC 1 Type II / SOC 2 Type II / ISO 27001 engineering control backlog (Federico directive
2026-07-17). Prod DDL/secrets remain Federico-run; app-layer controls are live.

- **CB-1 — audit-log tamper-evidence** (`data_access_logs`, PR #143): insert-only DB trigger + `REVOKE UPDATE/DELETE` from `app_tenant` — the sensitive-read/export audit trail is now append-only at the database, not just by writer discipline.
- **CB-1b — `audit_logs` immutability** (PR #144): the twin control for the admin/security-event ledger (all
  20 `db.auditLog.create` call sites) — same insert-only trigger + revoke. _(Documented FK-cascade caveat:
  org/user hard-delete is blocked while immutable — no such delete path exists today, so this is safe, but
  it's a recorded follow-up if one is ever added.)_
- **CB-1c — security-event audit coverage** (PR #147): the previously-UNLOGGED events now write to the
  (now-immutable) trail in the live app — authN failures (`login_failed`), authZ denials
  (FORBIDDEN/UNAUTHORIZED throws in `trpc.ts`), role/permission grant edits, feature-flag bulk ops,
  platform-owner cross-org reads/exports.
- **CB-2a — MFA enforcement depth** (PR #148): closes the tRPC + impersonation-cookie MFA bypass — a
  privileged principal could previously reach protected procedures or start an impersonation session without
  MFA even when `MFA_ENFORCED=true`. **This is a different concern from the Tier-0 "MFA enforce" line below**:
  CB-2a fixed the _enforcement path_; flipping `MFA_ENFORCED=true` in prod (the actual go-live decision) is
  still open and owner-only — see Tier 0.
- **CB-2b — access-review + recertification tooling** (PR #149): users×roles×grants×last-login report +
  a per-org quarterly recertification workflow (audited export, attestation, expired/cross-org flags).
- **Not yet built** (recorded in the roadmap, not started): CB-3 (CloudTrail/GuardDuty + centralized log
  shipping), CB-4 (Terraform/CDK IaC — partially seeded by the C# migration's App Runner Terraform, PR #157; the CI-billing-bypass change-mgmt fix is still open, see Tier 0), CB-5 (Dependabot/pen-test), CB-6 (retention and erasure automation), CB-7 (backup-restore tests/DR runbook), CB-8 (continuous-compliance evidence export).

### Wave 2.5 — Access control — **COMPLETE + LIVE IN PROD** (`docs/WAVE-2.5-ACCESS-CONTROL.md`)

- All 7 slices shipped (PRs #67–#74): deny-by-default kernel, endpoint hardening, scope enforcement (recruitment + people), role-aware UI, sensitive-data k-anonymity (min-5, codex-hardened 14 rounds), membership admin, **external API-key auth (7b, #74)**.
- **✅ Wave-DATA deploy IS APPLIED in prod** (verified 2026-06-29 by direct query): the `seed-access --apply` matrix ran — 9 roles with correct scoped grants (super*admin/hr_admin/recruiter/external→`organization`, hrbp→`unit`, leader/committee→`team`, employee→`own`) replicated across all 11 orgs (98 permissions × roles); legacy recruiter over-grants (`offer:approve`, `vacancy:approve`) removed. The role matrix is genuinely enforced. *(The prior doc's "seed not yet run" note was stale.)\_

### Role-native experience — **COMPLETE** (`docs/ROLE-EXPERIENCE-REBUILD-SPEC.md`)

- Slices 0–4 shipped (PRs #75–#80 + follow-ups #81–#90): manifest-driven IA, all 7 org roles + platform_owner have distinct purpose-built tRPC-backed shells + landings; impersonation propagates effective identity to RSCs (#83).

### Recruitment ATS (the spine) — **REAL**

- Pipeline, vacancies, candidates, interviews, assessment _authoring_, offers, talent pools, recruitment analytics — all functional with working mutations.

### Candidate portal — **REAL** (`docs/WAVE-1-CANDIDATE-PORTAL.md`)

- Job board, apply (Turnstile), magic-link login, status dashboard (My Applications/Interviews/Offers + timelines), offer e-signing. (Slices 1–4)
- **Staff/candidate auth boundary RESOLVED** — token-based linking (B2), `docs/SECURITY-staff-candidate-auth-linking.md`. _(Prior doc listed this as an open SECURITY/HIGH; it shipped 2026-06-10.)_

### AI Voice Interview (ElevenLabs) — **COMPLETE** (specs 2026-06-24/26/28)

- Live conversational pre-screen (Slice 1, #92), Zoom-style call redesign (#94), **paid per-org add-on + per-type duration caps (#95)**. Gated, billed (frozen per-minute usage + add-on fee), platform-admin controlled. Ships dark per org until enabled.

### i18n enforcement — **COMPLETE** (#96, `tests/security/i18n-no-hardcoded-strings.test.ts`)

- Absolute vitest gate blocking hardcoded user-facing strings in `apps/web` (CI Security-Audit + local `/gate`). ~393 hardcoded strings across 86 files swept to `t.*` (both locales). _(The prior doc's "i18n complete, 1802 keys" was inaccurate — strings were leaking; now genuinely enforced.)_ See [[tims-i18n-enforcement]].

### 8 live gate-wired AI agents

- cv-parser, candidate-screener, vacancy-writer, inclusive-language, interview-guide, interview-summarizer, bias-detector, ai-voice-interview. Interview AI endpoints surfaced in the room UI (#89).

---

## 🔧 REMAINING — by tier (effort × impact)

### Tier 0 — Operational flips & config (cheap, high-leverage; mostly owner-action)

| Owner        | Item                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Federico     | **Stripe go-live** — set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_STARTER` + `STRIPE_PRICE_PROFESSIONAL` (latter two missing from `.env.example`), register webhook, configure Billing Portal. Code is complete + verified in test mode (`docs/WAVE-2-STRIPE-BILLING.md`); dormant until keys set.                                                                                               |
| Federico     | **`DAILY_API_KEY`** — human video interviews (`interview.createVideoRoom`) now fail closed with a clear provider-config error and `.env.example` documents the required Daily.co vars. The prod/local Daily key checked on 2026-07-14 reached Daily but returned `authentication-error`, so it must be replaced with a valid key. The AI voice interview uses ElevenLabs and is unaffected. |
| Federico     | **Fix Bedrock payment instrument (AWS acct 747814092517)** — Sonnet 4.5 Marketplace subscription can't activate; 5 analysis agents (interview-summarizer/guide, bias-detector, interview-fit-score, candidate-screener) are downgraded to Haiku 4.5 as a stopgap. Restore to Sonnet in `registry.ts` once billing clears.                                                                   |
| Federico     | **MFA enforce** — enroll TOTP at `/mfa`, set `MFA_ENFORCED=true` in Vercel prod. _(CB-2a, PR #148, already closed the tRPC + impersonation enforcement-path bypass, so this item is now narrower than before: it's purely the go-live flag flip, not a code gap.)_                                                                                                                          |
| Federico     | **GitHub Actions billing** — every CI job fails in ~3-11s (0 steps executed); merges use admin-override + local `/gate`. Now 14 consecutive PRs forced through this way (#195–#212, 2026-07-27) — well past the point of coincidence, worth fixing soon. Fix at github.com/settings/billing.                                                                                                |
| Federico     | Branch protection on `main` (6 required checks ready); `SENTRY_AUTH_TOKEN` for readable stack traces.                                                                                                                                                                                                                                                                                       |
| TIMS/product | **Per-org `AiAgentOrgConfig` budgets** — a fail-closed $25/mo cap applies until set (AI silently stops at the cap).                                                                                                                                                                                                                                                                         |
| TIMS/product | **ai-voice-interview activation** per org (platform admin → AI Agents → Orgs: enable + `billableUsdPerMinute`/`addonMonthlyFeeUsd`/caps).                                                                                                                                                                                                                                                   |

### C# Backend Migration — remaining work (see DONE section above for what's built)

| Owner          | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Federico       | **Per-domain production ownership flip** — 13 Phase-5 domains (external-vendor, billing invoice/usage/webhook, reporting-analytics, team-intel, evaluation360, succession, compensation, nine-box, engagement, DEI, FX-gateway, audit-log, access-review) are built + parity-verified + FLIP-READY per `table-ownership.md`, and (as of 2026-07-27) EVERY domain's FE/TS dark-cutover wrapper is ALSO built for both reads and writes — the flip is purely an infra/ops decision now, no more app code is blocking it. Flipping a domain (dark → canary → full via `scripts/parity/cli.ts verify <surface>`), then moving its tables to `efcore` in the ledger and deleting the TS logic, is a manual, per-domain, canary-gated decision. **None has been flipped in prod as of this truth-up.** |
| Federico       | **Scheduler HA** — `Workers:ClusteredSchedulerEnabled` needs the Quartz ADO(Postgres) DDL applied in prod + the flag flipped (Phase 4 Slice 2, PR #152; currently RAMJobStore, single-replica).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Federico       | **DB-enforce audit insert-only** (`docs/architecture/table-ownership.md` "Security follow-up" section) — `data_access_logs` is append-only by C# writer discipline only, not yet by DB grant/trigger; a prod migration to `REVOKE UPDATE, DELETE` + add a guard trigger is documented but not applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| — (unclaimed)  | **Audit/compliance domain as its own Phase-5 slice** — the audit writer is already cross-cutting (Phase-2 WP2.7 + CB-1/1b/1c), but it hasn't been formalized as a discrete strangler domain per the recommended order in `phase-5-strangler.md`. No sub-plan exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| — (unclaimed)  | **Candidate pipeline state machine** — `phase-5-strangler.md`'s recommended order deliberately saves this for later ("more cross-cutting… do it once the pattern is proven"). No sub-plan exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TIMS/product   | **Phase 6 — Team Suite integration** — blocked on the intake study of the Azure DevOps `tims.configuration.core` repo (auth/tenant/DB model + module classification, `phase-6-team-suite.md`); no work package can start before it lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| — (structural) | **Phase 7 — retire TS backend + consolidate** — not started; explicitly gated on Phase 5 finishing every targeted domain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Tier 1 — Last-mile UI wiring — **DONE (PR #98, 2026-06-29)** (`docs/superpowers/specs/2026-06-29-tier1-last-mile-wiring-design.md`)

The mutations were real but no UI invoked them; all wired via shared modal pattern (useState + `Modal` + tRPC + invalidate + i18n). Shipped + live in prod:

- **Succession** — Add Successor (`addSuccessor`). ✅
- **Engagement** — Create + Launch Survey (`createSurvey` + new `activateSurvey` draft→active). ✅
- **Learning** — Enroll per-course (`enrollUser`). ✅ _(enrollment "complete" deferred — needs an admin enrollment-list view; no surface exists yet.)_
- **Compensation** — Approve/Reject adjustment (`approveAdjustment`, atomic). ✅
- **Performance** — Create OKR / Commitment / Log Coaching session (`createOkr`/`createCommitment`/`createCoachingSession`). ✅
- **Onboarding** — Create Plan (`onboarding.create`) + inline task toggle (`updateTask`). ✅
- Out of scope (still open): Export buttons (Tier 4 CSV infra), Simulate stubs (Tier 2/sim).

### Tier 2 — Fabricated / mock data surfaced as real — **DONE (branch `feat/tier2-honest-data`, 2026-06-29)** (`docs/superpowers/specs/2026-06-29-tier2-honest-data-design.md`)

Honest-hybrid pass: real metric where data exists + cheap; honest `N/D`/`EmptyState` otherwise; fabricated trend chips deleted.

- **Platform Health** (`system.helpers.ts`) — full honesty pass (was ~8 fabricated metrics, not just the 3 the prior doc named): real DB latency (dropped the `×3` fudge); uptime / storage / DB-connections / background-jobs / AI-Bedrock / email / realtime → `N/D`; fake progressBars removed; page banner `99.97%` → `N/D`. ✅
- **Learning** course progress — `Math.random()` (`course-catalog.tsx`) replaced with the REAL per-course avg of `Enrollment.progress` (`listCourses` groupBy). ✅
- **Team-Intelligence** — `DEMO_ALERTS`/`DEMO_HIRES` panels → honest `EmptyState` ("disponible con el agente de IA"); KPIs now real `avgTenureYears` + `diversityIndex` (`getDashboardKpis`); PCA-balance + avg-performance → `N/D`; fabricated trend chips + `?? 12` fallback removed; diversity KPI honestly relabeled (was mislabeled "Shannon index"; the real calc is uniqueRoles/count). ✅
- ~~Performance OKR on-target/at-risk split (`activeOkrs*0.53/0.32`)~~ — **was never real**: no such fabricated split existed in code; `performance.getDashboardKpis` already returns a real active-OKR count + real average progress. Prior doc entry was inaccurate; nothing to fix.
- **Deferred (honestly labeled `N/D`/empty, NOT faked):** email-from-`auditLog` aggregate, avg-performance aggregate (Feedback/Recognition/OKR), Supabase storage/uptime/realtime real sources, AI-usage reuse on the health page, and the Wave-3 DISC competency model behind balance-alerts/recommended-hires. Other still-fabricated KPIs to sweep next: succession-kpis `?? 12` fallback; a `'Tecnologia'` hardcoded label on the team-intel page.

### Tier 3 — Big unbuilt features (net-new product scope)

| Priority                   | Feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH (core differentiator) | **Assessment Player** (`docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`, approved, slice 1 authoring shipped #65). Slices 2–4 unbuilt: candidate take-flow backend + UI + auto-scoring. **No scoring engine exists in TIMS** — `AssessmentResult` is only INGESTED via the external API (#74), never produced internally; **no band/norm/item-bank tables exist** (ties to the LIA gap). + **Wave 1.5b webcam proctoring** (deferred, own milestone). + Wave 3 `assessment-evaluator` agent for essay scoring (lights up `assessment.getExplainability`, currently honest 501). |
| MEDIUM                     | **360° Evaluations** (`docs/plans/2026-06-17-360-evaluations-greenfield.md`) — fully greenfield (no model/router/service), ~5–6 slices. _(Continuous peer feedback already exists + is real; the structured 360 cycle is what's missing.)_                                                                                                                                                                                                                                                                                                                           |
| ~~MEDIUM~~ DONE            | ~~**Commitments** — backend real, UI read-only (no create form).~~ Create form shipped (PR #98 S4, `createCommitment`).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| MEDIUM                     | **Candidate CV/resume upload + real CV→text extraction** (S3 + PDF/DOCX) — apply is text-only today, yet `parseCV` expects CVs.                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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

| Owner        | Task                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TIMS/product | Trim audit/feature_flags/monitoring/organization from `hr_admin` allowlist (needs product confirm).                                               |
| TIMS/product | Candidate self-service data deletion (right-to-erasure) — subject EXPORT exists; deletion is manual (backlog if product commits to self-service). |
| Federico     | Phone re-test of the mobile sweep → report findings for surgical fixes.                                                                           |

## Deferred by design (rule #9 — build for the trigger, not the dream)

- Presidio PII strip/re-inject (input sanitization + Bedrock Guardrails MASK cover today's scale).
- Supabase sa-east-1 migration; Prisma read replicas; pgvector (Phase 4+).
- Payroll/IT-provisioning integrations, external LMS, external eval vendors, custom connector SDK (per Architecture doc exclusions, Phase 10+).
