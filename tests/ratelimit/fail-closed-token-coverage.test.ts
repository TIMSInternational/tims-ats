import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo, stubSharedStoreEnv } from './fake-dynamodb';

// #358 tier-1 (Codex) pass 5: aiInterview.start / recordConsent take a candidateToken as their
// credential but were missing from FAIL_CLOSED_PATHS, so during a shared-store outage token
// attempts fell back to independent per-instance budgets. This scans every router for a
// public procedure (or a procedure derived from publicProcedure) whose input names a token,
// and requires that the REAL middleware rejects it while the store is down: by its tier
// (auth / ai / export) or by FAIL_CLOSED_PATHS. (A CAPTCHA token is not a credential, but
// failing closed for it is harmless, so the scan stays broad rather than clever.)

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

const ROUTERS = join(__dirname, '../../packages/api/src/routers');
const ROOT_ROUTER = readFileSync(join(__dirname, '../../packages/api/src/root.ts'), 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : name.endsWith('.ts') && !name.endsWith('.test.ts') ? [p] : [];
  });
}

/** appRouter key for a router file: `aiInterview: aiInterviewRouter` + its import path. */
function appRouterKey(file: string): string | undefined {
  const rel = relative(ROUTERS, file).replace(/\.ts$/, '');
  const top = rel.split('/')[0]!;
  const imp = new RegExp(`import \\{ (\\w+) \\} from '\\./routers/${top}(?:/index)?';`).exec(ROOT_ROUTER);
  if (!imp) return undefined;
  return new RegExp(`(\\w+): ${imp[1]},`).exec(ROOT_ROUTER)?.[1];
}

function tokenCredentialPaths(): Array<{ path: string; type: 'query' | 'mutation' }> {
  const found: Array<{ path: string; type: 'query' | 'mutation' }> = [];
  for (const file of filesUnder(ROUTERS)) {
    const src = readFileSync(file, 'utf8');
    // Local procedures derived from publicProcedure, e.g. `const signingTokenProcedure = publicProcedure.use(...)`.
    const derived = [...src.matchAll(/const (\w+) = publicProcedure\b/g)].map((m) => m[1]!);
    const builders = ['publicProcedure', ...derived].join('|');
    const decls = [...src.matchAll(new RegExp(`^\\s+(\\w+):\\s*(?:${builders})\\b`, 'gm'))];
    for (const [n, m] of decls.entries()) {
      // The procedure's own text: up to the next public procedure declaration in this file.
      const from = m.index! + m[0].length;
      const tail = src.slice(from, decls[n + 1]?.index ?? src.length);
      const end = /\.(mutation|query)\(/.exec(tail);
      expect(end, `cannot tell query from mutation for ${m[1]}`).not.toBeNull();
      if (!/token/i.test(tail.slice(0, end!.index))) continue;
      const key = appRouterKey(file);
      expect(key, `cannot map ${relative(ROUTERS, file)} to an appRouter key`).toBeDefined();
      found.push({ path: `${key}.${m[1]}`, type: end![1] as 'query' | 'mutation' });
    }
  }
  return found;
}

describe('every token-credential public procedure fails closed during a shared-store outage', () => {
  const paths = tokenCredentialPaths();

  it('finds the known token flows (non-vacuity)', () => {
    expect(paths.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        'offer.getBySigningToken',
        'offer.acceptByToken',
        'offer.declineByToken',
        'platform.getInvitationByToken',
        'platform.acceptInvitation',
        'aiInterview.recordConsent',
        'aiInterview.start',
      ]),
    );
  });

  it('the middleware rejects each one while the shared store is down', async () => {
    vi.resetModules();
    stubSharedStoreEnv('production');
    installFakeDynamo('error');
    const { checkRateLimit, getRateLimitCategory } = await import('../../packages/api/src/middleware/rate-limit');
    const { logger } = await import('@tims/shared');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    for (const { path, type } of paths) {
      await expect(
        checkRateLimit('ip:203.0.113.9', getRateLimitCategory(path, type), { path }),
        path,
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
  });
});
