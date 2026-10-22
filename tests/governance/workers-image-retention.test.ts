import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { blockAt } from '../helpers/source-blocks';

// ── The running and rollback images must never expire (tier-1 review of the workers deploy) ──
//
// ECR's "keep the last 30" counts by PUSH time. Deciding before building kept idle CI runs from
// pushing, but failed rolls leave newer images behind and a rollback restores an older image without
// refreshing its push time, so the running image could still age out. Every image a deploy rolls onto
// (and, in the workflow, the one it rolls away from) is now tagged `deployed-<tag>`, and the lifecycle
// policy's priority-1 rule selects that prefix, which a lower-priority count rule cannot expire.
//
// And the manual deploy/rollback path trusted `services-stable`, which also returns 0 after a
// circuit-breaker rollback; it printed "runs <tag>" for a deploy that never happened.

const ROOT = resolve(__dirname, '../..');
const PROTECT = resolve(ROOT, 'scripts/deploy/workers-protect-image.sh');
const CREATE = readFileSync(resolve(ROOT, 'scripts/deploy/create-workers-service.sh'), 'utf8');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-platform-workers.yml'), 'utf8');

let fakeBin: string;
beforeAll(() => {
  // A fake `aws` that logs its arguments and answers batch-get-image / put-image from env.
  fakeBin = mkdtempSync(join(tmpdir(), 'fake-aws-ecr-'));
  const aws = join(fakeBin, 'aws');
  writeFileSync(
    aws,
    [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$FAKE_AWS_LOG"',
      'case "$2" in',
      '  batch-get-image) printf "%s" "${FAKE_GET_STDOUT:-}"; exit "${FAKE_GET_EXIT:-0}" ;;',
      '  put-image) printf "%s" "${FAKE_PUT_STDERR:-}" >&2; exit "${FAKE_PUT_EXIT:-0}" ;;',
      'esac',
      'exit 99',
      '',
    ].join('\n'),
  );
  chmodSync(aws, 0o755);
});
afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

const FOUND = JSON.stringify({
  images: [
    {
      imageId: { imageTag: 'abc1234' },
      imageManifest: '{"schemaVersion":2}',
      imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    },
  ],
  failures: [],
});

function protect(tag: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'protect-'));
  const log = join(dir, 'aws.log');
  writeFileSync(log, '');
  try {
    const r = spawnSync('bash', [PROTECT, tag], {
      encoding: 'utf8',
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NODE_ENV: 'test',
        AWS_REGION: 'us-west-2',
        ECR_REPO: 'tims-platform-workers',
        FAKE_AWS_LOG: log,
        ...env,
      },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: readFileSync(log, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('workers-protect-image.sh', () => {
  it('re-tags the image deployed-<tag> with its own manifest and media type', () => {
    const r = protect('abc1234', { FAKE_GET_STDOUT: FOUND });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toMatch(/ecr put-image .*--image-tag deployed-abc1234 /);
    expect(r.calls).toMatch(/--image-manifest-media-type application\/vnd\.docker\.distribution\.manifest\.v2\+json/);
  });

  it('accepts an image that is already protected (idempotent re-deploy or rollback)', () => {
    const r = protect('abc1234', {
      FAKE_GET_STDOUT: FOUND,
      FAKE_PUT_EXIT: '254',
      FAKE_PUT_STDERR: 'An error occurred (ImageAlreadyExistsException) when calling the PutImage operation',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already protected/);
  });

  it('fails loud on any other put-image failure (never reads AccessDenied as protected)', () => {
    const r = protect('abc1234', {
      FAKE_GET_STDOUT: FOUND,
      FAKE_PUT_EXIT: '254',
      FAKE_PUT_STDERR: 'An error occurred (AccessDeniedException) when calling the PutImage operation',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NOT protected/);
  });

  it('fails loud when the image does not exist or cannot be read', () => {
    expect(protect('abc1234', { FAKE_GET_STDOUT: JSON.stringify({ images: [], failures: [{}] }) }).status).toBe(1);
    expect(protect('abc1234', { FAKE_GET_EXIT: '254' }).status).toBe(1);
  });

  it('refuses a tag that is not a short SHA (no tag injection into put-image)', () => {
    const r = protect('abc1234 --force', { FAKE_GET_STDOUT: FOUND });
    expect(r.status).toBe(1);
    expect(r.calls).toBe('');
  });
});

describe('the lifecycle policy never expires a deployed image', () => {
  const m = /--lifecycle-policy-text \\\n\s*'([^']+)'/.exec(CREATE);
  const policy = JSON.parse(m?.[1] ?? '{}') as {
    rules: Array<{ rulePriority: number; selection: Record<string, unknown> }>;
  };

  it('rule 1 selects the deployed- prefix; the 30-image count is the last (lowest-priority) rule', () => {
    const rules = [...policy.rules].sort((a, b) => a.rulePriority - b.rulePriority);
    expect(rules[0]?.selection).toMatchObject({ tagStatus: 'tagged', tagPrefixList: ['deployed-'] });
    expect(rules.at(-1)?.selection).toMatchObject({ tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 30 });
    expect(rules[0]?.selection.countType).toBe('sinceImagePushed');
    expect(Number(rules[0]?.selection.countNumber)).toBeGreaterThanOrEqual(3650);
  });
});

describe('both deploy paths protect before rolling and verify after', () => {
  it('the workflow protects the new and the previous image before update-service', () => {
    const step = blockAt(WORKFLOW, '- name: Roll the service onto the new image', { minLines: 20 });
    const protectNew = step.indexOf('workers-protect-image.sh "$TAG"');
    const protectOld = step.indexOf('workers-protect-image.sh "$RUNNING_TAG"');
    const roll = step.indexOf('aws ecs update-service');
    expect(protectNew).toBeGreaterThan(-1);
    expect(protectOld).toBeGreaterThan(-1);
    expect(protectNew).toBeLessThan(roll);
    expect(protectOld).toBeLessThan(roll);
  });

  it('the manual path protects the image before pointing the service at it', () => {
    const protectAt = CREATE.indexOf('bash "$SCRIPT_DIR/workers-protect-image.sh" "$IMAGE_TAG"');
    expect(protectAt).toBeGreaterThan(-1);
    expect(protectAt).toBeLessThan(CREATE.indexOf('mutate ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition'));
    expect(protectAt).toBeLessThan(CREATE.indexOf('mutate ecs create-service'));
  });

  it('the manual path verifies the registered revision after the waiter and before claiming success', () => {
    const waiter = CREATE.indexOf('ecs wait services-stable');
    const verify = CREATE.indexOf('bash "$SCRIPT_DIR/workers-verify-roll.sh" "$TD_ARN"');
    const success = CREATE.indexOf('ok "service $SERVICE runs $IMAGE_TAG');
    expect(waiter).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(waiter);
    expect(success).toBeGreaterThan(verify);
  });
});
