# Phase 6 — Team Suite Integration

Date: 2026-07-15 · Status: **Blocked on the intake study; template + security gate defined now.**
Parent: `00-master-plan.md` · Can start after Phase 2; lands into the Phase-5 strangler stream.

## Objective
Bring Team Suite's C# capabilities into TIMS as modules of ONE platform — reusing its domain logic where
valuable, without importing its architecture problems, and **never its tenant model**.

## The intake study (do this first) → `team-suite-integration-study.md`
Audit (Azure DevOps repo `tims.configuration.core` + its DB + deployed app + any docs):
solution/project structure · framework version · **auth model** · **authorization model** · **tenant/company
model** · user model · **DB provider + schema** · migrations strategy · data-access patterns · service/
business-layer patterns · API surface · UI tech · background jobs · integration points · reporting/export ·
test coverage · deploy pipeline · secrets model · **overlap with TIMS modules** · features worth integrating ·
code-quality/refactor risks.
**Deliverable:** a module map + a per-module classification (wrap / extract / rebuild) + a concept mapping
(Team Suite ↔ TIMS: company↔organization, its user↔TIMS user, its roles↔TIMS roles+scope, its auth↔Supabase).

## The non-negotiable security gate (top of this phase)
Team Suite has its own company/tenant + auth model. **Adopt its Business/Common domain logic; re-home ALL of
its DataAccess onto TIMS's Postgres + EF + RLS + org model; discard its Web.** Importing its tenant model or
data-access verbatim = a cross-tenant breach on HR data. Every Team Suite table that enters TIMS gets the
`tenant_isolation` RLS block and maps to `organization_id`; every Team Suite query is re-expressed against the
TIMS tenant context. No exceptions to hit a deadline (off-ramp: rebuild the module, Option C).

## Integration options (per module, from the study's classification)
- **A — Wrap** (`TIMS UI → BFF → Team Suite service → its DB`): fastest reuse, low initial risk; use for
  stable, low-risk services short-term. Cons: preserves old architecture + a second data model longer.
- **B — Extract** (`Business/Common → Tims.Domain/Application`; `DataAccess → re-homed Infrastructure`; `Web →
  React`): best long-term; use for high-value reusable domain logic. This is the default for the good stuff.
- **C — Rebuild on TIMS patterns**: for messy/coupled/UI-heavy legacy, or when the tenant model can't be
  cleanly re-homed.

Likely mix: **B** for valuable domain logic, **A** for quick low-risk wraps, **C** only for the messy/legacy.

## Work packages (to detail after the study)
- WP6.1 Intake study + module map + classification + concept mapping.
- WP6.2 Re-home the first extracted module's DataAccess onto TIMS RLS/org (the security gate proof).
- WP6.3 Adopt its Business/Common into `Tims.Domain`/`Application` with parity tests.
- WP6.4 Surface it in the React UI via OpenAPI (its Web discarded).
- WP6.5 Fold its jobs into `Tims.Workers`; its integrations into the connector abstraction.

## Open inputs (hard blockers to detail)
- **The intake study itself** (Team Suite auth + tenant model + DB schema are the load-bearing unknowns).
- The org cloud decision (if any Team Suite service is wrapped short-term in its current Azure home).
