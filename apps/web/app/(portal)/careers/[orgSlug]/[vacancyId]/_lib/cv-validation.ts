export const CV_MAX_BYTES = 5 * 1024 * 1024;

export const CV_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type CvValidationError = 'invalid_type' | 'too_large';

export function validateCvFile(file: File): CvValidationError | null {
  if (!CV_ALLOWED_MIME_TYPES.includes(file.type as (typeof CV_ALLOWED_MIME_TYPES)[number])) {
    return 'invalid_type';
  }
  if (file.size > CV_MAX_BYTES) {
    return 'too_large';
  }
  return null;
}
