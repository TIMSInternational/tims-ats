/**
 * Candidate identity numbers (WP-26): cédula física, DIMEX and pasaporte. Cédula jurídica is a company
 * number and is not accepted. Golden cases: contracts/invu-intake/identity-cases.json (shared with C#).
 */
export const IDENTITY_NUMBER_TYPES = ['cedula_fisica', 'dimex', 'pasaporte'] as const;
export type IdentityNumberType = (typeof IDENTITY_NUMBER_TYPES)[number];
export type IdentityNumberValidation = 'ok' | 'invalid_format';

/** Longest raw input considered at all; anything longer is invalid without further work. */
export const IDENTITY_NUMBER_RAW_MAX_LENGTH = 40;

const PATTERNS: Record<IdentityNumberType, RegExp> = {
  cedula_fisica: /^[1-9][0-9]{8}$/,
  dimex: /^[0-9]{11,12}$/,
  pasaporte: /^[A-Z0-9]{6,20}$/,
};

/** Removes whitespace and dashes; passports are upper-cased. Does not validate. */
export function normalizeIdentityNumber(type: IdentityNumberType, raw: string): string {
  const stripped = raw.replace(/[\s-]+/g, '');
  return type === 'pasaporte' ? stripped.toUpperCase() : stripped;
}

export function validateIdentityNumber(type: IdentityNumberType, raw: string): IdentityNumberValidation {
  if (typeof raw !== 'string' || raw.length > IDENTITY_NUMBER_RAW_MAX_LENGTH) return 'invalid_format';
  const pattern = PATTERNS[type];
  if (!pattern) return 'invalid_format';
  return pattern.test(normalizeIdentityNumber(type, raw)) ? 'ok' : 'invalid_format';
}

const MASK_PREFIX = '•••••';
const VISIBLE_TAIL = 4;

/**
 * Fixed-width mask showing only the last four characters, so the masked value never reveals the length.
 * A value too short to keep anything hidden is masked entirely.
 */
export function maskIdentityNumber(value: string): string {
  const compact = value.replace(/[\s-]+/g, '');
  if (compact.length <= VISIBLE_TAIL) return MASK_PREFIX + '•'.repeat(VISIBLE_TAIL);
  return MASK_PREFIX + compact.slice(-VISIBLE_TAIL);
}
