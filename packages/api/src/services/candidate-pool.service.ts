import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { csvRow } from '@tims/shared';
import { candidateRepository } from '../repositories/candidate.repository';

// ---------------------------------------------------------------------------
// Candidate Pool Service — pool membership + CSV export, no db imports.
// Split from candidate.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const candidatePoolService = {
  async addToPool(orgId: string, candidateId: string, poolType: string) {
    const existing = await candidateRepository.exists(orgId, candidateId);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    return candidateRepository.updatePool(candidateId, poolType);
  },

  async getPoolStats(orgId: string, scopeWhere: Prisma.CandidateWhereInput) {
    const stats = await candidateRepository.getPoolStats(orgId, scopeWhere);
    const total = stats.reduce((sum, s) => sum + s._count.id, 0);
    return { total, byPool: stats.map((s) => ({ poolType: s.poolType, count: s._count.id })) };
  },

  async exportPool(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    input: { poolType?: string; tags?: string[] },
  ) {
    const LIMIT = 5000;
    const rows = await candidateRepository.findForExport(orgId, scopeWhere, input, LIMIT);
    const truncated = rows.length > LIMIT;
    const page = truncated ? rows.slice(0, LIMIT) : rows;

    const header = csvRow([
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Source',
      'Pool Type',
      'Current Title',
      'Current Company',
      'Years Experience',
      'Location',
      'Tags',
      'Created At',
    ]);
    const lines = page.map((c) =>
      csvRow([
        c.firstName,
        c.lastName,
        c.email,
        c.phone,
        c.source,
        c.poolType,
        c.currentTitle,
        c.currentCompany,
        c.yearsExperience == null ? '' : String(c.yearsExperience),
        c.location,
        c.tags.map((t) => t.tag).join('; '),
        c.createdAt.toISOString(),
      ]),
    );

    return { csv: [header, ...lines].join('\n'), count: page.length, truncated };
  },
};
