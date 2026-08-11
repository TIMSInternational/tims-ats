import { describe, it, expect, vi } from 'vitest';
import { runProbePreflight, diagnoseProbeViability } from './preflight';
import { TrpcError } from '../trpc';
import type { EndpointDef } from '../surfaces';

// Zero network: both callers are injected, mirroring checks/parity.test.ts:19-30.
const ep: EndpointDef = {
  name: 'kpis',
  csharpPath: '/platform/organizations/kpis',
  tsProcedure: 'platform.getOrganizationKpis',
  input: {},
  expectedByRole: { platform_owner: 200, org_admin: 403 },
};

const ok200 = async () => ({ status: 200, body: { a: 1 } });
const okTs = async () => ({ a: 1 });

const FLAG = 'Platform__PlatformOrganizationsReadEnabled';

/** Runs the preflight with the org-A probe identity's (fake) credentials. */
function run(
  endpoint: EndpointDef,
  csharp: (base: string, path: string, token: string) => Promise<{ status: number; body: unknown }>,
  ts: (base: string, proc: string, input: unknown, cookie: string) => Promise<unknown>,
  role = 'platform_owner',
  checkTs = true,
) {
  return runProbePreflight({
    ep: endpoint,
    surfaceKey: 'organization',
    surfaceFlag: FLAG,
    probeRole: role,
    csharpBase: 'http://csharp.local',
    tsBase: 'http://ts.local',
    orgAToken: 'tok',
    orgACookie: 'ck',
    checkTs,
    csharp,
    ts,
  });
}

describe('runProbePreflight — the probe identity is viable', () => {
  it('C# 200 + TS resolves ⇒ ok, with no detail (a precondition that held says nothing)', async () => {
    const r = await run(ep, ok200, okTs);
    expect(r).toEqual({ check: 'preflight', endpoint: 'kpis', ok: true });
    expect(r.detail).toBeUndefined();
  });
});

// The verdict tests below all injected zero-parameter fakes, so NOTHING asserted what the runner
// actually did with the base, path or credentials it was handed. Live-verified 2026-08-11: swapping
// `orgAToken` for `orgACookie` on the C# call left the entire 408-test suite green, while in
// production it would bail every surface with a false "PROBE IDENTITY NOT VIABLE". Fail-closed and
// loud, so lower severity than a false green — but the runner's CALLS were untested, not just
// under-tested.
describe('runProbePreflight — the calls it issues (not just the verdicts it returns)', () => {
  it('hands each stack its OWN base, path/procedure, input and credential — Bearer to C#, cookie to TS', async () => {
    const csharp = vi.fn(ok200);
    const ts = vi.fn(okTs);
    await run(ep, csharp, ts);
    expect(csharp).toHaveBeenCalledTimes(1);
    // C#: the csharpBase, the endpoint's REST path, and the Bearer access token. Not the cookie.
    expect(csharp).toHaveBeenCalledWith('http://csharp.local', '/platform/organizations/kpis', 'tok');
    expect(ts).toHaveBeenCalledTimes(1);
    // TS: the tsBase, the tRPC procedure, the endpoint's input, and the session cookie. Not the token.
    expect(ts).toHaveBeenCalledWith('http://ts.local', 'platform.getOrganizationKpis', ep.input, 'ck');
  });

  it('probes the SUBSTITUTED endpoint it is given — a by-id probe must carry a real id, not `{id}`', async () => {
    // `preflightSurface` (cli.ts) binds the org-A id before calling in; this pins that the runner
    // uses the endpoint object handed to it rather than re-deriving anything from the registry.
    const bound: EndpointDef = {
      ...ep,
      name: 'detail',
      csharpPath: '/platform/organizations/2f1a0000-0000-4000-8000-00000000000a',
      tsProcedure: 'platform.getOrganization',
      input: { id: '2f1a0000-0000-4000-8000-00000000000a' },
    };
    const csharp = vi.fn(ok200);
    const ts = vi.fn(okTs);
    await run(bound, csharp, ts);
    expect(csharp).toHaveBeenCalledWith(
      'http://csharp.local',
      '/platform/organizations/2f1a0000-0000-4000-8000-00000000000a',
      'tok',
    );
    expect(ts).toHaveBeenCalledWith(
      'http://ts.local',
      'platform.getOrganization',
      { id: '2f1a0000-0000-4000-8000-00000000000a' },
      'ck',
    );
  });

  it('checkTs:false issues NO TS call at all — rls/rbac must not depend on the TS stack', async () => {
    // `rls`/`rbac` have never called TS. Probing it for them would let a Vercel outage abort a
    // pure-C# run with zero checks executed — a coupling introduced by the guard, not by the defect.
    const ts = vi.fn(okTs);
    const r = await run(ep, ok200, ts, 'platform_owner', false);
    expect(ts).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('checkTs:false does NOT suppress the C# verdict', async () => {
    const r = await run(ep, async () => ({ status: 403, body: '' }), okTs, 'platform_owner', false);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('403');
  });
});

describe('runProbePreflight — the LIVE gate disagrees with the registry (#205, #206)', () => {
  it('C# 403 while the registry says 200 ⇒ FAIL naming surface, endpoint, role, status and the crash it prevents', async () => {
    const r = await run(ep, async () => ({ status: 403, body: 'Forbidden' }), okTs);
    expect(r.ok).toBe(false);
    // Every element an operator needs to act WITHOUT reading this file. `organization/kpis`
    // rather than a bare `organization`/`kpis`, both of which the csharpPath alone satisfies.
    expect(r.detail).toContain('verify organization:'); // the command that just bailed
    expect(r.detail).toContain('organization/kpis'); // surface key + endpoint name
    expect(r.detail).toContain('403'); // what actually happened
    expect(r.detail).toContain('platform_owner'); // the probeRole
    expect(r.detail).toContain('expectedByRole'); // what the registry claims
    expect(r.detail).toContain('stripTrpcJson'); // what running anyway would have done
  });

  it('a 404 sends the operator to the FLAG first, not to the registry — every read surface is dark today', async () => {
    // The previous version of this test asserted only `toContain('404')`, which pinned the presence
    // of a number and said nothing about whether the ADVICE was right. A 404 from an unflipped flag
    // is the expected FIRST experience of this feature, not an edge case, and "fix the registry or
    // the seeded grant" is the wrong next step for it.
    const r = await run(ep, async () => ({ status: 404, body: '' }), okTs);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('404');
    expect(r.detail).toContain('AMBIGUOUS');
    expect(r.detail).toContain(FLAG); // the surface's own flag, by name
    expect(r.detail).toContain('CHECK THE FLAG FIRST');
  });
});

describe('runProbePreflight — it can NEVER throw (that is the entire point)', () => {
  it('a TS TrpcError RESOLVES as a FAIL carrying the message and the JSON-RPC code', async () => {
    const r = await run(ep, ok200, async () => {
      throw new TrpcError('No tienes permiso para realizar esta acción', -32003);
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('No tienes permiso');
    expect(r.detail).toContain('-32003');
    // The code is JSON-RPC, not HTTP — saying so stops an operator hunting for a 32003 status.
    expect(r.detail).toContain('JSON-RPC');
    // A real tRPC rejection IS a registry/grant question, so this branch keeps the remediation.
    expect(r.detail).toContain('do NOT change probeRole');
  });

  it('a raw SyntaxError from a non-JSON TS response is diagnosed as TRANSPORT, not as a grant', async () => {
    // The C# side has always distinguished its transport failure from its verdicts; the TS side did
    // not, so a mid-redeploy Vercel app answering a 502 HTML page produced "Fix the registry or the
    // seeded grant" — pointing the operator at grants for an outage.
    const r = await run(ep, ok200, async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('Unexpected token');
    expect(r.detail).toContain('transport/config failure, not a grant failure');
    expect(r.detail).toContain('tsBase');
    // No JSON-RPC code exists on a SyntaxError — the clause must not be fabricated...
    expect(r.detail).toContain('JSON-RPC code (trpc.ts:11)');
    expect(r.detail).not.toContain('JSON-RPC code -');
    // ...and the registry remediation must NOT be attached to a transport failure.
    expect(r.detail).not.toContain('do NOT change probeRole');
  });

  it('a C# transport failure RESOLVES as a FAIL and is diagnosed as transport, not as a grant', async () => {
    const r = await run(
      ep,
      async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
      okTs,
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('ECONNREFUSED');
    expect(r.detail).toContain('could not reach');
  });
});

describe('runProbePreflight — a C#-only endpoint', () => {
  it('never calls the TS side when tsProcedure is absent, and still applies the C# verdict', async () => {
    let tsCalls = 0;
    const csharpOnly: EndpointDef = { ...ep, tsProcedure: undefined };
    const countingTs = async () => {
      tsCalls++;
      return {};
    };
    const pass = await run(csharpOnly, ok200, countingTs);
    expect(tsCalls).toBe(0);
    expect(pass.ok).toBe(true);

    const fail = await run(csharpOnly, async () => ({ status: 403, body: '' }), countingTs);
    expect(tsCalls).toBe(0);
    expect(fail.ok).toBe(false);
    expect(fail.detail).toContain('403');
  });
});

describe('runProbePreflight — the registry is self-inconsistent', () => {
  it('no expectedByRole entry for the probeRole ⇒ FAIL even when C# answers 200', async () => {
    const r = await run(ep, ok200, okTs, 'role_that_is_not_in_the_map');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('NO expectedByRole entry');
    expect(r.detail).toContain('role_that_is_not_in_the_map');
  });

  it('expectedByRole says 403 for the probeRole ⇒ FAIL even when C# answers 200 (the #205 shape)', async () => {
    const r = await run(ep, ok200, okTs, 'org_admin');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('The registry itself says');
    expect(r.detail).toContain('403');
    // Name the guard that should have made this unreachable, so the reader knows where to look.
    expect(r.detail).toContain('every surface probes with a role it actually grants 200');
  });
});

// The pure verdict function, exercised directly for the ordering rules that the live runner
// cannot reach (it never produces two failing conditions it does not already short-circuit).
describe('diagnoseProbeViability (pure)', () => {
  const base = {
    surfaceKey: 'organization',
    surfaceFlag: FLAG,
    probeRole: 'platform_owner',
    endpointName: 'kpis',
    csharpPath: '/platform/organizations/kpis',
    tsProcedure: 'platform.getOrganizationKpis',
    registryExpectation: 200 as const,
  };

  it('returns null — and ONLY null — when everything held', () => {
    expect(diagnoseProbeViability({ ...base, csharpStatus: 200, ts: { ok: true } })).toBeNull();
    expect(diagnoseProbeViability({ ...base, csharpStatus: 200 })).toBeNull();
  });

  it('a registry defect is reported ahead of a live-gate status — it is the more actionable fact', () => {
    const d = diagnoseProbeViability({ ...base, registryExpectation: 403, csharpStatus: 403 });
    expect(d).toContain('The registry itself says');
    expect(d).not.toContain('disagrees with the LIVE gate');
  });

  it('a transport failure is reported ahead of the TS leg — a stack that was never reached has no verdict', () => {
    const d = diagnoseProbeViability({
      ...base,
      csharpStatus: { failed: 'ECONNREFUSED' },
      ts: { ok: false, message: 'irrelevant' },
    });
    expect(d).toContain('could not reach');
    expect(d).not.toContain('irrelevant');
  });

  // The previous version of this test was HOLLOW: it was titled "every FAIL diagnosis carries the
  // remediation clause" and asserted only the "PROBE IDENTITY NOT VIABLE" header. Live-verified
  // 2026-08-11 — stripping `${REMEDIATION}` from three of the four branches it enumerates left the
  // file GREEN (13/13). The clause itself is now asserted, in BOTH directions.
  it('every registry/grant FAIL carries the remediation clause — a diagnosis without a next step is a stack trace', () => {
    const REMEDIATION_HEAD = 'Fix the registry or the seeded grant';
    const REMEDIATION_TAIL = 'do NOT change probeRole to another role the product also denies';
    const cases: Array<[string, Parameters<typeof diagnoseProbeViability>[0]]> = [
      ['1: no expectedByRole entry', { ...base, registryExpectation: undefined, csharpStatus: 200 }],
      ['2: registry says 403', { ...base, registryExpectation: 403 as const, csharpStatus: 200 }],
      ['4a: dark route 404', { ...base, csharpStatus: 404 }],
      ['4b: live gate denies', { ...base, csharpStatus: 403 }],
      [
        '5b: TS rejects with a tRPC code',
        { ...base, csharpStatus: 200, ts: { ok: false as const, message: 'x', code: -32003 } },
      ],
    ];
    for (const [label, c] of cases) {
      const d = diagnoseProbeViability(c);
      expect(d, label).not.toBeNull();
      expect(d, label).toContain('PROBE IDENTITY NOT VIABLE — no check ran');
      expect(d, label).toContain(REMEDIATION_HEAD);
      expect(d, label).toContain(REMEDIATION_TAIL);
      expect(d, label).toContain('stripTrpcJson');
    }
  });

  it('the three NON-registry FAILs deliberately withhold it — wrong advice is worse than none', () => {
    // Sending an operator to the grants for a DNS error, an unflipped flag or a 502 HTML page is the
    // wrong next step in each case. Each of these three names its OWN next step instead.
    const notRegistry: Array<[string, Parameters<typeof diagnoseProbeViability>[0], string]> = [
      ['3: C# transport', { ...base, csharpStatus: { failed: 'ECONNREFUSED' } }, 'check csharpBase'],
      [
        '5a: TS transport/parse',
        { ...base, csharpStatus: 200, ts: { ok: false as const, message: 'Unexpected token <' } },
        'check tsBase',
      ],
    ];
    for (const [label, c, ownAdvice] of notRegistry) {
      const d = diagnoseProbeViability(c);
      expect(d, label).toContain('PROBE IDENTITY NOT VIABLE — no check ran');
      expect(d, label).not.toContain('Fix the registry or the seeded grant');
      expect(d, label).not.toContain('do NOT change probeRole');
      expect(d, label).toContain(ownAdvice);
    }
    // 4a (404) is the in-between case: it DOES carry the remediation, but only after naming the flag
    // as the thing to check FIRST. Pinned so a future edit cannot demote the flag to a footnote.
    const dark = diagnoseProbeViability({ ...base, csharpStatus: 404 })!;
    expect(dark.indexOf('CHECK THE FLAG FIRST')).toBeLessThan(dark.indexOf('Fix the registry'));
  });
});
