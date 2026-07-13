import { describe, it, expect } from 'vitest';
import {
  ExternalValidationSubmitInput,
  toExternalValidationResultV1,
} from '../../packages/api/src/dto/external-validation';

describe('ExternalValidationSubmitInput', () => {
  const base = { validationId: '11111111-1111-1111-1111-111111111111', status: 'passed' as const, result: { checkedAt: '2026-07-13' } };
  it('accepts a well-formed passed/failed submission', () => {
    expect(ExternalValidationSubmitInput.parse(base).status).toBe('passed');
    expect(ExternalValidationSubmitInput.parse({ ...base, status: 'failed' }).status).toBe('failed');
  });
  it('rejects a non-passed/failed status (no pending/waived from a vendor)', () => {
    expect(() => ExternalValidationSubmitInput.parse({ ...base, status: 'pending' })).toThrow();
    expect(() => ExternalValidationSubmitInput.parse({ ...base, status: 'waived' })).toThrow();
  });
  it('rejects a result payload over the size cap', () => {
    const huge = { blob: 'x'.repeat(100_001) };
    expect(() => ExternalValidationSubmitInput.parse({ ...base, result: huge })).toThrow();
  });
  it('rejects a non-uuid validationId and over-long notes', () => {
    expect(() => ExternalValidationSubmitInput.parse({ ...base, validationId: 'nope' })).toThrow();
    expect(() => ExternalValidationSubmitInput.parse({ ...base, notes: 'x'.repeat(5001) })).toThrow();
  });
});

describe('toExternalValidationResultV1', () => {
  it('maps to the stable v1 shape', () => {
    const at = new Date('2026-07-13T00:00:00Z');
    expect(toExternalValidationResultV1({ id: 'val-1', status: 'passed', completedAt: at })).toEqual({
      schemaVersion: 'v1', id: 'val-1', status: 'passed', completedAt: at,
    });
  });
});
