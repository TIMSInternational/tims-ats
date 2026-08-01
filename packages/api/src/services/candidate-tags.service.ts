import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { candidateRepository } from '../repositories/candidate.repository';

// ---------------------------------------------------------------------------
// Candidate Tags Service — tag CRUD + bulk tagging, no db imports.
// Split from candidate.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const candidateTagsService = {
  async addTag(orgId: string, candidateId: string, tag: string, source: string) {
    return candidateRepository.createTag(orgId, { candidateId, tag, source });
  },

  async removeTag(orgId: string, candidateId: string, tag: string) {
    const existing = await candidateRepository.findTag(orgId, candidateId, tag);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag no encontrado' });
    await candidateRepository.deleteTag(existing.id);
    return { success: true };
  },

  async bulkTag(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    candidateIds: string[],
    tag: string,
    source: string,
  ) {
    const uniqueIds = [...new Set(candidateIds)];
    const count = await candidateRepository.countCandidatesInScope(orgId, uniqueIds, scopeWhere);
    if (count !== uniqueIds.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    }

    const result = await candidateRepository.bulkCreateTags(
      uniqueIds.map((candidateId) => ({ organizationId: orgId, candidateId, tag, source })),
    );
    return { tagged: result.count };
  },
};
