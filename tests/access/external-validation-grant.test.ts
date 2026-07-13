import { describe, it, expect } from 'vitest';
import { MATRIX } from '../../packages/db/prisma/seed-access-matrix';
import { MODULES } from '../../packages/shared/src/types/permissions';

describe('external role — validation write grant', () => {
  it('MODULES includes validation', () => {
    expect(MODULES).toContain('validation');
  });
  it('external role has validation:update at organization scope, and still assessment:read', () => {
    const grants = MATRIX.external;
    expect(grants).toEqual(
      expect.arrayContaining([
        { module: 'assessment', actions: ['read'], scope: 'organization' },
        { module: 'validation', actions: ['update'], scope: 'organization' },
      ]),
    );
  });
});
