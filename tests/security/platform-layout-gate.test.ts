import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Wave 2.5 Slice 2 — /platform pages must be gated server-side, not only at the
// API. Before this gate, a non-owner staffer navigating to /platform/* rendered
// the page shell and then errored on FORBIDDEN tRPC calls.
const LAYOUT = join(
  __dirname, '..', '..',
  'apps/web/app/(admin)/platform/layout.tsx',
);

describe('/platform server-side layout gate', () => {
  it('exists', () => {
    expect(existsSync(LAYOUT)).toBe(true);
  });

  it('is a server component (no "use client")', () => {
    expect(readFileSync(LAYOUT, 'utf8')).not.toContain("'use client'");
  });

  it('checks isPlatformOwner on the REAL identity and redirects non-owners', () => {
    const src = readFileSync(LAYOUT, 'utf8');
    expect(src).toContain('isPlatformOwner');
    expect(src).toContain('supabaseUserId');
    expect(src).toMatch(/redirect\(/);
  });

  it('consults the impersonation cookie ONLY to deny (consistency with platformProcedure)', () => {
    // While impersonating, the tRPC ctx is the impersonated non-owner and
    // platformProcedure FORBIDs platform calls — so the gate must also bounce,
    // or the shell renders then errors. The cookie check runs AFTER the
    // real-owner check, so it can only narrow access, never grant it.
    const src = readFileSync(LAYOUT, 'utf8');
    expect(src).toContain('IMPERSONATION_COOKIE');
    expect(src).toContain('verifyImpersonationToken');
    // deny-only: the owner check on the real identity must come first
    expect(src.indexOf('isPlatformOwner')).toBeLessThan(src.indexOf('verifyImpersonationToken'));
  });
});
