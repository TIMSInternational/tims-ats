import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from './helpers/parse-yaml';

// Executes the REAL `run:` bodies of deploy-platform-api.yml's `decide` comparison step and its
// update-service step — in their real step order, with the real preflight and payload scripts, against a
// real git history — faking only `aws`, `gh` and `docker`. The standalone script tests cannot see
// ordering bugs between those scripts (Codex round 3 found one: the payload guard ran BEFORE the
// preflight and made the exit-3 skip unreachable; round 4 found another: an unconditional push of an
// IMMUTABLE tag failed before that skip was reached).

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy-platform-api.yml');
const REGISTRY = '747814092517.dkr.ecr.us-west-2.amazonaws.com';
const REPO_IMG = `${REGISTRY}/tims-platform-api`;
const ARN = 'arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5';
const RUN_ID = '4242';
const RUN_CREATED = '2026-09-29T10:00:00Z';

type Step = { name?: string; id?: string; run?: string; uses?: string; if?: string };
function stepRun(job: string, match: (s: Step) => boolean): string {
  const doc = parseYaml(WORKFLOW) as { jobs: Record<string, { steps: Step[] }> };
  const step = doc.jobs[job].steps.find(match);
  expect(step?.run, `step not found in ${job}`).toBeDefined();
  return step!.run!;
}

//   A -- B -- C   (main == origin/main; B changes services/Tims.Platform)
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
  mkdirSync(join(repo, 'services/Tims.Platform'), { recursive: true });
  writeFileSync(join(repo, 'services/Tims.Platform/Api.cs'), '// C# change\n');
  git('add', 'services/Tims.Platform/Api.cs');
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
  *"ecr describe-images"*)
    case "\${FAKE_ECR:-absent}" in
      exists) echo "sha256:$(printf 'a%.0s' $(seq 64))";;
      absent) echo "An error occurred (ImageNotFoundException) when calling the DescribeImages operation" >&2; exit 254;;
      *) echo "An error occurred (AccessDeniedException) when calling the DescribeImages operation" >&2; exit 254;;
    esac;;
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
  writeFileSync(join(dir, 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${dir}/aws.log"\n`);
  chmodSync(join(dir, 'docker'), 0o755);
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
  return { ...r, out: read('out'), summary: read('summary'), log: awsLog, updated: awsLog.includes('update-service') };
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

describe('deploy-platform-api.yml — decide, executed: ONE rule for automatic and manual deploys (Codex r3 P1, r4 P1)', () => {
  const body = () => stepRun('decide', (s) => s.id === 'decide');
  const decide = (event: string, target: C, liveImage: string, env: Record<string, string> = {}) =>
    exec(body(), { EVENT: event, SHA: sha[target], REASON: 'test', FAKE_IMAGE: liveImage, ...env });
  const BOTH = ['workflow_run', 'workflow_dispatch'];

  it('BOTH paths deploy main over a DIVERGED running commit — restoring main — and say so', () => {
    // D is not on main's history; C is. Deploying C is not a regression, it puts main back.
    for (const event of BOTH) {
      const r = decide(event, 'C', img('D'));
      expect(r.status, `${event}: ${r.stdout}${r.stderr}`).toBe(0);
      expect(r.out, event).toContain('deploy=true');
      expect(r.summary, event).toContain('DIVERGED');
      expect(r.stdout, event).toContain('restores main');
    }
    // force_older is irrelevant to divergence: without it a manual deploy goes through un-FORCED.
    expect(decide('workflow_dispatch', 'C', img('D')).summary).not.toContain('FORCED');
  });

  it('BOTH paths deploy over an OLDER commit or an unattributable tag, and skip the same commit', () => {
    for (const event of BOTH) {
      expect(decide(event, 'C', img('A')).out, event).toContain('deploy=true');
      expect(decide(event, 'C', `${REPO_IMG}:latest`).out, event).toContain('deploy=true');
      const same = decide(event, 'C', img('C'));
      expect(same.status, event).toBe(0);
      expect(same.out, event).toContain('deploy=false');
    }
  });

  it('a NEWER running commit: the automatic path skips; a manual dispatch refuses without force_older', () => {
    const auto = decide('workflow_run', 'B', img('C'));
    expect(auto.status).toBe(0);
    expect(auto.out).toContain('deploy=false');
    const manual = decide('workflow_dispatch', 'B', img('C'));
    expect(manual.status).toBe(1);
    expect(manual.out).toContain('deploy=false');
    expect(manual.stdout).toContain('force_older=true');
    expect(manual.summary).toContain('REFUSED');
  });

  it('allows the manual regression only with force_older=true, and records it in the summary', () => {
    const r = decide('workflow_dispatch', 'B', img('C'), { FORCE_OLDER: 'true' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain('deploy=true');
    expect(r.summary).toContain('FORCED (force_older=true)');
    expect(r.summary).toContain('operator');
    const auto = decide('workflow_run', 'B', img('C'), { FORCE_OLDER: 'true' });
    expect(auto.out, 'force_older must not affect automatic deploys').toContain('deploy=false');
  });

  it('only the automatic path skips a commit with no C# change; a manual dispatch deploys it', () => {
    // C changes nothing under services/Tims.Platform relative to B.
    expect(decide('workflow_run', 'C', img('B')).out).toContain('deploy=false');
    expect(decide('workflow_dispatch', 'C', img('B')).out).toContain('deploy=true');
  });

  it('still refuses everything while paused', () => {
    for (const event of BOTH) {
      const paused = decide(event, 'C', img('A'), { AUTODEPLOY_PAUSED: 'true' });
      expect(paused.out, event).toContain('deploy=false');
      expect(paused.summary, event).toContain('PAUSED');
    }
  });
});

describe('deploy-platform-api.yml — the whole deploy job, executed step by step (Codex r4 P2)', () => {
  // ECR is IMMUTABLE (services/Tims.Platform/deploy/terraform/main.tf): pushing an existing tag fails.
  // Two runs that approve the same commit must therefore not both push — the second must reuse the
  // image and reach the preflight's "already live -> skip".
  const steps = () => (parseYaml(WORKFLOW) as { jobs: Record<string, { steps: Step[] }> }).jobs.deploy.steps;

  it('orders the steps: ECR check -> build+push (only when absent) -> preflight+update-service', () => {
    const st = steps();
    const at = (pred: (s: Step) => boolean) => st.findIndex(pred);
    const login = at((s) => String(s.uses ?? '').startsWith('aws-actions/amazon-ecr-login'));
    const check = at((s) => s.id === 'image');
    const build = at((s) => /docker push/.test(s.run ?? ''));
    const update = at((s) => s.id === 'update');
    expect(
      [login, check, build, update].every((i) => i >= 0),
      'a deploy step is missing',
    ).toBe(true);
    expect(login).toBeLessThan(check);
    expect(check).toBeLessThan(build);
    expect(build).toBeLessThan(update);
    expect(st[check].run).toContain('aws ecr describe-images');
    expect(st[check].run).not.toMatch(/docker (build|push)/);
    expect(st[build].if, 'build+push must be conditional on the tag being ABSENT').toBe(
      "steps.image.outputs.exists == 'false'",
    );
    expect(st[build].run).toMatch(/docker build[\s\S]*docker push/);
    // No other step builds or pushes, and no step between the check and update-service is unconditional
    // about pushing.
    expect(st.filter((s) => /docker (build|push)/.test(s.run ?? '')).length).toBe(1);
    expect(st[update].if, 'update must run whether the image was reused or freshly pushed').toBeUndefined();
  });

  // Runs every `run:` step up to and including `update`, in YAML order, honouring each step's `if:`.
  function runJob(decided: C, live: C, target: C, fakeEcr: string) {
    const st = steps();
    const outputs: Record<string, Record<string, string>> = {};
    const env = {
      REGISTRY,
      TAG: short(target),
      DECIDED_IMAGE: img(decided),
      TARGET_SHA: sha[target],
      FAKE_IMAGE: img(live),
      FAKE_ECR: fakeEcr,
      GH_TOKEN: 'x',
    };
    const ran: string[] = [];
    let log = '';
    for (const step of st) {
      if (!step.run) continue;
      if (step.if !== undefined) {
        const m = /^steps\.(\w+)\.outputs\.(\w+) (==|!=) '([^']*)'$/.exec(step.if);
        expect(m, `unrecognised if: ${step.if}`).not.toBeNull();
        const [, id, key, op, val] = m!;
        const got = outputs[id]?.[key] ?? '';
        if ((op === '==') !== (got === val)) continue;
      }
      const r = exec(step.run, env);
      log += r.log;
      ran.push(step.id ?? step.name ?? '?');
      outputs[step.id ?? ''] = Object.fromEntries(
        r.out
          .split('\n')
          .filter(Boolean)
          .map((l) => l.split('=', 2) as [string, string]),
      );
      if (r.status !== 0) return { ok: false, ran, log, outputs, stdout: r.stdout + r.stderr };
      if (step.id === 'update') break;
    }
    return { ok: true, ran, log, outputs, stdout: '' };
  }

  it('the second of two runs for the SAME commit reuses the image and skips — no push, no update', () => {
    // Both runs' decide read B; the first pushed C and deployed it while the second waited for the lock.
    const r = runJob('B', 'C', 'C', 'exists');
    expect(r.ok, r.stdout).toBe(true);
    expect(r.log).not.toContain('docker');
    expect(r.log).not.toContain('update-service');
    expect(r.outputs.update?.skipped).toBe('true');
  });

  it('an existing image that is not yet live is deployed WITHOUT rebuilding or re-pushing it', () => {
    const r = runJob('B', 'B', 'C', 'exists');
    expect(r.ok, r.stdout).toBe(true);
    expect(r.log).not.toContain('docker');
    expect(r.log).toContain('update-service');
  });

  it('an absent image is built and pushed BEFORE update-service', () => {
    const r = runJob('B', 'B', 'C', 'absent');
    expect(r.ok, r.stdout).toBe(true);
    const push = r.log.indexOf('docker push');
    expect(r.log.indexOf('docker build')).toBeGreaterThan(r.log.indexOf('ecr describe-images'));
    expect(push).toBeGreaterThan(r.log.indexOf('docker build'));
    expect(r.log.indexOf('update-service')).toBeGreaterThan(push);
  });

  it('fails CLOSED when ECR cannot be read: an AWS error is never read as "absent"', () => {
    const r = runJob('B', 'B', 'C', 'denied');
    expect(r.ok).toBe(false);
    expect(r.ran.at(-1)).toBe('image');
    expect(r.stdout).toContain('refusing to build or deploy blind');
    expect(r.log).not.toContain('docker');
    expect(r.log).not.toContain('update-service');
  });
});
