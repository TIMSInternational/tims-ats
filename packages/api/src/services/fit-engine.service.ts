import type { Prisma } from '@tims/db';
import { fitEngineRepository } from '../repositories/fit-engine.repository';

// ---------------------------------------------------------------------------
// FIT Engine service — the single writer of FitScore. Deterministic weighted
// scoring: assessment + interview + experience + education + languages,
// combined via a per-role-family weight profile. Missing dimensions are
// excluded and the remaining weight renormalized (never fabricated) —
// AssessmentResult has no internal writer in this codebase today, so most
// candidates will be isPartial until real assessment data exists. The
// candidate-screener LLM call is optional narrative-only context
// (llmJudgment), never part of the weighted math.
// ---------------------------------------------------------------------------

export const FIT_DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;
export type FitDimension = (typeof FIT_DIMENSIONS)[number];

export interface LlmJudgment {
  score: number;
  recommendation: string;
  reasoning: string;
  strengths: string[];
  gaps: string[];
}

export interface FitBreakdown {
  assessment: number | null;
  interview: number | null;
  experience: number | null;
  education: number | null;
  languages: number | null;
  llmJudgment: LlmJudgment | null;
}

const DEFAULT_PROFILE_NAME = 'Default';
const DEFAULT_WEIGHTS: Record<FitDimension, number> = {
  assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2,
};

export const EDUCATION_LEVELS = ['high_school', 'associate', 'bachelor', 'master', 'phd'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

const EDUCATION_KEYWORDS: Record<EducationLevel, string[]> = {
  high_school: ['high school', 'bachiller', 'secundaria'],
  associate: ['associate', 'tecnico', 'técnico', 'technical degree'],
  bachelor: ['bachelor', 'licenciatura', 'ingenieria', 'ingeniería', 'bsc', 'ba ', 'b.s.', 'b.a.'],
  master: ['master', 'maestria', 'maestría', 'msc', 'mba', 'm.s.', 'm.a.'],
  phd: ['phd', 'doctorate', 'doctorado', 'ph.d'],
};

function classifyEducationLevel(degree: string): EducationLevel | null {
  const lower = degree.toLowerCase();
  // Check from highest to lowest so "Master" isn't misclassified by a
  // coincidental "bachelor" substring in a combined-degree label.
  for (let i = EDUCATION_LEVELS.length - 1; i >= 0; i--) {
    const level = EDUCATION_LEVELS[i]!;
    if (EDUCATION_KEYWORDS[level].some((kw) => lower.includes(kw))) return level;
  }
  return null;
}

export interface Requirements {
  minYearsExperience?: number;
  requiredEducationLevel?: EducationLevel;
  requiredLanguages?: string[];
}

function parseRequirements(raw: unknown): Requirements {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const result: Requirements = {};
  if (typeof r.minYearsExperience === 'number') result.minYearsExperience = r.minYearsExperience;
  if (typeof r.requiredEducationLevel === 'string' && (EDUCATION_LEVELS as readonly string[]).includes(r.requiredEducationLevel)) {
    result.requiredEducationLevel = r.requiredEducationLevel as EducationLevel;
  }
  if (Array.isArray(r.requiredLanguages) && r.requiredLanguages.every((l) => typeof l === 'string')) {
    result.requiredLanguages = r.requiredLanguages as string[];
  }
  return result;
}

/** Pure: renormalize a weighted sum over only the available (non-null) dimensions. */
export function computeWeightedScore(
  rawScores: Record<FitDimension, number | null>,
  weights: Record<FitDimension, number>,
): { overallScore: number; isPartial: boolean } {
  let weightedSum = 0;
  let availableWeight = 0;
  let missingAny = false;

  for (const dim of FIT_DIMENSIONS) {
    const raw = rawScores[dim];
    const w = weights[dim] ?? 0;
    if (raw === null || raw === undefined) {
      missingAny = true;
      continue;
    }
    weightedSum += raw * w;
    availableWeight += w;
  }

  if (availableWeight === 0) return { overallScore: 0, isPartial: true };
  return { overallScore: Math.round(weightedSum / availableWeight), isPartial: missingAny };
}

/** Pure: candidate years of experience vs. minYearsExperience, capped at 100. Null if either is unavailable. */
export function deriveExperienceScore(yearsExperience: number | null, requirements: Requirements): number | null {
  if (requirements.minYearsExperience === undefined) return null;
  if (yearsExperience === null || yearsExperience === undefined) return null;
  if (requirements.minYearsExperience <= 0) return 100;
  return Math.min(100, Math.round((yearsExperience / requirements.minYearsExperience) * 100));
}

/** Pure: candidate's highest classified degree vs. requiredEducationLevel ordinal. Null if either is unavailable. */
export function deriveEducationScore(
  education: Array<{ degree?: unknown }> | null,
  requirements: Requirements,
): number | null {
  if (requirements.requiredEducationLevel === undefined) return null;
  if (!education || education.length === 0) return null;

  let highestOrdinal = -1;
  for (const entry of education) {
    if (typeof entry?.degree !== 'string') continue;
    const level = classifyEducationLevel(entry.degree);
    if (level) highestOrdinal = Math.max(highestOrdinal, EDUCATION_LEVELS.indexOf(level));
  }
  if (highestOrdinal === -1) return null;

  const requiredOrdinal = EDUCATION_LEVELS.indexOf(requirements.requiredEducationLevel);
  if (highestOrdinal >= requiredOrdinal) return 100;
  // Proportional distance up the full 5-level ladder (not vs. the required
  // ordinal) — e.g. high_school (ordinal 0) vs. a master's requirement is
  // (0+1)/5*100 = 20, not (0+1)/(3+1)*100 = 25.
  return Math.round(((highestOrdinal + 1) / EDUCATION_LEVELS.length) * 100);
}

/**
 * Strips a trailing parenthetical proficiency/qualifier (e.g. "English (B2)" -> "English")
 * and trims whitespace, so real CV-parser output (which legitimately includes proficiency
 * suffixes, see packages/ai/src/agents/cv-parser.ts) can be compared against plain
 * requirement strings like "English".
 */
function normalizeLanguage(language: string): string {
  return language.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Pure: proportion of requiredLanguages the candidate covers, case-insensitive. Null if either is unavailable. */
export function deriveLanguageScore(languages: string[] | null, requirements: Requirements): number | null {
  if (!requirements.requiredLanguages || requirements.requiredLanguages.length === 0) return null;
  if (!languages || languages.length === 0) return null;

  const candidateSet = new Set(languages.map((l) => normalizeLanguage(l).toLowerCase()));
  const matched = requirements.requiredLanguages.filter((l) => candidateSet.has(normalizeLanguage(l).toLowerCase())).length;
  return Math.round((matched / requirements.requiredLanguages.length) * 100);
}

async function resolveWeightProfile(orgId: string, roleFamily: string | null): Promise<Record<FitDimension, number>> {
  if (roleFamily) {
    const profile = await fitEngineRepository.findWeightProfile(orgId, roleFamily);
    if (profile) return profile.weights as Record<FitDimension, number>;
  }
  const defaultProfile = await fitEngineRepository.findWeightProfile(orgId, DEFAULT_PROFILE_NAME);
  if (defaultProfile) return defaultProfile.weights as Record<FitDimension, number>;

  const created = await fitEngineRepository.upsertWeightProfile(orgId, DEFAULT_PROFILE_NAME, DEFAULT_WEIGHTS);
  return created.weights as Record<FitDimension, number>;
}

export const fitEngineService = {
  async computeFitScore(
    orgId: string,
    candidateId: string,
    vacancyId: string,
    opts?: { llmJudgment?: LlmJudgment },
  ) {
    const [candidate, vacancy, assessmentScore, interviewScore] = await Promise.all([
      fitEngineRepository.getCandidateForFit(orgId, candidateId),
      fitEngineRepository.getVacancyForFit(orgId, vacancyId),
      fitEngineRepository.getLatestAssessmentScore(orgId, candidateId, vacancyId),
      fitEngineRepository.getLatestInterviewFitScore(orgId, candidateId, vacancyId),
    ]);

    const requirements = parseRequirements(vacancy?.jobProfile?.fitRequirements ?? null);
    const rawScores: Record<FitDimension, number | null> = {
      assessment: assessmentScore,
      interview: interviewScore,
      experience: deriveExperienceScore(candidate?.yearsExperience ?? null, requirements),
      education: deriveEducationScore((candidate?.education as Array<{ degree?: unknown }> | null) ?? null, requirements),
      languages: deriveLanguageScore((candidate?.languages as string[] | null) ?? null, requirements),
    };

    const weights = await resolveWeightProfile(orgId, vacancy?.roleFamily ?? null);
    const { overallScore, isPartial } = computeWeightedScore(rawScores, weights);

    const breakdown: FitBreakdown = { ...rawScores, llmJudgment: opts?.llmJudgment ?? null };

    const saved = await fitEngineRepository.upsertFitScore(
      orgId, candidateId, vacancyId, overallScore, breakdown as unknown as Prisma.InputJsonValue, weights, isPartial,
    );

    return { fitScoreId: saved.id, overallScore, breakdown, weights, isPartial };
  },

  async getRankingForVacancy(orgId: string, vacancyId: string) {
    const rows = await fitEngineRepository.getFitScoresForVacancy(orgId, vacancyId);
    return rows.map((r) => ({
      fitScoreId: r.id,
      candidateId: r.candidate.id,
      firstName: r.candidate.firstName,
      lastName: r.candidate.lastName,
      overallScore: r.overallScore,
      breakdown: r.breakdown as unknown as FitBreakdown,
      isPartial: r.isPartial,
      calculatedAt: r.calculatedAt,
    }));
  },

  async simulateWeights(orgId: string, vacancyId: string, hypotheticalWeights: Record<FitDimension, number>) {
    const rows = await fitEngineRepository.getFitScoresForVacancy(orgId, vacancyId);
    return rows
      .map((r) => {
        const breakdown = r.breakdown as unknown as FitBreakdown;
        const rawScores: Record<FitDimension, number | null> = {
          assessment: breakdown.assessment, interview: breakdown.interview, experience: breakdown.experience,
          education: breakdown.education, languages: breakdown.languages,
        };
        const { overallScore, isPartial } = computeWeightedScore(rawScores, hypotheticalWeights);
        return {
          candidateId: r.candidate.id, firstName: r.candidate.firstName, lastName: r.candidate.lastName,
          simulatedScore: overallScore, isPartial,
        };
      })
      .sort((a, b) => b.simulatedScore - a.simulatedScore);
  },

  async upsertWeightProfile(orgId: string, name: string, weights: Record<FitDimension, number>) {
    const saved = await fitEngineRepository.upsertWeightProfile(orgId, name, weights);
    return { id: saved.id, name: saved.name, weights: saved.weights as Record<FitDimension, number> };
  },

  async listWeightProfiles(orgId: string) {
    const rows = await fitEngineRepository.listWeightProfiles(orgId);
    return rows.map((r) => ({ id: r.id, name: r.name, weights: r.weights as Record<FitDimension, number> }));
  },

  async getFitScoreForExplain(orgId: string, candidateId: string, vacancyId: string) {
    const row = await fitEngineRepository.getFitScoreForExplain(orgId, candidateId, vacancyId);
    if (!row) return null;
    return {
      overallScore: row.overallScore,
      breakdown: row.breakdown as unknown as FitBreakdown,
      candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`,
      vacancyTitle: row.vacancy.title,
    };
  },

  async computeForVacancy(orgId: string, vacancyId: string) {
    const candidateIds = await fitEngineRepository.getPipelineCandidateIds(orgId, vacancyId);
    const results = await Promise.all(
      candidateIds.map((candidateId) => fitEngineService.computeFitScore(orgId, candidateId, vacancyId)),
    );
    return { computed: results.length };
  },
};
