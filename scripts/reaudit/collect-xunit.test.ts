import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectXunitTrx, collectXunitDir, XunitReportError } from './collect-xunit';
import { statusById } from './status';

// `dotnet test --logger trx` output. A test binds through its `[Trait("Finding", "<id>")]`, which the TRX
// logger writes as a Property (Key=Finding) on the UnitTest definition. The implementation stage must
// confirm this against one real `dotnet test --logger trx` run and record the evidence in the PR body.

type Def = { id: string; name: string; finding?: string[]; otherTraits?: [string, string][]; outcome: string };

function trx(defs: Def[]): string {
  const definitions = defs
    .map((d) => {
      const props = [
        ...(d.otherTraits ?? []).map(([k, v]) => `<Property><Key>${k}</Key><Value>${v}</Value></Property>`),
        ...(d.finding ?? []).map((f) => `<Property><Key>Finding</Key><Value>${f}</Value></Property>`),
      ].join('');
      return `<UnitTest name="${d.name}" id="${d.id}"><Properties>${props}</Properties><TestMethod className="Syn" name="${d.name}" /></UnitTest>`;
    })
    .join('\n');
  const results = defs
    .map((d) => `<UnitTestResult testId="${d.id}" testName="${d.name}" outcome="${d.outcome}" />`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="run" name="synthetic" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
${results}
  </Results>
  <TestDefinitions>
${definitions}
  </TestDefinitions>
</TestRun>`;
}

describe('collectXunitTrx', () => {
  it('Passed with a Finding trait → FIXED-VERIFIED', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Passes', finding: ['syn-a'], outcome: 'Passed' }]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('Failed with a Finding trait → REGRESSED', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Fails', finding: ['syn-a'], outcome: 'Failed' }]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('REGRESSED');
  });

  it('NotExecuted (skipped) with a Finding trait → STALE-BINDING, never ignored', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Skipped', finding: ['syn-a'], outcome: 'NotExecuted' }]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('STALE-BINDING');
  });

  it('a test with two Finding traits binds both ids', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Two', finding: ['syn-a', 'syn-b'], outcome: 'Passed' }]);
    const byId = statusById(collectXunitTrx(x));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('FIXED-VERIFIED');
  });

  it('a result is joined to ITS definition by testId (not by position)', () => {
    const x = trx([
      { id: 'g1', name: 'Syn.Untagged', outcome: 'Failed' },
      { id: 'g2', name: 'Syn.Tagged', finding: ['syn-a'], outcome: 'Passed' },
    ]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a test without a Finding trait binds nothing', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Plain', otherTraits: [['Category', 'syn-a']], outcome: 'Passed' }]);
    expect(collectXunitTrx(x)).toEqual([]);
  });

  it('extra name bindings (private) bind an untagged test by its exact test name', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Private', outcome: 'Passed' }]);
    const extra = new Map([['Syn.Private', ['syn-private']]]);
    expect(statusById(collectXunitTrx(x, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
  });

  it('a document that is not a TRX TestRun is rejected loudly', () => {
    expect(() => collectXunitTrx('<html></html>')).toThrow(XunitReportError);
  });
});

describe('collectXunitDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reaudit-trx-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every *.trx in the directory', () => {
    writeFileSync(join(dir, 'a.trx'), trx([{ id: 'g1', name: 'A', finding: ['syn-a'], outcome: 'Passed' }]));
    writeFileSync(join(dir, 'b.trx'), trx([{ id: 'g2', name: 'B', finding: ['syn-b'], outcome: 'Failed' }]));
    writeFileSync(join(dir, 'ignore.txt'), 'not a trx');
    const byId = statusById(collectXunitDir(dir));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('REGRESSED');
  });

  it('a missing directory throws with the path', () => {
    const p = join(dir, 'absent');
    expect(() => collectXunitDir(p)).toThrow(p);
  });

  it('a directory with no .trx files throws (nothing ran is not a pass)', () => {
    expect(() => collectXunitDir(dir)).toThrow(/no \.trx/i);
  });
});
