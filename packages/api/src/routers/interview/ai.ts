import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { tenantDb as db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const interviewAiRouter = router({
  // 8.8 — Get interview guide (stub -- mock AI)
  getGuide: permissionProcedure('interview', 'read')
    .input(
      z.object({
        interviewId: z.string().uuid(),
        vacancyId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Stub: return a mock AI-generated interview guide
      return {
        interviewId: input.interviewId,
        sections: [
          {
            title: 'Introduccion',
            duration: 5,
            questions: [
              'Cuentame sobre tu experiencia profesional',
              'Que te motiva a aplicar a esta posicion?',
            ],
          },
          {
            title: 'Competencias Tecnicas',
            duration: 20,
            questions: [
              'Describe un proyecto complejo que hayas liderado',
              'Como manejas situaciones de alta presion?',
              'Que herramientas y metodologias prefieres usar?',
            ],
          },
          {
            title: 'Competencias Conductuales',
            duration: 15,
            questions: [
              'Dame un ejemplo de cuando resolviste un conflicto en equipo',
              'Como priorizas tareas cuando tienes multiples plazos?',
            ],
          },
          {
            title: 'Cierre',
            duration: 5,
            questions: [
              'Tienes alguna pregunta sobre la empresa o el rol?',
            ],
          },
        ],
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),

  // 8.9 — Generate interview summary (stub -- mock AI)
  generateSummary: permissionProcedure('interview', 'create')
    .input(z.object({ interviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const interview = await db.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.user.organizationId },
        include: {
          scorecards: true,
          candidate: { select: { firstName: true, lastName: true } },
        },
      });

      if (!interview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
      }

      // Stub: create a mock AI-generated summary
      const summary = await db.interviewSummary.upsert({
        where: { interviewId: input.interviewId },
        create: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
          summary: `Resumen de la entrevista con ${interview.candidate.firstName} ${interview.candidate.lastName}. El candidato demostro competencias solidas en las areas evaluadas. Se recomienda avanzar al siguiente paso del proceso.`,
          keyPoints: [
            'Experiencia relevante en el sector',
            'Buena comunicacion y trabajo en equipo',
            'Conocimientos tecnicos adecuados',
          ],
          strengths: [
            'Liderazgo demostrado',
            'Capacidad de resolucion de problemas',
          ],
          concerns: [
            'Disponibilidad para viajar por confirmar',
          ],
          model: 'mock-ai-v1',
        },
        update: {
          summary: `Resumen actualizado de la entrevista con ${interview.candidate.firstName} ${interview.candidate.lastName}.`,
          keyPoints: ['Experiencia relevante', 'Buena comunicacion'],
          strengths: ['Liderazgo', 'Resolucion de problemas'],
          concerns: ['Disponibilidad por confirmar'],
          generatedAt: new Date(),
          model: 'mock-ai-v1',
        },
      });

      return summary;
    }),

  // 8.10 — Detect bias in scorecards (stub -- mock AI)
  detectBias: permissionProcedure('interview', 'read')
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scorecards = await db.interviewScorecard.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          interviewId: input.interviewId,
        },
        include: {
          evaluator: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      // Stub: return mock bias analysis
      return {
        interviewId: input.interviewId,
        scorecardsAnalyzed: scorecards.length,
        biasIndicators: [
          {
            type: 'halo_effect',
            severity: 'low',
            description: 'No se detectaron indicadores significativos del efecto halo.',
          },
          {
            type: 'similarity_bias',
            severity: 'none',
            description: 'Las evaluaciones parecen objetivas y basadas en competencias.',
          },
        ],
        overallRisk: 'low',
        recommendations: [
          'Mantener el uso de scorecards estructurados',
          'Asegurar diversidad en el panel de evaluadores',
        ],
        generatedAt: new Date().toISOString(),
        model: 'mock-ai-v1',
      };
    }),
});
