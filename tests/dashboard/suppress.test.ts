import { describe, it, expect } from 'vitest';
import { suppressedValue } from '../../apps/web/lib/dashboard/suppress';

describe('suppressedValue', () => {
  it('renders the N/D label when suppressed', () => {
    expect(suppressedValue(null, true, 'N/D')).toBe('N/D');
    expect(suppressedValue(3, true, 'N/D')).toBe('N/D'); // suppressed wins even if a value leaked
  });
  it('renders the number when not suppressed', () => {
    expect(suppressedValue(42, false, 'N/D')).toBe('42');
    expect(suppressedValue(0, false, 'N/D')).toBe('0'); // 0 is a real, non-sensitive value
    expect(suppressedValue(-30, false, 'N/D')).toBe('-30'); // eNPS can be negative
  });
  it('renders an em-dash placeholder when value is missing and not suppressed (loading/empty)', () => {
    expect(suppressedValue(null, false, 'N/D')).toBe('—');
    expect(suppressedValue(undefined, false, 'N/D')).toBe('—');
  });
});
