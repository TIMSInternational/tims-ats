# Tenant audit migration: first endpoint

The C#/.NET 10 backend now implements `GET /tenant-audit/access-report`, the first of five procedures in the tenant `audit` router. `Platform:TenantAuditReadEnabled` defaults to false. The existing TypeScript router remains active; this is implementation progress, not a completed production cutover.

The endpoint resolves the staff principal, uses the shared `audit:read` authorization decision, and derives the organization from that principal. Shared privileged-role semantics remain unchanged. The repository uses both `TenantScope` (PostgreSQL RLS) and an explicit organization filter. It groups only `access` events by actor and entity, returns at most 50 groups, and applies inclusive date boundaries normalized to UTC. It never loads audit metadata, changes or user details.

This tenant reader is separate from the existing platform-owner cross-organization reader. The `audit_logs` ownership remains `efcoreAppendOnly`, with Prisma retaining DDL ownership; no schema or writer ownership changes occur here.

## Verification

The audit integration suite passed all 37 tests, including 14 new tenant cases. API and web TypeScript checks and the table-ownership gate passed. The OpenAPI contract and generated frontend types were updated.

The new real-PostgreSQL cases cover HTTP authorization, tenant exclusion, inclusive/timezone-normalized dates, malformed dates, default-off routing, null actors, aggregation/ranking, the result cap, empty tenants, and RLS without an application filter. These are not differential tests against the TypeScript runtime. C# adds deterministic actor/entity tie-breakers to count ordering; TypeScript leaves ties unspecified, so tied membership at the 50-group boundary can differ.

Same-model security and claim reviews found no blocking defect. The coverage review led to explicit RLS and ranking assertions. Cross-model verification was not performed; external repository submission was previously blocked by automatic approval review.

## Remaining work

- Port `listLogs`, `getLogDetail`, `exportLogs`, and `getChangesByEntity`, preserving nested response fields, pagination, export redaction, CSV safety and export audit behavior.
- Verify tenant-specific impersonation and authenticated staging behavior before enabling the flag.
- Run differential acceptance and inventory all consumers before retiring TypeScript procedures.
- Keep the separate platform-owner audit routes and their cross-organization behavior intact.
