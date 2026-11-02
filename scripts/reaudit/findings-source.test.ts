import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFindings, parseFindings, FindingsSourceError } from './findings-source';

// All fixtures are SYNTHETIC. The harness never embeds real audit content (the repo is public).

function synthetic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'synthetic-finding-1',
    persona: 'recruiter',
    lens: 'journeys',
    category: 'synthetic',
    severity: 'P1',
    title: 'Synthetic title',
    detail: 'Synthetic detail.',
    evidence: ['apps/web/app/page.tsx:10-20 synthetic note', 'prose evidence without a path'],
    userImpact: 'Synthetic impact.',
    recommendation: 'Synthetic recommendation.',
    fixLocation: 'apps/web',
    effort: 'S',
    launchScope: 'launch-v1',
    status: 'new',
    verification: null,
    ...overrides,
  };
}

let root: string;
let repo: string;
let outside: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-findings-')));
  repo = join(root, 'repo');
  outside = join(root, 'private');
  mkdirSync(repo, { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeOutside(content: unknown): string {
  const p = join(outside, 'findings.json');
  writeFileSync(p, JSON.stringify(content));
  return p;
}

describe('parseFindings (strict schema)', () => {
  it('a valid synthetic file parses', () => {
    const out = parseFindings([synthetic(), synthetic({ id: 'synthetic-finding-2', persona: 'candidate' })]);
    expect(out.map((f) => f.id)).toEqual(['synthetic-finding-1', 'synthetic-finding-2']);
  });

  it('specRef and alreadyAddressedByPR are optional and nullable', () => {
    expect(() =>
      parseFindings([
        synthetic(),
        synthetic({ id: 'synthetic-finding-2', specRef: null, alreadyAddressedByPR: null }),
        synthetic({ id: 'synthetic-finding-3', specRef: 'spec §1', alreadyAddressedByPR: '#1 (partial)' }),
      ]),
    ).not.toThrow();
  });

  it('verification is either null or a strict {id, verdict, correctedSeverity, note} object', () => {
    const v = { id: 'synthetic-finding-1', verdict: 'confirmed', correctedSeverity: 'P2', note: 'synthetic' };
    expect(parseFindings([synthetic({ verification: v })])[0]?.verification?.verdict).toBe('confirmed');
    expect(() => parseFindings([synthetic({ verification: 'free prose' })])).toThrow(FindingsSourceError);
    expect(() => parseFindings([synthetic({ verification: { ...v, verdict: 'maybe' } })])).toThrow(FindingsSourceError);
  });

  it('rejects an unknown top-level key (no passthrough)', () => {
    expect(() => parseFindings([synthetic({ surprise: true })])).toThrow(FindingsSourceError);
  });

  it('rejects an unknown key nested inside verification', () => {
    const v = { id: 'synthetic-finding-1', verdict: 'confirmed', correctedSeverity: 'P1', note: 'n', extra: 1 };
    expect(() => parseFindings([synthetic({ verification: v })])).toThrow(FindingsSourceError);
  });

  it('accepts a long-but-real detail (the real data reaches ~1.5k chars)', () => {
    expect(() => parseFindings([synthetic({ detail: 'x'.repeat(3000) })])).not.toThrow();
  });

  it('rejects an over-long string', () => {
    expect(() => parseFindings([synthetic({ detail: 'x'.repeat(100_000) })])).toThrow(FindingsSourceError);
  });

  it('rejects an over-long evidence array', () => {
    expect(() => parseFindings([synthetic({ evidence: Array.from({ length: 500 }, () => 'x') })])).toThrow(
      FindingsSourceError,
    );
  });

  it('rejects an out-of-enum severity', () => {
    expect(() => parseFindings([synthetic({ severity: 'P9' })])).toThrow(FindingsSourceError);
  });

  it('rejects an id that is not a slug (ids become file names for owner checks)', () => {
    expect(() => parseFindings([synthetic({ id: '../escape' })])).toThrow(FindingsSourceError);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseFindings([synthetic(), synthetic()])).toThrow(/duplicate/i);
  });

  it('rejects a non-array top level', () => {
    expect(() => parseFindings({ findings: [] })).toThrow(FindingsSourceError);
  });
});

describe('loadFindings (path handling)', () => {
  it('loads from an explicit path outside the repo', () => {
    const p = writeOutside([synthetic()]);
    expect(loadFindings({ path: p, env: {}, repoRoot: repo })).toHaveLength(1);
  });

  it('falls back to REAUDIT_FINDINGS from the environment', () => {
    const p = writeOutside([synthetic()]);
    expect(loadFindings({ env: { REAUDIT_FINDINGS: p }, repoRoot: repo })).toHaveLength(1);
  });

  it('with neither a path nor REAUDIT_FINDINGS it throws and names the variable (no built-in default)', () => {
    expect(() => loadFindings({ env: {}, repoRoot: repo })).toThrow(/REAUDIT_FINDINGS/);
  });

  it('a path inside the repo throws, and the file is never read', () => {
    const p = join(repo, 'findings.json');
    writeFileSync(p, 'not json at all');
    expect(() => loadFindings({ path: p, env: {}, repoRoot: repo })).toThrow(/inside the repository/i);
  });

  it('a missing file throws with the path in the message', () => {
    const p = join(outside, 'absent.json');
    expect(() => loadFindings({ path: p, env: {}, repoRoot: repo })).toThrow(p);
  });

  it('invalid JSON throws FindingsSourceError naming the path', () => {
    const p = join(outside, 'broken.json');
    writeFileSync(p, '{');
    expect(() => loadFindings({ path: p, env: {}, repoRoot: repo })).toThrow(FindingsSourceError);
    expect(() => loadFindings({ path: p, env: {}, repoRoot: repo })).toThrow(p);
  });
});
