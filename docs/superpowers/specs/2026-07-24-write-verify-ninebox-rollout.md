# Write-Verify Rollout — Surface #4 (final): nine-box calibration (5 writes)

**Date**: 2026-07-24 · **Status**: pure-code complete, awaiting Federico's flag flip · **Builds on**: the eval360/succession/engagement rollouts. This CLOSES the write-verification rollout (all 5 write surfaces).

C# endpoints dark in `:a6b0fa6` behind `Platform__NineBoxWriteEnabled`.

## Tenancy quirk
`calibration_members` / `calibration_votes` have **NO `organization_id`** — RLS is a session-subquery policy, so cross-org isolation on member/vote inserts rides on the parent session's org. The harness verifies this by pointing every by-id IDOR at an org-B **session** (which RLS hides → 404/400), with a read-back proving the org-B members/votes are untouched.

## The 5 endpoints (grounded in `NineBoxWriteEndpoints.cs`)
| Endpoint | Method | Gate / mechanic | IDOR → denied | allow-live |
|---|---|---|---|---|
| createCalibration | POST | `ninebox:create` + requireOrgScope | cross-org memberId → **400** (H1 hardening) | **yes** (created_by) |
| submitCalibrationVote | POST | `ninebox:update` + **MEMBERSHIP+IDENTITY** | cross-org session → **404** | no (membership anchor) |
| addCalibrationMember | POST | `:update` + requireOrgScope | cross-org session → **404** | no (no caller column) |
| removeCalibrationMember | DELETE | `:update` + requireOrgScope | cross-org session → **404** | no (by-id delete) |
| finalizeCalibration | POST | `:update` + requireOrgScope, unconditional {id,org} | cross-org → **404** | no |

**The load-bearing anchor** (submitCalibrationVote): the voter is the caller and MUST be a committee member — an hr_admin who **holds `ninebox:update` but is NOT a member** of the session is denied **403 NotMember** (the harness tests exactly this: hr_admin is granted `:update` but not seeded as a member of the vote session), proving a non-member can't forge a vote even with the grant. hrbp (no `:update`) is denied at the gate.

createCalibration allow-live-tests hr_admin's `ninebox:create` (via `created_by_id`). **Coverage gap (documented):** `ninebox:update` grant-resolution for a non-bypass role is not allow-live-tested — the vote uses hr_admin as the membership-deny, and add/remove/finalize are probe-only (no caller-stamped column / by-id mutations). Accepted, mirrors the succession/engagement precedents.

## Preconditions (`seedNineBoxWritePreconditions`, write-verify path only)
DISTINCT fixed-UUID sessions per endpoint (`WRITE_NINEBOX`, prefix `e0000365…`, period `Parity Write NB` — distinct from the createCalibration marker period so marker cleanup never touches the fixtures), one org-A + one org-B each, all `draft`. Memberships: the vote sessions seed the voter (each org's super) as a member; the remove sessions seed the member to delete. Re-run idempotent (deletes prior votes/members of the fixed sessions + the createCalibration marker sessions [cascade], re-seeds). Grants: `seedNineBoxGrants` extended to give hr_admin `ninebox:create/update@org`. Teardown already sweeps all calibration tables (both orgs).

## Gate (this PR)
160 parity unit tests (+6), repo `tsc` 0, gitleaks clean. Live `verify-write ninebox` pending Federico's flag flip (prepped `ninebox-write-flip.json`).

> **Rollout COMPLETE after this**: compensation (tracer) + evaluation360 + succession + engagement + nine-box — all 5 write surfaces (~23 write endpoints) verified parity-correct + tenant-isolated + RBAC-correct against the deployed C# backend.
