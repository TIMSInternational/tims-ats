import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertSubjectInScope } from '../../packages/api/src/access/write-rules';
import type { AccessContext } from '../../packages/api/src/access';

// WP2.5a: the shared subject-in-scope golden fixtures (contracts/access-fixtures/subject-in-scope.json),
// asserted here against the REAL TS assertSubjectInScope and identically by Tims.UnitTests
// (SubjectInScope.IsSatisfiedAsync → bool). expected=true means the write is allowed (TS resolves
// without throwing); expected=false means it throws FORBIDDEN (caught → false here).

interface SubjectCase {
  name: string;
  scope: string;
  userId: string;
  targetUserId: string;
  teamMembers: string[];
  unitMembers: string[];
  hasAnchors: boolean;
  expected: boolean;
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/access-fixtures/subject-in-scope.json', import.meta.url)), 'utf8'),
) as { description: string; cases: SubjectCase[] };

const makeLoader = (c: SubjectCase) => ({
  teamMemberIds: async () => c.teamMembers,
  unitIds: async () => [],
  panelInterviewIds: async () => [],
  ledTeamIds: async () => [],
  unitMemberIds: async () => c.unitMembers,
});

const ctx = (c: SubjectCase): AccessContext =>
  ({ allowed: true, scope: c.scope, roles: [], anchors: c.hasAnchors ? makeLoader(c) : null }) as unknown as AccessContext;

describe('subject-in-scope-fixtures.json — real assertSubjectInScope', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    let allowed = true;
    try {
      await assertSubjectInScope(ctx(c), c.userId, c.targetUserId, 'msg');
    } catch {
      allowed = false;
    }
    expect(allowed).toBe(c.expected);
  });
});
