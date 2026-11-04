// One role-label map per codebase (audit D-09 / E-17 / F-1): the web map (`roles.*` in es/en.json), the
// packages/api email map (ROLE_DEFINITIONS in @tims/shared) and the C# email map (RoleLabels.cs) must name
// every staff role identically, so an invitation email, the invitation page and the app agree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_STAFF_ROLES, ROLE_DEFINITIONS } from '@tims/shared';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const ROOT = join(__dirname, '..', '..');
const csharp = readFileSync(join(ROOT, 'services/Tims.Platform/src/Tims.Domain/Identity/RoleLabels.cs'), 'utf8');

function csharpLabels(): Record<string, { es: string; en: string }> {
  const labels: Record<string, { es: string; en: string }> = {};
  for (const match of csharp.matchAll(/\["([a-z_]+)"\] = \("([^"]+)", "([^"]+)"\)/g)) {
    labels[match[1]] = { es: match[2], en: match[3] };
  }
  return labels;
}

// The product decision for the pilot (Spanish labels).
const DECIDED_ES: Record<string, string> = {
  super_admin: 'Super Administrador',
  hr_admin: 'Administrador de RR. HH.',
  recruiter: 'Reclutador',
  leader: 'Líder',
  committee: 'Comité de entrevista',
  hrbp: 'HR Business Partner (HRBP)',
  employee: 'Colaborador',
};

describe('role labels are one map per codebase, and the three agree', () => {
  const cs = csharpLabels();

  it('the C# map covers exactly the assignable staff roles', () => {
    expect(Object.keys(cs).sort()).toEqual([...ASSIGNABLE_STAFF_ROLES].sort());
  });

  it.each([...ASSIGNABLE_STAFF_ROLES])('%s has the decided Spanish label everywhere', (slug) => {
    expect(es.roles[slug]).toBe(DECIDED_ES[slug]);
    expect(ROLE_DEFINITIONS[slug].nameEs).toBe(DECIDED_ES[slug]);
    expect(cs[slug]?.es).toBe(DECIDED_ES[slug]);
  });

  it.each([...ASSIGNABLE_STAFF_ROLES])('%s has the same English label everywhere', (slug) => {
    expect(ROLE_DEFINITIONS[slug].name).toBe(en.roles[slug]);
    expect(cs[slug]?.en).toBe(en.roles[slug]);
  });
});
