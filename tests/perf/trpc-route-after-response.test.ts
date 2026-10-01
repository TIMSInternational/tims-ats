/**
 * trpc-route-after-response.test.ts  (#314 tripwire)
 *
 * Static source check: the tRPC route must wire `ctx.runAfterResponse` to Next's `after()`.
 * Without it, portal.applyToVacancy silently falls back to a detached promise, which a
 * serverless runtime may freeze or kill as soon as the response is sent — losing every
 * post-response CV parse with nothing failing loudly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const routeSrc = readFileSync(resolve(__dirname, '..', '..', 'apps/web/app/api/trpc/[trpc]/route.ts'), 'utf-8');

describe('tRPC route wires post-response work to next/server after()', () => {
  it("imports `after` from 'next/server'", () => {
    expect(routeSrc).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*['"]next\/server['"]/);
  });

  it('builds runAfterResponse on after()', () => {
    // (task: () => Promise<void>) => after(task) — the task passed in is what after() gets.
    expect(routeSrc).toMatch(/const\s+runAfterResponse\s*=\s*\(\s*(\w+)\b[^\n]*\)\s*=>\s*after\(\s*\1\s*\)/);
  });

  it('supplies runAfterResponse in the createContext return value', () => {
    const createContext = routeSrc.slice(routeSrc.indexOf('createContext:'));
    expect(createContext).toMatch(/return\s*\{[^}]*\brunAfterResponse\b[^}]*\}/);
  });
});
