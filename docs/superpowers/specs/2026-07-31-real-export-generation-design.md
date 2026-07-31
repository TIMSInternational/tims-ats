# Real Export Generation (Candidate Pool + Audit Log) Design

> Status: APPROVED (Federico, 2026-07-31, conversational approval — see brainstorming
> session). DEI report generation explicitly OUT of scope — filed as a separate
> follow-up (needs its own scoping around C# vs. orphaned-TS-data source question).

## Context

Three export mutations in the codebase are fake stubs (verified by reading the code, not
just trusting `docs/REMAINING-WORK.md`):

- `candidate.pool.export` (`packages/api/src/routers/candidate/pool.ts`) — fabricates a
  `downloadUrl` string, generates no file, applies **no scope filtering at all**.
- `audit.exportLogs` (`packages/api/src/routers/audit.ts`) — returns a "being generated"
  message, generates nothing.
- `dei.generateReport` (`packages/api/src/routers/dei.ts`) — also a stub. **OUT OF SCOPE**:
  most of DEI's real KPI data was C#-migrated and TS-deleted this session-chain; the only
  TS-side data left (`getEthnicityDistribution`/`getDisabilityDistribution`) has zero FE
  consumers today. Building a real report needs a prior decision (C#-proxy call vs.
  reporting on data nobody currently views) — filed as a follow-up GitHub issue, not
  bundled here.

The codebase already has a proven, working export pattern to copy: `platform.exportAgentsCsv`
(`packages/api/src/routers/platform/ai-agents.ts`) builds a CSV string server-side and returns
it directly in the tRPC response; the frontend (`apps/web/app/(admin)/platform/ai-agents/page.tsx`)
wraps it in a `Blob` and triggers a browser download via a `download`-attribute `<a>`. No S3,
no background job (`workers/` is still an empty stub), no polling.

It also already has a security-hardened CSV utility with **zero real production consumers**:
`packages/shared/src/csv.ts` (`csvCell`/`csvRow`) — RFC-4180 quoting plus formula-injection
defense (CWE-1236: neutralizes a leading `=`/`+`/`-`/`@`/tab/CR before quoting). Tested
(`tests/security/csv-export-hardening.test.ts`) but unused in real routers today — this work
becomes its first real consumer. (Aside, not in scope: `exportAgentsCsv` itself doesn't use
this hardened helper and has a latent formula-injection/unescaped-comma gap — not touched here.)

## Decisions from brainstorming

1. **DEI trimmed out of this round** — separate follow-up issue, needs its own scoping.
2. **CSV only for candidate pool** — the input schema currently promises `csv|xlsx`; narrowed
   to `z.literal('csv')` since XLSX needs a new dependency (`exceljs`) for a fairly minor
   formatting preference over CSV. Not adding it this round.
3. **Audit log keeps both `csv` and `json`** — JSON needs zero new work (`JSON.stringify`).
4. **Synchronous generation**, matching CV upload precedent — `workers/` has no background
   job infra, so both exports generate inline in the mutation and return directly.
5. **Reuse `logPlatformExport`** (`packages/api/src/access/security-audit.ts`) for both —
   it's already generic (resolves `organizationId` from `ctx.user.organizationId`, not
   platform-only despite the name) and already has a `truncated` flag built in.
6. **`audit.exportLogs` switches its permission check from `'audit','read'` to
   `'audit','export'`** — that action is already granted to `super_admin` in
   `seed-access-matrix.ts` (line ~40) but unused; matches how `dei.generateReport` already
   gates on `'export'`.

## Candidate pool export

- **Repository** (`packages/api/src/repositories/candidate.repository.ts`): new
  `findForExport(orgId: string, scopeWhere: Prisma.CandidateWhereInput, filters: { poolType?:
string; tags?: string[] }, limit: number)`. Composes `AND: [{organizationId, deletedAt:
null}, scopeWhere, poolType/tags filters]` (same AND-composition convention as every other
  scoped query — never object-spread). `select`: firstName, lastName, email, phone, source,
  poolType, currentTitle, currentCompany, yearsExperience, location, `tags: { select: {tag:
true} }`, createdAt. `take: limit + 1` (fetch one extra to detect truncation, same pattern
  as `listLogs`'s cursor pagination).
- **Service** (`candidate.service.ts`): new `exportPool(orgId, scopeWhere, input: {poolType?,
tags?})`. Calls `findForExport` with `limit = 5000`. `truncated = rows.length > 5000`; slice
  to 5000. Builds CSV: header row + `csvRow([...])` per candidate, joining `tags` as
  `tag1; tag2`. Returns `{ csv: string, count: number, truncated: boolean }`.
- **Router**: `export` procedure's input becomes `{ format: z.literal('csv').default('csv'),
poolType: z.string().max(100).optional(), tags: z.array(z.string().max(100)).max(50).optional()
}`. Adds `scopeWhereFor('candidate', ctx.access, ctx.user.id)` (currently MISSING — the stub
  applies zero scope filtering, a real gap this fixes). Calls
  `candidateService.exportPool(ctx.user.organizationId, scopeWhere, input)`, then
  `logPlatformExport(ctx, { resource: 'candidate_pool', count, format: 'csv', truncated })`,
  returns the result.

## Audit log export

- **Repository** (new `packages/api/src/repositories/audit-export.repository.ts`):
  `findForExport(orgId: string, filters: { dateFrom?: Date; dateTo?: Date }, limit: number)`.
  Same `where` shape as `listLogs` (org + optional createdAt range), `select`: createdAt,
  action, entity, entityId, ipAddress, userAgent, changes, metadata,
  `actor: {select: {firstName:true, lastName:true}}`. `take: limit + 1`.
- **Service** (new `packages/api/src/services/audit-export.service.ts`): `exportLogs(orgId,
input: {format, dateFrom?, dateTo?})`. `limit = 10000`, truncation same pattern as above.
  For `format: 'csv'`: header + `csvRow` per row (columns: Date, Actor, Action, Entity, Entity
  ID, IP Address, User Agent — `changes`/`metadata` JSON blobs are dropped from the CSV
  columns, too unwieldy flattened). For `format: 'json'`: `JSON.stringify(rows)` including
  `changes`/`metadata` in full (JSON handles nested objects natively — no reason to drop them
  there). Returns `{ content: string, count: number, truncated: boolean, format }`.
- **Router**: `exportLogs` procedure switches to `permissionProcedure('audit', 'export')`,
  calls the new service, then `logPlatformExport(ctx, { resource: 'audit_log', count, format,
truncated })`, returns the result.

## Frontend

Both new consumers of the pattern already proven in
`apps/web/app/(admin)/platform/ai-agents/page.tsx`: a `useQuery(..., {enabled: false})`,
triggered by a button's `refetch()`, wraps the returned string in `new Blob([content], {type:
...})` (`text/csv;charset=utf-8;` or `application/json`), creates an `<a>` with a `download`
filename (`candidates-YYYY-MM-DD.csv`, `audit-log-YYYY-MM-DD.csv`/`.json`), clicks it. If
`truncated`, show a toast/banner noting the export was capped at N rows (no silent truncation).
i18n es/en for the new UI copy, per `frontend.md`.

## Testing

- `candidateRepository.findForExport` / `candidateService.exportPool`: unit tests for
  scope-filtering (a narrow-scope caller never sees another team's candidates in the CSV),
  poolType/tags filtering, the 5000-row truncation boundary (5000 exact vs. 5001).
- `audit-export.repository`/`.service`: same shape — date-range filtering, 10000-row
  truncation boundary, CSV vs. JSON column differences (JSON includes `changes`/`metadata`,
  CSV doesn't).
- A CSV-injection regression test per export (a candidate `currentCompany` or audit `action`
  starting with `=`/`+`/`-`/`@` comes back cell-quoted with a neutralizing `'` prefix) —
  exercises the already-tested `csvCell` through its first two real callers.
- Full `pnpm --filter @tims/api exec tsc --noEmit`, web `tsc --noEmit`, `npx vitest run`
  before merge.
