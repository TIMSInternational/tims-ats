import { describe, it, expect } from 'vitest';
import {
  isMfaEnforced,
  isMfaSatisfied,
  isMfaGateBlocking,
  mfaMode,
} from '../../apps/web/lib/mfa';

describe('isMfaEnforced', () => {
  it('is true ONLY for the literal string "true"', () => {
    expect(isMfaEnforced('true')).toBe(true);
  });
  it('is false for undefined / empty / any other value (fail-open is acceptable: opt-in flag)', () => {
    expect(isMfaEnforced(undefined)).toBe(false);
    expect(isMfaEnforced('')).toBe(false);
    expect(isMfaEnforced('false')).toBe(false);
    expect(isMfaEnforced('1')).toBe(false);
    expect(isMfaEnforced('TRUE')).toBe(false);
  });
});

describe('isMfaSatisfied', () => {
  it('is satisfied only at aal2', () => {
    expect(isMfaSatisfied('aal2')).toBe(true);
  });
  it('is NOT satisfied at aal1 / null / undefined (fail-closed)', () => {
    expect(isMfaSatisfied('aal1')).toBe(false);
    expect(isMfaSatisfied(null)).toBe(false);
    expect(isMfaSatisfied(undefined)).toBe(false);
  });
});

describe('isMfaGateBlocking — privileged-route gate', () => {
  it('never blocks when enforcement is OFF, regardless of role or AAL', () => {
    expect(isMfaGateBlocking({ enforced: false, isPrivileged: true, currentLevel: 'aal1' })).toBe(false);
    expect(isMfaGateBlocking({ enforced: false, isPrivileged: true, currentLevel: null })).toBe(false);
  });

  it('never blocks non-privileged users even when enforcement is ON', () => {
    expect(isMfaGateBlocking({ enforced: true, isPrivileged: false, currentLevel: 'aal1' })).toBe(false);
  });

  it('blocks a privileged user at aal1 when enforcement is ON', () => {
    expect(isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: 'aal1' })).toBe(true);
  });

  it('blocks a privileged user with unknown AAL when enforcement is ON (fail-closed)', () => {
    expect(isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: null })).toBe(true);
    expect(isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: undefined })).toBe(true);
  });

  it('does NOT block a privileged user who has stepped up to aal2', () => {
    expect(isMfaGateBlocking({ enforced: true, isPrivileged: true, currentLevel: 'aal2' })).toBe(false);
  });
});

describe('mfaMode — what the /mfa page should render', () => {
  it('enroll when there is no verified factor', () => {
    expect(mfaMode({ hasVerifiedFactor: false, currentLevel: 'aal1' })).toBe('enroll');
    expect(mfaMode({ hasVerifiedFactor: false, currentLevel: null })).toBe('enroll');
  });

  it('challenge (step-up) when a factor exists but the session is still aal1', () => {
    expect(mfaMode({ hasVerifiedFactor: true, currentLevel: 'aal1' })).toBe('challenge');
  });

  it('enabled when a factor exists and the session is aal2', () => {
    expect(mfaMode({ hasVerifiedFactor: true, currentLevel: 'aal2' })).toBe('enabled');
  });
});
