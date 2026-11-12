import { describe, expect, it } from 'vitest';
import {
  allowedUses,
  assessmentFormSchema,
  defaultUse,
  jobCodeRequired,
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
    expect(allowedUses('personality')).toEqual(['advisory']);
    expect(allowedUses('mi')).toEqual(['advisory']);
    // TIMS 2026-11-12: PCA may be scored or gated, on TIMS's job fit to the vacancy's position code.
    expect(allowedUses('pca')).toEqual(['scored', 'gate', 'advisory']);
    expect(defaultUse('pca')).toBe('advisory');
    expect(allowedUses('itcia')).toEqual(['scored', 'gate', 'advisory']);
  });

  it('needs a minimum for every scored or gated use except a scored quiz', () => {
    expect(minimumRequired('lia', 'scored')).toBe(true);
    expect(minimumRequired('english', 'gate')).toBe(true);
    expect(minimumRequired('lia', 'advisory')).toBe(false);
    expect(minimumRequired('native_quiz', 'scored')).toBe(false);
    expect(minimumRequired('native_quiz', 'gate')).toBe(true);
    expect(minimumRequired('pca', 'scored')).toBe(false);
    expect(minimumRequired('pca', 'gate')).toBe(true);
    expect(minimumRequired('pca', 'advisory')).toBe(false);
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
    expect(toInput(row({ reason: '  Análisis  ', weight: '2' }))).toEqual({
      instrument: 'lia',
      use: 'scored',
      min: { globalPercentile: 40 },
      weight: 2,
      reason: 'Análisis',
    });
    expect(toInput(row({ use: 'advisory', weight: '2' }))).toEqual({
      instrument: 'lia',
      use: 'advisory',
      reason: 'Análisis',
    });
    expect(toInput({ ...newRow('english'), use: 'scored', minimum: 'B2', reason: 'Razón', weight: '3' })).toEqual({
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
      min: { globalPercentile: null, cefr: null, level: 3, score: null, jobFit: null },
      weight: null,
      reason: 'IA',
      jobCode: null,
    };
    expect(toInput(toRow(stored))).toEqual({ instrument: 'itcia', use: 'gate', min: { level: 3 }, reason: 'IA' });
  });
});

// TIMS 2026-11-12: PCA's fit is TIMS's own PCA-vs-JCA fit to the vacancy's TIMS position code. The editor collects that
// code, a minimum on the fit, and (for every scored test) the relative weight TIMS will give.
describe('vacancy assessment form: PCA job fit and weights', () => {
  const pca = (extra: Partial<ReturnType<typeof newRow>> = {}) => ({
    ...newRow('pca'),
    reason: 'Ajuste al puesto según TIMS',
    ...extra,
  });

  it('needs a position code to score or gate PCA, not to show it as advisory', () => {
    expect(jobCodeRequired('pca', 'scored')).toBe(true);
    expect(jobCodeRequired('pca', 'gate')).toBe(true);
    expect(jobCodeRequired('pca', 'advisory')).toBe(false);
    expect(jobCodeRequired('lia', 'scored')).toBe(false);
    expect(errors([pca({ use: 'scored' })])).toEqual(['rows.0.jobCode:errorJobCodeInvalid']);
    expect(errors([pca({ use: 'scored', jobCode: '194225' })])).toEqual([]);
    expect(errors([pca()])).toEqual([]);
  });

  it('refuses a code outside the TIMS pattern, even on an advisory PCA', () => {
    for (const bad of ['19 42', 'x', 'puesto/1', 'a'.repeat(31)]) {
      expect(errors([pca({ jobCode: bad })])).toEqual(['rows.0.jobCode:errorJobCodeInvalid']);
    }
    expect(errors([pca({ use: 'scored', jobCode: '  GC-001_b  ' })])).toEqual([]);
  });

  it('a PCA gate needs a minimum fit 0–100; scored it is optional', () => {
    expect(errors([pca({ use: 'gate', jobCode: '194225' })])).toEqual(['rows.0.minimum:errorMinimumInvalid']);
    expect(errors([pca({ use: 'gate', jobCode: '194225', minimum: '140' })])).toEqual(['rows.0.minimum:errorMinimumInvalid']);
    expect(errors([pca({ use: 'gate', jobCode: '194225', minimum: '70' })])).toEqual([]);
    expect(errors([pca({ use: 'scored', jobCode: '194225' })])).toEqual([]);
  });

  it('sends the trimmed code (advisory included), the fit minimum and the weight', () => {
    expect(toInput(pca({ use: 'scored', jobCode: ' 194225 ', minimum: '60', weight: '2' }))).toEqual({
      instrument: 'pca',
      use: 'scored',
      min: { jobFit: 60 },
      weight: 2,
      reason: 'Ajuste al puesto según TIMS',
      jobCode: '194225',
    });
    expect(toInput(pca({ jobCode: 'GC001', minimum: '60', weight: '2' }))).toEqual({
      instrument: 'pca',
      use: 'advisory',
      reason: 'Ajuste al puesto según TIMS',
      jobCode: 'GC001',
    });
    expect(toInput(pca())).not.toHaveProperty('jobCode');
    // A code typed on another instrument never leaves the editor.
    expect(toInput(row({ jobCode: '194225' }))).not.toHaveProperty('jobCode');
  });

  it('checks a weight only where one applies: scored, not English, greater than 0 and at most 100', () => {
    expect(errors([row({ weight: '0' })])).toEqual(['rows.0.weight:errorWeightInvalid']);
    expect(errors([row({ weight: '101' })])).toEqual(['rows.0.weight:errorWeightInvalid']);
    expect(errors([row({ weight: 'abc' })])).toEqual(['rows.0.weight:errorWeightInvalid']);
    expect(errors([row({ weight: '0.5' })])).toEqual([]);
    expect(errors([row({ weight: '' })])).toEqual([]);
    expect(errors([row({ use: 'advisory', weight: '0' })])).toEqual([]);
  });

  it('round-trips a stored PCA requirement', () => {
    const stored = {
      instrument: 'pca' as const,
      use: 'scored' as const,
      min: { globalPercentile: null, cefr: null, level: null, score: null, jobFit: 60 },
      weight: 2,
      reason: 'Ajuste al puesto',
      jobCode: '194225',
    };
    expect(toInput(toRow(stored))).toEqual({
      instrument: 'pca',
      use: 'scored',
      min: { jobFit: 60 },
      weight: 2,
      reason: 'Ajuste al puesto',
      jobCode: '194225',
    });
  });
});
