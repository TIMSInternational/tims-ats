import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.5 Task 2 — deterministic FIT Engine core.
// computeWeightedScore is a PURE function: given raw 0-100 sub-scores (any of
// which may be null = unavailable) and a weight profile, it renormalizes over
// only the available weight and flags isPartial when anything was missing.
// Never fabricates a score for missing data.

// Mocked at the fitEngineRepository boundary (not @tims/db) — the repository's
// own methods take positional args (see Step 1's repository code) while raw
// Prisma calls take a single options object, so mocking @tims/db directly
// would make the assertions below assert against the wrong call shape.
const getCandidateForFit = vi.fn();
const getVacancyForFit = vi.fn();
const getLatestAssessmentScore = vi.fn();
const getLatestInterviewFitScore = vi.fn();
const findWeightProfile = vi.fn();
const upsertWeightProfile = vi.fn();
const upsertFitScore = vi.fn();

vi.mock('../../packages/api/src/repositories/fit-engine.repository', () => ({
  fitEngineRepository: {
    getCandidateForFit: (...a: unknown[]) => getCandidateForFit(...a),
    getVacancyForFit: (...a: unknown[]) => getVacancyForFit(...a),
    getLatestAssessmentScore: (...a: unknown[]) => getLatestAssessmentScore(...a),
    getLatestInterviewFitScore: (...a: unknown[]) => getLatestInterviewFitScore(...a),
    findWeightProfile: (...a: unknown[]) => findWeightProfile(...a),
    upsertWeightProfile: (...a: unknown[]) => upsertWeightProfile(...a),
    upsertFitScore: (...a: unknown[]) => upsertFitScore(...a),
  },
}));

import { computeWeightedScore, deriveExperienceScore, deriveEducationScore, deriveLanguageScore, fitEngineService } from '../../packages/api/src/services/fit-engine.service';

const EVEN_WEIGHTS = { assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2 };
const ORG_ID = 'org-1';
const CANDIDATE_ID = 'candidate-1';
const VACANCY_ID = 'vacancy-1';

beforeEach(() => vi.clearAllMocks());

describe('computeWeightedScore (pure)', () => {
  it('averages 5 available dimensions with even weights', () => {
    const result = computeWeightedScore(
      { assessment: 80, interview: 60, experience: 100, education: 40, languages: 20 },
      EVEN_WEIGHTS,
    );
    expect(result.overallScore).toBe(60);
    expect(result.isPartial).toBe(false);
  });

  it('renormalizes over available weight when a dimension is missing, and flags isPartial', () => {
    // assessment/education missing -> renormalize over interview+experience+languages (0.6 total)
    const result = computeWeightedScore(
      { assessment: null, interview: 90, experience: 90, education: null, languages: 90 },
      EVEN_WEIGHTS,
    );
    expect(result.overallScore).toBe(90);
    expect(result.isPartial).toBe(true);
  });

  it('returns 0 and isPartial=true when every dimension is missing', () => {
    const result = computeWeightedScore(
      { assessment: null, interview: null, experience: null, education: null, languages: null },
      EVEN_WEIGHTS,
    );
    expect(result.overallScore).toBe(0);
    expect(result.isPartial).toBe(true);
  });

  it('respects unequal weights', () => {
    const result = computeWeightedScore(
      { assessment: 100, interview: 0, experience: null, education: null, languages: null },
      { assessment: 0.8, interview: 0.2, experience: 0, education: 0, languages: 0 },
    );
    expect(result.overallScore).toBe(80);
  });
});

describe('deriveExperienceScore (pure)', () => {
  it('returns null when requirements have no minYearsExperience', () => {
    expect(deriveExperienceScore(5, {})).toBeNull();
  });
  it('returns null when candidate has no yearsExperience', () => {
    expect(deriveExperienceScore(null, { minYearsExperience: 3 })).toBeNull();
  });
  it('caps at 100 when candidate exceeds the requirement', () => {
    expect(deriveExperienceScore(10, { minYearsExperience: 5 })).toBe(100);
  });
  it('scores proportionally when under the requirement', () => {
    expect(deriveExperienceScore(2, { minYearsExperience: 4 })).toBe(50);
  });
});

describe('deriveEducationScore (pure)', () => {
  it('returns null when requirements have no requiredEducationLevel', () => {
    expect(deriveEducationScore([{ degree: 'Bachelor of Science' }], {})).toBeNull();
  });
  it('returns null when candidate has no education entries', () => {
    expect(deriveEducationScore(null, { requiredEducationLevel: 'bachelor' })).toBeNull();
  });
  it('scores 100 when candidate meets the required level', () => {
    expect(deriveEducationScore([{ degree: 'Master of Business Administration' }], { requiredEducationLevel: 'bachelor' })).toBe(100);
  });
  it('scores proportionally when below the required level', () => {
    expect(deriveEducationScore([{ degree: 'High School Diploma' }], { requiredEducationLevel: 'master' })).toBe(20);
  });
});

describe('deriveLanguageScore (pure)', () => {
  it('returns null when requirements have no requiredLanguages', () => {
    expect(deriveLanguageScore(['English'], {})).toBeNull();
  });
  it('returns null when candidate has no languages', () => {
    expect(deriveLanguageScore(null, { requiredLanguages: ['English'] })).toBeNull();
  });
  it('scores by matched proportion, case-insensitive', () => {
    expect(deriveLanguageScore(['english', 'french'], { requiredLanguages: ['English', 'Spanish'] })).toBe(50);
  });
  it('scores 100 when all required languages are covered', () => {
    expect(deriveLanguageScore(['English', 'Spanish', 'French'], { requiredLanguages: ['english', 'spanish'] })).toBe(100);
  });
  it('matches real CV-parser output with trailing proficiency suffixes (e.g. "English (B2)")', () => {
    expect(deriveLanguageScore(['English (B2)', 'Spanish (Native)'], { requiredLanguages: ['English'] })).toBe(100);
  });
  it('scores proportionally when only some proficiency-suffixed languages match', () => {
    expect(
      deriveLanguageScore(['English (B2)', 'Spanish (Native)'], { requiredLanguages: ['English', 'French'] }),
    ).toBe(50);
  });
  it('matches when the requirement itself carries a proficiency suffix', () => {
    expect(deriveLanguageScore(['English'], { requiredLanguages: ['English (B2)'] })).toBe(100);
  });
});

describe('fitEngineService.computeFitScore', () => {
  it('gathers all 4 deterministic dimensions, resolves the Default profile, and persists via upsertFitScore', async () => {
    getCandidateForFit.mockResolvedValue({
      id: CANDIDATE_ID, firstName: 'Ana', lastName: 'Gomez',
      yearsExperience: 6, education: [{ degree: 'Bachelor' }], languages: ['English', 'Spanish'],
    });
    getVacancyForFit.mockResolvedValue({
      id: VACANCY_ID, roleFamily: null,
      jobProfile: { fitRequirements: { minYearsExperience: 3, requiredEducationLevel: 'bachelor', requiredLanguages: ['English'] } },
    });
    getLatestAssessmentScore.mockResolvedValue(70);
    getLatestInterviewFitScore.mockResolvedValue(80);
    findWeightProfile.mockResolvedValue(null); // no Default row yet -> lazily created
    upsertWeightProfile.mockResolvedValue({ id: 'profile-1', name: 'Default', weights: EVEN_WEIGHTS });
    upsertFitScore.mockResolvedValue({
      id: 'fitscore-1', overallScore: 90, isPartial: false,
      breakdown: { assessment: 70, interview: 80, experience: 100, education: 100, languages: 100, llmJudgment: null },
      weights: EVEN_WEIGHTS,
    });

    const result = await fitEngineService.computeFitScore(ORG_ID, CANDIDATE_ID, VACANCY_ID);

    expect(result.overallScore).toBe(90);
    expect(result.isPartial).toBe(false);
    expect(upsertWeightProfile).toHaveBeenCalledWith(ORG_ID, 'Default', EVEN_WEIGHTS);
    expect(upsertFitScore).toHaveBeenCalledWith(
      ORG_ID, CANDIDATE_ID, VACANCY_ID,
      90,
      expect.objectContaining({ assessment: 70, interview: 80, experience: 100, education: 100, languages: 100 }),
      EVEN_WEIGHTS,
      false,
    );
  });

  it('resolves a named role-family profile over Default when Vacancy.roleFamily is set', async () => {
    getCandidateForFit.mockResolvedValue({ id: CANDIDATE_ID, firstName: 'A', lastName: 'B', yearsExperience: null, education: null, languages: null });
    getVacancyForFit.mockResolvedValue({ id: VACANCY_ID, roleFamily: 'sales', jobProfile: null });
    getLatestAssessmentScore.mockResolvedValue(null);
    getLatestInterviewFitScore.mockResolvedValue(null);
    const salesWeights = { assessment: 0.1, interview: 0.5, experience: 0.4, education: 0, languages: 0 };
    findWeightProfile.mockResolvedValue({ id: 'profile-sales', name: 'sales', weights: salesWeights });
    upsertFitScore.mockResolvedValue({ id: 'fitscore-2', overallScore: 0, isPartial: true, breakdown: {}, weights: salesWeights });

    await fitEngineService.computeFitScore(ORG_ID, CANDIDATE_ID, VACANCY_ID);

    expect(findWeightProfile).toHaveBeenCalledWith(ORG_ID, 'sales');
    expect(upsertWeightProfile).not.toHaveBeenCalled();
    expect(upsertFitScore).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, VACANCY_ID, 0, expect.anything(), salesWeights, true);
  });

  it('stores an optional llmJudgment in the breakdown without letting it affect overallScore', async () => {
    getCandidateForFit.mockResolvedValue({ id: CANDIDATE_ID, firstName: 'A', lastName: 'B', yearsExperience: null, education: null, languages: null });
    getVacancyForFit.mockResolvedValue({ id: VACANCY_ID, roleFamily: null, jobProfile: null });
    getLatestAssessmentScore.mockResolvedValue(null);
    getLatestInterviewFitScore.mockResolvedValue(null);
    findWeightProfile.mockResolvedValue({ id: 'profile-1', name: 'Default', weights: EVEN_WEIGHTS });
    upsertFitScore.mockResolvedValue({ id: 'fitscore-3', overallScore: 0, isPartial: true, breakdown: {}, weights: EVEN_WEIGHTS });

    const judgment = { score: 75, recommendation: 'advance', reasoning: 'Strong background.', strengths: ['comms'], gaps: [] };
    await fitEngineService.computeFitScore(ORG_ID, CANDIDATE_ID, VACANCY_ID, { llmJudgment: judgment });

    expect(upsertFitScore).toHaveBeenCalledWith(
      ORG_ID, CANDIDATE_ID, VACANCY_ID,
      0, // still 0 — llmJudgment never enters the weighted sum
      expect.objectContaining({ llmJudgment: judgment }),
      EVEN_WEIGHTS,
      true,
    );
  });
});
