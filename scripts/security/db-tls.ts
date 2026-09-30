/**
 * TLS policy for the live-database checks (14, 16, 17) — PR #292 tier-3 findings.
 *
 * WHY THIS EXISTS
 * ---------------
 * These checks run against PRODUCTION with a real credential. Until this module, certificate
 * verification depended on accidents:
 *
 *   - pg@8 silently treats `sslmode=require|prefer|verify-ca` as `verify-full` (and warns that this
 *     aliasing will change in pg@9). A URL that SAYS `require` was being verified only because of that
 *     alias — the day the alias goes away, the check stops verifying the server and nobody notices.
 *   - libpq (pg_dump, check 16) does NOT alias: `require` there means "encrypt, trust anyone".
 *
 * So the rule is explicit and identical for every client: a remote connection string must say
 * `sslmode=verify-full`, and the Node clients are built with `ssl.rejectUnauthorized = true` set by us,
 * not inferred from the URL. Loopback hosts are exempt (a throwaway local cluster has no network hop
 * to protect, and the offline test suites use 127.0.0.1:1).
 *
 * NOTHING HERE EVER PRINTS THE URL. Error messages name the problem, never the value.
 */
import { readFileSync } from 'node:fs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type TlsVerdict = { ok: true; loopback: boolean } | { ok: false; reason: string };

/**
 * Decide whether `url` is acceptable. Pure: no I/O, never echoes the URL or any part of it except the
 * sslmode keyword the caller supplied.
 */
export function checkVerifyFull(url: string, opts: { allowLoopback?: boolean } = {}): TlsVerdict {
  const allowLoopback = opts.allowLoopback ?? true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      reason: 'the connection string is not a postgres:// URI (key=value strings are not accepted here).',
    };
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { ok: false, reason: 'the connection string is not a postgres:// or postgresql:// URI.' };
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  const modes = parsed.searchParams.getAll('sslmode');
  if (modes.length > 1) {
    // libpq and pg disagree on which duplicate wins; refuse rather than guess.
    return { ok: false, reason: 'the connection string sets sslmode more than once.' };
  }
  const mode = modes[0];
  if (mode === 'verify-full') return { ok: true, loopback };
  if (loopback && allowLoopback) return { ok: true, loopback };
  const shown = mode === undefined ? 'absent' : /^[a-z-]{1,16}$/.test(mode) ? `"${mode}"` : '(unrecognised)';
  return {
    ok: false,
    reason:
      `sslmode is ${shown}, not "verify-full". Anything weaker lets a network attacker impersonate the ` +
      'database (libpq does not verify the server for require/prefer, and only the CA for verify-ca). ' +
      'Append sslmode=verify-full to the connection string and set PGSSLROOTCERT=scripts/parity/supabase-root-ca.pem.',
  };
}

/**
 * pg ClientConfig with verification set EXPLICITLY. Every `ssl*` URL parameter is stripped, because pg
 * lets URL-derived ssl settings override the `ssl` object passed alongside `connectionString`.
 *
 * CA: PGSSLROOTCERT (the same variable libpq/pg_dump read) if set; otherwise Node's default store plus
 * NODE_EXTRA_CA_CERTS. Hostname verification is Node's default checkServerIdentity — i.e. verify-full.
 */
export function pgClientConfig(
  url: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
} {
  const verdict = checkVerifyFull(url);
  if (!verdict.ok) throw new Error(verdict.reason);
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl')) parsed.searchParams.delete(key);
  }
  const connectionString = parsed.toString();
  // Loopback without an explicit verify-full keeps the old behaviour (no TLS) for local clusters.
  if (verdict.loopback && new URL(url).searchParams.get('sslmode') !== 'verify-full') {
    return { connectionString, ssl: false };
  }
  const caPath = env.PGSSLROOTCERT;
  if (caPath && caPath !== 'system') {
    return { connectionString, ssl: { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') } };
  }
  return { connectionString, ssl: { rejectUnauthorized: true } };
}
