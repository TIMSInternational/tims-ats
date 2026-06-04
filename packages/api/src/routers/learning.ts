import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

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

      return { courses, total, page, pageSize };
    }),

  getCourseById: permissionProcedure('learning', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.course.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          enrollments: {
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
      const data = input.userIds.map((userId) => ({
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

  // Stub: AI-driven gap-based path recommendations
  getGapBasedPaths: permissionProcedure('learning', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // TODO: integrate with AI service for competency-gap analysis
      return {
        userId: input.userId,
        organizationId: ctx.user.organizationId,
        paths: [
          {
            suggestedPathName: 'Liderazgo Avanzado',
            targetGap: 'leadership',
            confidence: 0.82,
            courses: [],
          },
          {
            suggestedPathName: 'Comunicacion Efectiva',
            targetGap: 'communication',
            confidence: 0.74,
            courses: [],
          },
        ],
        generatedAt: new Date(),
        _stub: true,
      };
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
      return db.enrollment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input.courseId && { courseId: input.courseId }),
          ...(input.userId && { userId: input.userId }),
          OR: [
            { preTestScore: { not: null } },
            { postTestScore: { not: null } },
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

      const enrollments = await db.enrollment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          userId: { in: memberIds },
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

  // Stub: AI-driven course recommendations
  getRecommendations: permissionProcedure('learning', 'read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // TODO: integrate with AI recommendation engine
      return {
        userId: input.userId,
        organizationId: ctx.user.organizationId,
        recommendations: [
          {
            courseId: null,
            title: 'Gestion de Equipos Remotos',
            reason: 'Basado en tu rol de lider de equipo',
            score: 0.91,
          },
          {
            courseId: null,
            title: 'Analisis de Datos para Lideres',
            reason: 'Competencia identificada como brecha',
            score: 0.85,
          },
        ],
        generatedAt: new Date(),
        _stub: true,
      };
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
      const orgId = ctx.user.organizationId;

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

      return {
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
    }),
});
