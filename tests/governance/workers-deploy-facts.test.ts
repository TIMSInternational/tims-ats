import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── The workers deploy must FAIL LOUD on the facts it gathers from AWS ──────────
//
// workers-deploy-decide.test.ts pins the pure decision. This file pins how the
// workflow COLLECTS the two AWS facts around it, which the pure script cannot see:
//
// 1. Service status. The first `decide` step ran describe-services with
//    `2>/dev/null || true` and turned ANY failure — AccessDenied, throttling, an
//    expired OIDC session, a network error — into SERVICE_STATUS=MISSING. An
//    automatic run then said "no ECS service yet" and finished green; prod kept old
//    code. Only "the service does not exist" and "the cluster does not exist" may
//    become MISSING.
//
// 2. Roll outcome. The service has deploymentCircuitBreaker rollback=true. When the
//    new task never gets healthy the breaker rolls back, the service is stable again
//    on the OLD revision, `aws ecs wait services-stable` returns 0, and the job said
//    "Workers rolled to <tag>". The roll must be verified against the new revision.
//
// 3. Roll timing. `services-stable` waits for runningCount/deployments, NOT for the
//    deployment's rolloutState, which ECS flips to COMPLETED a little later. A
//    one-shot check right after the waiter saw IN_PROGRESS and reported a healthy
//    deploy as FAILED. The verifier must POLL: IN_PROGRESS keeps waiting, COMPLETED
//    passes, FAILED fails with the reason, and a bounded timeout fails loud.

const ROOT = resolve(__dirname, '../..');
const STATUS = resolve(ROOT, 'scripts/deploy/workers-service-status.sh');
const VERIFY = resolve(ROOT, 'scripts/deploy/workers-verify-roll.sh');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-platform-workers.yml'), 'utf8');

const NEW_TD = 'arn:aws:ecs:us-west-2:747814092517:task-definition/tims-platform-workers:8';
const OLD_TD = 'arn:aws:ecs:us-west-2:747814092517:task-definition/tims-platform-workers:7';

let fakeBin: string;

beforeAll(() => {
  // A fake `aws` that replays a canned response and records that it was called.
  fakeBin = mkdtempSync(join(tmpdir(), 'fake-aws-'));
  const aws = join(fakeBin, 'aws');
  writeFileSync(
    aws,
    [
      '#!/usr/bin/env bash',
      // Every call is counted, so a test can prove the verifier polled (or stopped early).
      'if [ -n "${FAKE_AWS_CALLS:-}" ]; then echo x >> "$FAKE_AWS_CALLS"; fi',
      // Sequence mode: call N replays $FAKE_AWS_SEQ_DIR/N, and the last file repeats forever.
      'if [ -n "${FAKE_AWS_SEQ_DIR:-}" ]; then',
      '  n=$(wc -l < "$FAKE_AWS_CALLS" | tr -d " ")',
      '  last=$(ls "$FAKE_AWS_SEQ_DIR" | sort -n | tail -1)',
      '  [ "$n" -gt "$last" ] && n=$last',
      '  cat "$FAKE_AWS_SEQ_DIR/$n"',
      '  exit 0',
      'fi',
      'printf "%s" "${FAKE_AWS_STDOUT:-}"',
      'printf "%s" "${FAKE_AWS_STDERR:-}" >&2',
      'exit "${FAKE_AWS_EXIT:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(aws, 0o755);
});

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

type Fake = { stdout?: string; stderr?: string; exit?: number };

// A verifier poll budget that keeps the constant-response cases fast: two polls, 1s apart.
const FAST_POLL = { VERIFY_ROLL_TIMEOUT_SECONDS: '1', VERIFY_ROLL_INTERVAL_SECONDS: '1' };

function run(script: string, fake: Fake, args: string[] = [], extraEnv: Record<string, string> = FAST_POLL) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      NODE_ENV: 'test',
      AWS_REGION: 'us-west-2',
      ECS_CLUSTER: 'tims-platform',
      ECS_SERVICE: 'tims-platform-workers',
      FAKE_AWS_STDOUT: fake.stdout ?? '',
      FAKE_AWS_STDERR: fake.stderr ?? '',
      FAKE_AWS_EXIT: String(fake.exit ?? 0),
      ...extraEnv,
    },
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

/** Run the verifier against a SEQUENCE of describe-services responses; returns the call count too. */
function runSeq(responses: string[], env: Record<string, string> = FAST_POLL) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-aws-seq-'));
  try {
    responses.forEach((body, i) => writeFileSync(join(dir, String(i + 1)), body));
    const calls = join(dir, 'calls.log');
    writeFileSync(calls, '');
    const r = run(VERIFY, {}, [NEW_TD], { ...env, FAKE_AWS_SEQ_DIR: dir, FAKE_AWS_CALLS: calls });
    const n = readFileSync(calls, 'utf8').split('\n').filter(Boolean).length;
    return { ...r, calls: n };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const svc = (s: Record<string, unknown>) => JSON.stringify({ services: [s], failures: [] });

describe('workers deploy — service status is MISSING only when it really is', () => {
  it.each(['ACTIVE', 'DRAINING', 'INACTIVE'])('reports a real %s service', (status) => {
    const r = run(STATUS, { stdout: svc({ status }) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(status);
  });

  it('a service that does not exist (failures[].reason MISSING) is MISSING', () => {
    const r = run(STATUS, {
      stdout: JSON.stringify({
        services: [],
        failures: [
          { arn: 'arn:aws:ecs:us-west-2:747814092517:service/tims-platform/tims-platform-workers', reason: 'MISSING' },
        ],
      }),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('MISSING');
  });

  it('a cluster that does not exist (ClusterNotFoundException) is MISSING', () => {
    const r = run(STATUS, {
      exit: 254,
      stderr:
        'An error occurred (ClusterNotFoundException) when calling the DescribeServices operation: Cluster not found.',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('MISSING');
  });

  it.each([
    [
      'AccessDenied',
      'An error occurred (AccessDeniedException) when calling the DescribeServices operation: User is not authorized',
    ],
    [
      'throttling',
      'An error occurred (ThrottlingException) when calling the DescribeServices operation: Rate exceeded',
    ],
    [
      'expired OIDC session',
      'An error occurred (ExpiredTokenException) when calling the DescribeServices operation: The security token included in the request is expired',
    ],
    ['network error', 'Could not connect to the endpoint URL: "https://ecs.us-west-2.amazonaws.com/"'],
    ['silent failure', ''],
  ])('a failed call (%s) FAILS instead of becoming MISSING', (_label, stderr) => {
    const r = run(STATUS, { exit: 254, stderr });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('MISSING');
    expect(r.stderr).toContain('::error::');
  });

  it.each([
    ['unparseable output', 'not json'],
    ['empty output', ''],
    ['no service and a non-MISSING failure', JSON.stringify({ services: [], failures: [{ reason: 'ACCESS_DENIED' }] })],
    ['no service and no failure', JSON.stringify({ services: [], failures: [] })],
    ['an unknown status', svc({ status: 'WEIRD' })],
    ['a service without status', svc({})],
  ])('a successful call with %s FAILS instead of becoming MISSING', (_label, stdout) => {
    const r = run(STATUS, { stdout });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('MISSING');
  });
});

const stable = (over: Record<string, unknown> = {}, dep: Record<string, unknown> = {}) =>
  svc({
    status: 'ACTIVE',
    taskDefinition: NEW_TD,
    runningCount: 1,
    desiredCount: 1,
    deployments: [{ status: 'PRIMARY', taskDefinition: NEW_TD, rolloutState: 'COMPLETED', ...dep }],
    ...over,
  });

describe('workers deploy — a roll is green only when the service runs the NEW revision', () => {
  it('passes when the PRIMARY deployment is the new revision and COMPLETED', () => {
    const r = run(VERIFY, { stdout: stable() }, [NEW_TD]);
    expect(r.status, r.stderr).toBe(0);
  });

  it('FAILS after a circuit-breaker rollback (stable again, on the OLD revision)', () => {
    const r = run(
      VERIFY,
      {
        stdout: stable(
          { taskDefinition: OLD_TD },
          {
            taskDefinition: OLD_TD,
            rolloutState: 'COMPLETED',
            rolloutStateReason: 'ECS deployment circuit breaker: rolling back',
          },
        ),
      },
      [NEW_TD],
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('::error::');
    expect(r.stderr).toContain(OLD_TD);
  });

  it.each([
    ['rolloutState FAILED', {}, { rolloutState: 'FAILED' }],
    ['service on the new TD but PRIMARY on the old one', {}, { taskDefinition: OLD_TD }],
    ['running below desired', { runningCount: 0 }, {}],
    [
      'two deployments still present',
      {
        deployments: [
          { status: 'PRIMARY', taskDefinition: NEW_TD, rolloutState: 'COMPLETED' },
          { status: 'ACTIVE', taskDefinition: OLD_TD, rolloutState: 'COMPLETED' },
        ],
      },
      {},
    ],
    ['no deployments', { deployments: [] }, {}],
  ])('FAILS when %s', (_label, over, dep) => {
    const r = run(VERIFY, { stdout: stable(over, dep) }, [NEW_TD]);
    expect(r.status).not.toBe(0);
  });

  it.each([
    ['describe-services fails', { exit: 254, stderr: 'An error occurred (AccessDeniedException)' }],
    ['no service returned', { stdout: JSON.stringify({ services: [], failures: [{ reason: 'MISSING' }] }) }],
    ['unparseable output', { stdout: 'not json' }],
  ])('FAILS when %s', (_label, fake) => {
    expect(run(VERIFY, fake, [NEW_TD]).status).not.toBe(0);
  });

  it('refuses a missing or malformed NEW_TD argument', () => {
    expect(run(VERIFY, { stdout: stable() }, []).status).not.toBe(0);
    expect(run(VERIFY, { stdout: stable() }, ['None']).status).not.toBe(0);
  });
});

describe('workers deploy — the verifier POLLS rolloutState instead of judging one snapshot', () => {
  const inProgress = stable({}, { rolloutState: 'IN_PROGRESS', rolloutStateReason: 'ECS deployment in progress' });
  // A generous budget: a test that passes or fails EARLY must not be rescued by the timeout.
  const PATIENT = { VERIFY_ROLL_TIMEOUT_SECONDS: '60', VERIFY_ROLL_INTERVAL_SECONDS: '1' };

  it('IN_PROGRESS right after the waiter, then COMPLETED, is a PASS (the healthy-deploy case)', () => {
    const r = runSeq([inProgress, inProgress, stable()], PATIENT);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toBe(3);
    expect(r.stdout).toContain('rollout COMPLETED');
  });

  it('IN_PROGRESS then FAILED fails with the rolloutStateReason, without waiting for the timeout', () => {
    const reason = 'ECS deployment circuit breaker: tasks failed to start.';
    const r = runSeq([inProgress, stable({}, { rolloutState: 'FAILED', rolloutStateReason: reason })], PATIENT);
    expect(r.status).not.toBe(0);
    expect(r.calls).toBe(2);
    expect(r.stderr).toContain('::error::');
    expect(r.stderr).toContain(reason);
  });

  it('a rollback seen mid-poll (PRIMARY moves to the OLD revision) fails at once', () => {
    const rolledBack = stable(
      { taskDefinition: OLD_TD },
      { taskDefinition: OLD_TD, rolloutState: 'IN_PROGRESS', rolloutStateReason: 'circuit breaker: rolling back' },
    );
    const r = runSeq([inProgress, rolledBack], PATIENT);
    expect(r.status).not.toBe(0);
    expect(r.calls).toBe(2);
    expect(r.stderr).toContain(OLD_TD);
  });

  it('IN_PROGRESS forever FAILS LOUD at the timeout, after polling more than once', () => {
    const r = runSeq([inProgress], { VERIFY_ROLL_TIMEOUT_SECONDS: '2', VERIFY_ROLL_INTERVAL_SECONDS: '1' });
    expect(r.status).not.toBe(0);
    expect(r.calls).toBeGreaterThan(1);
    expect(r.stderr).toContain('::error::');
    expect(r.stderr).toMatch(/timed out/i);
    expect(r.stderr).toContain('IN_PROGRESS');
  });

  it('COMPLETED but not yet settled (old deployment still draining) keeps waiting, then passes', () => {
    const draining = stable({
      deployments: [
        { status: 'PRIMARY', taskDefinition: NEW_TD, rolloutState: 'COMPLETED' },
        { status: 'ACTIVE', taskDefinition: OLD_TD, rolloutState: 'COMPLETED' },
      ],
    });
    const r = runSeq([draining, stable()], PATIENT);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toBe(2);
  });

  it('a describe-services failure mid-poll fails loud (never read as "still in progress")', () => {
    // Sequence mode cannot express a failing call, so a constant failure stands in: it must fail on call 1.
    const r = run(VERIFY, { exit: 254, stderr: 'An error occurred (ThrottlingException)' }, [NEW_TD], PATIENT);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('::error::');
  });

  it.each([
    ['a non-numeric timeout', { VERIFY_ROLL_TIMEOUT_SECONDS: 'ten', VERIFY_ROLL_INTERVAL_SECONDS: '1' }],
    [
      'a zero interval (would busy-loop the AWS API)',
      { VERIFY_ROLL_TIMEOUT_SECONDS: '10', VERIFY_ROLL_INTERVAL_SECONDS: '0' },
    ],
    ['a zero timeout', { VERIFY_ROLL_TIMEOUT_SECONDS: '0', VERIFY_ROLL_INTERVAL_SECONDS: '1' }],
  ])('refuses %s', (_label, env) => {
    const r = run(VERIFY, { stdout: stable() }, [NEW_TD], env);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('::error::');
  });
});

/** One step of the workflow's `steps:` list: its raw text. */
function step(src: string, match: RegExp): string {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  const blocks: string[][] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {6}- /.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  }
  const hits = blocks.map((b) => b.join('\n')).filter((s) => match.test(s));
  expect(hits, `exactly one step matches ${match}`).toHaveLength(1);
  return hits[0];
}

describe('workers deploy — the workflow uses the fail-loud fact gatherers', () => {
  it('the decide step gets the service status from workers-service-status.sh, never from a swallowed call', () => {
    const decide = step(WORKFLOW, /^\s+id:\s*decide\s*$/m);
    expect(decide).toMatch(/SERVICE_STATUS="\$\(bash scripts\/deploy\/workers-service-status\.sh\)"/);
    expect(decide).toMatch(/^\s+set -euo pipefail\s*$/m);
    // No AWS call anywhere in the workflow may swallow its own failure.
    expect(WORKFLOW).not.toMatch(/aws [^\n]*2>\/dev\/null/);
    expect(WORKFLOW).not.toMatch(/aws [^\n]*\|\| true/);
    expect(WORKFLOW).not.toMatch(/SERVICE_STATUS="MISSING"/);
  });

  it('the roll step verifies the new revision AFTER the waiter and BEFORE reporting success', () => {
    const roll = step(WORKFLOW, /aws ecs update-service/);
    const wait = roll.indexOf('aws ecs wait services-stable');
    const verify = roll.indexOf('bash scripts/deploy/workers-verify-roll.sh "$NEW_TD"');
    const success = roll.indexOf('### Workers rolled to');
    expect(wait).toBeGreaterThan(-1);
    expect(verify, 'verify-roll is called with $NEW_TD').toBeGreaterThan(wait);
    expect(success).toBeGreaterThan(verify);
    // The failure branch must exit non-zero.
    expect(roll.slice(verify, success)).toMatch(/exit 1/);
  });
});
