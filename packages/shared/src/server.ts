/**
 * Server-only helpers of @tims/shared. Not re-exported from `index.ts`, so client bundles never pull in
 * node `crypto`; server code imports this module directly.
 */
import { createHash } from 'node:crypto';
import {
  INTAKE_DECLARATION_TEXT,
  type IntakeDeclarationLocale,
  type IntakeDeclarationTextVersion,
} from './intake/declaration';

/** SHA-256 (lowercase hex) of the exact UTF-8 declaration text the candidate was shown. */
export function declarationTextSha256(version: IntakeDeclarationTextVersion, locale: IntakeDeclarationLocale): string {
  return createHash('sha256').update(INTAKE_DECLARATION_TEXT[version][locale], 'utf8').digest('hex');
}
