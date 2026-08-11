#!/usr/bin/env -S npx tsx
/**
 * Parity harness CLI — wires config/auth/seed/callers/checks/report into runnable
 * commands: `seed [--teardown]`, `auth`, `parity <surface>`, `rls <surface>`,
 * `rbac <surface>`, `verify <surface>` (= parity + rls + rbac).
 *
 * ── LIVE-RUN STATUS ─────────────────────────────────────────────────────────
 * This file is structurally complete and wired to the *real* exported signatures
 * of every dependency (Tasks 1-10) — nothing here is a stub. Its PURE pieces
 * (`dispatch`'s arg-parsing / unknown-command / unknown-surface branches) are
 * unit-tested in `cli.test.ts` without network. The rest — `seed`, `auth`,
 * `parity`, `rls`, `rbac`, `verify` once a real surface is given — makes live
 * Supabase + HTTP calls and is NOT unit-tested (no creds/network in CI); it
 * requires `scripts/parity/.env` populated (see `.env.example`) to run at all.
 *
 * TS AUTH — `parity`/`verify` authenticate against the real TS app via COOKIE:
 * the Next.js tRPC route is cookie-only (`sb-<ref>-auth-token`), so `mintTokens`
 * builds the org-A probe identity's session cookie with `getSessionCookie`
 * (scripts/parity/supabase.ts) and `callTs` sends it as a `Cookie:` header.
 * LIVE-VERIFIED against prod (super_admin→200, hrbp→403, no-cookie→401 on
 * teamIntel.getDashboardKpis). `rls`/`rbac` only ever call the C# REST side
 * (`callCsharp`, Bearer) and are unaffected — INCLUDING their probe-viability
 * preflight, which is why `preflightSurface` takes a `checkTs` flag rather than
 * probing TS unconditionally. See that function for the reasoning; the short
 * version is that a Vercel outage must not be able to abort a pure-C# `rls` run
 * with zero checks executed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { fileURLToPath } from 'node:url';
import { loadConfig, type HarnessConfig } from './config';
import { getToken, getSessionCookie, type TokenCache, type CookieCache } from './supabase';
import { planSeed, seed, teardown, resolveResources, openReadback, type SeedResources } from './seed';
import { callCsharp, callCsharpWrite, callTs } from './callers';
import { SURFACES, type Surface, type EndpointDef } from './surfaces';
import { WRITE_SURFACES, type WriteResolvedBase, type AnyWriteSurface } from './write-surfaces';
import { substituteEndpointId } from './ids';
import { runParityEndpoint } from './checks/parity';
import { runRlsEndpoint, type RlsContext } from './checks/rls';
import { runRbacEndpoint, type RbacContext } from './checks/rbac';
import {
  runProbePreflight,
  type ProbePreflightRun,
  type CheckResult as PreflightCheckResult,
} from './checks/preflight';
import { runWriteParity, runWriteIdor, runWriteRbac, runWriteExtraProbe } from './checks/writes';
import { renderReport, type CheckResult } from './report';

type CheckCommand = 'parity' | 'rls' | 'rbac' | 'verify';

const USAGE =
  'Usage: tsx scripts/parity/cli.ts <seed [--teardown] | auth | parity <surface> | rls <surface> | rbac <surface> | verify <surface> | verify-write <surface>>';

/** Union of every registered surface's roles — used by `seed`/`auth`, which act
 *  across all surfaces rather than one (no <surface> argument for those two). */
function allRoles(): string[] {
  return Array.from(new Set(Object.values(SURFACES).flatMap((s) => s.roles)));
}

/**
 * Resolves which role's token is used as the org-A/org-B parity+RLS probe
 * identity: the surface's explicit `probeRole` when set, else `roles[0]` as a
 * positional fallback. Pure (no config/network) so it's unit-testable without
 * Supabase creds — see `resolveProbeRole` tests in `cli.test.ts`. Callers
 * should warn on `usedFallback` since positional convention is implicit, not
 * a documented contract.
 */
export function resolveProbeRole(surface: Surface): { role: string; usedFallback: boolean } {
  if (surface.probeRole) return { role: surface.probeRole, usedFallback: false };
  return { role: surface.roles[0], usedFallback: true };
}

/**
 * Mints one token per (org, role) pair for a surface via the real `getToken`
 * (scripts/parity/supabase.ts), reusing `planSeed`'s deterministic seeded-email
 * shape so the CLI never re-derives emails/passwords itself.
 *
 * `orgAToken`/`orgBToken` are the token for the surface's `probeRole` (falling
 * back to `surface.roles[0]` — by convention the highest-privilege /
 * code-guaranteed-200 role — see the SURFACES registry comment in surfaces.ts,
 * e.g. `super_admin` — only when no `probeRole` is set; see `resolveProbeRole`)
 * in org A / org B respectively. `tokensByRole` maps every configured role to
 * its org-A token, for the RBAC role-matrix check.
 */
async function mintTokens(
  cfg: HarnessConfig,
  surface: Surface,
  cache: TokenCache,
): Promise<{ orgAToken: string; orgBToken: string; orgACookie: string; tokensByRole: Record<string, string> }> {
  if (surface.roles.length === 0) throw new Error(`surface "${surface.key}" has no roles configured`);
  const { role: primaryRole, usedFallback } = resolveProbeRole(surface);
  if (usedFallback) {
    console.warn(
      `parity: surface "${surface.key}" has no probeRole set — using roles[0] ("${primaryRole}") as the parity/RLS probe identity positionally. Set an explicit probeRole to avoid relying on array order.`,
    );
  }
  const plan = planSeed(surface.roles);

  // The C# side authenticates via Bearer access-token; the TS side via the
  // sb-<ref>-auth-token session cookie. The parity probe (org-A primaryRole)
  // needs BOTH for the same identity — the Bearer for `callCsharp`, the cookie
  // for `callTs`. Only that one identity is exercised against TS, so only its
  // cookie is minted (cookies are heavier than tokens: a full sign-in each).
  const cookieCache: CookieCache = new Map();
  const tokensByRole: Record<string, string> = {};
  let orgAToken = '';
  let orgBToken = '';
  let orgACookie = '';
  for (const u of plan.users) {
    const token = await getToken(cfg, u.email, u.password, cache);
    if (u.orgKey === 'a') {
      tokensByRole[u.role] = token;
      if (u.role === primaryRole) {
        orgAToken = token;
        orgACookie = await getSessionCookie(cfg, u.email, u.password, cookieCache);
      }
    } else if (u.role === primaryRole) {
      orgBToken = token;
    }
  }
  if (!orgAToken) throw new Error(`mintTokens: failed to mint org-A token for role "${primaryRole}"`);
  // platform_owner is deliberately seeded ONLY under org A (see planSeed's comment: it's an
  // org-less identity, seeded once purely to hang the token cache off of) — an org-B counterpart
  // structurally does not exist, so don't require one.
  //
  // History, because this comment has been wrong twice and the reason matters. It once said "every
  // surface that uses platform_owner as probeRole (access-review, audit-log) has globalScope:true";
  // that went stale on 2026-07-31 when both of those READ surfaces were REMOVED from surfaces.ts
  // (2950a06c / 18282f96), and was corrected on 2026-08-10 (#195) to say the branch was reachable
  // only from write-surfaces.ts's access-review surface.
  //
  // CURRENT STATE, 2026-08-11. `mintTokens` has exactly ONE call site — `runChecks` at :145, the
  // READ path. `cmdVerifyWrite` mints its own tokens inline (:312-314) and never reaches here, so no
  // WRITE_SURFACES entry is a caller of this branch, whatever its probeRole. THREE read surfaces now
  // set probeRole 'platform_owner' and are the only callers: SURFACES['audit-log'],
  // SURFACES['access-review'] (both re-registered C#-only today) and SURFACES['organization'].
  //
  // Do not restate the reason as "because they have no TS side left". The guard below keys on the
  // ROLE and nothing else — a C#-only surface with an org-scoped probeRole would still be required
  // to have an org-B token, and a TS-having surface with `platform_owner` still skips it, which is
  // precisely why `organization` (live TS procedures) can and does use it. The real reason is
  // narrower: a platform owner is org-less, so no org-B counterpart exists to demand.
  if (!orgBToken && primaryRole !== 'platform_owner') {
    throw new Error(`mintTokens: failed to mint org-B token for role "${primaryRole}"`);
  }
  if (!orgACookie) throw new Error(`mintTokens: failed to mint org-A session cookie for role "${primaryRole}"`);
  return { orgAToken, orgBToken, orgACookie, tokensByRole };
}

/** The live `runProbePreflight`, as an injectable shape so `preflightSurface` can be unit-tested
 *  BEHAVIOURALLY (it is the reachability of the call that matters, and a source-text assertion
 *  cannot prove that — see cli.test.ts). */
export type ProbePreflightRunner = (r: ProbePreflightRun) => Promise<PreflightCheckResult>;

/**
 * PROBE-VIABILITY PREFLIGHT (#206). Returns the failing `CheckResult` when the probe identity is
 * NOT viable, and `null` when it is (or when there is nothing to probe). Extracted from `runChecks`
 * ON PURPOSE: while it was an inline `if (probeCandidate) { … }` block, the ONLY automated coverage
 * of it was a source-text substring check in cli.test.ts, and that check could not tell reachable
 * code from unreachable code — mutating the condition to `if (probeCandidate && cfg.csharpBase
 * .startsWith('zzz'))` disabled the entire deliverable with 408/408 tests and tsc green
 * (live-verified 2026-08-11). As a function with an injected runner, "it is actually called" is a
 * behavioural assertion.
 *
 * WHY IT RUNS BEFORE ANY CHECK. The probe identity's token is what parity calls BOTH stacks with
 * (see `csharpCaller`/`tsCaller` below) and what rls/rbac call C# with. A denied probeRole does not
 * degrade those checks, it destroys them: parity fails closed on the C# side (checks/parity.ts:49-56)
 * and THROWS on the TS side (stripTrpcJson, trpc.ts:11), taking the whole run down; and RLS Mode A
 * silently degrades, because org-A's 403 is read as "isolation held" by `assertIsolated`
 * (checks/rls.ts:92-93) for the WRONG reason, and the run then FAILs at the positive control
 * (checks/rls.ts:270-277) with a message pointing the operator at the org-B seed rather than the
 * registry.
 *
 * WHY `checkTs` IS COMMAND-DEPENDENT. `rls` and `rbac` have never called the TS stack. Probing it
 * for them would make a Next.js outage, a 502 HTML body (callers.ts:104 `res.json()` throws
 * SyntaxError) or a mid-deploy redirect abort a pure-C# run with zero checks executed — a new
 * coupling, introduced by the guard rather than by the thing it guards. So the TS leg runs for
 * `parity`/`verify` only, which are the commands whose crash it exists to pre-empt.
 *
 * ENDPOINT CHOICE. Prefer a Tier-1 endpoint (no extra id semantics); fall back to `endpoints[0]`
 * bound through `bind`, which is why the caller resolves resources first — a surface whose every
 * endpoint is by-id must still probe with a REAL id, not the `{id}` sentinel.
 *
 * WHAT THIS DOES NOT COVER, stated so a green preflight is not over-read:
 *   - ONE endpoint per surface. A registry that is right about `kpis` and wrong about `detail`
 *     still crashes on `detail` in exactly the #205 shape. Probing every endpoint would double the
 *     call count of every run for a defect class the per-surface probeRole invariant already makes
 *     hard; the residual is accepted and written down rather than implied.
 *   - RESOURCE IDS. `organization/detail` and `compensation/employee` resolve their id from
 *     DATABASE_URL, and the TS app reads its OWN database. Point the harness at a locally-seeded DB
 *     and `tsBase` at prod and `platform.getOrganization` will 404 an id it has never seen, which
 *     stripTrpcJson turns back into a throw. That is a config mismatch the preflight cannot see,
 *     because the probe endpoint (`kpis`) takes no id.
 *   - `verify-write`. It does not reach here at all — see `cmdVerifyWrite`, which carries its own
 *     (different, route-mounted-ness) preflight and its own registry-level probe-role guard.
 */
export async function preflightSurface(
  command: CheckCommand,
  surface: Surface,
  bind: (ep: EndpointDef) => EndpointDef,
  creds: { csharpBase: string; tsBase: string; orgAToken: string; orgACookie: string },
  runner: ProbePreflightRunner = runProbePreflight,
): Promise<PreflightCheckResult | null> {
  // A surface with ZERO endpoints has nothing to probe. That is a pre-existing vacuity (every loop
  // in `runChecks` iterates zero times and `renderReport` reports an empty run), and it belongs to
  // whatever guard owns it — not to this one, which must not crash on it.
  const probeCandidate = surface.endpoints.find((e) => !e.idScopeKey) ?? surface.endpoints[0];
  if (!probeCandidate) return null;
  const pf = await runner({
    ep: bind(probeCandidate),
    surfaceKey: surface.key,
    surfaceFlag: surface.flag,
    probeRole: resolveProbeRole(surface).role,
    checkTs: command === 'parity' || command === 'verify',
    csharpBase: creds.csharpBase,
    tsBase: creds.tsBase,
    orgAToken: creds.orgAToken,
    orgACookie: creds.orgACookie,
    csharp: callCsharp,
    ts: callTs,
  });
  return pf.ok ? null : pf;
}

/** Runs the requested check(s) over every endpoint of `surface`, returning the
 *  combined result list `renderReport` consumes. `verify` runs all three. */
async function runChecks(command: CheckCommand, cfg: HarnessConfig, surface: Surface): Promise<CheckResult[]> {
  const cache: TokenCache = new Map();
  const { orgAToken, orgBToken, orgACookie, tokensByRole } = await mintTokens(cfg, surface, cache);
  const results: CheckResult[] = [];

  // Tier-2 by-id endpoints thread a concrete resource id into the path/input. Resolve the id pairs
  // ONCE (read-only DB lookup), and only when this surface actually has a by-id endpoint — static
  // (Tier-1) surfaces stay DB-free. `orgAEndpoint` binds the ORG-A id (parity/RBAC use it); the RLS
  // Mode-A probe uses the ORG-B id (`rls.ts` substitutes it into the same `{id}` sentinel).
  const needsResources = surface.endpoints.some((ep) => ep.idScopeKey);
  const resources: SeedResources | undefined = needsResources ? await resolveResources(cfg) : undefined;
  const pairFor = (ep: EndpointDef) => {
    const pair = resources?.[ep.idScopeKey as keyof SeedResources];
    if (!pair)
      throw new Error(`runChecks: no resolved resource for idScopeKey "${ep.idScopeKey}" on endpoint "${ep.name}"`);
    return pair;
  };
  const orgAEndpoint = (ep: EndpointDef): EndpointDef => (ep.idScopeKey ? substituteEndpointId(ep, pairFor(ep).a) : ep);

  // PROBE-VIABILITY PREFLIGHT (#206), BEFORE any check. Sits AFTER resource resolution so an
  // all-by-id surface probes with a REAL id. The rationale, the command-dependent TS leg and the
  // residual exposures are all documented on `preflightSurface` above.
  //
  // The FAIL is returned as the SOLE result rather than thrown or dropped. `[]` would exit 0 —
  // renderReport's allGreen is vacuously true on an empty list. A PASSING preflight is deliberately
  // NOT pushed onto `results`: it is a precondition, not a check, and counting it would inflate the
  // pass count of every run.
  //
  // EXIT CODE. This bail returns 1, like every other could-not-run path in this file
  // (`cmdVerifyWrite`'s mounted-route preflight, and `main`'s catch-all which collapses every throw
  // to 1). `.claude/rules/verification.md` establishes a 0/1/2 contract where 2 means "could not
  // run", and this bail is exactly that shape — but adopting 2 HERE ONLY would make one
  // could-not-run path distinguishable while `mintTokens`/`resolveResources`/`loadConfig` failures
  // stay indistinguishable, which misleads more than no contract at all. Adopting it across every
  // such path in this file at once is tracked as its own change: issue #210.
  const pf = await preflightSurface(command, surface, orgAEndpoint, {
    csharpBase: cfg.csharpBase,
    tsBase: cfg.tsBase,
    orgAToken,
    orgACookie,
  });
  if (pf) return [pf];

  if (command === 'parity' || command === 'verify') {
    // Bind base + the org-A probe identity's credentials into the (path,input)/
    // (proc,input) closure shapes `runParityEndpoint` expects: C# via Bearer
    // token, TS via the session cookie (both the SAME identity).
    const csharpCaller = (path: string, _input: unknown) => callCsharp(cfg.csharpBase, path, orgAToken);
    const tsCaller = (proc: string, input: unknown) => callTs(cfg.tsBase, proc, input, orgACookie);
    for (const ep of surface.endpoints) results.push(await runParityEndpoint(orgAEndpoint(ep), csharpCaller, tsCaller));
  }

  if (command === 'rls' || command === 'verify') {
    for (const ep of surface.endpoints) {
      const orgBResourceId = ep.idScopeKey ? pairFor(ep).b : undefined;
      const ctx: RlsContext = { base: cfg.csharpBase, orgAToken, orgBToken, orgBResourceId };
      results.push(await runRlsEndpoint(ep, ctx, callCsharp));
    }
  }

  if (command === 'rbac' || command === 'verify') {
    const ctx: RbacContext = { base: cfg.csharpBase, tokensByRole };
    for (const ep of surface.endpoints) results.push(...(await runRbacEndpoint(orgAEndpoint(ep), ctx, callCsharp)));
  }

  return results;
}

async function cmdSeed(teardownFlag: boolean): Promise<number> {
  const cfg = loadConfig();
  const roles = allRoles();
  if (teardownFlag) {
    await teardown(cfg);
    console.log('parity: teardown complete.');
    return 0;
  }
  const result = await seed(cfg, roles);
  console.log(
    `parity: seeded org A=${result.orgs.a} org B=${result.orgs.b}, ${result.users.length} users across roles [${roles.join(', ')}].`,
  );
  return 0;
}

/** Auth health-check: mints a token for every seeded (org, role) user across
 *  every registered surface and reports pass/fail counts. Never logs a token. */
async function cmdAuth(): Promise<number> {
  const cfg = loadConfig();
  const cache: TokenCache = new Map();
  const plan = planSeed(allRoles());
  let ok = 0;
  let failed = 0;
  for (const u of plan.users) {
    try {
      await getToken(cfg, u.email, u.password, cache);
      ok++;
    } catch (err) {
      failed++;
      console.error(
        `parity: auth failed for ${u.orgKey}:${u.role} (${u.email}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`parity: auth — ${ok} succeeded, ${failed} failed (of ${plan.users.length}).`);
  return failed === 0 ? 0 : 1;
}

async function cmdCheck(command: CheckCommand, surfaceKey: string | undefined): Promise<number> {
  if (!surfaceKey) {
    console.error(
      `Error: "${command}" requires a <surface> argument. Known surfaces: ${Object.keys(SURFACES).join(', ')}`,
    );
    return 1;
  }
  const surface = SURFACES[surfaceKey];
  if (!surface) {
    console.error(`Error: unknown surface "${surfaceKey}". Known surfaces: ${Object.keys(SURFACES).join(', ')}`);
    return 1;
  }
  const cfg = loadConfig();
  const results = await runChecks(command, cfg, surface);
  const { text, allGreen } = renderReport(results);
  console.log(text);
  return allGreen ? 0 : 1;
}

/**
 * PURE. Returns one `name=expectation` string per endpoint on which the write surface's own
 * `probeRole` is NOT declared `'allow'` — empty when the probe identity is viable per the registry.
 *
 * THE GAP THIS CLOSES. `runProbePreflight` (#206) covers `verify`/`parity`/`rls`/`rbac`. It does NOT
 * cover `verify-write`, and cannot: a write's success probe is a MUTATION, so there is no
 * non-mutating way to ask the LIVE gate whether the probe identity is allowed. That left all 26
 * write endpoints across 7 write surfaces exposed to the #205 defect class, with a WORSE disposition
 * than the read side rather than a better one:
 *   - `cmdVerifyWrite` only ever checked that the probe token MINTED, never that it is granted.
 *   - `runWriteIdor` (checks/writes.ts) counts any status in `idorDeniedStatuses` (default
 *     [403, 404]) as isolation-held. A probeRole the product denies returns 403 to EVERY call, so
 *     the write-IDOR line reports `[PASS]` for a FIXTURE reason, not a product one.
 *   - Only `runWriteParity` fails closed on the non-200, and it runs LAST per endpoint. The run does
 *     go red overall, but the report still carries greens that prove nothing — the exact shape this
 *     harness exists to stop.
 * The registry's own claim needs no network, so it is checked before anything runs. Kept PURE and
 * exported for the same reason `preflightSurface` was extracted: a guard buried inside a function
 * that needs live Supabase credentials has no behavioural coverage at all.
 */
export function writeProbeRoleDenials(surface: AnyWriteSurface): string[] {
  return surface.endpoints
    .filter((ep) => ep.expectedByRole[surface.probeRole] !== 'allow')
    .map((ep) => `${ep.name}=${ep.expectedByRole[surface.probeRole] ?? 'undeclared'}`);
}

/**
 * Live write-verification for a WRITE surface (checks/writes.ts). Per endpoint runs
 * the two NON-mutating checks first (write-IDOR, write-RBAC-deny) then the single
 * mutating light-parity, so the precondition is intact when the non-mutating checks
 * read it back. Requires a FRESH `seed --teardown` + `seed` (an approve consumes the
 * pending fixture) and the surface's write flag ON (dark routes 404 → parity/rbac RED).
 */
async function cmdVerifyWrite(surfaceKey: string | undefined): Promise<number> {
  if (!surfaceKey) {
    console.error(
      `Error: "verify-write" requires a <surface> argument. Known write surfaces: ${Object.keys(WRITE_SURFACES).join(', ')}`,
    );
    return 1;
  }
  const surface = WRITE_SURFACES[surfaceKey];
  if (!surface) {
    console.error(
      `Error: unknown write surface "${surfaceKey}". Known write surfaces: ${Object.keys(WRITE_SURFACES).join(', ')}`,
    );
    return 1;
  }
  const cfg = loadConfig();
  const cache: TokenCache = new Map();
  // org-A token per surface role (the probe/allow + deny roles); writes only ever
  // exercise the org-A tenant (cross-org is the IDOR probe, using the org-A probe token).
  const tokensByRole: Record<string, string> = {};
  for (const u of planSeed(surface.roles).users) {
    if (u.orgKey === 'a') tokensByRole[u.role] = await getToken(cfg, u.email, u.password, cache);
  }
  const probeToken = tokensByRole[surface.probeRole];
  if (!probeToken) throw new Error(`verify-write: no probe token for role "${surface.probeRole}"`);

  // PROBE-ROLE VIABILITY, WRITE SIDE — see `writeProbeRoleDenials`. `verify-write` deliberately
  // does NOT run `runProbePreflight`,
  // and cannot: a write's success probe is a MUTATION, so there is no non-mutating way to ask the
  // LIVE gate whether this identity is allowed. What can be checked with no call at all is the
  // registry's own claim — the write-side analogue of surfaces.test.ts's probeRole-expects-200
  // invariant, closing the same #205 defect class on the 26 write endpoints the read preflight
  // never sees.
  //
  // The write side's disposition on a denied probeRole is WORSE than the read side's, which is why
  // this is fail-closed rather than a warning: `runWriteIdor` (checks/writes.ts) counts any status
  // in `idorDeniedStatuses` (default [403, 404]) as isolation-held, so an identity the product
  // refuses returns 403 to EVERY call and the IDOR line reports `[PASS]` for a FIXTURE reason
  // rather than a product one. The run does still go red overall — `runWriteParity` fails closed on
  // the non-200 — but a green that proves nothing is exactly what this harness exists to prevent.
  // Above the token check, not below it, would be pointless: minting proves the user exists, never
  // that it is granted.
  const probeDenied = writeProbeRoleDenials(surface);
  if (probeDenied.length > 0) {
    console.error(
      `verify-write ${surface.key}: PROBE IDENTITY NOT VIABLE — no check ran. The registry says probeRole ` +
        `"${surface.probeRole}" is NOT 'allow' on ${probeDenied.length} of ${surface.endpoints.length} ` +
        `endpoints (${probeDenied.join(', ')}). ` +
        `Fix the registry or the seeded grant — do NOT pick another role the product also denies. ` +
        `(Running anyway makes runWriteIdor report [PASS] for a fixture reason: a denied identity 403s ` +
        `every call, and 403 is a documented isolation-held status.)`,
    );
    return 1;
  }

  // Seed the surface's write-verify-only preconditions (kept out of the shared read seed so they
  // can't degrade the read RLS checks — see seed(). Each surface owns its hook). Idempotent.
  await surface.ensurePreconditions(cfg);

  const ids = await surface.resolveResources(cfg);
  const res: WriteResolvedBase = { base: cfg.csharpBase, ...ids };

  // Preflight: confirm the write routes are actually MOUNTED (flag ON). A no-token probe of a
  // mounted RequireAuthorization route is rejected by auth with 401; an UNMOUNTED route yields 404
  // (route absent) OR — when a live READ endpoint shares the path (e.g. GET /succession/critical-roles
  // is live while the POST is dark) — 405 (method-not-allowed). So the ONLY status that proves the
  // write route is mounted is 401; anything else means the write flag is likely OFF. Without this a
  // dark backend would 404 the by-id cross-org probes and FALSE-PASS those IDOR checks (a route-absent
  // 404 is indistinguishable from an access-denied 404). Bail loudly unless we see the mounted-401.
  const pf = surface.endpoints[0];
  const pfProbe = await callCsharpWrite(
    res.base,
    pf.method,
    pf.buildParity(res).path,
    '',
    pf.method === 'POST' ? {} : null,
  );
  if (pfProbe.status !== 401) {
    console.error(
      `verify-write: the "${surface.key}" write routes do not appear MOUNTED — a no-auth probe of ${pf.method} ${pf.buildParity(res).path} returned ${pfProbe.status}, expected 401 (a mounted auth-protected route rejects a no-token request with 401; 404/405/other ⇒ the write flag is likely OFF). Flip ${surface.flag}=true at canary, then re-run. (Running against a dark backend would false-pass the by-id IDOR checks.)`,
    );
    return 1;
  }

  const { readback, close } = await openReadback(cfg);
  const results: CheckResult[] = [];
  try {
    for (const ep of surface.endpoints) {
      results.push(await runWriteIdor(ep, res, probeToken, callCsharpWrite, readback));
      for (const probe of ep.extraProbes ?? []) {
        results.push(await runWriteExtraProbe(ep, probe, res, probeToken, callCsharpWrite, readback));
      }
      results.push(...(await runWriteRbac(ep, res, tokensByRole, surface.probeRole, callCsharpWrite, readback)));
      results.push(await runWriteParity(ep, res, probeToken, callCsharpWrite, readback));
    }
  } finally {
    await close();
  }
  const { text, allGreen } = renderReport(results);
  console.log(text);
  return allGreen ? 0 : 1;
}

/**
 * Pure-ish dispatcher: returns the process exit code rather than calling
 * `process.exit` itself, so the unknown-command/unknown-surface/missing-surface
 * branches (which never touch config/network) are unit-testable in isolation.
 */
export async function dispatch(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (!command) {
    console.error(USAGE);
    return 1;
  }
  switch (command) {
    case 'seed':
      return cmdSeed(argv.includes('--teardown'));
    case 'auth':
      return cmdAuth();
    case 'parity':
    case 'rls':
    case 'rbac':
    case 'verify':
      return cmdCheck(command, arg);
    case 'verify-write':
      return cmdVerifyWrite(arg);
    default:
      console.error(`Error: unknown command "${command}". ${USAGE}`);
      return 1;
  }
}

/**
 * Renders a thrown command error legibly. A bare `${err}` on a Supabase/pg
 * error (PostgrestError, AuthError, pg's DatabaseError) stringifies as
 * `[object Object]` since none of them override `toString`/have a message
 * that survives template coercion in all cases — so this pulls `.message`
 * plus the diagnostic fields those errors carry, when present. The field set
 * spans both dialects: node-postgres `DatabaseError` exposes `code`, `detail`
 * (singular — e.g. "Key (…)=(…) already exists"), and `constraint`; Supabase's
 * `PostgrestError`/`AuthError` expose `code`, `details` (plural), and `hint`.
 */
function formatCommandError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const withFields = err as unknown as Record<string, unknown>;
  for (const field of ['code', 'detail', 'details', 'constraint', 'hint'] as const) {
    const value = withFields[field];
    if (value !== undefined && value !== null && value !== '') parts.push(`${field}=${String(value)}`);
  }
  return parts.join(' | ');
}

async function main(): Promise<void> {
  try {
    const exitCode = await dispatch(process.argv.slice(2));
    process.exit(exitCode);
  } catch (err) {
    console.error(`parity: ${formatCommandError(err)}`);
    process.exit(1);
  }
}

// Only run when invoked directly (`tsx cli.ts ...`), not when imported by tests. ESM-safe
// entry check (this file is compiled/run as ESM under tsx and under vitest's vite-node).
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  void main();
}
