/**
 * missing-requirements.test.ts — WP-26 PR-2 (candidate-spec-43).
 *
 * The candidate must be told which document is missing. computeMissingRequirements drives the apply review
 * list and the portal checklist: a mandatory (knockout) document requirement with no file is listed, an optional
 * one is not, and a requirement with more files than it allows is listed as over the limit.
 */
import { describe, it, expect } from 'vitest';
import { computeMissingRequirements, type IntakeRequirementInput } from '@tims/shared';

const doc = (id: string, isKnockout: boolean, maxFiles = 1): IntakeRequirementInput => ({
  id,
  kind: 'document',
  documentType: 'titulo',
  isKnockout,
  maxFiles,
});

describe('computeMissingRequirements', () => {
  it('lists a mandatory document requirement with no file', () => {
    expect(computeMissingRequirements([doc('r1', true)], [])).toEqual([{ requirementId: 'r1', reason: 'missing' }]);
  });

  it('does not list an optional document requirement with no file', () => {
    expect(computeMissingRequirements([doc('r1', false)], [])).toEqual([]);
  });

  it('lists nothing when every mandatory document is provided', () => {
    expect(
      computeMissingRequirements(
        [doc('r1', true), doc('r2', true)],
        [{ requirementId: 'r1' }, { requirementId: 'r2' }],
      ),
    ).toEqual([]);
  });

  it('respects max_files: more files than allowed is listed, exactly the limit is not', () => {
    const reqs = [doc('r1', true, 2)];
    expect(computeMissingRequirements(reqs, [{ requirementId: 'r1' }, { requirementId: 'r1' }])).toEqual([]);
    expect(
      computeMissingRequirements(reqs, [{ requirementId: 'r1' }, { requirementId: 'r1' }, { requirementId: 'r1' }]),
    ).toEqual([{ requirementId: 'r1', reason: 'too_many_files' }]);
  });

  it('applies max_files to optional requirements too', () => {
    expect(
      computeMissingRequirements([doc('r1', false, 1)], [{ requirementId: 'r1' }, { requirementId: 'r1' }]),
    ).toEqual([{ requirementId: 'r1', reason: 'too_many_files' }]);
  });

  it('ignores files for requirements that are not on the vacancy', () => {
    expect(computeMissingRequirements([doc('r1', true)], [{ requirementId: 'r1' }, { requirementId: 'zz' }])).toEqual(
      [],
    );
  });

  it('does not list knockout requirements that are not documents (checked server-side)', () => {
    const declaration: IntakeRequirementInput = {
      id: 'd1',
      kind: 'declaration',
      documentType: null,
      isKnockout: true,
      maxFiles: 1,
    };
    const degree: IntakeRequirementInput = { ...declaration, id: 'g1', kind: 'min_academic_degree' };
    expect(computeMissingRequirements([declaration, degree, doc('r1', true)], [])).toEqual([
      { requirementId: 'r1', reason: 'missing' },
    ]);
  });

  it('keeps the requirement order of the vacancy', () => {
    expect(computeMissingRequirements([doc('b', true), doc('a', true)], [])).toEqual([
      { requirementId: 'b', reason: 'missing' },
      { requirementId: 'a', reason: 'missing' },
    ]);
  });
});
