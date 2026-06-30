import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';
import { scopeWhereFor, assertScoped, assertSubjectInScope, requireOrgScope } from '../access';
import { mergeAvgProgress } from './learning-progress';
import { cacheGet, cacheSet } from '../lib/cache';

// Courses + learning paths are an ORG-LEVEL catalog — deliberately unscoped
// (people scoping applies to enrollments/certificates, the user-anchored rows).

export const learningRouter = router({
  // ── Courses ──────────────────────────────────────────────────────────

  listCourses: permissionProcedure('learning', 'read')
    .input(
      z.object({
        category: z.string().max(100).optional(),
        isRequired: z.boolean().optional(),
        search: z.string().max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { category, isRequired, search, page = 1, pageSize = 20 } = input ?? {};
      const where = {
        organizationId: ctx.user.organizationId,
        isActive: true,
        ...(category && { category }),
        ...(isRequired !== undefined && { isRequired }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }),
      };

      const [courses, total] = await Promise.all([
        db.course.findMany({
          where,
          include: {
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { enrollments: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.course.count({ where }),
      ]);

      const progressRows = await db.enrollment.groupBy({
        by: ['courseId'],
        where: { organizationId: ctx.user.organizationId, courseId: { in: courses.map((c) => c.id) } },
        _avg: { progress: true },
      });
      const withProgress = mergeAvgProgress(courses, progressRows);
      return { courses: withProgress, total, page, pageSize };
    }),

  getCourseById: permissionProcedure('learning', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // The course itself is org-catalog, but the embedded enrollments are
      // people rows — scope them (codex: catalog exception must not leak
      // out-of-scope users' progress/identity). {} at org scope.
      const enrollScope = await scopeWhereFor('enrollment', ctx.access, ctx.user.id);
      return db.course.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          enrollments: {
            where: enrollScope as Prisma.EnrollmentWhereInput,
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
            orderBy: { enrolledAt: 'desc' },
          },
          pathCourses: {
            include: { path: true },
          },
        },
      });
    }),

  createCourse: permissionProcedure('learning', 'create')
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        type: z.string().max(100),
        category: z.string().max(100).optional(),
        duration: z.number().int().min(1),
        content: z.record(z.unknown()).optional(),
        isRequired: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { content, ...rest } = input;
      return db.course.create({
        data: {
          ...rest,
          ...(content !== undefined && { content: content as unknown as Prisma.InputJsonObject }),
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
        },
      });
    }),

  updateCourse: permissionProcedure('learning', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).optional(),
        type: z.string().max(100).optional(),
        category: z.string().max(100).optional(),
        duration: z.number().int().min(1).optional(),
        content: z.record(z.unknown()).optional(),
        isRequired: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, content, ...data } = input;
      return db.course.update({
        where: { id, organizationId: ctx.user.organizationId },
        data: {
          ...data,
          ...(content !== undefined && { content: content as unknown as Prisma.InputJsonObject }),
        },
      });
    }),

  // ── Enrollments ──────────────────────────────────────────────────────

  enrollUser: permissionProcedure('learning', 'create')
    .input(
      z.object({
        userId: z.string().uuid(),
        courseId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSubjectInScope(ctx.access, ctx.user.id, input.userId, 'No puedes inscribir a este usuario');

      return db.enrollment.create({
        data: {
          organizationId: ctx.user.organizationId,
          userId: input.userId,
          courseId: input.courseId,
          status: 'enrolled',
        },
      });
    }),

  bulkEnroll: permissionProcedure('learning', 'create')
    .input(
      z.object({
        userIds: z.array(z.string().uuid()).min(1),
        courseId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Dedupe target ids first to avoid redundant checks.
      const uniqueTargets = [...new Set(input.userIds)];

      // At narrow scope every target must be within the caller's subject set.
      // Compute the set once (mirrors assertSubjectInScope logic) and set-diff.
      const { scope, anchors } = ctx.access;
      if (scope !== 'organization' && scope !== 'company') {
        if (!anchors) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sin contexto de organizacion para alcance restringido' });
        }
        const subjects =
          scope === 'own'
            ? [ctx.user.id]
            : scope === 'team'
              ? await anchors.teamMemberIds()
              : await anchors.unitMemberIds();
        const subjectSet = new Set(subjects);
        const outOfScope = uniqueTargets.filter((id) => !subjectSet.has(id));
        if (outOfScope.length > 0) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Uno o mas usuarios estan fuera de tu alcance' });
        }
      }

      const data = uniqueTargets.map((userId) => ({
        organizationId: ctx.user.organizationId,
        userId,
        courseId: input.courseId,
        status: 'enrolled',
        progress: 0,
      }));

      return db.enrollment.createMany({
        data,
        skipDuplicates: true,
      });
    }),

  updateProgress: permissionProcedure('learning', 'update')
    .input(
      z.object({
        enrollmentId: z.string().uuid(),
        progress: z.number().min(0).max(100),
        preTestScore: z.number().min(0).max(100).optional(),
        postTestScore: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Keyed by enrollmentId — probe the enrollment row so narrow-scoped users
      // cannot update enrollments of out-of-scope users.
      await assertScoped('enrollment', input.enrollmentId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const { enrollmentId, progress, ...scores } = input;
      const status = progress >= 100 ? 'completed' : 'in_progress';
      const completedAt = progress >= 100 ? new Date() : undefined;

      return db.enrollment.update({
        where: { id: enrollmentId, organizationId: ctx.user.organizationId },
        data: {
          progress,
          status,
          completedAt,
          ...scores,
        },
      });
    }),

  // ── Learning Paths ───────────────────────────────────────────────────

  listPaths: permissionProcedure('learning', 'read')
    .query(async ({ ctx }) => {
      return db.learningPath.findMany({
        where: { organizationId: ctx.user.organizationId },
        include: {
          courses: {
            include: { course: true },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  createPath: permissionProcedure('learning', 'create')
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        targetGap: z.string().max(200).optional(),
        courseIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { courseIds, ...pathData } = input;
      return db.learningPath.create({
        data: {
          ...pathData,
          organizationId: ctx.user.organizationId,
          ...(courseIds && {
            courses: {
              create: courseIds.map((courseId, index) => ({
                courseId,
                order: index + 1,
              })),
            },
          }),
        },
        include: {
          courses: { include: { course: true }, orderBy: { order: 'asc' } },
        },
      });
    }),

  // AI-driven gap-based learning paths.
  // NOT IMPLEMENTED: needs the learning-recommender agent + a Competency model
  // (both Wave 3/4). Returns 501 rather than fabricated paths with fake
  // confidence scores (rule #4).
  getGapBasedPaths: permissionProcedure('learning', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(() => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Las rutas basadas en brechas con IA aun no estan disponibles (agente pendiente).',
      });
    }),

  // ── Assessment & Progress ────────────────────────────────────────────

  getPrePostTestResults: permissionProcedure('learning', 'read')
    .input(
      z.object({
        courseId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Scope-compose via enrollment fragment: only show test results for
      // enrollments within the caller's people scope.
      const scopeWhere = (await scopeWhereFor('enrollment', ctx.access, ctx.user.id)) as Prisma.EnrollmentWhereInput;

      return db.enrollment.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId },
            scopeWhere,
            {
              ...(input.courseId && { courseId: input.courseId }),
              ...(input.userId && { userId: input.userId }),
              OR: [
                { preTestScore: { not: null } },
                { postTestScore: { not: null } },
              ],
            },
          ],
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          course: { select: { id: true, title: true } },
        },
        orderBy: { enrolledAt: 'desc' },
      });
    }),

  getTeamProgress: permissionProcedure('learning', 'read')
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const members = await db.userTeam.findMany({
        where: { teamId: input.teamId },
        select: { userId: true },
      });
      const memberIds = members.map((m) => m.userId);

      // AND-compose the enrollment scope fragment so that narrow-scoped callers
      // can only view progress for users within their subject set.
      const scopeWhere = (await scopeWhereFor('enrollment', ctx.access, ctx.user.id)) as Prisma.EnrollmentWhereInput;

      const enrollments = await db.enrollment.findMany({
        where: {
          AND: [
            { organizationId: ctx.user.organizationId },
            scopeWhere,
            { userId: { in: memberIds } },
          ],
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          course: { select: { id: true, title: true, isRequired: true } },
        },
      });

      const totalEnrollments = enrollments.length;
      const completed = enrollments.filter((e) => e.status === 'completed').length;
      const avgProgress =
        totalEnrollments > 0
          ? enrollments.reduce((sum, e) => sum + e.progress, 0) / totalEnrollments
          : 0;

      return {
        teamId: input.teamId,
        memberCount: memberIds.length,
        totalEnrollments,
        completed,
        avgProgress: Math.round(avgProgress * 100) / 100,
        enrollments,
      };
    }),

  // AI-driven course recommendations.
  // NOT IMPLEMENTED: needs the learning-recommender agent (Wave 3). Returns 501
  // rather than fabricated courses with fake relevance scores (rule #4).
  getRecommendations: permissionProcedure('learning', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(() => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Las recomendaciones de cursos con IA aun no estan disponibles (agente pendiente).',
      });
    }),

  // ── Certificates ─────────────────────────────────────────────────────

  issueCertificate: permissionProcedure('learning', 'create')
    .input(
      z.object({
        enrollmentId: z.string().uuid(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Probe the enrollment first: enforces that the issuer can only issue
      // certificates for enrollments within their people scope.
      await assertScoped('enrollment', input.enrollmentId, ctx.access, ctx.user.id, ctx.user.organizationId);

      const enrollment = await db.enrollment.findFirstOrThrow({
        where: {
          id: input.enrollmentId,
          organizationId: ctx.user.organizationId,
          status: 'completed',
        },
      });

      return db.certificate.create({
        data: {
          organizationId: ctx.user.organizationId,
          enrollmentId: enrollment.id,
          userId: enrollment.userId,
          courseId: enrollment.courseId,
          ...(input.expiresAt && { expiresAt: new Date(input.expiresAt) }),
        },
      });
    }),

  // ── Dashboard KPIs ───────────────────────────────────────────────────

  getDashboardKpis: permissionProcedure('learning', 'read')
    .query(async ({ ctx }) => {
      // Org-rollup aggregate: only available at org/company scope until slice-6
      // introduces scope-aware aggregation (recorded in REMAINING-WORK).
      requireOrgScope(ctx.access);

      const orgId = ctx.user.organizationId;

      type KpiResult = {
        totalCourses: number;
        activeCourses: number;
        totalEnrollments: number;
        completedEnrollments: number;
        completionRate: number;
        avgProgress: number;
        totalCertificates: number;
        totalPaths: number;
      };

      // Safe to key on orgId alone ONLY while requireOrgScope() gates this to org/company callers (no sub-org scope reaches here). If scope-aware aggregation is added later, the key MUST include scope identity (see vacancy/stats.ts).
      const cacheKey = `tims:kpis:learning:${orgId}`;
      const cached = await cacheGet<KpiResult>(cacheKey);
      if (cached) return cached;

      const [
        totalCourses,
        activeCourses,
        totalEnrollments,
        completedEnrollments,
        totalCertificates,
        totalPaths,
      ] = await Promise.all([
        db.course.count({ where: { organizationId: orgId } }),
        db.course.count({ where: { organizationId: orgId, isActive: true } }),
        db.enrollment.count({ where: { organizationId: orgId } }),
        db.enrollment.count({ where: { organizationId: orgId, status: 'completed' } }),
        db.certificate.count({ where: { organizationId: orgId } }),
        db.learningPath.count({ where: { organizationId: orgId } }),
      ]);

      const avgProgress = await db.enrollment.aggregate({
        where: { organizationId: orgId },
        _avg: { progress: true },
      });

      const result: KpiResult = {
        totalCourses,
        activeCourses,
        totalEnrollments,
        completedEnrollments,
        completionRate:
          totalEnrollments > 0
            ? Math.round((completedEnrollments / totalEnrollments) * 100)
            : 0,
        avgProgress: Math.round((avgProgress._avg.progress ?? 0) * 100) / 100,
        totalCertificates,
        totalPaths,
      };
      await cacheSet(cacheKey, result, 45);
      return result;
    }),
});
