import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AGENT_REGISTRY } from '../../packages/ai/src/registry';

const root = resolve(__dirname, '../..');
const src = readFileSync(resolve(root, 'packages/api/src/routers/platform/ai-agents.ts'), 'utf8');

// Regression guard: seedAiAgents used to hardcode status: 'stub' on every one of
// the 32 catalog rows, even for slugs (cv-parser, candidate-screener, ...) that
// are real live agents in AGENT_REGISTRY and actually call Bedrock. That misled
// the platform AI-agent dashboard into showing live agents as stubs forever.
describe('seedAiAgents catalog status', () => {
  it('does not hardcode status per catalog entry', () => {
    expect(src).not.toMatch(/status:\s*'stub',\s*\n\s*\},/);
  });

  it('derives status from AGENT_REGISTRY membership before createMany', () => {
    expect(src).toContain('a.slug in AGENT_REGISTRY');
    expect(src).toMatch(/createMany\(\{\s*data:\s*agentsWithStatus/);
  });

  it('every live AGENT_REGISTRY slug is present in the seed catalog', () => {
    const seedSlugs = [...src.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
    for (const liveSlug of Object.keys(AGENT_REGISTRY)) {
      expect(seedSlugs).toContain(liveSlug);
    }
  });
});
