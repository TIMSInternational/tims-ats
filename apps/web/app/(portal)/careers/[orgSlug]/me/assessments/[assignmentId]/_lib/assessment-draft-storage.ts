export interface AssessmentDraftAnswer {
  selectedOptionIds?: string[];
  freeText?: string;
}

export interface AssessmentDraft {
  answers: Record<string, AssessmentDraftAnswer>;
  updatedAt: string;
}

const draftKey = (assignmentId: string) => `assessment-draft:${assignmentId}`;

function isAssessmentDraft(value: unknown): value is AssessmentDraft {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.updatedAt === 'string' && typeof candidate.answers === 'object' && candidate.answers !== null;
}

export function readDraft(assignmentId: string): AssessmentDraft | null {
  const raw = window.localStorage.getItem(draftKey(assignmentId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAssessmentDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDraft(assignmentId: string, answers: Record<string, AssessmentDraftAnswer>): void {
  const draft: AssessmentDraft = { answers, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(draftKey(assignmentId), JSON.stringify(draft));
}

export function clearDraft(assignmentId: string): void {
  window.localStorage.removeItem(draftKey(assignmentId));
}
