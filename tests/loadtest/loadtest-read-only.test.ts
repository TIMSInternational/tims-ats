import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Tripwire for scripts/loadtest/: the k6 suite must stay READ-ONLY.
//
// The suite is meant to be pointed at a deployed environment, so one stray write turns a load test
// into thousands of fake applications, CV uploads or Turnstile challenges. This pins three things
// statically, from the sources rather than from a hand-kept list:
//   1. k6/http is used for GET only (plus per-request cookie jars) — no other HTTP verb.
//   2. Every tRPC procedure the scripts name is on the allowlist AND is defined with `.query(` (not
//      `.mutation(`) in packages/api — so an allowlist edit cannot smuggle a mutation in.
//   3. Every default C# endpoint exists in the OpenAPI contract with a GET operation.
// Public apply and the CV-upload URL procedure are named explicitly as forbidden.

const ROOT = join(__dirname, '..', '..');
const LOADTEST_DIR = join(ROOT, 'scripts', 'loadtest');
const ROUTERS_DIR = join(ROOT, 'packages', 'api', 'src', 'routers');

const ALLOWED_TRPC = new Set([
  'portal.getPortalStats',
  'portal.listVacancies',
  'portal.getVacancy',
  'candidate.getDashboardKpis',
  'candidate.list',
  'vacancy.list',
  'pipeline.getBoard',
]);
const FORBIDDEN_TRPC = ['applyToVacancy', 'getCvUploadUrl'];

function k6Scripts(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'dev') walk(full); // dev/ holds the local mock SERVER, not k6 code
      } else if (name.endsWith('.js')) {
        out.push(full);
      }
    }
  };
  walk(LOADTEST_DIR);
  return out;
}

/** Drop full-line `//` comments and block comments so prose about exclusions does not match. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function routerSources(router: string): string[] {
  const file = join(ROUTERS_DIR, `${router}.ts`);
  const dir = join(ROUTERS_DIR, router);
  const files: string[] = [];
  if (existsSync(file)) files.push(file);
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    for (const name of readdirSync(dir)) if (name.endsWith('.ts')) files.push(join(dir, name));
  }
  return files.map((f) => readFileSync(f, 'utf8'));
}

/** The source of procedure `name` inside a router file: from `  name:` to the next sibling key. */
function procedureBody(source: string, name: string): string | undefined {
  const start = source.search(new RegExp(`\\n  ${name}: `));
  if (start === -1) return undefined;
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_]+: /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('scripts/loadtest is read-only', () => {
  const scripts = k6Scripts();

  it('finds the three scenario scripts and the shared helpers', () => {
    const names = scripts.map((s) => s.slice(LOADTEST_DIR.length + 1)).sort();
    expect(names).toEqual([
      'careers.js',
      'lib/config.js',
      'lib/guards.js',
      'lib/http.js',
      'platform-reads.js',
      'staff-reads.js',
    ]);
  });

  it('uses k6/http for GET only', () => {
    for (const file of scripts) {
      const src = code(readFileSync(file, 'utf8'));
      // Not preceded by `/` or `.`: skips module specifiers like './lib/http.js'.
      const uses = src.match(/(?<![\w/.])http\.[A-Za-z]+/g) ?? [];
      const bad = uses.filter((u) => u !== 'http.get' && u !== 'http.CookieJar');
      expect(bad, `${file} uses a non-GET k6/http API`).toEqual([]);
      expect(src, `${file} must not use fetch`).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('only names allowlisted tRPC procedures, each defined as a query', () => {
    const named = new Set<string>();
    for (const file of scripts) {
      const src = code(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/path:\s*'([A-Za-z0-9_.]+)'/g)) named.add(m[1]!);
      for (const forbidden of FORBIDDEN_TRPC) expect(src, `${file} names ${forbidden}`).not.toContain(forbidden);
    }
    expect(named.size).toBeGreaterThan(0);
    for (const proc of named) {
      expect(ALLOWED_TRPC.has(proc), `${proc} is not on the read-only allowlist`).toBe(true);
    }
    for (const proc of ALLOWED_TRPC) {
      const [router, name] = proc.split('.') as [string, string];
      const bodies = routerSources(router)
        .map((s) => procedureBody(s, name))
        .filter((b): b is string => b !== undefined);
      expect(bodies.length, `${proc} not found under packages/api/src/routers/${router}`).toBe(1);
      expect(bodies[0], `${proc} must be a query`).toMatch(/\.query\(/);
      expect(bodies[0], `${proc} must not be a mutation`).not.toMatch(/\.mutation\(/);
    }
  });

  it('defaults to C# endpoints that exist as GET operations in the OpenAPI contract', () => {
    const src = readFileSync(join(LOADTEST_DIR, 'platform-reads.js'), 'utf8');
    const m = src.match(/const DEFAULT_ENDPOINTS =\s*'([^']+)'/);
    expect(m, 'DEFAULT_ENDPOINTS literal not found').not.toBeNull();
    const contract = JSON.parse(readFileSync(join(ROOT, 'contracts', 'openapi', 'Tims.Api.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const endpoint of m![1]!.split(',')) {
      const path = endpoint.split('?')[0]!;
      expect(contract.paths[path]?.get, `${path} has no GET in contracts/openapi/Tims.Api.json`).toBeDefined();
    }
  });
});
