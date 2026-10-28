import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/ops/create-cv-recovery-alarm.sh');
let directory: string;
let callsFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cv-recovery-alarm-'));
  callsFile = join(directory, 'calls.log');
  const fake = join(directory, 'aws');
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
echo "$*" >> "${callsFile}"
case "$*" in
  *"sts get-caller-identity"*) echo "\${FAKE_ACCOUNT:-747814092517}";;
  *"apprunner list-services"*) echo "arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/service-id";;
  *"logs describe-log-groups"*) echo "/aws/apprunner/tims-platform-api/service-id/application";;
  *"sns list-subscriptions-by-topic"*) echo "\${FAKE_SUB:-None}";;
esac
`,
  );
  chmodSync(fake, 0o755);
});

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ...env },
  });
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n');
  return { result, calls };
}

describe('CV recovery alarm setup', () => {
  it('is read-only by default and names the exact application log group', () => {
    const { result, calls } = run([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('/aws/apprunner/tims-platform-api/service-id/application');
    expect(result.stdout).toContain('Dry run');
    expect(calls.some((call) => /put-metric-filter|put-metric-alarm/.test(call))).toBe(false);
  });

  it('refuses apply before mutation when SNS has no confirmed subscriber', () => {
    const { result, calls } = run(['--apply']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no confirmed subscription');
    expect(calls.some((call) => /put-metric-filter|put-metric-alarm/.test(call))).toBe(false);
  });

  it('creates the alert and heartbeat filters/alarms only after subscription confirmation', () => {
    const { result, calls } = run(['--apply'], {
      FAKE_SUB: 'arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms:confirmed',
    });
    expect(result.status, result.stderr).toBe(0);
    const filter = calls.find((call) => call.includes('put-metric-filter'));
    const alarm = calls.find((call) => call.includes('put-metric-alarm'));
    expect(filter).toContain('CV_RECOVERY_ALERT');
    expect(filter).toContain('RecoveryAlertCount');
    expect(alarm).toContain('tims-platform-api-cv-recovery-alert');
    expect(alarm).toContain('arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms');
    // The alert clears: missing data (no current problem) is not breaching, and OK is notified.
    expect(alarm).toContain('--treat-missing-data notBreaching');
    expect(alarm).toContain('--ok-actions');

    const heartbeatFilter = calls.find((call) => call.includes('put-metric-filter') && call.includes('HEARTBEAT'));
    const heartbeat = calls.find((call) => call.includes('put-metric-alarm') && call.includes('heartbeat'));
    expect(heartbeatFilter).toContain('CV_RECOVERY_HEARTBEAT');
    expect(heartbeatFilter).toContain('RecoveryHeartbeatCount');
    expect(heartbeat).toContain('tims-platform-api-cv-recovery-heartbeat');
    expect(heartbeat).toContain('--comparison-operator LessThanThreshold');
    // A stalled loop emits nothing at all: missing data must page.
    expect(heartbeat).toContain('--treat-missing-data breaching');
    expect(heartbeat).toContain('--ok-actions');
  });

  it('matches the log tokens the .NET host actually emits', () => {
    const host = readFileSync(
      resolve(__dirname, '../../services/Tims.Platform/src/Tims.Api/CvParsing/CvParseRecoveryHostedService.cs'),
      'utf8',
    );
    expect(host).toContain('"CV_RECOVERY_HEARTBEAT ');
    expect(host).toContain('"CV_RECOVERY_ALERT:');
  });
});
