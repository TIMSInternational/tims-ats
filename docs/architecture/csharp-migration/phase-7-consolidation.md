# Phase 7 — Retire the TS backend + platform consolidation

Date: 2026-07-15 · Status: **Outline; detail last (after Phase 5 completes).**
Parent: `00-master-plan.md` · Starts once every targeted domain (Phase 5) is migrated + TS logic deleted.

## Objective
End with ONE coherent C# backend platform — not two products stitched together. Remove the last of the TS
backend, unify the cross-cutting planes, and make Team Suite features indistinguishable modules inside TIMS.

## Exit gate (final)
- tRPC removed; the BFF deleted; Prisma retired; `packages/api` + `packages/db` deleted.
- Frontend runs entirely on the generated OpenAPI client + Next.js route handlers (no tRPC).
- One identity/session model, one org/user/role model, one audit trail, one authz kernel — all C#.
- `ai-gateway` remains (by design). Users experience TIMS as one platform; Team Suite features are modules.

## Work packages (to detail last)
- **WP7.1 BFF teardown** — every frontend call now hits the generated C# client or a Next handler; delete the
  tRPC BFF and its glue. Confirm no domain still routes through it.
- **WP7.2 Prisma retirement** — all tables are `efcore`-owned in the ledger; remove Prisma schema/client,
  `packages/db`, and the Prisma migration tooling. EF Core is the sole ORM; the single hand-applied SQL path
  remains for prod DDL.
- **WP7.3 Frontend cutover finalization** — remove tRPC deps from `apps/web`; `packages/api-client`
  (generated) is the only backend contract; server-side data via Next handlers forwarding the Supabase JWT.
- **WP7.4 Consolidation** — single nav/permissions/audit/billing/reporting surface; shared design system;
  cross-module search + notifications; unified admin console; Team Suite modules under the same nav+RBAC.
- **WP7.5 Final invariants sweep** — re-run every §11 invariant (tenant isolation, RBAC, k-anon, audit,
  candidate/staff + owner/org separation, impersonation) end-to-end against the all-C# stack; a whole-platform
  opus + Codex security review before declaring convergence complete.

## Definition of Done
The migration is complete: the backend is C#, the frontend is React on a generated client, the AI plane is a
called service, the security invariants are proven live on the unified stack, and Team Suite is absorbed. No
TypeScript backend remains.

## Open inputs
- Depends on Phase 5 finishing every targeted domain and Phase 6 absorbing Team Suite.
- Any residual TS backend surface discovered late gets its own strangler pass (Phase 5 recipe) before teardown.
