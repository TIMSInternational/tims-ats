import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const RATE_LIMIT_FILE = join(ROOT, 'packages/api/src/middleware/rate-limit.ts');
const TRPC_FILE = join(ROOT, 'packages/api/src/trpc.ts');

describe('Rate Limiting', () => {
  it('should have rate limiting middleware file', () => {
    expect(existsSync(RATE_LIMIT_FILE)).toBe(true);
  });

  it('should use Upstash Redis (not just in-memory)', () => {
    const content = readFileSync(RATE_LIMIT_FILE, 'utf8');
    expect(content).toContain('@upstash/ratelimit');
    expect(content).toContain('@upstash/redis');
  });

  it('should have rate limit categories for auth, mutations, and queries', () => {
    const content = readFileSync(RATE_LIMIT_FILE, 'utf8');
    expect(content).toContain('auth');
    expect(content).toContain('mutation');
    expect(content).toContain('query');
  });

  it('should apply rate limiting in tRPC middleware stack', () => {
    const content = readFileSync(TRPC_FILE, 'utf8');
    expect(content).toContain('withRateLimit');
    expect(content).toContain('checkRateLimit');
  });

  it('should have fallback for local dev without Redis', () => {
    const content = readFileSync(RATE_LIMIT_FILE, 'utf8');
    // Should check for env vars and fallback gracefully
    expect(content).toContain('UPSTASH_REDIS');
  });
});
