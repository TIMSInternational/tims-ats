import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { aggregate360Report, type AggregateInputRow } from '../../packages/api/src/services/evaluation360-aggregate';

// Honest-fixture rule (tims-csharp-port-regression-corpus): the shared golden
// contracts/access-fixtures/eval360-min3.json is asserted by the C# kernel
// (services/Tims.Platform/tests/Tims.UnitTests/Fixtures/Eval360FixtureTests.cs) AND,
// here, by the REAL live TS `aggregate360Report` export. Without this TS-side
// assertion the fixture pins ONLY the C# port — a future TS change to the anonymity
// rules would drift silently. A behavior change now edits the JSON once; either stack
// disagreeing turns its CI red. Covers the min-3 suppress-by-omission edge cases
// (0/1/2-rater omission, distinct-by-assignmentId counting, JS Math.round to 2dp,
// first-seen competency order, fixed self/manager/peer/direct_report emission order).

interface ExpectedCompetency {
  competencyKey: string;
  average: number;
}

interface ExpectedBucket {
  relationship: string;
  raterCount: number;
  competencies: ExpectedCompetency[];
  comments: string[] | null;
}

interface Eval360Case {
  name: string;
  rows: AggregateInputRow[];
  expected: ExpectedBucket[];
}

interface Eval360Fixture {
  description: string;
  cases: Eval360Case[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'access-fixtures', 'eval360-min3.json'), 'utf8'),
) as Eval360Fixture;

describe('aggregate360Report — shared golden fixture (cross-stack parity with the C# Eval360Aggregate kernel)', () => {
  it('has cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const actual = aggregate360Report(testCase.rows);
      // Deep-equal against the SAME expected outputs the C# fixture test asserts.
      expect(actual).toEqual(testCase.expected);
    });
  }
});
