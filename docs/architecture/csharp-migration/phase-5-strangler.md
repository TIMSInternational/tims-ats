# Phase 5 — Strangler: migrate working domains, one at a time

Date: 2026-07-15 · Status: **Template + order ready.** Each domain gets its own sub-plan JIT.
Parent: `00-master-plan.md` · Starts after Phase 3 (a real domain proven in C#) + Phase 4 (workers) exist.

## Objective

Move each **existing, working** TIMS backend domain from TS/tRPC/Prisma into C#, one at a time, with zero
regression and provable security parity — until the TS backend surface is gone. This is the workhorse phase;
its safety comes entirely from the repeatable recipe below.

## The per-domain recipe (identical for every domain — this is the whole point)

For domain D:

1. **Characterize.** Capture D's *current* behavior as executable tests against the TS implementation
   (inputs → outputs, including edge cases and every §11 security invariant D touches). These are the
   contract D must still satisfy in C#. Also snapshot D's tables into the ownership ledger (still Prisma-owned
   at this step).
2. **Model.** Design the C# domain (`Tims.Domain` entities/value objects/policies), application use cases,
   and EF Core mapping of D's tables (scaffold → refine). No behavior change.
3. **Port + parity.** Implement in C#. Add **golden parity fixtures**: the same inputs run through TS and C#
   must produce identical outputs (extends the Phase-1 diff harness). Security invariants get
   Testcontainers/real-RLS tests, not mocks.
4. **Route (dark → canary → full).** Expose D's C# endpoints in `Tims.Api` (OpenAPI). Route reads first,
   behind the tRPC BFF or the generated client. Start read-only, then writes. Keep the TS path behind a flag.
5. **Verify in prod.** Compare C# vs TS outputs on real traffic (shadow/canary) until confidence; watch
   audit, latency, error rates.
6. **Flip ownership.** Move D's tables to `efcore` in the ledger; C# becomes the sole writer. Cross-domain
   readers switch to D's API or a read model.
7. **Delete TS logic.** Remove D's tRPC procedures/services/repositories and Prisma models it exclusively
   owned. The BFF shrinks. `packages/db` schema loses D's models.

**Gate per domain (all green before delete):** characterization tests pass on C#; golden parity byte-identical;
every §11 invariant D touches has a passing C#/RLS test; prod canary shows no divergence/regression; audit +
tenant isolation verified live. Only then is step 7 (delete) allowed. **Rewind beats forward-fix** — if
canary diverges, route back to TS, fix, re-canary.

## Recommended domain order

Ordered by *least cross-cutting first* and *most benefit from C#*, so early wins are clean and the riskiest
(most-integrated) come once the muscle memory is strong. Adjust after the Team Suite study (§P6 may reorder).

1. **External-vendor API** — already an isolated, well-specified surface (Sprint 1.6); API-key auth ported in
   Phase 2; minimal cross-cutting. Clean first strangler.
2. **Billing / invoices** — bounded, money-typed, benefits from C# domain modeling; few inbound deps.
3. **Reporting / analytics** — mostly read models/aggregation; pairs naturally with C# + read replicas later.
4. **Audit / compliance** — the audit writer is already cross-cutting (Phase 2 WP2.7); consolidate it here.
5. **360 evaluation backend** — self-contained (Sprint 1.7), anonymity invariants already fixtured; a good
   mid-difficulty port (the k-anon/identity-anchoring fixtures make parity tractable).
6. **Candidate pipeline state machine** — more cross-cutting (drives many surfaces); do it once the pattern is
   proven.
7. **Compensation / currency** — pure and easy to parity-check (the Phase-1 diff harness targets it), but it
   already works, so it carries the least urgency; slot it where it de-risks best rather than first.

Deliberately kept in TS to the end (or forever): UI composition, role dashboards, fast-changing candidate UI,
experimental AI UX, frontend forms/tables. And the **AI orchestration** (`ai-gateway`) — never migrated.

## Coexistence hygiene (enforced every domain)
- One writer per table (the ledger); cross-domain writes via API/events, never a second stack's direct write.
- New/migrated tables carry RLS (`EnableTenantRls`); the DDL goes through the single hand-applied SQL path.
- The BFF holds zero business logic and only ever shrinks.
- Permission/rate-limit state stays on shared Redis keys so both stacks agree during the flip.

## Definition of Done (phase)
Every targeted domain migrated and its TS logic deleted; the BFF covers only cross-cutting glue; `packages/db`
holds only not-yet-retired scaffolding. Hands off to Phase 7 (final teardown).

## Open inputs
- Final order may shift based on the Team Suite study (a Team Suite module may make, e.g., reporting or comp
  higher priority to unify).
- Each domain's sub-plan (`phase-5-<domain>.md`) is written JIT when its turn comes, using this recipe.
