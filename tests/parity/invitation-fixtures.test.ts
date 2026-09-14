/**
 * invitation-fixtures.test.ts
 *
 * The TS half of the slice-22 CSV hardening (#75). Both stacks read
 * `contracts/invitation-fixtures/export-invitations-csv.json`; the C# half is
 * `PlatformInvitationsCsvFixtureTests`.
 *
 * WHY THIS FILE EXISTS. `exportInvitationsCsv` hand-rolled its CSV and quoted exactly one of
 * eight fields, so it had no formula-injection defence (CWE-1236) and a comma in any other field
 * shifted that row's later columns. Commit `7ad7b683` fixed it in BOTH stacks at once — the only
 * way to close a parity-pinned divergence. But the C# side pinned the hardened bytes and the TS
 * side pinned NOTHING, so a `git revert` of the TS hunk left vitest, dotnet and tsc all green
 * while silently reopening the defect on the LIVE path. The flag is dark and `verify invitation`
 * has never run, so nothing else would have caught it.
 *
 * The golden alone is not enough: asserting `csvRow(...) === fixture` only tests the shared
 * helper, which is exactly the weakness that let this ship. So the source guard below asserts the
 * ROUTER actually routes through the helper. That is the assertion a revert fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvRow } from '../../packages/shared/src/csv';

const ROOT = join(__dirname, '..', '..');
const fixture = JSON.parse(
  readFileSync(join(ROOT, 'contracts/invitation-fixtures/export-invitations-csv.json'), 'utf8'),
);
const ROUTER = readFileSync(join(ROOT, 'packages/api/src/routers/platform/invitations.ts'), 'utf8');

describe('export-invitations-csv golden (shared with Tims.UnitTests)', () => {
  it('pins the header, built through csvRow exactly as the router builds it', () => {
    expect(csvRow(fixture.headerLabels)).toBe(fixture.header);
  });

  it('pins a hostile row byte-for-byte: formula neutralized, inner quote doubled, every cell quoted', () => {
    const s = fixture.sample;
    const row = csvRow([
      s.email,
      s.type,
      s.organizationName,
      s.roleSlug,
      s.status,
      s.sentAt,
      s.expiresAt,
      s.acceptedAt,
    ]);

    expect(row).toBe(fixture.expectedCsvRow);
    // The neutralizing apostrophe survived quoting, on the field that is actually reachable:
    // organizationName is z.string().min(2).max(100) with no character restriction.
    expect(row).toContain('"\'=');
    // `-` is ITSELF a trigger character, so the placeholders neutralize too. Asserted because it is
    // the part of this change that is visible in the downloaded file.
    expect(row).toContain('"\'-"');
  });
});

describe('exportInvitationsCsv is wired through the shared helper', () => {
  // Source-level, because the procedure needs a db + ctx to invoke. These are the assertions a
  // revert of the TS hunk fails — the golden above would still pass, since it only exercises csvRow.
  it('imports csvRow from @tims/shared', () => {
    expect(ROUTER).toMatch(/import\s*\{[^}]*\bcsvRow\b[^}]*\}\s*from\s*'@tims\/shared'/);
  });

  it('builds both the header and the rows with csvRow', () => {
    // Two call sites: the header and the per-row map. One alone means half the output is unescaped.
    expect(ROUTER.match(/csvRow\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('no longer contains the hand-rolled header literal or the manual quote-escape', () => {
    // Wide regions on purpose — asserted over the WHOLE router, not a sliced procedure body, so
    // reintroducing either shape anywhere in the file trips this.
    expect(ROUTER).not.toContain("'Email,Tipo,Organizacion,Rol,Estado,Enviada,Expira,Aceptada'");
    expect(ROUTER).not.toContain('.replace(/"/g, \'""\')');
  });
});
