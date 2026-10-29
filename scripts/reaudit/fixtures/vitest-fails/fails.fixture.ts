// Run only by vitest-json-reporter.test.ts, through ./vitest.config.ts. `test.fails` inverts the result:
// the body throws and Vitest reports the test as passed, with exit status 0.
import { describe, expect, test } from 'vitest';

describe('fixture', () => {
  test.fails('ideal [finding:syn-a]', () => {
    throw new Error('ideal is broken');
  });

  test('ideal [finding:syn-b]', () => {
    expect(1).toBe(1);
  });
});
