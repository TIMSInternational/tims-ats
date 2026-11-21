#!/usr/bin/env -S npx tsx
/**
 * The evidence-producing step: runs the canonical full-suite test command and records which commit,
 * and which command, it ran at.
 *
 *   pnpm exec tsx scripts/reaudit/record.ts --kind <playwright|vitest|xunit> --output <path>
 *
 * record.ts runs the ONE canonical command for the kind (canonical.ts) from the checkout root; it takes
 * no test command of its own. An explicit `-- <argv>` is accepted only if it is exactly that canonical
 * argv; anything else (a file argument, -t, --grep, --project, --shard, --filter, ...) is refused before
 * anything runs, so a filtered or partial run never produces evidence. The child environment drops the
 * runners' own variables and sets CI=true (canonical.ts).
 *
 * Reports are private (test names, errors, diagnostics), so --output and its manifest must be OUTSIDE
 * every checkout of the repository (paths.ts: this checkout, the main one and every sibling worktree);
 * a relative --output resolves against the working directory.
 *
 * Before the command: reads HEAD and `git status` (untracked included), refuses an --output inside the
 * repository, and refuses an --output (or its manifest) that already exists, so the report can only
 * come from this run. After: refuses if HEAD moved or no report was written, then writes the manifest
 * (see provenance.ts) with the argv, the run's exit status, the SHA, and whether the checkout was dirty
 * at the start or became dirty during the run. Not detected: a change made AND reverted entirely within
 * the run (git status is read only before and after it). Exits with the command's own status, so `$?` is
 * the test run's status. Exit 2 when it cannot record (usage, a non-canonical command, git, spawn, HEAD
 * moved, no report): no manifest is written.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalArgv, canonicalEnv, type Env } from './canonical';
import { readGitState } from './git-state';
import { assertOutsideRepo } from './paths';
import { EVIDENCE_KINDS, manifestPathFor, writeProvenance, type EvidenceKind } from './provenance';

/** Runs a command to completion (the real one is spawnSync with inherited stdio). */
export type RecordSpawn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Env },
) => { status: number | null; signal: NodeJS.Signals | null; error?: Error };

export interface RecordIo {
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
  /** Tests replace the process; record.ts still chooses the argv, cwd and environment. */
  spawn?: RecordSpawn;
}

const spawnInherit: RecordSpawn = (cmd, args, opts) => {
  // Node's ProcessEnv type is augmented with required keys (NODE_ENV); the env is passed exactly as built.
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, stdio: 'inherit' });
  return { status: r.status, signal: r.signal, error: r.error };
};

class UsageError extends Error {}

function parse(argv: readonly string[]): { kind: EvidenceKind; output: string; command?: string[] } {
  const dash = argv.indexOf('--');
  const command = dash < 0 ? undefined : argv.slice(dash + 1);
  let kind: EvidenceKind | undefined;
  let output: string | undefined;
  const opts = dash < 0 ? argv : argv.slice(0, dash);
  for (let i = 0; i < opts.length; i += 2) {
    const [flag, value] = [opts[i], opts[i + 1]];
    if (value === undefined) throw new UsageError(`${flag} needs a value`);
    if (flag === '--kind') {
      if (!(EVIDENCE_KINDS as readonly string[]).includes(value)) {
        throw new UsageError(`--kind must be one of ${EVIDENCE_KINDS.join(', ')} (got "${value}")`);
      }
      kind = value as EvidenceKind;
    } else if (flag === '--output') output = value;
    else throw new UsageError(`unknown argument: ${flag}`);
  }
  if (!kind || !output) throw new UsageError('--kind and --output are required');
  return { kind, output, command };
}

export function runRecord(argv: readonly string[], io: RecordIo): number {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (e) {
    io.err(`record: ${(e as Error).message}`);
    return 2;
  }
  const output = resolve(io.cwd, args.output);
  const manifest = manifestPathFor(output, args.kind);
  const canonical = canonicalArgv(args.kind, output);
  if (args.command && JSON.stringify(args.command) !== JSON.stringify(canonical)) {
    io.err(
      `record: only the canonical full-suite ${args.kind} command is evidence; refusing ${JSON.stringify(args.command)}. ` +
        `Omit the command, or pass exactly: ${canonical.join(' ')}`,
    );
    return 2;
  }
  try {
    const before = readGitState(io.cwd);
    assertOutsideRepo(output, before.repoRoot, 'record --output');
    assertOutsideRepo(manifest, before.repoRoot, 'record manifest');
    // lstat, not existsSync: a dangling symlink "does not exist" but a write through it lands elsewhere.
    if ([output, manifest].some((p) => lstatSync(p, { throwIfNoEntry: false }) !== undefined)) {
      io.err(`record: ${output} already exists; remove it so the report can only come from this run`);
      return 2;
    }
    const [cmd, ...rest] = canonical as [string, ...string[]];
    io.log(`record: running ${canonical.join(' ')} in ${before.repoRoot}`);
    const child = (io.spawn ?? spawnInherit)(cmd, rest, {
      cwd: before.repoRoot,
      env: canonicalEnv(args.kind, output, process.env),
    });
    if (child.error) {
      io.err(`record: could not run ${cmd}: ${child.error.message}`);
      return 2;
    }
    const signal = child.signal ? (constants.signals as Record<string, number>)[child.signal] : undefined;
    const exitCode = child.status ?? (signal !== undefined ? 128 + signal : 1);
    const after = readGitState(io.cwd);
    if (after.headSha !== before.headSha) {
      io.err(`record: HEAD moved during the run (${before.headSha} -> ${after.headSha}); nothing recorded`);
      return 2;
    }
    if (!existsSync(output)) {
      io.err(`record: the command wrote no report at ${output}; nothing recorded`);
      return 2;
    }
    const dirtyPaths = [...new Set([...before.dirtyPaths, ...after.dirtyPaths])].sort();
    writeProvenance({
      kind: args.kind,
      output,
      headSha: before.headSha,
      dirtyPaths,
      exitCode,
      checkoutRoot: before.repoRoot,
      argv: canonical,
    });
    io.log(
      `record: ${args.kind} evidence at ${before.headSha}${dirtyPaths.length ? ' (DIRTY checkout)' : ''}, exit ${exitCode}`,
    );
    return exitCode;
  } catch (e) {
    io.err(`record: ${(e as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runRecord(process.argv.slice(2), {
    cwd: process.cwd(),
    log: (s) => console.error(s),
    err: (s) => console.error(s),
  });
}
