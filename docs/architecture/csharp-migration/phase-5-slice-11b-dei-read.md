# Phase 5 Slice 11b — DEI READ surface (minus pay-equity) → C# (strangler #10, dark)

**Flag:** `Platform:DeiReadEnabled` (default false) · **Ledger:** `efcoreReadOnly` · No flip, no new tables.
**Spec:** live TS `packages/api/src/routers/dei.ts` (171) + `services/dei.service.ts` (401) + `repositories/dei.repository.ts` (115) — HAS a service/repo layer (cleaner port than engagement).
**Branch OFF main AFTER engagement (Slice 11) merged** (`5a120b7`) — engagement already registered surveys/survey_responses + `EngagementReadEnabled`; branching after avoids Program.cs / PlatformOptions / table-ownership.md merge conflicts.
GROUP 2 of people-dashboards. `dei.getPayEquity` is EXCLUDED → Slice 11c (FX gateway). The `generateReport` mutation is EXCLUDED (write/stub).

## Reads ported (10; NOT getPayEquity #7, NOT the generateReport mutation)

| # | Read | Auth | Tables | k-anon | Notes |
|---|------|------|--------|--------|-------|
| 1 | getDashboardKpis | perm('dei','read') | employee_demographics(enum grp), users | yes (each metric nullable) | totalEmployees, demographicsCoverage, genderParityIndex, womenPct, leadershipWomenPct, totalNationalities |
| 2 | getGenderRepresentation | perm | employee_demographics groupBy gender(ENUM) | min-5 | {groups[],suppressed} |
| 3 | getAgeDistribution | perm | employee_demographics (dateOfBirth raw + null-DOB count) | min-5 | fixed age-band groups |
| 4 | getNationalityDiversity | perm | employee_demographics groupBy nationality(String) + null | min-5 | totalNationalities, distribution (desc) |
| 5 | getEthnicityDistribution | perm | employee_demographics groupBy ethnicity(ENUM) | min-5 | groups (desc) |
| 6 | getDisabilityDistribution | perm | employee_demographics groupBy disabilityStatus(ENUM) | min-5 | groups |
| 8 | getLeadershipDiversity | perm | employee_demographics + user_roles/roles (slug ∈ LEADERSHIP_SLUGS) | min-5 | totalLeaders, byGender |
| 9 | getHiringFunnel({dateFrom?,dateTo?}) | perm | candidates count | — (no suppression) | {total} |
| 10 | getPromotionEquity({year?}) | perm | salary_adjustments count (type='promotion') | min-5 (floored count) | {year,totalPromotions,suppressed} |
| 11 | getInclusionIndex({surveyId?}) | perm | surveys + survey_responses (answers-only minimal select; TS over-fetches include:{responses:true}) | multi-tier (survey/contributor/skip) | {index,totalResponses,suppressed,questionsEvaluated} |

## Auth — grant-only (VERIFIED)

The live `dei.*` reads are `permissionProcedure('dei','read')` with NO `requireOrgScope` call (unlike the engagement org-rollups). So the C# `DeiStaffGate` is a **grant-only** gate: resolve the staff principal (401 if unresolvable), `PermissionService.CheckAsync('dei','read')` (403 if denied/null-scope, 400 if privileged org-less), and NO org-gate/scopeWhereFor/subject-probe. A caller holding `dei:read` at ANY scope passes; k-anonymity is the disclosure control, sitting on top of the grant. (`generateReport` uses `dei:export`; it is not ported, so `dei:export` is not needed this slice.)

## ⚠️ NATIVE PG ENUM (eval360 #158 MapEnum lesson — THE key mechanic this slice)

`employee_demographics` (employee.prisma:41-58) carries THREE native Prisma enum types the DEI reads GROUP BY:
- **Gender** (`female`/`male`/`non_binary`/`undisclosed`), **Ethnicity** (`mestizo`/`afrodescendiente`/`indigena`/`raizal`/`rom`/`palenquero`/`blanco`/`otro`/`undisclosed`), **DisabilityStatus** (`none`/`has_disability`/`undisclosed`). DB type names are exactly `"Gender"`/`"Ethnicity"`/`"DisabilityStatus"` (migration `20260605000000_employee_demographics`).

→ `DeiReadDbContext` MUST build an `NpgsqlDataSource` with `MapEnum<GenderPg>("Gender")` / `MapEnum<EthnicityPg>("Ethnicity")` / `MapEnum<DisabilityStatusPg>("DisabilityStatus")` and apply the SAME `MapEnum`s at the EF options level (`DeiReadDataSource.MapEnums`, at BOTH the Program.cs DI site AND the Testcontainers fixture). `HasPostgresEnum` alone does NOT type-map → EF materializes the columns as `int` (`GetInt32` → InvalidCastException) and emits `= <integer>` GROUP BY / WHERE (error 42883). The real-RLS integration catches it (the enum-materialization bite).

- **ISOLATE the `NpgsqlDataSource` behind a holder** (`DeiReadDataSourceHolder`) so it never bleeds into the other string-based DbContexts — EFCore.PG auto-adopts a DI-registered open `NpgsqlDataSource`; registering the wrapper keeps the enum mapping exclusive to `DeiReadDbContext` (the billing/eval360 holder pattern).
- `nationality` = plain `String?` (no MapEnum). `dateOfBirth` = `@db.Date` (raw `date`, read server-side, bucketed into age bands — never returned raw).
- The OTHER tables in the DEI context (`users`, `user_roles`, `roles`, `candidates`, `salary_adjustments`, `surveys`, `survey_responses`) are string/int/jsonb only — mapping the 3 enums does not affect them. `salary_adjustments.type`/`surveys.type` are plain Strings; only the count / string-filter columns are mapped.

## Reuse (do NOT re-port)

- `Tims.Domain.Access.KAnonymity.SuppressBelowMin5` — reused for getPromotionEquity's floored count and inside every kernel's suppression trigger (byte-identical to the TS `suppressBelowMin5`).
- `Tims.Domain.Reporting.ReportingMath.JsRound` (`Floor(x+0.5)`) — JS half-up rounding for `pct` and the inclusion-index average.
- `Tims.Domain.Json.NodeIso*Converter` — the DEI wire is numbers/strings only (no DateTime on any of the 10 read outputs), so no NodeIso converter is needed on the DEI models; the repo still re-kinds any read timestamps it filters on.
- Ledger reuse: `candidates`, `salary_adjustments`, `surveys`, `survey_responses`, `users`, `user_roles`, `roles` already `efcoreReadOnly`. NEW ledger += `employee_demographics`.

## Kernels → `@tims/shared/dei.ts` (HONEST-fixture: refactor `dei.service.ts` + `dei.ts` router to CALL them), golden BOTH stacks

Extracted from the inline logic of `dei.service.ts` / `dei.ts`:
- `pct(count,total)` — half-up % to 1 decimal (`Math.round(count/total*1000)/10`).
- `median(values)` — used by getPayEquity (stays TS this slice; exported + golden-fixtured for Slice 11c reuse; the C# `DeiKernels.Median` is fixture-exercised, ready for 11c).
- `AGE_BANDS` + `ageBand(dob,now)` — server-side age-band bucketing.
- `buildDistribution(groups,total,extraBuckets?)` — the shared present-key-cardinality suppression shaper: suppressed = `total<5 || any(extraBuckets)<5 || any(group.count)<5`; suppressed → `{groups:[],suppressed:true}` (NO keys); else each group → `{key,count,percentage,suppressed:false}` in the caller's order. Gender/disability = insertion order; ethnicity/nationality = count-desc (caller sorts); age = fixed AGE_BANDS order (including 0-count bands). nationality passes `extraBuckets=[nullNationalityCount]`, age `[nullDobCount]`.
- `deiDashboardKpis(input)` — the ratio shaper + the round-2..8 multi-round differencing suppression (genderParityIndex/womenPct nulled when any gender group sub-floor; leadershipWomenPct when any leader-gender sub-floor; demographicsCoverage when ANY dynamic demographic distribution — gender/nationality+null/ethnicity/null-DOB — is sub-floor; totalNationalities mirrors getNationalityDiversity's trigger).
- `leadershipDiversity(leaderGenders)` — the getLeadershipDiversity shaper (present-key cardinality on the leader pool).
- `inclusionIndex(questions,responseAnswers)` — the getInclusionIndex multi-tier suppression (survey-level floor → no-inclusion-question branch → contributor+skip floor → half-up avg), answers-only.

Rounding = JS half-up (`ReportingMath.JsRound`). Golden both stacks `contracts/dei-fixtures/*.json` (asserted by `tests/dei/kernels-fixtures.test.ts` and `Tims.UnitTests/Fixtures/DeiKernelsFixtureTests.cs`).

## Regression corpus (Testcontainers REAL RLS + goldens) — each BITE-PROVEN

- **native-enum materialization** — group-by Gender/Ethnicity/DisabilityStatus returns typed labels, not int; WITHOUT `MapEnum` the integration 500s (proved RED by neutralizing `MapEnums`).
- **enum-datasource holder does NOT bleed** — the other string DbContexts still string-materialize (a plain string-column read under a sibling context succeeds; the holder is a private wrapper, not an open `NpgsqlDataSource`).
- min-5 floor on EVERY demographic group/bucket; empty-distribution NOT null-keyed (no present keys when suppressed).
- **cross-endpoint differencing** — dashboard aggregate ↔ per-distribution recovery (a sub-floor gender group nulls womenPct/genderParityIndex/demographicsCoverage; a sub-floor nationality/null-DOB bucket nulls the derived metric).
- null-DOB / undisclosed-enum buckets counted correctly; LEADERSHIP_SLUGS parity.
- getInclusionIndex multi-tier suppression; getPromotionEquity floored count; getHiringFunnel NO suppression.
- input bounds (getPromotionEquity year, getInclusionIndex uuid, getHiringFunnel datetime) — 400 AFTER auth.
- cross-org RLS isolation; dark-by-default 404; auth matrix (dei:read grant→403 / JWT→401 / dark→404 with VALID staff slugs).

## Endpoints (dark behind `Platform:DeiReadEnabled`; build-only OpenAPI)

10 GET, auth-before-parse, `DeiStaffGate` (dei:read, grant-only), under `TenantScope`/RLS + explicit org filter. INTERNAL reads = raw model/kernel shape, NO `schemaVersion`.

```
GET /dei/dashboard-kpis
GET /dei/gender-representation
GET /dei/age-distribution
GET /dei/nationality-diversity
GET /dei/ethnicity-distribution
GET /dei/disability-distribution
GET /dei/leadership-diversity
GET /dei/hiring-funnel?dateFrom&dateTo
GET /dei/promotion-equity?year
GET /dei/inclusion-index?surveyId
```

## After DEI

Slice 11c = `dei.getPayEquity` + compensation Slice-9b (5 FX reads) via the FX gateway: DB-pinned `fx_rates` + daily Quartz `FxRefreshJob` + `IFxRateProvider`. `median`/`convertMoney`/`sumMoney` deterministic golden-fixtured GIVEN a rate. Federico prod DDL for `fx_rates`.
