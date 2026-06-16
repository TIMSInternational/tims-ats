import { z } from 'zod';
import { ASSIGNABLE_STAFF_ROLES } from '../types/roles';

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  jobTitle: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  companyId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  roleSlug: z.enum(ASSIGNABLE_STAFF_ROLES).default('employee'),
  locale: z.enum(['es', 'en']).default('es'),
});

export const updateUserSchema = createUserSchema.partial().omit({ email: true });

// Self-serve profile update — STRICT allowlist of fields a user may change about
// themselves. Deliberately excludes roleSlug, companyId, businessUnitId,
// organizationId, isActive, isPlatformOwner, email and supabaseUserId so a user
// cannot escalate their role or move their own org/company/unit scope.
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  displayName: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  locale: z.enum(['es', 'en']).optional(),
  timezone: z.string().max(64).optional(),
  avatar: z.string().url().max(2048).optional(),
});

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleSlug: z.enum(ASSIGNABLE_STAFF_ROLES),
  companyScope: z.string().uuid().optional(),
  unitScope: z.string().uuid().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
