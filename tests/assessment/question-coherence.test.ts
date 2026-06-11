import { describe, it, expect } from 'vitest';
import { validateQuestionCoherence } from '../../packages/shared/src/validators/assessment';

// Pure cross-field coherence between a question's type, its options, and which
// option ids are marked correct. Zod handles bounds/shape; this enforces the
// relationships Zod can't express. Server-only (correctOptionIds never leak).

const opts = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

describe('validateQuestionCoherence', () => {
  it('accepts a well-formed single_choice question', () => {
    expect(
      validateQuestionCoherence({ type: 'single_choice', options: opts, correctOptionIds: ['b'] }),
    ).toEqual({ valid: true });
  });

  it('accepts a well-formed multi_choice question with multiple correct answers', () => {
    expect(
      validateQuestionCoherence({ type: 'multi_choice', options: opts, correctOptionIds: ['a', 'c'] }),
    ).toEqual({ valid: true });
  });

  it('accepts a free_text question with no options and no correct ids', () => {
    expect(
      validateQuestionCoherence({ type: 'free_text', options: [], correctOptionIds: [] }),
    ).toEqual({ valid: true });
  });

  it('rejects free_text that carries options', () => {
    expect(
      validateQuestionCoherence({ type: 'free_text', options: opts, correctOptionIds: [] }),
    ).toEqual({ valid: false, code: 'free_text_no_options' });
  });

  it('rejects free_text that carries correct ids', () => {
    expect(
      validateQuestionCoherence({ type: 'free_text', options: [], correctOptionIds: ['a'] }),
    ).toEqual({ valid: false, code: 'free_text_no_correct' });
  });

  it('rejects a choice question with fewer than two options', () => {
    expect(
      validateQuestionCoherence({ type: 'single_choice', options: [{ id: 'a', label: 'A' }], correctOptionIds: ['a'] }),
    ).toEqual({ valid: false, code: 'choice_needs_options' });
  });

  it('rejects duplicate option ids', () => {
    expect(
      validateQuestionCoherence({
        type: 'single_choice',
        options: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ],
        correctOptionIds: ['a'],
      }),
    ).toEqual({ valid: false, code: 'duplicate_option_ids' });
  });

  it('rejects single_choice without exactly one correct answer (none)', () => {
    expect(
      validateQuestionCoherence({ type: 'single_choice', options: opts, correctOptionIds: [] }),
    ).toEqual({ valid: false, code: 'single_needs_one_correct' });
  });

  it('rejects single_choice without exactly one correct answer (two)', () => {
    expect(
      validateQuestionCoherence({ type: 'single_choice', options: opts, correctOptionIds: ['a', 'b'] }),
    ).toEqual({ valid: false, code: 'single_needs_one_correct' });
  });

  it('rejects multi_choice with no correct answers', () => {
    expect(
      validateQuestionCoherence({ type: 'multi_choice', options: opts, correctOptionIds: [] }),
    ).toEqual({ valid: false, code: 'multi_needs_correct' });
  });

  it('rejects correct ids that are not among the options', () => {
    expect(
      validateQuestionCoherence({ type: 'single_choice', options: opts, correctOptionIds: ['z'] }),
    ).toEqual({ valid: false, code: 'correct_not_in_options' });
  });

  it('rejects duplicate correct ids', () => {
    expect(
      validateQuestionCoherence({ type: 'multi_choice', options: opts, correctOptionIds: ['a', 'a'] }),
    ).toEqual({ valid: false, code: 'duplicate_correct_ids' });
  });
});
