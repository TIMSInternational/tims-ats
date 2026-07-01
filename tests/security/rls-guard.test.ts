import { describe, it, expect } from 'vitest';
import { assertRlsEnforced } from '../../packages/db/src/rls-guard';

describe('assertRlsEnforced (production RLS fail-fast)', () => {
  it('throws in production when RLS is not enforced', () => {
    expect(() => assertRlsEnforced('production', false)).toThrow(/RLS_ENFORCED must be "true" in production/);
  });

  it('does NOT throw in production when RLS is enforced', () => {
    expect(() => assertRlsEnforced('production', true)).not.toThrow();
  });

  it('does NOT throw outside production regardless of the flag', () => {
    expect(() => assertRlsEnforced('development', false)).not.toThrow();
    expect(() => assertRlsEnforced('test', false)).not.toThrow();
    expect(() => assertRlsEnforced(undefined, false)).not.toThrow();
    expect(() => assertRlsEnforced('preview', false)).not.toThrow();
  });
});
