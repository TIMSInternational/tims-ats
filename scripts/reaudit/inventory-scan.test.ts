import { describe, it, expect } from 'vitest';
import { scanFile, sourceForPath, type InventoryEntry } from './inventory-scan';

// The static half of the binding inventory: which checks the SOURCE declares, independent of what any
// evidence file says ran. Every tag occurrence is either resolved to the exact evidence name of a test,
// or kept as an UNRESOLVABLE entry (name null) that no evidence can ever satisfy (fail closed).

const pick = (es: readonly InventoryEntry[]) => es.map((e) => ({ id: e.id, source: e.source, name: e.name }));

describe('sourceForPath', () => {
  it('classifies by location and extension; other files are not scanned', () => {
    expect(sourceForPath('tests/a.test.ts')).toBe('vitest');
    expect(sourceForPath('apps/web/x.test.tsx')).toBe('vitest');
    expect(sourceForPath('e2e/specs/company/a.spec.ts')).toBe('playwright');
    expect(sourceForPath('services/Tims.UnitTests/A.cs')).toBe('xunit');
    expect(sourceForPath('docs/a.md')).toBeNull();
    expect(sourceForPath('a.json')).toBeNull();
  });
});

describe('scanFile: vitest', () => {
  it('a tagged leaf test resolves to its full name (ancestor titles joined by a space)', () => {
    const src = `describe('s', () => {\n  it('ideal holds [finding:syn-a]', () => {});\n  it('untagged', () => {});\n});`;
    const r = scanFile('tests/a.test.ts', src);
    expect(pick(r.entries)).toEqual([{ id: 'syn-a', source: 'vitest', name: 's ideal holds [finding:syn-a]' }]);
    expect(r.entries[0]?.line).toBe(2);
    expect(r.unattributable).toEqual([]);
  });

  it('two tagged tests in one file are two entries (each must appear in the evidence)', () => {
    const src = `it('one [finding:syn-a]', () => {});\ntest('two [finding:syn-a]', async () => {});`;
    expect(pick(scanFile('tests/a.test.ts', src).entries).map((e) => e.name)).toEqual([
      'one [finding:syn-a]',
      'two [finding:syn-a]',
    ]);
  });

  it('a tag on a describe binds every test under it, each by its own full name', () => {
    const src = `describe('g [finding:syn-a]', () => {\n  describe('inner', () => {\n    it('x', () => {});\n  });\n  it.skip('y', () => {});\n});`;
    expect(pick(scanFile('tests/a.test.ts', src).entries).map((e) => e.name)).toEqual([
      'g [finding:syn-a] inner x',
      'g [finding:syn-a] y',
    ]);
  });

  it('modifiers (only, skip, fails, concurrent, skipIf(..)) still declare a test; template literals without substitutions are static', () => {
    const src = 'it.fails(`a [finding:syn-a]`, () => {});\nit.skipIf(process.env.X)("b [finding:syn-b]", () => {});';
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([
      { id: 'syn-a', source: 'vitest', name: 'a [finding:syn-a]' },
      { id: 'syn-b', source: 'vitest', name: 'b [finding:syn-b]' },
    ]);
  });

  it('a dynamic title (template substitution) is UNRESOLVABLE, never dropped', () => {
    const src = 'const n = 1;\nit(`case ${n} [finding:syn-a]`, () => {});';
    const r = scanFile('tests/a.test.ts', src);
    expect(pick(r.entries)).toEqual([{ id: 'syn-a', source: 'vitest', name: null }]);
    expect(r.entries[0]?.line).toBe(2);
  });

  it('.each / .for titles are formatted at runtime: UNRESOLVABLE', () => {
    const src = "it.each([1, 2])('row %s [finding:syn-a]', () => {});";
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([{ id: 'syn-a', source: 'vitest', name: null }]);
  });

  it('a tagged describe with a dynamic child: the child carries the tag under an unknown name, UNRESOLVABLE', () => {
    const src = "describe('g [finding:syn-a]', () => {\n  for (const c of cases) it(c.name, () => {});\n});";
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([{ id: 'syn-a', source: 'vitest', name: null }]);
  });

  it('a tagged describe that calls an unknown helper (which may declare tests) adds an UNRESOLVABLE entry', () => {
    const src = "describe('g [finding:syn-a]', () => {\n  it('x', () => {});\n  sharedChecks();\n});";
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([
      { id: 'syn-a', source: 'vitest', name: 'g [finding:syn-a] x' },
      { id: 'syn-a', source: 'vitest', name: null },
    ]);
  });

  it('hooks and vi/expect calls in a tagged describe are not helpers', () => {
    const src =
      "describe('g [finding:syn-a]', () => {\n  beforeEach(() => {});\n  vi.useFakeTimers();\n  it('x', () => {});\n});";
    expect(pick(scanFile('tests/a.test.ts', src).entries).map((e) => e.name)).toEqual(['g [finding:syn-a] x']);
  });

  it('a tagged describe with no statically visible test is UNRESOLVABLE', () => {
    const src = "describe('g [finding:syn-a]', () => {});";
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([{ id: 'syn-a', source: 'vitest', name: null }]);
  });

  it('a tag outside any test title (comment, constant, test body) is UNRESOLVABLE', () => {
    const src =
      "// covers [finding:syn-a]\nconst T = '[finding:syn-b]';\nit('x', () => { expect('[finding:syn-c]').toBeTruthy(); });";
    expect(pick(scanFile('tests/a.test.ts', src).entries)).toEqual([
      { id: 'syn-a', source: 'vitest', name: null },
      { id: 'syn-b', source: 'vitest', name: null },
      { id: 'syn-c', source: 'vitest', name: null },
    ]);
  });

  it('a tag prefix with no static slug cannot be attributed to an id: reported as unattributable', () => {
    const src = 'const id = "syn-a";\nit(`x [finding:${id}]`, () => {});';
    const r = scanFile('tests/a.test.ts', src);
    expect(r.entries).toEqual([]);
    expect(r.unattributable).toEqual(['tests/a.test.ts:2']);
  });

  it('a file with no tag yields nothing', () => {
    expect(scanFile('tests/a.test.ts', "it('x', () => {});")).toEqual({ entries: [], unattributable: [] });
  });
});

describe('scanFile: playwright', () => {
  it('a title tag resolves to the title path below the file, joined by " › "', () => {
    const src =
      "test.describe('J1 journey', () => {\n  test('step @finding:syn-a', async ({ page }) => {\n    await test.step('inner', async () => {});\n  });\n});";
    expect(pick(scanFile('e2e/specs/j1.spec.ts', src).entries)).toEqual([
      { id: 'syn-a', source: 'playwright', name: 'J1 journey › step @finding:syn-a' },
    ]);
  });

  it('a { tag } option on the test, or inherited from a describe, binds', () => {
    const src =
      "test.describe('J', { tag: ['@smoke', '@finding:syn-a'] }, () => {\n  test('s1', { tag: '@finding:syn-b' }, async () => {});\n});";
    expect(pick(scanFile('e2e/specs/j.spec.ts', src).entries)).toEqual([
      { id: 'syn-a', source: 'playwright', name: 'J › s1' },
      { id: 'syn-b', source: 'playwright', name: 'J › s1' },
    ]);
  });

  it('an anonymous describe adds no title segment', () => {
    const src = "test.describe(() => {\n  test('s @finding:syn-a', async () => {});\n});";
    expect(pick(scanFile('e2e/specs/j.spec.ts', src).entries).map((e) => e.name)).toEqual(['s @finding:syn-a']);
  });

  it('test.skip(condition, reason) is not a test declaration', () => {
    const src =
      "test.describe('J @finding:syn-a', () => {\n  test.skip(isMobile, 'desktop only');\n  test('s', async () => {});\n});";
    expect(pick(scanFile('e2e/specs/j.spec.ts', src).entries).map((e) => e.name)).toEqual(['J @finding:syn-a › s']);
  });

  it('a non-literal tag option cannot be attributed (unattributable), and its literal elsewhere is UNRESOLVABLE', () => {
    const r = scanFile('e2e/specs/j.spec.ts', "const tag = '@finding:syn-a';\ntest('s', { tag }, async () => {});");
    expect(pick(r.entries)).toEqual([{ id: 'syn-a', source: 'playwright', name: null }]);
    expect(r.unattributable).toEqual(['e2e/specs/j.spec.ts:2']);
  });

  it('a prose placeholder (no id, not a dynamic construct) is neither an entry nor unattributable', () => {
    expect(scanFile('e2e/lib/x.ts', '// declare { tag: `@finding:<id>` } on every test')).toEqual({
      entries: [],
      unattributable: [],
    });
  });

  it("a tag prefix built by concatenation ('@finding:' + id) is unattributable", () => {
    const r = scanFile('e2e/lib/x.ts', "export const tagFor = (id: string) => '@finding:' + id;");
    expect(r.unattributable).toEqual(['e2e/lib/x.ts:1']);
  });
});

describe('scanFile: xunit (C#)', () => {
  it('a DisplayName literal resolves to that exact name', () => {
    const src = '  [Fact(DisplayName = "ideal holds [finding:syn-a]")]\n  public void A() {}';
    expect(pick(scanFile('services/T/A.cs', src).entries)).toEqual([
      { id: 'syn-a', source: 'xunit', name: 'ideal holds [finding:syn-a]' },
    ]);
  });

  it('escapes in the literal are decoded', () => {
    const src = '[Theory(DisplayName = "say \\"hi\\" [finding:syn-a]")]';
    expect(pick(scanFile('services/T/A.cs', src).entries)[0]?.name).toBe('say "hi" [finding:syn-a]');
  });

  it('an interpolated, verbatim or non-DisplayName occurrence is UNRESOLVABLE', () => {
    const src = [
      '[Fact(DisplayName = $"x {N} [finding:syn-a]")]',
      '[Fact(DisplayName = @"y [finding:syn-b]")]',
      '// [finding:syn-c]',
      'const string D = "z [finding:syn-d]";',
    ].join('\n');
    expect(pick(scanFile('services/T/A.cs', src).entries)).toEqual([
      { id: 'syn-a', source: 'xunit', name: null },
      { id: 'syn-b', source: 'xunit', name: null },
      { id: 'syn-c', source: 'xunit', name: null },
      { id: 'syn-d', source: 'xunit', name: null },
    ]);
  });
});
