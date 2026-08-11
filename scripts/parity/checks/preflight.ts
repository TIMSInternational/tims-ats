import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'preflight';
  endpoint: string;
  ok: boolean;
  detail?: string;
}

/** What the TS leg did. `callTs` (callers.ts:93-106) returns no status — a tRPC
 *  error becomes a THROWN TrpcError (trpc.ts:11) — so the outcome is modelled as a
 *  discriminated union here rather than as an HTTP status.
 *
 *  `code` is the DISCRIMINATOR between two very different failures, not decoration.
 *  `stripTrpcJson` (trpc.ts:11) attaches the JSON-RPC code from the tRPC error envelope, so a
 *  code PRESENT means the TS app answered with a real tRPC rejection (authz, validation, …).
 *  A code ABSENT means no tRPC envelope came back at all — `res.json()` threw on an HTML/502
 *  body (callers.ts:104, which has no try/catch, unlike callCsharp at callers.ts:57-61), or the
 *  request never completed. Those two get different diagnoses and different next steps. */
export type TsProbeOutcome = { ok: true } | { ok: false; message: string; code?: number };

export interface ProbeViabilityInput {
  surfaceKey: string;
  /** The surface's feature flag (`Surface.flag`). Named in the 404 diagnosis, because on a DARK
   *  surface — which every registered read surface is, wholly or partly, today — an unmounted
   *  route 404s indistinguishably from a denied one, and the flag is the first thing to check. */
  surfaceFlag: string;
  probeRole: string;
  endpointName: string;
  csharpPath: string;
  tsProcedure?: string;
  /** `ep.expectedByRole[probeRole]` — deliberately allowed to be `undefined`. */
  registryExpectation: 200 | 403 | undefined;
  csharpStatus: number | { failed: string };
  ts?: TsProbeOutcome;
}

/** Shared remediation clause. Used by every branch whose cause really IS the registry or the
 *  seeded grant — branches 1, 2, 4b and 5b. It is deliberately NOT used by the branches whose
 *  cause is elsewhere (3 transport, 4a dark flag, 5a TS transport/parse): pointing an operator
 *  at grants for a DNS error or an unflipped flag is the wrong next step, and a diagnosis that
 *  is confidently wrong is worse than none. preflight.test.ts asserts BOTH directions — that
 *  every registry/grant branch carries this string, and that no other branch does. */
const REMEDIATION =
  'Fix the registry or the seeded grant — do NOT change probeRole to another role the product also ' +
  'denies. (Running anyway crashes inside stripTrpcJson (trpc.ts:11) instead of reporting a FAIL, ' +
  'discarding every result and skipping rls/rbac entirely.)';

/**
 * PURE. Returns `null` when the probe identity is viable, else a one-paragraph
 * diagnosis naming surface, endpoint, role, observed status and the registry's claim.
 *
 * WHY THIS EXISTS. surfaces.test.ts asserts `expectedByRole[probeRole] === 200`
 * for every surface — but that checks the REGISTRY AGAINST ITSELF. A registry that is
 * internally consistent and WRONG ABOUT THE PRODUCT (a role marked 200 that the live
 * gate 403s) has the same blast radius as #205 and nothing catches it: checks/parity.ts:
 * 49-56 fails closed on a non-200 C# response, and on the TS side stripTrpcJson
 * (trpc.ts:11) THROWS, so the run CRASHES out through main's catch with a
 * single line naming neither the surface nor the role, discarding every result gathered
 * so far and never running rls/rbac at all.
 *
 * Verdict order is FIRST MATCH WINS, and the order is deliberate: a registry that is
 * self-inconsistent (branches 1-2) is reported as a registry defect even if the live
 * gate happens to answer 200 today, because the harness would then be probing with an
 * identity nothing in the registry claims is viable.
 *
 * SCOPE, so a green preflight is not read as more than it is: this validates the probe
 * IDENTITY against ONE endpoint of the surface (see `preflightSurface` in cli.ts). It does
 * not prove every endpoint of that surface answers the identity 200, and it says nothing
 * about resource ids. Those residual exposures are enumerated at `preflightSurface`.
 */
export function diagnoseProbeViability(i: ProbeViabilityInput): string | null {
  const where = `${i.surfaceKey}/${i.endpointName}`;
  const head = `verify ${i.surfaceKey}: PROBE IDENTITY NOT VIABLE — no check ran.`;

  // 1. The registry says nothing at all about this role on this endpoint. `expectedByRole`
  //    is a plain Record, so a typo'd or removed role reads as `undefined`, not as an error.
  if (i.registryExpectation === undefined) {
    return (
      `${head} The registry has NO ` +
      `expectedByRole entry for probeRole "${i.probeRole}" on ${where} (GET ${i.csharpPath}), so ` +
      `nothing declares the parity probe's required 200 for the identity every check is about to ` +
      `use. ${REMEDIATION}`
    );
  }

  // 2. The registry contradicts itself: it names an expectation for the probe role, and it is
  //    not 200. surfaces.test.ts's probeRole-expects-200 invariant exists to make this
  //    unreachable — reaching it means that guard did not run or was weakened, which is worth
  //    saying out loud.
  if (i.registryExpectation !== 200) {
    return (
      `${head} The registry itself says ` +
      `probeRole "${i.probeRole}" expects ${i.registryExpectation} on ${where} (GET ${i.csharpPath}) ` +
      `— the parity probe requires 200 (surfaces.test.ts's "every surface probes with a role it ` +
      `actually grants 200" invariant should have caught this; it did not run or was weakened). ` +
      `${REMEDIATION}`
    );
  }

  // 3. The harness could not reach the C# stack at all — a transport failure, not a verdict.
  //    Distinguished from a status so the operator is not sent to look at grants for a DNS error.
  if (typeof i.csharpStatus === 'object') {
    return (
      `${head} The C# probe call itself ` +
      `FAILED (${i.csharpStatus.failed}) — the harness could not reach ${i.csharpPath} on the ` +
      `configured C# base for ${where}. This is a transport/config failure, not a grant failure: ` +
      `check csharpBase and network reachability before touching the registry.`
    );
  }

  // 4a. A 404 is AMBIGUOUS and the flag is the first thing to check, not the registry. Every read
  //     surface registered today is dark or partly dark, and an UNMOUNTED route 404s exactly like a
  //     denied one — so sending the operator to the grants here would misdirect on the common case.
  //     (`cmdVerifyWrite`'s mounted-route preflight in cli.ts already gets this right for writes;
  //     this is the read-side equivalent.) The registry/grant clause is offered only as the
  //     SECOND step, conditional on the route being provably mounted.
  if (i.csharpStatus === 404) {
    return (
      `${head} probeRole "${i.probeRole}" got HTTP 404 on ${where} (GET ${i.csharpPath}). ` +
      `A 404 is AMBIGUOUS: an UNMOUNTED (dark) route 404s indistinguishably from a denied one, and ` +
      `this surface is gated by ${i.surfaceFlag}. CHECK THE FLAG FIRST — flip ${i.surfaceFlag}=true ` +
      `at canary, or point csharpBase at an environment where it is already on, and re-run. Only if ` +
      `the route is provably MOUNTED is this a registry or grant problem, and only then: ${REMEDIATION}`
    );
  }

  // 4b. The headline case: the LIVE gate denies the identity the registry claims it allows.
  if (i.csharpStatus !== 200) {
    return (
      `${head} probeRole ` +
      `"${i.probeRole}" got HTTP ${i.csharpStatus} on ${where} (GET ${i.csharpPath}), but SURFACES ` +
      `says expectedByRole["${i.probeRole}"] === 200. The registry disagrees with the LIVE gate. ` +
      `${REMEDIATION}`
    );
  }

  if (i.ts && i.ts.ok === false) {
    // 5a. The TS app did not answer with a tRPC envelope at all. `stripTrpcJson` always attaches a
    //     JSON-RPC code to a real tRPC rejection, so its ABSENCE means the failure happened before
    //     any authorization verdict existed — a 502/HTML page (callers.ts:104 `res.json()` throws
    //     SyntaxError), DNS, TLS, a mid-deploy Vercel app. This is the TS-side twin of branch 3 and
    //     must NOT carry the registry/grant remediation: an operator running `parity organization`
    //     while the Next.js deployment is rolling would otherwise be sent to look at seeded grants
    //     for an outage.
    if (i.ts.code === undefined) {
      return (
        `${head} C# returned 200 for probeRole "${i.probeRole}" on ${where}, but the TS call FAILED ` +
        `WITHOUT a tRPC error response: "${i.ts.message}". A tRPC rejection always carries a ` +
        `JSON-RPC code (trpc.ts:11); its absence means no tRPC envelope came back at all — an ` +
        `HTML/502 body (callers.ts:104 res.json() throws), DNS, TLS, or a mid-deploy app. This is a ` +
        `transport/config failure, not a grant failure: check tsBase and the Next.js deployment's ` +
        `health before touching the registry.`
      );
    }
    // 5b. C# allowed the identity but the TS side REJECTED it with a real tRPC error. Same blast
    //     radius as branch 4b: this rejection is exactly the throw this preflight exists to pre-empt.
    return (
      `${head} C# returned 200 for ` +
      `probeRole "${i.probeRole}" on ${where}, but the TS leg REJECTED the probe: ` +
      `"${i.ts.message}" (JSON-RPC code ${i.ts.code} — trpc.ts:2 declares a JSON-RPC code, NOT an ` +
      `HTTP status). SURFACES says expectedByRole["${i.probeRole}"] === 200 and ` +
      `tsProcedure "${i.tsProcedure ?? '(none)'}" is registered. ${REMEDIATION}`
    );
  }

  return null;
}

/** Everything the live runner needs. An options object rather than a positional list: the
 *  argument count crossed the point where a mis-ordered `orgAToken`/`orgACookie` pair would
 *  type-check silently, and that mutation was live-verified to leave the whole suite green. */
export interface ProbePreflightRun {
  ep: EndpointDef;
  surfaceKey: string;
  surfaceFlag: string;
  probeRole: string;
  csharpBase: string;
  tsBase: string;
  /** C# Bearer access token for the org-A probe identity. */
  orgAToken: string;
  /** TS `sb-<ref>-auth-token` session cookie for the SAME identity. */
  orgACookie: string;
  /** Exercise the TS leg at all. FALSE for `rls`/`rbac`, which never call the TS stack — see
   *  `preflightSurface` in cli.ts for why coupling them to it would be a regression. */
  checkTs: boolean;
  csharp: (base: string, path: string, token: string) => Promise<{ status: number; body: unknown }>;
  ts: (base: string, proc: string, input: unknown, cookie: string) => Promise<unknown>;
}

/**
 * Live runner. Issues ONE C# call and — only when `checkTs` AND `ep.tsProcedure` is set — ONE TS
 * call, both with the org-A probe identity's credentials: the same two callers the parity leg
 * builds in cli.ts (`csharpCaller`/`tsCaller`). BOTH are wrapped in try/catch: the preflight must
 * be incapable of throwing, since its entire purpose is to replace a throw with a report.
 * (The TS leg is also where a non-JSON response crashes today — callers.ts:104 has no
 * try/catch, unlike callCsharp at callers.ts:57-61.)
 *
 * The C# call runs FIRST and short-circuits the TS call when it fails at transport level:
 * branch 3 of `diagnoseProbeViability` already wins in that case, so a second doomed call
 * would add latency and a second confusing error to the operator's console, not evidence.
 */
export async function runProbePreflight(r: ProbePreflightRun): Promise<CheckResult> {
  const { ep } = r;
  let csharpStatus: number | { failed: string };
  try {
    csharpStatus = (await r.csharp(r.csharpBase, ep.csharpPath, r.orgAToken)).status;
  } catch (err) {
    csharpStatus = { failed: err instanceof Error ? err.message : String(err) };
  }

  let tsOutcome: TsProbeOutcome | undefined;
  if (r.checkTs && ep.tsProcedure !== undefined && typeof csharpStatus === 'number') {
    try {
      await r.ts(r.tsBase, ep.tsProcedure, ep.input, r.orgACookie);
      tsOutcome = { ok: true };
    } catch (err) {
      // A TrpcError carries a JSON-RPC `code`; a raw SyntaxError (non-JSON response body,
      // callers.ts:104) carries none. Both are reported, neither is rethrown, and the two get
      // DIFFERENT diagnoses — see branches 5a/5b above.
      const code = (err as { code?: unknown })?.code;
      tsOutcome = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        code: typeof code === 'number' ? code : undefined,
      };
    }
  }

  const detail = diagnoseProbeViability({
    surfaceKey: r.surfaceKey,
    surfaceFlag: r.surfaceFlag,
    probeRole: r.probeRole,
    endpointName: ep.name,
    csharpPath: ep.csharpPath,
    tsProcedure: ep.tsProcedure,
    registryExpectation: ep.expectedByRole[r.probeRole],
    csharpStatus,
    ts: tsOutcome,
  });

  return detail === null
    ? { check: 'preflight', endpoint: ep.name, ok: true }
    : { check: 'preflight', endpoint: ep.name, ok: false, detail };
}
