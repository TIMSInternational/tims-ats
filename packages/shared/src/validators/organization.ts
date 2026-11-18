import { z } from 'zod';

/**
 * The slug shape an organization can be created with (the C# create use case enforces the same
 * pattern). Internal fixture organizations are seeded outside this rule, so a slug that fails it
 * never belongs to a customer.
 */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9-]+$/;
export const ORGANIZATION_SLUG_MIN_LENGTH = 2;
export const ORGANIZATION_SLUG_MAX_LENGTH = 50;

/** True when `slug` is one a customer organization could have been created with. */
export function isCustomerOrganizationSlug(slug: string): boolean {
  return (
    slug.length >= ORGANIZATION_SLUG_MIN_LENGTH &&
    slug.length <= ORGANIZATION_SLUG_MAX_LENGTH &&
    ORGANIZATION_SLUG_PATTERN.test(slug)
  );
}

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(ORGANIZATION_SLUG_MIN_LENGTH)
    .max(ORGANIZATION_SLUG_MAX_LENGTH)
    .regex(ORGANIZATION_SLUG_PATTERN, 'Solo letras minusculas, numeros y guiones'),
  domain: z.string().optional(),
  billingEmail: z.string().email().optional(),
  // z.string().url() alone accepts any URL scheme (e.g. javascript:, data:) —
  // restrict to http/https server-side too (the branding page already does
  // this client-side, but the API must not rely on that alone).
  logo: z
    .string()
    .url()
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v), {
      message: 'El logo debe ser una URL http/https',
    })
    .optional(),
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
