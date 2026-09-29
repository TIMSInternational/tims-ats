import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseYaml } from './helpers/parse-yaml';

// THE CD TRIPWIRE — pins the properties that make continuous deployment actually continuous.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// On 2026-08-31 production was found running an image built 34 days and 242 commits earlier, with 45
// undeployed commits touching the C# service. The mechanical cause was one missing verb:
// `dotnet-platform.yml` runs `docker build` to verify the image, and nothing ever pushed it.
// `deploy-platform-api.yml` is the fix. This file exists so the fix cannot quietly rot back.
//
// Every assertion below corresponds to a specific way the workflow could keep existing while
// silently ceasing to do its job — the failure mode that produced the incident in the first place.
// Deleting an assertion because it is inconvenient is how a tripwire becomes decorative; the repo
// already has `surveys-no-ts-writers.test.ts` as a monument to a claim nothing executable pinned.

const ROOT = join(__dirname, '..', '..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy-platform-api.yml');

function src(): string {
  expect(existsSync(WORKFLOW), 'The deploy workflow is GONE. Production stops receiving merged C#.').toBe(true);
  return readFileSync(WORKFLOW, 'utf8');
}

describe('CD — the platform API deploy workflow', () => {
  it('deploys merges to main that touch the C# service — AFTER the .NET tests pass (F16)', () => {
    const s = src();
    expect(s, 'workflow must declare triggers').toMatch(/^on:\s*$/m);
    expect(s, 'must trigger on the main branch').toMatch(/branches:\s*\[main\]/);
    expect(s, 'must run after .NET Platform CI, not in parallel with it').toMatch(/workflow_run:/);
    const dotnet = readFileSync(join(ROOT, '.github/workflows/dotnet-platform.yml'), 'utf8');
    const dotnetPush = dotnet.split('\n  push:\n')[1]?.split('\n  pull_request:')[0] ?? '';
    expect(
      dotnetPush,
      'the .NET CI push trigger must watch services/Tims.Platform — without it, C# merges deploy ' +
        'nothing, which is precisely the 2026-08-31 state.',
    ).toContain('services/Tims.Platform/**');
    expect(dotnetPush, 'an edit to this deploy workflow must still reach a gated deploy run').toContain(
      '.github/workflows/deploy-platform-api.yml',
    );
    expect(
      s,
      'the decision must diff services/Tims.Platform against the running image, so a CI run caused ' +
        'only by packages/db or scripts/** does not redeploy an unchanged API',
    ).toMatch(/git diff --quiet "\$RUNNING_SHA" "\$SHA" --\s*\\\s*\n\s*services\/Tims\.Platform/);
  });

  it('refuses anything but a SUCCESSFUL push-triggered .NET run on main of this repository', () => {
    const s = src();
    const gate = s.split('\n  decide:\n')[1]?.split('\n    outputs:')[0] ?? '';
    expect(gate, 'the decide job must carry a job-level if:').toMatch(/if: >-/);
    // Each clause closes a distinct hole: a failed/cancelled test run; a pull_request run (whose head
    // branch can be named `main` in a fork — `branches: [main]` alone matches it); a fork's code.
    expect(gate).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(gate).toContain("github.event.workflow_run.event == 'push'");
    expect(gate).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(gate).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(s, 'the deploy job must wait for and obey the decision').toMatch(
      /needs: decide\n\s+if: needs\.decide\.outputs\.deploy == 'true'/,
    );
  });

  it('builds the exact commit the tests passed on, and never deploys an OLDER commit over a newer one', () => {
    const s = src();
    expect(s, 'tested SHA must come from the workflow_run payload').toContain('github.event.workflow_run.head_sha');
    expect(s, 'deploy checkout must pin the decided SHA').toMatch(/ref: \$\{\{ needs\.decide\.outputs\.sha \}\}/);
    expect(s, 'the SHA must be on main').toContain('git merge-base --is-ancestor "$SHA" origin/main');
    expect(s, 'out-of-order CI completions must not roll production back').toContain(
      'git merge-base --is-ancestor "$SHA" "$RUNNING_SHA"',
    );
    expect(s, 'the post-rollback pause must be honoured').toContain('vars.PLATFORM_API_AUTODEPLOY_PAUSED');
  });

  it('keeps the manual dispatch, with a REQUIRED reason, restricted to main', () => {
    const s = src();
    const dispatch = s.split('workflow_dispatch:\n')[1]?.split('\n\n')[0] ?? '';
    expect(dispatch).toMatch(/reason:\s*\n\s+description:[^\n]*\n\s+required: true/);
    expect(s).toContain('[ "$DISPATCH_REF" = "refs/heads/main" ]');
  });

  it('parses as YAML with the expected jobs', () => {
    const doc = parseYaml(WORKFLOW) as {
      on?: Record<string, unknown>;
      true?: Record<string, unknown>;
      jobs: Record<string, unknown>;
    };
    const on = doc.on ?? doc.true; // YAML 1.1 folds a bare `on` key to boolean true
    expect(Object.keys(on ?? {}).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    expect(Object.keys(doc.jobs).sort()).toEqual(['decide', 'deploy']);
  });

  it('PUSHES the image — the single verb whose absence caused the incident', () => {
    const s = src();
    expect(
      s,
      'No `docker push`. dotnet-platform.yml already BUILDS the image and discards it; a deploy ' +
        'workflow that only builds reproduces the original failure exactly.',
    ).toMatch(/docker push/);
    expect(s, 'must push to ECR').toMatch(/ECR_REPO|amazon-ecr-login/);
  });

  it('tags the image with the commit SHA, never a floating tag', () => {
    const s = src();
    // check-deploy-freshness.sh (/gate check 21) resolves the RUNNING image tag back to a commit to
    // compute drift. A floating `:latest` or `:main` tag makes the running image unattributable, so
    // that gate would exit 2 forever — a silent loss of the backstop, caused by an innocuous edit here.
    expect(s, 'must derive a short SHA for the tag').toMatch(/rev-parse --short/);
    expect(
      s.match(/docker push[^\n]*/)?.[0] ?? '',
      'the pushed tag must be the SHA output, not a literal floating tag',
    ).toMatch(/\$TAG|\$\{\{\s*steps\.sha/);
    expect(s, "a floating tag would break the freshness gate's tag-to-commit mapping").not.toMatch(
      /docker push[^\n]*:(latest|main)\s*$/m,
    );
  });

  it('never cancels a deploy in flight', () => {
    const s = src();
    // `cancel-in-progress: true` is right for CI and wrong here: it aborts a rolling App Runner
    // deployment partway and can leave the service in an operation state that blocks the next run.
    expect(s, 'must declare a concurrency group').toMatch(/concurrency:/);
    expect(s, 'cancel-in-progress MUST be false for a deploy').toMatch(/cancel-in-progress:\s*false/);
  });

  it('refuses to apply a source-configuration that changes more than the image', () => {
    const s = src();
    // App Runner's update-service takes a FULL map and DROPS every env key omitted from it. On this
    // service that is 26 keys and 22 live flags — a partial map takes ~13 production surfaces dark.
    // The workflow derives its payload from the live config and asserts a single-field diff, via the
    // shared guard whose behaviour is pinned in apprunner-image-payload.test.ts.
    expect(s, 'the payload must be built from the LIVE config (describe-service), not hand-written').toMatch(
      /describe-service[^\n]*> live\.json/,
    );
    expect(
      s,
      'must build the payload through the shared single-field guard — without it, a refactor here can ' +
        'silently darken every live surface',
    ).toMatch(/python3 scripts\/deploy\/apprunner-image-payload\.py live\.json "[^"]+" payload\.json/);
    expect(s, 'update-service must send the guarded payload and nothing else').toContain(
      '--source-configuration file://payload.json',
    );
    expect(readFileSync(join(ROOT, 'scripts/deploy/apprunner-image-payload.py'), 'utf8')).toContain(
      'CHANGED /ImageRepository/ImageIdentifier',
    );
  });

  it('uses OIDC federation, never a long-lived access key', () => {
    const s = src();
    expect(s, 'must request an OIDC token').toMatch(/id-token:\s*write/);
    expect(s, 'must assume a role').toMatch(/role-to-assume/);
    expect(s, 'no static AWS credentials may appear — this repo has none and must never grow any').not.toMatch(
      /AWS_SECRET_ACCESS_KEY|aws_secret_access_key/,
    );
  });

  it('verifies the deployment instead of assuming it worked', () => {
    const s = src();
    expect(s, 'must health-check after deploying').toMatch(/\/health/);
    expect(s, 'must confirm the env var count survived — the partial-map failure is silent otherwise').toMatch(
      /ENV_AFTER|ENV_BEFORE/,
    );
  });
});
