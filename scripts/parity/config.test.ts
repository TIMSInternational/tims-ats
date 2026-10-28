import { describe, it, expect } from 'vitest';
import { parseConfig, parseEnvText, ConfigError, resolveDatabaseUrl, mergeEnv } from './config';

describe('parseEnvText', () => {
  it('strips a trailing inline comment (dotenv convention) from the value', () => {
    const out = parseEnvText('SUPABASE_ANON_KEY=abc  # trailing comment');
    expect(out.SUPABASE_ANON_KEY).toBe('abc');
  });

  it('skips full-line comments and blank lines', () => {
    const out = parseEnvText(['# a top comment', '', 'SUPABASE_URL=https://x.supabase.co', ''].join('\n'));
    expect(out).toEqual({ SUPABASE_URL: 'https://x.supabase.co' });
  });

  it('preserves a value with no inline comment verbatim (e.g. a URL)', () => {
    const out = parseEnvText('SUPABASE_URL=https://x.supabase.co');
    expect(out.SUPABASE_URL).toBe('https://x.supabase.co');
  });

  it('preserves a dot-delimited token value with no spaces verbatim (JWT-shaped)', () => {
    // Not a real credential: three dot-separated segments, no leading "eyJ", low entropy —
    // shaped like a JWT for parser purposes without tripping secret scanners.
    const tokenLike = 'header-segment.payload-segment.signature-segment-0123456789';
    const out = parseEnvText(`SUPABASE_SERVICE_ROLE_KEY=${tokenLike}`);
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe(tokenLike);
  });
});

describe('parseConfig', () => {
  it('returns a typed config when all vars present', () => {
    const cfg = parseConfig({
      SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PROJECT_REF: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a',
      TIMS_CSHARP_BASE: 'https://c', TIMS_TS_BASE: 'https://t',
    });
    expect(cfg.projectRef).toBe('x');
    expect(cfg.tsBase).toBe('https://t');
  });
  it('throws ConfigError listing ALL missing vars', () => {
    try { parseConfig({}); throw new Error('did not throw'); }
    catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect((e as ConfigError).message).toContain('TIMS_TS_BASE');
    }
  });
});

// Placeholder connection strings — no real host, user or password.
const BASE_ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PROJECT_REF: 'x',
  SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a',
  TIMS_CSHARP_BASE: 'https://c', TIMS_TS_BASE: 'https://t',
};
const DIRECT = 'postgresql://postgres:pw@db.example-ref.supabase.co:5432/postgres';
const POOLER = 'postgresql://postgres.example-ref:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres';

describe('resolveDatabaseUrl — PARITY_DATABASE_URL (IPv4 session pooler) precedence', () => {
  it('uses PARITY_DATABASE_URL over DATABASE_URL when both are set', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: DIRECT, PARITY_DATABASE_URL: POOLER })).toEqual({
      url: POOLER,
      source: 'PARITY_DATABASE_URL',
    });
  });

  it('falls back to DATABASE_URL when the override is unset, empty or whitespace', () => {
    for (const override of [undefined, '', '   ']) {
      expect(resolveDatabaseUrl({ DATABASE_URL: DIRECT, PARITY_DATABASE_URL: override }), String(override)).toEqual({
        url: DIRECT,
        source: 'DATABASE_URL',
      });
    }
  });

  it('uses the override alone when DATABASE_URL is absent, and returns undefined when neither is set', () => {
    expect(resolveDatabaseUrl({ PARITY_DATABASE_URL: POOLER })?.url).toBe(POOLER);
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it('parseConfig threads the winning URL into cfg.databaseUrl', () => {
    expect(parseConfig({ ...BASE_ENV, DATABASE_URL: DIRECT, PARITY_DATABASE_URL: POOLER }).databaseUrl).toBe(POOLER);
    expect(parseConfig({ ...BASE_ENV, DATABASE_URL: DIRECT }).databaseUrl).toBe(DIRECT);
    expect(parseConfig(BASE_ENV).databaseUrl).toBeUndefined();
  });

  it('REFUSES an override carrying TLS params — pg would let them replace the pinned verify-full config', () => {
    for (const q of ['sslmode=no-verify', 'sslmode=require', 'ssl=true', 'sslrootcert=/tmp/x.pem', 'uselibpqcompat=true']) {
      expect(() => resolveDatabaseUrl({ PARITY_DATABASE_URL: `${POOLER}?${q}` }), q).toThrow(ConfigError);
    }
    // A non-TLS query param is fine.
    expect(resolveDatabaseUrl({ PARITY_DATABASE_URL: `${POOLER}?application_name=parity` })?.source).toBe(
      'PARITY_DATABASE_URL',
    );
  });

  it('rejects an override that is not a postgres URL', () => {
    expect(() => resolveDatabaseUrl({ PARITY_DATABASE_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => resolveDatabaseUrl({ PARITY_DATABASE_URL: 'https://example.com/db' })).toThrow(/postgres/);
  });
});

describe('mergeEnv — .env over process.env, except the per-invocation DB override', () => {
  it('a process.env PARITY_DATABASE_URL beats a stale one in scripts/parity/.env', () => {
    const merged = mergeEnv({ PARITY_DATABASE_URL: POOLER }, { PARITY_DATABASE_URL: 'postgresql://stale@h/db', DATABASE_URL: DIRECT });
    expect(merged.PARITY_DATABASE_URL).toBe(POOLER);
    expect(resolveDatabaseUrl(merged)?.url).toBe(POOLER);
  });

  it('every other key keeps the file-over-process precedence', () => {
    const merged = mergeEnv({ DATABASE_URL: 'postgresql://proc@h/db', TIMS_TS_BASE: 'p' }, { DATABASE_URL: DIRECT, TIMS_TS_BASE: 'f' });
    expect(merged.DATABASE_URL).toBe(DIRECT);
    expect(merged.TIMS_TS_BASE).toBe('f');
  });

  it('a blank process.env override does not shadow the file value', () => {
    expect(mergeEnv({ PARITY_DATABASE_URL: '' }, { PARITY_DATABASE_URL: POOLER }).PARITY_DATABASE_URL).toBe(POOLER);
  });
});
