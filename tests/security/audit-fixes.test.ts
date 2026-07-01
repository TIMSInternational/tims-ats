import { describe, it, expect } from 'vitest';
import { redactOfferSettings } from '../../packages/api/src/routers/offer/offer-dto';
import { captchaBypassAllowed } from '../../packages/api/src/routers/portal-helpers';

describe('redactOfferSettings (offer signing-token leak fix)', () => {
  it('strips signingToken from settings but keeps other fields', () => {
    const offer = {
      id: 'o1',
      status: 'sent',
      settings: { signingToken: 'secret-token', signatureName: 'Jane Doe', acceptedAt: '2026-07-01' },
    };
    const out = redactOfferSettings(offer);
    expect((out.settings as Record<string, unknown>).signingToken).toBeUndefined();
    expect(out.settings).toEqual({ signatureName: 'Jane Doe', acceptedAt: '2026-07-01' });
    expect(out.id).toBe('o1');
    expect(out.status).toBe('sent');
  });

  it('does not mutate the input offer', () => {
    const offer = { id: 'o1', settings: { signingToken: 't', keep: 1 } };
    const snapshot = JSON.parse(JSON.stringify(offer));
    redactOfferSettings(offer);
    expect(offer).toEqual(snapshot);
  });

  it('is a no-op when settings is empty / has no token', () => {
    expect(redactOfferSettings({ id: 'o1', settings: {} }).settings).toEqual({});
    expect(redactOfferSettings({ id: 'o1', settings: { foo: 'bar' } }).settings).toEqual({ foo: 'bar' });
  });

  it('handles null / non-object settings safely', () => {
    expect(redactOfferSettings({ id: 'o1', settings: null }).settings).toBeNull();
    expect(redactOfferSettings({ id: 'o1', settings: undefined }).settings).toBeUndefined();
    // Arrays are not treated as key/value settings objects
    expect(redactOfferSettings({ id: 'o1', settings: ['x'] }).settings).toEqual(['x']);
  });

  it('passes through a null offer (nullable findUnique path)', () => {
    expect(redactOfferSettings<{ settings?: unknown }>(null)).toBeNull();
  });
});

describe('captchaBypassAllowed (portal CAPTCHA fail-closed fix)', () => {
  it('allows bypass only when the secret is missing AND not production', () => {
    expect(captchaBypassAllowed(undefined, 'development')).toBe(true);
    expect(captchaBypassAllowed(undefined, 'test')).toBe(true);
    expect(captchaBypassAllowed('', 'development')).toBe(true);
  });

  it('fails CLOSED in production when the secret is missing', () => {
    expect(captchaBypassAllowed(undefined, 'production')).toBe(false);
    expect(captchaBypassAllowed('', 'production')).toBe(false);
  });

  it('never bypasses when a secret is configured (token still required by caller)', () => {
    expect(captchaBypassAllowed('a-secret', 'production')).toBe(false);
    expect(captchaBypassAllowed('a-secret', 'development')).toBe(false);
  });
});
