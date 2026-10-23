import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── The workers deploy must DECIDE before it BUILDS ─────────────────────────────
//
// The ECR repo `tims-platform-workers` keeps only the last 30 images of ANY tag
// (create-workers-service.sh lifecycle policy). The first version of
// deploy-platform-workers.yml pushed a new image on every green `.NET Platform CI`
// run on main — and .NET CI fires on scripts/**, packages/db/**, package.json and
// pnpm-lock.yaml too — and only AFTER the push decided "no change under the workers
// graph / production is newer, don't roll". So ~30 CI-path merges later the image the
// service was actually running had been expired. The next task replacement (failed
// health check, Fargate retirement, crash restart) or rollback to that tag then fails
// with CannotPullContainerError and the scheduler is silently down.
//
// The invariant pinned here: an image is pushed ONLY when it is about to become the
// running image (a roll), or when a human dispatched the workflow to seed the very
// first image before the service exists. Every push therefore displaces the running
// image by exactly one, so the running image and the last 29 rollback targets are
// always the 30 newest images in the repository.

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/deploy/workers-deploy-decide.sh');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-platform-workers.yml'), 'utf8');

type Inputs = {
  EVENT: string;
  SERVICE_STATUS: string;
  TAG: string;
  RUNNING_TAG: string;
  IMAGE_EXISTS: string;
  RUNNING_IS_NEWER: string;
  GRAPH_CHANGED: string;
  DESIRED_COUNT: string;
  RUNNING_COUNT: string;
  ROLLOUT_STATE: string;
};

function decide(i: Inputs): { status: number | null; out: Record<string, string>; stderr: string } {
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...i },
  });
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(push|roll|reason)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return { status: r.status, out, stderr: r.stderr };
}

const base: Inputs = {
  EVENT: 'workflow_run',
  SERVICE_STATUS: 'ACTIVE',
  TAG: 'bbbbbbb',
  RUNNING_TAG: 'aaaaaaa',
  IMAGE_EXISTS: 'false',
  RUNNING_IS_NEWER: 'false',
  GRAPH_CHANGED: 'true',
  DESIRED_COUNT: '1',
  RUNNING_COUNT: '1',
  ROLLOUT_STATE: 'COMPLETED',
};

/** One step of the workflow's `steps:` list: its raw text. */
function steps(src: string): string[] {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  expect(start, 'workflow has a steps: list').toBeGreaterThan(-1);
  const blocks: string[][] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {6}- /.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  }
  return blocks.map((b) => b.join('\n'));
}

describe('workers deploy — decide before build (ECR retention)', () => {
  it('a normal merge that changes the workers graph pushes AND rolls', () => {
    const r = decide(base);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ push: 'true', roll: 'true' });
  });

  it('rolls without re-pushing an image that is already in ECR', () => {
    expect(decide({ ...base, IMAGE_EXISTS: 'true' }).out).toMatchObject({ push: 'false', roll: 'true' });
  });

  it.each([
    ['no change under the workers project graph', { GRAPH_CHANGED: 'false' }],
    ['production already runs a NEWER commit', { RUNNING_IS_NEWER: 'true' }],
    ['the service already runs this tag, healthy', { RUNNING_TAG: 'bbbbbbb', IMAGE_EXISTS: 'true' }],
    ['the service does not exist yet (automatic run)', { SERVICE_STATUS: 'MISSING' }],
    ['the service is INACTIVE (automatic run)', { SERVICE_STATUS: 'INACTIVE' }],
  ])('does NOT push when it will not roll: %s', (_label, over) => {
    const r = decide({ ...base, ...over });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ push: 'false', roll: 'false' });
    expect(r.out.reason).toBeTruthy();
  });

  it.each([
    ['stopped (desired 0)', { DESIRED_COUNT: '0', RUNNING_COUNT: '0' }],
    ['short of tasks', { DESIRED_COUNT: '1', RUNNING_COUNT: '0' }],
    ['a failed rollout of this tag', { ROLLOUT_STATE: 'FAILED' }],
    ['a rollout of this tag still in progress', { ROLLOUT_STATE: 'IN_PROGRESS' }],
  ])('re-rolls (no push) when the service references this tag but is %s, so the verifier decides', (_label, over) => {
    // Tier-1 review: skipping on the tag alone gave a green run for a stopped service and blocked retrying
    // a failed first deploy of the same tag.
    for (const EVENT of ['workflow_run', 'workflow_dispatch']) {
      const r = decide({
        ...base,
        EVENT,
        RUNNING_TAG: 'bbbbbbb',
        IMAGE_EXISTS: 'true',
        RUNNING_IS_NEWER: 'true',
        GRAPH_CHANGED: 'false',
        ...over,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.out, EVENT).toMatchObject({ push: 'false', roll: 'true' });
      expect(r.out.reason).toMatch(/not healthy/);
    }
  });

  it('a manual dispatch with no service yet seeds the first image (push, no roll)', () => {
    const r = decide({ ...base, EVENT: 'workflow_dispatch', SERVICE_STATUS: 'MISSING' });
    expect(r.out).toMatchObject({ push: 'true', roll: 'false' });
  });

  it('a manual dispatch rolls even when the graph is unchanged or prod is newer (explicit human intent)', () => {
    expect(
      decide({ ...base, EVENT: 'workflow_dispatch', GRAPH_CHANGED: 'false', RUNNING_IS_NEWER: 'true' }).out,
    ).toMatchObject({ push: 'true', roll: 'true' });
  });

  it('an unknown ancestry/diff (running tag not resolvable) rolls rather than silently skipping', () => {
    expect(decide({ ...base, RUNNING_IS_NEWER: 'unknown', GRAPH_CHANGED: 'unknown' }).out).toMatchObject({
      push: 'true',
      roll: 'true',
    });
  });

  it('INVARIANT over every input combination: push implies roll, or a manual seed with no service', () => {
    let checked = 0;
    for (const EVENT of ['workflow_run', 'workflow_dispatch'])
      for (const SERVICE_STATUS of ['ACTIVE', 'MISSING', 'INACTIVE', 'DRAINING'])
        for (const RUNNING_TAG of ['aaaaaaa', 'bbbbbbb', ''])
          for (const IMAGE_EXISTS of ['true', 'false'])
            for (const RUNNING_IS_NEWER of ['true', 'false', 'unknown'])
              for (const GRAPH_CHANGED of ['true', 'false', 'unknown'])
                for (const health of ['healthy', 'stopped']) {
                  const i = {
                    ...base,
                    EVENT,
                    SERVICE_STATUS,
                    RUNNING_TAG,
                    IMAGE_EXISTS,
                    RUNNING_IS_NEWER,
                    GRAPH_CHANGED,
                    ...(health === 'stopped' ? { DESIRED_COUNT: '0', RUNNING_COUNT: '0' } : {}),
                  };
                  const r = decide(i);
                  expect(r.status, `${JSON.stringify(i)}: ${r.stderr}`).toBe(0);
                  expect(['true', 'false']).toContain(r.out.push);
                  expect(['true', 'false']).toContain(r.out.roll);
                  if (r.out.push === 'true') {
                    const seed = EVENT === 'workflow_dispatch' && SERVICE_STATUS !== 'ACTIVE';
                    expect(r.out.roll === 'true' || seed, JSON.stringify(i)).toBe(true);
                  }
                  if (r.out.push === 'true') expect(IMAGE_EXISTS, JSON.stringify(i)).toBe('false');
                  if (r.out.roll === 'true') expect(SERVICE_STATUS).toBe('ACTIVE');
                  checked++;
                }
    expect(checked).toBe(2 * 4 * 3 * 2 * 3 * 3 * 2);
  });

  it('fails closed on a malformed input instead of defaulting to push', () => {
    for (const bad of [
      { IMAGE_EXISTS: 'maybe' },
      { RUNNING_IS_NEWER: '' },
      { GRAPH_CHANGED: 'yes' },
      { EVENT: 'push' },
      { TAG: '' },
      { DESIRED_COUNT: '' },
      { RUNNING_COUNT: 'two' },
      { ROLLOUT_STATE: 'DONE' },
    ]) {
      const r = decide({ ...base, ...bad });
      expect(r.status, JSON.stringify(bad)).not.toBe(0);
      expect(r.out.push, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('the workflow runs the decision BEFORE the build, and gates the push and the roll on it', () => {
    const all = steps(WORKFLOW);
    const decideIdx = all.findIndex((s) => /^\s+id:\s*decide\s*$/m.test(s));
    const pushIdx = all.findIndex((s) => /docker push/.test(s));
    const rollIdx = all.findIndex((s) => /aws ecs update-service/.test(s));
    expect(decideIdx, 'a step with id: decide').toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(rollIdx).toBeGreaterThan(-1);
    expect(decideIdx, 'decide must run before docker push').toBeLessThan(pushIdx);
    expect(all[decideIdx]).toContain('scripts/deploy/workers-deploy-decide.sh');
    expect(all[pushIdx]).toMatch(/^\s+if:\s*steps\.decide\.outputs\.push == 'true'\s*$/m);
    expect(all[rollIdx]).toMatch(/^\s+if:\s*steps\.decide\.outputs\.roll == 'true'\s*$/m);
    // No step between decide and the push may itself push or skip-with-exit after building.
    for (const s of all.slice(0, pushIdx)) expect(s).not.toMatch(/docker (build|push)/);
    // Exactly one push and one registration path.
    expect(all.filter((s) => /docker push/.test(s))).toHaveLength(1);
    expect(all.filter((s) => /aws ecs register-task-definition/.test(s))).toHaveLength(1);
  });

  it('a manual dispatch on an untested main tip says how to recover, and the runbook checks for it first', () => {
    // .NET Platform CI's push trigger is path-filtered, so a web/docs-only merge leaves main's tip without
    // the green push run the dispatch requires. That dead end must be explained where the owner meets it.
    expect(WORKFLOW).toMatch(
      /has no successful push run on main's tip[^\n]*Land a commit that \.NET Platform CI runs on/,
    );
    const runbook = readFileSync(resolve(ROOT, 'docs/runbooks/workers-deploy.md'), 'utf8');
    // Bounded on BOTH sides, and each marker must exist exactly once (a missing end marker would
    // otherwise silently extend the region to end-of-file).
    const fromStep3 = runbook.split('**3. Enable the workflow');
    expect(fromStep3, 'step 3 heading exactly once').toHaveLength(2);
    const parts = fromStep3[1].split('**4. Create the service');
    expect(parts, 'step 4 heading exactly once, after step 3').toHaveLength(2);
    const step3 = parts[0];
    expect(step3).toContain('actions/workflows/dotnet-platform.yml/runs?head_sha=');
    expect(step3).toContain('event=push&status=success');
    // The check must come BEFORE the dispatch it guards.
    expect(step3.indexOf('dotnet-platform.yml/runs?head_sha=')).toBeLessThan(step3.indexOf('gh workflow run'));
  });
});
