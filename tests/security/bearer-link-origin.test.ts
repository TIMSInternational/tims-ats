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

  // Review fix (2): the origin must be validated BEFORE the write that persists a live token, so a
  // misconfiguration cannot leave orphan rows. Router paths are checked by source order (their DB access
  // is inline); service paths are behaviour-tested in bearer-link-origin-before-write.test.ts.
  it.each([
    ['packages/api/src/routers/platform/invitations.ts', 'createOrgInvitation:', 'db.$transaction('],
    ['packages/api/src/routers/platform/invitations.ts', 'createUserInvitation:', 'db.platformInvitation.create('],
    ['packages/api/src/routers/interview/crud.ts', 'const joinToken = issueJoinToken(data.type', 'db.interview.create('],
    ['packages/api/src/routers/interview/crud.ts', 'const joinToken = issueJoinToken(existing.type', 'db.interview.update('],
    ['packages/api/src/routers/assessment.ts', 'const cooldownCutoff', 'db.assessmentAssignment.updateMany('],
  ] as const)('%s validates the origin before the write following %s', (path, anchor, write) => {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const anchorAt = source.indexOf(anchor);
    expect(anchorAt).toBeGreaterThan(-1);
    const writeAt = source.indexOf(write, anchorAt);
    expect(writeAt).toBeGreaterThan(-1);
    // The nearest getAppUrl() before the write must sit in the same procedure: after the previous
    // procedure boundary (`.mutation(`) that precedes the write.
    const procStart = source.lastIndexOf('.mutation(', writeAt);
    const validateAt = source.lastIndexOf('getAppUrl()', writeAt);
    expect(validateAt).toBeGreaterThan(procStart);
  });

  it('offer signing uses the same scheme rule while still requiring explicit configuration', () => {
    const source = readFileSync(join(ROOT, 'packages/api/src/routers/offer/signing.ts'), 'utf8');
    expect(source).toContain('new URL(getAppUrl())');
    expect(source).not.toContain('isAllowedSigningOrigin');
  });
});
