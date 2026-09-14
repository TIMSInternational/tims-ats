import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dispatch, resolveProbeRole, preflightSurface, writeProbeRoleDenials, type ProbePreflightRunner } from './cli';
import type { Surface, EndpointDef } from './surfaces';
import { WRITE_SURFACES, type AnyWriteSurface } from './write-surfaces';
import type { CheckResult as PreflightCheckResult, ProbePreflightRun } from './checks/preflight';

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

// ── The probe-viability preflight (#206) ─────────────────────────────────────────────────────────
// `runChecks` itself still cannot be unit-tested (it mints Supabase tokens and makes HTTP calls),
// but the preflight is no longer buried inside it. `preflightSurface` is exported and takes an
// INJECTED runner, so the thing the old source-text guard could not express — that the runner is
// actually REACHED — is now a behavioural assertion.
//
// This matters because the old guard was weaker than its own comment claimed. Live-verified
// 2026-08-11: mutating the enclosing condition to
// `if (probeCandidate && cfg.csharpBase.startsWith('zzz'))` disabled deliverable A entirely and left
// `npx vitest run scripts/parity tests/governance` at 408/408 with tsc clean, because all four
// substrings the guard looked for survived untouched. Its apparent strength was coincidental: the
// near-miss mutation `&& command === 'parity'` only went red by shifting an `indexOf`.
describe('preflightSurface (behavioural, injected runner — no network)', () => {
  const okRun: PreflightCheckResult = { check: 'preflight', endpoint: 'kpis', ok: true };
  const creds = { csharpBase: 'http://csharp.local', tsBase: 'http://ts.local', orgAToken: 'tok', orgACookie: 'ck' };
  const identity = (e: EndpointDef) => e;

  const tier1: EndpointDef = {
    name: 'kpis',
    csharpPath: '/platform/organizations/kpis',
    tsProcedure: 'platform.getOrganizationKpis',
    input: {},
    expectedByRole: { platform_owner: 200, org_admin: 403 },
  };
  const byId: EndpointDef = {
    name: 'detail',
    csharpPath: '/platform/organizations/{id}',
    tsProcedure: 'platform.getOrganization',
    input: { id: '{id}' },
    idScopeKey: 'organization',
    expectedByRole: { platform_owner: 200, org_admin: 403 },
  };
  const surface: Surface = {
    key: 'organization',
    flag: 'Platform__PlatformOrganizationsReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    probeRole: 'platform_owner',
    endpoints: [byId, tier1],
  };

  /** A typed spy: records exactly what `preflightSurface` handed the runner. Written by hand rather
   *  than as `vi.fn(async () => …)` because that infers a ZERO-ARG signature, which makes
   *  `mock.calls[0][0]` a type error and would have pushed these assertions towards `any`. */
  function captureRunner(result: PreflightCheckResult = okRun) {
    const calls: ProbePreflightRun[] = [];
    const runner: ProbePreflightRunner = async (r) => {
      calls.push(r);
      return result;
    };
    return { runner, calls };
  }

  it('CALLS the runner — the reachability a source-text substring check cannot prove', async () => {
    const { runner, calls } = captureRunner();
    await preflightSurface('verify', surface, identity, creds, runner);
    expect(calls.length).toBe(1);
  });

  it('prefers a Tier-1 endpoint over a by-id one, and passes the surface key, flag and probeRole', async () => {
    const { runner, calls } = captureRunner();
    await preflightSurface('verify', surface, identity, creds, runner);
    const arg = calls[0];
    expect(arg.ep.name).toBe('kpis'); // not `detail`, which is listed FIRST
    expect(arg.surfaceKey).toBe('organization');
    expect(arg.surfaceFlag).toBe('Platform__PlatformOrganizationsReadEnabled');
    expect(arg.probeRole).toBe('platform_owner');
    expect(arg.csharpBase).toBe('http://csharp.local');
    expect(arg.tsBase).toBe('http://ts.local');
    expect(arg.orgAToken).toBe('tok');
    expect(arg.orgACookie).toBe('ck');
  });

  it('binds a REAL id through `bind` when every endpoint is by-id — never the {id} sentinel', async () => {
    // The reason this call sits AFTER resource resolution in `runChecks`. A surface with no Tier-1
    // endpoint must still probe a substituted path, or the preflight 404s on `/…/{id}` literally.
    const allById: Surface = { ...surface, endpoints: [byId] };
    const { runner, calls } = captureRunner();
    let bound = 0;
    const bind = (e: EndpointDef) => {
      bound++;
      return { ...e, csharpPath: '/platform/organizations/org-a-uuid' };
    };
    await preflightSurface('verify', allById, bind, creds, runner);
    expect(bound).toBe(1);
    expect(calls[0].ep.csharpPath).toBe('/platform/organizations/org-a-uuid');
  });

  it('exercises the TS leg for parity/verify and NOT for rls/rbac', async () => {
    // `rls`/`rbac` have never touched the TS stack (see the file docblock). If the preflight probed
    // it unconditionally, a Vercel outage would abort a pure-C# run with zero checks executed.
    for (const cmd of ['parity', 'verify'] as const) {
      const { runner, calls } = captureRunner();
      await preflightSurface(cmd, surface, identity, creds, runner);
      expect(calls[0].checkTs, cmd).toBe(true);
    }
    for (const cmd of ['rls', 'rbac'] as const) {
      const { runner, calls } = captureRunner();
      await preflightSurface(cmd, surface, identity, creds, runner);
      expect(calls[0].checkTs, cmd).toBe(false);
    }
  });

  it('returns the FAILING result (so the caller can abort), and null when it passed', async () => {
    const fail: PreflightCheckResult = { check: 'preflight', endpoint: 'kpis', ok: false, detail: 'denied' };
    expect(await preflightSurface('verify', surface, identity, creds, captureRunner(fail).runner)).toEqual(fail);
    expect(await preflightSurface('verify', surface, identity, creds, captureRunner(okRun).runner)).toBeNull();
  });

  it('a zero-endpoint surface probes nothing and does not crash', async () => {
    const { runner, calls } = captureRunner();
    const empty: Surface = { ...surface, endpoints: [] };
    expect(await preflightSurface('verify', empty, identity, creds, runner)).toBeNull();
    expect(calls.length).toBe(0);
  });
});

// The write side's equivalent. `verify-write` never reaches `preflightSurface` — it is a separate
// dispatch branch — so all 26 write endpoints across 7 write surfaces carried the #205 defect class
// with nothing checking for it. A live probe is impossible there (a write's success probe MUTATES),
// so what is checked is the registry's own claim, with no network at all.
describe('writeProbeRoleDenials (pure) — the #205 defect class on the write side', () => {
  const ep = (name: string, expectedByRole: Record<string, 'allow' | 'deny'>) =>
    ({ name, expectedByRole }) as unknown as AnyWriteSurface['endpoints'][number];
  const surfaceWith = (probeRole: string, endpoints: AnyWriteSurface['endpoints']) =>
    ({ key: 'w', flag: 'F', probeRole, roles: [probeRole], endpoints }) as unknown as AnyWriteSurface;

  it('is empty when the probe role is allowed everywhere', () => {
    const s = surfaceWith('super_admin', [ep('create', { super_admin: 'allow', hrbp: 'deny' })]);
    expect(writeProbeRoleDenials(s)).toEqual([]);
  });

  it('names the endpoint AND the declared expectation for a DENIED probe role', () => {
    // The #205 shape, write side. On the read side this crashes the run; here it is worse — a denied
    // identity 403s every call and `runWriteIdor` reads 403 as isolation-held, so the IDOR line goes
    // GREEN for a fixture reason.
    const s = surfaceWith('hrbp', [
      ep('create', { super_admin: 'allow', hrbp: 'deny' }),
      ep('approve', { super_admin: 'allow', hrbp: 'allow' }),
    ]);
    expect(writeProbeRoleDenials(s)).toEqual(['create=deny']);
  });

  it('treats an UNDECLARED probe role as a denial, not as a pass', () => {
    // `expectedByRole` is a plain Record: a typo'd or removed role reads as `undefined`. Defaulting
    // that to "allowed" would reproduce branch 1 of the read-side preflight as a silent green.
    const s = surfaceWith('ghost_role', [ep('create', { super_admin: 'allow' })]);
    expect(writeProbeRoleDenials(s)).toEqual(['create=undeclared']);
  });

  it('every REGISTERED write surface passes it today — 8 surfaces, 27 endpoints', () => {
    // The registry-level invariant, the write-side analogue of surfaces.test.ts's
    // "every surface probes with a role it actually grants 200". Non-vacuity: the counts are pinned,
    // so an empty registry cannot make this loop iterate zero times and still read as enforced.
    let endpoints = 0;
    for (const [key, s] of Object.entries(WRITE_SURFACES)) {
      endpoints += s.endpoints.length;
      expect(writeProbeRoleDenials(s), `${key}: probeRole "${s.probeRole}" is not 'allow' everywhere`).toEqual([]);
    }
    // 8 / 27 since 2026-08-11: `organization-create` registered (#208).
    expect(Object.keys(WRITE_SURFACES).length).toBe(8);
    expect(endpoints).toBe(27);
  });
});

// Still source-text, and still worth keeping: the ORDER of the call inside `runChecks` (which needs
// live credentials to execute) is not reachable behaviourally. Both assertions pin EXACT lines, so a
// mutation that wraps either in a condition changes the string and goes red — the specific weakness
// that let the `startsWith('zzz')` mutation through when the block was inline.
describe('probe-viability preflight wiring in cli.ts (source-order check)', () => {
  const src = readFileSync(join(__dirname, 'cli.ts'), 'utf8');

  it('the preflight is called BEFORE the parity loop, unconditionally', () => {
    const pf = src.indexOf('const pf = await preflightSurface(command, surface, orgAEndpoint, {');
    const parity = src.indexOf("if (command === 'parity' || command === 'verify') {");
    expect(pf, 'preflightSurface is not called from runChecks — deliverable A is unwired').toBeGreaterThan(-1);
    expect(parity, 'the parity block was renamed — this guard is now blind').toBeGreaterThan(-1);
    expect(pf).toBeLessThan(parity);
  });

  it('a failed preflight ABORTS the run — it is not merely appended to the results', () => {
    // `return [pf]` and not `results.push(pf)`: pushing it would let the three checks run on
    // with a probe identity already known to be denied, which is the crash this prevents.
    // `[]` would be worse still — renderReport's allGreen is vacuously true on an empty list.
    expect(src).toContain('\n  if (pf) return [pf];\n');
  });

  it('cmdVerifyWrite bails on a denied write probeRole BEFORE any check runs', () => {
    // The write-side twin. `writeProbeRoleDenials` is behaviourally tested above; what is only
    // reachable as source text is that `cmdVerifyWrite` actually consults it and RETURNS on it,
    // rather than logging and carrying on into runWriteIdor's false green.
    const call = src.indexOf('const probeDenied = writeProbeRoleDenials(surface);');
    const bail = src.indexOf('  if (probeDenied.length > 0) {');
    const firstCheck = src.indexOf('results.push(await runWriteIdor(');
    expect(call, 'cmdVerifyWrite no longer consults writeProbeRoleDenials').toBeGreaterThan(-1);
    expect(bail, 'the bail condition was rewritten — this guard is now blind').toBeGreaterThan(-1);
    expect(firstCheck).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(call);
    expect(bail).toBeLessThan(firstCheck);
    expect(src).toContain('    );\n    return 1;\n  }\n\n  // Seed the surface');
  });
});
