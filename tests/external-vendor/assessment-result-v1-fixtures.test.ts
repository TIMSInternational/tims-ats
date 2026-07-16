import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  toExternalAssessmentResultV1,
  type ExternalResultRow,
} from '../../packages/api/src/dto/external-assessment';

// Phase-5 Slice 1: the SAME golden fixtures asserted by the C# ExternalAssessmentResultV1Mapper
// (contracts/external-fixtures/assessment-result-v1.json) are asserted here against the REAL TS
// toExternalAssessmentResultV1. Proves the row -> v1 remap is byte-identical across stacks: field
// rename, constant schemaVersion 'v1', opaque JSON passthrough, and instant preservation.

interface InputAssignment {
  candidateId: string;
  vacancyId: string;
  status: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  assessmentType: { name: string } | null;
}
interface InputRow {
  id: string;
  assignmentId: string;
  rawScore: number | null;
  normalizedScore: number | null;
  percentile: number | null;
  interpretation: unknown;
  breakdown: unknown;
  modelVersion: string | null;
  scoredAt: string;
  assignment: InputAssignment;
}
interface ExpectedV1 {
  schemaVersion: string;
  assignmentId: string;
  candidateId: string;
  vacancyId: string;
  assessmentType: string | null;
  status: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  scoredAt: string;
  rawScore: number | null;
  normalizedScore: number | null;
  percentile: number | null;
  interpretation: unknown;
  breakdown: unknown;
  modelVersion: string | null;
}

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/external-fixtures/assessment-result-v1.json', import.meta.url)), 'utf8'),
) as { description: string; cases: Array<{ name: string; input: InputRow; expected: ExpectedV1 }> };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

describe('assessment-result-v1.json — real toExternalAssessmentResultV1', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { input, expected } = c;
    const row: ExternalResultRow = {
      id: input.id,
      assignmentId: input.assignmentId,
      rawScore: input.rawScore,
      normalizedScore: input.normalizedScore,
      percentile: input.percentile,
      interpretation: input.interpretation,
      breakdown: input.breakdown,
      modelVersion: input.modelVersion,
      scoredAt: new Date(input.scoredAt),
      assignment: {
        candidateId: input.assignment.candidateId,
        vacancyId: input.assignment.vacancyId,
        status: input.assignment.status,
        assignedAt: new Date(input.assignment.assignedAt),
        startedAt: input.assignment.startedAt ? new Date(input.assignment.startedAt) : null,
        completedAt: input.assignment.completedAt ? new Date(input.assignment.completedAt) : null,
        expiresAt: input.assignment.expiresAt ? new Date(input.assignment.expiresAt) : null,
        assessmentType: input.assignment.assessmentType,
      },
    };

    const v1 = toExternalAssessmentResultV1(row);

    expect(v1.schemaVersion).toBe(expected.schemaVersion);
    expect(v1.assignmentId).toBe(expected.assignmentId);
    expect(v1.candidateId).toBe(expected.candidateId);
    expect(v1.vacancyId).toBe(expected.vacancyId);
    expect(v1.assessmentType).toBe(expected.assessmentType);
    expect(v1.status).toBe(expected.status);
    expect(iso(v1.assignedAt)).toBe(expected.assignedAt);
    expect(iso(v1.startedAt)).toBe(expected.startedAt);
    expect(iso(v1.completedAt)).toBe(expected.completedAt);
    expect(iso(v1.expiresAt)).toBe(expected.expiresAt);
    expect(iso(v1.scoredAt)).toBe(expected.scoredAt);
    expect(v1.rawScore).toBe(expected.rawScore);
    expect(v1.normalizedScore).toBe(expected.normalizedScore);
    expect(v1.percentile).toBe(expected.percentile);
    expect(v1.interpretation).toEqual(expected.interpretation);
    expect(v1.breakdown).toEqual(expected.breakdown);
    expect(v1.modelVersion).toBe(expected.modelVersion);
  });
});
