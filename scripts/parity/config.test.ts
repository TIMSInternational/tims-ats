import { describe, it, expect } from 'vitest';
import { parseConfig, parseEnvText, ConfigError } from './config';

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
