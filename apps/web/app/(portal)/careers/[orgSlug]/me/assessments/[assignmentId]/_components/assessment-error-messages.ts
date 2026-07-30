import type en from '../../../../../../../lib/i18n/en.json';

export type AssessmentPlayerT = (typeof en)['assessmentPlayer'];

// Deliberately excludes assignment_already_completed — per the Slice 3 design,
// that code is not an error state in the UI. A caller that receives it should
// re-fetch getMyAssessments and land on the result screen, never call this mapper.
const ERROR_MESSAGE_KEYS: Record<string, keyof AssessmentPlayerT> = {
  consent_required: 'errorConsentRequired',
  assignment_expired: 'errorAssignmentExpired',
  assignment_not_startable: 'errorAssignmentNotStartable',
  assignment_not_in_progress: 'errorAssignmentNotInProgress',
  question_not_in_assessment: 'errorQuestionNotInAssessment',
  answer_type_mismatch: 'errorAnswerTypeMismatch',
};

export function mapAssessmentErrorMessage(rawMessage: string | undefined, t: AssessmentPlayerT): string {
  const key = rawMessage ? ERROR_MESSAGE_KEYS[rawMessage] : undefined;
  return key ? t[key] : t.errorGeneric;
}
