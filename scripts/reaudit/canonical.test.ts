import { describe, it, expect } from 'vitest';
import { canonicalArgv, canonicalEnv, canonicalOutput } from './canonical';

// Evidence is accepted only from one full, unfiltered suite run per kind. record.ts runs exactly the
// canonical argv; provenance.ts re-checks the recorded argv with canonicalOutput.

const OUT = '/private/evidence/out';

describe('canonicalArgv / canonicalOutput', () => {
  it('each canonical argv is accepted and names its output path', () => {
    expect(canonicalOutput('vitest', canonicalArgv('vitest', `${OUT}.json`))).toBe(`${OUT}.json`);
    expect(canonicalOutput('xunit', canonicalArgv('xunit', OUT))).toBe(OUT);
    expect(canonicalOutput('playwright', canonicalArgv('playwright', OUT))).toBe('');
  });

  it('the canonical commands are the full suites', () => {
    expect(canonicalArgv('vitest', '/o.json')).toEqual([
      'npx',
      'vitest',
      'run',
      '--reporter=./scripts/reaudit/vitest-json-reporter.ts',
      '--outputFile=/o.json',
    ]);
    expect(canonicalArgv('playwright', '/o.json')).toEqual([
      'pnpm',
      '--filter',
      '@tims/e2e',
      'exec',
      'playwright',
      'test',
      '--reporter=json',
    ]);
    expect(canonicalArgv('xunit', '/o')).toEqual([
      'dotnet',
      'test',
      'services/Tims.Platform/Tims.Platform.slnx',
      '--logger',
      'trx',
      '--results-directory',
      '/o',
    ]);
  });

  it('a filtered or partial vitest argv is not canonical', () => {
    const base = canonicalArgv('vitest', `${OUT}.json`);
    for (const extra of [
      ['tests/a.test.ts'],
      ['-t', 'syn-a'],
      ['--testNamePattern=syn'],
      ['--project', 'node'],
      ['--shard=1/2'],
      ['--changed'],
      ['--related', 'x.ts'],
      ['--exclude', 'tests/b.test.ts'],
      ['--allowOnly'],
      ['--config', 'other.config.ts'],
    ]) {
      expect(canonicalOutput('vitest', [...base, ...extra])).toBeUndefined();
    }
    expect(canonicalOutput('vitest', ['npx', 'vitest', 'run', 'tests/a.test.ts', `--outputFile=${OUT}`])).toBe(
      undefined,
    );
    expect(canonicalOutput('vitest', ['npx', 'vitest', 'run', '--reporter=json', `--outputFile=${OUT}`])).toBe(
      undefined,
    );
  });

  it('a filtered or partial playwright argv is not canonical', () => {
    const base = canonicalArgv('playwright', OUT);
    for (const extra of [
      ['specs/company/a.spec.ts'],
      ['--grep', '@finding:syn-a'],
      ['-g', 'x'],
      ['--grep-invert', 'x'],
      ['--project', 'company'],
      ['--shard', '1/2'],
      ['--last-failed'],
      ['--only-changed'],
      ['--test-list', 'l.txt'],
      ['--no-deps'],
    ]) {
      expect(canonicalOutput('playwright', [...base, ...extra])).toBeUndefined();
    }
  });

  it('a filtered or partial dotnet argv is not canonical', () => {
    const base = canonicalArgv('xunit', OUT);
    expect(canonicalOutput('xunit', [...base, '--filter', 'Category!=LiveNetwork'])).toBeUndefined();
    expect(canonicalOutput('xunit', [...base, '--settings', 'x.runsettings'])).toBeUndefined();
    const oneProject = [...base];
    oneProject[2] = 'services/Tims.Platform/tests/Tims.UnitTests/Tims.UnitTests.csproj';
    expect(canonicalOutput('xunit', oneProject)).toBeUndefined();
  });

  it('a relative or empty output path is not canonical', () => {
    expect(canonicalOutput('vitest', canonicalArgv('vitest', 'rel/out.json'))).toBeUndefined();
    expect(canonicalOutput('xunit', canonicalArgv('xunit', ''))).toBeUndefined();
  });

  it('the argv of one kind is not canonical for another', () => {
    expect(canonicalOutput('xunit', canonicalArgv('vitest', OUT))).toBeUndefined();
    expect(canonicalOutput('playwright', canonicalArgv('vitest', OUT))).toBeUndefined();
  });
});

describe('canonicalEnv', () => {
  const base = {
    PATH: '/bin',
    PLAYWRIGHT_BROWSERS_PATH: '/browsers',
    PW_TEST_SOURCE_TRANSFORM: '/x.js',
    PWTEST_SHARD: '1/2',
    PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: '/x.json',
    VITEST_FILTER: 'x',
    VSTEST_TESTCASE_FILTER: 'x',
    CI: '',
  };

  it('drops the runners’ own variables (except the browser install path) and sets CI=true', () => {
    const env = canonicalEnv('vitest', '/o.json', base);
    expect(env).toEqual({ PATH: '/bin', PLAYWRIGHT_BROWSERS_PATH: '/browsers', CI: 'true' });
  });

  it('points the Playwright JSON reporter at the output', () => {
    expect(canonicalEnv('playwright', '/o.json', base).PLAYWRIGHT_JSON_OUTPUT_FILE).toBe('/o.json');
    expect(canonicalEnv('vitest', '/o.json', base).PLAYWRIGHT_JSON_OUTPUT_FILE).toBeUndefined();
  });
});
