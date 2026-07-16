import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scopeWhereFor, type ScopedEntity } from '../../packages/api/src/access/entity-policies';
import type { AccessContext } from '../../packages/api/src/access';

// WP2.5a: the shared scope-where golden fixtures (contracts/access-fixtures/scope-where.json),
// asserted here against the REAL TS scopeWhereFor and identically by Tims.UnitTests
// (ScopeWhereFor.BuildAsync → ScopePredicate.ToJsonNode). A behavior change edits the JSON
// once; either stack disagreeing turns its CI red. This test is the production-TS oracle
// that pins the fixtures — the C# port must reproduce these exact Prisma fragments.

interface AnchorArrays {
  ledTeamIds: string[];
  unitIds: string[];
  teamMemberIds: string[];
  unitMemberIds: string[];
  panelInterviewIds: string[];
}
interface ScopeCase {
  name: string;
  entity: string;
  scope: string;
  userId: string;
  anchors: AnchorArrays | null;
  expected: Record<string, unknown> | null;
  expectError?: string;
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/access-fixtures/scope-where.json', import.meta.url)), 'utf8'),
) as { description: string; cases: ScopeCase[] };

// A fixture's anchor arrays drive a request-local loader stub — no DB, exactly the shape
// the real createAnchorLoader returns. FORBIDDEN cases pass anchors: null.
const makeLoader = (a: AnchorArrays) => ({
  teamMemberIds: async () => a.teamMemberIds,
  unitIds: async () => a.unitIds,
  panelInterviewIds: async () => a.panelInterviewIds,
  ledTeamIds: async () => a.ledTeamIds,
  unitMemberIds: async () => a.unitMemberIds,
});

const ctx = (c: ScopeCase): AccessContext =>
  ({ allowed: true, scope: c.scope, roles: [], anchors: c.anchors ? makeLoader(c.anchors) : null }) as unknown as AccessContext;

describe('scope-where-fixtures.json — real scopeWhereFor', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    if (c.expectError) {
      await expect(scopeWhereFor(c.entity as ScopedEntity, ctx(c), c.userId)).rejects.toMatchObject({
        code: c.expectError,
      });
      return;
    }
    const actual = await scopeWhereFor(c.entity as ScopedEntity, ctx(c), c.userId);
    expect(actual).toEqual(c.expected);
  });
});
