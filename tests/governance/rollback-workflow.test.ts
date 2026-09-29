import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from './helpers/parse-yaml';

// Pins the properties that make the API rollback safe to press mid-incident (F16). Each assertion is a
// way the workflow could keep existing while becoming dangerous: rolling to a tag that is not in ECR,
// dropping env vars, racing a deploy, or reporting success without checking.

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = join(ROOT, '.github/workflows/rollback-platform-api.yml');

function src(): string {
  expect(existsSync(WORKFLOW), 'The rollback workflow is GONE.').toBe(true);
  return readFileSync(WORKFLOW, 'utf8');
}

describe('Rollback — the platform API rollback workflow', () => {
  it('parses as YAML: manual dispatch only, with REQUIRED tag and reason', () => {
    const doc = parseYaml(WORKFLOW) as {
      on?: Record<string, { inputs?: Record<string, { required?: boolean }> }>;
      true?: Record<string, { inputs?: Record<string, { required?: boolean }> }>;
      jobs: Record<string, unknown>;
    };
    const on = doc.on ?? doc.true; // YAML 1.1 folds a bare `on` key to boolean true
    expect(Object.keys(on ?? {})).toEqual(['workflow_dispatch']);
    expect(on!.workflow_dispatch.inputs?.tag?.required).toBe(true);
    expect(on!.workflow_dispatch.inputs?.reason?.required).toBe(true);
    expect(Object.keys(doc.jobs)).toEqual(['rollback']);
  });

  it('holds the SAME job-level lock as the deploy job — a non-replacing, never-cancelling queue', () => {
    // Codex round 2 (P1): separate groups let a rollback complete between the deploy's preflight and
    // its update-service. Sharing the group serializes them; `queue: max` keeps GitHub from REPLACING
    // a pending rollback with a later deploy (the reason an earlier version used its own group).
    const doc = parseYaml(WORKFLOW) as {
      concurrency?: unknown;
      jobs: Record<string, { concurrency?: unknown }>;
    };
    const deploy = parseYaml(join(ROOT, '.github/workflows/deploy-platform-api.yml')) as {
      jobs: Record<string, { concurrency?: unknown }>;
    };
    expect(doc.concurrency, 'the lock belongs on the job, not the workflow').toBeUndefined();
    expect(doc.jobs.rollback.concurrency).toEqual({
      group: 'platform-api-mutation',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(doc.jobs.rollback.concurrency).toEqual(deploy.jobs.deploy.concurrency);
  });

  it('refuses to start unless deploys are ALREADY paused', () => {
    const s = src();
    const validate = s.split('- name: Validate the inputs')[1]?.split('\n      - ')[0] ?? '';
    expect(validate).toContain('AUTODEPLOY_PAUSED: ${{ vars.PLATFORM_API_AUTODEPLOY_PAUSED }}');
    expect(validate).toMatch(/\[ "\$AUTODEPLOY_PAUSED" = "true" \] \|\| \{[\s\S]*?exit 1/);
    // It must be the first step, before credentials or any AWS call.
    expect(s.indexOf('- name: Validate the inputs')).toBeLessThan(s.indexOf('configure-aws-credentials'));
  });

  it('re-checks the live image right before update-service (optimistic concurrency)', () => {
    const s = src();
    const baseline = s.indexOf('echo "EXPECTED_IMAGE=$IMG" >> "$GITHUB_ENV"');
    const preflight = s.indexOf('bash scripts/deploy/apprunner-preflight.sh "$ARN" "$EXPECTED_IMAGE"');
    const update = s.indexOf('aws apprunner update-service');
    expect(baseline, 'must record the running image at the start').toBeGreaterThan(-1);
    expect(s.indexOf('aws ecr describe-images')).toBeGreaterThan(baseline);
    expect(preflight).toBeGreaterThan(baseline);
    expect(update, 'preflight must run immediately before update-service').toBeGreaterThan(preflight);
    expect(s.slice(preflight, update)).not.toMatch(/describe-service|python3/);
  });

  it('validates the tag shape WITHOUT interpolating the input into the script', () => {
    const s = src();
    expect(s).toContain("grep -Eq '^[0-9a-f]{7,40}$'");
    // `${{ inputs.tag }}` inside a run: block is shell injection; it must only appear in env:.
    const runBlocks = s
      .split(/\n\s+run: \|\n/)
      .slice(1)
      .map((b) => b.split(/\n\s{6}- /)[0]);
    for (const b of runBlocks) expect(b).not.toContain('${{ inputs.');
    expect(s).toContain('TAG: ${{ inputs.tag }}');
  });

  it('refuses a tag that does not exist in ECR BEFORE touching the service', () => {
    const s = src();
    const ecrCheck = s.indexOf('aws ecr describe-images');
    const update = s.indexOf('aws apprunner update-service');
    expect(ecrCheck, 'must look the tag up in ECR').toBeGreaterThan(-1);
    expect(s).toContain('--image-ids imageTag="$TAG"');
    expect(update).toBeGreaterThan(ecrCheck);
    expect(s).toContain('does not exist in $ECR_REPO. Refusing');
    expect(s, 'nothing may be built during a rollback').not.toMatch(/docker (build|push)/);
  });

  it('uses the same image-only guard as the deploy and targets the SAME repository', () => {
    const s = src();
    expect(s).toMatch(/describe-service[^\n]*> live\.json/);
    expect(s).toContain('TO_IMAGE="${FROM_IMAGE%:*}:$TAG"');
    expect(s).toContain('python3 scripts/deploy/apprunner-image-payload.py live.json "$TO_IMAGE" payload.json');
    expect(s).toContain('--source-configuration file://payload.json');
    expect(s, 'must not update a service that is mid-operation').toContain('[ "$STATUS" = "RUNNING" ]');
  });

  it('verifies the result and records it in the job summary', () => {
    const s = src();
    expect(s).toContain('/health');
    expect(s).toMatch(/ENV_AFTER" = "\$ENV_BEFORE/);
    expect(s).toContain('*:"$TAG")');
    expect(s).toContain('GITHUB_STEP_SUMMARY');
    expect(s, 'the summary must tell the operator to pause auto-deploy').toContain('PLATFORM_API_AUTODEPLOY_PAUSED');
  });

  it('uses OIDC federation from main, never a long-lived key', () => {
    const s = src();
    expect(s).toMatch(/id-token:\s*write/);
    expect(s).toContain('role-to-assume: arn:aws:iam::747814092517:role/tims-ats-github-deploy-prod');
    expect(s).toContain('[ "$REF" = "refs/heads/main" ]');
    expect(s).not.toMatch(/AWS_SECRET_ACCESS_KEY|aws_secret_access_key/);
  });
});
