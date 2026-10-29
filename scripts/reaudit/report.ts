/**
 * Builds, renders, gates and writes the re-audit report.
 *
 * One row per finding, with the merged status of every observation bound to its id (see status.ts),
 * plus rollups by persona, severity, launchScope, lens and WP. The report is private: it is written
 * only OUTSIDE the repository, as `<yyyy-mm-dd>-<sha8>.{json,md}`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { EvidenceDrift } from './evidence-drift';
import { isSuspiciousFix } from './evidence-drift';
import type { Finding } from './findings-source';
import { assertOutsideRepo } from './paths';
import { REAUDIT_STATUSES, mergeStatuses, type Observation, type ReauditStatus } from './status';

export type WpIndex = Record<string, string>;
export type StatusCounts = Partial<Record<ReauditStatus, number>>;
export type Rollup = Record<string, StatusCounts>;

export interface ReportRow {
  id: string;
  title: string;
  persona: string;
  severity: string;
  launchScope: string;
  lens: string;
  wp: string;
  status: ReauditStatus;
  tests: string[];
  suspiciousFix: boolean;
}

export interface ReauditReport {
  sha: string;
  generatedAt: string;
  rows: ReportRow[];
  rollups: { persona: Rollup; severity: Rollup; launchScope: Rollup; lens: Rollup; wp: Rollup };
  /** Ids observed in test output but absent from the findings file. */
  unknownIds: string[];
  /** FIXED-VERIFIED ids whose cited evidence files are all unchanged since the evidence base. */
  suspiciousFixes: string[];
}

export interface BuildReportInput {
  findings: readonly Finding[];
  observations: readonly Observation[];
  sha: string;
  generatedAt: Date;
  wpIndex?: WpIndex;
  /** Per-id evidence drift, when an evidence base was supplied. */
  drift?: ReadonlyMap<string, readonly EvidenceDrift[]>;
}

const UNASSIGNED = 'unassigned';

function bump(rollup: Rollup, key: string, status: ReauditStatus): void {
  const counts = (rollup[key] ??= {});
  counts[status] = (counts[status] ?? 0) + 1;
}

export function buildReport(input: BuildReportInput): ReauditReport {
  const byId = new Map<string, Observation[]>();
  for (const o of input.observations) {
    const list = byId.get(o.id) ?? [];
    list.push(o);
    byId.set(o.id, list);
  }

  const rollups = { persona: {}, severity: {}, launchScope: {}, lens: {}, wp: {} } as ReauditReport['rollups'];
  const rows: ReportRow[] = input.findings.map((f) => {
    const obs = byId.get(f.id) ?? [];
    const status = mergeStatuses(obs.map((o) => o.status));
    const wp = input.wpIndex?.[f.id] ?? UNASSIGNED;
    bump(rollups.persona, f.persona, status);
    bump(rollups.severity, f.severity, status);
    bump(rollups.launchScope, f.launchScope, status);
    bump(rollups.lens, f.lens, status);
    bump(rollups.wp, wp, status);
    return {
      id: f.id,
      title: f.title,
      persona: f.persona,
      severity: f.severity,
      launchScope: f.launchScope,
      lens: f.lens,
      wp,
      status,
      tests: [...new Set(obs.map((o) => `${o.source}: ${o.test}`))],
      suspiciousFix: isSuspiciousFix(status, input.drift?.get(f.id) ?? []),
    };
  });

  const known = new Set(input.findings.map((f) => f.id));
  const unknownIds = [...new Set(input.observations.map((o) => o.id))].filter((id) => !known.has(id)).sort();

  return {
    sha: input.sha,
    generatedAt: input.generatedAt.toISOString(),
    rows,
    rollups,
    unknownIds,
    suspiciousFixes: rows.filter((r) => r.suspiciousFix).map((r) => r.id),
  };
}

function rollupTable(title: string, rollup: Rollup): string[] {
  const keys = Object.keys(rollup).sort();
  const out = [`### By ${title}`, '', `| ${title} | ${REAUDIT_STATUSES.join(' | ')} |`];
  out.push(`| --- | ${REAUDIT_STATUSES.map(() => '---').join(' | ')} |`);
  for (const k of keys) out.push(`| ${k} | ${REAUDIT_STATUSES.map((s) => rollup[k]?.[s] ?? 0).join(' | ')} |`);
  return [...out, ''];
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderMarkdown(r: ReauditReport): string {
  const out = [`# Re-audit report`, '', `- Commit: \`${r.sha}\``, `- Generated: ${r.generatedAt}`, ''];
  out.push('## Rollups', '');
  out.push(...rollupTable('persona', r.rollups.persona), ...rollupTable('severity', r.rollups.severity));
  out.push(...rollupTable('launchScope', r.rollups.launchScope), ...rollupTable('lens', r.rollups.lens));
  out.push(...rollupTable('wp', r.rollups.wp));
  out.push('## Findings', '', '| id | status | severity | launchScope | persona | wp | bound checks |');
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of r.rows) {
    const status = row.suspiciousFix ? `${row.status} (evidence unchanged)` : row.status;
    const tests = row.tests.length ? row.tests.map(cell).join('<br>') : '-';
    out.push(
      `| ${row.id} | ${status} | ${row.severity} | ${row.launchScope} | ${row.persona} | ${row.wp} | ${tests} |`,
    );
  }
  out.push('');
  if (r.unknownIds.length)
    out.push('## Observed ids not in the findings file', '', ...r.unknownIds.map((i) => `- ${i}`), '');
  if (r.suspiciousFixes.length) {
    out.push('## Fixed, but every cited evidence file is unchanged', '', ...r.suspiciousFixes.map((i) => `- ${i}`), '');
  }
  return out.join('\n');
}

export interface GateResult {
  exitCode: 0 | 1 | 2;
  failing: string[];
}

/** `--gate launch`: every launch-v1 P0/P1 must be FIXED-VERIFIED. Missing input or no findings = 2. */
export function launchGate(r: ReauditReport, opts: { missingInputs: readonly string[] }): GateResult {
  const failing = r.rows
    .filter((row) => row.launchScope === 'launch-v1' && (row.severity === 'P0' || row.severity === 'P1'))
    .filter((row) => row.status !== 'FIXED-VERIFIED')
    .map((row) => row.id);
  if (opts.missingInputs.length > 0 || r.rows.length === 0) return { exitCode: 2, failing };
  return { exitCode: failing.length > 0 ? 1 : 0, failing };
}

export function writeReport(
  r: ReauditReport,
  opts: { outDir: string; repoRoot: string },
): { json: string; md: string } {
  const dir = assertOutsideRepo(opts.outDir, opts.repoRoot, 'report output directory');
  mkdirSync(dir, { recursive: true });
  const base = `${r.generatedAt.slice(0, 10)}-${r.sha.slice(0, 8)}`;
  const json = join(dir, `${base}.json`);
  const md = join(dir, `${base}.md`);
  writeFileSync(json, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(md, renderMarkdown(r));
  return { json, md };
}

const wpIndexSchema = z.record(z.string().max(64), z.string().min(1).max(32));

/** Optional input: absent -> undefined; present but malformed -> throws; inside the repo -> throws. */
export function loadWpIndex(opts: { path?: string; repoRoot: string }): WpIndex | undefined {
  if (!opts.path) return undefined;
  const p = assertOutsideRepo(opts.path, opts.repoRoot, 'WP index file');
  if (!existsSync(p)) return undefined;
  const parsed = wpIndexSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')));
  if (!parsed.success) throw new Error(`WP index file failed validation: ${p}`);
  return parsed.data;
}
