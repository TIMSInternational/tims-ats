# PR #18 external-vendor fix: extend v1 API to return `band` + `normSampleSize`

**Branch:** `feat/assessment-player-norm-scoring` (commit `7f6ee85`)
**Date:** 2026-07-31

## Background

`ExternalAssessmentProjectionPinTests` (`services/Tims.Platform/tests/Tims.IntegrationTests/ExternalVendor/ExternalAssessmentProjectionPinTests.cs`)
walks the _actual_ EF projection expression used by `ExternalAssessmentRepository` and asserts it selects
**exactly** the set of `assessmentResult` fields the classification kernel (`FieldClassification.cs` /
`classification.ts`) marks visible to the `external` role. An earlier change widened that ceiling to
include `band` and `normSampleSize` on both stacks, but the external-vendor v1 read API itself (a
versioned, **live-in-production** contract — `EXTERNAL_VENDOR_READ_VIA_CSHARP=true`) was never extended to
actually select/return them. That drift is what failed CI.

Federico's decision: extend the API (not revert the classification widening).

## Changes

### C# — read entity, DbContext, data source, repository, DTOs

1. **`services/Tims.Platform/src/Tims.Infrastructure/ExternalVendor/ExternalAssessmentReadEntities.cs`**
   Added `public string? Band { get; set; }` and `public int? NormSampleSize { get; set; }` to
   `ExternalAssessmentResultReadEntity`, right after `Percentile`. Updated the class doc comment
   ("six scored fields" → "eight scored fields").

2. **`services/Tims.Platform/src/Tims.Infrastructure/ExternalVendor/ExternalAssessmentDbContext.cs`**
   Added column mappings in `OnModelCreating`:

   ```csharp
   entity.Property(r => r.Band).HasColumnName("band");
   entity.Property(r => r.NormSampleSize).HasColumnName("norm_sample_size");
   ```

   with a comment noting `band` is read-only/never filtered, hence the `EnableUnmappedTypes` pattern
   rather than `MapEnum<TEnum>`.

3. **NEW: `services/Tims.Platform/src/Tims.Infrastructure/ExternalVendor/ExternalAssessmentDataSource.cs`**
   Mirrors `BillingReadDataSource.cs` / `BillingReadDataSourceHolder` exactly:
   - `ExternalAssessmentDataSource.Build(connectionString)` builds an `NpgsqlDataSourceBuilder` with
     `.EnableUnmappedTypes()` so the native Postgres enum column (`band`, type `"ScoreBand"`, 4 labels:
     `below_average`/`average`/`above_average`/`excellent`) reads into the mapped C# `string?` property.
   - `ExternalAssessmentDataSourceHolder(NpgsqlDataSource) : IDisposable` — a DI wrapper so the
     unmapped-types data source stays exclusive to `ExternalAssessmentDbContext` and never bleeds
     `EnableUnmappedTypes` into the other string-based contexts (Identity/Anchor/Hris/Billing/
     ExternalValidation/Audit) via EFCore.PG's auto-resolution of an app-registered `NpgsqlDataSource`.

4. **`services/Tims.Platform/src/Tims.Api/Program.cs`** (~line 188)
   Changed the plain `AddDbContext<ExternalAssessmentDbContext>(options => options.UseNpgsql(databaseConnectionString))`
   registration to the holder pattern:

   ```csharp
   builder.Services.AddSingleton(_ =>
       new ExternalAssessmentDataSourceHolder(ExternalAssessmentDataSource.Build(databaseConnectionString ?? string.Empty)));
   builder.Services.AddDbContext<ExternalAssessmentDbContext>((sp, options) =>
       options.UseNpgsql(sp.GetRequiredService<ExternalAssessmentDataSourceHolder>().DataSource));
   ```

5. **`services/Tims.Platform/tests/Tims.IntegrationTests/ExternalVendor/ExternalAssessmentFixture.cs`**
   (the Testcontainers fixture — the SECOND registration point, found via grep across `tests/`)
   - `NewReadContext(string? connectionString = null)` now builds via
     `ExternalAssessmentDataSource.Build(connectionString ?? ConnectionString)` instead of a bare
     `UseNpgsql(connectionString ?? ConnectionString)`, so the fixture reads `band` identically to the
     booted host.
   - Schema SQL: added `CREATE TYPE "ScoreBand" AS ENUM ('below_average', 'average', 'above_average',
'excellent');` and `band "ScoreBand" NULL, norm_sample_size integer NULL` columns to the
     `assessment_results` table DDL.
   - Seed SQL: added `band`/`norm_sample_size` values to all 6 seeded rows (a mix of populated and
     `NULL`, including the in-progress/leak-candidate row and the cross-org row) so the enum column is
     genuinely exercised end-to-end through the real Postgres container.

6. **`services/Tims.Platform/src/Tims.Infrastructure/ExternalVendor/ExternalAssessmentRepository.cs`**
   - `Projection` expression: added `r.Band, r.NormSampleSize,` after `r.Percentile,`.
   - `ProjectedRow` record: added `string? Band, int? NormSampleSize,` after `Percentile`.
   - `MapRow`'s `new ExternalResultRow(...)` call: added `r.Band, r.NormSampleSize,` after `r.Percentile,`.
   - Updated doc comment ("six scored fields" → "eight scored fields").

7. **`services/Tims.Platform/src/Tims.Domain/ExternalVendor/ExternalAssessmentResultV1.cs`**
   - `ExternalResultRow` record: added `string? Band, int? NormSampleSize,` after `Percentile`.
   - `ExternalAssessmentResultV1` record: added `string? Band, int? NormSampleSize,` after `Percentile`.
   - `ExternalAssessmentResultV1Mapper.Map`: added `Band: row.Band, NormSampleSize: row.NormSampleSize,`
     after `Percentile:`.
   - Updated doc comments ("six scored fields" → "eight scored fields", 2 occurrences).

### C# — fixtures/tests consuming the widened records

8. **`services/Tims.Platform/tests/Tims.UnitTests/Fixtures/FixtureModels.cs`**
   Added `string? Band, int? NormSampleSize,` (after `Percentile`) to both `V1InputRow` and `V1Expected`,
   matching the JSON fixture's camelCase → PascalCase convention used for every other field.

9. **`services/Tims.Platform/tests/Tims.UnitTests/Fixtures/ExternalAssessmentResultV1FixtureTests.cs`**
   Added `c.Input.Band, c.Input.NormSampleSize,` to the `new ExternalResultRow(...)` construction, and
   `Assert.Equal(expected.Band, actual.Band); Assert.Equal(expected.NormSampleSize, actual.NormSampleSize);`
   assertions after the `Percentile` assertion.

10. **`services/Tims.Platform/tests/Tims.UnitTests/ExternalVendor/ExternalAssessmentReadUseCaseTests.cs`**
    (found via a full-repo grep for other `ExternalResultRow` construction sites — this one used
    positional/named-argument `=> new(...)` syntax, so it wasn't caught by the initial plan's file list)
    Its `Row(string assignmentId)` helper builds an `ExternalResultRow` with named arguments; added
    `Band: null, NormSampleSize: null,` after `Percentile: 3,` to keep it compiling.

### Shared golden fixture

11. **`contracts/external-fixtures/assessment-result-v1.json`**
    Added `"band"` / `"normSampleSize"` to both `input` and `expected` in all 3 cases:
    - Case 1 ("full row"): `"band": "above_average", "normSampleSize": 12`
    - Case 2 ("null-heavy row"): `"band": null, "normSampleSize": null`
    - Case 3 ("opaque scalar JSON passthrough"): `"band": "average", "normSampleSize": 5`

### TypeScript

12. **`packages/api/src/dto/external-assessment.ts`**
    Added `band: string | null;` and `normSampleSize: number | null;` to both `ExternalAssessmentResultV1`
    and `ExternalResultRow` interfaces (after `percentile`), and `band: row.band, normSampleSize:
row.normSampleSize,` to `toExternalAssessmentResultV1`'s return object (after `percentile:`).

13. **`packages/api/src/services/external-assessment.service.ts`**
    Added `band: string | null;` and `normSampleSize: number | string | null;` to
    `RawExternalAssessmentResultV1` (after `percentile`, following the existing "C# minimal-API might
    serialize numbers as strings" pattern), and `band: raw.band, normSampleSize:
numOrNull(raw.normSampleSize),` to `mapRawResultV1`'s return.

14. **`tests/external-vendor/assessment-result-v1-fixtures.test.ts`**
    Added `band`/`normSampleSize` fields to the local `InputRow`/`ExpectedV1` interfaces, to the
    constructed `row: ExternalResultRow` object, and two new `expect(...)` assertions.

15. **`tests/access/external-assessment-api.test.ts`** (found via `tsc --noEmit` — NOT in the original
    file list; this test constructs an `ExternalResultRow` object literal directly and asserts the
    mapped `dto` via `toEqual`)
    Added `band: 'above_average', normSampleSize: 30,` to both the input `row` object and the expected
    `dto` object in the `toEqual(...)` assertion.

## Verification

All 6 required checks were run; all passed. Two consumer sites not listed in the original file plan
were found and fixed via compiler/build errors (see items 10 and 15 above) — both are now included.

### 1. The originally-failing pin test

```
cd services/Tims.Platform
dotnet test tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj --filter "FullyQualifiedName~ExternalAssessmentProjectionPinTests"
```

```
Passed!  - Failed: 0, Passed: 1, Skipped: 0, Total: 1, Duration: 39 ms
```

### 2. Full C# suite (CI's exact invocation, per `.github/workflows/dotnet-platform.yml`)

```
cd services/Tims.Platform
dotnet build Tims.Platform.slnx -c Release
```

First attempt failed: `ExternalAssessmentReadUseCaseTests.cs(154,66): error CS7036` — a missed
`ExternalResultRow` construction site (item 10 above). Fixed, rebuilt clean:

```
Build succeeded. 0 Warning(s) 0 Error(s)
```

```
dotnet test tests/Tims.UnitTests/Tims.UnitTests.csproj --no-build -c Release
```

```
Passed! - Failed: 0, Passed: 782, Skipped: 0, Total: 782, Duration: 619 ms
```

```
dotnet test tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj --no-build -c Release --filter "Category!=LiveNetwork"
```

```
Passed! - Failed: 0, Passed: 1011, Skipped: 0, Total: 1011, Duration: 1 m 34 s
```

This run includes the Testcontainers-backed `ExternalAssessmentFixture`-based tests
(`ExternalAssessmentReadTests`, `ExternalAssessmentEndpointAuthTests`), which spin up a real Postgres
16-alpine container, `CREATE TYPE "ScoreBand" AS ENUM (...)`, and read `band` back through the
`EnableUnmappedTypes` data source end-to-end — **the `EnableUnmappedTypes` approach is confirmed to
work against real Postgres**, not just compile.

### 3. TS fixture test

```
npx vitest run tests/external-vendor/assessment-result-v1-fixtures.test.ts
```

```
Test Files  1 passed (1)
     Tests  3 passed (3)
```

### 4. Full TS suite

```
npx vitest run
```

First run surfaced no test _failures_ (esbuild transpiles without type-checking), but `tsc` (next step)
caught a second missed consumer. After fixing it:

```
Test Files  276 passed (276)
     Tests  2595 passed (2595)
```

### 5. `pnpm --filter @tims/api exec tsc --noEmit`

First run: 2 errors in `tests/access/external-assessment-api.test.ts` (item 15 above — an
`ExternalResultRow` object literal and its expected `toEqual` shape both missing the two new fields).
Fixed; clean:

```
(no output — exit 0)
```

### 6. `apps/web` tsc (not explicitly requested but part of the project's standard dual-tsc gate)

```
cd apps/web && npx tsc --noEmit
```

Clean (no output).

## Side effect: regenerated OpenAPI spec

Building `Tims.Api` regenerates `contracts/openapi/Tims.Api.json` via the
`Microsoft.Extensions.ApiDescription.Server` MSBuild target. The diff is exactly the expected contract
widening — `band`/`normSampleSize` added to the `ExternalAssessmentResultV1` schema's `required` array
and `properties` — and has been committed alongside the code change so the published OpenAPI contract
stays in sync with the actual API.

## Concerns

- None outstanding. No `InvalidCastException` or enum-read failure was observed anywhere in the 1011
  Testcontainers-backed integration tests — the `EnableUnmappedTypes` pattern works identically to the
  existing `BillingReadDataSource` precedent.
- Two consumer sites were missing from the original task's file list (`ExternalAssessmentReadUseCaseTests.cs`
  and `tests/access/external-assessment-api.test.ts`). Both were caught by the compiler/type-checker
  (not by silent runtime failure) and fixed. This is a reminder that a full-repo grep for the touched
  record types is worth doing before declaring a cross-cutting record change complete, even when a task
  spec enumerates specific files.
- The seeded `band`/`norm_sample_size` values in `ExternalAssessmentFixture.cs`'s Postgres seed data are
  new (not specified by the task) — chosen to exercise both populated and `NULL` cases across the
  existing rows without altering any existing test assertion (verified: all assertions in
  `ExternalAssessmentReadTests.cs` / `ExternalAssessmentEndpointAuthTests.cs` check only fields other
  than `band`/`normSampleSize`, or exact counts/ids, none of which changed).

## Commit

`7f6ee85` — `fix(external-vendor): extend v1 API to return band + normSampleSize`
(16 files changed: 15 modified + 1 new — `ExternalAssessmentDataSource.cs`)
Not pushed, no PR opened, per instructions — the controller will push.
