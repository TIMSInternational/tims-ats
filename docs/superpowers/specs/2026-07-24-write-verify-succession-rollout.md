# Write-Verify Rollout — Surface #2: succession (5 writes)

**Date**: 2026-07-24 · **Status**: pure-code complete, awaiting Federico's flag flip · **Builds on**: the eval360 rollout + the write-harness design.

Pure registration on the generalized harness (no harness change beyond adding `DELETE` to the method union, for removeSuccessor). C# endpoints deployed dark in image `:a6b0fa6` behind `Platform__SuccessionWriteEnabled`.

## The 5 endpoints (grounded in `SuccessionWriteEndpoints.cs`)
| Endpoint | Method | Gate / mechanic | IDOR probe → denied | RBAC-deny |
|---|---|---|---|---|
| addCriticalRole | POST | `succession:create` + **requireOrgScope** | cross-org `currentHolderId` → **400** (H2 reference guard) | hrbp → 403 |
| addSuccessor | POST | `:create` + assertScoped(criticalRole) THEN assertSubjectInScope | cross-org `userId` → **403** (H1 org-membership guard) | hrbp → 403 |
| removeSuccessor | DELETE | `:delete` + assertScoped(successor) | org-B successor id → **404** | hrbp → 403 |
| updateSuccessorReadiness | PATCH | `:update` + assertScoped(successor) | org-B successor id → **404** | hrbp → 403 |
| updateCriticalRoleBand | PATCH | `:update` + assertScoped(criticalRole) | org-B role id → **404** | hrbp → 403 |

addCriticalRole + addSuccessor carry the **createAdjustment-class H1/H2 both-stacks fixes** (cross-org holder → 400; cross-org successor userId → 403) — the harness exercises exactly those, with a read-back proving no row was written.

## Preconditions (`seedSuccessionWritePreconditions`, write-verify path only)
DISTINCT fixed-UUID parent critical roles (`WRITE_SUCCESSION_ROLES`, prefix `e0000363…`, disjoint from the read succession set), one org-A + one org-B per by-id endpoint, plus fixed successors (resolved by natural key). addCriticalRole (a create) has no fixed precondition — its parity creates a marker-titled role. Re-run idempotent (deletes prior write successors + marker rows, re-seeds the from-states: readiness `developing`, band NULL org-A / `ORGB-BAND` org-B). Grant seeder now gives hr_admin `succession:create/update/delete@org` (correctness/future-proof).

## Coverage nuance (documented, not a false-green)
**No succession write is allow-live.** `critical_roles` has no caller-stamped column, and the shared-body harness can't mint a distinct second create (successors' `(role,user)` unique key would clash), so the non-bypass allow role (hr_admin) isn't independently live-proven here. The probe proves the happy path + the H1/H2 reference guards + IDOR isolation; hrbp-deny proves the gate (403 + no mutation). Every check still runs its DB read-back.

## Gate (this PR)
148 parity unit tests (+6), repo `tsc` 0, gitleaks clean. Live `verify-write succession` pending Federico's flag flip (prepped `succession-write-flip.json` — adds `Platform__SuccessionWriteEnabled=true`, all else byte-preserved).

## Federico flip → live verify → merge
`aws apprunner update-service … --source-configuration file://<succession-write-flip.json>` → Claude runs `seed --teardown && seed && verify-write succession` → all-green (or catch+fix a real bug both-stacks) → fresh-opus review → merge.
