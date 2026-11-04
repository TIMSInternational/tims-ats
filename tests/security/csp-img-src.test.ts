import { describe, expect, it } from 'vitest';
import { buildCsp } from '../../apps/web/lib/security/csp';
import { CSP_IMG_SRC_HOSTS, isCspAllowedImageUrl } from '../../apps/web/lib/security/csp-img-src';

describe('CSP img-src single source of truth', () => {
  it('buildCsp emits exactly the shared host list (unchanged directive)', () => {
    const csp = buildCsp('nonce', '/careers/acme', { platformApi: '', cvUpload: '' }, true);
    expect(csp).toContain(
      "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.cloudfront.net",
    );
    expect(CSP_IMG_SRC_HOSTS).toHaveLength(3);
  });
});

describe('isCspAllowedImageUrl (organization logos)', () => {
  it('allows https images on the allowed hosts', () => {
    expect(isCspAllowedImageUrl('https://abc.supabase.co/storage/v1/object/public/logos/a.png')).toBe(true);
    expect(isCspAllowedImageUrl('https://lh3.googleusercontent.com/a.png')).toBe(true);
    expect(isCspAllowedImageUrl('https://d123.cloudfront.net/logo.svg')).toBe(true);
  });

  it('refuses what the browser would block', () => {
    // A tenant's own website (the pilot case), plain http, look-alike hosts, bare apex, odd ports.
    expect(isCspAllowedImageUrl('https://www.example.go.cr/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('http://abc.supabase.co/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('https://abc.supabase.co.evil.com/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('https://evilsupabase.co/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('https://supabase.co/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('https://abc.supabase.co:8443/logo.png')).toBe(false);
    expect(isCspAllowedImageUrl('not a url')).toBe(false);
    expect(isCspAllowedImageUrl('data:image/png;base64,AAAA')).toBe(false);
  });
});
