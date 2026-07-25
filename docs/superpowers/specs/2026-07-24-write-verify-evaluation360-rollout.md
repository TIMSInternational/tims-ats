# Write-Verify Rollout — Surface #1: evaluation360 (6 writes)

**Date**: 2026-07-24 · **Status**: pure-code complete, awaiting Federico's flag flip · **PR**: `feat/parity-write-verify-evaluation360`
**Builds on**: `2026-07-24-write-verification-harness-design.md` (the compensation tracer).

## Goal
Roll the second write surface (evaluation360's 6 writes) through the write-verification harness, and
**generalize the harness** so the remaining surfaces (succession / nine-box / engagement) are pure registrations.
The C# endpoints are already deployed in image `:a6b0fa6`, dark behind `Platform__Evaluation360WriteEnabled`.

## Harness generalization (keeps the compensation tracer live-green)
The tracer hard-coded compensation's resolution + a single denial shape. Generalized additively:
1. **Per-surface hooks.** `WriteSurface` now carries `ensurePreconditions(cfg)` + `resolveResources(cfg)` (implemented
   in `seed.ts`), so surface N never touches 1..N-1 and each surface owns its resolved-id shape `R extends
   WriteResolvedBase`. The registry is heterogeneous via `defineWriteSurface` (existential erasure); the runners
   (`runWrite*`) are generic over `R`. `cli.ts` calls `surface.ensurePreconditions` / `surface.resolveResources`.
2. **Optional `buildIdor`.** A create whose org is fixed by the caller's JWT context (`createCycle`) has **no
   cross-org target** → its IDOR check is reported **N/A** (not a silent skip of a strong test — there is genuinely
   no cross-tenant attack surface).
3. **Per-endpoint denial semantics.** `idorDeniedStatuses` (default `[403,404]`) + `rbacDenyStatus` (default `403`)
   let each endpoint declare how a denial looks: subject-scope 403, `assertScoped` 404, guarded state-transition
   409, identity-anchored 404. A 200 is always a write leak; an out-of-set status fails closed.
4. **`expectedByRole` is now `'allow' | 'deny'`** (was `200 | 403`) — the actual asserted deny status is
   `rbacDenyStatus`, so an identity-anchored 404-deny reads honestly.

## The 6 endpoints (grounded in `Evaluation360WriteEndpoints.cs` + the router)

| Endpoint | Gate | IDOR | RBAC-deny | allow-live |
|----------|------|------|-----------|-----------|
| `POST /evaluation360/cycles` (createCycle) | `evaluation360:create` + org-gate | **N/A** (org from context) | hrbp → 403 | hr_admin (own cycle) |
| `POST /cycles/{id}/open` (openCycle) | `:update` + org-gate | org-B draft cycle → **409** | hrbp → 403 | probe-only |
| `POST /cycles/{id}/close` (closeCycle) | `:update` + org-gate | org-B open cycle → **409** | hrbp → 403 | probe-only |
| `POST /cycles/{id}/publish` (publishCycle) | `:update` + org-gate | org-B closed cycle → **409** | hrbp → 403 | probe-only |
| `POST /cycles/{id}/raters` (assignRaters) | `:create` + org-gate | org-B cycle → **409** (cycleNotOpen) | hrbp → 403 | probe-only |
| `POST /assignments/{id}/ratings` (submitRatings) | **IDENTITY** (raterUserId===caller) | org-B assignment → **404** | hr_admin/hrbp (non-owner) → **404** | probe-only |

**The load-bearing invariant** (submitRatings): authorization is `raterUserId === caller.id`, NOT a grant. A non-owner
(any role, incl. an org-admin) gets 404 with zero forged responses — the harness proves this both cross-org (IDOR) and
intra-org (RBAC-deny hr_admin + hrbp), each with a read-back that the assignment stays `pending` with 0 `rater_responses`.

## Preconditions (`seed.ts` `ensureEvaluation360WritePreconditions`, write-verify path only)
DISTINCT fixed-UUID cycles per endpoint (`WRITE_EVAL_CYCLES`, prefix `e0000361-…`, disjoint from the read `EVAL_CYCLE`
set), each pre-seeded in its transition's **from-state**, one per org (org-A = parity/rbac-deny target, org-B = IDOR
target): draft (open), open (close), closed (publish), draft (assign) + an open cycle & a **pending self-rater
assignment** (rater = the org's super_admin) per org (submit). Re-run-idempotent: the seeder first deletes prior
write-cycle assignments/responses + `createCycle` marker rows, then re-seeds (so a submit/transition consumed by a
prior run is restored). Kept OUT of the shared `seed()` (H1 lesson — a write precondition in the read seed degrades a
read RLS control). Swept by `teardown` (deletes review_cycles/rater_assignments/rater_responses by org, both orgs).

## Check ordering (per endpoint, in `cli.ts`)
IDOR → RBAC-deny → light-parity (the single mutation). Every denial is verified by a DB read-back proving **no
mutation** (transition: cycle still in from-state; assign: no assignment row; submit: still pending + 0 responses).
The light-parity self-locates its created/mutated row (createCycle by `created_by`+marker; transitions by the fixed
cycle id; submit by the assignment id) and asserts the response id/shape matches.

## Gate (this PR — pure code)
- Local: **142 parity unit tests** (was 102; +40 covering the generalization + all 6 eval360 endpoints), full repo
  `tsc --noEmit` **0 errors**, gitleaks clean, full vitest **2538 passed**. (Repo ESLint tooling is env-broken on
  ESLint 10 flat-config — pre-existing, not this change; the source adds no `any` and strict tsc is clean.)
- The compensation tracer is behavior-identical (its runtime path unchanged; only refactored into the per-surface hooks).

## Federico flip + live verify (the real proof)
1. **Federico** flips the write flag at canary (prepped full SourceConfiguration at scratchpad
   `evaluation360-write-flip.json` — adds `Platform__Evaluation360WriteEnabled=true`; image `:a6b0fa6` + 3 secrets +
   CORS/JWKS + all read flags + CompensationWriteEnabled byte-preserved):
   `aws apprunner update-service --region us-west-2 --service-arn arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5 --source-configuration file://<evaluation360-write-flip.json>`.
2. **Claude**: `cd scripts/parity && npx tsx cli.ts seed --teardown && npx tsx cli.ts seed && npx tsx cli.ts verify-write evaluation360`
   → expect all-green (6 endpoints × {IDOR|N/A, RBAC-deny, light-parity}). A FAIL = a real bug → fix both-stacks +
   bite tests + rebuild `:sha` → ECR → Federico redeploys → re-verify (the createAdjustment precedent). Watch every
   subject-taking write for a createAdjustment-class org-membership hole.
3. Fresh-context opus adversarial review → merge (admin-merge past the CI billing trap).

Writes are dark until the flag flips; this changes nothing for real users. The FE cutover (routing the eval360 write
UI to C#) is a later, separate deploy-gated step — this harness only proves the C# writes are parity-correct + isolated.
