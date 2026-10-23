import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── A manual roll or rollback must never shrink the workers execution role ─────
//
// create-workers-service.sh --apply runs on every manual roll and rollback, and used to replace the role's
// inline policy with the DB-only baseline. An owner who had added a grant (an HRIS secret, a KMS key) lost
// it on the next rollback while the task definition still referenced the secret, so replacement tasks
// failed secret injection (tier-1 review). scripts/deploy/workers-exec-policy.py merges instead.

const ROOT = resolve(__dirname, '../..');
const HELPER = resolve(ROOT, 'scripts/deploy/workers-exec-policy.py');
const CREATE = readFileSync(resolve(ROOT, 'scripts/deploy/create-workers-service.sh'), 'utf8');
const DB = 'arn:aws:secretsmanager:us-west-2:747814092517:secret:tims-platform-api/DatabaseConnectionString-AbCdEf';
const HRIS = 'arn:aws:secretsmanager:us-west-2:747814092517:secret:workers/hris-XyZ123';
const ARGS = ['us-west-2', '747814092517', 'tims-platform-workers', '/ecs/tims-platform-workers', DB];

type Statement = { Sid?: string; Action: string | string[]; Resource: string | string[] };
type Policy = { Version: string; Statement: Statement[] };

function build(live?: unknown): { status: number | null; stderr: string; policy?: Policy } {
  const dir = mkdtempSync(join(tmpdir(), 'exec-policy-'));
  try {
    const args = [...ARGS];
    if (live !== undefined) {
      writeFileSync(join(dir, 'live.json'), JSON.stringify(live));
      args.push(join(dir, 'live.json'));
    }
    const r = spawnSync('python3', ['-I', HELPER, ...args], { encoding: 'utf8' });
    return {
      status: r.status,
      stderr: r.stderr,
      policy: r.status === 0 ? (JSON.parse(r.stdout) as Policy) : undefined,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sid = (p: Policy | undefined, id: string) => p?.Statement.find((s) => s.Sid === id);

describe('workers execution role policy', () => {
  it('with no live policy (first creation) is the DB-only baseline', () => {
    const r = build();
    expect(r.status, r.stderr).toBe(0);
    expect(sid(r.policy, 'InjectOnlyTheDbConnectionString')?.Resource).toBe(DB);
    expect(r.policy?.Statement).toHaveLength(4);
  });

  it('keeps every secret the live policy allowed, and every statement that is not ours, verbatim', () => {
    const kms = {
      Sid: 'DecryptHrisSecret',
      Effect: 'Allow',
      Action: 'kms:Decrypt',
      Resource: 'arn:aws:kms:us-west-2:747814092517:key/k',
    };
    const live = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'InjectOnlyTheDbConnectionString',
          Effect: 'Allow',
          Action: 'secretsmanager:GetSecretValue',
          Resource: [DB, HRIS],
        },
        kms,
      ],
    };
    const r = build(live);
    expect(r.status, r.stderr).toBe(0);
    expect(sid(r.policy, 'InjectOnlyTheDbConnectionString')?.Resource).toEqual([DB, HRIS]);
    expect(sid(r.policy, 'DecryptHrisSecret')).toEqual(kms);
  });

  it('a live policy without the DB secret gets it back (the baseline is always granted)', () => {
    const live = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'InjectOnlyTheDbConnectionString',
          Effect: 'Allow',
          Action: 'secretsmanager:GetSecretValue',
          Resource: HRIS,
        },
      ],
    };
    expect(sid(build(live).policy, 'InjectOnlyTheDbConnectionString')?.Resource).toEqual([DB, HRIS]);
  });

  it('refuses a live document that is not a policy', () => {
    expect(build({ nope: true }).status).toBe(1);
  });

  it('create-workers-service.sh builds the policy from the live one, and never overwrites it blind', () => {
    const read = CREATE.indexOf('iam get-role-policy --role-name "$EXECUTION_ROLE"');
    const helper = CREATE.indexOf('python3 "$SCRIPT_DIR/workers-exec-policy.py"');
    const put = CREATE.indexOf('mutate iam put-role-policy --role-name "$EXECUTION_ROLE"');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(helper);
    expect(helper).toBeLessThan(put);
    expect(CREATE).toContain('refusing to overwrite it blind');
    expect(CREATE).not.toContain('"Sid": "InjectOnlyTheDbConnectionString"');
  });
});
