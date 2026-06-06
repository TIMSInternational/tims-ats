# Known Issues & Remaining Work

> Moved verbatim from CLAUDE.md §9 (2026-06-06) during the .claude/rules re-org.
> Update this file as work completes — it is the single backlog/status reference.

## FIXED (June 2026 hardening sessions)
- [x] SQL injection in RLS middleware
- [x] IDOR in user.deactivate + user.assignRole
- [x] In-memory rate limiter → Upstash Redis
- [x] 28 `any` types removed
- [x] 80+ missing FK indexes added
- [x] 5 Prisma enums added (OrgPlan, SubscriptionStatus, InvoiceStatus, InvitationType, InvitationStatus)
- [x] ESLint + Prettier config
- [x] Env validation with Zod
- [x] Tailwind design tokens
- [x] 8 shared UI components with a11y
- [x] Toast system + error handling on 19 mutations
- [x] 173 i18n keys (es + en)
- [x] 5 empty packages removed

## Remaining (next sessions)

| Priority | Task |
|----------|------|
| ~~CRITICAL — SECURITY~~ DONE | ~~Database-level tenant isolation is ABSENT.~~ **RLS is now live and verified** (migration `20260604100000`, `tenantDb`, `RLS_ENFORCED=true`) — see `.claude/rules/api-security.md`. |
| ~~**HIGH — AI COST/SAFETY**~~ DONE (Phase 1) | **Guardrail layer is built.** Every AI call now goes through the single gated `@tims/ai` `invokeAgent` (budget→cache→PII→bedrock→validate→log): org-scoped response cache (per-agent TTL; PII agents ttl=0), input sanitization + env-gated Bedrock Guardrails MASK, fail-closed budget, `bedrockCircuit` wired, Zod validation. Rule "no Bedrock outside `packages/ai`" is enforced by a CI grep-gate + Vitest test. **Phase 2 wired (real Bedrock through the gate):** `candidate.parseCV` (CV text → structured data, persists to document) and `candidate.screen` (candidate↔vacancy screening → FitScore) via `candidate-ai.service.ts` + `candidate-ai.repository.ts`. **Remaining:** per-org `AiAgentOrgConfig` budgets still unseeded (default $25 cap applies); Presidio strip/re-inject deferred to a scale-trigger; real CV file→text extraction (S3 + PDF/DOCX) is a separate future phase. |
| HIGH — SECURITY | RBAC follow-up: `hr_admin` uses a denylist short-circuit in `trpc.ts` that bypasses the DB `rolePermission` check. Move to least-privilege once per-org `rolePermission` coverage is verified for every `hr_admin` role. |
| HIGH — SECURITY | Add CAPTCHA (Turnstile/hCaptcha) to the public `applyToVacancy` form; move to nonce-based CSP and drop `'unsafe-inline'`/`'unsafe-eval'` from `script-src`. |
| HIGH | Split god components (invoices 605 LOC, orgs 611, invitations 572) |
| HIGH | Split platform.ts router (1519 LOC) into sub-routers |
| HIGH | Wire i18n keys to page components (mechanical replacement) |
| HIGH | Introduce service layer on next feature |
| HIGH | Configure Supavisor connection pooling for production |
| MEDIUM | Add Sentry + Pino structured logging |
| MEDIUM | Refactor pages to use shared KpiCard/DataTable components |
| ~~MEDIUM~~ DONE | Circuit breaker for Bedrock (`bedrockCircuit` in `packages/ai`) + SES (`sesCircuit` in `packages/api`) — both wired. |
| MEDIUM | Set up AI gateway microservice (Docker + ECS) |
| LOW | Migrate to Supabase sa-east-1 region |
| LOW | Add Prisma read replica extension |
