/**
 * kernels-fixtures.test.ts — Phase-5 engagement strangler, Slice 11.
 *
 * Asserts the REAL @tims/shared engagement kernels (the SAME ones the engagement router now calls) against
 * the shared golden contracts/engagement-fixtures/*.json — the SAME fixtures the C# EngagementKernels unit
 * tests assert. Anti-drift: any divergence in either stack (min-5 floors, all-or-nothing suppression, the
 * cross-endpoint differencing guard, half-up rounding, filter(Boolean)/parseInt coercion) turns this red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  computeEnps,
  summarizeSurveyResults,
  buildClimateHeatmap,
  buildResultsByArea,
  buildEngagementKpis,
} from '@tims/shared';

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const load = (file: string): Case[] =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'engagement-fixtures', file), 'utf8')).cases;

describe('engagement kernels — golden parity (real @tims/shared exports)', () => {
  it('computeEnps', () => {
    for (const c of load('compute-enps.json')) {
      const i = c.input as { responseAnswers: Array<Record<string, unknown>>; period: string };
      expect(computeEnps(i.responseAnswers, i.period), c.name).toEqual(c.expected);
    }
  });

  it('summarizeSurveyResults', () => {
    for (const c of load('survey-results.json')) {
      const i = c.input as {
        questions: Array<Record<string, unknown>>;
        responses: Array<{ answers: Record<string, unknown> | null }>;
      };
      expect(summarizeSurveyResults(i.questions, i.responses), c.name).toEqual(c.expected);
    }
  });

  it('buildClimateHeatmap', () => {
    for (const c of load('climate-heatmap.json')) {
      const i = c.input as {
        questions: Array<Record<string, unknown>>;
        responses: Array<{ answers: Record<string, unknown> | null }>;
      };
      expect(buildClimateHeatmap(i.questions, i.responses), c.name).toEqual(c.expected);
    }
  });

  it('buildResultsByArea', () => {
    for (const c of load('results-by-area.json')) {
      const i = c.input as { rows: Array<{ areaKey: string | null; answers: Record<string, unknown> | null }> };
      expect(buildResultsByArea(i.rows), c.name).toEqual(c.expected);
    }
  });

  it('buildEngagementKpis', () => {
    for (const c of load('engagement-kpis.json')) {
      const i = c.input as {
        activeSurveys: number;
        totalResponses: number;
        perSurveyCounts: number[];
        actionPlansOpen: number;
      };
      expect(
        buildEngagementKpis(i.activeSurveys, i.totalResponses, i.perSurveyCounts, i.actionPlansOpen),
        c.name,
      ).toEqual(c.expected);
    }
  });
});
