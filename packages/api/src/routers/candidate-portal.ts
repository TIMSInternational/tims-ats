import { z } from 'zod';
import { router, candidateProcedure } from '../trpc';
import { candidatePortalService } from '../services/candidate-portal.service';
import { candidateAssessmentService } from '../services/candidate-assessment.service';
import { candidateAssessmentLifecycleService } from '../services/candidate-assessment-lifecycle.service';
import { submitAssessmentAnswersSchema } from '@tims/shared';

// Authenticated candidate portal (Wave 1 Slice 2). The candidate is identified by
// their Supabase session email (ctx.supabaseAuth.email) — the org comes from the
// route slug as input. NO endpoint accepts an email/candidateId from the client;
// that would let one candidate read another's data.
const orgSlug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Slug invalido');
const faqQuestion = z.string().trim().min(3).max(800);

export const candidatePortalRouter = router({
  // The signed-in candidate's applications at this org (newest first).
  myApplications: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) => candidatePortalService.getMyApplications(ctx.supabaseAuth.email, input.orgSlug)),

  // The signed-in candidate's offers at this org. Each carries a signingToken (or
  // null) for the /offers/sign/[token] deep-link — acceptance reuses that existing
  // public flow rather than an in-portal accept.
  myOffers: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) => candidatePortalService.getMyOffers(ctx.supabaseAuth.email, input.orgSlug)),

  // The signed-in candidate's upcoming interviews at this org (soonest first).
  myInterviews: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) => candidatePortalService.getMyInterviews(ctx.supabaseAuth.email, input.orgSlug)),

  // The stage timeline for one of the candidate's own applications.
  applicationStatus: candidateProcedure
    .input(z.object({ orgSlug, applicationId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidatePortalService.getApplicationStatus(ctx.supabaseAuth.email, input.orgSlug, input.applicationId),
    ),

  // Candidate FAQ assistant. The question is free text, but identity is still
  // derived ONLY from ctx.supabaseAuth.email; applicationId is an optional focus
  // and is ownership-checked server-side before AI spend.
  askFaq: candidateProcedure
    .input(z.object({ orgSlug, question: faqQuestion, applicationId: z.string().uuid().optional() }))
    .mutation(({ ctx, input }) =>
      candidatePortalService.askFaq(ctx.supabaseAuth.email, input.orgSlug, input.question, input.applicationId),
    ),

  // The signed-in candidate's assessment assignments at this org.
  getMyAssessments: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) => candidateAssessmentLifecycleService.getMyAssessments(ctx.supabaseAuth.email, input.orgSlug)),

  // Accept the Habeas-Data consent and move an assignment into in_progress.
  // Idempotent if already in_progress.
  startAssessment: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid(), consentAccepted: z.boolean() }))
    .mutation(({ ctx, input }) =>
      candidateAssessmentLifecycleService.startAssessment(
        ctx.supabaseAuth.email,
        input.orgSlug,
        input.assignmentId,
        input.consentAccepted,
        ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        ctx.headers.get('user-agent'),
      ),
    ),

  // Questions for an in_progress assignment. NEVER includes correctOptionIds.
  getAssessmentQuestions: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidateAssessmentLifecycleService.getAssessmentQuestions(ctx.supabaseAuth.email, input.orgSlug, input.assignmentId),
    ),

  // Atomic: grades every answer, upserts the result, marks the assignment
  // completed — all inside one transaction (candidate-assessment.service.ts).
  submitAssessment: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid(), answers: submitAssessmentAnswersSchema }))
    .mutation(({ ctx, input }) =>
      candidateAssessmentService.submitAssessment(
        ctx.supabaseAuth.email,
        input.orgSlug,
        input.assignmentId,
        input.answers,
      ),
    ),
});
