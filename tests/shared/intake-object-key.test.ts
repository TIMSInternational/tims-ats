/**
 * intake-object-key.test.ts — WP-26 PR-2 (candidate-spec-43).
 *
 * Today an application can carry one CV key and nothing else. Intake documents get their own object-key
 * namespace, and a submitted key is only usable when it belongs to the same organization and vacancy.
 * Driven by contracts/invu-intake/object-key-cases.json (shared with the C# IntakeObjectKey mirror).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildIntakeObjectKey, parseIntakeObjectKey } from '@tims/shared';

interface KeyCase {
  name: string;
  key: string;
  expected: { requirementId: string; ext: string } | null;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'invu-intake', 'object-key-cases.json'), 'utf8'),
) as { organizationId: string; vacancyId: string; cases: KeyCase[] };

const { organizationId, vacancyId } = fixture;
const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('parseIntakeObjectKey — golden cases', () => {
  it('has a meaningful fixture', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(parseIntakeObjectKey(c.key, organizationId, vacancyId)).toEqual(c.expected);
    });
  }
});

describe('buildIntakeObjectKey', () => {
  it('builds a key under the org/vacancy/requirement prefix with a fresh lowercase file UUID', () => {
    const key = buildIntakeObjectKey({ organizationId, vacancyId, requirementId: REQUIREMENT_ID, ext: 'pdf' });
    const prefix = `candidate-docs/${organizationId}/${vacancyId}/${REQUIREMENT_ID}/`;
    expect(key.startsWith(prefix)).toBe(true);
    const fileName = key.slice(prefix.length);
    expect(fileName.endsWith('.pdf')).toBe(true);
    expect(fileName.slice(0, -'.pdf'.length)).toMatch(UUID);
  });

  it('round-trips through parseIntakeObjectKey for every allowed extension', () => {
    for (const ext of ['pdf', 'jpg', 'png', 'heic'] as const) {
      const key = buildIntakeObjectKey({ organizationId, vacancyId, requirementId: REQUIREMENT_ID, ext });
      expect(parseIntakeObjectKey(key, organizationId, vacancyId)).toEqual({ requirementId: REQUIREMENT_ID, ext });
    }
  });

  it('never produces the same key twice', () => {
    const a = buildIntakeObjectKey({ organizationId, vacancyId, requirementId: REQUIREMENT_ID, ext: 'pdf' });
    const b = buildIntakeObjectKey({ organizationId, vacancyId, requirementId: REQUIREMENT_ID, ext: 'pdf' });
    expect(a).not.toBe(b);
  });

  it('a key built for one organization does not parse for another', () => {
    const key = buildIntakeObjectKey({ organizationId, vacancyId, requirementId: REQUIREMENT_ID, ext: 'pdf' });
    expect(parseIntakeObjectKey(key, '22222222-2222-4222-8222-222222222222', vacancyId)).toBeNull();
  });
});
