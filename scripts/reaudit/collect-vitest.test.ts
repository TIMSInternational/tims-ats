import { describe, it, expect } from 'vitest';
import { collectVitest, VitestReportError } from './collect-vitest';
import { statusById } from './status';

// Shape of `npx vitest run --reporter=json --outputFile=<f>` (jest-compatible JSON).
// A test binds when its FULL name (ancestor describe titles + leaf title) contains `[finding:<id>]`.

type Assertion = { ancestorTitles: string[]; title: string; status: string };

function vitestJson(assertions: Assertion[]) {
  return {
    numTotalTests: assertions.length,
    success: true,
    testResults: [
      {
        name: '/abs/tests/synthetic.test.ts',
        status: 'passed',
        assertionResults: assertions.map((a) => ({
          ...a,
          fullName: [...a.ancestorTitles, a.title].join(' '),
        })),
      },
    ],
  };
}

describe('collectVitest', () => {
  it('binds a tag in the leaf title', () => {
    const j = vitestJson([{ ancestorTitles: ['suite'], title: 'works [finding:syn-a]', status: 'passed' }]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('binds a tag in a NESTED describe name (not only the leaf)', () => {
    const j = vitestJson([{ ancestorTitles: ['outer', 'inner [finding:syn-a]'], title: 'leaf', status: 'passed' }]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('FIXED-VERIFIED');
  });

  it('one test may carry several ids', () => {
    const j = vitestJson([{ ancestorTitles: ['[finding:syn-a]'], title: 'leaf [finding:syn-b]', status: 'passed' }]);
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('FIXED-VERIFIED');
  });

  it('two tests on the same id, one failing → REGRESSED', () => {
    const j = vitestJson([
      { ancestorTitles: ['s'], title: 'one [finding:syn-a]', status: 'passed' },
      { ancestorTitles: ['s'], title: 'two [finding:syn-a]', status: 'failed' },
    ]);
    expect(statusById(collectVitest(j)).get('syn-a')).toBe('REGRESSED');
  });

  it('skipped / todo tests bound to an id → STALE-BINDING', () => {
    const j = vitestJson([
      { ancestorTitles: ['s'], title: 'skip [finding:syn-a]', status: 'skipped' },
      { ancestorTitles: ['s'], title: 'todo [finding:syn-b]', status: 'todo' },
      { ancestorTitles: ['s'], title: 'pending [finding:syn-c]', status: 'pending' },
    ]);
    const byId = statusById(collectVitest(j));
    expect(byId.get('syn-a')).toBe('STALE-BINDING');
    expect(byId.get('syn-b')).toBe('STALE-BINDING');
    expect(byId.get('syn-c')).toBe('STALE-BINDING');
  });

  it('a test with no tag binds nothing (the id stays unbound)', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'plain test', status: 'failed' }]);
    expect(collectVitest(j)).toEqual([]);
  });

  it('a malformed tag (not a slug) is not a binding', () => {
    const j = vitestJson([{ ancestorTitles: ['s'], title: 'x [finding:Not A Slug]', status: 'passed' }]);
    expect(collectVitest(j)).toEqual([]);
  });

  it('extra name bindings (private) bind an untagged test by its exact full name', () => {
    const j = vitestJson([{ ancestorTitles: ['security'], title: 'denies cross-org read', status: 'passed' }]);
    const extra = new Map([['security denies cross-org read', ['syn-private']]]);
    expect(statusById(collectVitest(j, extra)).get('syn-private')).toBe('FIXED-VERIFIED');
  });

  it('observations carry source and full test name', () => {
    const j = vitestJson([{ ancestorTitles: ['outer'], title: 'leaf [finding:syn-a]', status: 'passed' }]);
    const [o] = collectVitest(j);
    expect(o?.source).toBe('vitest');
    expect(o?.test).toBe('outer leaf [finding:syn-a]');
  });

  it('input that is not a vitest JSON report is rejected loudly', () => {
    expect(() => collectVitest({ suites: [] })).toThrow(VitestReportError);
  });
});
