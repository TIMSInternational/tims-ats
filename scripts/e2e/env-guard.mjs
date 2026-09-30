// E2E env isolation guard for apps/web.
//
// Next (build AND server) runs @next/env's loadEnvConfig on apps/web, which fills every key that is
// UNDEFINED in process.env from apps/web/.env* — and on a developer machine apps/web/.env.local is a
// symlink to the live root .env. `unset` in up.sh therefore does not keep a live key out; only an
// explicit value (the empty string) does. up.sh writes those empty values; this guard proves they
// took, by asking @next/env itself which files it would load and refusing to continue if any key
// in them is not already defined in the process env.
//
// It also scans the FINAL effective env (process env + anything .env files would add) for
// http(s)/postgres URLs and refuses any non-local host — the generated web.env alone is not the
// whole env the app sees.
//
// Only key NAMES and URL HOSTS are ever printed, never values.
//
// CLI (run from apps/web):  node ../../scripts/e2e/env-guard.mjs
// Module:                   assertEnvIsolated(dir, env)
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CI runner metadata — never read by the app, and legitimately points at github.com.
const URL_SCAN_SKIP = /^(GITHUB_|ACTIONS_|RUNNER_|npm_)/;
const URL_RE = /(https?|postgres(?:ql)?):\/\/[^\s;"',]+/g;

// Resolve @next/env through apps/web's own `next`, the exact copy Next uses. (Resolved from this
// file, not from `dir`, so a fixture directory without node_modules can be inspected too.)
function loadNextEnv() {
  const req = createRequire(fileURLToPath(new URL('../../apps/web/package.json', import.meta.url)));
  const nextDir = dirname(req.resolve('next/package.json'));
  return req(req.resolve('@next/env', { paths: [nextDir] }));
}

export function isLocalHost(host, e2eName = 'tims-e2e-ci') {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === 'host.docker.internal' ||
    host.startsWith(`${e2eName}-`)
  );
}

function hostOf(url) {
  return url
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/:[0-9]+$/, '');
}

/**
 * Returns { leakedKeys, nonLocal } without mutating `env`. `leakedKeys` are key names a .env file in
 * `dir` would supply because `env` leaves them undefined; `nonLocal` is [key, host] for every
 * non-local URL in the effective env.
 */
export function inspectEnv(dir, env = process.env, { mode = 'production', e2eName } = {}) {
  const { loadEnvConfig } = loadNextEnv();
  const saved = { ...process.env };
  let loaded;
  try {
    // loadEnvConfig reads process.env; evaluate against `env` and restore afterwards.
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, env, { NODE_ENV: mode });
    loaded = loadEnvConfig(dir, false, { info() {}, error() {} }, true).loadedEnvFiles;
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const fromFiles = {};
  for (const f of loaded) {
    for (const [k, v] of Object.entries(f.env)) if (!(k in fromFiles)) fromFiles[k] = v;
  }
  const leakedKeys = Object.keys(fromFiles)
    .filter((k) => env[k] === undefined)
    .sort();
  const effective = { ...fromFiles, ...env };
  const nonLocal = [];
  for (const [k, v] of Object.entries(effective)) {
    if (URL_SCAN_SKIP.test(k) || typeof v !== 'string') continue;
    for (const m of v.matchAll(URL_RE)) {
      const host = hostOf(m[0]);
      if (!isLocalHost(host, e2eName)) nonLocal.push([k, host]);
    }
  }
  return { leakedKeys, nonLocal, files: loaded.map((f) => f.path) };
}

export function assertEnvIsolated(dir, env = process.env, opts = {}) {
  const { leakedKeys, nonLocal } = inspectEnv(dir, env, opts);
  const problems = [];
  if (leakedKeys.length) {
    problems.push(
      `these keys would be loaded from a .env file in ${dir} (set them explicitly, e.g. empty, in the ` +
        `generated web env): ${leakedKeys.join(', ')}`,
    );
  }
  if (nonLocal.length) {
    problems.push('non-local URL(s) in the effective env: ' + nonLocal.map(([k, h]) => `${k} -> ${h}`).join(', '));
  }
  if (problems.length) {
    throw new Error(`[e2e env-guard] refusing to start:\n  - ${problems.join('\n  - ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    assertEnvIsolated(process.cwd(), process.env, { e2eName: process.env.E2E_NAME });
    console.error('[e2e env-guard] ok: no key comes from a .env file; every URL is local');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(3);
  }
}
