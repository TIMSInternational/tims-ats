/**
 * Object keys for intake documents (WP-26):
 * `candidate-docs/{organizationId}/{vacancyId}/{requirementId}/{fileUuid}.{ext}`.
 * A submitted key is usable only when it parses for the caller's organization and vacancy.
 * Mirrored by the C# IntakeObjectKey; golden cases in contracts/invu-intake/object-key-cases.json.
 */
export const INTAKE_OBJECT_KEY_PREFIX = 'candidate-docs';
export const INTAKE_OBJECT_KEY_MAX_LENGTH = 300;
export const INTAKE_OBJECT_KEY_EXTENSIONS = ['pdf', 'jpg', 'png', 'heic'] as const;
export type IntakeObjectKeyExtension = (typeof INTAKE_OBJECT_KEY_EXTENSIONS)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const KEY_RE = new RegExp(
  `^${INTAKE_OBJECT_KEY_PREFIX}/(${UUID})/(${UUID})/(${UUID})/${UUID}\\.(${INTAKE_OBJECT_KEY_EXTENSIONS.join('|')})$`,
);

export interface IntakeObjectKeyInput {
  organizationId: string;
  vacancyId: string;
  requirementId: string;
  ext: IntakeObjectKeyExtension;
}

export interface ParsedIntakeObjectKey {
  requirementId: string;
  ext: IntakeObjectKeyExtension;
}

/** Builds a fresh key; throws when an id is not a lowercase UUID or the extension is not allowed. */
export function buildIntakeObjectKey(input: IntakeObjectKeyInput): string {
  const { organizationId, vacancyId, requirementId, ext } = input;
  for (const id of [organizationId, vacancyId, requirementId]) {
    if (!UUID_RE.test(id)) throw new Error('buildIntakeObjectKey: ids must be lowercase UUIDs');
  }
  if (!(INTAKE_OBJECT_KEY_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error('buildIntakeObjectKey: extension not allowed');
  }
  const fileId = globalThis.crypto.randomUUID().toLowerCase();
  return `${INTAKE_OBJECT_KEY_PREFIX}/${organizationId}/${vacancyId}/${requirementId}/${fileId}.${ext}`;
}

/** Returns the requirement and extension of a key that belongs to this organization and vacancy, else null. */
export function parseIntakeObjectKey(
  key: string,
  organizationId: string,
  vacancyId: string,
): ParsedIntakeObjectKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > INTAKE_OBJECT_KEY_MAX_LENGTH) return null;
  const match = KEY_RE.exec(key);
  if (!match) return null;
  const [, keyOrg, keyVacancy, requirementId, ext] = match;
  if (keyOrg !== organizationId || keyVacancy !== vacancyId) return null;
  return { requirementId, ext: ext as IntakeObjectKeyExtension };
}
