import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Solo letras minusculas, numeros y guiones'),
  domain: z.string().optional(),
  billingEmail: z.string().email().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const createCompanySchema = z.object({
  name: z.string().min(2).max(200),
  country: z.string().min(2).max(3),
  currency: z.string().length(3).default('USD'),
  timezone: z.string().default('America/Bogota'),
  language: z.enum(['es', 'en']).default('es'),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
});

export const createBusinessUnitSchema = z.object({
  name: z.string().min(2).max(200),
  companyId: z.string().uuid(),
  code: z.string().max(20).optional(),
  parentId: z.string().uuid().optional(),
});

export const createTeamSchema = z.object({
  name: z.string().min(2).max(200),
  businessUnitId: z.string().uuid(),
  leaderId: z.string().uuid().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type CreateBusinessUnitInput = z.infer<typeof createBusinessUnitSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
