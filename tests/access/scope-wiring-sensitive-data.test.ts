import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { suppressBelowMin5, aggregateGroups } from '../../packages/api/src/access/aggregate';

// Wave 2.5 slice 6 — min-5 k-anonymity suppression wired into compensation
// aggregate endpoints. Helper-contract tests pin suppressBelowMin5 semantics;
// source tripwires assert the router routes per-bucket/band/group counts through it.
//
// Defense in depth: min-5 sits ON TOP of the existing requireOrgScope org-gate.
// Scope-aware narrowing of comp aggregates for narrow roles is the documented
// follow-on; this slice only suppresses small (1..4) buckets.

const ROOT = join(__dirname, '..', '..');
const readComp = () => readFileSync(join(ROOT, 'packages/api/src/routers/compensation.ts'), 'utf8');
// Phase-5 Slice 9 (compensation strangler): the compa-ratio min-5 distribution + benefits utilization are
// now the pure @tims/shared kernels the router RETURNS (honest-fixture rule) + the C# port mirrors. The
// min-5 guards that USED to live inline in the router now live in the kernel (and are golden-fixtured BOTH
// stacks via contracts/compensation-fixtures), so the source tripwires read the kernel + assert delegation.
const readCompKernel = () => readFileSync(join(ROOT, 'packages/shared/src/compensation.ts'), 'utf8');
// The per-person employeeCompensation read (selectFor + FULL+AUDIT logDataAccess)
// lives in the shared compensation.service.ts helper (getEmployeeCompForSubject),
// reused by BOTH compensation.getEmployeeComp and compensation.myCompensation
// (Slice 5B). Audit-guarantee tripwires that count the employeeCompensation audit
// path read the router + service together so the guarantee is enforced wherever
// the code physically lives.
const readCompAudited = () =>
  readComp() + readFileSync(join(ROOT, 'packages/api/src/services/compensation.service.ts'), 'utf8');
const readDeiService = () => readFileSync(join(ROOT, 'packages/api/src/services/dei.service.ts'), 'utf8');
// Slice-11b: the demographic-distribution / dashboard-KPI / leadership / inclusion min-5 suppression was extracted
// VERBATIM into the shared @tims/shared dei kernel (golden-fixtured both stacks); the service now DELEGATES to it.
// getPayEquity stays inline in the service (FX → Slice 11c). Tripwires guard the floors in their new home.
const readDeiKernel = () => readFileSync(join(ROOT, 'packages/shared/src/dei.ts'), 'utf8');
const readEngagement = () => readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
// Phase-5 Slice-11: the engagement min-5 aggregate suppression (survey-results / eNPS / climate / results-by-area
// / dashboard-KPI differencing guard) was extracted VERBATIM into the shared @tims/shared engagement kernels so
// BOTH the live TS router AND the C# port consume ONE golden-fixtured definition. The router now CALLS them; the
// floors themselves live here. Tripwires that guarded the (formerly inline) suppression now guard the kernel.
const readEngagementKernels = () => readFileSync(join(ROOT, 'packages/shared/src/engagement.ts'), 'utf8');
const readAssessment = () => readFileSync(join(ROOT, 'packages/api/src/routers/assessment.ts'), 'utf8');
const readCandidateRepo = () => readFileSync(join(ROOT, 'packages/api/src/repositories/candidate.repository.ts'), 'utf8');

describe('compensation aggregate buckets honor min-5', () => {
  it('a bucket with 3 members is reported suppressed', () => {
    expect(suppressBelowMin5(3)).toEqual({ suppressed: true, count: null });
  });
  it('a bucket with 9 members reports its count', () => {
    expect(suppressBelowMin5(9)).toEqual({ suppressed: false, count: 9 });
  });
  it('an empty bucket (0) is not suppressed', () => {
    expect(suppressBelowMin5(0)).toEqual({ suppressed: false, count: 0 });
  });
  it('a bucket exactly at the floor (5) is not suppressed', () => {
    expect(suppressBelowMin5(5)).toEqual({ suppressed: false, count: 5 });
  });
  it('compensation router imports and uses suppressBelowMin5', () => {
    const src = readComp();
    expect(src).toMatch(/suppressBelowMin5/);
  });
  it('compensation keeps requireOrgScope on aggregates (defense in depth)', () => {
    const src = readComp();
    expect(src).toMatch(/requireOrgScope\(ctx\.access\)/);
  });
});

// ── aggregateGroups helper contract (Task 7) ────────────────────────────────
// A demographic/engagement group of 1..4 must be suppressed; a group of >=5
// passes; and when the total population is below the floor, every group is
// suppressed (two visibly-small groups would otherwise re-identify).
describe('aggregateGroups k-anonymity contract (demographic/engagement groups)', () => {
  it('a demographic group of 2 is suppressed, a group of 7 passes', () => {
    // 2 "female" rows + 7 "male" rows → female suppressed, male passes.
    const rows = [
      ...Array.from({ length: 2 }, () => ({ g: 'female' })),
      ...Array.from({ length: 7 }, () => ({ g: 'male' })),
    ];
    const groups = aggregateGroups(rows, (r) => r.g);
    const female = groups.find((x) => x.key === 'female')!;
    const male = groups.find((x) => x.key === 'male')!;
    expect(female).toEqual({ key: 'female', count: null, suppressed: true });
    expect(male).toEqual({ key: 'male', count: 7, suppressed: false });
  });

  it('a group of exactly 5 is not suppressed', () => {
    const rows = Array.from({ length: 5 }, () => ({ g: 'x' }));
    expect(aggregateGroups(rows, (r) => r.g)).toEqual([{ key: 'x', count: 5, suppressed: false }]);
  });

  it('total population below the floor suppresses ALL groups', () => {
    // 2 + 2 = 4 total (< 5) → both groups suppressed even though neither is empty.
    const rows = [{ g: 'a' }, { g: 'a' }, { g: 'b' }, { g: 'b' }];
    const groups = aggregateGroups(rows, (r) => r.g);
    expect(groups.every((x) => x.suppressed && x.count === null)).toBe(true);
  });

  it('empty input yields no groups (no person to protect)', () => {
    expect(aggregateGroups([] as { g: string }[], (r) => r.g)).toEqual([]);
  });
});

// ── Source tripwires: DEI service honors min-5 (Task 7 Part A) ───────────────
describe('DEI demographic distributions honor min-5', () => {
  it('dei.service imports suppressBelowMin5 (payEquity, still inline) + DELEGATES the demographic aggregates to the shared kernels (honest-fixture)', () => {
    const src = readDeiService();
    // suppressBelowMin5 stays imported for getPayEquity (inline until Slice 11c).
    expect(src).toMatch(/import\s*\{\s*suppressBelowMin5\s*\}\s*from '\.\.\/access'/);
    // Delegation tripwire (#141 honest-fixture): the kernelized reads import + CALL the shared shapers,
    // never a re-implemented inline mirror.
    expect(src).toMatch(/from '@tims\/shared'/);
    for (const kernel of ['buildDistribution', 'leadershipDiversity', 'deiDashboardKpis']) {
      expect(src, `dei.service must call ${kernel}`).toMatch(new RegExp(`\\b${kernel}\\(`));
    }
  });

  it('every per-group distribution routes a count through suppressBelowMin5 — in the KERNEL (>=7 calls) + payEquity in the service', () => {
    // gender/age/nationality/ethnicity/disability/leadership/dashboard/inclusion floors live in the kernel now.
    const kernelCalls = readDeiKernel().match(/suppressBelowMin5\(/g) ?? [];
    expect(kernelCalls.length).toBeGreaterThanOrEqual(7);
    // payEquity retains its floors in the service (population, skipped, per-gender) until Slice 11c.
    const serviceCalls = readDeiService().match(/suppressBelowMin5\(/g) ?? [];
    expect(serviceCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('every per-group distribution emits an empty shape + top-level suppressed (round 7 present-key cardinality)', () => {
    const kernel = readDeiKernel();
    // round 7: when ANY group/bucket is sub-floor (or population 1..4) the distribution is EMPTY (no group keys)
    // + a single top-level `suppressed: true`. buildDistribution + leadershipDiversity own these shapes now.
    expect(kernel).toMatch(/return \{ groups: \[\], suppressed: true \}/);
    expect(kernel).toMatch(/return \{ totalLeaders: null, byGender: \[\], suppressed: true \}/);
    // payEquity's empty-suppressed shape stays inline in the service (Slice 11c).
    expect(readDeiService()).toMatch(/results: \[\] as PayOut\[\], gapPct: null as number \| null, suppressed: true/);
    // The retired round-5 uniform-flag-keep-keys design is gone from the kernel.
    expect(kernel).not.toMatch(/const anySuppressed = /);
    expect(kernel).not.toMatch(/count:\s*null as number \| null,\s*percentage:\s*null as number \| null,\s*suppressed:\s*true/);
  });

  // ── round 7: present-key cardinality — empty distribution when any group sub-floor ──
  it('every per-group distribution computes a single `suppressed` and returns empty when set (kernel)', () => {
    const kernel = readDeiKernel();
    // buildDistribution + leadershipDiversity each compute one `const suppressed =` folding total OR any group.
    const flags = kernel.match(/const suppressed =/g) ?? [];
    expect(flags.length).toBeGreaterThanOrEqual(2);
    // total guard folded into the same `suppressed` expression + the per-group floor.
    expect(kernel).toMatch(/suppressBelowMin5\(total\)\.suppressed \|\|/);
    expect(kernel).toMatch(/groups\.some\(\(g\) => suppressBelowMin5\(g\.count\)\.suppressed\)/);
  });
});

// ── Source tripwires: engagement aggregates honor min-5 (Task 7 Part B) ──────
describe('engagement aggregates honor min-5', () => {
  it('engagement router imports suppressBelowMin5 from the access barrel', () => {
    expect(readEngagement()).toMatch(/suppressBelowMin5.*from '\.\.\/access'/);
  });

  it('the router DELEGATES the aggregates to the golden-fixtured shared kernels (honest-fixture)', () => {
    const src = readEngagement();
    // the router imports the five suppression kernels from @tims/shared and calls each aggregate through them
    // (never a re-implemented inline mirror — #141 synthetic-fixture lesson).
    expect(src).toMatch(/from '@tims\/shared'/);
    for (const kernel of [
      'summarizeSurveyResults',
      'computeEnps',
      'buildClimateHeatmap',
      'buildResultsByArea',
      'buildEngagementKpis',
    ]) {
      expect(src, `router must call ${kernel}`).toMatch(new RegExp(`\\b${kernel}\\(`));
    }
  });

  it('getSurveyResults suppresses the whole survey/questions below the floor (in the shared kernel)', () => {
    const k = readEngagementKernels();
    // survey-level floor on totalResponses; per-question scale (nums.length) + non-scale (answers.length) floors;
    // both fold in a skip bucket; ANY sub-floor question ⇒ EMPTY questionSummaries (all-or-nothing).
    expect(k).toMatch(/suppressBelowMin5\(totalResponses\)/);
    expect(k).toMatch(/suppressBelowMin5\(nums\.length\)/);
    expect(k).toMatch(/suppressBelowMin5\(answers\.length\)/);
    expect(k).toMatch(/const skipped = totalResponses - nums\.length/);
    expect(k).toMatch(/const skipped = totalResponses - answers\.length/);
    expect(k).toMatch(/anyQuestionSuppressed/);
    expect(k).toMatch(/suppressed:\s*true,\s*questionSummaries:\s*\[\]/);
  });

  it('getResultsByArea folds respondent + numeric-contributor + skip head-counts into the trigger (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/suppressBelowMin5\(a\.respondents\)/);
    expect(k).toMatch(/numericContributors/);
    expect(k).toMatch(/suppressBelowMin5\(a\.numericContributors\)\.suppressed/);
    expect(k).toMatch(/suppressBelowMin5\(a\.respondents - a\.numericContributors\)\.suppressed/);
  });

  it('getEnps suppresses below the response floor + folds the skip bucket (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/suppressBelowMin5\(scores\.length\)/);
    expect(k).toMatch(/responseSuppressed/);
  });

  it('getClimateHeatmap has a survey-level floor on total respondents (shared kernel)', () => {
    expect(readEngagementKernels()).toMatch(/suppressBelowMin5\(responses\.length\)/);
  });

  it('keeps requireOrgScope on engagement aggregates (defense in depth)', () => {
    const matches = readEngagement().match(/requireOrgScope\(ctx\.access\)/g) ?? [];
    // getSurveyResults, getEnps, getClimateHeatmap, getResultsByArea, getWordCloud,
    // getSentiment, getLowClimateAlerts, getRotationRisk, getDashboardKpis
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });
});

// ── Source tripwires: AssessmentResult reads are field-gated + audited (slice 6)
// The three result readers (getResults, getResultDetail, compare) must SELECT
// only the result fields the caller's roles are entitled to (raw breakdown/
// rawScore = super_admin only) and must AUDIT each read. These are source
// tripwires: mocking the assessment router's full Prisma data layer (cursor
// pagination, scope fragments, nested includes) is heavier than its value here,
// and the failClosed audit policy — the actual security-sensitive logic — is
// covered behaviorally in audit.test.ts.
describe('assessment.ts result readers use selectFor + audit', () => {
  it('imports selectFor and logDataAccess from the access barrel', () => {
    const src = readAssessment();
    expect(src).toMatch(/import\s*\{[^}]*\bselectFor\b[^}]*\blogDataAccess\b[^}]*\}\s*from '\.\.\/access'/);
  });

  it("builds the result select via selectFor(ctx.access.roles, 'assessmentResult') on all 3 readers", () => {
    const calls = readAssessment().match(/selectFor\(ctx\.access\.roles,\s*'assessmentResult'\)/g) ?? [];
    // getResults, getResultDetail, compare
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('no longer selects the whole result relation (result: true) on the readers', () => {
    // The three readers must now use `result: { select: resultSelect }`, never
    // `result: true` which would leak rawScore/breakdown to every read role.
    const src = readAssessment();
    expect(src).not.toMatch(/result:\s*true/);
    const scoped = src.match(/result:\s*\{\s*select:\s*resultSelect\s*\}/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(3);
  });

  it('derives includesRaw from the select and audits with failClosed: includesRaw', () => {
    const src = readAssessment();
    const includesRaw = src.match(/const includesRaw = 'breakdown' in resultSelect \|\| 'rawScore' in resultSelect;/g) ?? [];
    expect(includesRaw.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/failClosed:\s*includesRaw/);
  });

  it('audits result reads via logDataAccess before returning', () => {
    expect(readAssessment()).toMatch(/logDataAccess\(/);
  });
});

// ── Source tripwires: candidate repo omits restricted psychometric fields (Part B)
// rawScore/breakdown are super_admin-only and the candidate-detail/timeline paths
// carry no role gate, so they are omitted (fail-safe minimal fix; threading roles
// into the nested aggregate select is the documented follow-on).
describe('candidate.repository omits restricted assessment-result fields', () => {
  it('candidate-detail + timeline result selects no longer include rawScore', () => {
    expect(readCandidateRepo()).not.toMatch(/result:\s*\{\s*select:\s*\{[^}]*rawScore/);
  });
  it('candidate-detail result select no longer includes breakdown', () => {
    expect(readCandidateRepo()).not.toMatch(/result:\s*\{\s*select:\s*\{[^}]*breakdown/);
  });
});

// ── Slice 6 (sensitive-data) reviewer fixes: cross-endpoint differencing ─────
// Four high-severity recovery paths from the adversarial review:
//  (1) DEI getDashboardKpis published womenPct/genderParityIndex/leadershipWomenPct
//      derived from the SAME counts the distribution endpoints suppress.
//  (2) compa-ratio returned the exact org-wide totalEmployees alongside suppressed
//      buckets (total − Σ visible = hidden bucket).
//  (3) getSurveyResults leaked the raw small totalResponses, and getResultsByArea's
//      visible area counts subtracted from totalResponses recovered a suppressed area.
//  (4) restricted per-person compensation reads bypassed the fail-closed audit.

describe('DEI getDashboardKpis closes cross-endpoint differencing (fix 1)', () => {
  // The dashboard-KPI differencing suppression moved into the shared deiDashboardKpis kernel (Slice-11b).
  it('computes anyGenderSuppressed / anyLeaderGenderSuppressed over the per-group counts (kernel)', () => {
    const kernel = readDeiKernel();
    expect(kernel).toMatch(/const anyGenderSuppressed = input\.genders\.some\(\(g\) => suppressBelowMin5\(g\.count\)\.suppressed\)/);
    expect(kernel).toMatch(/const anyLeaderGenderSuppressed = \[\.\.\.leaderCounts\.values\(\)\]\.some\(\(c\) => suppressBelowMin5\(c\)\.suppressed\)/);
  });

  it('nulls genderParityIndex + womenPct when any gender group is suppressed (kernel)', () => {
    const kernel = readDeiKernel();
    expect(kernel).toMatch(/genderParityIndex:\s*anyGenderSuppressed \? null : genderParityIndex/);
    expect(kernel).toMatch(/womenPct:\s*anyGenderSuppressed \? null : pct\(female, genderKnown\)/);
  });

  it('nulls leadershipWomenPct when any leader-gender group is suppressed (kernel)', () => {
    expect(readDeiKernel()).toMatch(/leadershipWomenPct:\s*anyLeaderGenderSuppressed \? null : pct\(leaderFemale, input\.leaderGenders\.length\)/);
  });

  // Round 2 + round 7: demographicsCoverage × totalEmployees reconstructs the shared
  // demographics-population denominator → null it when ANY dynamic demographic
  // distribution (gender OR nationality OR ethnicity OR null-DOB) is suppressed.
  it('nulls demographicsCoverage when any demographic distribution is suppressed (round 7 belt-and-suspenders + round 8 null-DOB) (kernel)', () => {
    const kernel = readDeiKernel();
    expect(kernel).toMatch(/anyGenderSuppressed \|\| nationalitySuppressed \|\| ethnicitySuppressed \|\| nullDobSuppressed/);
    expect(kernel).toMatch(/demographicsCoverage:\s*anyDemographicSuppressed \? null : pct\(input\.withDemographics, input\.totalEmployees\)/);
  });
});

describe('compa-ratio present-key cardinality (fix 2, round 7)', () => {
  // Round 7 SUPERSEDES the round-5 keep-keys-null-counts design: when the comp
  // population is 1..4 OR ANY bucket is sub-floor, emit an EMPTY distribution (no
  // bucket keys) + null total + top-level suppressed:true. No keys ⇒ N + present-key
  // set can never pin a singleton bucket, and N − Σ visible has no operands.
  it('emits an empty distribution + null total + suppressed when the population OR any bucket is sub-floor', () => {
    // The router now DELEGATES to the shared kernel (honest-fixture); the guards live in the kernel.
    expect(readComp()).toMatch(/return buildCompaRatioDistribution\(/);
    const src = readCompKernel();
    expect(src).toMatch(/const anyBucketSuppressed = Object\.values\(buckets\)\.some\(\(count\) => suppressBelowMin5\(count\)\.suppressed\)/);
    // round 13-14: floor on the positive-salary population + the non-positive complement
    // (NOT rows.length) so totalEmployees − compensatedEmployees can't recover the non-positive bucket.
    expect(src).toMatch(/suppressBelowMin5\(positiveCount\)\.suppressed/);
    expect(src).toMatch(/suppressBelowMin5\(nonPositiveCount\)\.suppressed/);
    expect(src).toMatch(/return \{ distribution: distributionShape, avgCompaRatio, totalEmployees: null, suppressed: true \}/);
    // totalEmployees on the non-suppressed path reports the canonical positive-salary count.
    expect(src).toMatch(/totalEmployees: positiveCount, suppressed: false/);
  });

  // avgCompaRatio floor (round 7, finding 1): floored on the NON-NULL ratio CONTRIBUTOR
  // count, not the all-rows comp count. Now lives in the shared kernel.
  it('floors avgCompaRatio on the non-null compaRatio contributor count (ratios.length)', () => {
    const src = readCompKernel();
    expect(src).toMatch(/ratios\.length && !suppressBelowMin5\(ratios\.length\)\.suppressed/);
  });

  // getBandDistribution: round 7 emits an EMPTY bands array (no band keys) when the
  // total banded+unbanded population is 1..4 OR any band/unbanded bucket is sub-floor.
  it('getBandDistribution emits an empty bands array when the population OR any band is sub-floor (round 7)', () => {
    const src = readComp();
    expect(src).toMatch(/allBands\.some\(\(band\) => suppressBelowMin5\(band\.dots\.length\)\.suppressed\)/);
    expect(src).toMatch(/if \(suppressBelowMin5\(bandedPopulation\)\.suppressed \|\| anyBandSuppressed\) return \[\]/);
    // round 13-14: dots are plotted only for positive-salary rows and the non-positive
    // banded complement is folded into the all-or-nothing trigger.
    expect(src).toMatch(/suppressBelowMin5\(nonPositiveBanded\)\.suppressed/);
  });
});

describe('engagement survey/area total leaks (fix 3)', () => {
  it('getSurveyResults suppressed branch nulls totalResponses (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/totalResponses:\s*null,\s*suppressed:\s*true/);
  });

  it('getResultsByArea emits an EMPTY results array + suppressed when any area is sub-floor (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/const anyAreaSuppressed =\s*\n?\s*Object\.values\(groups\)\.some\(/);
    // when the survey total OR any area OR the skipped bucket is sub-floor, return an empty results array (no
    // per-area keys) + top-level suppressed:true.
    expect(k).toMatch(/if \(suppressBelowMin5\(rows\.length\)\.suppressed \|\| anyAreaSuppressed\)/);
    expect(k).toMatch(/return \{ results: \[\], suppressed: true \}/);
  });

  // Responses with no company/business-unit (skipped/unassigned, or deleted user) are dropped BEFORE the
  // suppression check, so 3 unassigned + 20 assigned would look all-clear yet totalResponses (23) − visible
  // (20) = 3 recovers the skipped bucket. skippedCount is counted and folded into the trigger (shared kernel).
  it('getResultsByArea counts the skipped/unassigned bucket and folds it into the trigger (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/skippedCount\s*\+=\s*1/);
    expect(k).toMatch(/suppressBelowMin5\(skippedCount\)\.suppressed/);
  });
});

// ── FIX 2 (slice 6 round 8): getDashboardKpis.totalResponses oracle ─────────
// The org-wide totalResponses (>=5) minus the sum of visible (>=5) per-survey
// totals recovers a single suppressed survey's 1..4 count. Share the per-survey
// all-or-nothing trigger: if ANY survey has a 1..4 response count, null the org
// total too.
describe('getDashboardKpis closes the org survey-total differencing oracle (FIX 2)', () => {
  it('computes per-survey response counts via groupBy(surveyId)', () => {
    const src = readEngagement();
    expect(src).toMatch(/surveyResponse\.groupBy\(\{\s*\n?\s*by:\s*\['surveyId'\]/);
  });

  it('suppresses the org total when ANY individual survey is sub-floor (shared kernel)', () => {
    const k = readEngagementKernels();
    expect(k).toMatch(/const anySurveySubFloor = perSurveyCounts\.some\(\(c\) => suppressBelowMin5\(c\)\.suppressed\)/);
    expect(k).toMatch(/suppressBelowMin5\(totalResponses\)\.suppressed \|\| anySurveySubFloor/);
  });

  it('nulls totalResponses (not the raw count) when suppressed (shared kernel)', () => {
    expect(readEngagementKernels()).toMatch(/totalResponses:\s*totalResponsesSuppressed \? null : totalResponses/);
  });
});

// ── FIX 3 (slice 6 round 8): no raw/unselected surveyResponse rows ──────────
// submitSurveyResponse must not echo the confidential answers JSON; getEnps (and
// the other readers) must select only the fields the aggregation consumes — never
// a bare unselected findMany / include of full response rows.
describe('surveyResponse reads/writes use explicit minimal selects (FIX 3)', () => {
  it('submitSurveyResponse create selects only id + submittedAt (no answers echoed)', () => {
    expect(readEngagement()).toMatch(/surveyResponse\.create\([\s\S]*?select:\s*\{\s*id:\s*true,\s*submittedAt:\s*true\s*\}/);
  });

  it('getEnps findMany selects only answers (no full response rows)', () => {
    expect(readEngagement()).toMatch(/surveyResponse\.findMany\(\{[\s\S]*?select:\s*\{\s*answers:\s*true\s*\}/);
  });

  it('no surveyResponse.findMany without an explicit select remains in engagement.ts', () => {
    // every surveyResponse.findMany(...) block must contain a `select:`.
    const src = readEngagement();
    expect(src).not.toMatch(/surveyResponse\.findMany\(\{(?:(?!\bselect\b)[\s\S])*?\}\)/);
  });

  it('survey readers select responses.{answers} instead of include: responses: true (no full rows)', () => {
    const src = readEngagement();
    // the broad `include: { responses: true }` (full SurveyResponse rows incl. answers,
    // userId, ids) is gone from getSurveyResults / getClimateHeatmap.
    expect(src).not.toMatch(/include:\s*\{\s*responses:\s*true\s*\}/);
    // both readers now select only the answers JSON off each response.
    const scoped = src.match(/responses:\s*\{\s*select:\s*\{\s*answers:\s*true\s*\}\s*\}/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(2);
  });
});

describe('restricted compensation reads are audited fail-closed (fix 4)', () => {
  it('compensation router imports logDataAccess from the access barrel', () => {
    expect(readComp()).toMatch(/import\s*\{[^}]*\blogDataAccess\b[^}]*\}\s*from '\.\.\/access'/);
  });

  it('getEmployeeComp (via service) + simulateAdjustment audit on employeeCompensation', () => {
    // getEmployeeComp's audit now lives in the shared service helper; count across
    // router + service so the relocated guarantee is still enforced.
    const calls = readCompAudited().match(/entity:\s*'employeeCompensation'/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('listPendingAdjustments audits each returned row on salaryAdjustment', () => {
    const src = readComp();
    expect(src).toMatch(/entity:\s*'salaryAdjustment'/);
    // the list audits every row via Promise.all over the returned adjustments
    expect(src).toMatch(/adjustments\.map\(\(a\) =>\s*\n?\s*logDataAccess\(/);
  });

  it('audits actorId via impersonatorId fallback and reads ip/ua from headers', () => {
    const src = readComp();
    expect(src).toMatch(/ctx\.user\.impersonatorId \?\? ctx\.user\.id/);
    expect(src).toMatch(/ctx\.headers\.get\('x-forwarded-for'\) \|\| ctx\.headers\.get\('x-real-ip'\)/);
  });

  it('three restricted readers call logDataAccess (getEmployeeComp, simulateAdjustment, listPendingAdjustments)', () => {
    const calls = readComp().match(/logDataAccess\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Slice 6: minimal-select invariant on SalaryAdjustment write mutations ────
// createAdjustment and approveAdjustment must never return an unselected
// SalaryAdjustment row. Both are defense-in-depth: super/hr callers are entitled
// to salary fields, but a write response echoing the full restricted row is
// unnecessary (UI needs only id/status as a creation/approval confirmation) and
// violates the per-record restricted-access invariant.
describe('createAdjustment + approveAdjustment use minimal selects (slice 6 write mutations)', () => {
  it('salaryAdjustment.create has an explicit select (no bare unselected create)', () => {
    const src = readComp();
    // The bare form `salaryAdjustment.create({` without a subsequent `select:` is banned.
    // We check that every salaryAdjustment.create call has a select key.
    expect(src).not.toMatch(/salaryAdjustment\.create\(\{(?:(?!\bselect\b)[\s\S])*?\}\)/);
  });

  it('createAdjustment select is minimal — id and status only', () => {
    const src = readComp();
    // The create select must contain id:true and status:true and be followed by
    // the closing of the create call (no extra salary-data fields).
    expect(src).toMatch(/salaryAdjustment\.create\([\s\S]*?select:\s*\{\s*id:\s*true,\s*status:\s*true\s*\}/);
  });

  it('approveAdjustment findFirst has an explicit select (not full-row)', () => {
    const src = readComp();
    // The findFirst inside approveAdjustment must have a select so restricted salary
    // fields are not loaded unless explicitly listed.
    expect(src).toMatch(/salaryAdjustment\.findFirst\(\{[\s\S]*?status:\s*'pending'[\s\S]*?select:\s*\{/);
  });

  it("approveAdjustment findFirst select includes userId/newSalary/currency (needed by the approval logic) but NOT previousSalary or reason", () => {
    const src = readComp();
    // Extract the findFirst block: from 'findFirst' up to the closing of that call.
    // We check the select fields that appear near it.
    expect(src).toMatch(/select:\s*\{\s*id:\s*true,\s*userId:\s*true,\s*newSalary:\s*true,\s*currency:\s*true\s*\}/);
    // previousSalary and reason must NOT appear in the findFirst select.
    // (They may appear elsewhere in the file — e.g. listPendingAdjustments — so we
    //  check that the findFirst select block specifically is minimal.)
    expect(src).not.toMatch(/salaryAdjustment\.findFirst\(\{[\s\S]*?select:\s*\{[\s\S]*?\bpreviousSalary\b[\s\S]*?\}\s*\}\s*\)/);
  });

  it('approveAdjustment audits the restricted newSalary read via logDataAccess before the update', () => {
    const src = readComp();
    // The audit (entity: salaryAdjustment, action: update) must appear between the
    // findFirst and the salaryAdjustment.update call within approveAdjustment.
    // We verify both exist and that the action:'update' variant is present.
    expect(src).toMatch(/action:\s*'update'/);
    expect(src).toMatch(/entity:\s*'salaryAdjustment'[\s\S]*?action:\s*'update'/);
  });

  it('approveAdjustment returns only id+status (no full restricted row echoed back)', () => {
    // The status transition is now a conditional updateMany inside a $transaction
    // (see the atomicity tests below); the handler returns a plain { id, status }
    // confirmation object — never an unselected SalaryAdjustment row.
    expect(readComp()).toMatch(/return \{ id: input\.id, status: newStatus \}/);
  });

  it('four or more logDataAccess calls now exist (getEmployeeComp[service] + simulateAdjustment + listPendingAdjustments + approveAdjustment)', () => {
    // getEmployeeComp's logDataAccess moved into compensation.service.ts; count
    // across router + service so the four restricted-read audits are all present.
    const calls = readCompAudited().match(/logDataAccess\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });
});

// ── FIX 1 (slice 6 round 8): approveAdjustment is atomic + conditional ───────
// Two concurrent approves could both pass the `status: 'pending'` findFirst and
// race; a failure after the status write left the adjustment 'approved' but
// currentSalary stale. The transition is now a CONDITIONAL updateMany (where
// status:'pending') guarded by count===0 → CONFLICT, and the EmployeeCompensation
// propagation runs in the SAME $transaction so they commit/roll back together.
describe('approveAdjustment is an atomic, conditional state transition (FIX 1)', () => {
  it('wraps the transition + compensation update in a $transaction', () => {
    expect(readComp()).toMatch(/await db\.\$transaction\(async \(tx\) => \{/);
  });

  it('makes the status transition conditional via updateMany on status:pending', () => {
    const src = readComp();
    expect(src).toMatch(/tx\.salaryAdjustment\.updateMany\(\{\s*\n?\s*where:\s*\{\s*id:\s*input\.id,\s*organizationId:\s*ctx\.user\.organizationId,\s*status:\s*'pending'\s*\}/);
  });

  it('throws CONFLICT when the conditional transition matched no row (count === 0)', () => {
    const src = readComp();
    expect(src).toMatch(/if \(transition\.count === 0\)/);
    expect(src).toMatch(/code:\s*'CONFLICT'/);
  });

  it('propagates the approved salary to employeeCompensation INSIDE the transaction', () => {
    // the tx callback updates employeeCompensation via the same `tx` client, not `db`.
    expect(readComp()).toMatch(/tx\.employeeCompensation\.updateMany\(/);
    // and there is no longer a separate post-update db.employeeCompensation write.
    expect(readComp()).not.toMatch(/await db\.employeeCompensation\.updateMany\(/);
  });
});
