import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvCell } from '../../packages/shared/src/csv';
import {
  assessUserAccess,
  accessStatusOf,
  type UserAccessInput,
} from '../../packages/api/src/access/access-review-kernel';

const ROOT = join(__dirname, '..', '..');
const fixture = (p: string) => JSON.parse(readFileSync(join(ROOT, 'contracts/access-review-fixtures', p), 'utf8'));

describe('access-review-report fixture', () => {
  it('pins the report shape: rows[], summary, crossOrgRoleCount, truncated', () => {
    const f = fixture('access-review-report.json');
    expect(f).toHaveProperty('rows');
    expect(f).toHaveProperty('summary');
    expect(f).toHaveProperty('crossOrgRoleCount');
    expect(f).toHaveProperty('truncated');
    const row = f.rows[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'userId',
        'name',
        'email',
        'organizationId',
        'orgName',
        'status',
        'isPlatformOwner',
        'lastLoginAt',
        'roles',
        'flags',
      ].sort(),
    );
    const role = row.roles[0];
    expect(Object.keys(role).sort()).toEqual(
      [
        'slug',
        'name',
        'roleActive',
        'assignedAt',
        'assignedBy',
        'companyScope',
        'unitScope',
        'expiresAt',
        'grants',
      ].sort(),
    );
  });
});

describe('export-access-review-csv fixture', () => {
  it('pins the 13-column header + a formula-injection row, byte-for-byte via csvCell', () => {
    const f = fixture('export-access-review-csv.json');
    const header = [
      'Usuario',
      'Email',
      'Organizacion',
      'Estado',
      'Rol',
      'Alcance',
      'AsignadoPor',
      'Privilegiado',
      'Inactivo',
      'SinAcceso',
      'BrechaBaja',
      'Expirado',
      'RolCruzado',
    ]
      .map(csvCell)
      .join(',');
    expect(f.header).toBe(header);

    const s = f.sample;
    const row = [
      csvCell(s.name),
      csvCell(s.email),
      csvCell(s.orgName),
      csvCell(s.status),
      csvCell(s.roleSlug),
      csvCell([s.companyScope, s.unitScope].filter(Boolean).join('|') || '-'),
      csvCell(s.assignedBy),
      csvCell(s.privileged),
      csvCell(s.stale),
      csvCell(s.neverLoggedIn),
      csvCell(s.deprovisionGap),
      csvCell(s.expiredGrant),
      csvCell(s.crossOrgRole),
    ].join(',');
    expect(row).toBe(f.expectedCsvRow);
    expect(row).toContain("'="); // the neutralization prefix survived quoting
  });
});

describe('risk-flags fixture — pins assessUserAccess against every named scenario', () => {
  const f = fixture('risk-flags.json');
  const now = new Date(f.now);
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const toInput = (s: (typeof f.scenarios)[string]): UserAccessInput => ({
    organizationId: f.org,
    isActive: s.isActive,
    deletedAt: s.deletedAtIsNow ? now : null,
    lastLoginAt: s.lastLoginAtDaysAgo == null ? null : daysAgo(s.lastLoginAtDaysAgo),
    roles: (s.roles ?? []).map((r: { slug: string; organizationId: string; expiresAtDaysAgo: number | null }) => ({
      slug: r.slug,
      organizationId: r.organizationId === 'OTHER' ? f.otherOrg : f.org,
      expiresAt: r.expiresAtDaysAgo == null ? null : daysAgo(r.expiresAtDaysAgo),
    })),
    isPlatformOwner: s.isPlatformOwner,
    now,
  });

  for (const [name, scenario] of Object.entries(f.scenarios) as [string, (typeof f.scenarios)[string]][]) {
    it(`scenario "${name}" matches assessUserAccess + accessStatusOf`, () => {
      const input = toInput(scenario);
      const result = assessUserAccess(input);
      if (scenario.expectedStatus) {
        expect(result.status).toBe(scenario.expectedStatus);
        expect(accessStatusOf({ isActive: input.isActive, deletedAt: input.deletedAt })).toBe(scenario.expectedStatus);
      }
      for (const [flag, expected] of Object.entries(scenario.expectedFlags)) {
        expect(result.flags[flag as keyof typeof result.flags]).toBe(expected);
      }
    });
  }
});
