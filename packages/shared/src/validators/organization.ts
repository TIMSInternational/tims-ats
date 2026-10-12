import { z } from 'zod';

/**
 * RFC 5321 §4.5.3.1.3 caps the Path (`<address>`) at 256 octets INCLUDING the angle brackets, so a
 * deliverable address is at most 254. Same bound as `platform/organizations.ts` createOrganization and
 * `platform/invitations.ts` createOrgInvitation (#207), and as the C# `MaxEmailLength`.
 */
export const MAX_ORG_EMAIL_LENGTH = 254;

/** RFC 1035 §2.3.4 / RFC 1123: a fully-qualified domain name is at most 253 characters (no trailing dot). */
export const MAX_ORG_DOMAIN_LENGTH = 253;

/**
 * A bare hostname: two or more dot-separated labels, each 1–63 chars of `[a-z0-9-]` that neither starts
 * nor ends with a hyphen, and a TLD that starts with a letter (so a raw IPv4 address is rejected).
 * Punycode (`xn--…`) labels pass. No scheme, path, port, `@`, whitespace or trailing dot.
 */
export const ORG_DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Solo letras minusculas, numeros y guiones'),
  // #213: `domain` was unbounded on a @unique column, reachable through `organization.update` at the
  // `organization:update` privilege bar. `.trim()` runs FIRST (Zod 3 applies string checks in order), so
  // the bound and pattern judge the value that is actually stored.
  domain: z
    .string()
    .trim()
    .max(MAX_ORG_DOMAIN_LENGTH)
    .regex(ORG_DOMAIN_PATTERN, 'Dominio invalido (ej. empresa.com)')
    .optional(),
  // #213: bounded at 254 like the two platform-owner writers of `organizations.billing_email` (#207).
  billingEmail: z.string().trim().max(MAX_ORG_EMAIL_LENGTH).email().optional(),
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
  // #213 sweep: these three were unbounded. 64 matches `user.ts` timezone; 50 matches the invoice
  // `taxId`; 200 matches `name`. The longest IANA zone id is 32 chars.
  timezone: z.string().max(64).default('America/Bogota'),
  language: z.enum(['es', 'en']).default('es'),
  legalName: z.string().max(200).optional(),
  taxId: z.string().max(50).optional(),
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
