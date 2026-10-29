/**
 * Content types accepted for intake documents (WP-26) and the rule that picks one. The type is decided by
 * the file's last extension; a browser-reported type may confirm it but never overrides it. HEIC photos
 * often arrive with an empty browser type, which is why the extension is authoritative.
 */
import type { IntakeObjectKeyExtension } from './object-key';

export const INTAKE_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;
export type IntakeContentType = (typeof INTAKE_ALLOWED_CONTENT_TYPES)[number];

const BY_EXTENSION: Record<string, IntakeContentType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** Browser types that carry no information and defer to the extension. */
const UNKNOWN_BROWSER_TYPES = new Set(['', 'application/octet-stream']);
const HEIF_FAMILY = new Set<string>(['image/heic', 'image/heif']);

export function resolveIntakeContentType(fileName: string, browserType: string): IntakeContentType | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const resolved = BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
  if (!resolved) return null;
  const claimed = (browserType ?? '').trim().toLowerCase();
  if (UNKNOWN_BROWSER_TYPES.has(claimed) || claimed === resolved) return resolved;
  if (HEIF_FAMILY.has(claimed) && HEIF_FAMILY.has(resolved)) return resolved;
  return null;
}

/** Object-key extension used when storing a file of this content type. */
export function intakeExtensionForContentType(contentType: IntakeContentType): IntakeObjectKeyExtension {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
  }
}
