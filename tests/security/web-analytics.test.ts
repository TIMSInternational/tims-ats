import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
// The package resolves from apps/web (the repo root has no copy of its own), so the mock names that path.
vi.mock('../../apps/web/node_modules/@vercel/analytics', () => ({ track }));

import {
  FUNNEL_MAX_RETRIES,
  FUNNEL_RETRY_MS,
  flushCareersFunnel,
  isWebAnalyticsEnabled,
  MAX_PENDING_FUNNEL_STEPS,
  scrubAnalyticsEvent,
  scrubAnalyticsUrl,
  trackCareersFunnel,
} from '../../apps/web/lib/analytics/web-analytics';
import { buildCsp, WEB_ANALYTICS_DEBUG_SCRIPT_ORIGIN, webAnalyticsScriptOrigin } from '../../apps/web/lib/security/csp';
import { BEARER_QUERY_PATHS, BEARER_TOKEN_PATH_PREFIXES } from '../../apps/web/lib/security/bearer-links';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const ORIGIN = 'https://ats.example.com';
const UUID = '0d6c3f4e-7a1b-4c2d-9e8f-1a2b3c4d5e6f';

/** Every .ts/.tsx source file under apps/web, outside node_modules and build output. */
function webSourceFiles(dir: string = resolve(ROOT, 'apps/web')): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'public') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...webSourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Stands in for the browser: `va` present means <Analytics/> has set up its queue. */
function stubWindow(withQueue: boolean): void {
  vi.stubGlobal('window', withQueue ? { va: vi.fn() } : {});
}

function directive(csp: string, name: string): string[] {
  return (csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '').split(' ');
}

beforeEach(() => {
  track.mockReset();
});

afterEach(() => {
  // Drain anything a test left waiting (this also cancels a pending retry), then restore the real globals.
  stubWindow(true);
  flushCareersFunnel();
  track.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Web Analytics is off by default', () => {
  it('only the exact string "true" turns it on', () => {
    expect(isWebAnalyticsEnabled(undefined)).toBe(false);
    for (const value of ['', 'TRUE', '1', 'yes', ' true']) expect(isWebAnalyticsEnabled(value)).toBe(false);
    expect(isWebAnalyticsEnabled('true')).toBe(true);
  });

  it('the root layout mounts the component only behind the flag, and it always passes the scrubber', () => {
    const layout = read('apps/web/app/layout.tsx');
    expect(layout).toMatch(/\{isWebAnalyticsEnabled\(\) && <WebAnalytics \/>\}/);
    const component = read('apps/web/components/web-analytics.tsx');
    expect(component).toMatch(/<Analytics beforeSend=\{scrubAnalyticsEvent\} \/>/);
  });

  it('nothing else imports the package', () => {
    const importers = webSourceFiles()
      .filter((path) => /from '@vercel\/analytics[^']*'/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))
      .sort();
    expect(importers).toEqual(['apps/web/components/web-analytics.tsx', 'apps/web/lib/analytics/web-analytics.ts']);
  });

  it('the package is pinned to an exact version', () => {
    const pkg = JSON.parse(read('apps/web/package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@vercel/analytics']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('what a page view may report', () => {
  it('drops the query string and the fragment', () => {
    expect(scrubAnalyticsUrl(`${ORIGIN}/careers/acme?email=a%40b.co&utm_source=x#apply`)).toBe(
      `${ORIGIN}/careers/acme`,
    );
  });

  it('replaces identifier-shaped path segments', () => {
    expect(scrubAnalyticsUrl(`${ORIGIN}/recruitment/candidates/${UUID}`)).toBe(`${ORIGIN}/recruitment/candidates/[id]`);
    expect(scrubAnalyticsUrl(`${ORIGIN}/careers/acme/dashboard/assessments/${UUID}`)).toBe(
      `${ORIGIN}/careers/acme/dashboard/assessments/[id]`,
    );
    expect(scrubAnalyticsUrl(`${ORIGIN}/x/Q2xhdWRlMTIzNDU2Nzg5MGFiY2RlZg`)).toBe(`${ORIGIN}/x/[id]`);
    // Route names and organization slugs stay readable.
    expect(scrubAnalyticsUrl(`${ORIGIN}/careers/tims-international`)).toBe(`${ORIGIN}/careers/tims-international`);
  });

  it('never reports a page whose URL is a credential (every bearer-link route)', () => {
    for (const prefix of BEARER_TOKEN_PATH_PREFIXES) {
      expect(scrubAnalyticsUrl(`${ORIGIN}${prefix}abc123`)).toBeNull();
    }
    for (const path of BEARER_QUERY_PATHS) {
      expect(scrubAnalyticsUrl(`${ORIGIN}${path}?token=secret`)).toBeNull();
    }
    expect(scrubAnalyticsEvent({ type: 'pageview', url: `${ORIGIN}/ai-interview/tok` })).toBeNull();
  });

  it('scrubs custom events the same way and keeps their type', () => {
    expect(scrubAnalyticsEvent({ type: 'event', url: `${ORIGIN}/careers/acme/${UUID}?x=1` })).toEqual({
      type: 'event',
      url: `${ORIGIN}/careers/acme/[id]`,
    });
    expect(scrubAnalyticsEvent({ type: 'pageview', url: 'not a url' })).toBeNull();
  });
});

describe('careers funnel events', () => {
  it('send nothing while analytics is off', () => {
    stubWindow(true);
    trackCareersFunnel('careers_view', 'acme', false);
    expect(track).not.toHaveBeenCalled();
  });

  it('carry only the public careers slug when on', () => {
    stubWindow(true);
    trackCareersFunnel('application_submitted', 'acme', true);
    expect(track).toHaveBeenCalledWith('application_submitted', { org: 'acme' });
  });

  it('never throw into the candidate flow', () => {
    stubWindow(true);
    track.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(() => trackCareersFunnel('apply_started', 'acme', true)).not.toThrow();
  });

  it('wait for the analytics queue instead of being dropped, then go out in order', () => {
    vi.useFakeTimers();
    stubWindow(false);
    trackCareersFunnel('careers_view', 'acme', true);
    trackCareersFunnel('apply_started', 'acme', true);
    vi.advanceTimersByTime(FUNNEL_RETRY_MS * 3);
    expect(track).not.toHaveBeenCalled();

    stubWindow(true);
    vi.advanceTimersByTime(FUNNEL_RETRY_MS);
    expect(track.mock.calls).toEqual([
      ['careers_view', { org: 'acme' }],
      ['apply_started', { org: 'acme' }],
    ]);
  });

  it('go out as soon as <WebAnalytics/> flushes, without waiting for the retry', () => {
    vi.useFakeTimers();
    stubWindow(false);
    trackCareersFunnel('careers_view', 'acme', true);
    stubWindow(true);
    flushCareersFunnel();
    expect(track).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FUNNEL_RETRY_MS * 5);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('are bounded while waiting, and dropped if analytics never starts', () => {
    vi.useFakeTimers();
    stubWindow(false);
    for (let i = 0; i < MAX_PENDING_FUNNEL_STEPS + 5; i++) trackCareersFunnel('careers_view', `org-${i}`, true);
    stubWindow(true);
    flushCareersFunnel();
    expect(track).toHaveBeenCalledTimes(MAX_PENDING_FUNNEL_STEPS);

    track.mockReset();
    stubWindow(false);
    trackCareersFunnel('careers_view', 'acme', true);
    vi.advanceTimersByTime(FUNNEL_RETRY_MS * (FUNNEL_MAX_RETRIES + 2));
    stubWindow(true);
    flushCareersFunnel();
    vi.advanceTimersByTime(FUNNEL_RETRY_MS * 5);
    expect(track).not.toHaveBeenCalled();
  });

  it('are wired at the three funnel steps with nothing but the slug (no candidate data)', () => {
    const board = read('apps/web/app/(portal)/careers/[orgSlug]/job-board.tsx');
    const detail = read('apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/job-detail-view.tsx');
    const apply = read('apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal.tsx');
    expect(board).toContain("trackCareersFunnel('careers_view', orgSlug)");
    expect(detail).toContain("trackCareersFunnel('apply_started', orgSlug)");
    expect(apply).toContain("trackCareersFunnel('application_submitted', params?.orgSlug ?? '')");
    // Exactly these three calls exist in the app.
    const calls = [board, detail, apply].join('\n').match(/trackCareersFunnel\(/g) ?? [];
    expect(calls).toHaveLength(3);
  });
});

describe('CSP for Web Analytics', () => {
  const ORIGINS = { platformApi: '', cvUpload: '' };

  it('production needs no extra source: the script and beacons are same-origin (/_vercel/insights)', () => {
    expect(webAnalyticsScriptOrigin('true', true)).toBe('');
    const csp = buildCsp(
      'n',
      '/careers/acme',
      { ...ORIGINS, webAnalyticsScript: webAnalyticsScriptOrigin('true', true) },
      true,
    );
    expect(directive(csp, 'script-src')).toContain("'self'");
    expect(directive(csp, 'connect-src')).toContain("'self'");
    expect(csp).not.toContain('vercel-scripts');
    // No strict-dynamic: 'self' keeps allowing the same-origin script next to the nonce.
    expect(csp).not.toContain('strict-dynamic');
  });

  it('a non-production build with analytics on allows only the debug script host, in script-src', () => {
    const origin = webAnalyticsScriptOrigin('true', false);
    expect(origin).toBe(WEB_ANALYTICS_DEBUG_SCRIPT_ORIGIN);
    const csp = buildCsp('n', '/careers/acme', { ...ORIGINS, webAnalyticsScript: origin }, false);
    expect(directive(csp, 'script-src')).toContain(WEB_ANALYTICS_DEBUG_SCRIPT_ORIGIN);
    expect(directive(csp, 'connect-src')).not.toContain(WEB_ANALYTICS_DEBUG_SCRIPT_ORIGIN);
  });

  it('adds nothing while analytics is off', () => {
    for (const value of [undefined, '', 'TRUE']) expect(webAnalyticsScriptOrigin(value, false)).toBe('');
    expect(buildCsp('n', '/', ORIGINS, false)).not.toContain('vercel-scripts');
  });

  it("the middleware feeds the flag into the CSP and keeps the platform's /_vercel/ paths out of the auth redirect", () => {
    const middleware = read('apps/web/middleware.ts');
    expect(middleware).toMatch(
      /webAnalyticsScript: webAnalyticsScriptOrigin\(process\.env\.NEXT_PUBLIC_WEB_ANALYTICS_ENABLED, IS_PROD\)/,
    );
    const matcher = /matcher: \[\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/.exec(middleware)?.[1] ?? '';
    expect(matcher).toContain('_vercel/');
    // Only the platform path space is excluded: /api still always runs the middleware.
    expect(middleware).toContain("'/api/:path*'");
  });
});
