import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COMPETENCY_IDS,
  DEFAULT_COMPETENCY_IDS,
  jobProfileCompetenciesInputSchema,
  publicCompetencyNames,
  ratingKeyFor,
  ratingsCoverCompetencySet,
  readJobProfile,
  resolveCompetencies,
  toStoredCompetencies,
} from '../../packages/shared/src';

// "Competencias del puesto": one writer contract (vacancy.create / vacancy.update / updateJobProfile), one
// parser behind the scorecard, the server's completeness rule and the job-profile seam for the future
// assessment gap analysis.

describe('jobProfileCompetenciesInputSchema (writer contract)', () => {
  it('accepts catalog and custom competencies, trimming names and descriptions', () => {
    const parsed = jobProfileCompetenciesInputSchema.parse([
      { name: '  Liderazgo ', level: 4, code: 'builtin:leadership', description: ' Guía al equipo ' },
      { name: 'Negociación', level: 3 },
    ]);
    expect(parsed[0]).toEqual({
      name: 'Liderazgo',
      level: 4,
      code: 'builtin:leadership',
      description: 'Guía al equipo',
    });
    expect(parsed[1]).toEqual({ name: 'Negociación', level: 3 });
  });

  it('refuses names that differ only in case, accents or spacing, and the same catalog entry twice', () => {
    expect(
      jobProfileCompetenciesInputSchema.safeParse([
        { name: 'Comunicación', level: 3 },
        { name: ' comunicacion ', level: 4 },
      ]).success,
    ).toBe(false);
    expect(
      jobProfileCompetenciesInputSchema.safeParse([
        { name: 'A', level: 3, code: 'builtin:leadership' },
        { name: 'B', level: 3, code: 'builtin:leadership' },
      ]).success,
    ).toBe(false);
  });

  it('bounds every field: empty name, long name/description, level above its scale, bad code, >20 items', () => {
    const bad = [
      [{ name: '   ', level: 3 }],
      [{ name: 'x'.repeat(101), level: 3 }],
      [{ name: 'A', level: 3, description: 'x'.repeat(301) }],
      [{ name: 'A', level: 6 }],
      [{ name: 'A', level: 5, scaleMax: 4 }],
      [{ name: 'A', level: 0 }],
      [{ name: 'A', level: 3, code: 'has spaces' }],
      [{ name: 'A', level: 3, code: 'x'.repeat(65) }],
      Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, level: 3 })),
    ];
    for (const input of bad) expect(jobProfileCompetenciesInputSchema.safeParse(input).success).toBe(false);
    // A 1-4 framework is a scale, not a migration.
    expect(jobProfileCompetenciesInputSchema.safeParse([{ name: 'A', level: 4, scaleMax: 4 }]).success).toBe(true);
  });

  it('stores the scale explicitly and leaves empty optional fields out', () => {
    expect(
      toStoredCompetencies([
        { name: 'A', level: 3 },
        { name: 'B', level: 2, scaleMax: 4, code: 'x:b', description: 'd' },
      ]),
    ).toEqual([
      { name: 'A', level: 3, scaleMax: 5 },
      { name: 'B', level: 2, scaleMax: 4, code: 'x:b', description: 'd' },
    ]);
  });
});

describe('readJobProfile / resolveCompetencies (one parser)', () => {
  const stored = [
    { name: 'Liderazgo', level: 4, scaleMax: 5, code: 'builtin:leadership', description: 'Guía al equipo' },
    { name: 'Negociación', level: 3, scaleMax: 4 },
    { name: 'Excel', level: 2 }, // legacy row: no scale → the 1-5 the scorecard uses
  ];

  it('gives the scorecard the vacancy set with description and target on its own scale', () => {
    const resolved = resolveCompetencies(stored);
    expect(resolved.source).toBe('vacancy');
    expect(resolved.items).toEqual([
      { key: 'Liderazgo', label: 'Liderazgo', targetLevel: 4, targetScaleMax: 5, description: 'Guía al equipo' },
      { key: 'Negociación', label: 'Negociación', targetLevel: 3, targetScaleMax: 4, description: null },
      { key: 'Excel', label: 'Excel', targetLevel: 2, targetScaleMax: 5, description: null },
    ]);
  });

  it('exposes code + target + scale to the gap-analysis seam, with the scorecard keys', () => {
    const view = readJobProfile({
      competencies: stored,
      pcaExpected: { dominance: { min: 40, max: 70 } },
      milExpected: { minScore: 60 },
    });
    expect(view.hasCompetencies).toBe(true);
    expect(view.competencies.map((c) => [c.key, c.code, c.targetLevel, c.scaleMax])).toEqual([
      ['Liderazgo', 'builtin:leadership', 4, 5],
      ['Negociación', null, 3, 4],
      ['Excel', null, 2, 5],
    ]);
    expect(view.competencies.map((c) => c.key)).toEqual(resolveCompetencies(stored).items.map((c) => c.key));
    expect(view.pcaExpected).toEqual({ dominance: { min: 40, max: 70 } });
    expect(view.milExpected).toEqual({ minScore: 60 });
  });

  it('never drops a competency over a malformed description, code or scale (that would change the rated set)', () => {
    const resolved = resolveCompetencies([
      { name: 'SQL', level: 4, description: 42, code: { x: 1 }, scaleMax: 'five' },
    ]);
    expect(resolved.items).toEqual([
      { key: 'SQL', label: 'SQL', targetLevel: 4, targetScaleMax: 5, description: null },
    ]);
  });

  it('shows no target for a level above its own scale, but keeps the competency', () => {
    expect(resolveCompetencies([{ name: 'SQL', level: 5, scaleMax: 4 }]).items[0]).toMatchObject({
      targetLevel: null,
      targetScaleMax: 4,
    });
  });

  it('falls back to the generic set (and an empty seam) for the `{}` default or anything unreadable', () => {
    for (const raw of [{}, null, 'x', [{ level: 3 }]]) {
      expect(resolveCompetencies(raw).source).toBe('default');
      expect(resolveCompetencies(raw).items.map((c) => c.key)).toEqual([...DEFAULT_COMPETENCY_IDS]);
      expect(readJobProfile({ competencies: raw })).toMatchObject({ hasCompetencies: false, competencies: [] });
    }
    expect(readJobProfile(null)).toEqual({
      hasCompetencies: false,
      competencies: [],
      pcaExpected: null,
      milExpected: null,
    });
  });

  it('the server completeness rule accepts a card rating the new-shape set (no F-10 style fallback)', () => {
    const ratings = Object.fromEntries(stored.map((c) => [ratingKeyFor(c.name), 3]));
    expect(ratingsCoverCompetencySet(ratings, stored)).toBe(true);
    const { Excel: _omit, ...missingOne } = ratings;
    expect(ratingsCoverCompetencySet(missingOne, stored)).toBe(false);
  });
});

describe('publicCompetencyNames (careers page)', () => {
  it('returns names only — never levels, scales, codes or descriptions', () => {
    const names = publicCompetencyNames([
      { name: ' Liderazgo ', level: 4, scaleMax: 5, code: 'builtin:leadership', description: 'rubric' },
      'SQL',
      { level: 3 },
      42,
    ]);
    expect(names).toEqual([{ name: 'Liderazgo' }, { name: 'SQL' }]);
    expect(JSON.stringify(names)).not.toMatch(/level|scaleMax|code|rubric/);
    expect(publicCompetencyNames({})).toEqual([]);
  });
});

describe('built-in catalog', () => {
  it('is the generic scorecard + 360 set, de-duplicated (no licensed content in this repository)', () => {
    expect(BUILTIN_COMPETENCY_IDS).toEqual([
      'leadership',
      'analytical',
      'communication',
      'problem_solving',
      'collaboration',
      'execution',
      'adaptability',
      'integrity',
    ]);
  });
});
