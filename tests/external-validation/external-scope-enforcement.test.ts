import { describe, it, expect } from 'vitest';
import { externalScopeSatisfied } from '../../packages/api/src/access/external-scope';

describe('externalScopeSatisfied — external API-key scope narrowing', () => {
  it('DENIES an empty-scope key when enforcement is unconditional (the vendor write)', () => {
    // alwaysEnforceScope=true: an existing read-only key with scopes:[] can NOT reach
    // the validation write just because the role grant was added.
    expect(externalScopeSatisfied('validation:write', [], true)).toBe(false);
  });
  it('ALLOWS a key that explicitly carries validation:write', () => {
    expect(externalScopeSatisfied('validation:write', ['validation:write'], true)).toBe(true);
  });
  it('DENIES a non-empty-scope key that omits validation:write', () => {
    expect(externalScopeSatisfied('validation:write', ['assessment:read'], true)).toBe(false);
  });
  it('preserves the historical wildcard for read endpoints (empty scope = unrestricted)', () => {
    expect(externalScopeSatisfied('assessment:read', [], false)).toBe(true);
  });
  it('still narrows a non-empty-scope key on the read surface', () => {
    expect(externalScopeSatisfied('assessment:read', ['other:scope'], false)).toBe(false);
    expect(externalScopeSatisfied('assessment:read', ['assessment:read'], false)).toBe(true);
  });
  it('treats an absent requiredScope as always satisfied', () => {
    expect(externalScopeSatisfied(undefined, [], true)).toBe(true);
  });
});
