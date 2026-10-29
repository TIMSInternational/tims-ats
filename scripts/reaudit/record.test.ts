import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRecord } from './record';
import { manifestPathFor, verifyProvenance } from './provenance';

// record.ts is the evidence-producing step: it wraps the real test command, so the SHA in the manifest is
// the SHA the tests ran at, not a SHA stamped on afterwards. These tests use a real git repository and
// spawn a real child process (node) as the "test run".

let repo: string;
let lines: string[];
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const io = () => ({ cwd: repo, log: (s: string) => lines.push(s), err: (s: string) => lines.push(s) });

/** A node one-liner that writes `files` (relative to the repo) and exits with `code`. */
function nodeWriting(files: Record<string, string>, code = 0, extra = ''): string[] {
  const body = Object.entries(files)
    .map(
      ([f, c]) =>
        `fs.mkdirSync(path.dirname(${JSON.stringify(f)}),{recursive:true});fs.writeFileSync(${JSON.stringify(f)},${JSON.stringify(c)});`,
    )
    .join('');
  return [process.execPath, '-e', `const fs=require('fs'),path=require('path');${body}${extra}process.exit(${code});`];
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-record-')));
  lines = [];
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('runRecord', () => {
  it('runs the command, propagates its exit status and records HEAD, the status and the report hash', () => {
    const out = join(repo, 'ignored', 'vitest.json');
    const code = runRecord(
      ['--kind', 'vitest', '--output', out, '--', ...nodeWriting({ 'ignored/vitest.json': '{}' }, 3)],
      io(),
    );
    expect(code).toBe(3);
    const m = JSON.parse(readFileSync(manifestPathFor(out, 'vitest'), 'utf8')) as Record<string, unknown>;
    expect(m.headSha).toBe(git('rev-parse', 'HEAD'));
    expect(m.exitCode).toBe(3);
    expect(m.dirty).toBe(false);
    expect(() =>
      verifyProvenance({ kind: 'vitest', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: true }),
    ).not.toThrow();
  });

  it('evidence recorded at an earlier commit is refused once HEAD moves on (the stale-report case)', () => {
    const out = join(repo, 'ignored', 'pw.json');
    expect(
      runRecord(['--kind', 'playwright', '--output', out, '--', ...nodeWriting({ 'ignored/pw.json': '{}' })], io()),
    ).toBe(0);
    git('commit', '-q', '--allow-empty', '-m', 'next');
    expect(() =>
      verifyProvenance({ kind: 'playwright', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: false }),
    ).toThrow(/not evidence of HEAD/);
  });

  it('an output that already exists is refused before the command runs (evidence must come from this run)', () => {
    const out = join(repo, 'ignored', 'vitest.json');
    runRecord(['--kind', 'vitest', '--output', out, '--', ...nodeWriting({ 'ignored/vitest.json': '{}' })], io());
    rmSync(manifestPathFor(out, 'vitest'));
    const marker = join(repo, 'ignored', 'ran');
    const code = runRecord(['--kind', 'vitest', '--output', out, '--', ...nodeWriting({ 'ignored/ran': 'x' })], io());
    expect(code).toBe(2);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('HEAD moving during the run → 2 and no manifest (the evidence is of no single commit)', () => {
    const out = join(repo, 'ignored', 'vitest.json');
    const cmd = nodeWriting(
      { 'ignored/vitest.json': '{}' },
      0,
      `require('child_process').execFileSync('git',['commit','-q','--allow-empty','-m','mid-run']);`,
    );
    expect(runRecord(['--kind', 'vitest', '--output', out, '--', ...cmd], io())).toBe(2);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('an untracked file present when the run starts is recorded as dirty', () => {
    writeFileSync(join(repo, 'extra.spec.ts'), 'x');
    const out = join(repo, 'ignored', 'vitest.json');
    runRecord(['--kind', 'vitest', '--output', out, '--', ...nodeWriting({ 'ignored/vitest.json': '{}' })], io());
    const m = JSON.parse(readFileSync(manifestPathFor(out, 'vitest'), 'utf8')) as Record<string, unknown>;
    expect(m.dirty).toBe(true);
    expect(m.dirtyPaths).toEqual(['extra.spec.ts']);
  });

  it('an untracked file the run creates (other than its own report) is recorded as dirty', () => {
    const out = join(repo, 'ignored', 'vitest.json');
    runRecord(
      ['--kind', 'vitest', '--output', out, '--', ...nodeWriting({ 'ignored/vitest.json': '{}', 'leak.ts': 'x' })],
      io(),
    );
    const m = JSON.parse(readFileSync(manifestPathFor(out, 'vitest'), 'utf8')) as Record<string, unknown>;
    expect(m.dirtyPaths).toEqual(['leak.ts']);
  });

  it("the run's own report inside the repo (not ignored) does not count as dirt", () => {
    const out = join(repo, 'test-results', 'results.json');
    runRecord(
      ['--kind', 'playwright', '--output', out, '--', ...nodeWriting({ 'test-results/results.json': '{}' })],
      io(),
    );
    const m = JSON.parse(readFileSync(manifestPathFor(out, 'playwright'), 'utf8')) as Record<string, unknown>;
    expect(m.dirty).toBe(false);
  });

  it('a command that produced no report → 2 and no manifest', () => {
    const out = join(repo, 'ignored', 'vitest.json');
    expect(runRecord(['--kind', 'vitest', '--output', out, '--', ...nodeWriting({})], io())).toBe(2);
    expect(existsSync(manifestPathFor(out, 'vitest'))).toBe(false);
  });

  it('a TRX directory: every .trx the run wrote is recorded', () => {
    const out = join(repo, 'ignored', 'trx');
    const code = runRecord(
      [
        '--kind',
        'xunit',
        '--output',
        out,
        '--',
        ...nodeWriting({ 'ignored/trx/a.trx': '<a/>', 'ignored/trx/b.trx': '<b/>' }),
      ],
      io(),
    );
    expect(code).toBe(0);
    const v = verifyProvenance({ kind: 'xunit', evidence: out, headSha: git('rev-parse', 'HEAD'), requireClean: true });
    expect([...v.files.keys()].sort()).toEqual(['a.trx', 'b.trx']);
  });

  it('bad usage (no command, unknown kind) → 2', () => {
    const out = join(repo, 'ignored', 'x.json');
    expect(runRecord(['--kind', 'vitest', '--output', out, '--'], io())).toBe(2);
    expect(runRecord(['--kind', 'jest', '--output', out, '--', process.execPath, '-e', '0'], io())).toBe(2);
  });
});
