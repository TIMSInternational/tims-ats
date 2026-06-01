import { z } from 'zod';
import { router } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { platformProcedure } from './_common';

export const aiAgentsRouter = router({
  getAiAgentKpis: platformProcedure.query(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total, activeCount, stubCount, usageLogs] = await Promise.all([
      db.aiAgent.count(),
      db.aiAgent.count({ where: { status: 'active' } }),
      db.aiAgent.count({ where: { status: 'stub' } }),
      db.aiAgentUsageLog.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo } },
        _sum: { costUsd: true },
        _avg: { costUsd: true },
        _count: true,
      }),
    ]);

    return {
      total,
      active: activeCount,
      stubCount,
      monthlySpend: usageLogs._sum.costUsd ?? 0,
      avgCostPerCall: usageLogs._avg.costUsd ?? 0,
    };
  }),

  listAiAgents: platformProcedure
    .input(z.object({
      category: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const where: any = {};
      if (input?.category) where.category = input.category;
      if (input?.status) where.status = input.status;
      if (input?.search) {
        where.OR = [
          { name: { contains: input.search, mode: 'insensitive' } },
          { slug: { contains: input.search, mode: 'insensitive' } },
          { description: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      return db.aiAgent.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { orgConfigs: true, usageLogs: true } },
        },
      });
    }),

  getAiAgent: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const agent = await db.aiAgent.findUnique({
        where: { id: input.id },
        include: {
          orgConfigs: {
            include: { organization: { select: { id: true, name: true } } },
          },
        },
      });
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
      return agent;
    }),

  updateAiAgent: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.string().optional(),
      model: z.string().optional(),
      cacheTtlSeconds: z.number().int().min(0).optional(),
      batchEligible: z.boolean().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.aiAgent.update({ where: { id }, data });
    }),

  updateAiAgentOrgConfig: platformProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      organizationId: z.string().uuid(),
      enabled: z.boolean().optional(),
      monthlyBudget: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const { agentId, organizationId, ...data } = input;
      return db.aiAgentOrgConfig.upsert({
        where: { agentId_organizationId: { agentId, organizationId } },
        create: { agentId, organizationId, ...data },
        update: data,
      });
    }),

  getOrgAiConfigs: platformProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.aiAgentOrgConfig.findMany({
        where: { organizationId: input.organizationId },
        include: {
          agent: { select: { id: true, name: true, slug: true, category: true, model: true, status: true, costPerCall: true } },
        },
      });
    }),

  getAiAgentUsage: platformProcedure
    .input(z.object({
      agentId: z.string().uuid().optional(),
      days: z.number().int().min(1).max(90).default(30),
    }).optional())
    .query(async ({ input }) => {
      const since = new Date(Date.now() - (input?.days ?? 30) * 24 * 60 * 60 * 1000);
      const where: any = { createdAt: { gte: since } };
      if (input?.agentId) where.agentId = input.agentId;

      const agg = await db.aiAgentUsageLog.aggregate({
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true, costUsd: true },
        _count: true,
      });

      return {
        totalCalls: agg._count,
        totalCost: agg._sum.costUsd ?? 0,
        totalInputTokens: agg._sum.inputTokens ?? 0,
        totalOutputTokens: agg._sum.outputTokens ?? 0,
        avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
        avgCostPerCall: agg._avg.costUsd ?? 0,
      };
    }),

  seedAiAgents: platformProcedure.mutation(async () => {
    const existing = await db.aiAgent.count();
    if (existing > 0) return { seeded: false, count: existing };

    const agents = [
      // MVP Agents (11)
      { slug: 'cv-parser', name: 'CV Parser', description: 'Extrae datos estructurados de hojas de vida', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'vacancy-writer', name: 'Vacancy Writer', description: 'Genera descripciones de vacantes optimizadas', category: 'recruitment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 300, costPerCall: 0.015, status: 'stub' },
      { slug: 'inclusive-language', name: 'Inclusive Language Checker', description: 'Revisa lenguaje inclusivo en descripciones de vacantes', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'candidate-screener', name: 'Candidate Screener', description: 'Evalua candidatos contra requisitos de vacante', category: 'recruitment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'candidate-matcher', name: 'Candidate Matcher', description: 'Matching automatico candidato-vacante con scoring', category: 'recruitment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'interview-question-gen', name: 'Interview Question Generator', description: 'Genera preguntas de entrevista personalizadas', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 300, costPerCall: 0.015, status: 'stub' },
      { slug: 'interview-summarizer', name: 'Interview Summarizer', description: 'Resume entrevistas con puntos clave y evaluacion', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'assessment-evaluator', name: 'Assessment Evaluator', description: 'Evalua respuestas de assessments automaticamente', category: 'assessment', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'pipeline-optimizer', name: 'Pipeline Optimizer', description: 'Sugiere optimizaciones del pipeline de reclutamiento', category: 'pipeline', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'email-composer', name: 'Email Composer', description: 'Compone emails personalizados para candidatos', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'offer-letter-gen', name: 'Offer Letter Generator', description: 'Genera cartas de oferta personalizadas', category: 'recruitment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      // Post-MVP Agents (21)
      { slug: 'talent-insights', name: 'Talent Insights', description: 'Analytics avanzados de talento con predicciones', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'succession-planner', name: 'Succession Planner', description: 'Planificacion de sucesion asistida por IA', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'performance-reviewer', name: 'Performance Reviewer', description: 'Asistente de evaluacion de desempeno', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'okr-assistant', name: 'OKR Assistant', description: 'Ayuda a definir y alinear OKRs', category: 'talent', model: 'haiku', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'onboarding-planner', name: 'Onboarding Planner', description: 'Crea planes de onboarding personalizados', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'dei-analyzer', name: 'DEI Analyzer', description: 'Analisis de diversidad, equidad e inclusion', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'compensation-benchmarker', name: 'Compensation Benchmarker', description: 'Benchmarking salarial con datos de mercado', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 86400, costPerCall: 0.015, status: 'stub' },
      { slug: 'learning-recommender', name: 'Learning Recommender', description: 'Recomienda rutas de aprendizaje personalizadas', category: 'talent', model: 'haiku', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.003, status: 'stub' },
      { slug: 'engagement-predictor', name: 'Engagement Predictor', description: 'Predice riesgo de rotacion y engagement', category: 'talent', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'nine-box-evaluator', name: 'Nine-Box Evaluator', description: 'Evaluacion automatica para nine-box grid', category: 'talent', model: 'sonnet', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'video-analyzer', name: 'Video Interview Analyzer', description: 'Analiza entrevistas en video con NLP', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.030, status: 'stub' },
      { slug: 'sentiment-analyzer', name: 'Sentiment Analyzer', description: 'Analisis de sentimiento en comunicaciones', category: 'assessment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'skills-extractor', name: 'Skills Extractor', description: 'Extrae habilidades de CVs y perfiles', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 300, costPerCall: 0.003, status: 'stub' },
      { slug: 'job-classifier', name: 'Job Classifier', description: 'Clasifica vacantes por familia y nivel', category: 'recruitment', model: 'haiku', batchEligible: true, cacheTtlSeconds: 600, costPerCall: 0.003, status: 'stub' },
      { slug: 'reference-checker', name: 'Reference Checker', description: 'Asistente de verificacion de referencias', category: 'recruitment', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
      { slug: 'interview-coach', name: 'Interview Coach', description: 'Coaching para entrevistadores con feedback', category: 'interview', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 600, costPerCall: 0.015, status: 'stub' },
      { slug: 'assessment-designer', name: 'Assessment Designer', description: 'Disena assessments y pruebas tecnicas', category: 'assessment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'bias-detector', name: 'Bias Detector', description: 'Detecta sesgos en procesos de seleccion', category: 'assessment', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.015, status: 'stub' },
      { slug: 'workforce-planner', name: 'Workforce Planner', description: 'Planificacion de fuerza laboral con IA', category: 'talent', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 3600, costPerCall: 0.015, status: 'stub' },
      { slug: 'report-generator', name: 'Report Generator', description: 'Genera reportes de RRHH automatizados', category: 'pipeline', model: 'sonnet', batchEligible: false, cacheTtlSeconds: 1800, costPerCall: 0.015, status: 'stub' },
      { slug: 'chatbot-assistant', name: 'Chatbot Assistant', description: 'Chatbot de soporte para candidatos y empleados', category: 'general', model: 'haiku', batchEligible: false, cacheTtlSeconds: 0, costPerCall: 0.003, status: 'stub' },
    ];

    await db.aiAgent.createMany({ data: agents });

    return { seeded: true, count: agents.length };
  }),
});
