import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFER_SIGNING_EXPIRED_MESSAGE } from '@tims/shared';

// WP-09 PR-1: the shared constant PR-7's signing page keys its "expired" state on.
// It must equal the literal the signing query throws today, so no client changes.
describe('OFFER_SIGNING_EXPIRED_MESSAGE', () => {
  it('equals the message the signing router throws', () => {
    expect(OFFER_SIGNING_EXPIRED_MESSAGE).toBe('Este enlace de firma ha expirado');
    const src = readFileSync(resolve(__dirname, '../../packages/api/src/routers/offer/signing.ts'), 'utf8');
    expect(src).toContain(OFFER_SIGNING_EXPIRED_MESSAGE);
  });
});
