import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// Pure module (no k6 imports), shared with the k6 scripts.
import {
  isLoopback,
  parseBaseUrl,
  peakVus,
  sessionShortfall,
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
      expect(src, script).toMatch(/^assertSessionsCoverVus\(SESSIONS\.length, STAGES\);$/m);
    }
  });
});
