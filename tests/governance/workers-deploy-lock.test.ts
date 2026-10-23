import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── The two paths that roll the workers service must be serialised ─────────────
//
// deploy-platform-workers.yml decides, builds for minutes, then rolls; the owner's
// create-workers-service.sh --apply rolls too. GitHub `concurrency:` serialises only
// workflow runs, so an automatic run that decided on commit B could, after its build,
// overwrite a newer commit C the owner rolled meanwhile (tier-1 review). Both paths now
// hold one lock (scripts/deploy/workers-deploy-lock.sh, an SSM parameter created
// without --overwrite), and the roll step refuses a live revision that moved anyway.

const ROOT = resolve(__dirname, '../..');
const LOCK = resolve(ROOT, 'scripts/deploy/workers-deploy-lock.sh');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-platform-workers.yml'), 'utf8');
const OWNER = readFileSync(resolve(ROOT, 'scripts/deploy/create-workers-service.sh'), 'utf8');

let dir: string;
let param: string;

beforeEach(() => {
  // A fake `aws` holding one SSM parameter in a file: put-parameter without --overwrite fails while it exists.
  dir = mkdtempSync(join(tmpdir(), 'fake-ssm-'));
  param = join(dir, 'param');
  writeFileSync(
    join(dir, 'aws'),
    [
      '#!/usr/bin/env bash',
      'if [ -n "${FAKE_AWS_ERROR:-}" ]; then echo "$FAKE_AWS_ERROR" >&2; exit 254; fi',
      'value=""; prev=""',
      'for a in "$@"; do [ "$prev" = "--value" ] && value="$a"; prev="$a"; done',
      'case "$2" in',
      '  put-parameter)',
      '    if [ -e "$FAKE_PARAM" ]; then echo "An error occurred (ParameterAlreadyExists) when calling the PutParameter operation" >&2; exit 254; fi',
      '    printf "%s" "$value" > "$FAKE_PARAM" ;;',
      '  get-parameter)',
      '    if [ ! -e "$FAKE_PARAM" ]; then echo "An error occurred (ParameterNotFound) when calling the GetParameter operation" >&2; exit 254; fi',
      '    cat "$FAKE_PARAM"; echo ;;',
      '  delete-parameter) rm -f "$FAKE_PARAM" ;;',
      '  *) echo "unexpected: $*" >&2; exit 99 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'aws'), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function lock(cmd: string, holder: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [LOCK, cmd, holder], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_PARAM: param,
      LOCK_WAIT_SECONDS: '1',
      LOCK_INTERVAL_SECONDS: '1',
      ...env,
    },
  });
}

/** One step of the workflow's `steps:` list: its raw text. */
function steps(src: string): string[] {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  const blocks: string[][] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {6}- /.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1]!.push(l);
  }
  return blocks.map((b) => b.join('\n'));
}

describe('workers deploy lock', () => {
  it('one holder takes it; a second waits, then fails loud and says how to clear a stale lock', () => {
    expect(lock('acquire', 'gha-1-1').status).toBe(0);
    expect(readFileSync(param, 'utf8')).toMatch(/^gha-1-1 \d{4}-\d{2}-\d{2}T/);

    const second = lock('acquire', 'owner-fede-42');
    expect(second.status).toBe(1);
    // Who holds it is named whether the deadline passes before or after the first wait.
    expect(second.stdout + second.stderr).toContain("held by 'gha-1-1");
    expect(second.stderr).toContain('aws ssm delete-parameter');
    expect(readFileSync(param, 'utf8')).toMatch(/^gha-1-1 /);
  });

  it('only the holder releases it, and the next holder can then take it', () => {
    lock('acquire', 'gha-1-1');
    expect(lock('release', 'owner-fede-42').status).toBe(0);
    expect(existsSync(param), 'a non-holder must not release').toBe(true);
    expect(lock('release', 'gha-1-1').status).toBe(0);
    expect(existsSync(param)).toBe(false);
    expect(lock('acquire', 'owner-fede-42').status).toBe(0);
  });

  it('releasing a lock that is not held is a no-op', () => {
    expect(lock('release', 'gha-1-1').status).toBe(0);
  });

  it('any error other than "already held" fails closed instead of deploying unlocked', () => {
    const r = lock('acquire', 'gha-1-1', {
      FAKE_AWS_ERROR: 'An error occurred (AccessDeniedException) when calling the PutParameter operation',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing to deploy');
  });

  it('rejects a malformed holder or command', () => {
    expect(lock('acquire', 'has space').status).toBe(2);
    expect(lock('steal', 'gha-1-1').status).toBe(2);
  });

  it('the workflow holds the lock from before the decision until after the roll, and always releases it', () => {
    const all = steps(WORKFLOW);
    const at = (name: string) => all.findIndex((s) => s.includes(`- name: ${name}`));
    const take = at('Take the workers deploy lock');
    const decide = at('Decide whether to push and roll');
    const roll = at('Roll the service onto the new image');
    const release = at('Release the workers deploy lock');
    expect(take).toBeGreaterThan(-1);
    expect(take).toBeLessThan(decide);
    expect(roll).toBeLessThan(release);
    expect(all[take]).toContain('workers-deploy-lock.sh acquire');
    expect(all[release]).toContain('workers-deploy-lock.sh release');
    expect(all[release]).toMatch(/if: always\(\)/);
  });

  it('the roll refuses to overwrite a live revision registered after the decision', () => {
    const roll = steps(WORKFLOW).find((s) => s.includes('- name: Roll the service onto the new image'))!;
    expect(steps(WORKFLOW).find((s) => s.includes('- name: Decide whether to push and roll'))).toContain('decided_td=');
    expect(roll).toContain('DECIDED_TD: ${{ steps.decide.outputs.decided_td }}');
    const guard = roll.indexOf('if [ "$CURRENT_TD" != "$DECIDED_TD" ]');
    expect(guard).toBeGreaterThan(-1);
    expect(guard, 'the guard runs before the new revision is registered').toBeLessThan(
      roll.indexOf('register-task-definition'),
    );
  });

  it('the owner script takes the same lock before any change and releases it on exit', () => {
    const take = OWNER.indexOf('lock acquire');
    expect(take).toBeGreaterThan(-1);
    expect(OWNER).toContain('workers-deploy-lock.sh');
    expect(OWNER).toMatch(/trap 'lock release/);
    for (const mutation of ['# ── Kill switch', 'mutate ecr put-lifecycle-policy', 'register-task-definition']) {
      expect(take, `lock before ${mutation}`).toBeLessThan(OWNER.indexOf(mutation));
    }
  });
});
