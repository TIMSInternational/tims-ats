import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from './helpers/parse-yaml';

// Executes the REAL `run:` bodies of deploy-platform-api.yml's `decide` comparison step and its
// update-service step — in their real step order, with the real preflight and payload scripts, against a
// real git history — faking only `aws` and `gh`. The standalone script tests cannot see ordering bugs
// between those scripts (Codex round 3 found one: the payload guard ran BEFORE the preflight and made
// the exit-3 skip unreachable).

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy-platform-api.yml');
const REGISTRY = '747814092517.dkr.ecr.us-west-2.amazonaws.com';
const REPO_IMG = `${REGISTRY}/tims-platform-api`;
const ARN = 'arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5';
const RUN_ID = '4242';
const RUN_CREATED = '2026-09-29T10:00:00Z';

type Step = { name?: string; id?: string; run?: string };
function stepRun(job: string, match: (s: Step) => boolean): string {
  const doc = parseYaml(WORKFLOW) as { jobs: Record<string, { steps: Step[] }> };
  const step = doc.jobs[job].steps.find(match);
  expect(step?.run, `step not found in ${job}`).toBeDefined();
  return step!.run!;
}

//   A -- B -- C   (main == origin/main)
//    \
//     D          (diverged)
let repo: string;
const sha = { A: '', B: '', C: '', D: '' };
type C = keyof typeof sha;
const short = (c: C) => sha[c].slice(0, 7);
const img = (c: C) => `${REPO_IMG}:${short(c)}`;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'deploy-steps-repo-'));
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
  git('update-ref', 'refs/remotes/origin/main', sha.C);
  git('checkout', '-q', '-b', 'side', sha.A);
  sha.D = commit('D');
  git('checkout', '-q', 'main');
  mkdirSync(join(repo, 'scripts/deploy'), { recursive: true });
  for (const f of ['apprunner-preflight.sh', 'apprunner-image-payload.py']) {
    copyFileSync(join(ROOT, 'scripts/deploy', f), join(repo, 'scripts/deploy', f));
  }
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-steps-'));
  writeFileSync(
    join(dir, 'live.tpl.json'),
    JSON.stringify({
      Service: {
        Status: 'RUNNING',
        ServiceUrl: 'x.awsapprunner.com',
        SourceConfiguration: {
          AutoDeploymentsEnabled: false,
          ImageRepository: {
            ImageIdentifier: '__IMAGE__',
            ImageRepositoryType: 'ECR',
            ImageConfiguration: { Port: '8080', RuntimeEnvironmentVariables: { A: '1', B: '2' } },
          },
        },
      },
    }),
  );
  writeFileSync(
    join(dir, 'aws'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/aws.log"
case "$*" in
  *list-services*) echo "${ARN}";;
  *describe-service*"Service.[Status"*) printf 'RUNNING\\t%s\\n' "$FAKE_IMAGE";;
  *describe-service*"--query"*) echo "$FAKE_IMAGE";;
  *describe-service*) sed "s|__IMAGE__|$FAKE_IMAGE|" "${dir}/live.tpl.json";;
  *update-service*) echo op-123;;
  *) exit 1;;
esac
`,
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
case "$*" in
  *"actions/runs/${RUN_ID} "*) echo "${RUN_CREATED}";;
  *"created="*) echo "\${FAKE_ROLLBACKS_CREATED_AFTER:-0}";;
  *"status="*) echo 0;;
  *) exit 1;;
esac
`,
  );
  chmodSync(join(dir, 'aws'), 0o755);
  chmodSync(join(dir, 'gh'), 0o755);
});

function exec(body: string, env: Record<string, string>) {
  for (const f of ['out', 'summary', 'env', 'aws.log']) writeFileSync(join(dir, f), ''); // fresh per call
  // GitHub's own bash invocation for `run:` steps.
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', body], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      AWS_REGION: 'us-west-2',
      SERVICE_NAME: 'tims-platform-api',
      ECR_REPO: 'tims-platform-api',
      GITHUB_OUTPUT: join(dir, 'out'),
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      GITHUB_ENV: join(dir, 'env'),
      GITHUB_ACTOR: 'operator',
      GITHUB_REPOSITORY: 'TIMSInternational/tims-ats',
      GITHUB_RUN_ID: RUN_ID,
      AUTODEPLOY_PAUSED: '',
      FORCE_OLDER: '',
      ...env,
    },
  });
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const awsLog = read('aws.log');
  return { ...r, out: read('out'), summary: read('summary'), updated: awsLog.includes('update-service') };
}

describe('deploy-platform-api.yml — the update-service step, executed in its real order', () => {
  const body = () => stepRun('deploy', (s) => s.id === 'update');
  const update = (decided: C, live: C, target: C, env: Record<string, string> = {}) =>
    exec(body(), {
      REGISTRY,
      TAG: short(target),
      DECIDED_IMAGE: img(decided),
      TARGET_SHA: sha[target],
      FAKE_IMAGE: img(live),
      GH_TOKEN: 'x',
      ...env,
    });

  it('deploys when the live image is still the one decide read', () => {
    const r = update('B', 'B', 'C');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.updated).toBe(true);
    expect(r.out).not.toContain('skipped=true');
    const payload = JSON.parse(readFileSync(join(repo, 'payload.json'), 'utf8'));
    expect(payload.ImageRepository.ImageIdentifier).toBe(img('C'));
  });

  it('SKIPS successfully when a queued deploy already installed this very commit (Codex r3 P2)', () => {
    // The payload guard refuses an unchanged image, so it must not run before the preflight's exit 3.
    const r = update('B', 'C', 'C');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain('skipped=true');
    expect(r.summary).toContain('Deploy skipped');
    expect(r.updated).toBe(false);
  });

  it('SKIPS successfully when production already runs a NEWER commit', () => {
    const r = update('A', 'C', 'B');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain('skipped=true');
    expect(r.updated).toBe(false);
  });

  it('refuses without calling update-service when a rollback was requested after this run', () => {
    const r = update('B', 'B', 'C', { FAKE_ROLLBACKS_CREATED_AFTER: '1' });
    expect(r.status).toBe(1);
    expect(r.updated).toBe(false);
  });

  it('a FORCED older deploy goes through over the image decide approved, and refuses if it changed', () => {
    const forced = update('C', 'C', 'B', { FORCE_OLDER: 'true' });
    expect(forced.status, forced.stdout + forced.stderr).toBe(0);
    expect(forced.updated).toBe(true);
    const moved = update('B', 'C', 'A', { FORCE_OLDER: 'true' });
    expect(moved.status).toBe(1);
    expect(moved.stdout).toContain('force_older');
    expect(moved.updated).toBe(false);
  });
});

describe('deploy-platform-api.yml — decide, executed: manual deploys obey the no-regression rule (Codex r3 P1)', () => {
  const body = () => stepRun('decide', (s) => s.id === 'decide');
  const decide = (event: string, target: C, liveImage: string, env: Record<string, string> = {}) =>
    exec(body(), { EVENT: event, SHA: sha[target], REASON: 'test', FAKE_IMAGE: liveImage, ...env });

  it('refuses a manual deploy of an OLDER commit over a newer running one', () => {
    const r = decide('workflow_dispatch', 'B', img('C'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('deploy=false');
    expect(r.stdout).toContain('force_older=true');
    expect(r.summary).toContain('REFUSED');
  });

  it('refuses a manual deploy over a DIVERGED running commit', () => {
    const r = decide('workflow_dispatch', 'C', img('D'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('deploy=false');
  });

  it('allows the regression only with force_older=true, and records it in the summary', () => {
    const r = decide('workflow_dispatch', 'B', img('C'), { FORCE_OLDER: 'true' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain('deploy=true');
    expect(r.summary).toContain('FORCED (force_older=true)');
    expect(r.summary).toContain('operator');
  });

  it('allows a manual roll FORWARD and an unattributable running tag; skips the same commit', () => {
    expect(decide('workflow_dispatch', 'C', img('B')).out).toContain('deploy=true');
    expect(decide('workflow_dispatch', 'C', `${REPO_IMG}:latest`).out).toContain('deploy=true');
    const same = decide('workflow_dispatch', 'C', img('C'));
    expect(same.status).toBe(0);
    expect(same.out).toContain('deploy=false');
  });

  it('still refuses everything while paused, and the automatic path is unchanged', () => {
    const paused = decide('workflow_dispatch', 'C', img('B'), { AUTODEPLOY_PAUSED: 'true' });
    expect(paused.out).toContain('deploy=false');
    expect(paused.summary).toContain('PAUSED');
    const auto = decide('workflow_run', 'B', img('C'), { FORCE_OLDER: 'true' });
    expect(auto.status).toBe(0);
    expect(auto.out, 'force_older must not affect automatic deploys').toContain('deploy=false');
  });
});
