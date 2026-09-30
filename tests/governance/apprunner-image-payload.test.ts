import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Behaviour of the ONE guard both the deploy and the rollback workflows send their App Runner payload
// through. `update-service` drops every env key the payload omits (26 keys, 22 live flags on this
// service), so this script is the difference between "new image" and "every live surface dark".

const SCRIPT = resolve(__dirname, '../../scripts/deploy/apprunner-image-payload.py');
const REPO = '747814092517.dkr.ecr.us-west-2.amazonaws.com/tims-platform-api';

function liveService(env: Record<string, string> = { A: '1', B: '2' }) {
  return {
    Service: {
      Status: 'RUNNING',
      SourceConfiguration: {
        AutoDeploymentsEnabled: false,
        AuthenticationConfiguration: { AccessRoleArn: 'arn:aws:iam::747814092517:role/x' },
        ImageRepository: {
          ImageIdentifier: `${REPO}:a23dbcc`,
          ImageRepositoryType: 'ECR',
          ImageConfiguration: {
            Port: '8080',
            RuntimeEnvironmentVariables: env,
            RuntimeEnvironmentSecrets: { S: 'arn:aws:secretsmanager:us-west-2:747814092517:secret:s' },
          },
        },
      },
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apprunner-payload-'));
});

function run(live: unknown, image: string) {
  writeFileSync(join(dir, 'live.json'), JSON.stringify(live));
  const out = join(dir, 'payload.json');
  const r = spawnSync('python3', [SCRIPT, join(dir, 'live.json'), image, out], { encoding: 'utf8' });
  return { ...r, out };
}

describe('apprunner-image-payload.py', () => {
  it('writes the FULL live configuration with only the image identifier changed', () => {
    const live = liveService();
    const r = run(live, `${REPO}:f21bb8e`);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const payload = JSON.parse(readFileSync(r.out, 'utf8'));
    const expected = structuredClone(live.Service.SourceConfiguration);
    expected.ImageRepository.ImageIdentifier = `${REPO}:f21bb8e`;
    expect(payload).toEqual(expected);
    expect(r.stdout).toContain('CHANGED /ImageRepository/ImageIdentifier');
    expect(r.stdout).toContain('2 env vars, 1 secrets');
  });

  it('refuses when the live config carries zero env vars', () => {
    const r = run(liveService({}), `${REPO}:f21bb8e`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('zero env vars');
    expect(existsSync(r.out)).toBe(false);
  });

  it('refuses a no-op (the service already runs that image)', () => {
    const r = run(liveService(), `${REPO}:a23dbcc`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('already runs this image');
    expect(existsSync(r.out)).toBe(false);
  });

  it('refuses an image from a different repository', () => {
    const r = run(liveService(), '123456789012.dkr.ecr.us-east-1.amazonaws.com/other:f21bb8e');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('differs from the running');
    expect(existsSync(r.out)).toBe(false);
  });

  it('refuses an unreadable live configuration instead of inventing one', () => {
    const r = run({ Service: {} }, `${REPO}:f21bb8e`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Cannot read the live service configuration');
    expect(existsSync(r.out)).toBe(false);
  });
});
