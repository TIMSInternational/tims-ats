import { z } from 'zod';
import { router } from '../../trpc';
import { db, db as systemDb, Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { platformProcedure } from './_common';
import { loadAiInterviewConfig, AI_VOICE_INTERVIEW_SLUG } from '../../services/ai-interview-access.service';
import { buildAiInterviewInvoiceLines } from '../../services/ai-interview-billing';

const agentListSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  category: true,
  model: true,
  batchEligible: true,
  cacheTtlSeconds: true,
  costPerCall: true,
  status: true,
  createdAt: true,
  _count: { select: { orgConfigs: true, usageLogs: true } },
} as const;

const AGENT_STATUS = z.enum(['active', 'stub', 'disabled']);
const AGENT_MODEL = z.enum(['haiku', 'sonnet']);
const AGENT_CATEGORY = z.enum(['recruitment', 'interview', 'assessment', 'pipeline', 'talent', 'general']);

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
      totalCalls30d: usageLogs._count,
    };
  }),

  listAiAgents: platformProcedure
    .input(z.object({
      category: AGENT_CATEGORY.optional(),
      status: AGENT_STATUS.optional(),
      search: z.string().max(100).optional(),
    }).optional())
    .query(async ({ input }) => {
      const where: Prisma.AiAgentWhereInput = {};
      if (input?.category) where.category = input.category;
      if (input?.status) where.status = input.status;
      if (input?.search?.trim()) {
        where.OR = [
          { name: { contains: input.search.trim(), mode: 'insensitive' } },
          { slug: { contains: input.search.trim(), mode: 'insensitive' } },
          { description: { contains: input.search.trim(), mode: 'insensitive' } },
        ];
      }

      return db.aiAgent.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: agentListSelect,
      });
    }),

  getAiAgent: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const agent = await db.aiAgent.findUnique({
        where: { id: input.id },
        select: {
          ...agentListSelect,
          orgConfigs: {
            select: {
              id: true,
              enabled: true,
              monthlyBudget: true,
              addonMonthlyFeeUsd: true,
              billableUsdPerMinute: true,
              aiInterviewDefaultMaxMinutes: true,
              aiInterviewMaxMinutesByType: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agente no encontrado' });
      return agent;
    }),

  updateAiAgent: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: AGENT_STATUS.optional(),
      model: AGENT_MODEL.optional(),
      cacheTtlSeconds: z.number().int().min(0).max(86400).optional(),
      batchEligible: z.boolean().optional(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.aiAgent.findUnique({
        where: { id: input.id },
        select: { id: true, status: true, slug: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agente no encontrado' });

      const { id, ...data } = input;
      const updated = await db.aiAgent.update({
        where: { id },
        data,
        select: agentListSelect,
      });

      if (input.status && input.status !== existing.status) {
        await db.auditLog.create({
          data: {
            action: `ai_agent_status_${input.status}`,
            entity: 'ai_agent',
            entityId: id,
            organizationId: '00000000-0000-0000-0000-000000000000',
            metadata: { slug: existing.slug, from: existing.status, to: input.status },
          },
        }).catch(() => {});
      }

      return updated;
    }),

  updateAiAgentOrgConfig: platformProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      organizationId: z.string().uuid(),
      enabled: z.boolean().optional(),
      // nullable so clearing the field sends null (Prisma strips undefined, so
      // undefined could never clear an existing cap).
      monthlyBudget: z.number().min(0).max(100000).nullable().optional(),
      addonMonthlyFeeUsd: z.number().min(0).max(100000).nullable().optional(),
      billableUsdPerMinute: z.number().min(0).max(1000).nullable().optional(),
      aiInterviewDefaultMaxMinutes: z.number().int().min(1).max(180).nullable().optional(),
      aiInterviewMaxMinutesByType: z.record(z.string().max(50), z.number().int().min(1).max(180)).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { agentId, organizationId, aiInterviewMaxMinutesByType, ...rest } = input;
      const data = {
        ...rest,
        ...(aiInterviewMaxMinutesByType === undefined
          ? {}
          : { aiInterviewMaxMinutesByType: aiInterviewMaxMinutesByType === null ? Prisma.DbNull : aiInterviewMaxMinutesByType }),
      };
      return db.aiAgentOrgConfig.upsert({
        where: { agentId_organizationId: { agentId, organizationId } },
        create: { agentId, organizationId, ...data },
        update: data,
        select: {
          id: true,
          enabled: true,
          monthlyBudget: true,
          addonMonthlyFeeUsd: true,
          billableUsdPerMinute: true,
          aiInterviewDefaultMaxMinutes: true,
          aiInterviewMaxMinutesByType: true,
          organization: { select: { id: true, name: true } },
        },
      });
    }),

  getOrgAiConfigs: platformProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.aiAgentOrgConfig.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          enabled: true,
          monthlyBudget: true,
          addonMonthlyFeeUsd: true,
          billableUsdPerMinute: true,
          aiInterviewDefaultMaxMinutes: true,
          aiInterviewMaxMinutesByType: true,
          agent: {
            select: { id: true, name: true, slug: true, category: true, model: true, status: true, costPerCall: true },
          },
        },
      });
    }),

  getAiAgentUsage: platformProcedure
    .input(z.object({
      agentId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional(),
      days: z.number().int().min(1).max(90).default(30),
    }).optional())
    .query(async ({ input }) => {
      const since = new Date(Date.now() - (input?.days ?? 30) * 24 * 60 * 60 * 1000);
      const where: Prisma.AiAgentUsageLogWhereInput = { createdAt: { gte: since } };
      if (input?.agentId) where.agentId = input.agentId;
      if (input?.organizationId) where.organizationId = input.organizationId;

      const [agg, byAgent] = await Promise.all([
        db.aiAgentUsageLog.aggregate({
          where,
          _sum: { costUsd: true, inputTokens: true, outputTokens: true },
          _avg: { latencyMs: true, costUsd: true },
          _count: true,
        }),
        db.aiAgentUsageLog.groupBy({
          by: ['agentId'],
          where,
          _sum: { costUsd: true },
          _count: true,
          orderBy: { _sum: { costUsd: 'desc' } },
          take: 10,
        }),
      ]);

      return {
        totalCalls: agg._count,
        totalCost: agg._sum.costUsd ?? 0,
        totalInputTokens: agg._sum.inputTokens ?? 0,
        totalOutputTokens: agg._sum.outputTokens ?? 0,
        avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
        avgCostPerCall: agg._avg.costUsd ?? 0,
        topAgentsByCost: byAgent.map((g) => ({
          agentId: g.agentId,
          totalCost: g._sum.costUsd ?? 0,
          callCount: g._count,
        })),
      };
    }),

  exportAgentsCsv: platformProcedure.query(async () => {
    const agents = await db.aiAgent.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        name: true, slug: true, category: true, model: true, status: true,
        batchEligible: true, cacheTtlSeconds: true, costPerCall: true,
        _count: { select: { orgConfigs: true, usageLogs: true } },
      },
    });
    const header = 'Name,Slug,Category,Model,Status,Batch,Cache TTL,Cost/Call,Org Configs,Usage Logs';
    const rows = agents.map(a => [
      a.name, a.slug, a.category, a.model, a.status,
      a.batchEligible ? 'Yes' : 'No', a.cacheTtlSeconds,
      `$${a.costPerCall.toFixed(3)}`, a._count.orgConfigs, a._count.usageLogs,
    ].join(','));
    return { csv: [header, ...rows].join('\n'), count: agents.length };
  }),

  getAiInterviewBillingPreview: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const config = await loadAiInterviewConfig(input.organizationId);
      const now = new Date();
      const start = input.periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const end = input.periodEnd ?? now;
      const agg = await systemDb.aiAgentUsageLog.aggregate({
        where: {
          organizationId: input.organizationId,
          agent: { slug: AI_VOICE_INTERVIEW_SLUG },
          createdAt: { gte: start, lte: end },
        },
        _sum: { billableUsd: true },
      });
      const usageUsd = agg._sum.billableUsd ?? 0;
      const addonFeeUsd = config?.addonMonthlyFeeUsd ?? 0;
      const lineItems = buildAiInterviewInvoiceLines({
        addonMonthlyFeeUsd: config?.enabled ? config.addonMonthlyFeeUsd : null,
        usageUsd,
        addonLabel: 'AI Voice Interview — monthly add-on',
        usageLabel: 'AI Voice Interview — usage',
      });
      return {
        enabled: config?.enabled === true,
        addonFeeUsd: config?.enabled ? addonFeeUsd : 0,
        usageUsd,
        lineItems,
      };
    }),

  seedAiAgents: platformProcedure.mutation(async () => {
    const existing = await db.aiAgent.count();
    if (existing > 0) return { seeded: false, count: existing };

    const agents = [
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
