import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const script = resolve(__dirname, '../../scripts/deploy/github-oidc-trust.py');
const prefix = 'repo:TIMSInternational@305569681/tims-ats@1301900745';
const valid = { use_default: true, use_immutable_subject: true, sub_claim_prefix: prefix };
function build(input: string) {
  return spawnSync('python3', [script], { input, encoding: 'utf8' });
}

describe('TIMS GitHub deploy trust', () => {
  it('trusts only the verified immutable repository identity on main', () => {
    const result = build(JSON.stringify(valid));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Federated: 'arn:aws:iam::747814092517:oidc-provider/token.actions.githubusercontent.com' },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: { StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${prefix}:ref:refs/heads/main`,
        } },
      }],
    });
  });

  it('passes only the existing ECR access role to the App Runner control service', () => {
    const bootstrap = readFileSync(resolve(__dirname, '../../scripts/deploy/bootstrap-github-oidc-role.sh'), 'utf8');
    const template = bootstrap.match(/PERMS="\$\(cat <<JSON\n([\s\S]*?)\nJSON/);
    expect(template).not.toBeNull();
    const policy = JSON.parse(template![1]);
    expect(policy.Statement).toContainEqual({
      Sid: 'AppRunnerPullsEcrAsThisRole',
      Effect: 'Allow',
      Action: 'iam:PassRole',
      Resource: '${ECR_ACCESS_ROLE}',
      Condition: { StringEquals: { 'iam:PassedToService': 'bullet.amazonaws.com' } },
    });
  });

  it('grants every AWS API the deploy and rollback workflows call (and the preflight they run)', () => {
    // A call the role cannot make fails only in production, mid-deploy or mid-rollback. Derive the
    // required actions from the scripts themselves, so a new `aws apprunner|ecr <verb>` cannot land
    // without its IAM grant.
    const bootstrap = readFileSync(resolve(__dirname, '../../scripts/deploy/bootstrap-github-oidc-role.sh'), 'utf8');
    const policy = JSON.parse(bootstrap.match(/PERMS="\$\(cat <<JSON\n([\s\S]*?)\nJSON/)![1]) as {
      Statement: { Action: string | string[] }[];
    };
    const granted = new Set(policy.Statement.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])));
    const sources = [
      '../../.github/workflows/deploy-platform-api.yml',
      '../../.github/workflows/rollback-platform-api.yml',
      '../../scripts/deploy/apprunner-preflight.sh',
    ].map((p) => readFileSync(resolve(__dirname, p), 'utf8'));
    const pascal = (verb: string) => verb.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());
    const needed = new Set<string>();
    for (const src of sources)
      for (const m of src.matchAll(/\baws (apprunner|ecr) ([a-z-]+)/g)) needed.add(`${m[1]}:${pascal(m[2])}`);
    expect([...needed].sort()).toEqual(
      expect.arrayContaining(['apprunner:ListOperations', 'apprunner:UpdateService', 'ecr:DescribeImages']),
    );
    for (const action of needed) expect(granted, `deploy role lacks ${action}`).toContain(action);
  });

  it('grants every AWS API the workers deploy workflow calls, scoped to the workers resources', () => {
    // Same derivation as above for deploy-platform-workers.yml (`aws ecr|ecs <verb>`): a verb the role
    // cannot call would fail only in production, mid-rollout.
    const bootstrap = readFileSync(resolve(__dirname, '../../scripts/deploy/bootstrap-github-oidc-role.sh'), 'utf8');
    const policy = JSON.parse(bootstrap.match(/PERMS="\$\(cat <<JSON\n([\s\S]*?)\nJSON/)![1]) as {
      Statement: { Sid: string; Action: string | string[]; Resource: string | string[]; Condition?: unknown }[];
    };
    const granted = new Set(policy.Statement.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])));
    const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/deploy-platform-workers.yml'), 'utf8');
    const pascal = (verb: string) => verb.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());
    const needed = new Set<string>();
    for (const m of workflow.matchAll(/\baws (ecr|ecs) ([a-z-]+)/g)) {
      // `aws ecs wait services-stable` is a client-side poll over DescribeServices.
      needed.add(m[2] === 'wait' ? 'ecs:DescribeServices' : `${m[1]}:${pascal(m[2])}`);
    }
    expect([...needed].sort()).toEqual(
      expect.arrayContaining(['ecr:DescribeImages', 'ecs:RegisterTaskDefinition', 'ecs:UpdateService']),
    );
    for (const action of needed) expect(granted, `deploy role lacks ${action}`).toContain(action);

    const update = policy.Statement.find((s) => s.Sid === 'UpdateOnlyTheWorkersService');
    expect(update?.Resource).toBe('arn:aws:ecs:${REGION}:${ACCOUNT}:service/${WORKERS_CLUSTER}/${WORKERS_SERVICE}');
    expect(policy.Statement.find((s) => s.Sid === 'EcsRunsTheWorkersTaskAsTheseRoles')).toEqual({
      Sid: 'EcsRunsTheWorkersTaskAsTheseRoles',
      Effect: 'Allow',
      Action: 'iam:PassRole',
      Resource: ['${WORKERS_EXECUTION_ROLE}', '${WORKERS_TASK_ROLE}'],
      Condition: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
    });
    expect(workflow, 'the workers workflow must assume the same OIDC deploy role').toContain(
      'role-to-assume: arn:aws:iam::747814092517:role/tims-ats-github-deploy-prod',
    );
    expect(workflow, 'the workers workflow must stay inert until the owner enables it').toContain(
      "vars.PLATFORM_WORKERS_DEPLOY_ENABLED == 'true'",
    );
  });

  it.each([
    JSON.stringify({ ...valid, use_immutable_subject: false }),
    JSON.stringify({ ...valid, use_default: false }),
    JSON.stringify({ ...valid, sub_claim_prefix: 'repo:TIMSInternational/tims-ats' }),
    JSON.stringify({ ...valid, sub_claim_prefix: `${prefix}-another-repository` }),
    '{}',
    'null',
    'invalid json',
  ])('produces no policy for unverified settings: %s', (input) => {
    const result = build(input);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no trust policy produced');
  });
});
