import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blockAt } from '../helpers/source-blocks';

it('keeps public invitation lookup read-only so it cannot overwrite revoke or resend', () => {
  const source = readFileSync('packages/api/src/routers/platform/invitations.ts', 'utf8');
  const lookup = blockAt(source, 'getInvitationByToken:');
  expect(lookup).toContain('const status =');
  expect(lookup).not.toContain('platformInvitation.update');
  expect(lookup).not.toContain('platformInvitation.updateMany');
});
