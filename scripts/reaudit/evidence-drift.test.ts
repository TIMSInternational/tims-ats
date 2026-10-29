import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseEvidenceRef, evidenceDrift, isSuspiciousFix } from './evidence-drift';

// evidence-drift answers "did anything at the cited location change since the audit base?" for
// each `path:line[-line]` evidence entry, against a throwaway git repo built here.

describe('parseEvidenceRef', () => {
  it('parses a path with a line range', () => {
    expect(parseEvidenceRef('apps/web/a.tsx:10-20')).toEqual({ path: 'apps/web/a.tsx', start: 10, end: 20 });
  });

  it('parses a single line', () => {
    expect(parseEvidenceRef('a.tsx:78')).toEqual({ path: 'a.tsx', start: 78, end: 78 });
  });

  it('parses the leading ref and ignores trailing prose and extra line lists', () => {
    expect(parseEvidenceRef('apps/web/app/api/x/route.ts:14-20,61 (prose follows)')).toEqual({
      path: 'apps/web/app/api/x/route.ts',
      start: 14,
      end: 20,
    });
  });

  it('keeps Next.js bracket segments in the path', () => {
    expect(parseEvidenceRef('apps/web/app/api/trpc/[trpc]/route.ts:136-160')?.path).toBe(
      'apps/web/app/api/trpc/[trpc]/route.ts',
    );
  });

  it('prose evidence (no path:line) → null', () => {
    expect(parseEvidenceRef('Observed in the live walk on the test tenant')).toBeNull();
    expect(parseEvidenceRef('count = {a:1, b:2}')).toBeNull();
  });

  it('a reversed range is rejected (null), not silently swapped', () => {
    expect(parseEvidenceRef('a.tsx:20-10')).toBeNull();
  });
});

describe('evidenceDrift (temp git repo)', () => {
  let repo: string;
  let base: string;

  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd: repo,
        encoding: 'utf8',
      },
    ).trim();

  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  };

  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-drift-')));
    git('init', '-q');
    write('apps/web/app/page.tsx', 'one\n');
    write('docs/keep.md', 'keep\n');
    write('apps/web/gone.tsx', 'gone\n');
    write('packages/api/a/route.ts', 'a\n');
    write('apps/web/b/route.ts', 'b\n');
    write('lib/barfoo.ts', 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    base = git('rev-parse', 'HEAD');
    write('apps/web/app/page.tsx', 'two\n');
    git('rm', '-q', 'apps/web/gone.tsx');
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const stateOf = (entry: string) => evidenceDrift({ repoRoot: repo, base, evidence: [entry] })[0]?.state;

  it('a file changed after base → touched', () => {
    expect(stateOf('apps/web/app/page.tsx:10-20 note')).toBe('touched');
  });

  it('a file not changed since base → unchanged', () => {
    expect(stateOf('docs/keep.md:3')).toBe('unchanged');
  });

  it('a file deleted since base → missing', () => {
    expect(stateOf('apps/web/gone.tsx:5')).toBe('missing');
  });

  it('a suffix matching two tracked files → ambiguous (never "first match")', () => {
    expect(stateOf('route.ts:14-20')).toBe('ambiguous');
  });

  it('a suffix matching exactly one tracked file resolves to it', () => {
    const [d] = evidenceDrift({ repoRoot: repo, base, evidence: ['a/route.ts:1'] });
    expect(d?.resolved).toBe('packages/api/a/route.ts');
    expect(d?.state).toBe('unchanged');
  });

  it('suffix matching respects path-segment boundaries (foo.ts does not match barfoo.ts)', () => {
    expect(stateOf('foo.ts:1')).toBe('missing');
  });

  it('prose evidence is ignored (produces no entry)', () => {
    expect(evidenceDrift({ repoRoot: repo, base, evidence: ['plain prose, no path'] })).toEqual([]);
  });

  it('an unknown base revision throws instead of reporting everything unchanged', () => {
    expect(() => evidenceDrift({ repoRoot: repo, base: 'deadbeefdeadbeef', evidence: ['docs/keep.md:1'] })).toThrow();
  });
});

describe('isSuspiciousFix', () => {
  const d = (state: 'unchanged' | 'touched' | 'missing' | 'ambiguous') => ({
    entry: 'x',
    path: 'x',
    state,
  });

  it('flags a FIXED-VERIFIED finding whose evidence files are ALL unchanged', () => {
    expect(isSuspiciousFix('FIXED-VERIFIED', [d('unchanged'), d('unchanged')])).toBe(true);
  });

  it('does not flag when any evidence file was touched', () => {
    expect(isSuspiciousFix('FIXED-VERIFIED', [d('unchanged'), d('touched')])).toBe(false);
  });

  it('does not flag an open finding', () => {
    expect(isSuspiciousFix('OPEN-CONFIRMED', [d('unchanged')])).toBe(false);
  });

  it('does not flag when there is no path evidence at all', () => {
    expect(isSuspiciousFix('FIXED-VERIFIED', [])).toBe(false);
  });
});
