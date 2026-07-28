import { z } from 'zod';
import { EVAL360_COMPETENCIES } from '../constants/eval360';

const ratingInput = z.object({
  competencyKey: z.enum(EVAL360_COMPETENCIES),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(5000).optional(),
});

export const submitRatingsInput = z.object({
  assignmentId: z.string().uuid(),
  ratings: z
    .array(ratingInput)
    .length(6)
    .refine(
      (arr) => new Set(arr.map((r) => r.competencyKey)).size === 6,
      'Debe calificar las 6 competencias exactamente una vez',
    ),
});
