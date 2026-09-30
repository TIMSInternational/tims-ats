import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// F16 alerting: CloudWatch alarms -> SNS email for the App Runner API. Two definitions exist on
// purpose — terraform/alarms.tf (opt-in; that module has never been applied) and the idempotent CLI
// mirror scripts/ops/create-alarms.sh (what actually creates them today). These tests pin that the two
// agree, and that the script is dry-run by default: it runs against production with no other guard.

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/ops/create-alarms.sh');
const TF = readFileSync(join(ROOT, 'services/Tims.Platform/deploy/terraform/alarms.tf'), 'utf8');
const TF_VARS = readFileSync(join(ROOT, 'services/Tims.Platform/deploy/terraform/variables.tf'), 'utf8');

const EXPECTED_ALARMS = ['5xx-count', '5xx-rate', 'cpu-high', 'latency-p95', 'memory-high'];

let dir: string;
let log: string;

// A fake `aws` on PATH: answers the read-only lookups like the real account and records every call.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'create-alarms-'));
  log = join(dir, 'calls.log');
  const fake = join(dir, 'aws');
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
{ printf '%s' "$*" | tr '\\n' ' '; echo; } >> "${log}"
case "$*" in
  *"sts get-caller-identity"*) echo "\${FAKE_ACCOUNT:-747814092517}";;
  *"apprunner list-services"*) echo "arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5";;
  *"sns create-topic"*) echo "arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms";;
  *"sns list-subscriptions-by-topic"*) echo "\${FAKE_SUB:-None}";;
  *) ;;
esac
`,
  );
  chmodSync(fake, 0o755);
});

const EMAIL = ['--email', 'alerts@example.com'];

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TIMS_ALARM_EMAIL: '', PATH: `${dir}:${process.env.PATH}`, ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { ...r, calls };
}

const MUTATING = /sns create-topic|sns subscribe|put-metric-alarm|delete|set-topic-attributes/;

describe('scripts/ops/create-alarms.sh', () => {
  it('is a DRY RUN by default: read-only lookups only, every mutation printed instead', () => {
    const r = run(EMAIL);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.filter((c) => MUTATING.test(c))).toEqual([]);
    expect(r.stdout.match(/would run: aws cloudwatch put-metric-alarm/g)?.length).toBe(5);
    expect(r.stdout).toContain('would run: aws sns subscribe');
    expect(r.stdout).toContain('alerts@example.com');
  });

  it('has NO default recipient: refuses without --email or TIMS_ALARM_EMAIL, before calling AWS', () => {
    for (const args of [[], ['--apply']]) {
      const r = run(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('alert recipient is required');
      expect(r.calls).toEqual([]);
    }
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/altostrats|@gmail/);
    expect(run([], { TIMS_ALARM_EMAIL: 'env@example.com' }).stdout).toContain('env@example.com');
  });

  it('--apply creates the topic, subscribes the email, upserts all five alarms — and exits 4 while unconfirmed', () => {
    const r = run([...EMAIL, '--apply']);
    expect(r.status, r.stderr).toBe(4);
    expect(r.stderr).toContain('ALERTING IS NOT LIVE');
    expect(r.calls.filter((c) => c.includes('sns create-topic'))).toHaveLength(1);
    expect(r.calls.filter((c) => c.includes('sns subscribe'))).toHaveLength(1);
    const alarms = r.calls.filter((c) => c.includes('put-metric-alarm'));
    expect(alarms.map((c) => c.match(/--alarm-name tims-platform-api-(\S+)/)?.[1]).sort()).toEqual(EXPECTED_ALARMS);
    for (const c of alarms) {
      expect(c).toContain('fe199157979c4a53a0a4ad2ffd9935c5'); // ServiceID dimension from the live ARN
      expect(c).toContain('--alarm-actions arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms');
      expect(c).toContain('--treat-missing-data notBreaching');
    }
    expect(r.stderr).toContain('PendingConfirmation');
  });

  it('--apply does not re-subscribe an address that is already subscribed (idempotent)', () => {
    const r = run([...EMAIL, '--apply'], {
      FAKE_SUB: 'arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms:abc',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('ALERTING IS NOT LIVE');
    expect(r.calls.filter((c) => c.includes('sns subscribe'))).toEqual([]);
  });

  it('--apply exits 4 with the banner when an EXISTING subscription is still pending (alarms still upserted)', () => {
    const r = run([...EMAIL, '--apply'], { FAKE_SUB: 'PendingConfirmation' });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('ALERTING IS NOT LIVE');
    expect(r.calls.filter((c) => c.includes('put-metric-alarm'))).toHaveLength(5);
    expect(r.calls.filter((c) => c.includes('sns subscribe'))).toEqual([]);
  });

  it('--apply refuses the wrong AWS account and changes nothing', () => {
    const r = run([...EMAIL, '--apply'], { FAKE_ACCOUNT: '111111111111' });
    expect(r.status).toBe(1);
    expect(r.calls.filter((c) => MUTATING.test(c))).toEqual([]);
  });

  it('rejects a malformed email or threshold before calling AWS', () => {
    expect(run(['--email', 'not-an-email']).status).toBe(1);
    expect(run(EMAIL, { ALARM_CPU_PERCENT: '85; rm -rf /' }).status).toBe(1);
  });
});

describe('terraform/alarms.tf mirrors the script', () => {
  it('declares the same five alarms, opt-in behind enable_alarms (default false)', () => {
    const simple = [...TF.matchAll(/^\s{4}"([a-z0-9-]+)" = \{/gm)].map((m) => m[1]);
    const math = TF.match(/alarm_name\s*=\s*"\$\{local\.alarm_prefix\}-(5xx-rate)"/)?.[1];
    expect([...simple, math].sort()).toEqual(EXPECTED_ALARMS);
    expect(TF_VARS).toMatch(/variable "enable_alarms" \{[\s\S]*?default\s*=\s*false/);
    expect(TF_VARS).toMatch(/variable "alarm_email" \{[\s\S]*?default\s*=\s*"fedetafur3@gmail\.com"/);
    for (const r of [
      'aws_sns_topic" "alarms',
      'aws_sns_topic_subscription" "alarm_email',
      'aws_cloudwatch_metric_alarm" "simple',
      'aws_cloudwatch_metric_alarm" "error_rate',
    ])
      expect(TF).toMatch(new RegExp(`resource "${r}" \\{\\n\\s+(count|for_each)\\s+= var\\.enable_alarms`));
  });

  it('uses the same metric-math rate expression and default thresholds', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const expr = 'IF(req >= 20, 100 * FILL(err, 0) / req, 0)';
    expect(TF).toContain(expr);
    expect(script).toContain(expr);
    const tfDefault = (name: string) =>
      TF_VARS.match(new RegExp(`variable "${name}" \\{[\\s\\S]*?default\\s*=\\s*(\\d+)`))?.[1];
    expect(script).toContain(`ALARM_5XX_COUNT:-${tfDefault('alarm_5xx_count_threshold')}`);
    expect(script).toContain(`ALARM_5XX_RATE_PERCENT:-${tfDefault('alarm_5xx_rate_percent')}`);
    expect(script).toContain(`ALARM_LATENCY_P95_MS:-${tfDefault('alarm_latency_p95_ms')}`);
    expect(script).toContain(`ALARM_CPU_PERCENT:-${tfDefault('alarm_cpu_percent')}`);
    expect(script).toContain(`ALARM_MEMORY_PERCENT:-${tfDefault('alarm_memory_percent')}`);
  });
});
