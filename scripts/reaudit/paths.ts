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
 */
import { closeSync, constants, existsSync, openSync, realpathSync, writeSync } from 'node:fs';
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

export function isInsideRepo(p: string, repoRoot: string): boolean {
  const target = realResolve(p);
  const root = realResolve(repoRoot);
  const rel = relative(root, target);
  if (rel === '') return true;
  // A whole `..` segment, not a prefix: `<repo>/..private` is a directory INSIDE the repo.
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
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
 * Writes `data` to the file `p`, which must be outside the repository. The final path component is
 * opened with O_NOFOLLOW, so a pre-existing symlink at the destination (live or dangling) is refused
 * instead of followed: a predictable report name in the output directory cannot be pointed back
 * into the repository.
 */
export function writeFileOutsideRepo(p: string, data: string, repoRoot: string, label: string): void {
  const dest = assertOutsideRepo(p, repoRoot, label);
  let fd: number;
  try {
    fd = openSync(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') {
      throw new OutsideRepoError(`${label} is a symlink (${dest}); refusing to follow it`);
    }
    throw e;
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}
