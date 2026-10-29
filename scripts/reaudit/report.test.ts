import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFindings } from './findings-source';
import { mergeStatuses, type Observation } from './status';
import { buildReport, launchGate, writeReport, loadWpIndex, renderMarkdown } from './report';

// All findings here are synthetic. Status vocabulary:
//   FIXED-VERIFIED · OPEN-CONFIRMED · REGRESSED · UNBOUND · NOT-RUN · STALE-BINDING

function f(id: string, o: Record<string, unknown> = {}) {
  return {
    id,
    persona: 'recruiter',
    lens: 'journeys',
    category: 'synthetic',
    severity: 'P1',
    title: 't',
    detail: 'd',
    evidence: [],
    userImpact: 'u',
    recommendation: 'r',
    fixLocation: 'l',
    effort: 'S',
    launchScope: 'launch-v1',
    status: 'new',
    verification: null,
    ...o,
  };
}

const obs = (id: string, status: Observation['status'], source: Observation['source'] = 'vitest'): Observation => ({
  id,
  status,
  source,
  test: `synthetic ${id}`,
});

const SHA = '0123456789abcdef0123456789abcdef01234567';
const AT = new Date('2026-10-28T12:00:00Z');

describe('mergeStatuses (per-id precedence, fail closed)', () => {
  it('no observation → UNBOUND', () => {
    expect(mergeStatuses([])).toBe('UNBOUND');
  });
  it('REGRESSED beats everything', () => {
    expect(mergeStatuses(['FIXED-VERIFIED', 'OPEN-CONFIRMED', 'REGRESSED'])).toBe('REGRESSED');
  });
  it('OPEN-CONFIRMED beats NOT-RUN / STALE-BINDING / FIXED-VERIFIED', () => {
    expect(mergeStatuses(['FIXED-VERIFIED', 'NOT-RUN', 'OPEN-CONFIRMED'])).toBe('OPEN-CONFIRMED');
  });
  it('FIXED-VERIFIED only when EVERY binding is fixed (a NOT-RUN sibling is not a pass)', () => {
    expect(mergeStatuses(['FIXED-VERIFIED', 'NOT-RUN'])).toBe('NOT-RUN');
    expect(mergeStatuses(['FIXED-VERIFIED', 'STALE-BINDING'])).toBe('STALE-BINDING');
    expect(mergeStatuses(['FIXED-VERIFIED', 'FIXED-VERIFIED'])).toBe('FIXED-VERIFIED');
  });
});

describe('buildReport', () => {
  const findings = parseFindings([
    f('syn-a', { persona: 'recruiter', severity: 'P0', lens: 'access' }),
    f('syn-b', { persona: 'recruiter', severity: 'P2', launchScope: 'post-launch' }),
    f('syn-c', { persona: 'candidate', severity: 'P1', lens: 'data' }),
    f('syn-d', { persona: 'candidate', severity: 'P3' }),
  ]);
  const observations = [obs('syn-a', 'FIXED-VERIFIED'), obs('syn-b', 'OPEN-CONFIRMED'), obs('syn-c', 'REGRESSED')];

  it('one row per finding, with merged status; findings with no observation are UNBOUND', () => {
    const r = buildReport({ findings, observations, sha: SHA, generatedAt: AT });
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.status]))).toEqual({
      'syn-a': 'FIXED-VERIFIED',
      'syn-b': 'OPEN-CONFIRMED',
      'syn-c': 'REGRESSED',
      'syn-d': 'UNBOUND',
    });
  });

  it('rolls up by persona, severity, launchScope and lens', () => {
    const r = buildReport({ findings, observations, sha: SHA, generatedAt: AT });
    expect(r.rollups.persona.recruiter).toEqual({ 'FIXED-VERIFIED': 1, 'OPEN-CONFIRMED': 1 });
    expect(r.rollups.persona.candidate).toEqual({ REGRESSED: 1, UNBOUND: 1 });
    expect(r.rollups.severity.P0).toEqual({ 'FIXED-VERIFIED': 1 });
    expect(r.rollups.launchScope['post-launch']).toEqual({ 'OPEN-CONFIRMED': 1 });
    expect(r.rollups.lens.data).toEqual({ REGRESSED: 1 });
  });

  it('rolls up by WP when a WP index is given; ids missing from it go to "unassigned"', () => {
    const r = buildReport({
      findings,
      observations,
      sha: SHA,
      generatedAt: AT,
      wpIndex: { 'syn-a': 'WP-01', 'syn-c': 'WP-02' },
    });
    expect(r.rollups.wp['WP-01']).toEqual({ 'FIXED-VERIFIED': 1 });
    expect(r.rollups.wp['WP-02']).toEqual({ REGRESSED: 1 });
    expect(r.rollups.wp.unassigned).toEqual({ 'OPEN-CONFIRMED': 1, UNBOUND: 1 });
  });

  it('without a WP index every id is "unassigned" (the index is optional)', () => {
    const r = buildReport({ findings, observations, sha: SHA, generatedAt: AT });
    expect(Object.keys(r.rollups.wp)).toEqual(['unassigned']);
  });

  it('observations for ids not in the findings file are surfaced, not dropped', () => {
    const r = buildReport({
      findings,
      observations: [...observations, obs('syn-ghost', 'FIXED-VERIFIED')],
      sha: SHA,
      generatedAt: AT,
    });
    expect(r.unknownIds).toEqual(['syn-ghost']);
  });

  it('the markdown names every status and every row id', () => {
    const md = renderMarkdown(buildReport({ findings, observations, sha: SHA, generatedAt: AT }));
    for (const id of ['syn-a', 'syn-b', 'syn-c', 'syn-d']) expect(md).toContain(id);
    expect(md).toContain('REGRESSED');
    expect(md).toContain('UNBOUND');
  });
});

describe('launchGate (--gate launch)', () => {
  const launch = (status: Observation['status'] | null, o: Record<string, unknown> = {}) => {
    const findings = parseFindings([f('syn-x', o)]);
    return buildReport({ findings, observations: status ? [obs('syn-x', status)] : [], sha: SHA, generatedAt: AT });
  };

  it('exit 1 when a launch-v1 P1 is OPEN, and names it', () => {
    const g = launchGate(launch('OPEN-CONFIRMED'), { missingInputs: [] });
    expect(g.exitCode).toBe(1);
    expect(g.failing).toEqual(['syn-x']);
  });

  it('exit 0 when every launch-v1 P0/P1 is FIXED-VERIFIED', () => {
    expect(launchGate(launch('FIXED-VERIFIED'), { missingInputs: [] }).exitCode).toBe(0);
  });

  it('exit 1 when a launch-v1 P0 is UNBOUND, NOT-RUN, STALE-BINDING or REGRESSED (only FIXED-VERIFIED passes)', () => {
    expect(launchGate(launch(null, { severity: 'P0' }), { missingInputs: [] }).exitCode).toBe(1);
    expect(launchGate(launch('NOT-RUN', { severity: 'P0' }), { missingInputs: [] }).exitCode).toBe(1);
    expect(launchGate(launch('STALE-BINDING', { severity: 'P0' }), { missingInputs: [] }).exitCode).toBe(1);
    expect(launchGate(launch('REGRESSED', { severity: 'P0' }), { missingInputs: [] }).exitCode).toBe(1);
  });

  it('a launch-v1 P2 or a post-launch P0 that is open does not fail the gate', () => {
    expect(launchGate(launch('OPEN-CONFIRMED', { severity: 'P2' }), { missingInputs: [] }).exitCode).toBe(0);
    expect(
      launchGate(launch('OPEN-CONFIRMED', { severity: 'P0', launchScope: 'post-launch' }), { missingInputs: [] })
        .exitCode,
    ).toBe(0);
  });

  it('exit 2 when an input is missing — even if everything else is FIXED-VERIFIED', () => {
    expect(launchGate(launch('FIXED-VERIFIED'), { missingInputs: ['--trx'] }).exitCode).toBe(2);
  });

  it('exit 2 when the report has no findings at all (nothing checked is not a pass)', () => {
    const empty = buildReport({ findings: [], observations: [], sha: SHA, generatedAt: AT });
    expect(launchGate(empty, { missingInputs: [] }).exitCode).toBe(2);
  });
});

describe('writeReport', () => {
  let root: string;
  let repo: string;
  let out: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-report-')));
    repo = join(root, 'repo');
    out = join(root, 'private', 'reaudit');
    mkdirSync(repo, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const report = () =>
    buildReport({
      findings: parseFindings([f('syn-a')]),
      observations: [obs('syn-a', 'FIXED-VERIFIED')],
      sha: SHA,
      generatedAt: AT,
    });

  it('writes <yyyy-mm-dd>-<sha8>.json and .md outside the repo (creating the directory)', () => {
    const paths = writeReport(report(), { outDir: out, repoRoot: repo });
    expect(paths.json).toBe(join(out, '2026-10-28-01234567.json'));
    expect(paths.md).toBe(join(out, '2026-10-28-01234567.md'));
    expect(JSON.parse(readFileSync(paths.json, 'utf8')).rows[0].id).toBe('syn-a');
    expect(readFileSync(paths.md, 'utf8')).toContain('syn-a');
  });

  it('refuses an output dir inside the repo and writes nothing', () => {
    const inside = join(repo, 'reaudit-out');
    expect(() => writeReport(report(), { outDir: inside, repoRoot: repo })).toThrow(/inside the repository/i);
    expect(existsSync(inside)).toBe(false);
    expect(readdirSync(repo)).toEqual([]);
  });
});

describe('loadWpIndex', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-wp-')));
    repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('no path, or a path that does not exist → undefined (optional input)', () => {
    expect(loadWpIndex({ repoRoot: repo })).toBeUndefined();
    expect(loadWpIndex({ path: join(root, 'absent.json'), repoRoot: repo })).toBeUndefined();
  });

  it('a valid index loads', () => {
    const p = join(root, 'wp-index.json');
    writeFileSync(p, JSON.stringify({ 'syn-a': 'WP-01' }));
    expect(loadWpIndex({ path: p, repoRoot: repo })).toEqual({ 'syn-a': 'WP-01' });
  });

  it('a malformed index throws (present but wrong is loud, unlike absent)', () => {
    const p = join(root, 'wp-index.json');
    writeFileSync(p, JSON.stringify({ 'syn-a': 42 }));
    expect(() => loadWpIndex({ path: p, repoRoot: repo })).toThrow();
  });

  it('refuses an index path inside the repo', () => {
    const p = join(repo, 'wp-index.json');
    writeFileSync(p, JSON.stringify({}));
    expect(() => loadWpIndex({ path: p, repoRoot: repo })).toThrow(/inside the repository/i);
  });
});
