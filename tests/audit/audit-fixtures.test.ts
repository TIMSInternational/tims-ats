import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// WP2.7 audit-plane parity fixtures (contracts/audit-fixtures/*.json), asserted here against the
// REAL TS `dataClassOf` (classification.ts) + `auditRequiredFor` (audit.ts), and identically by
// Tims.UnitTests (DataClassificationFixtureTests / AuditPolicyFixtureTests). A behavior change edits
// the JSON once; either stack disagreeing turns its CI red. This pins the C# audit classification +
// audit-required policy to the TS source so the single data_access_log writer agrees across stacks.

import { dataClassOf } from '../../packages/api/src/access/classification';
import { auditRequiredFor } from '../../packages/api/src/access/audit';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../contracts/audit-fixtures/${name}`, import.meta.url)),
      'utf8',
    ),
  );

// --- classification.json: assert the REAL dataClassOf headline map ----------------------
describe('audit-fixtures: classification.json', () => {
  const data = fixture('classification.json') as {
    cases: Array<{ name: string; entity: string; expected: string }>;
  };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(dataClassOf(c.entity)).toBe(c.expected);
  });
});

// --- audit-required.json: assert the REAL auditRequiredFor policy ------------------------
describe('audit-fixtures: audit-required.json', () => {
  const data = fixture('audit-required.json') as {
    cases: Array<{ name: string; entity: string; expected: boolean }>;
  };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(auditRequiredFor(c.entity)).toBe(c.expected);
  });
});
