import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// #358 tier-1 (Codex) review: the runbook said no live user-facing credential flow passes through the tRPC
// limiter, while the public offer-signing page calls three fail-closed procedures, so an Upstash outage
// blocks candidates from viewing or answering offers. Every fail-closed procedure that the web app calls must
// be named in the runbook's scope caveat.

const ROOT = join(__dirname, '..', '..');
const RUNBOOK = readFileSync(join(ROOT, 'docs/runbooks/production-rate-limits.md'), 'utf8');
const LIMITER = readFileSync(join(ROOT, 'packages/api/src/middleware/rate-limit.ts'), 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

const failClosedPaths = [
  ...(/const FAIL_CLOSED_PATHS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(LIMITER)?.[1] ?? '').matchAll(/'([a-z.]+)'/g),
].map((m) => m[1]!);
const webSource = filesUnder(join(ROOT, 'apps/web'))
  .map((f) => readFileSync(f, 'utf8').toLowerCase())
  .join('\n');

describe('production-rate-limits runbook scope caveat', () => {
  it('reads a non-empty fail-closed set (non-vacuity)', () => {
    expect(failClosedPaths.length).toBeGreaterThanOrEqual(6);
  });

  it('names every fail-closed procedure the web app actually calls, and never claims none do', () => {
    const called = failClosedPaths.filter((p) => webSource.includes(`trpc.${p}`));
    expect(called.length).toBeGreaterThan(0);
    for (const path of called) {
      expect(RUNBOOK.toLowerCase(), path).toContain(path);
    }
    expect(RUNBOOK).not.toMatch(/none of the live user-facing credential flows passes through this\s+limiter/);
    expect(RUNBOOK).toMatch(/\/offers\/sign\/\[token\]/);
  });
});
