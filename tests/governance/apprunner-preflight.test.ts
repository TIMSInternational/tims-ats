import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Behaviour of the last check both deploy and rollback run immediately before update-service.
// The two workflows' mutating jobs share the `platform-api-mutation` lock (pinned in deploy-workflow /
// rollback-workflow tests); this script covers what changed while a job WAITED for that lock.

const SCRIPT = resolve(__dirname, '../../scripts/deploy/apprunner-preflight.sh');
const ARN = 'arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5';
const REGISTRY = '747814092517.dkr.ecr.us-west-2.amazonaws.com/tims-platform-api';
const RUN_ID = '4242';
const RUN_CREATED = '2026-09-29T10:00:00Z';

// A REAL git history, so the ancestry logic runs against real `git`:
//   A -- B -- C   (main)
//    \
//     D          (diverged)
let repo: string;
const sha: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
const img = (c: keyof typeof sha) => `${REGISTRY}:${sha[c].slice(0, 7)}`;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'apprunner-preflight-repo-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');
  const commit = (m: string) => {
    git('commit', '-q', '--allow-empty', '-m', m);
    return git('rev-parse', 'HEAD');
  };
  sha.A = commit('A');
  sha.B = commit('B');
  sha.C = commit('C');
  git('checkout', '-q', '-b', 'side', sha.A);
  sha.D = commit('D');
  git('checkout', '-q', 'main');
});

let dir: string;
let ghLog: string;

// Fake `aws` (describe-service) and `gh` (this run's created_at; rollback run counts), driven by env.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apprunner-preflight-'));
  ghLog = join(dir, 'gh.log');
  writeFileSync(
    join(dir, 'aws'),
    `#!/usr/bin/env bash
[ "\${FAKE_AWS_FAIL:-}" = 1 ] && exit 254
printf '%s\\t%s\\n' "\${FAKE_STATUS:-RUNNING}" "\${FAKE_IMAGE}"
`,
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
echo "$*" >> "${ghLog}"
[ "\${FAKE_GH_FAIL:-}" = 1 ] && exit 1
case "$*" in
  *"actions/runs/${RUN_ID} "*)
    [ "\${FAKE_GH_RUN_FAIL:-}" = 1 ] && exit 1
    echo "\${FAKE_RUN_CREATED:-${RUN_CREATED}}";;
  *"status="*"created="*|*"created="*"status="*) echo 0;;
  *"created=%3E%3D${RUN_CREATED}&"*)
    [ "\${FAKE_GH_CREATED_FAIL:-}" = 1 ] && exit 1
    echo "\${FAKE_ROLLBACKS_CREATED_AFTER:-0}";;
  *"status=\${FAKE_ROLLBACK_STATUS:-none}&"*) echo 1;;
  *"status="*) echo 0;;
  *) exit 1;;
esac
`,
  );
  chmodSync(join(dir, 'aws'), 0o755);
  chmodSync(join(dir, 'gh'), 0o755);
});

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'TIMSInternational/tims-ats',
      GITHUB_RUN_ID: RUN_ID,
      TARGET_SHA: sha.C,
      AUTODEPLOY_PAUSED: '',
      FAKE_IMAGE: img('B'),
      ...env,
    },
  });
}

describe('apprunner-preflight.sh', () => {
  it('passes when RUNNING and the live image is the expected one', () => {
    expect(run([ARN, img('B')]).status).toBe(0);
    expect(run([ARN, img('B'), '--deploy']).status).toBe(0);
  });

  it('rollback mode stays STRICT: any change to the live image refuses, older or newer', () => {
    for (const live of ['A', 'C', 'D'] as const) {
      const r = run([ARN, img('B')], { FAKE_IMAGE: img(live) });
      expect(r.status, `live=${live}`).toBe(1);
      expect(r.stdout).toContain('live image changed');
    }
  });

  it('refuses when the service is mid-operation', () => {
    const r = run([ARN, img('B')], { FAKE_STATUS: 'OPERATION_IN_PROGRESS' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('not RUNNING');
  });

  it('--deploy refuses while deploys are paused', () => {
    const r = run([ARN, img('B'), '--deploy'], { AUTODEPLOY_PAUSED: 'true' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PAUSED');
  });

  it.each(['queued', 'waiting', 'pending', 'requested', 'in_progress'])(
    '--deploy refuses while a rollback run is %s',
    (status) => {
      const r = run([ARN, img('B'), '--deploy'], { FAKE_ROLLBACK_STATUS: status });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`a rollback run is ${status}`);
    },
  );

  it('--deploy fails CLOSED when the rollback runs cannot be queried', () => {
    const r = run([ARN, img('B'), '--deploy'], { FAKE_GH_FAIL: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('cannot query rollback runs');
  });

  // ── Rollback requested AFTER this deploy started (Codex r2 P1 backstop) ─────────────────────────
  it('--deploy refuses when ANY rollback run (completed or cancelled too) was created after this deploy run', () => {
    const r = run([ARN, img('B'), '--deploy'], { FAKE_ROLLBACKS_CREATED_AFTER: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('a rollback was requested at or after this deploy started');
    expect(r.stdout).toContain('re-dispatch');
    // It must ask about THIS run's creation time, and must not narrow the rollback query by status:
    // a completed or cancelled rollback counts.
    const log = readFileSync(ghLog, 'utf8');
    expect(log).toContain(`repos/TIMSInternational/tims-ats/actions/runs/${RUN_ID} `);
    const createdQuery = log.split('\n').find((l) => l.includes('created='));
    expect(createdQuery).toBeDefined();
    expect(createdQuery).toContain(`created=%3E%3D${RUN_CREATED}&`);
    expect(createdQuery).not.toContain('status=');
  });

  it('--deploy fails CLOSED when this run creation time or the created-after count cannot be read', () => {
    const cases: Record<string, string>[] = [
      { FAKE_GH_RUN_FAIL: '1' },
      { FAKE_RUN_CREATED: 'null' },
      { FAKE_GH_CREATED_FAIL: '1' },
      { FAKE_ROLLBACKS_CREATED_AFTER: 'null' },
      { GITHUB_RUN_ID: '' },
    ];
    for (const env of cases) {
      const r = run([ARN, img('B'), '--deploy'], env);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stdout, JSON.stringify(env)).toContain('::error::preflight:');
    }
  });

  // ── Live image moved while this deploy waited for the lock ─────────────────────────────────────
  it('--deploy SKIPS (exit 3) when production already runs this commit or a newer one', () => {
    // decide read B; another deploy put C (== TARGET) or a descendant there meanwhile.
    const same = run([ARN, img('A'), '--deploy'], { FAKE_IMAGE: img('C'), TARGET_SHA: sha.C });
    expect(same.status).toBe(3);
    expect(same.stdout).toContain('preflight skip');
    const newer = run([ARN, img('A'), '--deploy'], { FAKE_IMAGE: img('C'), TARGET_SHA: sha.B });
    expect(newer.status).toBe(3);
  });

  it('--deploy PROCEEDS when another deploy moved production to a strict ANCESTOR of this commit', () => {
    const r = run([ARN, img('A'), '--deploy'], { FAKE_IMAGE: img('B'), TARGET_SHA: sha.C });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('moved forward');
  });

  it('--deploy refuses when the changed live image is diverged or unresolvable', () => {
    const diverged = run([ARN, img('A'), '--deploy'], { FAKE_IMAGE: img('D'), TARGET_SHA: sha.C });
    expect(diverged.status).toBe(1);
    expect(diverged.stdout).toContain('neither an ancestor nor a descendant');
    for (const tag of ['latest', 'fffffff']) {
      const r = run([ARN, img('A'), '--deploy'], { FAKE_IMAGE: `${REGISTRY}:${tag}`, TARGET_SHA: sha.C });
      expect(r.status, tag).toBe(1);
      expect(r.stdout).toContain('does not resolve to a commit');
    }
  });

  it('--deploy requires the 40-char TARGET_SHA', () => {
    expect(run([ARN, img('B'), '--deploy'], { TARGET_SHA: '' }).status).toBe(1);
    expect(run([ARN, img('B'), '--deploy'], { TARGET_SHA: sha.C.slice(0, 7) }).status).toBe(1);
  });

  it('the rollback mode (no --deploy) ignores the pause and rollback runs — it IS the rollback', () => {
    expect(
      run([ARN, img('B')], {
        AUTODEPLOY_PAUSED: 'true',
        FAKE_ROLLBACK_STATUS: 'in_progress',
        FAKE_ROLLBACKS_CREATED_AFTER: '1',
      }).status,
    ).toBe(0);
  });

  it('refuses when describe-service fails, and on bad usage', () => {
    expect(run([ARN, img('B')], { FAKE_AWS_FAIL: '1' }).status).toBe(1);
    expect(run([ARN]).status).toBe(1);
    expect(run([ARN, img('B'), '--force']).status).toBe(1);
  });
});
