# C# Backend Migration — Master Plan (executable roadmap)

Date: 2026-07-15 · Status: **Authoritative execution plan.**
Architecture reference: `docs/architecture/2026-07-15-csharp-backend-target-architecture.md` (the "what/why").
This document is the "how/when/in-what-order/what-gates-each-step." Per-phase detailed plans live beside it
(`phase-N-*.md`) and are produced just-in-time.

## 1. How this migration runs without stalling anything

Two workstreams run in parallel, deliberately decoupled:

- **Product workstream (TypeScript):** keeps shipping the current TIMS build-plan (Sprints 1.8/1.9, then
  Phase-2 AI layer) so revenue/feature momentum never pauses. Governed by the existing SDD + Codex/opus gate.
- **Platform workstream (C#):** builds the C# runway, proves the two make-or-break assumptions, then
  strangles domains one at a time. Governed by the SAME gate.

**The one hand-off rule between them:** from Phase 1 onward, any *new* backend-heavy domain is built in C#
(not TS-then-migrate). The AI/inference layer is the standing exception — it stays in `ai-gateway`
(TS/Python) forever. This stops the TS backend from growing new surface we'll only have to migrate later.

## 2. Phase index, dependencies, and gates

```txt
Phase 0  Keep shipping TS product          (ongoing, parallel)      ── no gate; never blocks C#
Phase 1  Runway + Spike A (RLS/EF) + Spike B (authz fixtures)       ── GATE G1: both spikes green
Phase 2  Identity/auth plane in C#          (needs P1)              ── GATE G2: parity fixtures + JWT/API-key
Phase 3  First real domain = HRIS (greenfield C#)  (needs P2)      ── GATE G3: prod-live, no regression
Phase 4  C# workers/jobs                    (needs P2; parallel P3) ── GATE G4: ≥1 recurring job live+idempotent
Phase 5  Strangle working domains, one at a time (needs P3+P4)     ── per-domain GATE: golden parity + prod
Phase 6  Team Suite integration            (needs P2; study input) ── GATE: re-homed onto RLS/org model
Phase 7  Retire TS backend + consolidate   (needs P5 complete)     ── GATE: tRPC/Prisma deleted, one platform
```

Dependency graph (arrows = "must finish before"):

```txt
P1 ─► P2 ─► P3 ─► P5 ─► P7
        │     ▲     ▲
        ├─► P4 ┘     │
        └─► P6 ──────┘   (P6 can start after P2; lands into P5's strangler stream)
```

**Hard external inputs (do not block P1/P2):**
- Team Suite intake study (feeds P6, and refines P5 order). Scheduled separately.
- Org cloud decision AWS vs Azure (feeds P4/P8 hosting; default AWS-in-DB-region). See architecture §8.

## 3. Definition of Done — per phase (the gate each must pass)

| Phase | DONE means |
|---|---|
| **1** | `Tims.Platform` builds in CI; `/health` runs; OpenAPI emits. **Spike A:** Testcontainers proves org-A cannot read org-B and an unset GUC returns 0 rows, through EF + the RLS interceptor, on Supavisor-style transaction pooling. **Spike B:** `contracts/access-fixtures` golden set passes IDENTICALLY in the TS suite and `Tims.UnitTests`. Compensation diff-harness spike shows byte-identical results on ≥1 fixture. Table-ownership ledger + CI check + `EnableTenantRls` helper exist. |
| **2** | C# validates a Supabase JWT (exp/iss/aud/JWKS) and the `tims_` API key; resolves all 4 principal types (platform-owner/org-user/candidate/external-key) + impersonation into `ITenantContext`; rate-limits on shared Redis keys. No product traffic yet. Every auth invariant has a golden fixture / integration test. |
| **3** | HRIS (Sprint 1.8) ships **in C#**, prod-live, behind the auth/tenant/RLS plane, with parity/characterization tests. Zero user-visible regression. First real proof the stack delivers value. |
| **4** | `Tims.Workers` runs ≥1 recurring job (e.g. FX refresh or audit purge) with idempotency + retry + visible failures. Long-running work is off the serverless request path. |
| **5** | Each targeted domain migrated one at a time: characterization tests → C# impl → shared golden parity → routed (direct client/BFF) → prod-verified → **TS logic deleted**. BFF shrinks each time. |
| **6** | Team Suite Business/Common adopted into `Tims.Domain`; its DataAccess **re-homed onto TIMS RLS/org model** (never its tenant model); its Web discarded. Wrapped/extracted/rebuilt per the study's classification. |
| **7** | tRPC removed, Prisma retired, `packages/api` + `packages/db` deleted; frontend on the generated client + Next handlers; one identity/tenant/audit/authz kernel, all C#. `ai-gateway` remains by design. |

## 4. Cross-cutting standards (apply to every phase)

- **Build discipline:** SDD (fresh implementer + reviewer per task) → whole-branch **opus + Codex adversarial**
  gate → ship. Same doctrine that runs the TS product. No C# domain ships without it.
- **Security parity is a merge blocker:** the non-negotiable invariants (architecture §11) each need a C#
  golden-fixture or Testcontainers-integration equivalent before the domain ships. RLS is tested *for real*
  (Testcontainers), not mocked.
- **Golden fixtures are the anti-drift spine:** `contracts/access-fixtures/*.json` (authz, scope, k-anon) run
  in BOTH CIs. Any behavior change edits the fixture once; both stacks must agree.
- **One DDL path:** all schema changes (Prisma- or EF-authored) are generated, reviewed as SQL, and applied
  via psql. Never `dotnet ef database update` / `prisma migrate deploy` against prod. Every new org-scoped
  table carries its RLS block (`EnableTenantRls`).
- **Table-ownership ledger** (`table-ownership.md`) is CI-enforced: a PR mutating a table it doesn't own fails.
- **Co-location:** C# services deploy in the DB's region (latency constraint). Runtime → Supavisor 6543
  (`SET LOCAL` only); DDL → direct 5432.
- **Observability from first endpoint:** OTel + Serilog JSON + health/readiness + single-writer audit.
- **Reversibility:** every strangled domain keeps its TS implementation behind a flag until the C# path is
  prod-verified; only then is the TS logic deleted. Rewind beats forward-fix.

## 5. Risk-triggered off-ramps (decide fast, cheap)

- **Spike A fails** (EF can't hold RLS/GUC under transaction pooling): STOP. Options — (i) a thin Npgsql
  data-access layer instead of full EF for tenant tables; (ii) a DB proxy that injects the GUC; (iii)
  reconsider convergence. Learned in week 1, not month 6.
- **Spike B diverges** (kernels disagree on a fixture): the kernel is under-specified — freeze the spec in
  fixtures before porting further.
- **Team Suite tenant model is incompatible/opaque:** default to Option C (rebuild on TIMS patterns) for the
  affected modules; never import its tenant model to hit a deadline.
- **AI-in-C# pressure:** hold the `ai-gateway` boundary; revisit only with concrete .NET-AI-SDK evidence.

## 6. Per-phase plan files (produced just-in-time)

- `phase-1-runway-and-spikes.md` — **detailed, ready** (this batch).
- `phase-2-identity-plane.md` — **detailed, ready** (this batch).
- `phase-3-hris-domain.md` — outline now; full detail after P1/P2 land + Sprint 1.8 requirements firm up.
- `phase-4-workers.md` — outline now; detail after the queue/scheduler choice (P4 kickoff).
- `phase-5-strangler.md` — the per-domain template + order; each domain gets its own sub-plan JIT.
- `phase-6-team-suite.md` — blocked on the intake study; template + security gate defined.
- `phase-7-consolidation.md` — detail last.

Detailing later phases now would be speculative — they depend on Spike outcomes, the Team Suite study, and
the cloud decision. We detail each phase as its inputs land, keeping plans truthful.
