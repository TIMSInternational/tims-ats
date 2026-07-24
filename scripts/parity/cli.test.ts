import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatch, resolveProbeRole } from './cli';
import type { Surface } from './surfaces';

// Only the pure arg-parsing branches of `dispatch` are exercised here — every
// path below returns before touching `loadConfig()`/network, so this suite
// runs safely with no `.env`, no Supabase creds, and no HTTP calls.
describe('cli dispatch (arg-parsing only, no network)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no command: prints usage, exit code 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await dispatch([]);
    expect(code).toBe(1);
    expect(err).toHaveBeenCalled();
  });

  it('unknown command: exit code 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await dispatch(['bogus']);
    expect(code).toBe(1);
    expect(err.mock.calls.join(' ')).toContain('unknown command');
  });

  it('parity with no surface argument: exit code 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await dispatch(['parity']);
    expect(code).toBe(1);
    expect(err.mock.calls.join(' ')).toContain('requires a <surface>');
  });

  it('rls with an unknown surface: exit code 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await dispatch(['rls', 'nonexistent-surface']);
    expect(code).toBe(1);
    expect(err.mock.calls.join(' ')).toContain('unknown surface');
  });

  it('verify with an unknown surface: exit code 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await dispatch(['verify', 'nonexistent-surface']);
    expect(code).toBe(1);
    expect(err.mock.calls.join(' ')).toContain('unknown surface');
  });
});

// `resolveProbeRole` is a pure helper (no config/network) that decides which
// role's token is used as the parity/RLS probe identity — exercised directly
// here since the live-path (`mintTokens`) that calls it needs Supabase creds.
describe('resolveProbeRole (pure, no network)', () => {
  const base: Omit<Surface, 'probeRole'> = { key: 's', flag: 'f', roles: ['super_admin', 'hr_admin'], endpoints: [] };

  it('uses the explicit probeRole when set, with usedFallback:false', () => {
    const surface: Surface = { ...base, probeRole: 'hr_admin' };
    expect(resolveProbeRole(surface)).toEqual({ role: 'hr_admin', usedFallback: false });
  });

  it('falls back to roles[0] when probeRole is not set, with usedFallback:true', () => {
    const surface: Surface = { ...base };
    expect(resolveProbeRole(surface)).toEqual({ role: 'super_admin', usedFallback: true });
  });
});
