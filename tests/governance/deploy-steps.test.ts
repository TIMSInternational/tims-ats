import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from './helpers/parse-yaml';

// Executes the REAL `run:` bodies of deploy-platform-api.yml (the `decide` job's steps and the WHOLE
// `deploy` job) and of rollback-platform-api.yml (the WHOLE `rollback` job) — in their real step order,
// honouring each step's `if:`, with the real preflight and payload scripts, against a real git history —
// faking only `aws`, `gh`, `docker`, `curl` and `sleep`. The fake `aws` is stateful: update-service
// installs the payload's image, list-operations replays a scripted status sequence for THIS operation
// (next to a decoy operation that always SUCCEEDED), and the live image can move mid-run. The standalone script tests cannot see
// ordering bugs between those scripts (Codex round 3 found one: the payload guard ran BEFORE the
// preflight and made the exit-3 skip unreachable; round 4 found another: an unconditional push of an
// IMMUTABLE tag failed before that skip was reached).

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy-platform-api.yml');
const ROLLBACK = join(ROOT, '.github/workflows/rollback-platform-api.yml');
const OP_ID = '0123456789abcdef0123456789abcdef';
const DECOY_OP = 'ffffffffffffffffffffffffffffffff';
const REGISTRY = '747814092517.dkr.ecr.us-west-2.amazonaws.com';
const REPO_IMG = `${REGISTRY}/tims-platform-api`;
const ARN = 'arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5';
const RUN_ID = '4242';
const RUN_CREATED = '2026-09-29T10:00:00Z';

type Step = { name?: string; id?: string; run?: string; uses?: string; if?: string };
function stepRun(job: string, match: (s: Step) => boolean, workflow = WORKFLOW): string {
  const doc = parseYaml(workflow) as { jobs: Record<string, { steps: Step[] }> };
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
  const tpl = (env: Record<string, string>) =>
    JSON.stringify({
      Service: {
        Status: 'RUNNING',
        ServiceUrl: 'x.awsapprunner.com',
        SourceConfiguration: {
          AutoDeploymentsEnabled: false,
          ImageRepository: {
            ImageIdentifier: '__IMAGE__',
            ImageRepositoryType: 'ECR',
            ImageConfiguration: { Port: '8080', RuntimeEnvironmentVariables: env },
          },
        },
      },
    });
  writeFileSync(join(dir, 'live.tpl.json'), tpl({ A: '1', B: '2' }));
  writeFileSync(join(dir, 'live-dropped.tpl.json'), tpl({ A: '1' }));
  // State lives in st.* files, which (unlike the per-step logs) persist across the steps of one job.
  writeFileSync(
    join(dir, 'aws'),
    `#!/usr/bin/env bash
D="${dir}"
echo "$*" >> "$D/aws.log"
tick() { n=$(cat "$D/st.$1" 2>/dev/null || echo 0); echo $((n+1)) > "$D/st.$1"; echo "$n"; }
nth() { IFS=, read -ra SEQ <<< "$1"; i=$2; [ "$i" -lt "\${#SEQ[@]}" ] || i=$(( \${#SEQ[@]} - 1 )); echo "\${SEQ[$i]}"; }
cur_image() {
  n=$(tick desc)
  if [ -f "$D/st.image" ]; then cat "$D/st.image"
  elif [ -n "\${FAKE_IMAGE_LATER:-}" ] && [ "$n" -ge "\${FAKE_IMAGE_SWITCH_AT:-1}" ]; then echo "$FAKE_IMAGE_LATER"
  else echo "$FAKE_IMAGE"; fi
}
case "$*" in
  *"ecr describe-images"*)
    case "\${FAKE_ECR:-absent}" in
      exists) echo "sha256:$(printf 'a%.0s' $(seq 64))";;
      absent) echo "An error occurred (ImageNotFoundException) when calling the DescribeImages operation" >&2; exit 254;;
      *) echo "An error occurred (AccessDeniedException) when calling the DescribeImages operation" >&2; exit 254;;
    esac;;
  *list-services*) echo "${ARN}";;
  *list-operations*)
    S="$(nth "\${FAKE_OP_STATUSES:-SUCCEEDED}" "$(tick ops)")"
    [ "$S" != ERR ] || { echo "An error occurred (ThrottlingException) when calling the ListOperations operation" >&2; exit 254; }
    printf '{"OperationSummaryList":[{"Id":"%s","Type":"UPDATE_SERVICE","Status":"SUCCEEDED"},{"Id":"%s","Type":"UPDATE_SERVICE","Status":"%s"}]}\\n' "${DECOY_OP}" "${OP_ID}" "$S";;
  *describe-service*"Service.[Status"*) printf 'RUNNING\\t%s\\n' "$(cur_image)";;
  *describe-service*"--query"*) cur_image;;
  *describe-service*)
    T=live.tpl.json; [ -f "$D/st.envdrop" ] && T=live-dropped.tpl.json
    sed "s|__IMAGE__|$(cur_image)|" "$D/$T";;
  *update-service*)
    A="$*"; F="\${A##*file://}"; F="\${F%% *}"
    if [ -n "\${FAKE_POST_UPDATE_IMAGE:-}" ]; then echo "$FAKE_POST_UPDATE_IMAGE" > "$D/st.image"
    else python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["ImageRepository"]["ImageIdentifier"])' "$F" > "$D/st.image"; fi
    [ -z "\${FAKE_POST_UPDATE_ENV_DROP:-}" ] || touch "$D/st.envdrop"
    echo "\${FAKE_OP_ID-${OP_ID}}";;
  *) exit 1;;
esac
`,
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/gh.log"
case "$*" in
  *"workflows/dotnet-platform.yml/runs?"*)
    [ "\${FAKE_CI_RUNS:-1}" != ERR ] || exit 1
    case "$*" in *"head_sha=\${FAKE_CI_SHA:-none}&event=push&status=success&"*) echo "\${FAKE_CI_RUNS:-1}";; *) echo 0;; esac;;
  *"actions/runs/${RUN_ID} "*) echo "${RUN_CREATED}";;
  *"created="*) echo "\${FAKE_ROLLBACKS_CREATED_AFTER:-0}";;
  *"status="*) echo 0;;
  *) exit 1;;
esac
`,
  );
  writeFileSync(
    join(dir, 'curl'),
    `#!/usr/bin/env bash
D="${dir}"
echo "$*" >> "$D/curl.log"
n=$(cat "$D/st.curl" 2>/dev/null || echo 0); echo $((n+1)) > "$D/st.curl"
IFS=, read -ra SEQ <<< "\${FAKE_HTTP:-200}"; i=$n; [ "$i" -lt "\${#SEQ[@]}" ] || i=$(( \${#SEQ[@]} - 1 ))
printf '%s' "\${SEQ[$i]}"
[ "\${SEQ[$i]}" != 000 ] || exit 28
`,
  );
  writeFileSync(join(dir, 'sleep'), `#!/usr/bin/env bash\necho "$*" >> "${dir}/sleep.log"\n`);
  writeFileSync(join(dir, 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${dir}/aws.log"\n`);
  for (const f of ['docker', 'aws', 'gh', 'curl', 'sleep']) chmodSync(join(dir, f), 0o755);
});

function exec(body: string, env: Record<string, string>) {
  for (const f of ['out', 'summary', 'env', 'aws.log', 'curl.log']) writeFileSync(join(dir, f), ''); // fresh per call
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
  return {
    ...r,
    out: read('out'),
    summary: read('summary'),
    githubEnv: read('env'),
    curl: read('curl.log'),
    log: awsLog,
    updated: awsLog.includes('update-service'),
  };
}

// Clears the fake's cross-step state (st.*): one scenario = one job run.
function resetState() {
  for (const f of readdirSync(dir)) if (f.startsWith('st.') || f === 'sleep.log') rmSync(join(dir, f));
}

const kv = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const [key, ...rest] = l.split('=');
        return [key, rest.join('=')] as [string, string];
      }),
  );

// Runs every `run:` step of a job in YAML order, honouring each step's `if:` (only the
// `steps.<id>.outputs.<key> ==|!= '<v>'` shape these workflows use), carrying $GITHUB_ENV writes into
// later steps exactly as the runner does. `uses:` steps (checkout, credentials, ECR login) are skipped.
function runJob(workflow: string, job: string, env: Record<string, string>) {
  resetState();
  const st = (parseYaml(workflow) as { jobs: Record<string, { steps: Step[] }> }).jobs[job].steps;
  const outputs: Record<string, Record<string, string>> = {};
  const carried: Record<string, string> = {};
  const ran: string[] = [];
  let log = '';
  let curl = '';
  let stdout = '';
  let summary = '';
  for (const step of st) {
    if (!step.run) continue;
    if (step.if !== undefined) {
      const m = /^steps\.(\w+)\.outputs\.(\w+) (==|!=) '([^']*)'$/.exec(step.if);
      expect(m, `unrecognised if: ${step.if}`).not.toBeNull();
      const [, id, key, op, val] = m!;
      const got = outputs[id]?.[key] ?? '';
      if ((op === '==') !== (got === val)) continue;
    }
    const r = exec(step.run, { ...env, ...carried });
    log += r.log;
    curl += r.curl;
    stdout += r.stdout + r.stderr;
    summary += r.summary;
    Object.assign(carried, kv(r.githubEnv));
    const name = step.id ?? step.name ?? '?';
    ran.push(name);
    outputs[step.id ?? ''] = kv(r.out);
    if (r.status !== 0) return { ok: false, failed: name, ran, log, curl, outputs, stdout, summary };
  }
  return { ok: true, failed: '', ran, log, curl, outputs, stdout, summary };
}
const sleeps = () =>
  existsSync(join(dir, 'sleep.log'))
    ? readFileSync(join(dir, 'sleep.log'), 'utf8').split('\n').filter(Boolean).length
    : 0;

describe('deploy-platform-api.yml — the update-service step, executed in its real order', () => {
  const body = () => stepRun('deploy', (s) => s.id === 'update');
  const update = (decided: C, live: C, target: C, env: Record<string, string> = {}) => (
    resetState(),
    exec(body(), {
      REGISTRY,
      TAG: short(target),
      DECIDED_IMAGE: img(decided),
      TARGET_SHA: sha[target],
      FAKE_IMAGE: img(live),
      GH_TOKEN: 'x',
      ...env,
    })
  );

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

  const job = (decided: C, live: C, target: C, fakeEcr: string, extra: Record<string, string> = {}) =>
    runJob(WORKFLOW, 'deploy', {
      REGISTRY,
      TAG: short(target),
      DECIDED_IMAGE: img(decided),
      TARGET_SHA: sha[target],
      FAKE_IMAGE: img(live),
      FAKE_ECR: fakeEcr,
      GH_TOKEN: 'x',
      ...extra,
    });

  it('the second of two runs for the SAME commit reuses the image and skips — no push, no update', () => {
    // Both runs' decide read B; the first pushed C and deployed it while the second waited for the lock.
    const r = job('B', 'C', 'C', 'exists');
    expect(r.ok, r.stdout).toBe(true);
    expect(r.log).not.toContain('docker');
    expect(r.log).not.toContain('update-service');
    expect(r.outputs.update?.skipped).toBe('true');
  });

  it('an existing image that is not yet live is deployed WITHOUT rebuilding or re-pushing it', () => {
    const r = job('B', 'B', 'C', 'exists');
    expect(r.ok, r.stdout).toBe(true);
    expect(r.log).not.toContain('docker');
    expect(r.log).toContain('update-service');
    expect(r.ran.slice(-2)).toEqual(['Wait for the rollout', 'Verify the deployment']);
  });

  it('an absent image is built and pushed BEFORE update-service', () => {
    const r = job('B', 'B', 'C', 'absent');
    expect(r.ok, r.stdout).toBe(true);
    const push = r.log.indexOf('docker push');
    expect(r.log.indexOf('docker build')).toBeGreaterThan(r.log.indexOf('ecr describe-images'));
    expect(push).toBeGreaterThan(r.log.indexOf('docker build'));
    expect(r.log.indexOf('update-service')).toBeGreaterThan(push);
  });

  it('fails CLOSED when ECR cannot be read: an AWS error is never read as "absent"', () => {
    const r = job('B', 'B', 'C', 'denied');
    expect(r.ok).toBe(false);
    expect(r.ran.at(-1)).toBe('image');
    expect(r.stdout).toContain('refusing to build or deploy blind');
    expect(r.log).not.toContain('docker');
    expect(r.log).not.toContain('update-service');
  });
});

// ── Wait + Verify, executed, for BOTH mutation paths (tier-3 panel finding 1–3, 2026-09-29) ───────────
// App Runner rolls a failed rollout back by itself and the service returns to RUNNING on the OLD
// image. The fake keeps Service.Status RUNNING throughout, so only a wait that follows THIS
// operation's outcome can fail these scenarios.
const PATHS = [
  {
    name: 'deploy-platform-api.yml (deploy job)',
    run: (extra: Record<string, string> = {}) =>
      runJob(WORKFLOW, 'deploy', {
        REGISTRY,
        TAG: short('C'),
        DECIDED_IMAGE: img('B'),
        TARGET_SHA: sha.C,
        FAKE_IMAGE: img('B'),
        FAKE_ECR: 'exists',
        GH_TOKEN: 'x',
        ...extra,
      }),
    target: () => short('C'),
    verifyStep: 'Verify the deployment',
  },
  {
    name: 'rollback-platform-api.yml (rollback job)',
    run: (extra: Record<string, string> = {}) =>
      runJob(ROLLBACK, 'rollback', {
        TAG: short('A'),
        REASON: '5xx spike',
        REF: 'refs/heads/main',
        AUTODEPLOY_PAUSED: 'true',
        FAKE_IMAGE: img('C'),
        FAKE_ECR: 'exists',
        ...extra,
      }),
    target: () => short('A'),
    verifyStep: 'Verify the rollback',
  },
];

describe.each(PATHS)('$name — waits for ITS operation, then verifies /ready', ({ run, target, verifyStep }) => {
  it('succeeds only after THIS operation reports SUCCEEDED, and records it', () => {
    const r = run({ FAKE_OP_STATUSES: 'PENDING,IN_PROGRESS,SUCCEEDED' });
    expect(r.ok, r.stdout).toBe(true);
    expect(r.ran.at(-1)).toBe(verifyStep);
    expect(r.log).toContain('list-operations');
    expect(r.stdout).toContain(`operation ${OP_ID}: SUCCEEDED`);
    expect(r.summary).toContain(`\`${OP_ID}\` SUCCEEDED`);
    expect(r.summary).toContain(target());
    expect(sleeps()).toBe(3);
  });

  it.each(['FAILED', 'ROLLBACK_SUCCEEDED', 'ROLLBACK_IN_PROGRESS', 'ROLLBACK_FAILED'])(
    'fails on operation %s even though the service reads RUNNING (and a decoy op SUCCEEDED)',
    (status) => {
      const r = run({ FAKE_OP_STATUSES: `IN_PROGRESS,${status}` });
      expect(r.ok).toBe(false);
      expect(r.failed).toBe('Wait for the rollout');
      expect(r.stdout).toContain(`ended ${status}`);
      expect(r.curl, 'must not probe after a failed operation').toBe('');
    },
  );

  it('fails CLOSED on a timeout: 60 bounded polls, then an error', () => {
    const r = run({ FAKE_OP_STATUSES: 'IN_PROGRESS' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe('Wait for the rollout');
    expect(r.stdout).toContain('Timed out');
    expect(sleeps()).toBe(60);
  });

  it('retries a failed list-operations call instead of reading it as an outcome', () => {
    const r = run({ FAKE_OP_STATUSES: 'ERR,ERR,SUCCEEDED' });
    expect(r.ok, r.stdout).toBe(true);
    expect(r.stdout).toContain('list-operations failed');
  });

  it('refuses an update-service call that returned no usable OperationId', () => {
    const r = run({ FAKE_OP_ID: 'None' });
    expect(r.ok).toBe(false);
    expect(r.stdout).toContain('no usable OperationId');
    expect(r.log).not.toContain('list-operations');
  });

  it('fails when the configured image is not the target after the operation', () => {
    const r = run({ FAKE_POST_UPDATE_IMAGE: `${REPO_IMG}:0000000` });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(verifyStep);
    expect(r.stdout).toContain('Running image is not');
  });

  it('fails when the env-var count changed across the update', () => {
    const r = run({ FAKE_POST_UPDATE_ENV_DROP: '1' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(verifyStep);
    expect(r.stdout).toContain('env var count changed: 2 -> 1');
  });

  it.each(['500', '503', '000'])(
    'fails when GET /ready keeps answering %s (bounded: 5 probes, each --max-time)',
    (code) => {
      const r = run({ FAKE_HTTP: code });
      expect(r.ok).toBe(false);
      expect(r.failed).toBe(verifyStep);
      expect(r.stdout).toContain(`/ready returned ${code}`);
      const probes = r.curl.split('\n').filter(Boolean);
      expect(probes).toHaveLength(5);
      for (const p of probes) {
        expect(p).toContain('--max-time');
        expect(p).toMatch(/https:\/\/x\.awsapprunner\.com\/ready$/);
      }
    },
  );

  it('a transient /ready failure is retried, then passes', () => {
    const r = run({ FAKE_HTTP: '000,503,200' });
    expect(r.ok, r.stdout).toBe(true);
    expect(r.curl.split('\n').filter(Boolean)).toHaveLength(3);
  });
});

describe('rollback-platform-api.yml — the whole rollback job, executed: refusals before update-service', () => {
  const rollback = PATHS[1].run;

  it('refuses to start while deploys are NOT paused — before any AWS call', () => {
    for (const paused of ['', 'false']) {
      const r = rollback({ AUTODEPLOY_PAUSED: paused });
      expect(r.ok).toBe(false);
      expect(r.failed).toBe('Validate the inputs');
      expect(r.log).toBe('');
    }
  });

  it('refuses a blank reason, a non-SHA tag and a non-main ref', () => {
    expect(rollback({ REASON: '   ' }).failed).toBe('Validate the inputs');
    expect(rollback({ TAG: 'latest' }).failed).toBe('Validate the inputs');
    expect(rollback({ REF: 'refs/heads/feature' }).failed).toBe('Validate the inputs');
  });

  it('an ABSENT tag: refuses, says it does not exist, lists recent tags, never updates', () => {
    const r = rollback({ FAKE_ECR: 'absent' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe('Refuse a tag that does not exist in ECR');
    expect(r.stdout).toContain('does not exist in tims-platform-api');
    expect(r.log).not.toContain('update-service');
  });

  it('an UNREADABLE registry (AccessDenied): refuses, and does NOT call the tag missing', () => {
    const r = rollback({ FAKE_ECR: 'denied' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe('Refuse a tag that does not exist in ECR');
    expect(r.stdout).toContain('Cannot read tims-platform-api');
    expect(r.stdout).not.toContain('does not exist in');
    expect(r.log).not.toContain('update-service');
  });

  it('refuses when the live image changed after the run recorded it (a deploy landed mid-run)', () => {
    const r = rollback({ FAKE_IMAGE_LATER: img('B'), FAKE_IMAGE_SWITCH_AT: '1' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe('Re-point the service, preserving the full configuration');
    expect(r.stdout).toContain('live image changed since it was read');
    expect(r.log).not.toContain('update-service');
  });
});

describe('deploy-platform-api.yml — a manual dispatch cannot bypass the .NET tests (panel finding 4)', () => {
  const body = () => stepRun('decide', (s) => s.id === 'target');
  const target = (env: Record<string, string>) => (
    resetState(),
    exec(body(), {
      EVENT: 'workflow_dispatch',
      DISPATCH_SHA: sha.C,
      DISPATCH_REF: 'refs/heads/main',
      TESTED_SHA: '',
      REASON: 'hotfix',
      GH_TOKEN: 'x',
      FAKE_CI_SHA: sha.C,
      ...env,
    })
  );

  it('deploys a commit with a successful PUSH-triggered .NET Platform CI run on that exact SHA', () => {
    const r = target({});
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain(`sha=${sha.C}`);
    const q = readFileSync(join(dir, 'gh.log'), 'utf8');
    expect(q).toContain(`dotnet-platform.yml/runs?head_sha=${sha.C}&event=push&status=success&`);
  });

  it('refuses when there is no such run, when the query fails, or when it returns garbage', () => {
    const cases: Record<string, string>[] = [
      { FAKE_CI_RUNS: '0' },
      { FAKE_CI_RUNS: 'ERR' },
      { FAKE_CI_RUNS: 'null' },
      { FAKE_CI_SHA: sha.B }, // a successful run exists, but on a DIFFERENT commit
    ];
    for (const env of cases) {
      const r = target(env);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.out, JSON.stringify(env)).not.toContain('sha=');
    }
  });

  it('refuses a blank or whitespace-only reason', () => {
    for (const reason of ['', '  \t ']) {
      const r = target({ REASON: reason });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('non-blank reason');
    }
  });

  it('the automatic path is gated by workflow_run itself and makes no extra CI query', () => {
    const r = target({ EVENT: 'workflow_run', TESTED_SHA: sha.C, DISPATCH_SHA: '', REASON: '', FAKE_CI_RUNS: 'ERR' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.out).toContain(`sha=${sha.C}`);
  });
});
