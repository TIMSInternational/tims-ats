// Run only by vitest-json-reporter.test.ts. Same full name as a.fixture.ts, and it FAILS: omitting this
// file is how a sibling's pass would stand for a check that never ran.
import { describe, expect, test } from 'vitest';

describe('security', () => {
  test('denies cross-org read', () => {
    expect(1).toBe(2);
  });
});
