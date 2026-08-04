import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPED_ENTITIES } from '../../packages/api/src/access/entity-policies';

/**
 * #132 — pin the CROSS-STACK scope fixture to the scope-policy registry.
 *
 * WHY THIS EXISTS. `contracts/access-fixtures/scope-where.json` is not an ordinary fixture: it is the
 * shared contract that BOTH stacks are held to — `tests/access/scope-where-fixtures.test.ts` asserts the
 * TS `scopeWhereFor` against it (calling itself "the production-TS oracle that pins the fixtures"), and
 * `services/Tims.Platform/tests/Tims.UnitTests/Fixtures/ScopeWhereForFixtureTests.cs` asserts the C# port
 * against the same file.
 *
 * The ownership flip in #69 removed two entities from `ScopedEntity` because the runbook said to. `tsc`
 * stayed GREEN — a JSON file has no types — and the only signal was 6 opaque
 * "Entidad sin politica de alcance" throws from a test that does not explain why. The tempting fix was to
 * delete the failing fixture cases, which would have silently deleted the oracle pinning C#'s own
 * implementation. See the ownership-flip-runbook §1 step 6 correction.
 *
 * None of the six P2 reader-sweep greps would have caught it either: all of them are `.ts`-scoped.
 *
 * So this file exists to turn that class of break into a NAMED failure that says what to do.
 */

const ROOT = join(__dirname, '..', '..');
const FIXTURE_REL = 'contracts/access-fixtures/scope-where.json';

interface ScopeCase {
  name: string;
  entity: string;
}
const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURE_REL), 'utf8')) as {
  description: string;
  cases: ScopeCase[];
};

const fixtureEntities = [...new Set(fixture.cases.map((c) => c.entity))].sort();
const registryEntities = [...SCOPED_ENTITIES].sort();

describe('scope-where fixture ↔ ScopedEntity registry (cross-stack contract)', () => {
  it('every entity named in the fixture is a real ScopedEntity', () => {
    const unknown = fixtureEntities.filter((e) => !(SCOPED_ENTITIES as readonly string[]).includes(e));
    expect(
      unknown,
      `${FIXTURE_REL} names ${unknown.length} entity/entities that are NOT in SCOPED_ENTITIES: ` +
        `${unknown.join(', ')}.\n` +
        `If an ownership flip just removed one from packages/api/src/access/entity-policies.ts: PUT IT BACK. ` +
        `scopeWhereFor is a PURE function — it never touches the Prisma client — so a flip does NOT require ` +
        `removing the entity, and this fixture is also asserted by Tims.UnitTests' ScopeWhereForFixtureTests, ` +
        `so the C# owner still needs the policy. Only scoped-probe.ts's DELEGATES map (which dereferences a ` +
        `live Prisma delegate) may drop a flipped entity — see its ProbeableEntity type.`,
    ).toEqual([]);
  });

  it('every ScopedEntity has at least one fixture case pinning its fragment', () => {
    const unpinned = registryEntities.filter((e) => !fixtureEntities.includes(e));
    expect(
      unpinned,
      `${unpinned.length} ScopedEntity value(s) have NO case in ${FIXTURE_REL}: ${unpinned.join(', ')}.\n` +
        `An unpinned entity is one whose scope fragment the C# port is not held to — add cases (at minimum ` +
        `own/team/unit) so both stacks are constrained by the same expected output.`,
    ).toEqual([]);
  });

  it('the two sets are exactly equal, in both directions', () => {
    // Belt-and-braces over the two directional assertions above: this is the invariant in one line, and
    // it is the one to read in a failure diff.
    expect(fixtureEntities).toEqual(registryEntities);
  });

  it('SCOPED_ENTITIES has no duplicates (a dup would mask a missing entity in the counts)', () => {
    expect(new Set(SCOPED_ENTITIES).size).toBe(SCOPED_ENTITIES.length);
  });
});
