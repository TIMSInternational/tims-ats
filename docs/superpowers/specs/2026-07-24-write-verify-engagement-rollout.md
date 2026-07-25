# Write-Verify Rollout — Surface #3 (final): engagement (5 writes)

**Date**: 2026-07-24 · **Status**: pure-code complete, awaiting Federico's flag flip · **Builds on**: the eval360/succession rollouts.

The last write surface. COEXISTENCE (not a flip) — surveys/survey_responses/action_plans stay read by TS monitoring/dei/the alert cron. C# endpoints dark in `:a6b0fa6` behind `Platform__EngagementWriteEnabled`. Engagement reads were NOT cut over, so this surface brings its own grants + fixtures.

## The 5 endpoints (grounded in `EngagementWriteEndpoints.cs`)
| Endpoint | Method | Gate / mechanic | IDOR → denied | allow-live |
|---|---|---|---|---|
| createSurvey | POST | `engagement:create`, grant-only | **N/A** (org from ctx; targetGroups opaque) | **yes** (created_by attributed) |
| activateSurvey | POST | `:create`, by-id `findFirst{id,org}` | org-B survey → **404** | no (state change) |
| submitSurveyResponse | POST | `:create` + IDENTITY (userId=caller) | org-B survey → **404** (not active in caller's org) | **yes** (user_id attributed) |
| createActionPlan | POST | `:create` + assertSubjectInScope + **H1** | cross-org responsibleId → **403** | no (no caller column) |
| updateActionPlan | PATCH | `:update` + assertScoped(actionPlan) | org-B plan → **404** | no (by-id update) |

createActionPlan carries the **createAdjustment-class H1 both-stacks fix** (cross-org responsibleId → 403); the harness exercises it with a read-back proving no plan was written. submitSurveyResponse is identity-anchored (userId = caller, never input). hrbp is ungranted → every write 403 at the gate.

Two endpoints **do** allow-live-test the non-bypass grant (createSurvey via `created_by_id`, submitSurveyResponse via `user_id`), so hr_admin's `engagement:**create**` grant-resolution is independently proven — createActionPlan's lack of a caller column is therefore not a `create`-grant coverage gap.

**Documented coverage gap (`engagement:update`):** updateActionPlan is the surface's only `:update` write and is NOT allow-live (a by-id update), so `engagement:update` grant-resolution for a non-bypass role is never live-exercised — the probe (super_admin) bypasses permissions and hrbp-deny only proves the no-grant path. A hypothetical bug where `:update` fails to resolve for a granted non-bypass role would pass this surface green. Accepted (mirrors the succession precedent), flagged here explicitly.

## Preconditions (`seedEngagementWritePreconditions`, write-verify path only)
Fixed-UUID surveys (`WRITE_ENGAGEMENT`, prefix `e0000364…`): activate = `draft` from-state, submit = `active`; fixed action plans = `pending`. Re-run idempotent (deletes prior write responses + marker surveys/plans, resets from-states). Grants: `seedEngagementGrants` gives hr_admin `engagement:create/update@org` (in the shared seed, since there is no engagement read seed to protect). Teardown extended to sweep survey_responses/surveys/action_plans (both orgs, FK-safe before the users delete).

## Gate (this PR)
154 parity unit tests (+6), repo `tsc` 0, gitleaks clean. Live `verify-write engagement` pending Federico's flag flip (prepped `engagement-write-flip.json`).

> **Rollout status**: compensation (tracer) + evaluation360 + succession + engagement done. **nine-box** is the one remaining write surface (createCalibration + submitCalibrationVote + add/removeCalibrationMember + finalizeCalibration; note the members/votes tables have NO organization_id — RLS is a session-subquery policy).
