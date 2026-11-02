/**
 * Intake document catalogue and limits (WP-26). Codes are stored in `vacancy_requirements.document_type` and
 * mirrored by the C# Intake slice; labels are rendered from i18n, never stored here.
 */
export const INTAKE_DOCUMENT_TYPES = [
  'cv',
  'titulo',
  'incorporacion_colegio',
  'constancia_laboral',
  'hoja_delincuencia',
  'identificacion',
  'certificacion',
  'licencia',
  'otro',
] as const;
export type IntakeDocumentType = (typeof INTAKE_DOCUMENT_TYPES)[number];

export const INTAKE_REQUIREMENT_KINDS = [
  'document',
  'min_academic_degree',
  'min_relevant_years',
  'college_membership',
  'declaration',
  'manual',
] as const;
export type IntakeRequirementKind = (typeof INTAKE_REQUIREMENT_KINDS)[number];

export const MAX_REQUIREMENTS_PER_VACANCY = 20;
export const MAX_FILES_PER_REQUIREMENT = 5;
/** Per-file upload ceiling, in bytes. */
export const INTAKE_MAX_BYTES = 10 * 1024 * 1024;
/** Upper bound on documents in one submission: every requirement at its file limit. */
export const MAX_INTAKE_DOCUMENTS = MAX_REQUIREMENTS_PER_VACANCY * MAX_FILES_PER_REQUIREMENT;

export interface IntakeRequirementTemplate {
  kind: IntakeRequirementKind;
  documentType: IntakeDocumentType | null;
  isKnockout: boolean;
  maxFiles: number;
  /** Degree code or integer years; `null` is a placeholder the recruiter fills in. */
  minValue: string | null;
}

const documentRequirement = (documentType: IntakeDocumentType): IntakeRequirementTemplate => ({
  kind: 'document',
  documentType,
  isKnockout: true,
  maxFiles: 1,
  minValue: null,
});

/**
 * Starting set for a "Paso 1" document screen: five mandatory documents, the declaration and a minimum
 * academic degree left for the recruiter to choose. Recruiters edit it per vacancy.
 */
export const INVU_PASO1_TEMPLATE: readonly IntakeRequirementTemplate[] = [
  documentRequirement('cv'),
  documentRequirement('titulo'),
  documentRequirement('incorporacion_colegio'),
  documentRequirement('constancia_laboral'),
  documentRequirement('hoja_delincuencia'),
  { kind: 'declaration', documentType: null, isKnockout: true, maxFiles: 1, minValue: null },
  { kind: 'min_academic_degree', documentType: null, isKnockout: true, maxFiles: 1, minValue: null },
];
