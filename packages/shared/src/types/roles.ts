import type { Scope } from './permissions';

export const SYSTEM_ROLES = [
  'super_admin',
  'hr_admin',
  'hrbp',
  'recruiter',
  'leader',
  'committee',
  'employee',
  'candidate',
  'external',
] as const;

export type SystemRole = typeof SYSTEM_ROLES[number];

// Roles a human STAFF User may hold. Excludes non-User principals:
//   - `external`: API-key integrations (Wave 2.5 slice 7b). It carries the
//     assessmentResult psychometric field grants, so a staff User assigned it would
//     read raw scores through staff endpoints, bypassing the API-key boundary.
//   - `candidate`: portal magic-link logins authenticate via Supabase with NO staff
//     User row (see route.ts) — never a staff role.
// These roles still exist in SYSTEM_ROLES (seeded as Role rows so buildAccessForUser
// can resolve the API-key principal's grants) but must NEVER be assigned to a User.
export const ASSIGNABLE_STAFF_ROLES = [
  'super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee',
] as const;
export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number];

const ASSIGNABLE_STAFF_ROLE_SET: ReadonlySet<string> = new Set(ASSIGNABLE_STAFF_ROLES);

/**
 * Drop non-staff principal roles (`external`, `candidate`) from a staff User's role
 * slugs at SESSION CONSTRUCTION. Defense in depth: even if a stale/drifted UserRole
 * row exists for a non-User principal, the slug never reaches ctx.user.roles, so it
 * can never grant staff-side access (e.g. external's assessmentResult field grants).
 * The API-key path builds its own roles:['external'] principal directly and does NOT
 * go through this filter.
 */
export function filterStaffRoleSlugs(slugs: string[]): string[] {
  return slugs.filter((s) => ASSIGNABLE_STAFF_ROLE_SET.has(s));
}

export interface RoleDefinition {
  slug: SystemRole;
  name: string;
  nameEs: string;
  description: string;
  defaultScope: Scope;
  mfaRequired: boolean;
}

export const ROLE_DEFINITIONS: Record<SystemRole, RoleDefinition> = {
  super_admin: {
    slug: 'super_admin',
    name: 'Super Admin',
    nameEs: 'Super Administrador',
    description: 'Full access to all modules and settings',
    defaultScope: 'organization',
    mfaRequired: true,
  },
  hr_admin: {
    slug: 'hr_admin',
    name: 'HR Admin',
    nameEs: 'Administrador RRHH',
    description: 'Full access to all HR modules',
    defaultScope: 'organization',
    mfaRequired: true,
  },
  hrbp: {
    slug: 'hrbp',
    name: 'HR Business Partner',
    nameEs: 'HRBP',
    description: 'Access to assigned business units',
    defaultScope: 'unit',
    mfaRequired: true,
  },
  recruiter: {
    slug: 'recruiter',
    name: 'Recruiter',
    nameEs: 'Reclutador',
    description: 'ATS modules only',
    defaultScope: 'organization',
    mfaRequired: false,
  },
  leader: {
    slug: 'leader',
    name: 'Leader',
    nameEs: 'Lider',
    description: 'Own team and assigned vacancies',
    defaultScope: 'team',
    mfaRequired: false,
  },
  committee: {
    slug: 'committee',
    name: 'Committee Member',
    nameEs: 'Miembro de Comite',
    description: 'Review panels only',
    defaultScope: 'own',
    mfaRequired: false,
  },
  employee: {
    slug: 'employee',
    name: 'Employee',
    nameEs: 'Colaborador',
    description: 'Self-service access to own data',
    defaultScope: 'own',
    mfaRequired: false,
  },
  candidate: {
    slug: 'candidate',
    name: 'Candidate',
    nameEs: 'Candidato',
    description: 'Portal access only',
    defaultScope: 'own',
    mfaRequired: false,
  },
  external: {
    slug: 'external',
    name: 'External API',
    nameEs: 'API Externa',
    description: 'API access for integrations',
    defaultScope: 'own',
    mfaRequired: false,
  },
};
