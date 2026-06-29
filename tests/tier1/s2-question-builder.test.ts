import { describe, it, expect } from 'vitest';
import {
  addQuestion,
  removeQuestion,
  updateQuestion,
  type QuestionRow,
} from '../../apps/web/app/(admin)/engagement/climate/question-builder';

const base: QuestionRow[] = [{ text: 'Q1', type: 'scale' }];

describe('addQuestion', () => {
  it('appends an empty row', () => {
    const result = addQuestion(base);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('');
  });

  it('does not mutate the original array', () => {
    addQuestion(base);
    expect(base).toHaveLength(1);
  });
});

describe('removeQuestion', () => {
  it('removes by index', () => {
    const qs: QuestionRow[] = [
      { text: 'A', type: 'scale' },
      { text: 'B', type: 'text' },
    ];
    const result = removeQuestion(qs, 0);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('B');
  });

  it('never drops below 1 row', () => {
    const result = removeQuestion(base, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(base[0]);
  });

  it('does not mutate the original array', () => {
    const qs: QuestionRow[] = [{ text: 'A', type: 'scale' }, { text: 'B', type: 'text' }];
    removeQuestion(qs, 1);
    expect(qs).toHaveLength(2);
  });
});

describe('updateQuestion', () => {
  it('patches only the targeted index', () => {
    const qs: QuestionRow[] = [
      { text: 'A', type: 'scale' },
      { text: 'B', type: 'text' },
    ];
    const result = updateQuestion(qs, 0, { text: 'A updated' });
    expect(result[0].text).toBe('A updated');
    expect(result[1].text).toBe('B');
  });

  it('patches type without touching text', () => {
    const qs: QuestionRow[] = [{ text: 'Q', type: 'scale' }];
    const result = updateQuestion(qs, 0, { type: 'yes_no' });
    expect(result[0].type).toBe('yes_no');
    expect(result[0].text).toBe('Q');
  });

  it('is immutable — returns a new array', () => {
    const qs: QuestionRow[] = [{ text: 'Q', type: 'scale' }];
    const result = updateQuestion(qs, 0, { text: 'new' });
    expect(result).not.toBe(qs);
    expect(qs[0].text).toBe('Q');
  });
});
