import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { CR, CR_TENANT_IDS } from '../../e2e/fixtures/cr-tenant';
import { SYSTEM_ROLE_CATALOG } from '../../packages/db/prisma/seed-access-matrix';

// WP-02 PR-2: the Costa Rica E2E tenant is pure data in e2e/fixtures/cr-tenant.ts. The seed
// driver, the specs, the vitest builders and (by value copy) the C# unit tests read it.
// This file pins the invariants the later PRs rely on.
//
// UUID check. Every id must be RFC 4122 v4 (version nibble 4, variant 8/9/a/b), because
// zod 4's z.uuid() rejects non-RFC ids and the app validates inputs with it after #382.
// main is still on zod 3 (lock: zod@3.25.76), whose z.string().uuid() accepts ANY version
// nibble, so the explicit V4 regex below is what actually catches a bad id today.
// TODO(#382): when zod 4 lands, replace z.string().uuid() with z.uuid() here.
//
// Mutation proof (run once, revert): change one id's version nibble from 4 to 0 in
// cr-tenant.ts. The "v4-valid" case must fail.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isV4 = (id: string): boolean => V4.test(id) && z.string().uuid().safeParse(id).success;

const ID_JSON = resolve(__dirname, '../../services/Tims.Platform/tests/Tims.UnitTests/Support/cr-tenant.ids.json');

/** Every value stored under a key named `id` anywhere in the fixture tree. */
function collectIds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'id' && typeof value === 'string') out.push(value);
      else collectIds(value, out);
    }
  }
  return out;
}

/** Every key anywhere in the fixture tree (for the no-secrets check). */
function collectKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      collectKeys(value, out);
    }
  }
  return out;
}

const STAFF_ROLES = SYSTEM_ROLE_CATALOG.map((r) => r.slug).filter(
  (slug) => slug !== 'external' && slug !== 'candidate',
);
const CATALOG_SLUGS = new Set<string>(SYSTEM_ROLE_CATALOG.map((r) => r.slug));
const users = Object.entries(CR.users);

describe('CR tenant ids', () => {
  const ids = Object.values(CR_TENANT_IDS);

  it('has a non-trivial id map', () => {
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  it('every id is RFC 4122 v4-valid', () => {
    const bad = Object.entries(CR_TENANT_IDS).filter(([, id]) => !isV4(id));
    expect(bad).toEqual([]);
  });

  it('the v4 check rejects a version-0 id, so the case above is not hollow', () => {
    const sample = CR_TENANT_IDS.organization;
    const version0 = `${sample.slice(0, 14)}0${sample.slice(15)}`;
    expect(version0).not.toBe(sample);
    expect(isV4(version0)).toBe(false);
  });

  it('ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every id in the fixture tree is listed in CR_TENANT_IDS', () => {
    const listed = new Set(ids);
    const unlisted = collectIds(CR).filter((id) => !listed.has(id));
    expect(unlisted).toEqual([]);
  });

  it('organization key points at the org id (the C# test reads this key)', () => {
    expect(CR_TENANT_IDS.organization).toBe(CR.org.id);
  });

  it('the C# ids JSON equals the TS ids', () => {
    const json: unknown = JSON.parse(readFileSync(ID_JSON, 'utf8'));
    expect(json).toEqual({ ...CR_TENANT_IDS });
  });
});

describe('CR tenant identity', () => {
  it('is a fictitious org on a reserved test domain', () => {
    expect(CR.org.slug).toBe('cr-vivienda-e2e');
    expect(CR.org.domain).toBe('vivienda-e2e.test');
    expect(CR.company.currency).toBe('CRC');
    expect(CR.company.timezone).toBe('America/Costa_Rica');
    expect(CR.company.language).toBe('es');
  });

  it('every user email is unique and on the test domain', () => {
    const emails = users.map(([, u]) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email.endsWith('@vivienda-e2e.test')).toBe(true);
  });

  it('carries no passwords, tokens or key material (repo is public)', () => {
    const banned = /password|secret|token|rawKey|keyHash/i;
    expect(collectKeys(CR).filter((k) => banned.test(k))).toEqual([]);
  });
});

describe('CR tenant roles and placement', () => {
  it('every staff role in SYSTEM_ROLE_CATALOG has at least one user', () => {
    const covered = new Set(users.map(([, u]) => u.roleSlug));
    expect(STAFF_ROLES.filter((slug) => !covered.has(slug))).toEqual([]);
  });

  it('every role slug is a catalog role or null (the deny persona)', () => {
    const unknown = users
      .map(([, u]) => u.roleSlug)
      .filter((slug): slug is string => slug !== null && !CATALOG_SLUGS.has(slug));
    expect(unknown).toEqual([]);
  });

  it('no staff user carries the external or candidate role', () => {
    const wrong = users.filter(([, u]) => u.roleSlug === 'external' || u.roleSlug === 'candidate');
    expect(wrong).toEqual([]);
  });

  it('every business-unit and team reference resolves', () => {
    const bus = new Set(Object.keys(CR.businessUnits));
    const teams = new Set(Object.keys(CR.teams));
    for (const [, u] of users) {
      for (const bu of u.businessUnits) expect(bus.has(bu)).toBe(true);
      for (const t of u.teams) expect(teams.has(t)).toBe(true);
    }
    for (const team of Object.values(CR.teams)) expect(bus.has(team.businessUnit)).toBe(true);
  });

  it('hrbpUnit is an hrbp with a business unit', () => {
    expect(CR.users.hrbpUnit.roleSlug).toBe('hrbp');
    expect(CR.users.hrbpUnit.businessUnits.length).toBeGreaterThan(0);
  });

  it('hrbpNoUnit is an hrbp with no business unit (the prod shape)', () => {
    expect(CR.users.hrbpNoUnit.roleSlug).toBe('hrbp');
    expect(CR.users.hrbpNoUnit.businessUnits).toEqual([]);
  });

  it('the leader leads a team and is a member of it', () => {
    const led = Object.entries(CR.teams).filter(([, t]) => t.leader === 'leader');
    expect(led.length).toBeGreaterThan(0);
    const memberOf = new Set<string>(CR.users.leader.teams);
    expect(led.some(([key]) => memberOf.has(key))).toBe(true);
  });

  it('orgAdminDeny has no role (deny-proof persona)', () => {
    expect(CR.users.orgAdminDeny.roleSlug).toBeNull();
  });
});
