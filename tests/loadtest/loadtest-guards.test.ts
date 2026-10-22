import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// Pure module (no k6 imports), shared with the k6 scripts.
import {
  isLoopback,
  parseBaseUrl,
  peakVus,
  sessionShortfall,
  distinctUserShortfall,
  targetRefusal,
} from '../../scripts/loadtest/lib/guards.js';

const LOADTEST_DIR = join(__dirname, '..', '..', 'scripts', 'loadtest');

describe('loadtest target-host interlock', () => {
  it('refuses URL userinfo, which would otherwise disguise a remote host as loopback', () => {
    expect(() => parseBaseUrl('WEB_BASE_URL', 'http://localhost:1@127.0.0.2:4399')).toThrow(/userinfo/);
    expect(() => parseBaseUrl('WEB_BASE_URL', 'http://localhost@example.com')).toThrow(/userinfo/);
    expect(() => parseBaseUrl('WEB_BASE_URL', 'https://user:pass@example.com/')).toThrow(/userinfo/);
    expect(() => targetRefusal(['http://localhost:1@127.0.0.2:4399'], [])).toThrow(/userinfo/);
  });

  it('parses the real host, so a non-loopback target needs LOADTEST_ALLOW_HOSTS', () => {
    expect(targetRefusal(['http://127.0.0.2:4399'], [])).toMatch(/Refusing to target "127\.0\.0\.2"/);
    expect(targetRefusal(['https://staging.example.com'], ['other.example.com'])).toMatch(/staging\.example\.com/);
    expect(targetRefusal(['https://Staging.Example.com/x'], [' staging.example.com '])).toBeUndefined();
    expect(targetRefusal(['http://localhost:3000', 'http://127.0.0.1:4310/api/platform'], [])).toBeUndefined();
  });

  it('recognises bracketed IPv6 loopback and rejects malformed authorities', () => {
    expect(parseBaseUrl('X', 'http://[::1]:3000/').host).toBe('[::1]');
    expect(isLoopback('[::1]')).toBe(true);
    expect(targetRefusal(['http://[::1]:3000'], [])).toBeUndefined();
    expect(targetRefusal(['http://[::2]:3000'], [])).toMatch(/Refusing to target "\[::2\]"/);
    expect(() => parseBaseUrl('X', 'http://[::1')).toThrow();
    expect(() => parseBaseUrl('X', 'http://localhost:abc')).toThrow(/port/);
    expect(() => parseBaseUrl('X', 'http://local%68ost')).toThrow();
    expect(() => parseBaseUrl('X', 'ftp://localhost')).toThrow(/not an http/);
    expect(parseBaseUrl('X', 'http://localhost:3000//').url).toBe('http://localhost:3000');
  });
});

describe('loadtest sessions vs VUs', () => {
  const ramp = [
    { duration: '1m', target: 5 },
    { duration: '3m', target: 5 },
    { duration: '30s', target: 0 },
  ];

  it('refuses a ramp with fewer sessions than peak VUs (one user per VU, per-user rate limit)', () => {
    expect(peakVus(ramp)).toBe(5);
    expect(sessionShortfall(1, peakVus(ramp), false)).toMatch(/VUS=5 but only 1 session/);
    expect(sessionShortfall(4, 5, false)).toBeDefined();
  });

  it('accepts enough sessions, or an explicit sharing override', () => {
    expect(sessionShortfall(5, 5, false)).toBeUndefined();
    expect(sessionShortfall(1, 1, false)).toBeUndefined();
    expect(sessionShortfall(1, 5, true)).toBeUndefined();
  });

  it('is enforced by both authenticated scenarios', () => {
    for (const script of ['staff-reads.js', 'platform-reads.js']) {
      const src = readFileSync(join(LOADTEST_DIR, script), 'utf8');
      expect(src, script).toMatch(/^assertSessionsCoverVus\(SESSIONS\.map\(sessionSubject\), STAGES\);$/m);
    }
  });

  // Tier-1 (Codex) review: entries were counted, not users.
  it('the scenario guard applies the distinct-user check, not only the entry count', () => {
    const config = readFileSync(join(LOADTEST_DIR, 'lib', 'config.js'), 'utf8');
    const fn = /export function assertSessionsCoverVus\([^]*?\n\}\n/.exec(config)?.[0] ?? '';
    expect(fn).toMatch(/distinctUserShortfall\(subjects, vus, shared\)/);
  });

  it('refuses duplicated sessions of one user, and sessions whose user cannot be read', () => {
    expect(distinctUserShortfall(['u1', 'u1', 'u1', 'u1', 'u1'], 5, false)).toMatch(/only 1 distinct user/);
    expect(distinctUserShortfall(['u1', 'u2', 'u3', 'u4', undefined], 5, false)).toMatch(/no readable user id/);
    expect(distinctUserShortfall(['u1', 'u2', 'u3', 'u4', 'u5'], 5, false)).toBeUndefined();
    expect(distinctUserShortfall(['u1', 'u1'], 2, true)).toBeUndefined();
  });
});

describe('loadtest never follows redirects (tier-1 review)', () => {
  it('every scenario disables redirects globally', () => {
    for (const script of ['careers.js', 'staff-reads.js', 'platform-reads.js']) {
      const src = readFileSync(join(LOADTEST_DIR, script), 'utf8');
      expect(src, script).toMatch(/export const options = \{\n[^]*?maxRedirects: 0,/);
    }
  });

  it('every request helper sets redirects: 0 unconditionally', () => {
    const lib = readFileSync(join(LOADTEST_DIR, 'lib', 'http.js'), 'utf8');
    for (const fn of ['getPage', 'trpcQuery', 'platformGet']) {
      const body = new RegExp(`export function ${fn}\\([^]*?\\n\\}\\n`).exec(lib)?.[0] ?? '';
      expect(body, fn).toMatch(/redirects(:|\s*=)\s*0/);
      expect(body, fn).not.toMatch(/if \(session && session\.cookie\) \{[^}]*redirects/);
    }
  });

  it('the C# preflight probes EVERY session, not just the first', () => {
    const src = readFileSync(join(LOADTEST_DIR, 'platform-reads.js'), 'utf8');
    expect(src).toMatch(/SESSIONS\.forEach\(\(session, s\) => \{\s*ENDPOINTS\.forEach/);
    expect(src).not.toMatch(/SESSIONS\[0\]/);
  });
});
