# Real Export Generation (Candidate Pool) Design

> Status: APPROVED (Federico, 2026-07-31, conversational approval — see brainstorming
> session). Scope trimmed to candidate-pool export ONLY. DEI report generation and
> the audit-log track are both OUT of scope — see "Trimmed from this round" below.

## Context

Candidate pool export (`candidate.pool.export`, `packages/api/src/routers/candidate/pool.ts`)
is a fake stub — fabricates a `downloadUrl` string, generates no file, applies **no scope
filtering at all**. Its frontend button (`apps/web/app/(admin)/recruitment/talent-pools/page.tsx`,
`handleExport`) doesn't even call the backend — it's a pure client-side
`toast(t.talentPool.exportStarted)` with no network request. Both ends need real wiring.

### Trimmed from this round (verified by reading the code, not just `docs/REMAINING-WORK.md`)

- **`dei.generateReport`** — most of DEI's real KPI data was C#-migrated and TS-deleted this
  session-chain; the only TS-side data left has zero FE consumers. Needs a prior C#-proxy-vs.
  -orphaned-data scoping decision. Filed as [issue #1](https://github.com/TIMSInternational/tims-ats/issues/1).
- **`audit.exportLogs`** (the org/tenant-scoped `audit.ts` router) — has **zero frontend
  consumers anywhere** (no page, no nav entry calls any procedure on this router). The only
  real, working, shipped audit-log UI in this app (`platform/audit/page.tsx`) calls a
  completely different, already-functional, C#-backed cross-org endpoint
  (`lib/platform-api/audit-log.ts` → `/audit/logs/export`) — not a stub. Building a real
  export for the unreachable TS router produces no visible feature. Filed as
  [issue #2](https://github.com/TIMSInternational/tims-ats/issues/2), which also asks whether
  that router should be built out (with a page) or considered superseded/removed.

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

1. **DEI and audit-log both trimmed out of this round** — see "Trimmed from this round" above.
2. **CSV only** — the input schema currently promises `csv|xlsx`; narrowed to
   `z.literal('csv')` since XLSX needs a new dependency (`exceljs`) for a fairly minor
   formatting preference over CSV. Not adding it this round.
3. **Synchronous generation**, matching CV upload precedent — `workers/` has no background
   job infra, so the export generates inline in the mutation and returns directly.
4. **Reuse `logPlatformExport`** (`packages/api/src/access/security-audit.ts`) — it's already
   generic (resolves `organizationId` from `ctx.user.organizationId`, not platform-only
   despite the name) and already has a `truncated` flag built in.

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

## Frontend

`apps/web/app/(admin)/recruitment/talent-pools/page.tsx`'s `handleExport` is currently a pure
client-side `toast()` with no network call at all — it must be rewired, not just left as-is,
for this to be a real feature. Follows the pattern already proven in
`apps/web/app/(admin)/platform/ai-agents/page.tsx`: a `trpc.candidate.pool.export.useQuery(...,
{enabled: false})`, triggered by the export button's `refetch()`, wraps the returned `csv`
string in `new Blob([csv], {type: 'text/csv;charset=utf-8;'})`, creates an `<a>` with a
`download` filename (`candidates-YYYY-MM-DD.csv`), clicks it. If `truncated`, show a
toast/banner noting the export was capped at 5000 rows (no silent truncation). i18n es/en for
the new UI copy (replacing the existing `exportStarted` toast copy), per `frontend.md`.

## Testing

- `candidateRepository.findForExport` / `candidateService.exportPool`: unit tests for
  scope-filtering (a narrow-scope caller never sees another team's candidates in the CSV),
  poolType/tags filtering, the 5000-row truncation boundary (5000 exact vs. 5001).
- A CSV-injection regression test (a candidate `currentCompany` starting with `=`/`+`/`-`/`@`
  comes back cell-quoted with a neutralizing `'` prefix) — exercises the already-tested
  `csvCell` through its first real production caller.
- Full `pnpm --filter @tims/api exec tsc --noEmit`, web `tsc --noEmit`, `npx vitest run`
  before merge.
