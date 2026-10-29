/**
 * The only test commands whose output the harness accepts as evidence: one full, unfiltered suite run
 * per kind, run from the checkout root.
 *
 *   vitest      npx vitest run --reporter=./scripts/reaudit/vitest-json-reporter.ts --outputFile=<output>
 *   playwright  pnpm --filter @tims/e2e exec playwright test --reporter=json   (output via PLAYWRIGHT_JSON_OUTPUT_FILE)
 *   xunit       dotnet test services/Tims.Platform/Tims.Platform.slnx --logger trx --results-directory <output>
 *
 * Nothing else is accepted: no file arguments, no -t / --grep / --project / --shard / --filter /
 * --last-failed / --only-changed / --changed / --related, no other config. record.ts runs exactly
 * this argv and writes it into the provenance manifest; provenance.ts re-checks the recorded argv
 * against the same templates, so a manifest naming any other command is refused at collect time too.
 *
 * Why: a finding is FIXED-VERIFIED only if every check bound to it passed. A filtered or partial run can
 * leave a bound check out while a sibling's pass stands for the finding. Accepting only complete runs
 * closes that by construction instead of by inferring, from source, which checks should have run.
 *
 * The environment is an ALLOWLIST (ALLOWED_ENV), not a denylist: anything else is dropped, because
 * runners read configuration from the environment in ways that cannot be enumerated (MSBuild, under
 * `dotnet test`, reads EVERY variable as a property, so VSTestTestCaseFilter, VSTestSetting or
 * VSTestNoBuild in the caller's shell would filter the run or skip the build). The allowed names are
 * process plumbing (PATH, HOME, temp dirs, locale, tool and browser install locations, the Docker socket
 * for Testcontainers). CI=true is then set, which makes Vitest refuse `.only` (allowOnly defaults to
 * !CI) and turns on the repo Playwright config's `forbidOnly: isCI`; the reports show the effective
 * setting and the collectors refuse a run where `.only` was allowed. Not controlled: the CONTENTS of
 * allowed variables (e.g. a PATH whose `npx` or `dotnet` is not the real one).
 */
import { isAbsolute } from 'node:path';
import type { EvidenceKind } from './provenance';

export const VITEST_REPORTER = './scripts/reaudit/vitest-json-reporter.ts';
export const XUNIT_SOLUTION = 'services/Tims.Platform/Tims.Platform.slnx';

/** Marks where the output path goes in a template argument. */
const OUT = '\u0000OUTPUT\u0000';

const TEMPLATES: Record<EvidenceKind, readonly string[]> = {
  vitest: ['npx', 'vitest', 'run', `--reporter=${VITEST_REPORTER}`, `--outputFile=${OUT}`],
  playwright: ['pnpm', '--filter', '@tims/e2e', 'exec', 'playwright', 'test', '--reporter=json'],
  xunit: ['dotnet', 'test', XUNIT_SOLUTION, '--logger', 'trx', '--results-directory', OUT],
};

/** The canonical argv for `kind` writing to the absolute path `output`. */
export function canonicalArgv(kind: EvidenceKind, output: string): string[] {
  return TEMPLATES[kind].map((a) => a.replace(OUT, output));
}

/**
 * The absolute output path a canonical argv names ('' for Playwright, whose output path is set through
 * the environment), or undefined when `argv` is not the canonical command for `kind`.
 */
export function canonicalOutput(kind: EvidenceKind, argv: readonly string[]): string | undefined {
  const t = TEMPLATES[kind];
  if (argv.length !== t.length) return undefined;
  let output = '';
  for (let i = 0; i < t.length; i++) {
    const want = t[i] as string;
    const got = argv[i] as string;
    const [pre, post] = want.split(OUT) as [string, string | undefined];
    if (post === undefined) {
      if (got !== want) return undefined;
      continue;
    }
    if (got.length <= pre.length + post.length || !got.startsWith(pre) || !got.endsWith(post)) return undefined;
    output = got.slice(pre.length, got.length - post.length);
    if (!isAbsolute(output)) return undefined;
  }
  return output;
}

/** Process plumbing only; matched case-sensitively, so `Path` or `home` is dropped too. */
const ALLOWED_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'PNPM_HOME',
  'DOTNET_ROOT',
  'NUGET_PACKAGES',
  'PLAYWRIGHT_BROWSERS_PATH',
  'DOCKER_HOST',
]);

export type Env = Record<string, string | undefined>;

/** The child environment for a canonical run: allowlisted variables only, plus CI=true. */
export function canonicalEnv(kind: EvidenceKind, output: string, base: Env): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(base)) if (ALLOWED_ENV.has(k)) env[k] = v;
  env.CI = 'true';
  if (kind === 'playwright') env.PLAYWRIGHT_JSON_OUTPUT_FILE = output;
  return env;
}
