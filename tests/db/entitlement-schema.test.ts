import { describe, it, expect } from 'vitest';
import { db } from '@tims/db';

describe('entitlement schema', () => {
  it('exposes entitlement models on the client', () => {
    expect(db.module).toBeDefined();
    expect(db.plan).toBeDefined();
    expect(db.planModule).toBeDefined();
    expect(db.orgEntitlement).toBeDefined();
  });
});
