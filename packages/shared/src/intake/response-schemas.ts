/**
 * Strict parsers for the platform service's intake responses (WP-26): the public requirement list a
 * candidate sees before applying, and a candidate's own document list in the portal. Unknown fields fail
 * the parse, so a response that starts carrying more data is noticed instead of passed through.
 */
import { z } from 'zod';
import { INTAKE_ALLOWED_CONTENT_TYPES } from './content-type';
import { INTAKE_DECLARATION_TEXT_VERSIONS } from './declaration';
import {
  INTAKE_DOCUMENT_TYPES,
  INTAKE_REQUIREMENT_KINDS,
  MAX_FILES_PER_REQUIREMENT,
  MAX_INTAKE_DOCUMENTS,
  MAX_REQUIREMENTS_PER_VACANCY,
} from './document-types';
import { INTAKE_FILE_NAME_MAX_LENGTH } from './intake-schemas';

export const INTAKE_DOCUMENT_REVIEW_STATUSES = ['received', 'accepted', 'rejected', 'superseded'] as const;
export type IntakeDocumentReviewStatus = (typeof INTAKE_DOCUMENT_REVIEW_STATUSES)[number];

export const publicIntakeRequirementSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(INTAKE_REQUIREMENT_KINDS),
    label: z.string().min(1).max(200),
    helpText: z.string().max(500).nullable(),
    isKnockout: z.boolean(),
    documentType: z.enum(INTAKE_DOCUMENT_TYPES).nullable(),
    maxFiles: z.number().int().min(1).max(MAX_FILES_PER_REQUIREMENT),
    minValue: z.string().max(30).nullable(),
  })
  .strict();

export const publicVacancyIntakeSchema = z
  .object({
    declarationRequired: z.boolean(),
    identityRequired: z.boolean(),
    allowIncompleteSubmit: z.boolean(),
    declarationTextVersion: z.enum(INTAKE_DECLARATION_TEXT_VERSIONS).nullable(),
    requirements: z.array(publicIntakeRequirementSchema).max(MAX_REQUIREMENTS_PER_VACANCY),
  })
  .strict();

export const portalDocumentSchema = z
  .object({
    id: z.string().uuid(),
    requirementId: z.string().uuid().nullable(),
    fileName: z.string().min(1).max(INTAKE_FILE_NAME_MAX_LENGTH),
    contentType: z.enum(INTAKE_ALLOWED_CONTENT_TYPES).nullable(),
    reviewStatus: z.enum(INTAKE_DOCUMENT_REVIEW_STATUSES),
    reviewReason: z.string().max(500).nullable(),
    uploadedAt: z.string().datetime(),
  })
  .strict();

export const portalDocumentListSchema = z
  .object({
    windowOpen: z.boolean(),
    windowClosesAt: z.string().datetime().nullable(),
    documents: z.array(portalDocumentSchema).max(MAX_INTAKE_DOCUMENTS * 2),
  })
  .strict();

export type PublicVacancyIntake = z.infer<typeof publicVacancyIntakeSchema>;
export type PortalDocumentList = z.infer<typeof portalDocumentListSchema>;
