import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateAiService } from './candidate-ai.service';

// ---------------------------------------------------------------------------
// Candidate Service — business logic only, no db imports.
// Tag CRUD lives in candidate-tags.service.ts; pool membership + CSV export in
// candidate-pool.service.ts (split per CLAUDE.md's 300-line service cap).
// ---------------------------------------------------------------------------

export const candidateService = {
  async list(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    appScopeWhere: Prisma.ApplicationWhereInput,
    input: {
      cursor?: string;
      limit: number;
      search?: string;
      poolType?: string;
      source?: string;
      tags?: string[];
      skills?: string[];
      fitMin?: number;
      fitMax?: number;
    },
  ) {
    const items = await candidateRepository.list(orgId, scopeWhere, appScopeWhere, input);

    let nextCursor: string | undefined;
    if (items.length > input.limit) {
      const extra = items.pop()!;
      nextCursor = extra.id;
    }

    return { items, nextCursor };
  },

  async getById(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    id: string,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    const candidate = await candidateRepository.getById(orgId, scopeWhere, id, appScopeWhere);
    if (!candidate) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    }
    return candidate;
  },

  async create(
    orgId: string,
    userId: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      source: string;
      poolType: string;
      avatar?: string;
      location?: string;
      currentTitle?: string;
      currentCompany?: string;
      yearsExperience?: number;
      skills?: string[];
      linkedinUrl?: string;
      notes?: string;
    },
  ) {
    return candidateRepository.create(orgId, userId, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      source: input.source,
      poolType: input.poolType,
      avatar: input.avatar,
      location: input.location,
      currentTitle: input.currentTitle,
      currentCompany: input.currentCompany,
      yearsExperience: input.yearsExperience,
      skills: input.skills,
      linkedinUrl: input.linkedinUrl,
      notes: input.notes,
    });
  },

  async update(orgId: string, id: string, data: Record<string, unknown>) {
    const existing = await candidateRepository.exists(orgId, id);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    }
    return candidateRepository.update(id, data);
  },

  async search(orgId: string, scopeWhere: Prisma.CandidateWhereInput, query: string, limit: number) {
    return candidateRepository.search(orgId, scopeWhere, query, limit);
  },

  async getDashboardKpis(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    const [total, newThisMonth, activeApplications, poolStats] = await candidateRepository.getDashboardKpis(
      orgId,
      scopeWhere,
      appScopeWhere,
    );

    return {
      total,
      newThisMonth,
      activeApplications,
      byPool: poolStats.map((s) => ({ poolType: s.poolType, count: s._count.id })),
    };
  },

  // Timeline
  async getTimeline(orgId: string, candidateId: string, appScopeWhere: Prisma.ApplicationWhereInput) {
    const [applications, assessments, documents] = await candidateRepository.getTimelineData(
      orgId,
      candidateId,
      appScopeWhere,
    );

    type TimelineEvent = {
      id: string;
      type: string;
      title: string;
      description: string | null;
      date: Date;
      actor: string | null;
    };

    const events: TimelineEvent[] = [];

    for (const app of applications) {
      events.push({
        id: `app-${app.id}`,
        type: 'application',
        title: `Applied to ${app.vacancy.title}`,
        description: `Source: ${app.source}`,
        date: app.appliedAt,
        actor: null,
      });
      for (const mov of app.movements) {
        events.push({
          id: `mov-${mov.id}`,
          type: 'stage_movement',
          title: `${mov.fromStage?.name ?? 'Start'} → ${mov.toStage.name}`,
          description: mov.reason,
          date: mov.movedAt,
          actor: mov.actor ? `${mov.actor.firstName} ${mov.actor.lastName}` : null,
        });
      }
    }

    for (const a of assessments) {
      events.push({
        id: `asn-${a.id}`,
        type: 'assessment_assigned',
        title: `${a.assessmentType.name} assigned`,
        description: `Status: ${a.status}`,
        date: a.assignedAt,
        actor: null,
      });
      if (a.completedAt) {
        events.push({
          id: `asc-${a.id}`,
          type: 'assessment_completed',
          title: `${a.assessmentType.name} completed`,
          description: a.result ? `Score: ${a.result.normalizedScore}` : null,
          date: a.completedAt,
          actor: null,
        });
      }
    }

    for (const doc of documents) {
      events.push({
        id: `doc-${doc.id}`,
        type: 'document_uploaded',
        title: `Document uploaded: ${doc.fileName}`,
        description: doc.type,
        date: doc.uploadedAt,
        actor: null,
      });
    }

    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    return events;
  },

  // Apply to vacancy
  async applyToVacancy(orgId: string, candidateId: string, vacancyId: string, source: string) {
    const firstStage = await candidateRepository.findFirstStage(orgId, vacancyId);
    if (!firstStage) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'La vacante no tiene etapas de pipeline configuradas',
      });
    }

    return candidateRepository.createApplication({
      organizationId: orgId,
      candidateId,
      vacancyId,
      currentStageId: firstStage.id,
      source,
    });
  },

  // Risks
  async getRisks(orgId: string, candidateId: string, appScopeWhere: Prisma.ApplicationWhereInput) {
    const candidate = await candidateRepository.getCandidateForRisks(orgId, candidateId, appScopeWhere);
    if (!candidate) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    }

    const latestFit = candidate.fitScores[0];
    const rejectedCount = candidate.applications.filter((a) => a.status === 'rejected').length;

    return {
      overallRisk: latestFit && latestFit.overallScore < 40 ? 'high' : rejectedCount > 2 ? 'medium' : 'low',
      factors: [
        {
          label: 'Fit Score',
          value: latestFit?.overallScore ?? null,
          risk: latestFit && latestFit.overallScore < 40 ? 'high' : 'low',
        },
        { label: 'Previous Rejections', value: rejectedCount, risk: rejectedCount > 2 ? 'medium' : 'low' },
      ],
    };
  },

  // Merge
  async merge(orgId: string, primaryId: string, duplicateId: string) {
    if (primaryId === duplicateId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes fusionar un candidato consigo mismo' });
    }

    const [primary, duplicate] = await Promise.all([
      candidateRepository.exists(orgId, primaryId),
      candidateRepository.exists(orgId, duplicateId),
    ]);

    if (!primary || !duplicate) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Uno o ambos candidatos no encontrados' });
    }

    await candidateRepository.merge(primaryId, duplicateId);
    return candidateRepository.getAfterMerge(primaryId);
  },

  // Documents now live in candidate-documents.service.ts.
  // CV parsing now lives in candidate-ai.service.ts (parseCV) — it runs behind
  // the gated @tims/ai cv-parser agent and operates on CV text.
  // Tag CRUD/bulk-tag now lives in candidate-tags.service.ts.
  // Pool membership + CSV export now lives in candidate-pool.service.ts.

  // Recommendations — real Bedrock-backed candidate<->vacancy matching via the
  // gated candidate-matcher agent (candidate-ai.service.ts keeps AI/PII concerns
  // isolated per rule #7; this layer only guards existence before any AI spend).
  async getRecommendations(orgId: string, candidateId: string) {
    await candidateService.verifyExists(orgId, candidateId);
    return candidateAiService.getRecommendations(orgId, candidateId);
  },

  // Helper
  async verifyExists(orgId: string, candidateId: string) {
    const existing = await candidateRepository.exists(orgId, candidateId);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    return existing;
  },
};
