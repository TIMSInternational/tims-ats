import { describe, expect, it } from 'vitest';
import { isHarnessSuiteDb } from '../../apps/web/e2e/assessments-cross/state-guard';

// The cross e2e (apps/web/e2e/assessments-cross) docker-execs into the suite database container its state file names.
// The guard used to accept only names starting with "r10-" or containing "cross", so a bring-up under any other
// CROSS_PREFIX (r11-…) was refused before a single test ran. It now accepts exactly `${prefix}-suite-db`.
describe('assessments-cross state guard', () => {
  it('accepts the container up.sh names for any well-formed CROSS_PREFIX', () => {
    expect(isHarnessSuiteDb('r11-e2e-x-suite-db', 'r11-e2e-x')).toBe(true);
    expect(isHarnessSuiteDb('assessments-cross-suite-db', 'assessments-cross')).toBe(true);
    expect(isHarnessSuiteDb('nightly_7-suite-db', 'nightly_7')).toBe(true);
  });

  it('refuses any container that is not this bring-up’s suite database', () => {
    expect(isHarnessSuiteDb('supabase_db_tims-suite-local', 'r11-e2e-x')).toBe(false);
    expect(isHarnessSuiteDb('r11-e2e-x-ats-db', 'r11-e2e-x')).toBe(false);
    expect(isHarnessSuiteDb('other-cross-suite-db', 'r11-e2e-x')).toBe(false);
    expect(isHarnessSuiteDb('r10-e2e-x-suite-db', 'r11-e2e-x')).toBe(false);
  });

  it('refuses a missing or malformed prefix', () => {
    expect(isHarnessSuiteDb('assessments-cross-suite-db', undefined)).toBe(false);
    expect(isHarnessSuiteDb('-suite-db', '')).toBe(false);
    expect(isHarnessSuiteDb('x; rm -suite-db', 'x; rm')).toBe(false);
    expect(isHarnessSuiteDb(undefined, 'r11-e2e-x')).toBe(false);
  });
});
