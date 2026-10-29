/**
 * Repository-boundary guard for the re-audit harness.
 *
 * The harness reads private audit input and writes private reports. The repository is public, so
 * every one of those paths must live OUTSIDE it. This module is the single choke point: every
 * "refuse" branch elsewhere in scripts/reaudit routes through `assertOutsideRepo`.
 *
 * Containment is decided on REAL paths (symlinks resolved), not lexically, so a link that sits
 * outside the repo but points into it is still treated as inside. Paths that do not exist yet are
 * handled by resolving the deepest existing ancestor and re-appending the missing tail.
 *
 * "The repo" is every checkout of it, not only the one running the harness: from a linked worktree,
 * the main checkout and every sibling worktree are the same public repository. When `repoRoot` holds
 * a `.git`, the roots come from `git worktree list`; if git cannot list them, the guard fails closed.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class OutsideRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsideRepoError';
  }
}

/** Resolves symlinks on the longest existing prefix of `p`, keeping any not-yet-created tail. */
function realResolve(p: string): string {
  const abs = resolve(p);
  const tail: string[] = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    tail.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...tail);
}

function within(target: string, root: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  // A whole `..` segment, not a prefix: `<repo>/..private` is a directory INSIDE the repo.
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Every checkout of the repository at `repoRoot`: itself plus each worktree git knows about. */
export function checkoutRoots(repoRoot: string): string[] {
  const roots = [realResolve(repoRoot)];
  if (!existsSync(join(repoRoot, '.git'))) return roots;
  let listing: string;
  try {
    // -z: NUL-delimited, so a worktree path containing a newline is read whole, not truncated.
    listing = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new OutsideRepoError(`cannot list the worktrees of ${repoRoot}; refusing to guess which paths are public`);
  }
  for (const field of listing.split('\0')) {
    if (field.startsWith('worktree ')) roots.push(realResolve(field.slice('worktree '.length)));
  }
  return [...new Set(roots)];
}

export function isInsideRepo(p: string, repoRoot: string): boolean {
  const target = realResolve(p);
  return checkoutRoots(repoRoot).some((root) => within(target, root));
}

/**
 * Throws when `p` is relative or resolves inside `repoRoot`; otherwise returns the normalised
 * absolute path. `label` names the input in the error ("findings file", "output directory", ...).
 */
export function assertOutsideRepo(p: string, repoRoot: string, label: string): string {
  if (!isAbsolute(p)) {
    throw new OutsideRepoError(`${label} must be an absolute path (got a relative path: ${p})`);
  }
  if (isInsideRepo(p, repoRoot)) {
    throw new OutsideRepoError(`${label} is inside the repository (${p}); private paths must live outside it`);
  }
  return resolve(p);
}

/**
 * Writes `data` to the file `p`, which must be outside the repository. A pre-existing symlink at the
 * destination (live or dangling) is refused. The data goes to a fresh, exclusively created temporary
 * file in the same directory, which is then renamed over the destination: the destination's directory
 * entry is replaced, never written through, so neither a symlink nor a hard link at a predictable
 * report name can carry private content into a file inside the repository.
 */
export function writeFileOutsideRepo(p: string, data: string, repoRoot: string, label: string): void {
  const dest = assertOutsideRepo(p, repoRoot, label);
  if (lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new OutsideRepoError(`${label} is a symlink (${dest}); refusing to follow it`);
  }
  const tmp = join(dirname(dest), `.${basename(dest)}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
