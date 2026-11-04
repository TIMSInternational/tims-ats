// lib/role-labels.ts: labels from the shared map, and the pilot role list (decision D-HRBP = drop-v1).
import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import {
  PILOT_HIDDEN_ROLE_SLUGS,
  isRoleOfferedInScope,
  roleLabel,
  roleLabelsFor,
  roleOptions,
  staffRoleOptions,
} from '../../apps/web/lib/role-labels';

// What C# /tenant-invitations/roles returns: every active role, ordered by the seeded DB name.
const DB_ROLES = [
  { slug: 'hr_admin', name: 'Administrador RRHH' },
  { slug: 'employee', name: 'Colaborador' },
  { slug: 'hrbp', name: 'HR Business Partner' },
  { slug: 'leader', name: 'Lider' },
  { slug: 'committee', name: 'Miembro de Comite' },
  { slug: 'recruiter', name: 'Reclutador' },
  { slug: 'super_admin', name: 'Super Administrador' },
];

describe('role labels', () => {
  it('labels a slug from the shared map and never prints snake_case', () => {
    expect(roleLabel(es.roles, 'super_admin')).toBe('Super Administrador');
    expect(roleLabel(es.roles, 'committee')).toBe('Comité de entrevista');
    expect(roleLabel(es.roles, 'custom_role')).toBe('custom role');
    expect(roleLabelsFor('en').recruiter).toBe('Recruiter');
    expect(roleLabelsFor('es').leader).toBe('Líder');
  });
});

describe('pilot role list (D-HRBP drop-v1)', () => {
  it('hides exactly hrbp and leader, behind one constant', () => {
    expect([...PILOT_HIDDEN_ROLE_SLUGS].sort()).toEqual(['hrbp', 'leader']);
    expect(isRoleOfferedInScope('leader', 'pilot')).toBe(false);
    expect(isRoleOfferedInScope('hrbp', 'pilot')).toBe(false);
    expect(isRoleOfferedInScope('committee', 'pilot')).toBe(true);
    expect(isRoleOfferedInScope('leader', 'full')).toBe(true);
  });

  it('pilot: offers the five pilot roles, labelled and in catalogue order (not DB-name order)', () => {
    expect(roleOptions(DB_ROLES, es.roles, { scope: 'pilot' })).toEqual([
      { slug: 'super_admin', label: 'Super Administrador' },
      { slug: 'hr_admin', label: 'Administrador de RR. HH.' },
      { slug: 'recruiter', label: 'Reclutador' },
      { slug: 'committee', label: 'Comité de entrevista' },
      { slug: 'employee', label: 'Colaborador' },
    ]);
  });

  it('full scope: offers every role the API returned', () => {
    expect(roleOptions(DB_ROLES, es.roles, { scope: 'full' }).map((r) => r.slug)).toEqual([
      'super_admin',
      'hr_admin',
      'hrbp',
      'recruiter',
      'leader',
      'committee',
      'employee',
    ]);
  });

  it('never offers a role the API did not return (the caller cannot grant it)', () => {
    const hrAdminGrantable = DB_ROLES.filter((r) => r.slug !== 'super_admin');
    expect(roleOptions(hrAdminGrantable, es.roles, { scope: 'pilot' }).map((r) => r.slug)).not.toContain('super_admin');
  });

  it('keeps a current value visible even when the pilot hides it', () => {
    const slugs = staffRoleOptions(es.roles, { scope: 'pilot', keep: 'leader' }).map((r) => r.slug);
    expect(slugs).toContain('leader');
    expect(slugs).not.toContain('hrbp');
  });

  it('reads NEXT_PUBLIC_LAUNCH_SCOPE when no scope is passed', () => {
    const previous = process.env.NEXT_PUBLIC_LAUNCH_SCOPE;
    try {
      process.env.NEXT_PUBLIC_LAUNCH_SCOPE = 'pilot';
      expect(staffRoleOptions(es.roles).map((r) => r.slug)).toEqual([
        'super_admin',
        'hr_admin',
        'recruiter',
        'committee',
        'employee',
      ]);
      delete process.env.NEXT_PUBLIC_LAUNCH_SCOPE;
      expect(staffRoleOptions(es.roles)).toHaveLength(7);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_LAUNCH_SCOPE;
      else process.env.NEXT_PUBLIC_LAUNCH_SCOPE = previous;
    }
  });
});
