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
