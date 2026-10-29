import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
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

  it('a plain path outside is not inside', () => {
    expect(isInsideRepo(join(outside, 'findings.json'), repo)).toBe(false);
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
