import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { externalScopeSatisfied } from '../../packages/api/src/access/external-scope';

// Phase-5 Slice 2: the SAME golden fixture asserted by the C# ExternalScope.ExternalScopeSatisfied
// (contracts/external-fixtures/validation-submit-scope.json) is asserted here against the REAL TS
// externalScopeSatisfied. Every case runs with alwaysEnforceScope=true (the vendor WRITE), so the
// empty-scope case is DENIED — the contrast with the read surface's wildcard. Bites: flipping
// alwaysEnforceScope to false makes the empty-scope case go TRUE.

interface ScopeCase {
  name: string;
  requiredScope: string | null;
  scopes: string[];
  alwaysEnforceScope: boolean;
  expected: boolean;
}

const data = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../contracts/external-fixtures/validation-submit-scope.json', import.meta.url)),
    'utf8',
  ),
) as { description: string; cases: ScopeCase[] };

describe('validation-submit-scope.json — real externalScopeSatisfied (alwaysEnforce)', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const actual = externalScopeSatisfied(c.requiredScope ?? undefined, c.scopes, c.alwaysEnforceScope);
    expect(actual).toBe(c.expected);
  });
});
