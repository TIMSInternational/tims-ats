import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface HarnessConfig {
  supabaseUrl: string; projectRef: string; serviceRoleKey: string;
  anonKey: string; csharpBase: string; tsBase: string;
  /** Direct-Postgres connection string (role has BYPASSRLS). OPTIONAL: the Data
   *  API (PostgREST) is locked down for `service_role` on this prod project
   *  (42501 permission-denied), so `seed`/`teardown` write DB rows via `pg`
   *  instead — see scripts/parity/seed.ts. Not required for `parity`/`rls`/
   *  `rbac`, which never touch the DB directly. Resolved by `resolveDatabaseUrl`:
   *  PARITY_DATABASE_URL wins over DATABASE_URL. */
  databaseUrl?: string;
}

/** The harness-only override for the direct-Postgres connection string. See `resolveDatabaseUrl`. */
export const PARITY_DATABASE_URL = 'PARITY_DATABASE_URL';

/** Connection-string query keys that pg-connection-string turns into an `ssl` config which REPLACES
 *  the pinned-CA `ssl` object seed.ts passes (pg's ConnectionParameters does
 *  `Object.assign({}, config, parse(connectionString))`). `?sslmode=no-verify` would therefore turn the
 *  pinned verify-full connection into an unverified one, and `?sslmode=require` into one verified against
 *  Node's default store (which does not hold Supabase's root CA). The harness owns TLS itself, so the
 *  override refuses them rather than let a pasted dashboard string downgrade verification. */
const TLS_OVERRIDING_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation', 'uselibpqcompat'];

/**
 * PURE. Picks the direct-Postgres connection string the seed/teardown/read-back paths use.
 *
 * WHY THE OVERRIDE EXISTS. `DATABASE_URL` points at `db.<ref>.supabase.co`, which Supabase serves over
 * IPv6 ONLY. A machine or CI runner without IPv6 fails DNS with ENOTFOUND before any query runs, so no
 * `seed`, `verify` of a by-id surface, or `verify-write` can run from it. Supabase's SESSION pooler
 * (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`) is reachable over IPv4 and keeps
 * session semantics (the harness uses plain parameterized queries, no prepared-statement reuse across
 * transactions). Pointing the harness at it must not require editing the shared `DATABASE_URL`, which
 * other tooling reads — hence a separate, harness-only variable that TAKES PRECEDENCE when set.
 *
 * TLS is unchanged: seed.ts still connects with the pinned Supabase root CA and `rejectUnauthorized:
 * true` (verify-full — Node's checkServerIdentity runs). The override is refused if it carries any
 * TLS-overriding query parameter (see TLS_OVERRIDING_PARAMS), because pg would let it silently replace
 * that pinned config. Use the TRANSACTION pooler (:6543) at your own risk — it is not what this was
 * written for.
 *
 * Blank / whitespace-only values are treated as unset, so `PARITY_DATABASE_URL=` in a .env does not
 * shadow a working DATABASE_URL with an empty string.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
): { url: string; source: 'PARITY_DATABASE_URL' | 'DATABASE_URL' } | undefined {
  const override = env[PARITY_DATABASE_URL]?.trim();
  if (override) {
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new ConfigError(`${PARITY_DATABASE_URL} is not a valid URL (expected postgresql://user:pass@host:port/db)`);
    }
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new ConfigError(`${PARITY_DATABASE_URL} must be a postgres:// or postgresql:// URL, got "${parsed.protocol}"`);
    }
    const tlsParams = TLS_OVERRIDING_PARAMS.filter((k) => parsed.searchParams.has(k));
    if (tlsParams.length) {
      throw new ConfigError(
        `${PARITY_DATABASE_URL} carries TLS parameter(s) [${tlsParams.join(', ')}] that would replace the harness's ` +
          'pinned verify-full TLS (scripts/parity/supabase-root-ca.pem). Remove them — the harness sets TLS itself.',
      );
    }
    return { url: override, source: 'PARITY_DATABASE_URL' };
  }
  const direct = env.DATABASE_URL?.trim();
  return direct ? { url: direct, source: 'DATABASE_URL' } : undefined;
}

const REQUIRED = {
  supabaseUrl: 'SUPABASE_URL', projectRef: 'SUPABASE_PROJECT_REF',
  serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY', anonKey: 'SUPABASE_ANON_KEY',
  csharpBase: 'TIMS_CSHARP_BASE', tsBase: 'TIMS_TS_BASE',
} as const;

export function parseConfig(env: Record<string, string | undefined>): HarnessConfig {
  const missing: string[] = [];
  const out = {} as Record<keyof typeof REQUIRED, string>;
  for (const [key, varName] of Object.entries(REQUIRED) as [keyof typeof REQUIRED, string][]) {
    const v = env[varName];
    if (!v) missing.push(varName); else out[key] = v;
  }
  if (missing.length) throw new ConfigError(`Missing env vars: ${missing.join(', ')}`);
  const databaseUrl = resolveDatabaseUrl(env)?.url;
  return (databaseUrl ? { ...out, databaseUrl } : out) as HarnessConfig;
}

/** Parses .env-style text (KEY=VALUE lines) into a plain object, stripping full-line
 *  and whitespace-preceded inline comments per dotenv convention. Pure + testable. */
export function parseEnvText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    // strip a whitespace-preceded inline comment (dotenv convention), then trim
    const value = m[2].replace(/\s+#.*$/, '').trim();
    out[m[1]] = value;
  }
  return out;
}

/** PURE. scripts/parity/.env (KEY=VALUE lines) merged OVER process.env — except PARITY_DATABASE_URL, where
 *  a non-blank process.env value wins over the file. The override is meant to be set per invocation
 *  (`PARITY_DATABASE_URL=… npx tsx scripts/parity/cli.ts …`); if a stale value in .env could beat it, the
 *  command line would silently connect somewhere else. */
export function mergeEnv(
  processEnv: Record<string, string | undefined>,
  fileVars: Record<string, string>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...processEnv, ...fileVars };
  if (processEnv[PARITY_DATABASE_URL]?.trim()) merged[PARITY_DATABASE_URL] = processEnv[PARITY_DATABASE_URL];
  return merged;
}

/** Loads scripts/parity/.env (KEY=VALUE lines) merged over process.env (see `mergeEnv`), then parses. */
export function loadConfig(): HarnessConfig {
  let env: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    env = mergeEnv(process.env, parseEnvText(raw));
  } catch { /* .env optional if vars already in process.env */ }
  return parseConfig(env);
}
