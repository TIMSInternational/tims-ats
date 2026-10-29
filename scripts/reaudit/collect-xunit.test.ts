import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectXunitTrx, collectXunitDir, collectXunitRun, XunitReportError } from './collect-xunit';
import { statusById } from './status';

// `dotnet test --logger trx` output. A C# test binds through a `[finding:<id>]` tag in its xUnit
// DisplayName (`[Fact(DisplayName = "... [finding:<id>]")]`), the same convention as vitest titles.
// The VSTest 17.14.1 TRX logger does NOT serialise xUnit traits, so `[Trait("Finding", ...)]` cannot
// carry a binding: fixtures/vstest-17.14.1-xunit-3.1.4.trx is a real logger artifact (paths and host
// sanitised) that proves both points.

const REAL = readFileSync(join(__dirname, 'fixtures', 'vstest-17.14.1-xunit-3.1.4.trx'), 'utf8');

type Def = { id: string; name: string; outcome?: string };

/** Synthetic TRX in the real logger's shape: name on both UnitTest and UnitTestResult, a ResultSummary. */
function trx(defs: Def[], summary = 'Completed'): string {
  const ran = defs.filter((d) => d.outcome !== undefined);
  const definitions = defs
    .map((d) => `<UnitTest name="${d.name}" id="${d.id}"><TestMethod className="Syn" name="M" /></UnitTest>`)
    .join('\n');
  const results = ran
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
  <ResultSummary outcome="${summary}">
    <Counters total="${ran.length}" />
  </ResultSummary>
</TestRun>`;
}

describe('collectXunitTrx — a real VSTest 17.14.1 logger artifact', () => {
  it('binds DisplayName tags: pass, fail, skipped, and every theory row', () => {
    const byId = statusById(collectXunitTrx(REAL));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('REGRESSED');
    expect(byId.get('syn-c')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-d')).toBe('STALE-BINDING');
  });

  it('a [Trait("Finding", ...)] binds nothing, because the logger never writes traits', () => {
    expect(REAL).toContain('SynTests.TraitOnly');
    expect(REAL).not.toMatch(/<Propert/);
    expect(statusById(collectXunitTrx(REAL)).has('syn-e')).toBe(false);
  });

  it('a private name binding matches the exact name the logger wrote', () => {
    const extra = new Map([['SynTests.TraitOnly', ['syn-private']]]);
    expect(statusById(collectXunitTrx(REAL, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
  });

  it('a leading byte-order mark (as the logger writes it) is accepted', () => {
    expect(statusById(collectXunitTrx(`﻿${REAL}`)).get('syn-a')).toBe('FIXED-VERIFIED');
  });
});

describe('collectXunitTrx', () => {
  it('Passed with a tag → FIXED-VERIFIED', () => {
    const x = trx([{ id: 'g1', name: 'passes [finding:syn-a]', outcome: 'Passed' }]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('Failed with a tag → REGRESSED', () => {
    const x = trx([{ id: 'g1', name: 'fails [finding:syn-a]', outcome: 'Failed' }], 'Failed');
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('REGRESSED');
  });

  it('NotExecuted (skipped) with a tag → STALE-BINDING, never ignored', () => {
    const x = trx([{ id: 'g1', name: 'skipped [finding:syn-a]', outcome: 'NotExecuted' }]);
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('STALE-BINDING');
  });

  it('a test with two tags binds both ids', () => {
    const x = trx([{ id: 'g1', name: 'two [finding:syn-a] [finding:syn-b]', outcome: 'Passed' }]);
    const byId = statusById(collectXunitTrx(x));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('FIXED-VERIFIED');
  });

  it('a result is joined to ITS definition by testId (not by position)', () => {
    const x = `<TestRun><Results>
<UnitTestResult testId="g2" testName="ignored" outcome="Passed" />
<UnitTestResult testId="g1" testName="ignored" outcome="Failed" />
</Results><TestDefinitions>
<UnitTest name="untagged" id="g1" /><UnitTest name="tagged [finding:syn-a]" id="g2" />
</TestDefinitions><ResultSummary outcome="Failed"><Counters total="2" /></ResultSummary></TestRun>`;
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a test without a tag binds nothing; a malformed tag is not a binding', () => {
    const x = trx([
      { id: 'g1', name: 'Syn.Plain', outcome: 'Passed' },
      { id: 'g2', name: 'x [finding:Not A Slug]', outcome: 'Passed' },
    ]);
    expect(collectXunitTrx(x)).toEqual([]);
  });

  it('extra name bindings (private) bind an untagged test by its exact test name', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Private', outcome: 'Passed' }]);
    const extra = new Map([['Syn.Private', ['syn-private']]]);
    expect(statusById(collectXunitTrx(x, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
  });

  it('a private binding whose test is ABSENT from the TRX is NOT-RUN, so a sibling pass cannot mask it', () => {
    const x = trx([{ id: 'g1', name: 'Syn.Present', outcome: 'Passed' }]);
    const extra = new Map([
      ['Syn.Present', ['syn-private']],
      ['Syn.Missing', ['syn-private']],
    ]);
    const obs = collectXunitTrx(x, extra);
    expect(obs).toContainEqual({ id: 'syn-private', status: 'NOT-RUN', source: 'xunit', test: 'Syn.Missing' });
    expect(statusById(obs).get('syn-private')).toBe('NOT-RUN');
  });

  it('a tagged DEFINITION with no result is NOT-RUN, so a sibling pass cannot mask it', () => {
    const x = trx([
      { id: 'g1', name: 'ran [finding:syn-a]', outcome: 'Passed' },
      { id: 'g2', name: 'never ran [finding:syn-a]' },
    ]);
    const obs = collectXunitTrx(x);
    expect(obs).toContainEqual({ id: 'syn-a', status: 'NOT-RUN', source: 'xunit', test: 'never ran [finding:syn-a]' });
    expect(statusById(obs).get('syn-a')).toBe('NOT-RUN');
  });

  it('an Aborted run is rejected even when its counters match the results it holds', () => {
    const x = trx(
      [
        { id: 'g1', name: 'ran [finding:syn-a]', outcome: 'Passed' },
        { id: 'g2', name: 'cut off [finding:syn-a]' },
      ],
      'Aborted',
    );
    expect(() => collectXunitTrx(x)).toThrow(XunitReportError);
    expect(() => collectXunitTrx(x)).toThrow(/Aborted/);
  });

  it('every run outcome other than Completed / Passed / Failed is rejected', () => {
    for (const outcome of ['Aborted', 'Timeout', 'Error', 'PassedButRunAborted', 'InProgress', 'Pending']) {
      const x = trx([{ id: 'g1', name: 'p [finding:syn-a]', outcome: 'Passed' }], outcome);
      expect(() => collectXunitTrx(x), outcome).toThrow(XunitReportError);
    }
  });

  it('a TRX with no ResultSummary outcome is rejected', () => {
    const x = trx([{ id: 'g1', name: 'p [finding:syn-a]', outcome: 'Passed' }]).replace(
      /<ResultSummary[\s\S]*?<\/ResultSummary>/,
      '',
    );
    expect(() => collectXunitTrx(x)).toThrow(/ResultSummary/);
  });

  it('a truncated TRX (no closing </TestRun>) is rejected, never read as a partial pass', () => {
    const full = trx([{ id: 'g1', name: 'p [finding:syn-a]', outcome: 'Passed' }]);
    const cut = full.slice(0, full.indexOf('</Results>'));
    expect(() => collectXunitTrx(cut)).toThrow(XunitReportError);
    expect(() => collectXunitTrx(cut)).toThrow(/incomplete/i);
  });

  it('a TRX whose Counters total disagrees with the results it contains is rejected', () => {
    const full = trx([{ id: 'g1', name: 'p [finding:syn-a]', outcome: 'Passed' }]);
    expect(() => collectXunitTrx(full.replace('total="1"', 'total="2"'))).toThrow(/total/i);
    expect(statusById(collectXunitTrx(full)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('a Failed run with no failing result and a run-level Error downgrades its passes to NOT-RUN', () => {
    const x = trx([{ id: 'g1', name: 'check [finding:syn-a]', outcome: 'Passed' }], 'Failed').replace(
      '</ResultSummary>',
      '<RunInfos><RunInfo outcome="Error"><Text>Adapter run-level failure</Text></RunInfo></RunInfos></ResultSummary>',
    );
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('NOT-RUN');
  });

  it('a Failed run with no failing result and no RunInfo is unexplained: its passes are NOT-RUN', () => {
    const x = trx([{ id: 'g1', name: 'check [finding:syn-a]', outcome: 'Passed' }], 'Failed');
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('NOT-RUN');
  });

  it('a Completed run carrying an Error RunInfo that names no failed test downgrades its passes', () => {
    const x = trx([{ id: 'g1', name: 'check [finding:syn-a]', outcome: 'Passed' }]).replace(
      '</ResultSummary>',
      '<RunInfos><RunInfo outcome="Error"><Text>Testhost process exited unexpectedly</Text></RunInfo></RunInfos></ResultSummary>',
    );
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('NOT-RUN');
  });

  it('an extra unexplained Error beside an explained [FAIL] still downgrades the passes', () => {
    const x = trx(
      [
        { id: 'g1', name: 'ok [finding:syn-a]', outcome: 'Passed' },
        { id: 'g2', name: 'broken [finding:syn-b]', outcome: 'Failed' },
      ],
      'Failed',
    ).replace(
      '</ResultSummary>',
      '<RunInfos><RunInfo outcome="Error"><Text>[xUnit.net 00:00:00.08]     broken [finding:syn-b] [FAIL]</Text></RunInfo>' +
        '<RunInfo outcome="Error"><Text>Adapter run-level failure</Text></RunInfo></RunInfos></ResultSummary>',
    );
    const byId = statusById(collectXunitTrx(x));
    expect(byId.get('syn-a')).toBe('NOT-RUN');
    expect(byId.get('syn-b')).toBe('REGRESSED');
  });

  it('an Error RunInfo that names a failed test without the [FAIL] marker is NOT explained', () => {
    const x = trx(
      [
        { id: 'g1', name: 'ok [finding:syn-a]', outcome: 'Passed' },
        { id: 'g2', name: 'broken [finding:syn-b]', outcome: 'Failed' },
      ],
      'Failed',
    ).replace(
      '</ResultSummary>',
      '<RunInfos><RunInfo outcome="Error"><Text>Test host crashed after broken [finding:syn-b]</Text></RunInfo></RunInfos></ResultSummary>',
    );
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('NOT-RUN');
  });

  it('an Error RunInfo that reports a real failed test is explained: sibling passes stay FIXED-VERIFIED', () => {
    const x = trx(
      [
        { id: 'g1', name: 'ok [finding:syn-a]', outcome: 'Passed' },
        { id: 'g2', name: 'broken [finding:syn-b]', outcome: 'Failed' },
      ],
      'Failed',
    ).replace(
      '</ResultSummary>',
      '<RunInfos><RunInfo outcome="Error"><Text>[xUnit.net 00:00:00.08]     broken [finding:syn-b] [FAIL]</Text></RunInfo></RunInfos></ResultSummary>',
    );
    expect(statusById(collectXunitTrx(x)).get('syn-a')).toBe('FIXED-VERIFIED');
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
    writeFileSync(join(dir, 'a.trx'), trx([{ id: 'g1', name: 'A [finding:syn-a]', outcome: 'Passed' }]));
    writeFileSync(join(dir, 'b.trx'), trx([{ id: 'g2', name: 'B [finding:syn-b]', outcome: 'Failed' }], 'Failed'));
    writeFileSync(join(dir, 'ignore.txt'), 'not a trx');
    const byId = statusById(collectXunitDir(dir));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('REGRESSED');
  });

  it('a missing directory throws with the path', () => {
    const p = join(dir, 'absent');
    expect(() => collectXunitDir(p)).toThrow(p);
  });

  it('a private binding is reconciled ACROSS files: present in one file is not NOT-RUN', () => {
    writeFileSync(join(dir, 'a.trx'), trx([{ id: 'g1', name: 'A', outcome: 'Passed' }]));
    writeFileSync(join(dir, 'b.trx'), trx([{ id: 'g2', name: 'B', outcome: 'Passed' }]));
    const extra = new Map([
      ['A', ['syn-private']],
      ['B', ['syn-private']],
    ]);
    expect(statusById(collectXunitDir(dir, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
    const missing = new Map([...extra, ['C', ['syn-private']]]);
    expect(statusById(collectXunitDir(dir, missing)).get('syn-private')).toBe('NOT-RUN');
  });

  it('a directory with no .trx files throws (nothing ran is not a pass)', () => {
    expect(() => collectXunitDir(dir)).toThrow(/no \.trx/i);
  });
});

// Round-7 class: `dotnet test` over several projects writes one TRX per project that RAN. A project that
// fails to build or crashes before its logger runs writes nothing, and only the exit status shows it.
// So any failed .NET run untrusts the whole report.
describe('collectXunitRun: a failed run untrusts the whole report', () => {
  const passing = trx([{ id: 'g1', name: 'ideal [finding:syn-a]', outcome: 'Passed' }]);

  it('a passing TRX with a non-zero recorded exit (another project never wrote one) → untrusted', () => {
    const out = collectXunitRun([{ name: 'a.trx', xml: passing }], undefined, { runExitCode: 1 });
    expect(out.untrusted.join('\n')).toMatch(/exit/);
  });

  it('a failing tagged result → untrusted as well (the same exit may hide a missing project)', () => {
    const failing = trx([{ id: 'g2', name: 'b [finding:syn-b]', outcome: 'Failed' }], 'Failed');
    const out = collectXunitRun(
      [
        { name: 'a.trx', xml: passing },
        { name: 'b.trx', xml: failing },
      ],
      undefined,
      { runExitCode: 1 },
    );
    expect(out.untrusted.length).toBeGreaterThan(0);
    expect(statusById(out.observations).get('syn-b')).toBe('REGRESSED');
  });

  it('exit 0 alongside a failed result is a contradiction → rejected', () => {
    const failing = trx([{ id: 'g2', name: 'b [finding:syn-b]', outcome: 'Failed' }], 'Failed');
    expect(() => collectXunitRun([{ name: 'b.trx', xml: failing }], undefined, { runExitCode: 0 })).toThrow(
      XunitReportError,
    );
  });

  it('a clean run (exit 0, every result passed) is trusted', () => {
    const out = collectXunitRun([{ name: 'a.trx', xml: passing }], undefined, { runExitCode: 0 });
    expect(out.untrusted).toEqual([]);
    expect(statusById(out.observations).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('no exit status at all → untrusted', () => {
    expect(collectXunitRun([{ name: 'a.trx', xml: passing }]).untrusted.length).toBeGreaterThan(0);
  });
});
