import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import robots from '../../apps/web/app/robots';

afterEach(() => {
  vi.unstubAllEnvs();
});

function rule() {
  const rules = robots().rules;
  return Array.isArray(rules) ? rules[0] : rules;
}

describe('robots.txt policy', () => {
  it('allows the public careers portal plus the assets and public reads it renders from, and disallows everything else', () => {
    expect(rule()?.userAgent).toBe('*');
    expect(rule()?.allow).toEqual([
      '/careers',
      '/_next/static/',
      '/_next/image',
      '/api/trpc/portal.',
      '/sitemap.xml',
      '/accept-invitation',
      '/reset-password',
      '/offers/sign/',
      '/interview/join/',
      '/ai-interview/',
    ]);
    expect(rule()?.disallow).toEqual(['/', '/careers/*/login', '/careers/*/dashboard', '/careers/*/me']);
  });

  it("keeps the candidate's signed-in portal pages out (longer than the /careers allow, so they win)", () => {
    const disallow = rule()?.disallow ?? [];
    const candidatePages = (Array.isArray(disallow) ? disallow : [disallow]).filter((p) => p.startsWith('/careers/'));
    expect(candidatePages.length).toBe(3);
    for (const path of candidatePages) expect(path.length).toBeGreaterThan('/careers'.length);
  });

  it('points at the sitemap only when the careers SEO surfaces are on, an organization opted in, and the origin is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ats.example.com');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    vi.stubEnv('CAREERS_SEO_ENABLED', '');
    expect(robots().sitemap).toBeUndefined();
    vi.stubEnv('CAREERS_SEO_ENABLED', 'true');
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', '');
    expect(robots().sitemap).toBeUndefined();
    vi.stubEnv('CAREERS_SEO_ORG_SLUGS', 'acme');
    expect(robots().sitemap).toBe('https://ats.example.com/sitemap.xml');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'not a url');
    expect(robots().sitemap).toBeUndefined();
  });

  it('is reachable without a session (listed as a public path in the middleware), and so is the sitemap', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/web/middleware.ts'), 'utf8');
    const publicPaths = /const PUBLIC_PATHS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
    expect(publicPaths).toMatch(/'\/robots\.txt'/);
    expect(publicPaths).toMatch(/'\/sitemap\.xml'/);
  });
});
