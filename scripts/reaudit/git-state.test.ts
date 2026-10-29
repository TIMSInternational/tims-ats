import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGitState } from './git-state';

// These tests run the REAL git binary in a throwaway repository: the dirty-tree rule is only as good
// as the git invocation behind it, so it is not tested through an injected boolean.

let repo: string;
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-git-')));
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n*.log\n');
  writeFileSync(join(repo, 'tracked.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('readGitState (real git)', () => {
  it('reports HEAD and the toplevel of a clean tree with no dirty paths', () => {
    const s = readGitState(repo);
    expect(s.headSha).toBe(git('rev-parse', 'HEAD'));
    expect(s.repoRoot).toBe(repo);
    expect(s.dirtyPaths).toEqual([]);
  });

  it('an untracked file makes the tree dirty (it can change what a test run executes)', () => {
    mkdirSync(join(repo, 'e2e'), { recursive: true });
    writeFileSync(join(repo, 'e2e', 'extra.spec.ts'), 'test');
    expect(readGitState(repo).dirtyPaths).toEqual(['e2e/extra.spec.ts']);
  });

  it('a gitignored file does not make the tree dirty', () => {
    mkdirSync(join(repo, 'ignored'), { recursive: true });
    writeFileSync(join(repo, 'ignored', 'x.json'), '{}');
    writeFileSync(join(repo, 'run.log'), 'x');
    expect(readGitState(repo).dirtyPaths).toEqual([]);
  });

  it('a modified tracked file makes the tree dirty', () => {
    writeFileSync(join(repo, 'tracked.ts'), 'export const a = 2;\n');
    expect(readGitState(repo).dirtyPaths).toEqual(['tracked.ts']);
  });

  it('a staged-only change makes the tree dirty', () => {
    writeFileSync(join(repo, 'new.ts'), 'x');
    git('add', 'new.ts');
    expect(readGitState(repo).dirtyPaths).toEqual(['new.ts']);
  });

  it('reads the same state from a subdirectory (paths stay repository-relative)', () => {
    mkdirSync(join(repo, 'sub'), { recursive: true });
    writeFileSync(join(repo, 'sub', 'u.ts'), 'x');
    const s = readGitState(join(repo, 'sub'));
    expect(s.repoRoot).toBe(repo);
    expect(s.dirtyPaths).toEqual(['sub/u.ts']);
  });

  it('outside any repository → throws (never "clean")', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-nogit-')));
    try {
      expect(() => readGitState(outside)).toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
