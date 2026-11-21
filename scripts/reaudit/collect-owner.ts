/**
 * Runs owner checks: read-only scripts kept OUTSIDE the repository at `<checksDir>/<id>.sh`.
 *
 * Exit codes mirror scripts/verification/codex-review.sh: 0 = fixed, 1 = open, 2 = NOT RUN.
 * Fail closed, like that wrapper: a bare exit 0 is not trusted. The script must ALSO print a line
 * that is exactly `RESULT: FIXED`, otherwise the id is NOT-RUN. Anything unexpected (missing
 * directory or script, a non-slug id, another exit code, a signal) is NOT-RUN and is never a pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SLUG_RE, type Observation, type ObservedStatus } from './status';

export interface OwnerCheckResult {
  exitCode: number | null;
  stdout: string;
}

export type OwnerCheckRunner = (scriptPath: string) => OwnerCheckResult;

const TIMEOUT_MS = 5 * 60_000;

export const defaultOwnerCheckRunner: OwnerCheckRunner = (scriptPath) => {
  const r = spawnSync('bash', [scriptPath], { encoding: 'utf8', timeout: TIMEOUT_MS });
  return { exitCode: r.error ? null : r.status, stdout: r.stdout ?? '' };
};

function statusFor(result: OwnerCheckResult): ObservedStatus {
  if (result.exitCode === 0) {
    const fixedLine = result.stdout.split(/\r?\n/).some((l) => l.trim() === 'RESULT: FIXED');
    return fixedLine ? 'FIXED-VERIFIED' : 'NOT-RUN';
  }
  if (result.exitCode === 1) return 'OPEN-CONFIRMED';
  return 'NOT-RUN';
}

export interface RunOwnerChecksOptions {
  enabled: boolean;
  checksDir: string;
  ids: readonly string[];
  run?: OwnerCheckRunner;
}

export function runOwnerChecks(opts: RunOwnerChecksOptions): Observation[] {
  if (!opts.enabled) return [];
  const run = opts.run ?? defaultOwnerCheckRunner;
  const dirExists = existsSync(opts.checksDir);
  return opts.ids.map((id): Observation => {
    const notRun = (why: string): Observation => ({
      id,
      status: 'NOT-RUN',
      source: 'owner',
      test: `owner check (${why})`,
    });
    if (!SLUG_RE.test(id)) return notRun('id is not a slug');
    if (!dirExists) return notRun('checks directory missing');
    const script = join(opts.checksDir, `${id}.sh`);
    if (!existsSync(script)) return notRun('script missing');
    return { id, status: statusFor(run(script)), source: 'owner', test: `owner check ${id}.sh` };
  });
}
