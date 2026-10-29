import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOutsideRepo, isInsideRepo, OutsideRepoError } from './paths';

// The re-audit harness reads private audit input and writes private reports. Every one of those
// paths must live OUTSIDE the (public) repository. This guard is the single choke point; every
// "refuse" branch in the harness routes through it, so its failure paths are tested here directly.

let root: string;
let repo: string;
let outside: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-paths-')));
  repo = join(root, 'repo');
  outside = join(root, 'private');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isInsideRepo', () => {
  it('the repo root itself is inside', () => {
    expect(isInsideRepo(repo, repo)).toBe(true);
  });

  it('a nested file is inside, even when it does not exist yet', () => {
    expect(isInsideRepo(join(repo, 'scripts', 'not-yet', 'out.json'), repo)).toBe(true);
  });

  it('a dot-dot path that normalises back into the repo is inside', () => {
    expect(isInsideRepo(join(outside, '..', 'repo', 'x.json'), repo)).toBe(true);
  });

  it('a sibling directory that merely shares the prefix is NOT inside', () => {
    const sibling = join(root, 'repo-private');
    mkdirSync(sibling);
    expect(isInsideRepo(join(sibling, 'x.json'), repo)).toBe(false);
  });

  it('a symlink outside the repo that points into it is inside (resolved, not lexical)', () => {
    const link = join(outside, 'sneaky');
    symlinkSync(join(repo, 'scripts'), link);
    expect(isInsideRepo(join(link, 'report.json'), repo)).toBe(true);
  });

  it('a directory INSIDE the repo whose name starts with ".." is inside (not a parent traversal)', () => {
    expect(isInsideRepo(join(repo, '..private', 'findings.json'), repo)).toBe(true);
    expect(() => assertOutsideRepo(join(repo, '..private'), repo, 'output directory')).toThrow(OutsideRepoError);
  });

  it('a plain path outside is not inside', () => {
    expect(isInsideRepo(join(outside, 'findings.json'), repo)).toBe(false);
  });
});

describe('isInsideRepo — git worktrees', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let main: string;
  let wt: string;
  let sib: string;

  beforeEach(() => {
    main = join(root, 'main');
    wt = join(root, 'wt');
    sib = join(root, 'sib');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', wt);
    git(main, 'worktree', 'add', '-q', sib);
  });

  it('from a worktree, a path inside the MAIN checkout is inside (it is the same public repo)', () => {
    expect(isInsideRepo(join(main, 'private-audit-output'), wt)).toBe(true);
    expect(() => assertOutsideRepo(join(main, 'private-audit-output'), wt, 'REAUDIT_OUT_DIR')).toThrow(
      OutsideRepoError,
    );
  });

  it('from a worktree, a path inside a SIBLING worktree is inside', () => {
    expect(isInsideRepo(join(sib, 'out.json'), wt)).toBe(true);
  });

  it('from the main checkout, a path inside a linked worktree is inside', () => {
    expect(isInsideRepo(join(wt, 'out.json'), main)).toBe(true);
  });

  it('a path outside every checkout is still outside', () => {
    expect(isInsideRepo(join(outside, 'out.json'), wt)).toBe(false);
  });

  it('a .git that git cannot read fails closed instead of guarding only the one root', () => {
    writeFileSync(join(repo, '.git'), 'gitdir: /nonexistent/reaudit-broken\n');
    expect(() => isInsideRepo(join(outside, 'out.json'), repo)).toThrow(OutsideRepoError);
  });
});

describe('assertOutsideRepo', () => {
  it('throws OutsideRepoError naming the path when the path is inside the repo', () => {
    const p = join(repo, 'findings.json');
    expect(() => assertOutsideRepo(p, repo, 'findings file')).toThrow(OutsideRepoError);
    expect(() => assertOutsideRepo(p, repo, 'findings file')).toThrow(/findings file/);
    expect(() => assertOutsideRepo(p, repo, 'findings file')).toThrow(/inside the repository/i);
  });

  it('returns the resolved absolute path when outside', () => {
    expect(assertOutsideRepo(`${outside}/a/../b.json`, repo, 'x')).toBe(join(outside, 'b.json'));
  });

  it('refuses a relative path rather than guessing a base directory', () => {
    expect(() => assertOutsideRepo('findings.json', repo, 'findings file')).toThrow(/absolute/i);
  });
});
