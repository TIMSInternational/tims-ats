import { normalize, diff } from '../normalize';
import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'parity';
  endpoint: string;
  ok: boolean;
  detail?: string;
  /** Set when `ok:true` was reached WITHOUT comparing two stacks — the endpoint has no
   *  `tsProcedure`, so there is no TS side left to diff. `report.ts` renders this `[WEAK]`, never
   *  `[PASS]`: "there is nothing to compare" and "the two stacks agree" are different facts, and
   *  collapsing them is the same defect class as a gate that cannot fail. */
  inconclusive?: boolean;
}

export async function runParityEndpoint(
  ep: EndpointDef,
  csharp: (path: string, input: unknown) => Promise<{ status: number; body: unknown }>,
  ts: (proc: string, input: unknown) => Promise<unknown>,
): Promise<CheckResult> {
  // C#-only endpoint (TS procedure deleted). Still exercise the C# side — a deployed endpoint that
  // stopped returning 200 is a real finding, and it is the only thing this check can still assert.
  // But report it as inconclusive, because no cross-stack comparison happened.
  if (ep.tsProcedure === undefined) {
    const only = await csharp(ep.csharpPath, ep.input);
    if (only.status !== 200) {
      return {
        check: 'parity',
        endpoint: ep.name,
        ok: false,
        detail: `C# returned HTTP ${only.status} (expected 200); no TS side registered for this endpoint`,
      };
    }
    return {
      check: 'parity',
      endpoint: ep.name,
      ok: true,
      inconclusive: true,
      detail:
        'no tsProcedure registered — the TypeScript side of this surface was deleted, so NO cross-stack comparison ran. C# returned 200; isolation and permissions are still asserted by the rls/rbac checks.',
    };
  }

  const [c, t] = await Promise.all([csharp(ep.csharpPath, ep.input), ts(ep.tsProcedure, ep.input)]);

  // FAIL CLOSED: a non-200 C# response has no comparable body — diffing it
  // against the TS side would produce a misleading structural mismatch
  // instead of surfacing the real problem (C# didn't return data at all).
  if (c.status !== 200) {
    return {
      check: 'parity',
      endpoint: ep.name,
      ok: false,
      detail: `C# returned HTTP ${c.status} (expected 200) — TS side was not compared`,
    };
  }

  const cn = normalize(c.body, ep.normalize);
  const tn = normalize(t, ep.normalize);
  const d = diff(tn, cn);

  return {
    check: 'parity',
    endpoint: ep.name,
    ok: d.length === 0,
    detail: d.length ? JSON.stringify(d.slice(0, 10)) : undefined,
  };
}
