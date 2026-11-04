import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { getAppUrl } from '@tims/shared';
import { interviewEmailService } from '../../services/interview-email.service';
import { runAfterResponse } from '../../lib/after-response';
import { clearedJoinTokenColumns, issueJoinToken } from '../../services/interview-join-token';
import { scopeWhereFor, assertScoped } from '../../access';
import { candidateConsentRepository } from '../../repositories/candidate-consent.repository';
import { isBlindedViewer, visibleScorecard } from '../../services/scorecard-visibility.service';
import { assertInterviewManageable } from '../../services/interview-management.service';
import { interviewScorecardRepository } from '../../repositories/interview-scorecard.repository';
import { interviewSchedulingRepository } from '../../repositories/interview-scheduling.repository';
import { interviewStatusFilterWhere, OPEN_INTERVIEW_STATUSES } from '../../repositories/interview-status-filter';
import { interviewManageRepository } from '../../repositories/interview-manage.repository';

export const interviewCrudRouter = router({
  // 8.1 — List interviews with filters
  list: permissionProcedure('interview', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().max(50).optional(),
        type: z.string().max(50).optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        // 'desc' lists the most recent first (past interviews); 'asc' the soonest first (upcoming).
        sort: z.enum(['asc', 'desc']).default('asc'),
        // Only interviews still to happen (not cancelled / no_show / completed) — filtered BEFORE paging.
        openOnly: z.boolean().optional(),
        // Also return the KPI counts (scheduled / completed / cancelled) across ALL dates, ignoring
        // from / to / status / openOnly: the page's cards are not "on this page" numbers (A-02 / B-30).
        statusCounts: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, sort, openOnly, statusCounts, ...filters } = input;
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);
      const now = new Date();

      // Tenant, scope and the vacancy / candidate / type filters — shared by the rows and the KPI counts.
      const base: Prisma.InterviewWhereInput[] = [
        { organizationId: ctx.user.organizationId },
        scopeWhere as Prisma.InterviewWhereInput,
        {
          ...(filters.vacancyId && { vacancyId: filters.vacancyId }),
          ...(filters.candidateId && { candidateId: filters.candidateId }),
          ...(filters.type && { type: filters.type }),
        },
      ];
      const where: Prisma.InterviewWhereInput = {
        AND: [
          ...base,
          filters.from || filters.to
            ? { scheduledAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } }
            : {},
          // The status filter in the terms the rows are badged (repositories/interview-status-filter.ts).
          interviewStatusFilterWhere(filters.status, now),
          openOnly ? { status: { in: [...OPEN_INTERVIEW_STATUSES] } } : {},
        ],
      };

      const [items, total, schedulingTimeZone, kpis] = await Promise.all([
        db.interview.findMany({
          where,
          omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            evaluators: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
              },
            },
            // How many evaluators submitted (a count only — no scorecard content): an interview scored
            // while it could not be completed yet is shown as completed, not "pendiente" (B-30).
            _count: { select: { scorecards: { where: { submittedAt: { not: null } } } } },
          },
          orderBy: [{ scheduledAt: sort }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.interview.count({ where }),
        // The zone the schedule modal books in and labels: org, then (filtered to one vacancy) its company,
        // then UTC said explicitly — the chain the invitation emails print (A-17).
        interviewSchedulingRepository.findSchedulingTimeZone(ctx.user.organizationId, filters.vacancyId),
        statusCounts ? interviewManageRepository.countKpis(base, now) : null,
      ]);

      return { items, total, page, pageSize, schedulingTimeZone, statusCounts: kpis };
    }),

  // 8.2 — Get interview by ID
  getById: permissionProcedure('interview', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Probe first — the subsequent findFirst uses `include` (no `select`),
      // and Prisma does not support mixing AND scope fragments with `include` in
      // a way that is type-safe; the two-query pattern (probe + fetch) keeps the
      // full include block intact while still enforcing scope.
      await assertScoped('interview', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const interview = await db.interview.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
        include: {
          candidate: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true },
          },
          vacancy: { select: { id: true, title: true } },
          application: { select: { id: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          evaluators: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
          scorecards: {
            include: {
              evaluator: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          summary: true,
        },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      // Blind evaluation (services/scorecard-visibility.service.ts): a panel
      // evaluator who has not submitted gets only their own scorecard in full;
      // others arrive as status stubs, and the AI summary (derived from them) is
      // withheld. Non-panel staff with interview:read see everything, as before.
      const blinded = isBlindedViewer(
        ctx.user.id,
        interview.evaluators.map((e) => e.userId),
        interview.scorecards,
      );
      // The competencies the room's scorecard rates — the same set submitScorecard requires — through
      // this interview:read call, so a panelist without vacancy:read no longer gets an error (F-10).
      const scorecardCompetencies = await interviewScorecardRepository.getCompetencies(
        ctx.user.organizationId,
        interview.vacancyId,
      );
      return {
        ...interview,
        scorecards: interview.scorecards.map((sc) => visibleScorecard(sc, ctx.user.id, blinded)),
        summary: blinded ? null : interview.summary,
        scorecardCompetencies,
      };
    }),

  // 8.3 — Schedule a new interview
  schedule: permissionProcedure('interview', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        applicationId: z.string().uuid().optional(),
        type: z.string().max(50),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480),
        location: z.string().max(500).optional(),
        meetingUrl: z.string().url().max(2048).optional(),
        notes: z.string().max(5000).optional(),
        evaluatorIds: z.array(z.string().uuid()).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { evaluatorIds, ...data } = input;
      const orgId = ctx.user.organizationId;

      // Probe parent vacancy and candidate through scope — ensures the scheduling
      // user can reach those resources under their current scope, not just org-wide.
      // Evaluator count check uses plain org check (users are not scope-filtered).
      const uniqueEvaluators = [...new Set(evaluatorIds)];
      await assertScoped('vacancy', input.vacancyId, ctx.access, ctx.user.id, orgId);
      // Codex re-review: the candidate must ALSO be scope-probed — an org-only
      // check let a narrow-scoped scheduler pull any org candidate's PII into
      // the interview + invitation email. A candidate applying to the probed
      // vacancy has an in-scope application, so legit flows pass.
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, orgId);
      const evaluatorCount = await db.user.count({
        where: { id: { in: uniqueEvaluators }, organizationId: orgId },
      });
      if (evaluatorCount !== uniqueEvaluators.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluador no encontrado en esta organizacion' });
      }
      if (input.applicationId) {
        await assertScoped('application', input.applicationId, ctx.access, ctx.user.id, orgId);
        // Integrity: the application must bind the SAME candidate and vacancy.
        const bound = await db.application.findFirst({
          where: {
            id: input.applicationId,
            organizationId: orgId,
            candidateId: input.candidateId,
            vacancyId: input.vacancyId,
          },
          select: { id: true },
        });
        if (!bound) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'La aplicacion no corresponde al candidato y la vacante indicados',
          });
        }
      } else {
        // Codex round-3: an omitted applicationId must not bypass the
        // candidate↔vacancy binding. Auto-resolve and persist the application
        // when one exists (data-quality improvement, behavior-neutral). When
        // NONE exists: org-scope callers keep today's interview-first workflow
        // (the schedule modal pairs any searched candidate with any vacancy);
        // narrow scopes are rejected fail-closed — their only justification
        // for reaching the candidate is an application path.
        const boundApp = await db.application.findFirst({
          where: { organizationId: orgId, candidateId: input.candidateId, vacancyId: input.vacancyId },
          select: { id: true },
        });
        if (boundApp) {
          data.applicationId = boundApp.id;
        } else if (ctx.access.scope !== 'organization' && ctx.access.scope !== 'company') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'El candidato no tiene aplicacion a esta vacante' });
        }
      }

      // The invitation email (join link + staff room link) is built from the app origin. Validate it
      // BEFORE the write so a misconfigured NEXT_PUBLIC_APP_URL fails the request instead of saving an
      // interview whose fire-and-forget email then silently never goes out.
      getAppUrl();

      // Video: mint the candidate join token; only its SHA-256 is persisted (same write).
      // An external meetingUrl (Zoom/Meet/…) is kept as the link and gets no token; see candidateJoinApplies.
      const joinToken = issueJoinToken(data.type, data.scheduledAt, data.duration, { meetingUrl: data.meetingUrl });
      const interview = await db.interview.create({
        data: {
          ...data,
          ...joinToken.columns,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'scheduled',
          evaluators: {
            create: evaluatorIds.map((userId) => ({
              userId,
              role: 'evaluator',
              status: 'pending',
            })),
          },
        },
        omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
          evaluators: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });

      // After the response (never awaited, never frozen: see lib/after-response.ts): candidate (join
      // link) + each evaluator (staff room link), with .ics.
      const inviteParams = { orgId, interviewId: interview.id, kind: 'invite' as const, candidateJoinToken: joinToken.token };
      runAfterResponse(ctx, () => interviewEmailService.notify(inviteParams));

      // #312: the mailer skips a candidate who revoked the authorization; tell staff so they know the
      // candidate was NOT notified (evaluators still are).
      const candidateNotNotifiedReason = (await candidateConsentRepository.isRecruitmentConsentWithdrawn(
        orgId,
        interview.candidateId,
      ))
        ? ('consent_withdrawn' as const)
        : null;

      return { ...interview, candidateNotNotifiedReason };
    }),

  // 8.4 — Reschedule an interview
  reschedule: permissionProcedure('interview', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.date(),
        duration: z.number().int().min(15).max(480).optional(),
        location: z.string().max(500).optional(),
        meetingUrl: z.string().url().max(2048).optional(),
        notes: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      // Seeing the interview (panel arm) is not enough to run it: see interview-management.service.ts.
      await assertInterviewManageable(ctx.access, ctx.user.id, ctx.user.organizationId, id);
      const scopeWhere = await scopeWhereFor('interview', ctx.access, ctx.user.id);

      // Compose scope into the business findFirst — it also fetches status/type
      // fields used by the reschedule-guard and email below, so we cannot replace
      // it with a bare assertScoped (would lose those fields).
      const existing = await db.interview.findFirst({
        where: {
          AND: [{ id, organizationId: ctx.user.organizationId }, scopeWhere as Prisma.InterviewWhereInput],
        },
        // Only what the guard, the new join link and the update email need — never the join-token hash.
        select: { id: true, status: true, type: true, duration: true, meetingUrl: true, scheduledAt: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      if (existing.status === 'cancelled' || existing.status === 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No se puede reprogramar una entrevista cancelada o completada',
        });
      }

      // Validate the link origin BEFORE the write: the update below revokes the old join link, so a
      // misconfiguration discovered only in the fire-and-forget email would strand the candidate.
      getAppUrl();

      // New link on every reschedule: overwriting the hash revokes the old one.
      const joinToken = issueJoinToken(existing.type, data.scheduledAt, data.duration ?? existing.duration, {
        meetingUrl: data.meetingUrl ?? existing.meetingUrl,
        interviewId: existing.id,
      });
      const updated = await db.interview.update({
        where: { id },
        data: {
          ...data,
          ...joinToken.columns,
          status: 'rescheduled',
        },
        omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
        },
      });

      // After the response (see lib/after-response.ts): updated invitation (.ics REQUEST, higher
      // SEQUENCE, same UID).
      const updateParams = {
        orgId: ctx.user.organizationId,
        interviewId: id,
        kind: 'update' as const,
        candidateJoinToken: joinToken.token,
        oldScheduledAt: existing.scheduledAt,
      };
      runAfterResponse(ctx, () => interviewEmailService.notify(updateParams));

      return updated;
    }),

  // 8.5 — Cancel an interview
  // ── Evaluator (committee panel) management on an EXISTING interview ───
  // Populates InterviewEvaluator, the anchor panelInterviewIds() reads.
  addEvaluator: permissionProcedure('interview', 'update')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.string().max(50).default('evaluator'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // SCOPED probe — replaces the prior org-only parent existence check. The
      // InterviewEvaluator row is a committee-arm anchor (grants future read
      // access), so a narrow (team-scoped) caller must NOT be able to grab an
      // out-of-scope interview by id and self-add as evaluator. The interview
      // scope alone is not enough either: a panelist sees the interview through
      // the panel arm, but only whoever manages the VACANCY may change the panel
      // (interview-management.service.ts).
      await assertInterviewManageable(ctx.access, ctx.user.id, ctx.user.organizationId, input.interviewId);
      let added: { id: string };
      try {
        // runTenantTransaction, not db.$transaction (#45 / prisma#17948) — the
        // org-membership check and the evaluator insert must share one tx, or the
        // check is a TOCTOU read on a different connection.
        added = await runTenantTransaction(ctx.user.organizationId, async (tx) => {
          const user = await tx.user.findFirst({
            where: { id: input.userId, organizationId: ctx.user.organizationId },
            select: { id: true },
          });
          if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
          return tx.interviewEvaluator.create({
            data: { interviewId: input.interviewId, userId: input.userId, role: input.role },
            select: { id: true },
          });
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'El evaluador ya esta asignado a esta entrevista' });
        }
        throw err;
      }
      // A panelist added later gets the same invitation (and scorecard link) as the original panel —
      // and only they do: the candidate and the other evaluators are not mailed again.
      const addedParams = {
        orgId: ctx.user.organizationId,
        interviewId: input.interviewId,
        kind: 'invite' as const,
        onlyEvaluatorId: input.userId,
      };
      runAfterResponse(ctx, () => interviewEmailService.notify(addedParams));
      return added;
    }),

  removeEvaluator: permissionProcedure('interview', 'update')
    .input(z.object({ interviewId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // SCOPED probe — same escalation guard as addEvaluator: a narrow caller
      // must not manage the panel of an out-of-scope interview by id, and a
      // panelist must not take other panelists off it.
      await assertInterviewManageable(ctx.access, ctx.user.id, ctx.user.organizationId, input.interviewId);
      // Blind evaluation (PR #303): leaving the panel un-blinds a viewer, so a panel
      // member holding interview:update must not remove THEMSELVES to read the other
      // evaluators' cards before submitting. Someone else has to take them off.
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No puedes quitarte a ti mismo del panel de evaluadores' });
      }
      const result = await db.interviewEvaluator.deleteMany({
        where: { interviewId: input.interviewId, userId: input.userId, interview: { organizationId: ctx.user.organizationId } },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluador no encontrado' });
      return { success: true };
    }),

  cancel: permissionProcedure('interview', 'update')
    .input(
      z.union([
        z.object({
          id: z.string().uuid(),
          cancelReason: z.string().min(1).max(1000),
          outcome: z.literal('cancelled').optional(),
        }),
        // A-02 "No se presentó": closes an interview that started and nobody scored. It rides on cancel
        // because the tRPC surface is ratcheted (tests/governance/trpc-procedure-ratchet.test.ts).
        z.object({ id: z.string().uuid(), outcome: z.literal('no_show') }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      // The scoped probe replaces the bare org-check findFirst — cancel only uses
      // it as an existence check. Managing needs the vacancy scope too, so a
      // panelist cannot cancel the interview they sit on.
      await assertInterviewManageable(ctx.access, ctx.user.id, ctx.user.organizationId, input.id);

      if (input.outcome === 'no_show') {
        // No email: nothing changes for the candidate or the panel beyond the interview closing.
        const marked = await interviewManageRepository.markNoShow(
          ctx.user.organizationId,
          input.id,
          new Date(),
          clearedJoinTokenColumns(),
        );
        if (!marked) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Only an open interview that has started and has no submitted scorecard can be a no-show',
          });
        }
        return { id: input.id, status: 'no_show' as const };
      }

      const cancelled = await db.interview.update({
        where: { id: input.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: input.cancelReason,
          // Revoke the candidate join link.
          ...clearedJoinTokenColumns(),
        },
        omit: { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          vacancy: { select: { title: true } },
        },
      });

      // After the response (see lib/after-response.ts): cancellation (.ics METHOD:CANCEL) to candidate
      // + evaluators.
      const cancelParams = { orgId: ctx.user.organizationId, interviewId: input.id, kind: 'cancel' as const };
      runAfterResponse(ctx, () => interviewEmailService.notify(cancelParams));

      return cancelled;
    }),
});
