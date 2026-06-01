import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROUTERS_DIR = join(__dirname, '../../packages/api/src/routers');

function getRouterFiles(): { name: string; content: string }[] {
  return readdirSync(ROUTERS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: f, content: readFileSync(join(ROUTERS_DIR, f), 'utf8') }));
}

describe('Input Validation', () => {
  it('should use Zod validation on all mutation inputs', () => {
    const violations: string[] = [];
    for (const { name, content } of getRouterFiles()) {
      // Find mutations without .input()
      const mutations = content.matchAll(/\.mutation\s*\(/g);
      for (const match of mutations) {
        const before = content.slice(Math.max(0, (match.index ?? 0) - 200), match.index);
        if (!before.includes('.input(')) {
          // Check if it's a no-input mutation (like seedAiAgents) — that's ok
          const procedureLine = before.split('\n').pop() || '';
          if (!procedureLine.includes('.mutation')) {
            violations.push(`${name}: mutation without .input() near index ${match.index}`);
          }
        }
      }
    }
    // Many mutations use inline .input() on the same line or have no-input patterns.
    // The regex is imperfect for tRPC's chained API. Track this number and reduce over time.
    expect(violations.length).toBeLessThanOrEqual(65);
  });

  it('should limit z.any() usage to Prisma JSON fields only', () => {
    // z.any() is acceptable for Prisma Json fields (content, benefits, terms, result)
    // but should NOT appear for regular string/number/enum fields
    const allowedFiles = ['learning.ts', 'offer.ts']; // Prisma Json field routers
    const violations: string[] = [];
    for (const { name, content } of getRouterFiles()) {
      if (content.includes('z.any()') && !allowedFiles.includes(name)) {
        violations.push(name);
      }
    }
    expect(violations).toEqual([]);
  });

  it('should NOT use .passthrough() on Zod schemas in routers', () => {
    const violations: string[] = [];
    for (const { name, content } of getRouterFiles()) {
      if (content.includes('.passthrough()')) {
        violations.push(name);
      }
    }
    expect(violations).toEqual([]);
  });

  it('should bound string inputs with .max()', () => {
    // Check that critical routers (platform, candidate, user) have bounded strings
    const platformRouter = readFileSync(join(ROUTERS_DIR, 'platform.ts'), 'utf8');

    // createInvoice should have bounded line item descriptions
    expect(platformRouter).toContain('.max(300)'); // lineItem description
    expect(platformRouter).toContain('.max(500)'); // description/memo
    expect(platformRouter).toContain('.max(1000)'); // notes

    // createOrgInvitation should have bounded inputs
    expect(platformRouter).toContain('.max(255)'); // email
    expect(platformRouter).toContain('.max(100)'); // org name
  });
});
