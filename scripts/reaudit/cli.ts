#!/usr/bin/env -S npx tsx
/**
 * Re-audit CLI.
 *
 *   pnpm exec tsx scripts/reaudit/cli.ts --playwright <json> --vitest <json> --vitest-exit <status>
 *     --trx <dir> [--with-owner-checks] [--gate launch] [--evidence-base <rev>]
 *
 * --vitest-exit is required with --vitest: the exit status of the `vitest run` that wrote the JSON.
 * Vitest's JSON report omits unhandled errors; only the exit status shows them.
 *
 * Private locations come ONLY from the environment; no private path is baked into this public repo:
 *   REAUDIT_FINDINGS (required) · REAUDIT_OUT_DIR (required) · REAUDIT_BINDINGS · REAUDIT_WP_INDEX ·
 *   REAUDIT_OWNER_CHECKS_DIR (required with --with-owner-checks).
 *
 * Evidence must be of HEAD: every input report must be newer than HEAD's commit time (a report from an
 * earlier revision is refused, exit 2), and --gate launch refuses a tree with uncommitted changes.
 *
 * Exit codes: 0 ok / gate passed · 1 gate failed · 2 cannot run (missing or invalid input, refused
 * path). Every unexpected error is exit 2: this tool fails closed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateBindings, nameBindings, unknownBindingIds } from './bindings';
import { runOwnerChecks } from './collect-owner';
import { collectPlaywright } from './collect-playwright';
import { collectVitest } from './collect-vitest';
import { collectXunitDir } from './collect-xunit';
import { evidenceDrift, type EvidenceDrift } from './evidence-drift';
import { loadFindings } from './findings-source';
import { assertOutsideRepo } from './paths';
import { buildReport, launchGate, loadWpIndex, writeReport } from './report';
import { SLUG_RE, type Observation } from './status';

export interface CliContext {
  env: Record<string, string | undefined>;
  repoRoot: string;
  headSha: string;
  /** HEAD's committer time: evidence written before it cannot be evidence of HEAD. */
  headCommittedAt: Date;
  /** Tracked files differ from HEAD, so evidence produced from this tree is not of HEAD. */
  treeDirty: boolean;
  now: Date;
  log: (s: string) => void;
  err: (s: string) => void;
}

interface CliArgs {
  playwright?: string;
  vitest?: string;
  vitestExit?: number;
  trx?: string;
  withOwnerChecks: boolean;
  gate?: 'launch';
  evidenceBase?: string;
}

class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--playwright', '--vitest', '--vitest-exit', '--trx', '--gate', '--evidence-base']);

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { withOwnerChecks: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (flag === '--with-owner-checks') {
      args.withOwnerChecks = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new UsageError(`unknown argument: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    if (flag === '--vitest-exit') {
      if (!/^\d{1,3}$/.test(value) || Number(value) > 255) {
        throw new UsageError(`--vitest-exit must be a process exit status 0-255 (got "${value}")`);
      }
      args.vitestExit = Number(value);
    } else if (flag === '--playwright') args.playwright = value;
    else if (flag === '--vitest') args.vitest = value;
    else if (flag === '--trx') args.trx = value;
    else if (flag === '--evidence-base') args.evidenceBase = value;
    else if (value === 'launch') args.gate = 'launch';
    else throw new UsageError(`--gate accepts only "launch" (got "${value}")`);
  }
  return args;
}

function readJson(path: string, label: string): unknown {
  const p = resolve(path);
  if (!existsSync(p)) throw new UsageError(`${label} input not found: ${p}`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new UsageError(`${label} input is not valid JSON: ${p} (${(e as Error).message})`);
  }
}

function assertFreshEvidence(paths: readonly string[], headCommittedAt: Date): void {
  if (Number.isNaN(headCommittedAt.getTime())) throw new UsageError('cannot read the HEAD commit time');
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).mtimeMs < headCommittedAt.getTime()) {
      throw new UsageError(
        `evidence predates the HEAD commit (${headCommittedAt.toISOString()}), so it is not evidence of HEAD: ${p}`,
      );
    }
  }
}

function evidenceFiles(args: CliArgs): string[] {
  const files: string[] = [];
  if (args.playwright) files.push(resolve(args.playwright));
  if (args.vitest) files.push(resolve(args.vitest));
  if (args.trx) {
    const dir = resolve(args.trx);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      for (const f of readdirSync(dir)) if (f.endsWith('.trx')) files.push(join(dir, f));
    }
  }
  return files;
}

function ownerCheckIds(dir: string, bound: readonly string[], findingIds: ReadonlySet<string>): string[] {
  const ids = new Set(bound);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const id = f.replace(/\.sh$/, '');
      if (f.endsWith('.sh') && SLUG_RE.test(id) && findingIds.has(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

async function run(argv: readonly string[], ctx: CliContext): Promise<number> {
  const args = parseArgs(argv);
  if (args.vitest && args.vitestExit === undefined) {
    throw new UsageError('--vitest needs --vitest-exit <status> (the JSON report omits unhandled errors)');
  }
  if (!args.vitest && args.vitestExit !== undefined) throw new UsageError('--vitest-exit needs --vitest');
  if (!args.playwright && !args.vitest && !args.trx && !args.withOwnerChecks) {
    throw new UsageError('no inputs: pass at least one of --playwright, --vitest, --trx, --with-owner-checks');
  }
  const missingInputs = (['playwright', 'vitest', 'trx'] as const).filter((k) => !args[k]).map((k) => `--${k}`);
  if (args.gate === 'launch' && missingInputs.length > 0) {
    ctx.err(`--gate launch needs every input; missing: ${missingInputs.join(', ')}`);
    return 2;
  }
  if (args.gate === 'launch' && ctx.treeDirty) {
    ctx.err('--gate launch refuses a working tree with uncommitted changes: the evidence would not be of HEAD');
    return 2;
  }
  assertFreshEvidence(evidenceFiles(args), ctx.headCommittedAt);

  const outDirEnv = ctx.env.REAUDIT_OUT_DIR;
  if (!outDirEnv) throw new UsageError('REAUDIT_OUT_DIR is not set (absolute directory outside the repository)');
  const outDir = assertOutsideRepo(outDirEnv, ctx.repoRoot, 'REAUDIT_OUT_DIR');
  let checksDir: string | undefined;
  if (args.withOwnerChecks) {
    const raw = ctx.env.REAUDIT_OWNER_CHECKS_DIR;
    if (!raw) throw new UsageError('--with-owner-checks needs REAUDIT_OWNER_CHECKS_DIR');
    checksDir = assertOutsideRepo(raw, ctx.repoRoot, 'REAUDIT_OWNER_CHECKS_DIR');
  }

  const findings = loadFindings({ env: ctx.env, repoRoot: ctx.repoRoot });
  const bindings = loadPrivateBindings({ path: ctx.env.REAUDIT_BINDINGS, repoRoot: ctx.repoRoot });
  const wpIndex = loadWpIndex({ path: ctx.env.REAUDIT_WP_INDEX, repoRoot: ctx.repoRoot });

  const observations: Observation[] = [];
  if (args.playwright) observations.push(...collectPlaywright(readJson(args.playwright, '--playwright')));
  if (args.vitest)
    observations.push(
      ...collectVitest(readJson(args.vitest, '--vitest'), nameBindings(bindings, 'vitest'), {
        runExitCode: args.vitestExit,
      }),
    );
  if (args.trx) observations.push(...collectXunitDir(resolve(args.trx), nameBindings(bindings, 'xunit')));
  if (checksDir) {
    const ids = ownerCheckIds(checksDir, bindings.ownerChecks, new Set(findings.map((f) => f.id)));
    observations.push(...runOwnerChecks({ enabled: true, checksDir, ids }));
  } else {
    // A declared owner binding that was not executed is a check that did not run, never an absence.
    for (const id of bindings.ownerChecks) {
      observations.push({
        id,
        status: 'NOT-RUN',
        source: 'owner',
        test: 'owner check (not executed: no --with-owner-checks)',
      });
    }
  }

  let drift: Map<string, EvidenceDrift[]> | undefined;
  if (args.evidenceBase) {
    const base = args.evidenceBase;
    drift = new Map(findings.map((f) => [f.id, evidenceDrift({ repoRoot: ctx.repoRoot, base, evidence: f.evidence })]));
  }

  const report = buildReport({ findings, observations, sha: ctx.headSha, generatedAt: ctx.now, wpIndex, drift });
  const paths = writeReport(report, { outDir, repoRoot: ctx.repoRoot });
  ctx.log(`report: ${paths.json}`);
  ctx.log(`report: ${paths.md}`);
  for (const [scope, counts] of Object.entries(report.rollups.launchScope)) {
    ctx.log(
      `${scope}: ${Object.entries(counts)
        .map(([s, n]) => `${s}=${n}`)
        .join(' ')}`,
    );
  }
  if (report.unknownIds.length) ctx.err(`observed ids not in the findings file: ${report.unknownIds.join(', ')}`);
  const staleBindings = unknownBindingIds(
    bindings,
    findings.map((f) => f.id),
  );
  if (staleBindings.length) ctx.err(`private bindings name ids not in the findings file: ${staleBindings.join(', ')}`);
  if (report.suspiciousFixes.length) ctx.err(`fixed but evidence unchanged: ${report.suspiciousFixes.join(', ')}`);

  if (args.gate !== 'launch') return 0;
  const gate = launchGate(report, { missingInputs });
  if (gate.exitCode === 0) ctx.log('gate launch: PASS (every launch-v1 P0/P1 is FIXED-VERIFIED)');
  else if (gate.exitCode === 1) ctx.err(`gate launch: FAIL, not FIXED-VERIFIED: ${gate.failing.join(', ')}`);
  else ctx.err('gate launch: NOT RUN (missing input or no findings), which is not a pass');
  return gate.exitCode;
}

export async function runCli(argv: readonly string[], ctx: CliContext): Promise<number> {
  try {
    return await run(argv, ctx);
  } catch (e) {
    ctx.err(`reaudit: ${(e as Error).message}`);
    return 2;
  }
}

// No top-level await: tsx runs this package as CommonJS.
function main(): void {
  const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  let ctx: CliContext;
  try {
    ctx = {
      env: process.env,
      repoRoot: git('rev-parse', '--show-toplevel'),
      headSha: git('rev-parse', 'HEAD'),
      headCommittedAt: new Date(git('log', '-1', '--format=%cI', 'HEAD')),
      treeDirty: git('status', '--porcelain', '--untracked-files=no') !== '',
      now: new Date(),
      log: (s) => console.log(s),
      err: (s) => console.error(s),
    };
  } catch (e) {
    console.error(`reaudit: ${(e as Error).message}`);
    process.exitCode = 2;
    return;
  }
  runCli(process.argv.slice(2), ctx).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`reaudit: ${(e as Error).message}`);
      process.exitCode = 2;
    },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
