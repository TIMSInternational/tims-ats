import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
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
// TS-DELETION 2026-08-05 (#59): `readComp` (packages/api/src/routers/compensation.ts) and
// `readCompAudited` (+ services/compensation.service.ts) are GONE — both files were deleted with the
// last 4 zero-FE-consumer compensation procedures. The guarantees they guarded now live in the shared
// kernels below (still read here) and in the C# implementation + its tests.
// Phase-5 Slice 9 (compensation strangler): the compa-ratio min-5 distribution + benefits utilization are
// pure @tims/shared kernels golden-fixtured against the C# port (contracts/compensation-fixtures). Their TS
// router procedures were DELETED on 2026-07-29 (C#-only now), so the router no longer calls either kernel —
// these tripwires guard the kernels themselves, which remain the live cross-stack contract. UPDATE
// 2026-07-31: band-distribution/total-comp-breakdown/dashboard-kpis joined them — their TS procedures
// (getBandDistribution/getTotalCompBreakdown/getDashboardKpis) were also deleted once
// NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP went permanently live, so the router no longer calls
// buildBandDistribution/buildTotalCompBreakdown/buildCompDashboardKpis either — same kernel-only tripwire
// pattern applies to all five now.
const readCompKernel = () => readFileSync(join(ROOT, 'packages/shared/src/compensation.ts'), 'utf8');
const readDeiService = () => readFileSync(join(ROOT, 'packages/api/src/services/dei.service.ts'), 'utf8');
// Slice-11b: the demographic-distribution / dashboard-KPI / leadership / inclusion min-5 suppression was extracted
// VERBATIM into the shared @tims/shared dei kernel (golden-fixtured both stacks); the service now DELEGATES to it.
// getPayEquity stays inline in the service (FX → Slice 11c). Tripwires guard the floors in their new home.
const readDeiKernel = () => readFileSync(join(ROOT, 'packages/shared/src/dei.ts'), 'utf8');
const readEngagement = () => readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
// Phase-5 Slice-11: the engagement min-5 aggregate suppression (survey-results / eNPS / climate / results-by-area
// / dashboard-KPI differencing guard) was extracted VERBATIM into the shared @tims/shared engagement kernels so
// BOTH the live TS router AND the C# port consume ONE golden-fixtured definition. The floors themselves live
// here. UPDATE 2026-07-31 (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod): getEnps/
// getClimateHeatmap/getDashboardKpis's TS procedures were DELETED (C#-only now), so the router no longer calls
// computeEnps/buildClimateHeatmap/buildEngagementKpis — only summarizeSurveyResults (getSurveyResults) and
// buildResultsByArea (getResultsByArea) are still router-delegated. All five kernels remain the live
// cross-stack contract regardless (golden-fixtured against contracts/engagement-fixtures/*.json and covered by
// tests/engagement/kernels-fixtures.test.ts) — these tripwires guard the kernels themselves.
const readEngagementKernels = () => readFileSync(join(ROOT, 'packages/shared/src/engagement.ts'), 'utf8');
const readAssessment = () => readFileSync(join(ROOT, 'packages/api/src/routers/assessment.ts'), 'utf8');
const readCandidateRepo = () =>
  readFileSync(join(ROOT, 'packages/api/src/repositories/candidate.repository.ts'), 'utf8');

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
  // TS-DELETION 2026-08-05 (#59): the "compensation keeps requireOrgScope on aggregates" source
  // tripwire read packages/api/src/routers/compensation.ts, which no longer exists — getPayEquity was
  // its last requireOrgScope caller and was deleted with the rest of the router. The org-gate for the
  // C# pay-equity read is asserted server-side (Platform__FxReadsEnabled surface) and by the parity
  // harness's RBAC check, not by a TS grep.
  //
  // The min-5 floor itself is unaffected and BETTER covered than the grep ever was: the
  // buildCompPayEquity kernel is asserted behaviourally against the shared golden fixture
  // contracts/compensation-fixtures/pay-equity.json (case "1..4 suppresses count+avg+median") by
  // tests/compensation/comp-fx-shaping-fixtures.test.ts:51 on the TS side and by the C# port's
  // CompensationKernels tests on the other.
  it('buildCompPayEquity nulls count + both salary stats for a 1..4 population (kernel, min-5)', () => {
    const k = readCompKernel();
    expect(k).toMatch(/suppressBelowMin5\(convertedSalaries\.length\)/);
    expect(k).toMatch(/averageSalary:\s*null,\s*medianSalary:\s*null/);
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
// TS-DELETION (2026-07-31): getDashboardKpis / getGenderRepresentation / getAgeDistribution /
// getNationalityDiversity / getPayEquity / getLeadershipDiversity were deleted from dei.service.ts
// (their router callers were deleted after NEXT_PUBLIC_DEI_READ_VIA_CSHARP went live — see
// packages/api/src/routers/dei.ts). Only getEthnicityDistribution/getDisabilityDistribution
// remain, both DELEGATING to the shared buildDistribution kernel — so the service no longer
// imports suppressBelowMin5 at all (that lived in the now-deleted getPayEquity) and no longer
// calls leadershipDiversity/deiDashboardKpis (their sole callers are also deleted). Those two
// kernels — and getPayEquity's shape/floors — remain live in @tims/shared and are still exercised
// directly by kernels-fixtures.test.ts / pay-equity-fixtures.test.ts (golden-fixtured against the
// C# port), so these tripwires now assert on the KERNEL only, not the (smaller) service.
describe('DEI demographic distributions honor min-5', () => {
  it('dei.service DELEGATES its remaining aggregates to the shared buildDistribution kernel (honest-fixture)', () => {
    const src = readDeiService();
    // Delegation tripwire (#141 honest-fixture): the kernelized reads import + CALL the shared shaper,
    // never a re-implemented inline mirror.
    expect(src).toMatch(/from '@tims\/shared'/);
    expect(src, 'dei.service must call buildDistribution').toMatch(/\bbuildDistribution\(/);
    // suppressBelowMin5 / leadershipDiversity / deiDashboardKpis were only used by the now-deleted
    // getPayEquity / getLeadershipDiversity / getDashboardKpis methods — no longer imported here.
    expect(src).not.toMatch(/suppressBelowMin5/);
    expect(src).not.toMatch(/\bleadershipDiversity\(/);
    expect(src).not.toMatch(/\bdeiDashboardKpis\(/);
  });

  it('every per-group distribution routes a count through suppressBelowMin5 in the KERNEL (>=7 calls)', () => {
    // gender/age/nationality/ethnicity/disability/leadership/dashboard/inclusion floors live in the kernel;
    // payEquity's floors live there too (golden-fixtured, asserted directly by pay-equity-fixtures.test.ts).
    const kernelCalls = readDeiKernel().match(/suppressBelowMin5\(/g) ?? [];
    expect(kernelCalls.length).toBeGreaterThanOrEqual(7);
  });

  it('every per-group distribution emits an empty shape + top-level suppressed (round 7 present-key cardinality) (kernel)', () => {
    const kernel = readDeiKernel();
    // round 7: when ANY group/bucket is sub-floor (or population 1..4) the distribution is EMPTY (no group keys)
    // + a single top-level `suppressed: true`. buildDistribution + leadershipDiversity own these shapes.
    expect(kernel).toMatch(/return \{ groups: \[\], suppressed: true \}/);
    expect(kernel).toMatch(/return \{ totalLeaders: null, byGender: \[\], suppressed: true \}/);
    // The retired round-5 uniform-flag-keep-keys design is gone from the kernel.
    expect(kernel).not.toMatch(/const anySuppressed = /);
    expect(kernel).not.toMatch(
      /count:\s*null as number \| null,\s*percentage:\s*null as number \| null,\s*suppressed:\s*true/,
    );
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

  it('the router DELEGATES its surviving aggregates to the golden-fixtured shared kernels (honest-fixture)', () => {
    const src = readEngagement();
    // UPDATE 2026-07-31: getEnps/getClimateHeatmap/getDashboardKpis were deleted (C#-only now), so only
    // getSurveyResults + getResultsByArea still delegate to a shared kernel from the router — never a
    // re-implemented inline mirror (#141 synthetic-fixture lesson).
    expect(src).toMatch(/from '@tims\/shared'/);
    for (const kernel of ['summarizeSurveyResults', 'buildResultsByArea']) {
      expect(src, `router must call ${kernel}`).toMatch(new RegExp(`\\b${kernel}\\(`));
    }
    // computeEnps/buildClimateHeatmap/buildEngagementKpis are no longer called by the TS router at all —
    // their only remaining TS reference is tests/engagement/kernels-fixtures.test.ts (golden-fixture parity).
    for (const kernel of ['computeEnps', 'buildClimateHeatmap', 'buildEngagementKpis']) {
      expect(src, `router must NOT call deleted-procedure kernel ${kernel}`).not.toMatch(new RegExp(`\\b${kernel}\\(`));
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

  it('keeps requireOrgScope on the surviving engagement aggregates (defense in depth)', () => {
    const matches = readEngagement().match(/requireOrgScope\(ctx\.access\)/g) ?? [];
    // UPDATE 2026-07-31: getEnps, getClimateHeatmap, getLowClimateAlerts, getDashboardKpis were deleted
    // (C#-only now) — each of those 4 also called requireOrgScope, so the floor dropped from 8 to 5. The
    // survivors: getSurveyResults, getResultsByArea, getWordCloud, getSentiment, getRotationRisk.
    expect(matches.length).toBeGreaterThanOrEqual(5);
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
    const includesRaw =
      src.match(/const includesRaw = 'breakdown' in resultSelect \|\| 'rawScore' in resultSelect;/g) ?? [];
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
    expect(kernel).toMatch(
      /const anyGenderSuppressed = input\.genders\.some\(\(g\) => suppressBelowMin5\(g\.count\)\.suppressed\)/,
    );
    expect(kernel).toMatch(
      /const anyLeaderGenderSuppressed = \[\.\.\.leaderCounts\.values\(\)\]\.some\(\(c\) => suppressBelowMin5\(c\)\.suppressed\)/,
    );
  });

  it('nulls genderParityIndex + womenPct when any gender group is suppressed (kernel)', () => {
    const kernel = readDeiKernel();
    expect(kernel).toMatch(/genderParityIndex:\s*anyGenderSuppressed \? null : genderParityIndex/);
    expect(kernel).toMatch(/womenPct:\s*anyGenderSuppressed \? null : pct\(female, genderKnown\)/);
  });

  it('nulls leadershipWomenPct when any leader-gender group is suppressed (kernel)', () => {
    expect(readDeiKernel()).toMatch(
      /leadershipWomenPct:\s*anyLeaderGenderSuppressed \? null : pct\(leaderFemale, input\.leaderGenders\.length\)/,
    );
  });

  // Round 2 + round 7: demographicsCoverage × totalEmployees reconstructs the shared
  // demographics-population denominator → null it when ANY dynamic demographic
  // distribution (gender OR nationality OR ethnicity OR null-DOB) is suppressed.
  it('nulls demographicsCoverage when any demographic distribution is suppressed (round 7 belt-and-suspenders + round 8 null-DOB) (kernel)', () => {
    const kernel = readDeiKernel();
    expect(kernel).toMatch(
      /anyGenderSuppressed \|\| nationalitySuppressed \|\| ethnicitySuppressed \|\| nullDobSuppressed/,
    );
    expect(kernel).toMatch(
      /demographicsCoverage:\s*anyDemographicSuppressed \? null : pct\(input\.withDemographics, input\.totalEmployees\)/,
    );
  });
});

describe('compa-ratio present-key cardinality (fix 2, round 7)', () => {
  // Round 7 SUPERSEDES the round-5 keep-keys-null-counts design: when the comp
  // population is 1..4 OR ANY bucket is sub-floor, emit an EMPTY distribution (no
  // bucket keys) + null total + top-level suppressed:true. No keys ⇒ N + present-key
  // set can never pin a singleton bucket, and N − Σ visible has no operands.
  it('emits an empty distribution + null total + suppressed when the population OR any bucket is sub-floor', () => {
    // The TS router procedure was deleted 2026-07-29 (C#-only); the guards live in the shared kernel,
    // which both stacks are golden-fixtured against.
    const src = readCompKernel();
    expect(src).toMatch(
      /const anyBucketSuppressed = Object\.values\(buckets\)\.some\(\(count\) => suppressBelowMin5\(count\)\.suppressed\)/,
    );
    // round 13-14: floor on the positive-salary population + the non-positive complement
    // (NOT rows.length) so totalEmployees − compensatedEmployees can't recover the non-positive bucket.
    expect(src).toMatch(/suppressBelowMin5\(positiveCount\)\.suppressed/);
    expect(src).toMatch(/suppressBelowMin5\(nonPositiveCount\)\.suppressed/);
    expect(src).toMatch(
      /return \{ distribution: distributionShape, avgCompaRatio, totalEmployees: null, suppressed: true \}/,
    );
    // totalEmployees on the non-suppressed path reports the canonical positive-salary count.
    expect(src).toMatch(/totalEmployees: positiveCount, suppressed: false/);
  });

  // avgCompaRatio floor (round 7, finding 1): floored on the NON-NULL ratio CONTRIBUTOR
  // count, not the all-rows comp count. Now lives in the shared kernel.
  it('floors avgCompaRatio on the non-null compaRatio contributor count (ratios.length)', () => {
    const src = readCompKernel();
    expect(src).toMatch(/ratios\.length && !suppressBelowMin5\(ratios\.length\)\.suppressed/);
  });

  // getBandDistribution: round 7 emits an EMPTY bands array (no band keys) when the total banded+unbanded
  // population is 1..4 OR any band/unbanded bucket is sub-floor. The TS router procedure was TS-deleted
  // 2026-07-31 (NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP confirmed permanently live; C#-only now), so
  // the router no longer calls buildBandDistribution — this tripwire now guards the kernel itself, the
  // live cross-stack contract, same as the compa-ratio tripwires above.
  it('getBandDistribution emits an empty bands array when the population OR any band is sub-floor (round 7 → shared kernel)', () => {
    const k = readCompKernel();
    expect(k).toMatch(/allBands\.some\(\(band\) => suppressBelowMin5\(band\.dots\.length\)\.suppressed\)/);
    expect(k).toMatch(/if \(suppressBelowMin5\(bandedPopulation\)\.suppressed \|\| anyBandSuppressed\) return \[\]/);
    // round 13-14: dots are plotted only for positive-salary rows and the non-positive banded complement is
    // folded into the all-or-nothing trigger.
    expect(k).toMatch(/suppressBelowMin5\(nonPositiveBanded\)\.suppressed/);
    // FIX 1 (Codex#1): the POSITIVE-unbanded sub-bucket is ALSO folded into the trigger, closing the
    // `dashboard.compensatedEmployees − Σdots = positiveUnbanded` differencing oracle.
    expect(k).toMatch(/suppressBelowMin5\(positiveUnbanded\)\.suppressed/);
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
  // UPDATE 2026-07-31: getDashboardKpis's TS procedure was deleted (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP
  // confirmed live in prod; C# is the sole implementation now) — the router no longer runs
  // `surveyResponse.groupBy({ by: ['surveyId'] })` at all, so that source tripwire is gone. The
  // per-survey-count differencing guard itself still lives in (and is guarded by) the shared kernel below;
  // the equivalent C# groupBy is covered by
  // services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementReadEndpointTests.cs.

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
// getEnps (and the other readers) must select only the fields the aggregation
// consumes — never a bare unselected findMany / include of full response rows.
// UPDATE 2026-07-29: the submitSurveyResponse write-side clause was retired together with the TS
// procedure itself (deleted; C# is the sole implementation). Its `select: { id, submittedAt }`
// no-answers-echoed guarantee is now asserted by
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs.
describe('surveyResponse reads use explicit minimal selects (FIX 3)', () => {
  // UPDATE 2026-07-31: getEnps's TS procedure was deleted (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed
  // live in prod; C# is the sole implementation now). Its `surveyResponse.findMany({ select: { answers: true
  // } })` no-full-row guarantee is now asserted by
  // services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementReadEndpointTests.cs — mirrors how
  // submitSurveyResponse's write-side minimal-select tripwire was retired below.
  it('no surveyResponse.findMany at all remains in engagement.ts (getEnps was the only caller)', () => {
    expect(readEngagement()).not.toMatch(/surveyResponse\.findMany\(/);
  });

  it('survey readers select responses.{answers} instead of include: responses: true (no full rows)', () => {
    const src = readEngagement();
    // UPDATE 2026-07-31: getClimateHeatmap's TS procedure was deleted alongside getEnps above — only
    // getSurveyResults still selects responses.{answers} from the router; the broad `include: { responses:
    // true }` (full SurveyResponse rows incl. answers, userId, ids) stays gone from both.
    expect(src).not.toMatch(/include:\s*\{\s*responses:\s*true\s*\}/);
    const scoped = src.match(/responses:\s*\{\s*select:\s*\{\s*answers:\s*true\s*\}\s*\}/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(1);
  });
});

// ── §21 FULL+AUDIT invariant for employeeCompensation ───────────────────────
// TS-DELETION 2026-08-05 (#59): the four tripwires that used to live here read
// packages/api/src/routers/compensation.ts + services/compensation.service.ts and asserted
// that getEmployeeComp/simulateAdjustment audited their employeeCompensation reads. BOTH
// files were deleted (all 4 procedures were zero-FE-consumer dead code with live C#
// equivalents), so those tripwires had no source left to read.
//
// They are NOT simply dropped: re-reading a deleted file would throw, and rewriting them to
// tolerate absence (`?? ''`) would have turned them into vacuous passes — a tick against an
// empty input. They are replaced by the ERA-INDEPENDENT form of the same §21 guarantee, which
// keeps working no matter which file the next employeeCompensation reader lives in:
//
//   every packages/api source file that READS employeeCompensation must also write an audit
//   record in that same file (logDataAccess(...) — the §21 helper — or a direct
//   db.auditLog.create(...), which is what the platform DSAR export uses).
//
// Today the only surviving reader is routers/platform/data-requests.ts (the cross-org
// GDPR/Habeas-Data right-of-access export), which audits via `db.auditLog.create` with
// action 'data_subject_export'. The reader count is asserted >= 1 so that a repo with NO
// reader FAILS this test instead of passing it vacuously.
describe('every TS reader of employeeCompensation audits in-file (§21 FULL+AUDIT)', () => {
  const API_SRC = join(ROOT, 'packages/api/src');

  function walkTs(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkTs(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  const readers = walkTs(API_SRC)
    .map((f) => ({ file: f, src: readFileSync(f, 'utf8') }))
    .filter(({ src }) =>
      /\bemployeeCompensation\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|aggregate|groupBy|count)\(/.test(
        src,
      ),
    );

  it('at least one reader exists (a zero-reader repo must FAIL, not pass vacuously)', () => {
    expect(readers.length).toBeGreaterThanOrEqual(1);
  });

  it('no reader reads employeeCompensation without writing an audit record in the same file', () => {
    const unaudited = readers
      .filter(({ src }) => !/logDataAccess\(/.test(src) && !/auditLog\.create\(/.test(src))
      .map(({ file }) => file.slice(ROOT.length + 1));
    expect(unaudited).toEqual([]);
  });
});
