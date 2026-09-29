'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformPatch, platformPost } from './client';

// F13 — tenant assessment-type authoring lives ONLY in C# (there is no tRPC writer to fall back to), so the
// surface is dark unless BOTH the C# base URL and this opt-in flag are set.
const VIA_CSHARP = process.env.NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP === 'true';

export const ASSESSMENT_TYPE_NAME_MAX = 120;
export const ASSESSMENT_TYPE_DESCRIPTION_MAX = 2000;
export const ASSESSMENT_TYPE_DURATION_MAX = 600;

export function isAssessmentTypeAuthoringEnabled(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

const nameSchema = z.string().trim().min(1).max(ASSESSMENT_TYPE_NAME_MAX);
const descriptionSchema = z.string().trim().max(ASSESSMENT_TYPE_DESCRIPTION_MAX).nullable();
const durationSchema = z.number().int().min(1).max(ASSESSMENT_TYPE_DURATION_MAX).nullable();

const createInput = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    duration: durationSchema.optional(),
  })
  .strict();

const updateInput = z
  .object({
    id: z.string().uuid(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    duration: durationSchema.optional(),
  })
  .strict();

const isoTimestamp = z.string().max(40).datetime();

export const assessmentTypeRowSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(ASSESSMENT_TYPE_NAME_MAX),
    code: z.string().min(1).max(80),
    description: z.string().max(ASSESSMENT_TYPE_DESCRIPTION_MAX).nullable(),
    duration: z.number().int().min(1).max(ASSESSMENT_TYPE_DURATION_MAX).nullable(),
    isActive: z.boolean(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();

export type AssessmentTypeRow = z.infer<typeof assessmentTypeRowSchema>;
export type CreateAssessmentTypeInput = z.input<typeof createInput>;
export type UpdateAssessmentTypeInput = z.input<typeof updateInput>;

function assertEnabled(unavailableMessage: string) {
  if (!isAssessmentTypeAuthoringEnabled()) throw new Error(unavailableMessage);
}

/** POST /assessments/types. Never retried: a create is not idempotent. */
export function useCreateAssessmentType(unavailableMessage: string) {
  return useMutation({
    retry: false,
    mutationFn: async (input: CreateAssessmentTypeInput): Promise<AssessmentTypeRow> => {
      assertEnabled(unavailableMessage);
      const body = createInput.parse(input);
      return assessmentTypeRowSchema.parse(await platformPost('/assessments/types', body));
    },
  });
}

/** PATCH /assessments/types/{id}. Absent fields are left unchanged; null clears description/duration. */
export function useUpdateAssessmentType(unavailableMessage: string) {
  return useMutation({
    retry: false,
    mutationFn: async (input: UpdateAssessmentTypeInput): Promise<AssessmentTypeRow> => {
      assertEnabled(unavailableMessage);
      const { id, ...body } = updateInput.parse(input);
      const row = assessmentTypeRowSchema.parse(await platformPatch('/assessments/types/{id}', body, { id }));
      if (row.id !== id) throw new Error(unavailableMessage);
      return row;
    },
  });
}

/** POST /assessments/types/{id}/deactivate — soft (isActive=false); existing assignments keep working. */
export function useDeactivateAssessmentType(unavailableMessage: string) {
  return useMutation({
    retry: false,
    mutationFn: async (id: string): Promise<AssessmentTypeRow> => {
      assertEnabled(unavailableMessage);
      const parsedId = z.string().uuid().parse(id);
      const row = assessmentTypeRowSchema.parse(
        await platformPost('/assessments/types/{id}/deactivate', undefined, { id: parsedId }),
      );
      if (row.id !== parsedId || row.isActive) throw new Error(unavailableMessage);
      return row;
    },
  });
}
