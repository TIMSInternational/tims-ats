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
- C# requires a cursor to belong to the active tenant and filters. Callers must reset pagination when filters change; TypeScript can locate an ID cursor independently of the filters.
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
