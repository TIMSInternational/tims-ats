import { describe, it, expect } from 'vitest';
import en from '../../apps/web/lib/i18n/en.json';
import { mapAssessmentErrorMessage } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-error-messages';

const t = en.assessmentPlayer;

describe('mapAssessmentErrorMessage', () => {
  const cases: [string, string][] = [
    ['consent_required', t.errorConsentRequired],
    ['assignment_expired', t.errorAssignmentExpired],
    ['assignment_not_startable', t.errorAssignmentNotStartable],
    ['assignment_not_in_progress', t.errorAssignmentNotInProgress],
    ['question_not_in_assessment', t.errorQuestionNotInAssessment],
    ['answer_type_mismatch', t.errorAnswerTypeMismatch],
  ];

  it.each(cases)('maps backend code %s to its translated message', (code, expected) => {
    expect(mapAssessmentErrorMessage(code, t)).toBe(expected);
  });

  it('never returns a raw/unmapped backend string, falls back to errorGeneric', () => {
    expect(mapAssessmentErrorMessage('some_unmapped_code', t)).toBe(t.errorGeneric);
    expect(mapAssessmentErrorMessage(undefined, t)).toBe(t.errorGeneric);
  });

  it('does not map assignment_already_completed (callers must special-case it, not render it as an error)', () => {
    expect(mapAssessmentErrorMessage('assignment_already_completed', t)).toBe(t.errorGeneric);
  });
});
