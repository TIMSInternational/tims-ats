import { z } from 'zod';
import { router, protectedProcedure, permissionProcedure } from '../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const offerRouter = router({
  // 9.1 — List offers with filters
  list: permissionProcedure('offer', 'read')
    .input(
      z.object({
        vacancyId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, ...filters } = input;

      const where: any = {
        organizationId: ctx.user.organizationId,
        ...(filters.vacancyId && { vacancyId: filters.vacancyId }),
        ...(filters.candidateId && { candidateId: filters.candidateId }),
        ...(filters.status && { status: filters.status }),
      };

      const [items, total] = await Promise.all([
        db.offer.findMany({
          where,
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            creator: { select: { id: true, firstName: true, lastName: true } },
            approvals: {
              orderBy: { step: 'asc' },
              include: {
                approver: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.offer.count({ where }),
      ]);

      return { items, total, page, pageSize };
    }),

  // 9.2 — Get offer by ID
  getById: permissionProcedure('offer', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          candidate: {
            select: {
              id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true,
            },
          },
          vacancy: { select: { id: true, title: true } },
          application: { select: { id: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          approvals: {
            orderBy: { step: 'asc' },
            include: {
              approver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            },
          },
          validations: {
            include: {
              completedByUser: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          legalChecks: {
            include: {
              completedByUser: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      return offer;
    }),

  // 9.3 — Create a new offer
  create: permissionProcedure('offer', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid(),
        applicationId: z.string().uuid().optional(),
        salary: z.number().positive(),
        currency: z.string().default('USD'),
        startDate: z.date(),
        contractType: z.string(),
        benefits: z.any().optional(),
        terms: z.any().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.offer.create({
        data: {
          ...input,
          organizationId: ctx.user.organizationId,
          createdById: ctx.user.id,
          status: 'draft',
        },
        include: {
          candidate: {
            select: { id: true, firstName: true, lastName: true },
          },
          vacancy: { select: { id: true, title: true } },
        },
      });
    }),

  // 9.4 — Update an offer (only while in draft)
  update: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        salary: z.number().positive().optional(),
        currency: z.string().optional(),
        startDate: z.date().optional(),
        contractType: z.string().optional(),
        benefits: z.any().optional(),
        terms: z.any().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await db.offer.findFirst({
        where: { id, organizationId: ctx.user.organizationId },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (existing.status !== 'draft') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden editar ofertas en estado borrador',
        });
      }

      return db.offer.update({ where: { id }, data });
    }),

  // 9.5 — Submit offer for approval
  submitForApproval: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        approverIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'draft') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden enviar a aprobacion ofertas en estado borrador',
        });
      }

      return db.$transaction(async (tx) => {
        // Create approval chain
        await tx.offerApproval.createMany({
          data: input.approverIds.map((approverId, index) => ({
            organizationId: ctx.user.organizationId,
            offerId: input.id,
            approverId,
            step: index + 1,
            status: 'pending',
          })),
        });

        return tx.offer.update({
          where: { id: input.id },
          data: { status: 'pending_approval' },
          include: {
            approvals: {
              orderBy: { step: 'asc' },
              include: {
                approver: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        });
      });
    }),

  // 9.6 — Approve an offer
  approve: permissionProcedure('offer', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const approval = await db.offerApproval.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });

      if (!approval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No se encontro aprobacion pendiente para este usuario',
        });
      }

      return db.$transaction(async (tx) => {
        await tx.offerApproval.update({
          where: { id: approval.id },
          data: {
            status: 'approved',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });

        // Check if all approvals are done
        const pendingCount = await tx.offerApproval.count({
          where: {
            offerId: input.id,
            status: 'pending',
          },
        });

        if (pendingCount === 0) {
          return tx.offer.update({
            where: { id: input.id },
            data: { status: 'approved' },
          });
        }

        return tx.offer.findUnique({ where: { id: input.id } });
      });
    }),

  // 9.7 — Reject an offer
  reject: permissionProcedure('offer', 'approve')
    .input(
      z.object({
        id: z.string().uuid(),
        comment: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const approval = await db.offerApproval.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.id,
          approverId: ctx.user.id,
          status: 'pending',
        },
      });

      if (!approval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No se encontro aprobacion pendiente para este usuario',
        });
      }

      return db.$transaction(async (tx) => {
        await tx.offerApproval.update({
          where: { id: approval.id },
          data: {
            status: 'rejected',
            comment: input.comment,
            decidedAt: new Date(),
          },
        });

        return tx.offer.update({
          where: { id: input.id },
          data: { status: 'rejected' },
        });
      });
    }),

  // 9.8 — Send offer to candidate (stub)
  send: permissionProcedure('offer', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          candidate: { select: { email: true, firstName: true, lastName: true } },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'approved') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden enviar ofertas aprobadas',
        });
      }

      // Stub: mark as sent without actually sending an email
      return db.offer.update({
        where: { id: input.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
        },
      });
    }),

  // 9.9 — Get approval chain for an offer
  getApprovalChain: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.offerApproval.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, avatar: true, jobTitle: true } },
        },
        orderBy: { step: 'asc' },
      });
    }),

  // 9.10 — List pre-employment validations
  listValidations: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.preemploymentValidation.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.11 — Update a pre-employment validation
  updateValidation: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['pending', 'passed', 'failed', 'waived']),
        result: z.any().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = await db.preemploymentValidation.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!validation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion no encontrada' });
      }

      return db.preemploymentValidation.update({
        where: { id: input.id },
        data: {
          status: input.status,
          result: input.result ?? undefined,
          notes: input.notes,
          completedById: ctx.user.id,
          completedAt: input.status !== 'pending' ? new Date() : null,
        },
      });
    }),

  // 9.12 — Upload medical exam (stub)
  uploadMedical: permissionProcedure('offer', 'create')
    .input(
      z.object({
        offerId: z.string().uuid(),
        fileName: z.string(),
        fileType: z.string(),
        fileSize: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      // Stub: return mock upload URL and create a pending validation
      const validation = await db.preemploymentValidation.create({
        data: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
          type: 'medical_exam',
          status: 'pending',
          isBlocking: true,
          notes: `Archivo: ${input.fileName}`,
        },
      });

      return {
        validation,
        uploadUrl: `https://storage.mock.tims.app/medical/${validation.id}/${input.fileName}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    }),

  // 9.13 — Analyze medical exam (stub — mock AI)
  analyzeMedical: permissionProcedure('offer', 'read')
    .input(z.object({ validationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const validation = await db.preemploymentValidation.findFirst({
        where: {
          id: input.validationId,
          organizationId: ctx.user.organizationId,
          type: 'medical_exam',
        },
      });

      if (!validation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Validacion medica no encontrada' });
      }

      // Stub: return mock AI analysis
      return {
        validationId: input.validationId,
        analysis: {
          status: 'fit_for_duty',
          summary: 'El candidato cumple con los requisitos medicos para el puesto.',
          findings: [
            { category: 'general_health', result: 'normal', notes: 'Sin observaciones' },
            { category: 'vision', result: 'normal', notes: '20/20 ambos ojos' },
            { category: 'cardiovascular', result: 'normal', notes: 'Dentro de parametros' },
          ],
          restrictions: [],
          recommendations: ['Examen de seguimiento en 12 meses'],
        },
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),

  // 9.14 — Get legal checklist for an offer
  getLegalChecklist: permissionProcedure('offer', 'read')
    .input(z.object({ offerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.legalCheck.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          offerId: input.offerId,
        },
        include: {
          completedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // 9.15 — Update a legal check
  updateLegalCheck: permissionProcedure('offer', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        completed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const check = await db.legalCheck.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });

      if (!check) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verificacion legal no encontrada' });
      }

      return db.legalCheck.update({
        where: { id: input.id },
        data: {
          completed: input.completed,
          completedAt: input.completed ? new Date() : null,
          completedById: input.completed ? ctx.user.id : null,
        },
      });
    }),

  // 9.16 — Generate e-signature link (stub)
  generateEsignature: permissionProcedure('offer', 'update')
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      // Stub: return a mock e-signature URL
      return {
        offerId: input.offerId,
        signatureUrl: `https://esign.mock.tims.app/sign/${input.offerId}?token=mock-${Date.now()}`,
        candidateEmail: offer.candidate.email,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        provider: 'mock-esign',
      };
    }),

  // 9.17 — Convert accepted offer to employee (create User from Candidate)
  convertToEmployee: permissionProcedure('offer', 'create')
    .input(
      z.object({
        offerId: z.string().uuid(),
        jobTitle: z.string(),
        companyId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        teamId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await db.offer.findFirst({
        where: { id: input.offerId, organizationId: ctx.user.organizationId },
        include: {
          candidate: true,
          vacancy: { select: { companyId: true, businessUnitId: true, teamId: true } },
        },
      });

      if (!offer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oferta no encontrada' });
      }

      if (offer.status !== 'accepted') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Solo se pueden convertir ofertas aceptadas',
        });
      }

      const candidate = offer.candidate;

      // Check if a user with this email already exists in the org
      const existingUser = await db.user.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          email: candidate.email,
        },
      });

      if (existingUser) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Ya existe un empleado con este correo electronico',
        });
      }

      return db.$transaction(async (tx) => {
        // Create the user record (supabaseUserId will be set when they first log in)
        const newUser = await tx.user.create({
          data: {
            organizationId: ctx.user.organizationId,
            supabaseUserId: `pending-${candidate.id}`,
            email: candidate.email,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            phone: candidate.phone,
            avatar: candidate.avatar,
            jobTitle: input.jobTitle,
            companyId: input.companyId ?? offer.vacancy.companyId,
            businessUnitId: input.businessUnitId ?? offer.vacancy.businessUnitId,
            isActive: true,
          },
        });

        // Add to team if specified
        const teamId = input.teamId ?? offer.vacancy.teamId;
        if (teamId) {
          await tx.userTeam.create({
            data: {
              userId: newUser.id,
              teamId,
              role: 'member',
            },
          });
        }

        // Update offer status
        await tx.offer.update({
          where: { id: input.offerId },
          data: { status: 'converted' },
        });

        return newUser;
      });
    }),

  // 9.18 — Get pending offers (awaiting action by current user)
  getPending: permissionProcedure('offer', 'read').query(async ({ ctx }) => {
    // Get offers pending the current user's approval
    const pendingApprovals = await db.offerApproval.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        approverId: ctx.user.id,
        status: 'pending',
      },
      include: {
        offer: {
          include: {
            candidate: {
              select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            },
            vacancy: { select: { id: true, title: true } },
            creator: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return pendingApprovals.map((a) => ({
      approvalId: a.id,
      step: a.step,
      offer: a.offer,
    }));
  }),
});
