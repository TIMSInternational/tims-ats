# Parity harness Tier‑2 — by‑id Mode‑A IDOR probes (PR #2)

**Status**: design (2026‑07‑24). Extends the cutover‑verification harness (`scripts/parity/`, PR #177…#187)
with the 9 by‑id read endpoints that Tier‑1 deferred because they need a resource id threaded into the URL.
All 9 already mount under the existing read flags (Compensation/Evaluation360/NineBox/Succession ReadEnabled),
which are ON in prod — so `verify <surface>` exercises them the moment this ships.

## Why Tier‑1 couldn't cover these
Tier‑1 endpoints have static paths. A by‑id endpoint (`/ninebox/employee/{id}`) needs:
- **parity + rbac**: a concrete **org‑A** resource id substituted into `csharpPath` (path segment) **and** into the
  tRPC `input` (query param), so the org‑A probe identity gets a real 200 to compare TS↔C#.
- **rls Mode A (IDOR)**: a concrete **org‑B** resource id in the path, hit with the **org‑A** token — must be
  denied (403/404/empty). This is the *strong* isolation proof Mode B (org‑scoped, no id) can't give.

`rls.ts` already implements Mode A (`buildProbePath` + `ctx.orgBResourceId`). The gaps were: (1) nothing produced
the ids; (2) `cli.ts` never set `orgBResourceId` and used `csharpPath`/`input` verbatim (no org‑A substitution).

## Id model — resource keys (deterministic, re‑derivable in the check process)
`verify` and `seed` are separate processes, so resource ids must be re‑derivable at check time — not carried in
memory from a prior `seed`. We use **fixed uuid constants** for everything the seed fully owns, and a **read‑only
DB lookup** for the two ids we don't mint (the seeded `hr_admin` users).

`EndpointDef.idScopeKey` is repurposed from "placeholder name" (it was never set on any registered endpoint) to
**the resource key** naming which id pair to thread. Five keys:

| key | org‑A id | org‑B id | source |
|---|---|---|---|
| `employee` | `parity+a-hr_admin` user id | `parity+b-hr_admin` user id | DB lookup by email (read‑only) |
| `eval-cycle-staff` | `EVAL_CYCLE.openA` | `EVAL_CYCLE.openB` | fixed uuid consts |
| `eval-cycle-self` | `EVAL_CYCLE.pubA` | `EVAL_CYCLE.pubB` | fixed uuid consts |
| `calibration` | `CALIB.a` | `CALIB.b` | fixed uuid consts |
| `critical-role` | `CRIT_ROLE.a` | `CRIT_ROLE.b` | fixed uuid consts |

`resolveResources(cfg)` (seed.ts, read‑only): connects, resolves the two `hr_admin` user ids by email, combines with
the constants, returns the `SeedResources` map. `seed()` also returns the same map (built from its in‑hand ids).

### Sentinel substitution (pure, `ids.ts`)
`csharpPath` and `input` carry the literal `{id}` sentinel. `substituteEndpointId(ep, id)` deep‑replaces it:
path → `encodeURIComponent(id)` (one segment); input → the raw id (buildTrpcQueryUrl re‑encodes). Example:
`/ninebox/employee/{id}/axis-breakdown?period=2026-Q1` + `{userId:'{id}', period:'2026-Q1'}`.
The Mode‑A org‑B substitution stays in `rls.ts` `buildProbePath` (regex `\{[^}]+\}` → the same single `{id}`).

## Strong Mode A = isolation call + positive control
The literal spec is "org‑A token → org‑B id → expect 404/403". But a bare 404 is only a real IDOR proof if the
org‑B id is actually **live** — a non‑existent id 404s for everyone and proves nothing. So Mode A runs:
1. **isolation**: org‑A token → org‑B id → `assertIsolated` (403/404 ⇒ hold; 200+populated body ⇒ **FAIL** leak).
2. **positive control**: org‑B token → org‑B id → must be reachable (200 + non‑empty). If it isn't (id not live, or
   no `orgBToken`), that is a **FAIL** (fail‑closed) — a strong IDOR proof that couldn't run is not a pass, so
   `verify`'s exit code / "passed" summary can never imply a cross‑tenant test that never ran. (Contrast the
   globalScope N/A and Mode‑B both‑empty cases, which stay acceptable `inconclusive` greens.)

### 200‑empty is strict by default (`crossTenantEmptyOk`)
The correct cross‑tenant response differs by endpoint: **8 of the 9** deny with a **404** (compensation employee,
eval360 cycle‑progress + my‑report, ninebox axis‑breakdown + calibration, all 3 succession) — for those, a 200 with
an *empty* body is itself an anomaly (the route processed a cross‑org id instead of 404ing = a possible missing‑404 /
existence oracle) and `assertIsolated` **FAILS** it. Only **ninebox `/employee/{id}`** models not‑found as a 200
null‑SHAPE (`{evaluation:null, history:[]}`, verified live on both stacks) → it sets `crossTenantEmptyOk: true`, the
sole opt‑in that lets a 200‑empty read as isolated. A populated body always leaks regardless. (Denial modes were
probed live before setting the flag; `isDeepEmpty` still classifies the empty‑vs‑populated boundary.)

Parity already proves the org‑A route returns 200 for a valid in‑scope id, so the two together prove: the route
works, org‑B's resource is live, and org‑A is denied it.

## Seed additions (org‑B mirrors so the org‑B ids are live)
Teardown already sweeps both orgs for every table below, so no teardown change is needed.
- **comp**: an org‑B `employee_compensations` row for `b:hr_admin` (mirrors org‑A) → org‑B super reads it (200).
- **ninebox**: an org‑B `nine_box_evaluations` row for `b:hr_admin` @2026‑Q1; a fixed‑id org‑B `calibration_session`
  (`CALIB.b`) + member/vote. Org‑A calibration session switched to a fixed id (`CALIB.a`).
- **eval360**: fixed‑id `OPEN_B` (staff progress — assignment subject=`b:hr_admin`, rater=`b:super` → org‑B super
  progress non‑empty) + `PUB_B` (self report — self‑assignment subject=`b:super` + response → org‑B super myReport
  200). Org‑A already seeds `openA`/`pubA` (super is rater in open, self‑subject in pub).
- **succession**: a fixed‑id org‑B `critical_roles` row (`CRIT_ROLE.b`, holder `b:super`). Org‑A `cr1` switched to a
  fixed id (`CRIT_ROLE.a`). suggested‑successors/simulate‑exit reuse the same critical‑role id.

## RBAC expectations (grounded in the middleware chains)
- assertSubjectInScope family (#1 comp‑employee, #4 ninebox‑employee, #5 axis): target = `a:hr_admin`.
  super 200 (bypass), hr_admin 200 (own id / org grant), **hrbp 403** (target ∉ its empty unit).
- eval360 cycle‑progress (#2, staff org‑gate): super 200, hr_admin 200 (eval360:read@org), **hrbp 403** (ungranted).
- eval360 myReport (#3, self‑service): **super_admin only** in `expectedByRole` — hr_admin/hrbp get **404** (not a
  subject), which `200|403` can't express and which isn't an RBAC‑permission signal anyway.
- ninebox calibration (#6, hand‑rolled membership): super 200, hr_admin 200 (org scope), **hrbp 403** (not
  creator/member of the org‑A session).
- succession by‑id (#7/#8/#9, assertScoped IDOR‑safe): super 200, hr_admin 200. **hrbp omitted** — out‑of‑scope is
  **404**, not 403 (IDOR‑safe), not representable and not an RBAC signal.

## Files
- `ids.ts` (new, pure) + `ids.test.ts` — sentinel substitution.
- `checks/rls.ts` + `checks/rls.test.ts` — positive control.
- `seed.ts` — fixed‑id consts, org‑B mirrors, `SeedResources` + `resolveResources`.
- `surfaces.ts` + `surfaces.test.ts` — 9 endpoints appended to their surfaces (`idScopeKey` set).
- `cli.ts` — resolve resources once per check run; thread org‑A (parity/rbac) + org‑B (rls) ids.

## Gate
Local: parity unit tests (vitest) + `tsc` + gitleaks. Fresh‑context opus adversarial review (Codex substitute while
usage‑limited). Then a **live `verify` per surface** against prod (flags already ON) — the real proof. Re‑seed first.
