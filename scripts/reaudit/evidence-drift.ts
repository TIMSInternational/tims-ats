/**
 * Evidence drift: for each `path:line[-line]` evidence entry, did the cited file change since the
 * audit base revision?
 *
 *   unchanged  resolved file is tracked and not in `git diff --name-only <base>..HEAD`
 *   touched    resolved file changed since base
 *   missing    no tracked file matches (deleted, renamed, or never existed)
 *   ambiguous  the cited suffix matches more than one tracked file (never "first match")
 *
 * Paths resolve exactly first, else by a UNIQUE suffix match on whole path segments.
 */
import { execFileSync } from 'node:child_process';
import type { ReauditStatus } from './status';

export interface EvidenceRef {
  path: string;
  start: number;
  end: number;
}

export type DriftState = 'unchanged' | 'touched' | 'missing' | 'ambiguous';

export interface EvidenceDrift {
  entry: string;
  path: string;
  resolved?: string;
  state: DriftState;
}

// A leading repo-relative file path (with an extension) followed by :line or :start-end.
const REF_RE = /^([A-Za-z0-9_.@[\]()+-]+(?:\/[A-Za-z0-9_.@[\]()+-]+)*\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?(?![\d-])/;

export function parseEvidenceRef(entry: string): EvidenceRef | null {
  const m = REF_RE.exec(entry.trim());
  if (!m) return null;
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  if (start < 1 || end < start) return null;
  return { path: m[1] as string, start, end };
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function lines(s: string): string[] {
  return s.split('\n').filter((l) => l.length > 0);
}

export interface EvidenceDriftOptions {
  repoRoot: string;
  base: string;
  evidence: readonly string[];
}

export function evidenceDrift(opts: EvidenceDriftOptions): EvidenceDrift[] {
  // Throws on an unknown base revision rather than reporting everything as unchanged.
  git(opts.repoRoot, ['rev-parse', '--verify', '--quiet', `${opts.base}^{commit}`]);
  const tracked = lines(git(opts.repoRoot, ['ls-files']));
  const trackedSet = new Set(tracked);
  const changed = new Set(lines(git(opts.repoRoot, ['diff', '--name-only', `${opts.base}..HEAD`])));

  const out: EvidenceDrift[] = [];
  for (const entry of opts.evidence) {
    const ref = parseEvidenceRef(entry);
    if (!ref) continue;
    let candidates: string[];
    if (trackedSet.has(ref.path)) candidates = [ref.path];
    else candidates = tracked.filter((t) => t.endsWith(`/${ref.path}`));
    if (candidates.length === 0) out.push({ entry, path: ref.path, state: 'missing' });
    else if (candidates.length > 1) out.push({ entry, path: ref.path, state: 'ambiguous' });
    else {
      const resolved = candidates[0] as string;
      out.push({ entry, path: ref.path, resolved, state: changed.has(resolved) ? 'touched' : 'unchanged' });
    }
  }
  return out;
}

/** A finding reported fixed whose cited evidence files are ALL unchanged deserves a second look. */
export function isSuspiciousFix(status: ReauditStatus, drift: readonly Pick<EvidenceDrift, 'state'>[]): boolean {
  if (status !== 'FIXED-VERIFIED' || drift.length === 0) return false;
  return drift.every((d) => d.state === 'unchanged');
}
