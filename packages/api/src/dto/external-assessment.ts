// Versioned external contract for assessment profiles. This DTO is the STABLE shape
// integrators depend on — map to it explicitly so the internal Prisma schema can
// evolve without breaking the external API. Bump schemaVersion (and add a v2 mapper)
// for breaking changes; never silently reshape v1.

export interface ExternalAssessmentResultV1 {
  schemaVersion: 'v1';
  assignmentId: string;
  candidateId: string;
  vacancyId: string;
  assessmentType: string | null;
  status: string;
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  scoredAt: Date;
  rawScore: number | null;
  normalizedScore: number | null;
  percentile: number | null;
  interpretation: unknown;
  breakdown: unknown;
  modelVersion: string | null;
}

// The shape the repository returns (result row + selected assignment context). Kept
// loose (the repo's select drives the real fields); the mapper reads only what v1 needs.
export interface ExternalResultRow {
  id: string;
  assignmentId: string;
  rawScore: number | null;
  normalizedScore: number | null;
  percentile: number | null;
  interpretation: unknown;
  breakdown: unknown;
  modelVersion: string | null;
  scoredAt: Date;
  assignment: {
    candidateId: string;
    vacancyId: string;
    status: string;
    assignedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
    assessmentType: { name: string } | null;
  };
}

export function toExternalAssessmentResultV1(row: ExternalResultRow): ExternalAssessmentResultV1 {
  return {
    schemaVersion: 'v1',
    assignmentId: row.assignmentId,
    candidateId: row.assignment.candidateId,
    vacancyId: row.assignment.vacancyId,
    assessmentType: row.assignment.assessmentType?.name ?? null,
    status: row.assignment.status,
    assignedAt: row.assignment.assignedAt,
    startedAt: row.assignment.startedAt,
    completedAt: row.assignment.completedAt,
    expiresAt: row.assignment.expiresAt,
    scoredAt: row.scoredAt,
    rawScore: row.rawScore,
    normalizedScore: row.normalizedScore,
    percentile: row.percentile,
    interpretation: row.interpretation,
    breakdown: row.breakdown,
    modelVersion: row.modelVersion,
  };
}
