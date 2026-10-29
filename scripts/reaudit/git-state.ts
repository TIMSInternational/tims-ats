/**
 * The checkout's git state, read with the real git binary.
 *
 * `dirtyPaths` lists every path `git status` reports: modified, staged, deleted, renamed AND untracked
 * files. Untracked files count because an untracked spec or imported module changes what a test run
 * executes. `.gitignore`d files do not count (`git status` already leaves them out). Paths are
 * repository-relative because status runs from the toplevel. Any git failure throws: a state that
 * cannot be read is never reported as clean.
 */
import { execFileSync } from 'node:child_process';

export interface GitState {
  repoRoot: string;
  headSha: string;
  /** Repository-relative paths that differ from HEAD, untracked included. Empty = clean. */
  dirtyPaths: string[];
}

/** A full object name: SHA-1 (40 hex) or SHA-256 (64 hex). */
export const FULL_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Parses `git status --porcelain=v1 -z`: "XY path\0", plus the source path as an extra entry for R/C. */
function parsePorcelainZ(raw: string): string[] {
  const entries = raw.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as string;
    if (e === '') continue;
    if (e.length < 4 || e[2] !== ' ') throw new Error(`unexpected git status entry: ${JSON.stringify(e)}`);
    paths.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++; // the rename/copy source follows as its own entry
  }
  return paths;
}

export function readGitState(cwd: string): GitState {
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const headSha = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (!FULL_SHA_RE.test(headSha)) throw new Error(`cannot read HEAD (got "${headSha}")`);
  const status = git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return { repoRoot, headSha, dirtyPaths: parsePorcelainZ(status) };
}
