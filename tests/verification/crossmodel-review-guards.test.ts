/**
 * Behavioural tests for scripts/verification/crossmodel-review.sh (/gate check 15).
 *
 * WHY THESE EXIST
 * ---------------
 * This script is the repo's cross-model verification gate and it has now shipped two silent failures:
 *
 *   #38     the Codex CLI exits 0 when quota-blocked, so the gate no-opped for weeks while every build
 *           reported green — six PRs merged unreviewed, two of them data-exposure fixes.
 *   #136    a review returned seven substantive findings and the script reported "did not run", because
 *           the model wrote **VERDICT: BLOCKING** in bold and the matcher wanted a bare line.
 *
 * Both are the same shape: subtle gate logic, no test, wrong answer. A tier-2 reviewer of the fix for the
 * second one pointed out that the fix itself was untested and that its `sed` had edge cases "a single test
 * would have caught" — and it was right, because that sed had also started forgiving `>`, which silently
 * converts a QUOTED verdict into an accepted one. This file is the answer to that.
 *
 * HOW IT STAYS HERMETIC
 * ---------------------
 * Everything runs against a throwaway git repo and a stub HTTP gateway on loopback:
 *   - a temp repo with two commits, so `git diff HEAD~1...HEAD` is non-empty (the script refuses to run
 *     on an empty diff, correctly, so the tests must give it something to review);
 *   - no `scripts/verification/codex-review.sh` in that repo, so tier 1 skips itself and tier 2 is what
 *     gets exercised;
 *   - `OMNIROUTE_URL` pointed at a stub that returns exactly the payload each test needs.
 * No real gateway, no network, no model call, no cost.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT_REL = 'scripts/verification/crossmodel-review.sh';

let sandbox: string;
let repo: string;
// `ReturnType<typeof createServer>` rather than an imported `Server`: two different @types/node copies
// resolve in this workspace and the nominal types are unrelated, so the explicit import does not typecheck.
let server: ReturnType<typeof createServer>;
let port: number;

/** What the stub should answer with on the next /chat/completions call. */
let stub: { content?: string; model?: string | null; status?: number } = {};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'crossmodel-test-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'scripts', 'verification'), { recursive: true });
  copyFileSync(join(REPO_ROOT, SCRIPT_REL), join(repo, SCRIPT_REL));

  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'first');
  // A second commit so HEAD~1...HEAD is a real, reviewable diff.
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'second');

  server = createServer((req, res) => {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub/model' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(stub.status ?? 200, { 'content-type': 'application/json' });
      const payload: Record<string, unknown> = {
        choices: [{ message: { content: stub.content ?? '' } }],
      };
      // `model: null` means "omit the field entirely" — the unreported-attribution path.
      if (stub.model !== null) payload.model = stub.model ?? 'stub/model';
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(sandbox, { recursive: true, force: true });
});

type Run = { code: number; out: string };

const execFileAsync = promisify(execFile);

/**
 * MUST be async. The stub gateway lives in this very process, so a synchronous `execFileSync` would block
 * the event loop and the server could never answer the script's request — every network-dependent test
 * then fails on an 8s curl timeout that looks like a script bug rather than a test-harness one.
 */
async function run(env: Record<string, string | undefined>): Promise<Run> {
  const opts = {
    cwd: repo,
    encoding: 'utf8' as const,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      // Carried because this repo augments ProcessEnv to require it.
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      OMNIROUTE_URL: `http://127.0.0.1:${port}/v1`,
      ...env,
    },
  };
  try {
    const { stdout, stderr } = await execFileAsync('bash', [join(repo, SCRIPT_REL), 'HEAD~1'], opts);
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * A well-formed review body ending in the given verdict line.
 *
 * Must exceed 200 NON-WHITESPACE characters: the script treats anything shorter as "no meaningful review"
 * and returns exit 2. That threshold is deliberate (a one-word reply is not a review), and the
 * 'rejects a too-short response' test below pins it — so this filler is load-bearing, not padding.
 */
const review = (verdictLine: string) =>
  [
    'I reviewed the diff and have the following observations to record.',
    '',
    'The change alters gate behaviour, so the exit-code contract deserves particular attention: a control',
    'that cannot distinguish "did not run" from "found nothing" is the failure mode this repository has',
    'already been burned by more than once, and the surrounding documentation should say plainly which of',
    'those two states each exit code represents.',
    '',
    verdictLine,
  ].join('\n');

describe('reviewer identity — the gate refuses an unattributable reviewer (#38)', () => {
  it('exits 2 when OMNIROUTE_MODEL is unset (no silent default)', async () => {
    const { code, out } = await run({ OMNIROUTE_MODEL: undefined });
    expect(code, out).toBe(2);
    expect(out).toMatch(/OMNIROUTE_MODEL is not set/);
  });

  it('exits 2 for an auto/* router — its vendor is decided per request', async () => {
    const { code, out } = await run({ OMNIROUTE_MODEL: 'auto/best-coding' });
    expect(code, out).toBe(2);
    expect(out).toMatch(/is a ROUTER/);
  });

  it.each(['aug/fable-5', 'aug/opus4.8', 'tllm/CLAUDE_4_6_SONNET', 'ddgw/claude-haiku-4-5', 'aug/sonnet5-high'])(
    'exits 2 for the Anthropic model %s',
    async (model) => {
      const { code, out } = await run({ OMNIROUTE_MODEL: model });
      expect(code, out).toBe(2);
      expect(out).toMatch(/is an Anthropic model/);
    },
  );

  it('does NOT block a non-Anthropic name that merely contains a token substring', async () => {
    // `opus` is a substring of `octopus`. Before the word boundary this hard-failed an unrelated vendor.
    stub = { content: review('VERDICT: CLEAN'), model: 'vendor/octopus-7b' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'vendor/octopus-7b' });
    expect(out).not.toMatch(/is an Anthropic model/);
    expect(code, out).toBe(0);
  });

  it('exits 2 when the gateway SERVES an Anthropic model despite a clean request', async () => {
    stub = { content: review('VERDICT: CLEAN'), model: 'aug/opus4.8' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(2);
    expect(out).toMatch(/served 'aug\/opus4\.8', an Anthropic model/);
  });

  it('warns loudly — never silently — when the gateway does not report a model', async () => {
    // The regression guarded here: an unparseable/absent `model` used to leave the requested name printed
    // as the reviewer's identity, quietly restoring the misattribution this feature removes.
    stub = { content: review('VERDICT: CLEAN'), model: null };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(0);
    expect(out).toMatch(/did not report which model served/);
    expect(out).toMatch(/UNVERIFIED/);
  });
});

describe('verdict parsing — emphasis is decoration, quotation is not (#136)', () => {
  it.each([
    ['plain', 'VERDICT: BLOCKING'],
    ['bold — the exact #136 case', '**VERDICT: BLOCKING**'],
    ['backticked', '`VERDICT: BLOCKING`'],
    ['underscore-emphasised', '__VERDICT: BLOCKING__'],
  ])('accepts a %s verdict and exits 1', async (_label, line) => {
    stub = { content: review(line), model: 'oc/deepseek-v4-flash-free' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(1);
    expect(out).toMatch(/BLOCKING findings/);
  });

  it('accepts a plain CLEAN verdict and exits 0', async () => {
    stub = { content: review('VERDICT: CLEAN'), model: 'oc/deepseek-v4-flash-free' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(0);
    expect(out).toMatch(/CLEAN/);
  });

  it.each([
    ['blockquote — a QUOTE of the template, not an assertion', '> VERDICT: CLEAN'],
    ['heading', '## VERDICT: CLEAN'],
  ])('rejects a %s and exits 2 rather than reading it as a pass', async (_label, line) => {
    stub = { content: review(line), model: 'oc/deepseek-v4-flash-free' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(2);
    expect(out).toMatch(/not a VERDICT/);
  });

  it('rejects a response with no verdict line at all', async () => {
    stub = {
      content: 'I looked at the diff and it seems fine to me, no notes worth raising here at all.',
      model: 'x/y',
    };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(2);
  });

  it('rejects a too-short response instead of treating it as a clean review', async () => {
    stub = { content: 'VERDICT: CLEAN', model: 'x/y' };
    const { code, out } = await run({ OMNIROUTE_MODEL: 'oc/deepseek-v4-flash-free' });
    expect(code, out).toBe(2);
    expect(out).toMatch(/no meaningful review|not a VERDICT/);
  });
});
