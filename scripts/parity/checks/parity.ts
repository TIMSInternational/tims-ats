import { normalize, diff } from '../normalize';
import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'parity';
  endpoint: string;
  ok: boolean;
  detail?: string;
}

export async function runParityEndpoint(
  ep: EndpointDef,
  csharp: (path: string, input: unknown) => Promise<{ status: number; body: unknown }>,
  ts: (proc: string, input: unknown) => Promise<unknown>,
): Promise<CheckResult> {
  const [c, t] = await Promise.all([
    csharp(ep.csharpPath, ep.input),
    ts(ep.tsProcedure, ep.input),
  ]);

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
