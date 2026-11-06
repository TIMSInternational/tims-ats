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

// The E2E company journey picks the Equipo invite role by its visible option label. Those labels come from the
// web map above, so a label change must move the journey with it (CI run 41928592372 failed on an old 'Lider').
describe('the E2E company journey selects roles by the labels the app shows', () => {
  const spec = readFileSync(join(ROOT, 'e2e/specs/company/company-journey.spec.ts'), 'utf8');
  const loop = spec.match(/for \(const \[who, role\] of \[([\s\S]*?)\] as const\)/);
  const picked = [...(loop?.[1] ?? '').matchAll(/\[j\.\w+, '([^']+)'\]/g)].map((match) => match[1]);

  it('finds the team-invite role labels in the spec', () => {
    expect(picked.length).toBeGreaterThan(0);
  });

  it.each(picked)('%s is a Spanish role label in the web map', (label) => {
    expect(Object.values(es.roles)).toContain(label);
  });
});
