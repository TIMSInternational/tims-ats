/**
 * Which requirements a candidate still has to fix before submitting (WP-26): drives the apply review list
 * and the portal checklist. Only document requirements are checked here; the full per-requirement matrix
 * (degrees, years, human decisions) is evaluated server-side.
 */
import type { IntakeDocumentType, IntakeRequirementKind } from './document-types';

export interface IntakeRequirementInput {
  id: string;
  kind: IntakeRequirementKind;
  documentType: IntakeDocumentType | null;
  isKnockout: boolean;
  maxFiles: number;
}

export interface ProvidedIntakeDocument {
  requirementId: string;
}

export type MissingRequirementReason = 'missing' | 'too_many_files';

export interface MissingRequirement {
  requirementId: string;
  reason: MissingRequirementReason;
}

/** In vacancy requirement order: mandatory documents with no file, and any requirement over its file limit. */
export function computeMissingRequirements(
  requirements: readonly IntakeRequirementInput[],
  provided: readonly ProvidedIntakeDocument[],
): MissingRequirement[] {
  const counts = new Map<string, number>();
  for (const doc of provided) counts.set(doc.requirementId, (counts.get(doc.requirementId) ?? 0) + 1);

  const missing: MissingRequirement[] = [];
  for (const req of requirements) {
    if (req.kind !== 'document') continue;
    const count = counts.get(req.id) ?? 0;
    if (count > req.maxFiles) missing.push({ requirementId: req.id, reason: 'too_many_files' });
    else if (count === 0 && req.isKnockout) missing.push({ requirementId: req.id, reason: 'missing' });
  }
  return missing;
}
