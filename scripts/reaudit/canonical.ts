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
 * The environment is neutralised as far as it is known to filter or alter a run: variables of the
 * runners' own namespaces are dropped (VITEST*, PW_*, PWTEST_*, PLAYWRIGHT_* except
 * PLAYWRIGHT_BROWSERS_PATH, VSTEST_*), and CI=true is set, which makes Vitest refuse `.only`
 * (allowOnly defaults to !CI) and turns on the repo Playwright config's `forbidOnly: isCI`. The reports
 * then show the effective setting and the collectors refuse a run where `.only` was allowed.
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

const DROPPED_ENV = /^(?:VITEST|PW_|PWTEST_|PLAYWRIGHT_|VSTEST_)/;
const KEPT_ENV = new Set(['PLAYWRIGHT_BROWSERS_PATH']);

/** The child environment for a canonical run: filter-capable runner variables dropped, CI=true. */
export type Env = Record<string, string | undefined>;

export function canonicalEnv(kind: EvidenceKind, output: string, base: Env): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(base)) {
    if (DROPPED_ENV.test(k) && !KEPT_ENV.has(k)) continue;
    env[k] = v;
  }
  env.CI = 'true';
  if (kind === 'playwright') env.PLAYWRIGHT_JSON_OUTPUT_FILE = output;
  return env;
}
