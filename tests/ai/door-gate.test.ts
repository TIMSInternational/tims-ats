import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';

// Coding rule #2: AI has ONE door. Bedrock / the AI SDK may only be touched
// inside packages/ai (which owns invokeAgent → bedrockGenerate). No router,
// service, or frontend file may import @ai-sdk, call createAmazonBedrock /
// generateText, or reach the raw bedrockGenerate. This mirrors the CI grep-gate
// so the rule is enforced locally too.

const ROOT = join(__dirname, '../..');
const ROOTS = [join(ROOT, 'packages'), join(ROOT, 'apps/web')];
const ALLOWED_DIR = join('packages', 'ai'); // the one door
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', '.git']);

// Forbidden tokens outside packages/ai.
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: '@ai-sdk import', re: /@ai-sdk/ },
  { label: 'createAmazonBedrock', re: /createAmazonBedrock/ },
  { label: 'raw bedrockGenerate', re: /bedrockGenerate/ },
  { label: "import from 'ai' (AI SDK)", re: /from\s+['"]ai['"]/ },
];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe('AI single-door enforcement (rule #2)', () => {
  it('no Bedrock / AI-SDK usage outside packages/ai', () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file.includes(`${sep}packages${sep}ai${sep}`) || file.includes(ALLOWED_DIR + sep)) continue;
        const content = readFileSync(file, 'utf8');
        for (const { label, re } of FORBIDDEN) {
          if (re.test(content)) {
            violations.push(`${file.replace(ROOT + sep, '')} → ${label}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the door itself exists and owns the raw Bedrock call', () => {
    const client = readFileSync(join(ROOT, 'packages/ai/src/client.ts'), 'utf8');
    expect(client).toContain('createAmazonBedrock');
    expect(client).toContain('export async function bedrockGenerate');
    const invoke = readFileSync(join(ROOT, 'packages/ai/src/invoke.ts'), 'utf8');
    expect(invoke).toContain('export async function invokeAgent');
  });
});
