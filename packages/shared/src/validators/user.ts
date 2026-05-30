import { z } from 'zod';
import { SYSTEM_ROLES } from '../types/roles';

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  jobTitle: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  companyId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  roleSlug: z.enum(SYSTEM_ROLES).default('employee'),
  locale: z.enum(['es', 'en']).default('es'),
});

export const updateUserSchema = createUserSchema.partial().omit({ email: true });

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleSlug: z.enum(SYSTEM_ROLES),
  companyScope: z.string().uuid().optional(),
  unitScope: z.string().uuid().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
