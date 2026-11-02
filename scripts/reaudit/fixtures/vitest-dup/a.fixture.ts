// Run only by vitest-json-reporter.test.ts. a.fixture.ts and b.fixture.ts declare the SAME full name
// (Codex r15): a private binding by name is satisfied by either, so a run that omits b must be refused.
import { describe, expect, test } from 'vitest';

describe('security', () => {
  test('denies cross-org read', () => {
    expect(1).toBe(1);
  });
});
