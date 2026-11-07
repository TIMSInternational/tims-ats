// Role names shown to people, and which roles the invite / role pickers offer.
//
// The ONE web label map is `roles.*` in lib/i18n/{es,en}.json: inside the app pass `t.roles`; pages that
// render outside the I18nProvider (the invitation page) use roleLabelsFor(locale). Never print a raw slug
// and never print the database `roles.name` (seeded without accents, and different from these labels).
//
// Pure module (no React) so node tests can exercise it.

import { ASSIGNABLE_STAFF_ROLES, type AssignableStaffRole } from '@tims/shared';
import es from './i18n/es.json';
import en from './i18n/en.json';
import { readLaunchScope, type LaunchScope } from './launch-scope';

export type RoleLabelSlug = AssignableStaffRole | 'platform_owner';
export type RoleLabels = Readonly<Record<RoleLabelSlug, string>>;
export type RoleOption = { slug: string; label: string };

/**
 * Decision D-HRBP (drop-v1): while NEXT_PUBLIC_LAUNCH_SCOPE=pilot, no invite or role picker offers these
 * roles. HRBP is unit-scoped and the organization structure is off in the pilot. Líder IS offered (owner
 * decision 2026-11-06): team-scoped, it works on the vacancies assigned to it as hiring manager, and holds
 * vacancy:update @team so it can send its own drafts for approval. To offer HRBP again, remove it from this
 * list. UX only: the API still decides what a caller may grant.
 */
export const PILOT_HIDDEN_ROLE_SLUGS: readonly string[] = ['hrbp'];

export function roleLabelsFor(locale: 'es' | 'en'): RoleLabels {
  return locale === 'en' ? en.roles : es.roles;
}

/** The label for a role slug; an unknown slug falls back to a readable form, never to `snake_case`. */
export function roleLabel(labels: RoleLabels, slug: string): string {
  return Object.prototype.hasOwnProperty.call(labels, slug) ? labels[slug as RoleLabelSlug] : slug.replaceAll('_', ' ');
}

export function isRoleOfferedInScope(slug: string, scope: LaunchScope = readLaunchScope()): boolean {
  return scope !== 'pilot' || !PILOT_HIDDEN_ROLE_SLUGS.includes(slug);
}

const CATALOGUE_ORDER: readonly string[] = ASSIGNABLE_STAFF_ROLES;

function catalogueRank(slug: string): number {
  const index = CATALOGUE_ORDER.indexOf(slug);
  return index === -1 ? CATALOGUE_ORDER.length : index;
}

/**
 * Turns a server-provided role list into picker options: drops the roles the launch scope hides, labels
 * each from the shared map and orders them like the role catalogue (most to least privileged), not by the
 * database name. `keep` stays in the list even when hidden, so a picker can still show a current value.
 */
export function roleOptions(
  roles: readonly { readonly slug: string }[],
  labels: RoleLabels,
  options: { scope?: LaunchScope; keep?: string } = {},
): RoleOption[] {
  const scope = options.scope ?? readLaunchScope();
  return roles
    .filter((role) => role.slug === options.keep || isRoleOfferedInScope(role.slug, scope))
    .map((role) => ({ slug: role.slug, label: roleLabel(labels, role.slug) }))
    .sort((a, b) => catalogueRank(a.slug) - catalogueRank(b.slug));
}

/** Every assignable staff role as picker options, for pickers that have no server-provided list. */
export function staffRoleOptions(
  labels: RoleLabels,
  options: { scope?: LaunchScope; keep?: string } = {},
): RoleOption[] {
  return roleOptions(
    ASSIGNABLE_STAFF_ROLES.map((slug) => ({ slug })),
    labels,
    options,
  );
}
