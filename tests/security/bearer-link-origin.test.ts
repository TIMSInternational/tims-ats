import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const BEARER_LINK_SENDERS = [
  'packages/api/src/services/bulk-invitation.service.ts',
  'packages/api/src/services/ai-interview.service.ts',
  'packages/api/src/services/interview-email.service.ts',
  'packages/api/src/services/staff-provisioning.service.ts',
  'packages/api/src/routers/platform/invitations.ts',
  'packages/api/src/routers/platform/users.ts',
] as const;

describe('outbound bearer-link origin', () => {
  it.each(BEARER_LINK_SENDERS)('%s obtains its origin from the validated shared helper', (path) => {
    const source = readFileSync(join(ROOT, path), 'utf8');
    expect(source).toContain('getAppUrl');
    expect(source).not.toContain('process.env.NEXT_PUBLIC_APP_URL');
  });

  it('offer signing uses the same scheme rule while still requiring explicit configuration', () => {
    const source = readFileSync(join(ROOT, 'packages/api/src/routers/offer/signing.ts'), 'utf8');
    expect(source).toContain('new URL(getAppUrl())');
    expect(source).not.toContain('isAllowedSigningOrigin');
  });
});
