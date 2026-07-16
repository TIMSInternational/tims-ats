import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Spike B: the SAME golden fixtures asserted by the C# Tims.UnitTests
// (contracts/access-fixtures/*.json) are asserted here against the REAL TypeScript
// kernel. A behavior change edits the JSON once; either stack disagreeing turns its
// CI red. See docs/architecture/csharp-migration/phase-1-runway-and-spikes.md (WP1.5).

// db + cache are mocked so buildAccessForUser can be driven from fixture grants without
// a database (mirrors tests/access/build-access.test.ts).
vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
}));
vi.mock('@tims/db', () => ({
  db: { rolePermission: { findMany: vi.fn() } },
  tenantDb: {},
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

import { db } from '@tims/db';
import { buildAccessForUser } from '../../packages/api/src/access/build';
import { resolveAccess, widestScope } from '../../packages/api/src/access/resolve';
import { requireOrgScope } from '../../packages/api/src/access/org-gate';
import { externalScopeSatisfied } from '../../packages/api/src/access/external-scope';
import { suppressBelowMin5, aggregateGroups } from '../../packages/api/src/access/aggregate';
import { aggregate360Report } from '../../packages/api/src/services/evaluation360-aggregate';
import type { AccessContext, AccessScope } from '../../packages/api/src/access/types';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../contracts/access-fixtures/${name}`, import.meta.url)), 'utf8'));

interface GrantDto { role: string; module: string; action: string; scope: string }
interface ExpectedDecision { allowed: boolean; scope?: string; roles?: string[] }

beforeEach(() => vi.clearAllMocks());

// --- resolve-access -------------------------------------------------------------------
describe('access-fixtures: resolve-access.json', () => {
  const data = fixture('resolve-access.json') as { cases: Array<{ name: string; grants: GrantDto[]; module: string; action: string; expected: ExpectedDecision }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // resolveAccess re-validates scope strings via isAccessScope, so the raw DTO scope is accepted.
    const decision = resolveAccess(c.grants as never, c.module, c.action);
    expect(decision).toEqual(normalize(c.expected));
  });
});

// --- widest-scope ---------------------------------------------------------------------
describe('access-fixtures: widest-scope.json', () => {
  const data = fixture('widest-scope.json') as { cases: Array<{ name: string; scopes: string[]; expected: string }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(widestScope(c.scopes as AccessScope[])).toBe(c.expected);
  });
});

// --- build-access ---------------------------------------------------------------------
describe('access-fixtures: build-access.json', () => {
  const data = fixture('build-access.json') as {
    cases: Array<{
      name: string;
      principal: { roles: string[]; organizationId: string | null; isPlatformOwner: boolean };
      grants: GrantDto[];
      module: string;
      action: string;
      expected?: ExpectedDecision;
      expectThrow?: string;
    }>;
  };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    vi.mocked(db.rolePermission.findMany).mockResolvedValue(
      c.grants.map((g) => ({ scope: g.scope, role: { slug: g.role }, permission: { module: g.module, action: g.action } })) as never,
    );
    const user = { id: 'u', organizationId: c.principal.organizationId, roles: c.principal.roles, isPlatformOwner: c.principal.isPlatformOwner };

    if (c.expectThrow === 'org_required') {
      await expect(buildAccessForUser(user, c.module, c.action)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      return;
    }
    const decision = await buildAccessForUser(user, c.module, c.action);
    expect(decision).toEqual(normalize(c.expected!));
  });
});

// --- require-org-scope ----------------------------------------------------------------
describe('access-fixtures: require-org-scope.json', () => {
  const data = fixture('require-org-scope.json') as { cases: Array<{ name: string; scope: string; expected: boolean }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const access = { allowed: true, scope: c.scope, roles: [], anchors: null } as unknown as AccessContext;
    let satisfied = true;
    try {
      requireOrgScope(access);
    } catch {
      satisfied = false;
    }
    expect(satisfied).toBe(c.expected);
  });
});

// --- external-scope -------------------------------------------------------------------
describe('access-fixtures: external-scope.json', () => {
  const data = fixture('external-scope.json') as { cases: Array<{ name: string; requiredScope: string | null; scopes: string[]; alwaysEnforceScope: boolean; expected: boolean }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(externalScopeSatisfied(c.requiredScope ?? undefined, c.scopes, c.alwaysEnforceScope)).toBe(c.expected);
  });
});

// --- k-anon-min5 ----------------------------------------------------------------------
describe('access-fixtures: k-anon-min5.json (suppressBelowMin5)', () => {
  const data = fixture('k-anon-min5.json') as { suppressCases: Array<{ name: string; count: number; expected: { suppressed: boolean; count: number | null } }> };
  it.each(data.suppressCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(suppressBelowMin5(c.count)).toEqual(c.expected);
  });
});

describe('access-fixtures: k-anon-min5.json (aggregateGroups)', () => {
  const data = fixture('k-anon-min5.json') as { groupCases: Array<{ name: string; keys: string[]; expected: Array<{ key: string; count: number | null; suppressed: boolean }> }> };
  it.each(data.groupCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const groups = aggregateGroups(c.keys.map((k) => ({ k })), (r) => r.k);
    expect(groups).toEqual(c.expected);
  });
});

// --- eval360-min3 ---------------------------------------------------------------------
describe('access-fixtures: eval360-min3.json', () => {
  interface Row { assignmentId: string; relationship: string; competencyKey: string; rating: number; comment: string | null }
  const data = fixture('eval360-min3.json') as { cases: Array<{ name: string; rows: Row[]; expected: unknown[] }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const buckets = aggregate360Report(c.rows as never);
    expect(buckets).toEqual(c.expected);
  });
});

/** Denied fixtures carry only { allowed:false }; strip undefined scope/roles for toEqual. */
function normalize(expected: ExpectedDecision): ExpectedDecision {
  return expected.allowed ? { allowed: true, scope: expected.scope, roles: expected.roles } : { allowed: false };
}
