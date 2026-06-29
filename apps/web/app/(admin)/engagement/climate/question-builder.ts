export type QuestionType = 'scale' | 'text' | 'multiple_choice' | 'yes_no';

export interface QuestionRow {
  text: string;
  type: QuestionType;
}

export const DEFAULT_QUESTION: QuestionRow = { text: '', type: 'scale' };

export function addQuestion(qs: QuestionRow[]): QuestionRow[] {
  return [...qs, { ...DEFAULT_QUESTION }];
}

export function removeQuestion(qs: QuestionRow[], i: number): QuestionRow[] {
  if (qs.length <= 1) return qs;
  return qs.filter((_, idx) => idx !== i);
}

export function updateQuestion(qs: QuestionRow[], i: number, patch: Partial<QuestionRow>): QuestionRow[] {
  return qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q));
}
