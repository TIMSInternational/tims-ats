import { describe, expect, it } from 'vitest';
import {
  allowedUses,
  assessmentFormSchema,
  defaultUse,
  minimumRequired,
  newRow,
  toInput,
  toRow,
} from '../../apps/web/lib/assessments/vacancy-assessment-form';

// The vacancy assessments editor's rules mirror what FIT v2 accepts (FitV2Kernels.TryParseRequirement): the server is
// strict, so anything the editor lets through must be an entry FIT keeps.

const row = (extra: Partial<ReturnType<typeof newRow>> = {}) => ({
  ...newRow('lia'),
  reason: 'Análisis',
  minimum: '40',
  ...extra,
});
const errors = (rows: unknown[]) => {
  const parsed = assessmentFormSchema.safeParse({ rows });
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('vacancy assessment form rules', () => {
  it('defaults each instrument to FIT v2 default use and limits the advisory-only ones', () => {
    expect(defaultUse('english')).toBe('gate');
    expect(defaultUse('lia')).toBe('scored');
    expect(defaultUse('personality')).toBe('advisory');
    expect(allowedUses('pca')).toEqual(['advisory']);
    expect(allowedUses('itcia')).toEqual(['scored', 'gate', 'advisory']);
  });

  it('needs a minimum for every scored or gated use except a scored quiz', () => {
    expect(minimumRequired('lia', 'scored')).toBe(true);
    expect(minimumRequired('english', 'gate')).toBe(true);
    expect(minimumRequired('lia', 'advisory')).toBe(false);
    expect(minimumRequired('native_quiz', 'scored')).toBe(false);
    expect(minimumRequired('native_quiz', 'gate')).toBe(true);
  });

  it('accepts a complete row and refuses a missing or overlong reason', () => {
    expect(errors([row()])).toEqual([]);
    expect(errors([row({ reason: '   ' })])).toEqual(['rows.0.reason:errorReasonRequired']);
    expect(errors([row({ reason: 'x'.repeat(501) })])).toEqual(['rows.0.reason:errorReasonRequired']);
    // Codex atsux run 1 [P2]: the assignment refuses fewer than 3 characters or a control character.
    expect(errors([row({ reason: 'IA' })])).toEqual(['rows.0.reason:errorReasonRequired']);
    expect(errors([row({ reason: 'uso\u0007datos' })])).toEqual(['rows.0.reason:errorReasonRequired']);
    expect(errors([row({ reason: 'dos\nlíneas' })])).toEqual([]); // a line break is sent as a space
    expect(toInput(row({ reason: ' dos\n  líneas ' })).reason).toBe('dos líneas');
  });

  it('checks each minimum by its instrument', () => {
    expect(errors([row({ minimum: '' })])).toEqual(['rows.0.minimum:errorMinimumInvalid']);
    expect(errors([row({ minimum: '140' })])).toEqual(['rows.0.minimum:errorMinimumInvalid']);
    expect(errors([{ ...newRow('english'), reason: 'Razón', minimum: 'B3' }])).toEqual([
      'rows.0.minimum:errorMinimumInvalid',
    ]);
    expect(errors([{ ...newRow('itcia'), reason: 'Razón', minimum: '2.5' }])).toEqual([
      'rows.0.minimum:errorMinimumInvalid',
    ]);
    expect(errors([{ ...newRow('itcia'), reason: 'Razón', minimum: '3' }])).toEqual([]);
    expect(errors([{ ...newRow('native_quiz'), reason: 'Razón', minimum: '' }])).toEqual([]);
    expect(errors([row({ use: 'advisory', minimum: 'garbage' })])).toEqual([]);
  });

  it('refuses a use the instrument does not allow, and a duplicate instrument', () => {
    expect(errors([{ ...newRow('personality'), reason: 'Razón', use: 'scored' }])).toEqual([
      'rows.0.use:errorUseNotAllowed',
    ]);
    expect(errors([row(), row()])).toHaveLength(1);
  });

  it('sends a minimum only where the use takes one and a stored weight only on a scored non-English entry', () => {
    expect(toInput(row({ reason: '  Análisis  ', weight: 2 }))).toEqual({
      instrument: 'lia',
      use: 'scored',
      min: { globalPercentile: 40 },
      weight: 2,
      reason: 'Análisis',
    });
    expect(toInput(row({ use: 'advisory', weight: 2 }))).toEqual({
      instrument: 'lia',
      use: 'advisory',
      reason: 'Análisis',
    });
    expect(toInput({ ...newRow('english'), use: 'scored', minimum: 'B2', reason: 'Razón', weight: 3 })).toEqual({
      instrument: 'english',
      use: 'scored',
      min: { cefr: 'B2' },
      reason: 'Razón',
    });
  });

  it('round-trips a stored requirement', () => {
    const stored = {
      instrument: 'itcia' as const,
      use: 'gate' as const,
      min: { globalPercentile: null, cefr: null, level: 3, score: null },
      weight: null,
      reason: 'IA',
    };
    expect(toInput(toRow(stored))).toEqual({ instrument: 'itcia', use: 'gate', min: { level: 3 }, reason: 'IA' });
  });
});
