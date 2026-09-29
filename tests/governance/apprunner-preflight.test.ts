import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Behaviour of the last check both deploy and rollback run immediately before update-service.
// Deploy and rollback use SEPARATE concurrency groups (a shared group lets a queued deploy replace a
// pending rollback), so this script is what keeps them from overwriting each other.

const SCRIPT = resolve(__dirname, '../../scripts/deploy/apprunner-preflight.sh');
const ARN = 'arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5';
const IMG = '747814092517.dkr.ecr.us-west-2.amazonaws.com/tims-platform-api:a23dbcc';

let dir: string;

// Fake `aws` (describe-service) and `gh` (rollback run counts per status), driven by env vars.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apprunner-preflight-'));
  writeFileSync(
    join(dir, 'aws'),
    `#!/usr/bin/env bash
[ "\${FAKE_AWS_FAIL:-}" = 1 ] && exit 254
printf '%s\\t%s\\n' "\${FAKE_STATUS:-RUNNING}" "\${FAKE_IMAGE:-${IMG}}"
`,
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
[ "\${FAKE_GH_FAIL:-}" = 1 ] && exit 1
case "$*" in
  *"status=\${FAKE_ROLLBACK_STATUS:-none}&"*) echo 1;;
  *) echo 0;;
esac
`,
  );
  chmodSync(join(dir, 'aws'), 0o755);
  chmodSync(join(dir, 'gh'), 0o755);
});

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'TIMSInternational/tims-ats',
      AUTODEPLOY_PAUSED: '',
      ...env,
    },
  });
}

describe('apprunner-preflight.sh', () => {
  it('passes when RUNNING and the live image is the expected one', () => {
    expect(run([ARN, IMG]).status).toBe(0);
    expect(run([ARN, IMG, '--deploy']).status).toBe(0);
  });

  it('refuses when the live image changed since the caller read it', () => {
    const r = run([ARN, IMG], { FAKE_IMAGE: IMG.replace('a23dbcc', 'f21bb8e') });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('live image changed');
  });

  it('refuses when the service is mid-operation', () => {
    const r = run([ARN, IMG], { FAKE_STATUS: 'OPERATION_IN_PROGRESS' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('not RUNNING');
  });

  it('--deploy refuses while deploys are paused', () => {
    const r = run([ARN, IMG, '--deploy'], { AUTODEPLOY_PAUSED: 'true' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PAUSED');
  });

  it.each(['queued', 'waiting', 'pending', 'requested', 'in_progress'])(
    '--deploy refuses while a rollback run is %s',
    (status) => {
      const r = run([ARN, IMG, '--deploy'], { FAKE_ROLLBACK_STATUS: status });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`a rollback run is ${status}`);
    },
  );

  it('--deploy fails CLOSED when the rollback runs cannot be queried', () => {
    const r = run([ARN, IMG, '--deploy'], { FAKE_GH_FAIL: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('cannot query rollback runs');
  });

  it('the rollback mode (no --deploy) ignores the pause and rollback runs — it IS the rollback', () => {
    expect(run([ARN, IMG], { AUTODEPLOY_PAUSED: 'true', FAKE_ROLLBACK_STATUS: 'in_progress' }).status).toBe(0);
  });

  it('refuses when describe-service fails, and on bad usage', () => {
    expect(run([ARN, IMG], { FAKE_AWS_FAIL: '1' }).status).toBe(1);
    expect(run([ARN]).status).toBe(1);
    expect(run([ARN, IMG, '--force']).status).toBe(1);
  });
});
