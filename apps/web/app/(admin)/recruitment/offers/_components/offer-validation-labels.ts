import type { StatusTone } from '../../../../../components/status-badge';

/** i18n keys (under `offers`) of the pre-hire validation types; an unknown type prints as stored. */
export const VALIDATION_TYPE_KEYS = {
  offer_accepted: 'offerAcceptedCheck',
  background_check: 'backgroundCheck',
  reference_check: 'referenceCheck',
  medical_exam: 'medicalExam',
  education_verification: 'educationVerification',
  contract_signing: 'contractSigning',
} as const;

type ValidationTypeKey = (typeof VALIDATION_TYPE_KEYS)[keyof typeof VALIDATION_TYPE_KEYS];

export function validationTypeLabel(type: string, labels: Record<ValidationTypeKey, string>): string {
  const key = (VALIDATION_TYPE_KEYS as Record<string, ValidationTypeKey | undefined>)[type];
  return key ? labels[key] : type;
}

/** The status word and tone of one validation (never the raw enum, never colour alone). */
export function validationStatus(
  status: string,
  labels: { completed: string; waived: string; failed: string; inReview: string; pending: string },
): { tone: StatusTone; label: string } {
  if (status === 'passed') return { tone: 'success', label: labels.completed };
  if (status === 'waived') return { tone: 'info', label: labels.waived };
  if (status === 'failed') return { tone: 'danger', label: labels.failed };
  if (status === 'in_review' || status === 'in_progress') return { tone: 'warning', label: labels.inReview };
  return { tone: 'neutral', label: labels.pending };
}
