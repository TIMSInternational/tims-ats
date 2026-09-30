# C# assessment-type authoring — F13 (PR #309)

Implemented, default disabled. Greenfield .NET 10: before this slice the only TypeScript surface was the read-only
`assessment.listTypes`; there was never a TS writer to port or delete. No production flag, IAM or DDL changed.

## API

All three routes use `AssessmentStaffGate` (the `permissionProcedure('assessment', action)` analogue) and then
require organization/company scope, because assessment types are an org-wide catalog.

| Route                                     | Grant               | Statuses                          |
| ----------------------------------------- | ------------------- | --------------------------------- |
| `POST /assessments/types`                 | `assessment:create` | 200 / 400 / 401 / 403 / 409       |
| `PATCH /assessments/types/{id}`           | `assessment:update` | 200 / 400 / 401 / 403 / 404 / 409 |
| `POST /assessments/types/{id}/deactivate` | `assessment:update` | 200 / 401 / 403 / 404             |

Order: auth (401/403) → body validation (400) → org scope (403) → write. Bodies are parsed after the gate (TRAP 9).
The org is always the caller's resolved org; an `organizationId` key is a 400 (strict body). Every write runs under
`TenantScope` with an explicit `organization_id` filter, so another org's id is a 404, and writes its `audit_logs`
row in the same transaction (fail-closed). Deactivation is soft (`is_active = false`) and idempotent.

## Name and code rules

- `code` is derived from the name on create (accent-folded, lower-cased, non-alphanumerics → `_`) and is immutable.
  It must be unique per org across ALL rows (`assessment_types_organization_id_code_key`).
- A **409** is only a case-insensitive clash with another **active** type's name.
- Accent/punctuation variants ("Lógica" vs "Logica") are different names: they share a base code, which is
  suffixed (`logica_2`) → 200.
- A **deactivated** type does not reserve its name (there is no reactivate endpoint, and the UI hides inactive
  types). It keeps its code, so a new type reusing the name gets a suffixed code. A reactivate endpoint, if ever
  added, must re-check the name against active types.

### Known gap — concurrent renames

The name check is check-then-act with no database backstop. Two concurrent creates of the same name are caught by
the code index (same derived code → one 23505 → 409). Two concurrent **renames** to the same name are not: codes
are immutable and differ, so both commit. The fix is
`CREATE UNIQUE INDEX … ON assessment_types (organization_id, lower(name)) WHERE is_active`. It is not in this
slice because:

1. the table's DDL is Prisma-owned and Prisma 6.8 (no `partialIndexes` preview) cannot express an expression /
   partial index — `prisma db push` would treat it as drift; and
2. production may already contain active same-name rows (TS never enforced name uniqueness), which would make the
   index fail. Before any such migration, run this **read-only** check against production:

```sql
SELECT organization_id, lower(name) AS name_key, count(*) AS n, array_agg(id) AS ids
FROM assessment_types
WHERE is_active
GROUP BY organization_id, lower(name)
HAVING count(*) > 1;
```

## Web

`apps/web/lib/platform-api/assessment-types.ts` (dual-path is impossible — there is no tRPC writer) is dark unless
both `NEXT_PUBLIC_TIMS_PLATFORM_API_URL` and `NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP=true`. The error mapper
distinguishes a handler 404 (`{ message }` body → "type no longer exists") from an unmapped-route 404 (no body →
"unavailable").

**Flip order:** set `Platform__AssessmentTypeWriteEnabled=true` on App Runner and run
`verify-write assessment-types` FIRST; only then build Vercel with `NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP=true`
(`NEXT_PUBLIC_*` is inlined at build time). The reverse order makes every save show "unavailable".

## Parity harness

Registered in `scripts/parity/write-surfaces.ts` as `assessment-types` (3 endpoints). Grant fixture
`seedAssessmentTypeGrants` copies `seed-access-matrix.ts`: hr_admin `assessment` read/create/update @organization,
hrbp read @unit. The probe is **hr_admin**, not super_admin — super_admin is privileged in `PermissionService` and
never reads `role_permissions`, so only hr_admin's 200 proves the grant. hrbp is the grant-level DENIED role.
update/deactivate probe an org-B fixed row (→ 404, untouched); create has no IDOR target. Fixture rows are reset
each run; teardown deletes the parity orgs' `assessment_types` explicitly because `organization_id` has no FK.

**`verify-write assessment-types` has never been run against any live stack.** Its readbacks are unit-tested
(`scripts/parity/write-surfaces.test.ts`), not exercised. `scripts/deploy/cutover.sh` lists the surface as
`assessment-types-write`, BLOCKED on that run.

## Ownership

`assessment_types` is `efcoreStranglerWrite` (see the `assessment_type_authoring_f13` ledger note). The premise that
no TS runtime path writes it is enforced by `tests/governance/assessment-types-no-ts-writers.test.ts`; the demo
seed's single find-or-create is the one allowed writer.

## Evidence

Real-host integration tests (Testcontainers Postgres with forced RLS as `app_tenant`) cover 401 (no/tampered token,
before body validation, deactivate), 403 (no grant and narrow scope on create, update and deactivate), 400, 404 (dark
flag, cross-org, missing), 409 (active-name duplicate), 200 + suffixed code (deactivated name reuse, accent variant),
the exact response key set, audit rows and the lifecycle. Unit tests cover the parsers and code derivation. None of
this proves production grants or a live flip.
