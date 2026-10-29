import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalArgv } from './canonical';
import { runRecord, type RecordSpawn } from './record';
import { manifestPathFor, verifyProvenance } from './provenance';

// record.ts is the evidence-producing step: it wraps the real test command, so the SHA in the manifest is
// the SHA the tests ran at, not a SHA stamped on afterwards. These tests use a real git repository and
// spawn a real child process (node) as the "test run". Reports are private: --output must be outside
// every checkout of the repository.

let base: string;
let repo: string;
let priv: string;
let lines: string[];
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A node one-liner that writes `files` (absolute, or relative to the repo) and exits with `code`. */
function nodeWriting(files: Record<string, string>, code = 0, extra = ''): string[] {
  const body = Object.entries(files)
    .map(
      ([f, c]) =>
        `fs.mkdirSync(path.dirname(${JSON.stringify(f)}),{recursive:true});fs.writeFileSync(${JSON.stringify(f)},${JSON.stringify(c)});`,
    )
    .join('');
  return [process.execPath, '-e', `const fs=require('fs'),path=require('path');${body}${extra}process.exit(${code});`];
}

type Kind = 'vitest' | 'playwright' | 'xunit';
let spawned: { cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined> }[];

/**
 * record.ts runs the canonical test command; these tests replace the PROCESS it spawns with `script` (a
 * node one-liner), run in the cwd and environment record.ts chose, and keep what record.ts asked to run.
 */
const runs =
  (script: string[]): RecordSpawn =>
  (cmd, args, opts) => {
    spawned.push({ cmd, args, ...opts });
    const r = spawnSync(script[0] as string, script.slice(1), {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: 'ignore',
    });
    return { status: r.status, signal: r.signal, error: r.error };
  };
const io = (script: string[], cwd = repo) => ({
  cwd,
  log: (s: string) => lines.push(s),
  err: (s: string) => lines.push(s),
  spawn: runs(script),
});
/** record.ts --kind <kind> --output <out> [...extra], with the test run replaced by `script`. */
const rec = (kind: Kind, out: string, script: string[], extra: string[] = [], cwd = repo) =>
  runRecord(['--kind', kind, '--output', out, ...extra], io(script, cwd));

const manifest = (out: string, kind: 'vitest' | 'playwright' | 'xunit' = 'vitest') =>
  JSON.parse(readFileSync(manifestPathFor(out, kind), 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-record-')));
  repo = join(base, 'repo');
  priv = join(base, 'private');
  mkdirSync(repo);
  mkdirSync(priv);
  lines = [];
  spawned = [];
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('runRecord', () => {
  it('runs the command, propagates its exit status and records HEAD, the status and the report hash', () => {
    const out = join(priv, 'vitest.json');
    const code = rec('vitest', out, nodeWriting({ [out]: '{}' }, 3));
    expect(code).toBe(3);
    const m = manifest(out);
    expect(m.headSha).toBe(git('rev-parse', 'HEAD'));
    expect(m.checkoutRoot).toBe(git('rev-parse', '--show-toplevel'));
    expect(m.exitCode).toBe(3);
    expect(m.dirty).toBe(false);
    expect(() =>
      verifyProvenance({ kind: 'vitest', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: true }),
    ).not.toThrow();
  });

  it('evidence recorded at an earlier commit is refused once HEAD moves on (the stale-report case)', () => {
    const out = join(priv, 'pw.json');
    expect(rec('playwright', out, nodeWriting({ [out]: '{}' }))).toBe(0);
    git('commit', '-q', '--allow-empty', '-m', 'next');
    expect(() =>
      verifyProvenance({ kind: 'playwright', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: false }),
    ).toThrow(/not evidence of HEAD/);
  });

  it('an output that already exists is refused before the command runs (evidence must come from this run)', () => {
    const out = join(priv, 'vitest.json');
    rec('vitest', out, nodeWriting({ [out]: '{}' }));
    rmSync(manifestPathFor(out, 'vitest'));
    const marker = join(priv, 'ran');
    const code = rec('vitest', out, nodeWriting({ [marker]: 'x' }));
    expect(code).toBe(2);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('an --output inside the checkout (even a gitignored path) → 2 before the command runs', () => {
    for (const out of [join(repo, 'ignored', 'vitest.json'), join(repo, 'test-results', 'results.json')]) {
      lines = [];
      const marker = join(priv, 'ran');
      const code = rec('vitest', out, nodeWriting({ [marker]: 'x' }));
      expect(code).toBe(2);
      expect(existsSync(marker)).toBe(false);
      expect(lines.join('\n')).toMatch(/inside the repository/);
    }
  });

  it('an --output that is a DANGLING symlink into the checkout → 2, the command never runs, nothing lands in the repo', () => {
    const out = join(priv, 'report.json');
    const target = join(repo, 'private-report.json');
    symlinkSync(target, out);
    const marker = join(priv, 'ran');
    const code = rec('vitest', out, nodeWriting({ [out]: '{}', [marker]: 'x' }));
    expect(code).toBe(2);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('an --output that is a dangling symlink to a harmless place is still an existing entry → 2', () => {
    const out = join(priv, 'report.json');
    symlinkSync(join(priv, 'nowhere.json'), out);
    expect(rec('vitest', out, nodeWriting({ [out]: '{}' }))).toBe(2);
    expect(existsSync(join(priv, 'nowhere.json'))).toBe(false);
  });

  it('a manifest path that is a dangling symlink → 2 before the command runs', () => {
    const out = join(priv, 'vitest.json');
    symlinkSync(join(priv, 'elsewhere'), manifestPathFor(out, 'vitest'));
    const marker = join(priv, 'ran');
    expect(rec('vitest', out, nodeWriting({ [marker]: 'x' }))).toBe(2);
    expect(existsSync(marker)).toBe(false);
  });

  it('an --output inside a SIBLING worktree of the same repository → 2', () => {
    const sibling = join(base, 'sibling-wt');
    git('worktree', 'add', '-q', '--detach', sibling);
    const out = join(sibling, 'vitest.json');
    expect(rec('vitest', out, nodeWriting({ [out]: '{}' }))).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('a relative --output resolves against the working directory, so inside the checkout → 2', () => {
    expect(rec('vitest', 'audit.json', nodeWriting({ 'audit.json': '{}' }))).toBe(2);
    expect(existsSync(join(repo, 'audit.json'))).toBe(false);
  });

  it('HEAD moving during the run → 2 and no manifest (the evidence is of no single commit)', () => {
    const out = join(priv, 'vitest.json');
    const cmd = nodeWriting(
      { [out]: '{}' },
      0,
      `require('child_process').execFileSync('git',['commit','-q','--allow-empty','-m','mid-run']);`,
    );
    expect(rec('vitest', out, cmd)).toBe(2);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('an untracked file present when the run starts is recorded as dirty', () => {
    writeFileSync(join(repo, 'extra.spec.ts'), 'x');
    const out = join(priv, 'vitest.json');
    rec('vitest', out, nodeWriting({ [out]: '{}' }));
    expect(manifest(out).dirty).toBe(true);
    expect(manifest(out).dirtyPaths).toEqual(['extra.spec.ts']);
  });

  it('an untracked file present at the start stays recorded as dirty even if the run deletes it', () => {
    writeFileSync(join(repo, 'extra.spec.ts'), 'x');
    const out = join(priv, 'vitest.json');
    rec('vitest', out, nodeWriting({ [out]: '{}' }, 0, `fs.rmSync('extra.spec.ts');`));
    expect(manifest(out).dirtyPaths).toEqual(['extra.spec.ts']);
  });

  it('an untracked file the run creates is recorded as dirty', () => {
    const out = join(priv, 'vitest.json');
    rec('vitest', out, nodeWriting({ [out]: '{}', 'leak.ts': 'x' }));
    expect(manifest(out).dirtyPaths).toEqual(['leak.ts']);
  });

  it('a gitignored file the run creates is not dirt', () => {
    const out = join(priv, 'vitest.json');
    rec('vitest', out, nodeWriting({ [out]: '{}', 'ignored/trace.zip': 'x' }));
    expect(manifest(out).dirty).toBe(false);
  });

  it('a command that produced no report → 2 and no manifest', () => {
    const out = join(priv, 'vitest.json');
    expect(rec('vitest', out, nodeWriting({}))).toBe(2);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('a TRX directory: every .trx the run wrote is recorded', () => {
    const out = join(priv, 'trx');
    const code = rec('xunit', out, nodeWriting({ [join(out, 'a.trx')]: '<a/>', [join(out, 'b.trx')]: '<b/>' }));
    expect(code).toBe(0);
    const v = verifyProvenance({ kind: 'xunit', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: true });
    expect([...v.files.keys()].sort()).toEqual(['a.trx', 'b.trx']);
  });

  it('bad usage (empty command after "--", unknown kind) → 2, nothing runs', () => {
    const out = join(priv, 'x.json');
    expect(rec('vitest', out, nodeWriting({ [out]: '{}' }), ['--'])).toBe(2);
    expect(rec('jest' as Kind, out, nodeWriting({ [out]: '{}' }))).toBe(2);
    expect(spawned).toEqual([]);
  });
});

describe('runRecord: only the canonical full-suite command', () => {
  it('runs the canonical argv itself, at the checkout root, with CI=true and runner filter variables dropped', () => {
    mkdirSync(join(repo, 'sub'));
    const out = join(priv, 'vitest.json');
    process.env.VITEST_REAUDIT_PROBE = 'x';
    try {
      expect(rec('vitest', out, nodeWriting({ [out]: '{}' }), [], join(repo, 'sub'))).toBe(0);
    } finally {
      delete process.env.VITEST_REAUDIT_PROBE;
    }
    expect(spawned).toHaveLength(1);
    const [cmd, ...args] = canonicalArgv('vitest', out);
    expect(spawned[0]?.cmd).toBe(cmd);
    expect(spawned[0]?.args).toEqual(args);
    expect(spawned[0]?.cwd).toBe(git('rev-parse', '--show-toplevel'));
    expect(spawned[0]?.env.CI).toBe('true');
    expect(spawned[0]?.env.VITEST_REAUDIT_PROBE).toBeUndefined();
  });

  it('the manifest records the exact argv that ran', () => {
    const out = join(priv, 'trx');
    rec('xunit', out, nodeWriting({ [join(out, 'a.trx')]: '<a/>' }));
    expect(manifest(out, 'xunit').argv).toEqual(canonicalArgv('xunit', out));
  });

  it('Playwright gets its JSON output path through the environment', () => {
    const out = join(priv, 'pw.json');
    rec('playwright', out, nodeWriting({ [out]: '{}' }));
    expect(spawned[0]?.env.PLAYWRIGHT_JSON_OUTPUT_FILE).toBe(out);
    expect(manifest(out, 'playwright').argv).toEqual(canonicalArgv('playwright', out));
  });

  it('an explicit command equal to the canonical argv is accepted', () => {
    const out = join(priv, 'vitest.json');
    expect(rec('vitest', out, nodeWriting({ [out]: '{}' }), ['--', ...canonicalArgv('vitest', out)])).toBe(0);
    expect(spawned).toHaveLength(1);
  });

  it('a FILTERED command is refused before anything runs, for every kind (no manifest, no report)', () => {
    const vt = join(priv, 'vitest.json');
    const pw = join(priv, 'pw.json');
    const tx = join(priv, 'trx');
    const cases: [Kind, string, string[]][] = [
      ['vitest', vt, [...canonicalArgv('vitest', vt), 'tests/a.test.ts']],
      ['vitest', vt, [...canonicalArgv('vitest', vt), '-t', 'syn-a']],
      ['vitest', vt, [...canonicalArgv('vitest', vt), '--project', 'node']],
      ['vitest', vt, ['npx', 'vitest', 'run', 'tests/a.test.ts']],
      ['playwright', pw, [...canonicalArgv('playwright', pw), '--grep', '@finding:syn-a']],
      ['playwright', pw, [...canonicalArgv('playwright', pw), '--shard', '1/2']],
      ['xunit', tx, [...canonicalArgv('xunit', tx), '--filter', 'Category!=LiveNetwork']],
      ['vitest', vt, [process.execPath, '-e', '0']],
    ];
    for (const [kind, out, argv] of cases) {
      lines = [];
      expect(rec(kind, out, nodeWriting({ [out]: '{}' }), ['--', ...argv])).toBe(2);
      expect(lines.join('\n')).toMatch(/canonical/);
      expect(existsSync(manifestPathFor(out, kind))).toBe(false);
    }
    expect(spawned).toEqual([]);
  });
});
