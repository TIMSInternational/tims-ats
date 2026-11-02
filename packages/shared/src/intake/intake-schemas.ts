/**
 * Intake submission shape (WP-26): the one strict, bounded object the apply payload and the apply input
 * share. Object keys are parsed against the caller's organization and vacancy server-side
 * (`parseIntakeObjectKey`); this schema only bounds them.
 */
import { z } from 'zod';
import { ACADEMIC_DEGREES } from './academic-degrees';
import { INTAKE_ALLOWED_CONTENT_TYPES } from './content-type';
import { INTAKE_DECLARATION_LOCALES, INTAKE_DECLARATION_TEXT_VERSIONS } from './declaration';
import { MAX_INTAKE_DOCUMENTS } from './document-types';
import { IDENTITY_NUMBER_RAW_MAX_LENGTH, IDENTITY_NUMBER_TYPES, validateIdentityNumber } from './identity-number';
import { INTAKE_OBJECT_KEY_MAX_LENGTH } from './object-key';

export const INTAKE_FILE_NAME_MAX_LENGTH = 255;
export const PROFESSIONAL_COLLEGE_MAX_LENGTH = 120;
export const COLLEGE_LICENSE_MAX_LENGTH = 40;
export const RELEVANT_YEARS_MAX = 60;

export const intakeIdentitySchema = z
  .object({
    type: z.enum(IDENTITY_NUMBER_TYPES),
    number: z.string().min(1).max(IDENTITY_NUMBER_RAW_MAX_LENGTH),
  })
  .strict()
  .refine((v) => validateIdentityNumber(v.type, v.number) === 'ok', {
    message: 'invalid_format',
    path: ['number'],
  });

export const intakeDeclarationSchema = z
  .object({
    textVersion: z.enum(INTAKE_DECLARATION_TEXT_VERSIONS),
    locale: z.enum(INTAKE_DECLARATION_LOCALES),
  })
  .strict();

export const intakeDocumentSchema = z
  .object({
    objectKey: z.string().min(1).max(INTAKE_OBJECT_KEY_MAX_LENGTH),
    fileName: z.string().min(1).max(INTAKE_FILE_NAME_MAX_LENGTH),
    contentType: z.enum(INTAKE_ALLOWED_CONTENT_TYPES),
  })
  .strict();

export const intakeSubmissionSchema = z
  .object({
    identity: intakeIdentitySchema.optional(),
    academicDegree: z.enum(ACADEMIC_DEGREES).optional(),
    professionalCollege: z.string().trim().min(1).max(PROFESSIONAL_COLLEGE_MAX_LENGTH).optional(),
    collegeLicense: z.string().trim().min(1).max(COLLEGE_LICENSE_MAX_LENGTH).optional(),
    relevantYears: z.number().int().min(0).max(RELEVANT_YEARS_MAX).optional(),
    declaration: intakeDeclarationSchema.optional(),
    documents: z.array(intakeDocumentSchema).max(MAX_INTAKE_DOCUMENTS),
  })
  .strict();

export type IntakeSubmission = z.infer<typeof intakeSubmissionSchema>;
export type IntakeSubmissionDocument = z.infer<typeof intakeDocumentSchema>;
