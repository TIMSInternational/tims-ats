# Tenant audit migration: five C# operations

The C#/.NET 10 backend implements all five procedures of the tenant audit router. `Platform:TenantAuditReadEnabled` defaults to false. The existing TypeScript router remains active; implementation is complete for these operations, but production cutover and retirement are not.

| TypeScript procedure | C# endpoint |
|---|---|
| getAccessReport | GET /tenant-audit/access-report |
| getLogDetail | GET /tenant-audit/logs/{id} |
| listLogs | GET /tenant-audit/logs |
| getChangesByEntity | GET /tenant-audit/history |
| exportLogs | POST /tenant-audit/export |

Each route resolves the staff principal, uses the shared `audit:read` or `audit:export` authorization decision, and derives the organization from that principal. Shared privileged-role semantics remain unchanged. All repository queries use `TenantScope` (PostgreSQL RLS) and explicit organization predicates, including cursor anchors and related people. Export projects out changes/metadata before materialization, returns at most 10,000 rows with a truncation flag, and escapes CSV formulas. Its bounded best-effort audit write uses the impersonating owner when applicable, retains the target tenant, and is independent of request cancellation.

The tenant reader is separate from the platform-owner cross-organization reader. `audit_logs` stays `efcoreAppendOnly`, with Prisma retaining DDL ownership; no schema or writer ownership changes occur.

## Verification

All 69 audit integration tests passed, including 46 tenant cases. Tests exercise real HTTP/JWT/permissions and PostgreSQL with RLS. Coverage includes denied callers, read-only permission denied export, foreign log IDs and related people, inclusive/timezone-normalized dates, nested JSON, default-off routes, null actors, grouped ranking, response caps, tied/mixed-date pagination, exact history filtering, CSV formula escaping, JSON Unicode handling, export redaction/truncation, and impersonation attribution.

All 3,269 JavaScript tests passed, including the route-inventory gate that initially caught the unregistered route. The inventory now explicitly records these five dark routes as pending differential acceptance, following its existing documented-gap mechanism. This does not count them as parity-verified. The OpenAPI and frontend schemas include all five operations. API and web TypeScript checks and the table-ownership check passed.

Same-model security and claim reviewers found no blocking defect; findings led to permission, impersonation, encoding and pagination coverage. External cross-model review was not performed because automatic approval review previously blocked external repository submission.

## Compatibility and remaining acceptance

- These are integration tests against an isolated SQL fixture, not differential execution of TS and C#.
- C# adds deterministic actor/entity ties for grouped counts and timestamp/ID ties for pages/exports. TypeScript leaves ties unspecified, so tied bounded-result membership can differ.
- C# requires a cursor to belong to the active tenant and filters. A direct Prisma/PostgreSQL probe confirmed the same behavior: an existing cursor excluded by the action filter returns an empty page. The earlier claim that Prisma would continue from that cursor was incorrect. Callers should reset pagination when filters change.
- Related people are independently tenant-filtered. Foreign or organizationless actor references return null identities; raw actor/user IDs remain part of the existing audit record contract.
- Before enabling the flag, add nonempty differential fixtures and shared harness registration, exercise authenticated staging, and inventory all consumers before retiring TypeScript procedures.
- Keep the separate platform-owner audit routes and cross-organization behavior intact.

## Frontend export wiring and rollout

`/settings/audit-log` now uses `useTenantAuditExport`. The build-time flag
`NEXT_PUBLIC_TENANT_AUDIT_VIA_CSHARP=true`, together with the configured platform API URL,
selects POST `/tenant-audit/export` through the same-origin authenticated relay. Otherwise the
existing tRPC export remains selected. The wrapper never retries against the other backend
following an error. It validates the response before the page downloads it and preserves the
existing pending, error and truncation messages.

The four read procedures currently have no frontend consumers. Their C# endpoints are retained
as the tenant audit API surface for API clients and future audit views; this PR does not build
unused UI or remove existing tRPC API contracts before acceptance.

Rollout order:
1. Merge and deploy the C# endpoint implementation before changing browser routing.
2. Complete nonempty differential fixtures and authenticated staging checks for export/read access.
3. Enable `Platform__TenantAuditReadEnabled=true` on the backend and verify the routes.
4. Set `NEXT_PUBLIC_TENANT_AUDIT_VIA_CSHARP=true` for the frontend deployment and rebuild; this flag is inlined at build time.
5. Verify CSV/JSON downloads, filter behavior, denied read-only users, and impersonated export attribution.
6. Inventory external consumers before retiring the tRPC audit router/service/repository. Browser rollback is a rebuild with the frontend flag false while the TypeScript implementation remains available.

The full JavaScript suite passed 3,276 tests across 332 files after this wiring; API and web type checks passed. No live flag changes were made as part of the frontend wiring. Seven runtime hook tests cover
both routing branches, authenticated relay dispatch, numeric normalization, response validation,
and failure behavior. The existing client/relay suites cover the shared cookie transport.

## Shared export fixtures and Prisma cursor probe

`contracts/audit-fixtures/tenant-export.json` is consumed by the real TypeScript `auditService.exportLogs`
and C# `TenantAuditReadUseCase.ExportAsync` tests. All four cases agree byte-for-byte: populated and
empty CSV/JSON, including Unicode/HTML-sensitive characters, formulas, embedded commas/quotes/newlines,
and null actor/optional fields. Repository responses are substituted here; this proves service-level
serialization compatibility, not SQL, HTTP authorization or staging parity.

A separate local Prisma probe used an isolated PostgreSQL 16 database with three synthetic audit rows:
Jan 3 `other`, Jan 2 `access`, Jan 1 `access`. Querying `action=access`, createdAt descending,
`cursor=Jan 3 row`, `skip=1`, `take=2` returned `[]`. Using the Jan 2 access cursor returned only Jan 1.
This removes the previously reported cursor/filter difference. The C# integration suite now pins the
excluded-cursor empty-page case. No production database was queried or changed for this probe.

Latest verification: 70 audit integration tests, four C# export fixture tests, 3,280 JavaScript
tests (333 files), and API/web type checks passed. The regression cursor is deliberately newer
than both matching rows, so accepting it outside the active filters would produce visible rows
and fail the test. The internal claim review identified and corrected a weaker older-cursor test.

## Actual database differential acceptance — 2026-09-14

`TenantAuditCrossRuntimeTests` starts isolated PostgreSQL through the existing Testcontainers
fixture and executes both production service/repository paths against that same database:
Prisma with `runWithTenant`/RLS, and EF with `TenantScope`. No repository mocks are used.
Seventeen named outputs compare exactly: access report, list, foreign-entity list, excluded cursor,
detail, redacted actor, history, first/middle/last pages of list and history, CSV, JSON, date-filtered JSON, and 10,000-row truncation.
The test passed locally. It deliberately avoids unspecified ordering ties; tied-order behavior
remains documented above and separately covered on the C# side.

CI now runs this in `Tenant audit cross-runtime parity`, with both Node/pnpm and .NET 10.
Ordinary .NET CI excludes `Category=CrossRuntime` and the dedicated job runs it explicitly.
Workflow triggers include the TS audit service/repository, CSV helper, root package manifest and dependency lockfile so either implementation
changing reruns the comparison. The Node companion refuses any database other than the isolated
local `tims_tenant_audit` database. The parent supplies the temporary connection only through the
environment, never command arguments or test output.

Reproduce after installing workspace dependencies and generating Prisma:

```sh
dotnet test services/Tims.Platform/tests/Tims.IntegrationTests/Tims.IntegrationTests.csproj --filter Category=CrossRuntime
```

This closes local service/repository differential coverage for the listed cases. It does not
claim HTTP authorization parity, live production acceptance or full shared remote-harness
registration. The current AWS account exposes one production App Runner API, with no separate
staging App Runner service discovered. No production data or deployment flags were changed.

The export-cap fixture now has 10,005 distinct record IDs and timestamps. The comparison preserves
ordering, and an independent integration assertion pins the first record to `10005` and last
retained record to `6`. Cursor comparisons include successful first/middle/last traversal in both
list and history, rather than only empty/single-page results. These additions address internal
review findings; no array sorting or field dropping masks comparison differences.

Validation after the expanded fixture: all 71 audit integration tests passed, including the
cross-runtime comparison. The full existing JavaScript suite passed 3,280 tests; the two new
CI regression guards subsequently passed with all 11 focused CI/inventory tests. API/web type
checks passed. Internal review found no blocking harness defect; its coverage suggestions were
implemented above.
