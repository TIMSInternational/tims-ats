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
 * (`callCsharp`, Bearer) and are unaffected.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { fileURLToPath } from 'node:url';
import { loadConfig, type HarnessConfig } from './config';
import { getToken, getSessionCookie, type TokenCache, type CookieCache } from './supabase';
import { planSeed, seed, teardown } from './seed';
import { callCsharp, callTs } from './callers';
import { SURFACES, type Surface } from './surfaces';
import { runParityEndpoint } from './checks/parity';
import { runRlsEndpoint, type RlsContext } from './checks/rls';
import { runRbacEndpoint, type RbacContext } from './checks/rbac';
import { renderReport, type CheckResult } from './report';

type CheckCommand = 'parity' | 'rls' | 'rbac' | 'verify';

const USAGE =
  'Usage: tsx scripts/parity/cli.ts <seed [--teardown] | auth | parity <surface> | rls <surface> | rbac <surface> | verify <surface>>';

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
  if (!orgBToken) throw new Error(`mintTokens: failed to mint org-B token for role "${primaryRole}"`);
  if (!orgACookie) throw new Error(`mintTokens: failed to mint org-A session cookie for role "${primaryRole}"`);
  return { orgAToken, orgBToken, orgACookie, tokensByRole };
}

/** Runs the requested check(s) over every endpoint of `surface`, returning the
 *  combined result list `renderReport` consumes. `verify` runs all three. */
async function runChecks(command: CheckCommand, cfg: HarnessConfig, surface: Surface): Promise<CheckResult[]> {
  const cache: TokenCache = new Map();
  const { orgAToken, orgBToken, orgACookie, tokensByRole } = await mintTokens(cfg, surface, cache);
  const results: CheckResult[] = [];

  if (command === 'parity' || command === 'verify') {
    // Bind base + the org-A probe identity's credentials into the (path,input)/
    // (proc,input) closure shapes `runParityEndpoint` expects: C# via Bearer
    // token, TS via the session cookie (both the SAME identity).
    const csharpCaller = (path: string, _input: unknown) => callCsharp(cfg.csharpBase, path, orgAToken);
    const tsCaller = (proc: string, input: unknown) => callTs(cfg.tsBase, proc, input, orgACookie);
    for (const ep of surface.endpoints) results.push(await runParityEndpoint(ep, csharpCaller, tsCaller));
  }

  if (command === 'rls' || command === 'verify') {
    const ctx: RlsContext = { base: cfg.csharpBase, orgAToken, orgBToken };
    for (const ep of surface.endpoints) results.push(await runRlsEndpoint(ep, ctx, callCsharp));
  }

  if (command === 'rbac' || command === 'verify') {
    const ctx: RbacContext = { base: cfg.csharpBase, tokensByRole };
    for (const ep of surface.endpoints) results.push(...(await runRbacEndpoint(ep, ctx, callCsharp)));
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
      console.error(`parity: auth failed for ${u.orgKey}:${u.role} (${u.email}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`parity: auth — ${ok} succeeded, ${failed} failed (of ${plan.users.length}).`);
  return failed === 0 ? 0 : 1;
}

async function cmdCheck(command: CheckCommand, surfaceKey: string | undefined): Promise<number> {
  if (!surfaceKey) {
    console.error(`Error: "${command}" requires a <surface> argument. Known surfaces: ${Object.keys(SURFACES).join(', ')}`);
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
