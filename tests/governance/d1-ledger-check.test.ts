import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml } from './helpers/parse-yaml';

/**
 * D-1 ledger check: a PR labelled `d1-exception` must name the C# port issue it is paying into.
 *
 * WHY. The survival rule says no new feature code goes into `packages/api`, because that package is
 * scheduled for deletion and anything added there is paid for twice. Owner decision D-1 (2026-10-28)
 * allows a narrow exception for the launch spine and security fixes. An exception without a ledger
 * entry is how a narrow exception stops being narrow: nobody can later find the TS code that the
 * port issue now also has to carry. This check makes the ledger entry mandatory.
 *
 * CONTRACT (what the script must do, tested below by running it):
 *   - Inputs come ONLY through env vars, never interpolated into the script:
 *       PR_LABELS_JSON  `toJSON(github.event.pull_request.labels.*.name)`, e.g. ["bug","d1-exception"]
 *       BODY            the PR body
 *   - No `d1-exception` label: exit 0 (not applicable).
 *   - Labelled: the body must carry a line `Port-issue: #NN` (or the full issue URL in this repo),
 *     where NN is a port issue: #74-#101, plus #250 (the external.ts port, filed after the range was
 *     drawn). Anything else: `::error::` and exit 1.
 *   - A prose mention ("see #90") does NOT count. A structured line mirrors the `Verification-waiver:`
 *     shape and cannot be satisfied by an unrelated reference.
 *
 * WHAT THIS CANNOT PROVE: the workflow runs the script from the PR's own checkout, so a PR can edit the
 * script to always pass. That is the same exposure every in-repo check has (verification-gate included);
 * review of `scripts/ci/` changes carries that load.
 */

const ROOT = join(__dirname, '..', '..');
const SCRIPT_REL = 'scripts/ci/check-d1-ledger.sh';
const SCRIPT = join(ROOT, SCRIPT_REL);
const WORKFLOW_REL = '.github/workflows/d1-ledger.yml';
const WORKFLOW = join(ROOT, WORKFLOW_REL);
const LABEL = 'd1-exception';
const REPO_ISSUES = 'https://github.com/TIMSInternational/tims-ats/issues';

function run(labels: string[] | string, body: string) {
  const labelsJson = typeof labels === 'string' ? labels : JSON.stringify(labels);
  const res = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NODE_ENV: 'test',
      PR_LABELS_JSON: labelsJson,
      BODY: body,
    },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('check-d1-ledger.sh — exists and is runnable', () => {
  it('the script is committed and executable', () => {
    expect(existsSync(SCRIPT), `${SCRIPT_REL} must exist`).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111, `${SCRIPT_REL} must be executable`).not.toBe(0);
  });
});

describe('check-d1-ledger.sh — mutation proof', () => {
  it('no d1-exception label: passes even with no port issue (not applicable)', () => {
    const r = run(['bug', 'security'], 'A body with no ledger line.');
    expect(r.status, r.out).toBe(0);
  });

  it('empty label list: passes', () => {
    expect(run([], '').status).toBe(0);
  });

  it('labelled, body has NO port-issue link: FAILS with ::error::', () => {
    const r = run([LABEL], '## Summary\nFix the thing in packages/api.\n\n## Verification\n- [x] vitest');
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('::error::');
  });

  it('labelled, empty body: FAILS', () => {
    expect(run([LABEL], '').status).toBe(1);
  });

  it('labelled among other labels: still enforced', () => {
    expect(run(['bug', LABEL, 'launch'], 'no ledger line').status).toBe(1);
  });

  it('labelled, body WITH `Port-issue: #90`: passes', () => {
    const r = run([LABEL], `## Summary\nMinimal fix.\n\nPort-issue: #90\n`);
    expect(r.status, r.out).toBe(0);
  });

  it.each(['#74', '#101', '#250'])('labelled, range edge %s: passes', (ref) => {
    expect(run([LABEL], `Port-issue: ${ref}`).status).toBe(0);
  });

  it('labelled, full issue URL in this repo: passes', () => {
    expect(run([LABEL], `Port-issue: ${REPO_ISSUES}/88`).status).toBe(0);
  });

  it('labelled, leading whitespace and lower-case key: passes', () => {
    expect(run([LABEL], '  port-issue:   #77').status).toBe(0);
  });

  it.each(['#074', '#090', '#0250'])('labelled, leading zero %s is read as base 10 (not octal): passes', (ref) => {
    const r = run([LABEL], `Port-issue: ${ref}`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`port issue #${Number(ref.slice(1))}`);
  });

  it('labelled, CRLF line endings (as GitHub stores edited bodies): passes', () => {
    expect(run([LABEL], '## Summary\r\nMinimal fix.\r\n\r\nPort-issue: #90\r\n').status).toBe(0);
  });

  it.each(['#73', '#102', '#9', '#7', '#740', '#1010', '#249', '#2500', '#', 'none', 'TBD'])(
    'labelled, `Port-issue: %s` (not a port issue): FAILS',
    (ref) => {
      expect(run([LABEL], `Port-issue: ${ref}`).status).toBe(1);
    },
  );

  it('labelled, URL to a DIFFERENT repo with a port-issue number: FAILS', () => {
    expect(run([LABEL], 'Port-issue: https://github.com/someone/else/issues/90').status).toBe(1);
  });

  it('labelled, port issue only mentioned in prose (no Port-issue line): FAILS', () => {
    expect(run([LABEL], 'Related to #90 and #91, see the port plan.').status).toBe(1);
  });

  it('labelled, Port-issue key buried mid-line: FAILS', () => {
    expect(run([LABEL], 'We should add Port-issue: #90 later').status).toBe(1);
  });

  it('labelled, Port-issue key ending a prose line (valid ref, but not line-anchored): FAILS', () => {
    // Pins the start-of-line anchor on its own: the value here is a valid port issue, so only the
    // anchor can reject it (the mid-line case above is also rejected by its trailing words).
    expect(run([LABEL], 'Tracked later, see Port-issue: #90').status).toBe(1);
  });

  it('a lookalike label (d1-exception-pending) does not trigger the check', () => {
    expect(run(['d1-exception-pending'], 'no ledger line').status).toBe(0);
  });

  it.each(['x"d1-exception"', 'not-d1-exception'])(
    'a label that merely contains or resembles the name (%s) does not trigger the check',
    (label) => {
      expect(run([label], 'no ledger line').status).toBe(0);
    },
  );

  it('the body is data, never code: a command substitution in it does not execute', () => {
    const dir = mkdtempSync(join(tmpdir(), 'd1-ledger-'));
    const canary = join(dir, 'pwned');
    try {
      run([LABEL], `Port-issue: #90\n$(touch ${canary})\n\`touch ${canary}\``);
      run([LABEL], `$(touch ${canary})`);
      expect(existsSync(canary)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { permissions?: Record<string, string>; steps?: Step[]; if?: string };
type Workflow = {
  on?: Record<string, unknown>;
  true?: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  permissions?: Record<string, string> | string;
  jobs?: Record<string, Job>;
};

describe('d1-ledger.yml — workflow wiring is pinned', () => {
  it('the workflow file exists', () => {
    expect(existsSync(WORKFLOW), `${WORKFLOW_REL} must exist`).toBe(true);
  });

  const load = (): Workflow => parseYaml(WORKFLOW) as Workflow;

  it('re-runs when the label or body changes, not only on push', () => {
    const doc = load();
    const on = (doc.on ?? doc.true) as Record<string, { types?: string[]; branches?: unknown }>;
    expect(on, 'workflow must declare triggers').toBeDefined();
    const pr = on.pull_request;
    expect(pr, 'must trigger on pull_request (not pull_request_target)').toBeDefined();
    expect(on.pull_request_target).toBeUndefined();
    expect(pr.types).toEqual(
      expect.arrayContaining(['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled', 'edited']),
    );
    // ci-triggers.test.ts: a stacked PR must not silently skip the check.
    expect(pr.branches).toBeUndefined();
  });

  it('the job runs only on pull_request events (push exists for the trigger convention only)', () => {
    const jobs = Object.values(load().jobs ?? {});
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.if ?? '', 'job must be gated to pull_request').toMatch(/github\.event_name\s*==\s*'pull_request'/);
    }
  });

  it('has its own concurrency group, distinct from ci.yml', () => {
    const doc = load();
    const group = doc.concurrency?.group ?? '';
    expect(group).toMatch(/d1-ledger/);
    const ci = parseYaml(join(ROOT, '.github/workflows/ci.yml')) as Workflow;
    expect(group).not.toBe(ci.concurrency?.group);
  });

  it('is read-only: workflow token gets at most contents:read + pull-requests:read', () => {
    const doc = load();
    const perms: Record<string, string> = {};
    if (doc.permissions && typeof doc.permissions === 'object') Object.assign(perms, doc.permissions);
    for (const job of Object.values(doc.jobs ?? {})) Object.assign(perms, job.permissions ?? {});
    expect(Object.keys(perms).length, 'permissions must be declared explicitly').toBeGreaterThan(0);
    for (const [scope, level] of Object.entries(perms)) {
      expect(['contents', 'pull-requests'], `unexpected permission scope ${scope}`).toContain(scope);
      expect(level, `${scope} must be read`).toBe('read');
    }
  });

  it('runs the script with the body and labels passed through env, never interpolated into run:', () => {
    const doc = load();
    const steps = Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const runStep = steps.find((s) => typeof s.run === 'string' && s.run.includes(SCRIPT_REL));
    expect(runStep, `a step must run ${SCRIPT_REL}`).toBeDefined();
    expect(runStep!.run).toMatch(new RegExp(`bash\\s+${SCRIPT_REL.replace(/\./g, '\\.')}`));
    expect(runStep!.env?.BODY).toMatch(/\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/);
    expect(runStep!.env?.PR_LABELS_JSON).toMatch(
      /\$\{\{\s*toJSON\(\s*github\.event\.pull_request\.labels\.\*\.name\s*\)\s*\}\}/,
    );
    for (const s of steps) {
      if (typeof s.run === 'string') expect(s.run, 'no ${{ }} expression inside run:').not.toContain('${{');
    }
  });

  it('checkout does not persist the token', () => {
    const doc = load();
    const steps = Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout, 'the script lives in the repo, so the job must check out').toBeDefined();
    expect(checkout!.with?.['persist-credentials']).toBe(false);
  });

  it('the raw file names the script path (non-vacuity for the parsed checks)', () => {
    expect(readFileSync(WORKFLOW, 'utf8')).toContain(SCRIPT_REL);
  });
});
