import { describe, it, expect } from 'vitest';
import { envSchema } from '../../apps/web/lib/env';

// PR #351 review fix (3): boot-time env validation used `z.string().url()` for NEXT_PUBLIC_APP_URL, which
// accepted plain http in production. It now applies the same checkAppOrigin rule as getAppUrl().

const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  DATABASE_URL: 'postgresql://user@localhost:5432/db',
};

function appUrlIssues(env: Record<string, string>): string[] {
  const parsed = envSchema.safeParse({ ...BASE, ...env });
  if (parsed.success) return [];
  return parsed.error.issues.filter((i) => i.path.join('.') === 'NEXT_PUBLIC_APP_URL').map((i) => i.message);
}

describe('env NEXT_PUBLIC_APP_URL origin rule', () => {
  it('rejects http on Vercel production', () => {
    const issues = appUrlIssues({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'http://ats.example.test',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/must use https in production/);
  });

  it('rejects http://localhost on Vercel production too', () => {
    expect(
      appUrlIssues({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }),
    ).toHaveLength(1);
  });

  it('rejects a public http origin under NODE_ENV=production off Vercel', () => {
    expect(appUrlIssues({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://ats.example.test' })).toHaveLength(1);
  });

  it('accepts https (with a trailing slash) on Vercel production', () => {
    expect(
      appUrlIssues({
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://tims-ats.vercel.app/',
      }),
    ).toEqual([]);
  });

  it('accepts http://localhost in development and test, and loopback for a local `next start`', () => {
    expect(appUrlIssues({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toEqual([]);
    expect(appUrlIssues({ NODE_ENV: 'test', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toEqual([]);
    expect(appUrlIssues({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toEqual([]);
  });

  it('rejects a real path with a clear message', () => {
    const issues = appUrlIssues({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'https://ats.example.test/app' });
    expect(issues).toEqual([expect.stringMatching(/origin only .* remove the path/)]);
  });

  it('treats blank as absent (getAppUrl falls back to the canonical origin)', () => {
    expect(appUrlIssues({ NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_APP_URL: '   ' })).toEqual([]);
  });
});
