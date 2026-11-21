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
// hold one lock (scripts/deploy/workers-deploy-lock.sh: a conditional PutItem on one
// expiring DynamoDB item), and the roll step refuses a live revision that moved anyway.

const ROOT = resolve(__dirname, '../..');
const LOCK = resolve(ROOT, 'scripts/deploy/workers-deploy-lock.sh');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-platform-workers.yml'), 'utf8');
const OWNER = readFileSync(resolve(ROOT, 'scripts/deploy/create-workers-service.sh'), 'utf8');

let dir: string;
let state: string;

beforeEach(() => {
  // A fake `aws dynamodb` holding the one lock item in a file ("<holder> <since>"), with the same
  // conditions DynamoDB enforces for the calls the script makes.
  dir = mkdtempSync(join(tmpdir(), 'fake-ddb-'));
  state = join(dir, 'lock');
  writeFileSync(
    join(dir, 'aws'),
    [
      '#!/usr/bin/env bash',
      'if [ -n "${FAKE_AWS_ERROR:-}" ]; then echo "$FAKE_AWS_ERROR" >&2; exit 254; fi',
      'item=""; values=""; cond=""; prev=""',
      'for a in "$@"; do [ "$prev" = "--item" ] && item="$a"; [ "$prev" = "--expression-attribute-values" ] && values="$a"; [ "$prev" = "--condition-expression" ] && cond="$a"; prev="$a"; done',
      // Each clause is enforced only if the script SENT it, so dropping a clause from the script is caught.
      'has() { [[ "$cond" == *"$1"* ]]; }',
      'exists() { [ -e "$FAKE_LOCK" ]; }',
      'mine() { [ "$(cut -d" " -f1 "$FAKE_LOCK")" = "$(field "$values" :me)" ]; }',
      'live() { [ "$(cut -d" " -f2 "$FAKE_LOCK")" -ge "$(field "$values" :now)" ]; }',
      // field '<json>' <name>: the S or N value of one attribute.
      `field() { python3 -c 'import json, sys; print(list(json.loads(sys.argv[1])[sys.argv[2]].values())[0])' "$1" "$2"; }`,
      'ccf() { echo "An error occurred (ConditionalCheckFailedException) when calling the $1 operation" >&2; exit 254; }',
      'case "$2" in',
      '  put-item)',
      '    if has "attribute_not_exists(pk)" && exists && ! { has "expiresAt < :now" && ! live; }; then ccf PutItem; fi',
      '    echo "$(field "$item" holder) $(field "$item" since)" > "$FAKE_LOCK" ;;',
      '  get-item) if [ -e "$FAKE_LOCK" ]; then tr " " "\\t" < "$FAKE_LOCK"; else echo "None	None"; fi ;;',
      '  update-item)',
      '    if { has "holder = :me" && ! { exists && mine; }; } || { has "expiresAt >= :now" && ! { exists && live; }; }; then ccf UpdateItem; fi',
      '    echo "$(field "$values" :me) $(field "$values" :exp)" > "$FAKE_LOCK" ;;',
      '  delete-item)',
      '    if has "holder = :me" && ! { exists && mine; }; then ccf DeleteItem; fi',
      '    rm -f "$FAKE_LOCK" ;;',
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
      NODE_ENV: 'test',
      FAKE_LOCK: state,
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
    const [holder, since] = readFileSync(state, 'utf8').trim().split(' ');
    expect(holder).toBe('gha-1-1');
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const second = lock('acquire', 'owner-fede-42');
    expect(second.status).toBe(1);
    // Who holds it is named whether the deadline passes before or after the first wait.
    expect(second.stdout + second.stderr).toContain("held by 'gha-1-1");
    expect(second.stderr).toContain('aws dynamodb delete-item');
    expect(readFileSync(state, 'utf8')).toMatch(/^gha-1-1 /);
  });

  it('only the holder releases it, and the next holder can then take it', () => {
    lock('acquire', 'gha-1-1');
    expect(lock('release', 'owner-fede-42').status).toBe(0);
    expect(existsSync(state), 'a non-holder must not release').toBe(true);
    expect(lock('release', 'gha-1-1').status).toBe(0);
    expect(existsSync(state)).toBe(false);
    // Re-taken immediately after a release (an SSM parameter could not be re-created for ~30 s).
    expect(lock('acquire', 'owner-fede-42').status).toBe(0);
  });

  it('never expires: a stalled holder keeps it however long it sleeps, so nobody can write after it', () => {
    // Tier-1 review: an expiring lease let a holder paused after its last check write after a takeover.
    expect(lock('acquire', 'owner-fede-42').status).toBe(0);
    spawnSync('sleep', ['2']);
    const other = lock('acquire', 'gha-7-1');
    expect(other.status).toBe(1);
    expect(other.stderr).toContain('never expires');
    expect(readFileSync(state, 'utf8')).toMatch(/^owner-fede-42 /);
    // No expiry attribute is ever written, and there is no lease to renew.
    const script = readFileSync(LOCK, 'utf8');
    expect(script).not.toContain('\\"expiresAt\\"');
    expect(script).not.toMatch(/^\s+renew\)/m);
  });

  it('releasing a lock that is not held is a no-op', () => {
    expect(lock('release', 'gha-1-1').status).toBe(0);
  });

  it('any error other than "already held" fails closed instead of deploying unlocked', () => {
    const r = lock('acquire', 'gha-1-1', {
      FAKE_AWS_ERROR: 'An error occurred (AccessDeniedException) when calling the PutItem operation',
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

  it('a roll never rewrites an existing execution policy', () => {
    // Tier-1 review: replacing, merging or unioning the live policy either stripped an owner's grant or
    // loosened an owner's condition; and a stale run could overwrite newer IAM before its lease check.
    const read = OWNER.indexOf('iam get-role-policy --role-name "$EXECUTION_ROLE"');
    const skip = OWNER.indexOf('if [[ "$EXEC_POLICY_EXISTS" -eq 1 && "$RECONCILE_IAM" -eq 0 ]]; then');
    const put = OWNER.indexOf('mutate iam put-role-policy --role-name "$EXECUTION_ROLE"');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(skip);
    expect(skip).toBeLessThan(put);
    expect(OWNER).toContain('refusing to write it blind');
    expect(OWNER).toMatch(/--reconcile-iam\) RECONCILE_IAM=1/);
  });

  it('the owner script takes the same lock before any change and releases it on exit', () => {
    const take = OWNER.indexOf('lock acquire');
    expect(take).toBeGreaterThan(-1);
    expect(OWNER).toContain('workers-deploy-lock.sh');
    expect(OWNER).toMatch(/trap 'lock release/);
    for (const mutation of ['# ── Kill switch', 'mutate ecr put-lifecycle-policy', 'register-task-definition']) {
      expect(take, `lock before ${mutation}`).toBeLessThan(OWNER.indexOf(mutation));
    }
    // Second guard: the live revision is re-checked right before the roll.
    const roll = OWNER.indexOf('mutate ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition');
    const guard = OWNER.indexOf('[[ "$NOW_TD" == "$LIVE_TD" ]]');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(roll);
  });
});
