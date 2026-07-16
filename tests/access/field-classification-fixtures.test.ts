import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fieldsVisibleTo } from '../../packages/api/src/access/classification';
import { selectFor } from '../../packages/api/src/access/select-for';

// Phase-5 Slice 1: the SAME golden fixtures asserted by the C# FieldClassification kernel
// (contracts/access-fixtures/field-classification.json) are asserted here against the REAL TS
// fieldsVisibleTo / selectFor. A behavior change (e.g. dropping 'external' from a field's roles) edits
// the JSON once; either stack disagreeing turns its CI red. This is the production-TS oracle that pins
// the classification ceiling the C# port must reproduce.

interface FieldCase {
  name: string;
  kind: 'fieldsVisibleTo' | 'selectFor';
  roles: string[];
  entity: string;
  expected: string[];
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/access-fixtures/field-classification.json', import.meta.url)), 'utf8'),
) as { description: string; cases: FieldCase[] };

describe('field-classification.json — real fieldsVisibleTo / selectFor', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    if (c.kind === 'fieldsVisibleTo') {
      // Order-sensitive: registry-declaration order.
      expect(fieldsVisibleTo(c.roles, c.entity)).toEqual(c.expected);
      return;
    }
    // selectFor returns a Prisma select object; its key order is anchors-then-visible-fields (insertion
    // order), which the fixture pins as an ordered array.
    expect(Object.keys(selectFor(c.roles, c.entity))).toEqual(c.expected);
  });
});
