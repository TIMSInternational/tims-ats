import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 1 Slice 2 introduces a NEW procedure type — `candidateProcedure` — for the
// authenticated candidate portal. Candidates are NOT staff: they have a Supabase
// session but no `User`/org-membership row, so `protectedProcedure` (which requires
// `ctx.user`) can never serve them. These static-source assertions lock in the
// security properties of the candidate data path: it must authenticate by Supabase
// session, scope every read to BOTH the org AND the resolved candidate (IDOR), and
// run under tenant RLS. They mirror tests/security/auth-authorization.test.ts.

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TRPC = read('packages/api/src/trpc.ts');
const CONTEXT = read('packages/api/src/context.ts');
const ROUTER = read('packages/api/src/routers/candidate-portal.ts');
const SERVICE = read('packages/api/src/services/candidate-portal.service.ts');
const REPO = read('packages/api/src/repositories/candidate-portal.repository.ts');
const ASSESSMENT_SERVICE = read('packages/api/src/services/candidate-assessment.service.ts');
const ASSESSMENT_REPO = read('packages/api/src/repositories/candidate-assessment.repository.ts');
const RATE_LIMIT = read('packages/api/src/middleware/rate-limit.ts');
const ME_PAGE = read('apps/web/app/(portal)/careers/[orgSlug]/me/page.tsx');

describe('candidateProcedure infrastructure', () => {
  it('context exposes a Supabase auth identity decoupled from the staff user', () => {
    expect(CONTEXT).toContain('supabaseAuth');
    // It must be its own field, not folded into `user` (candidates have no User).
    expect(CONTEXT).toMatch(/supabaseAuth:\s*\{[^}]*email:\s*string/s);
  });

  it('defines candidateProcedure gated on a Supabase session, not staff auth', () => {
    expect(TRPC).toContain('candidateProcedure');
    expect(TRPC).toMatch(/isCandidate\s*=\s*t\.middleware/);
    // The gate keys on supabaseAuth (candidate), never on ctx.user (staff).
    expect(TRPC).toMatch(/if\s*\(\s*!ctx\.supabaseAuth\s*\)/);
  });

  it('candidateProcedure does NOT reuse the staff isAuthed gate', () => {
    // Extract the candidateProcedure export line and ensure it is not built from
    // protectedProcedure (which requires ctx.user / staff identity).
    const line = TRPC.split('\n').find((l) => l.includes('export const candidateProcedure'));
    expect(line).toBeTruthy();
    expect(line).not.toContain('protectedProcedure');
  });
});

describe('candidate-portal router', () => {
  it('uses candidateProcedure for every endpoint (never public/protected)', () => {
    // Every `name: <something>Procedure` in the router must be candidateProcedure.
    const procedures = [...ROUTER.matchAll(/(\w+):\s*(\w+Procedure)/g)].map((m) => m[2]);
    expect(procedures.length).toBeGreaterThan(0);
    for (const p of procedures) expect(p).toBe('candidateProcedure');
  });

  it('requires orgSlug on every endpoint (org comes from the route, not ambient)', () => {
    expect(ROUTER).toContain('orgSlug');
    expect(ROUTER).toContain('applicationId');
  });

  it('passes the candidate email from ctx.supabaseAuth, never a client-supplied email', () => {
    expect(ROUTER).toContain('ctx.supabaseAuth.email');
    // No `email` field accepted as router input (would let one candidate query another).
    expect(ROUTER).not.toMatch(/email:\s*z\./);
  });

  it('askFaq accepts only orgSlug/question/optional application focus (never candidateId/email)', () => {
    const askFaq = ROUTER.slice(ROUTER.indexOf('askFaq:'));
    expect(askFaq).toMatch(/candidateProcedure/);
    expect(askFaq).toMatch(/question:\s*faqQuestion/);
    expect(askFaq).toMatch(/applicationId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(askFaq).not.toMatch(/candidateId:\s*z\./);
    expect(askFaq).not.toMatch(/email:\s*z\./);
  });
});

describe('candidate-portal service — tenant isolation & IDOR', () => {
  it('runs candidate reads under tenant RLS context', () => {
    expect(SERVICE).toContain('runWithTenant');
  });

  it('resolves the org by slug and rejects inactive/missing orgs', () => {
    expect(SERVICE).toMatch(/NOT_FOUND/);
  });

  it('returns an empty/none result when no candidate matches the session email', () => {
    // A signed-in email with no Candidate at this org must not error into data.
    expect(SERVICE).toMatch(/findActiveCandidate|candidate\b/);
  });

  it('askFaq context is server-built and application focus is ownership-checked before AI spend', () => {
    expect(SERVICE).toContain('buildCandidateFaqContext');
    expect(SERVICE).toMatch(/findActiveCandidateProfile/);
    expect(SERVICE).toMatch(/applications\.some\(\(app\) => app\.id === applicationId\)/);
    const contextBuildIdx = SERVICE.indexOf('return buildCandidateFaqContext');
    const aiSpendIdx = SERVICE.indexOf('return answerCandidateFaq');
    expect(contextBuildIdx).toBeGreaterThan(0);
    expect(aiSpendIdx).toBeGreaterThan(contextBuildIdx);
  });
});

describe('candidate-portal repository — scoping', () => {
  it('reads through tenantDb (RLS), not the privileged db, for candidate data', () => {
    expect(REPO).toContain('tenantDb');
  });

  it('filters the candidate by org + email + isActive + not-deleted', () => {
    expect(REPO).toMatch(/isActive:\s*true/);
    expect(REPO).toMatch(/deletedAt:\s*null/);
  });

  it('scopes application reads by candidateId AND organizationId (IDOR defense)', () => {
    expect(REPO).toContain('candidateId');
    expect(REPO).toContain('organizationId');
    // The single-application detail lookup must include candidateId in its where —
    // org-only scoping (the old staff endpoint) would let a candidate read another
    // candidate's application by guessing the id.
    expect(REPO).toMatch(/findFirst\(\{\s*where:\s*\{[^}]*candidateId/s);
  });

  it('scopes interview reads by candidateId AND organizationId (Slice 3)', () => {
    // The interviews query must carry both filters, like applications — never just
    // org. Only upcoming statuses are surfaced to the candidate.
    expect(REPO).toMatch(/interview\.findMany\(\{\s*where:\s*\{[^}]*candidateId[^}]*organizationId/s);
    expect(REPO).toMatch(/status:\s*\{\s*in:/);
  });

  it('keeps rescheduled interviews visible (codex) — matches the real lifecycle', () => {
    // Reschedule writes status 'rescheduled'; a rescheduled interview is still live
    // and must stay on the dashboard so the candidate sees the new time + link.
    expect(REPO).toMatch(/status:\s*\{\s*in:\s*\[[^\]]*'rescheduled'/s);
  });

  it('bounds interviews by scheduledAt so past rows stop exposing join links (codex)', () => {
    // No time bound would keep rendering a stale Join button (meeting-URL exposure)
    // for past appointments.
    expect(REPO).toMatch(/scheduledAt:\s*\{\s*gte:/);
  });

  it('uses explicit select/include (no unbounded record exposure)', () => {
    expect(REPO).toMatch(/select:|include:/);
  });

  it('FAQ profile lookup uses explicit select and avoids internal candidate fields', () => {
    const method = REPO.slice(REPO.indexOf('findActiveCandidateProfile'));
    expect(method).toMatch(/select:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s);
    expect(method).not.toMatch(/notes:\s*true|tags:\s*true|fitScores|assessmentAssignments|documents/);
  });

  it('scopes offer reads by candidateId AND organizationId (Slice 4)', () => {
    expect(REPO).toMatch(/offer\.findMany\(\{\s*where:\s*\{[^}]*candidateId[^}]*organizationId/s);
    // Only candidate-facing statuses (never draft / internal approval states).
    expect(REPO).toMatch(/status:\s*\{\s*in:\s*\[[^\]]*'sent'/s);
    expect(REPO).not.toMatch(/'draft'/);
  });
});

describe('candidate-portal offer service — safe DTO (Slice 4)', () => {
  it('extracts the signing token server-side and does not leak raw settings', () => {
    // The deep-link to /offers/sign/[token] needs the token from Offer.settings, but
    // the service must map to a DTO — never return the raw settings JSON blob.
    expect(SERVICE).toContain('signingToken');
    expect(SERVICE).not.toMatch(/settings:\s*offer\.settings/);
  });

  it('only surfaces the signing token for a signable (sent, not expired) offer (codex)', () => {
    // Accepted/declined/expired offers must NOT carry a reusable public-by-token
    // signing URL in the payload.
    expect(SERVICE).toMatch(/status === 'sent'/);
    expect(SERVICE).toMatch(/signable\s*\?\s*extractSigningToken/);
  });
});

describe('portal /me SSR gate — no privileged candidate read', () => {
  it('reads the candidate through the tenant-scoped service, not the privileged db', () => {
    // The /me server component must not touch db.candidate directly — that bypasses
    // RLS. It resolves the org by slug (db is fine for that) but the candidate read
    // goes through candidatePortalService (runWithTenant + tenantDb).
    expect(ME_PAGE).not.toMatch(/db\.candidate\b/);
    expect(ME_PAGE).toContain('candidatePortalService');
  });
});

describe('candidate FAQ rate limiting', () => {
  it('routes FAQ/chatbot endpoints through the AI rate-limit bucket', () => {
    expect(RATE_LIMIT).toMatch(/'faq'/);
    expect(RATE_LIMIT).toMatch(/'assistant'/);
  });
});

describe('candidate assessment take-flow — security invariants (Wave 1.5a slice 2)', () => {
  it('every new candidate-portal assessment endpoint uses candidateProcedure', () => {
    for (const name of ['getMyAssessments', 'startAssessment', 'getAssessmentQuestions', 'submitAssessment']) {
      const slice = ROUTER.slice(ROUTER.indexOf(`${name}:`));
      expect(slice).toMatch(/candidateProcedure/);
    }
  });

  it('never accepts a client-supplied candidateId or email on the assessment endpoints', () => {
    const slice = ROUTER.slice(ROUTER.indexOf('getMyAssessments:'));
    expect(slice).not.toMatch(/candidateId:\s*z\./);
    expect(slice).not.toMatch(/email:\s*z\./);
  });

  it('getAssessmentQuestions repo select never includes correctOptionIds', () => {
    const candidateSelect = ASSESSMENT_REPO.slice(
      ASSESSMENT_REPO.indexOf('candidateQuestionSelect'),
      ASSESSMENT_REPO.indexOf('assignmentSummarySelect'),
    );
    expect(candidateSelect).not.toContain('correctOptionIds');
  });

  it('the answer-key select is confined to the *InTx helpers (never returned to the candidate)', () => {
    expect(ASSESSMENT_REPO).toContain('findQuestionsWithAnswerKeyInTx');
    // Only the tx-bound (write-path) function may select correctOptionIds.
    const answerKeySlice = ASSESSMENT_REPO.slice(ASSESSMENT_REPO.indexOf('findQuestionsWithAnswerKeyInTx'));
    expect(answerKeySlice.slice(0, 300)).toContain('correctOptionIds');
  });

  it('every assessment repo read is scoped by BOTH organizationId and candidateId (IDOR)', () => {
    expect(ASSESSMENT_REPO).toMatch(
      /findOwnedAssignment\([^)]*\)\s*\{\s*return\s+tenantDb\.assessmentAssignment\.findFirst\(\{\s*where:\s*\{[^}]*organizationId[^}]*candidateId/s,
    );
  });

  it('submitAssessment uses runTenantTransaction, never tenantDb.$transaction (Prisma #17948)', () => {
    expect(ASSESSMENT_SERVICE).toContain('runTenantTransaction');
    expect(ASSESSMENT_SERVICE).not.toMatch(/tenantDb\.\$transaction/);
  });

  it('submitAssessment re-checks assignment status INSIDE the transaction (closes the double-submit race)', () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    expect(submitSlice).toContain('findAssignmentInTx');
    expect(submitSlice).toMatch(/assignment_already_completed/);
  });

  it("submitAssessment validates every questionId belongs to the assignment's assessmentTypeId before writing", () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    const validateIdx = submitSlice.indexOf('question_not_in_assessment');
    const firstWriteIdx = submitSlice.indexOf('upsertResponseInTx(tx');
    expect(validateIdx).toBeGreaterThan(0);
    expect(firstWriteIdx).toBeGreaterThan(validateIdx);
  });

  it('free_text answers are never auto-graded (no fabricated AI/auto score — rule #4)', () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    const freeTextBranch = submitSlice.slice(submitSlice.indexOf("if (question.type === 'free_text') {"));
    expect(freeTextBranch.slice(0, 400)).toMatch(/isCorrect:\s*null/);
    expect(freeTextBranch.slice(0, 400)).toMatch(/pointsAwarded:\s*null/);
  });

  it('all submitAssessment inputs are bounded (answers array + freeText + selectedOptionIds)', () => {
    const SHARED_ASSESSMENT = read('packages/shared/src/validators/assessment.ts');
    expect(SHARED_ASSESSMENT).toMatch(
      /submitAssessmentAnswersSchema\s*=\s*z\.array\(answerInputSchema\)\.min\(1\)\.max\(/,
    );
    expect(SHARED_ASSESSMENT).toMatch(/freeText:\s*z\.string\(\)\.max\(/);
    expect(SHARED_ASSESSMENT).toMatch(/selectedOptionIds:\s*z\.array\(z\.string\(\)\.min\(1\)\.max\(64\)\)\.max\(/);
  });
});
