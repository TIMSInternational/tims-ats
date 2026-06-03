import { db } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Explicit select objects — never return full records (CLAUDE.md §4)
// ---------------------------------------------------------------------------

const candidateListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  source: true,
  poolType: true,
  avatar: true,
  location: true,
  currentTitle: true,
  currentCompany: true,
  skills: true,
  yearsExperience: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  tags: { select: { id: true, tag: true, source: true } },
  fitScores: {
    orderBy: { calculatedAt: 'desc' as const },
    take: 1,
    select: { id: true, overallScore: true, calculatedAt: true },
  },
  _count: { select: { applications: true } },
} satisfies Prisma.CandidateSelect;

const candidateDetailSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  source: true,
  poolType: true,
  avatar: true,
  location: true,
  currentTitle: true,
  currentCompany: true,
  yearsExperience: true,
  skills: true,
  linkedinUrl: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  tags: { select: { id: true, tag: true, source: true } },
  documents: {
    orderBy: { uploadedAt: 'desc' as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileUrl: true,
      fileSize: true,
      parsedData: true,
      uploadedAt: true,
    },
  },
  applications: {
    select: {
      id: true,
      status: true,
      source: true,
      appliedAt: true,
      vacancy: { select: { id: true, title: true, status: true } },
      currentStage: { select: { id: true, name: true, order: true } },
    },
  },
  fitScores: {
    orderBy: { calculatedAt: 'desc' as const },
    select: { id: true, overallScore: true, breakdown: true, calculatedAt: true },
  },
  assessmentAssignments: {
    select: {
      id: true,
      status: true,
      assignedAt: true,
      completedAt: true,
      assessmentType: { select: { id: true, name: true, code: true } },
      result: { select: { id: true, rawScore: true, normalizedScore: true, breakdown: true } },
    },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, avatar: true },
  },
} satisfies Prisma.CandidateSelect;

const candidateMutationSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  poolType: true,
  source: true,
  createdAt: true,
} satisfies Prisma.CandidateSelect;

const candidateSearchSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
  currentTitle: true,
  currentCompany: true,
  tags: { select: { tag: true } },
} satisfies Prisma.CandidateSelect;

const documentSelect = {
  id: true,
  type: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  parsedData: true,
  uploadedAt: true,
} satisfies Prisma.CandidateDocumentSelect;

const tagSelect = {
  id: true,
  tag: true,
  source: true,
  candidateId: true,
  createdAt: true,
} satisfies Prisma.CandidateTagSelect;

// ---------------------------------------------------------------------------
// Repository — only place that imports `db`
// ---------------------------------------------------------------------------

export const candidateRepository = {
  async list(
    orgId: string,
    filters: {
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
    const { cursor, limit, search, poolType, source, tags, skills, fitMin, fitMax } = filters;

    const where: Prisma.CandidateWhereInput = {
      organizationId: orgId,
      isActive: true,
      deletedAt: null,
    };

    if (poolType) where.poolType = poolType;
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { currentTitle: { contains: search, mode: 'insensitive' } },
        { currentCompany: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (tags && tags.length > 0) {
      where.tags = { some: { tag: { in: tags } } };
    }
    if (skills && skills.length > 0) {
      where.skills = { array_contains: skills };
    }
    if (fitMin !== undefined || fitMax !== undefined) {
      where.fitScores = {
        some: {
          overallScore: {
            ...(fitMin !== undefined ? { gte: fitMin } : {}),
            ...(fitMax !== undefined ? { lte: fitMax } : {}),
          },
        },
      };
    }

    return db.candidate.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: candidateListSelect,
    });
  },

  async getById(orgId: string, id: string) {
    return db.candidate.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: candidateDetailSelect,
    });
  },

  async create(orgId: string, userId: string, data: {
    firstName: string; lastName: string; email: string; phone?: string;
    source: string; poolType: string; avatar?: string; location?: string;
    currentTitle?: string; currentCompany?: string; yearsExperience?: number;
    skills?: string[]; linkedinUrl?: string; notes?: string;
  }) {
    return db.candidate.create({
      data: {
        ...data,
        organizationId: orgId,
        createdById: userId,
      },
      select: candidateMutationSelect,
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    return db.candidate.update({
      where: { id },
      data: data as Prisma.CandidateUpdateInput,
      select: candidateMutationSelect,
    });
  },

  async exists(orgId: string, id: string) {
    return db.candidate.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
  },

  async search(orgId: string, query: string, limit: number) {
    return db.candidate.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        deletedAt: null,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { currentTitle: { contains: query, mode: 'insensitive' } },
          { currentCompany: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: candidateSearchSelect,
    });
  },

  async countByOrg(orgId: string) {
    return db.candidate.count({
      where: { organizationId: orgId, isActive: true, deletedAt: null },
    });
  },

  // Documents
  async createDocument(orgId: string, data: { candidateId: string; type: string; fileName: string; fileUrl: string; fileSize?: number }) {
    return db.candidateDocument.create({
      data: { organizationId: orgId, ...data },
      select: documentSelect,
    });
  },

  async findDocument(orgId: string, documentId: string) {
    return db.candidateDocument.findFirst({
      where: { id: documentId, organizationId: orgId },
      select: documentSelect,
    });
  },

  async deleteDocument(documentId: string) {
    await db.candidateDocument.delete({ where: { id: documentId } });
  },

  async updateDocumentParsedData(documentId: string, parsedData: Record<string, unknown>) {
    return db.candidateDocument.update({
      where: { id: documentId },
      data: { parsedData: parsedData as Prisma.InputJsonValue },
      select: documentSelect,
    });
  },

  // Tags
  async createTag(orgId: string, data: { candidateId: string; tag: string; source: string }) {
    return db.candidateTag.create({
      data: { organizationId: orgId, ...data },
      select: tagSelect,
    });
  },

  async findTag(orgId: string, candidateId: string, tag: string) {
    return db.candidateTag.findFirst({
      where: { candidateId, tag, organizationId: orgId },
      select: { id: true },
    });
  },

  async deleteTag(tagId: string) {
    await db.candidateTag.delete({ where: { id: tagId } });
  },

  async bulkCreateTags(data: Array<{ organizationId: string; candidateId: string; tag: string; source: string }>) {
    return db.candidateTag.createMany({ data, skipDuplicates: true });
  },

  async countCandidatesInOrg(orgId: string, candidateIds: string[]) {
    return db.candidate.count({
      where: { id: { in: candidateIds }, organizationId: orgId, deletedAt: null },
    });
  },

  // Pool
  async updatePool(id: string, poolType: string) {
    return db.candidate.update({
      where: { id },
      data: { poolType },
      select: candidateMutationSelect,
    });
  },

  async getPoolStats(orgId: string) {
    return db.candidate.groupBy({
      by: ['poolType'],
      where: { organizationId: orgId, isActive: true, deletedAt: null },
      _count: { id: true },
    });
  },

  // Merge (transaction)
  async merge(primaryId: string, duplicateId: string) {
    const existingPrimaryTags = await db.candidateTag.findMany({
      where: { candidateId: primaryId },
      select: { tag: true },
    });
    const primaryTagSet = new Set(existingPrimaryTags.map((t) => t.tag));

    return db.$transaction([
      db.candidateDocument.updateMany({
        where: { candidateId: duplicateId },
        data: { candidateId: primaryId },
      }),
      db.candidateTag.deleteMany({
        where: { candidateId: duplicateId, tag: { in: [...primaryTagSet] } },
      }),
      db.candidateTag.updateMany({
        where: { candidateId: duplicateId },
        data: { candidateId: primaryId },
      }),
      db.assessmentAssignment.updateMany({
        where: { candidateId: duplicateId },
        data: { candidateId: primaryId },
      }),
      db.fitScore.deleteMany({
        where: { candidateId: duplicateId },
      }),
      db.candidate.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date(), isActive: false },
      }),
    ]);
  },

  async getAfterMerge(id: string) {
    return db.candidate.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        tags: { select: { id: true, tag: true } },
        documents: { select: { id: true, fileName: true } },
      },
    });
  },

  // Timeline
  async getTimelineData(orgId: string, candidateId: string) {
    return Promise.all([
      db.application.findMany({
        where: { candidateId, organizationId: orgId },
        select: {
          id: true,
          status: true,
          source: true,
          appliedAt: true,
          vacancy: { select: { id: true, title: true } },
          movements: {
            select: {
              id: true,
              movedAt: true,
              reason: true,
              fromStage: { select: { name: true } },
              toStage: { select: { name: true } },
              actor: { select: { firstName: true, lastName: true } },
            },
            orderBy: { movedAt: 'desc' as const },
          },
        },
        orderBy: { appliedAt: 'desc' },
      }),
      db.assessmentAssignment.findMany({
        where: { candidateId, organizationId: orgId },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          completedAt: true,
          assessmentType: { select: { name: true, code: true } },
          result: { select: { rawScore: true, normalizedScore: true } },
        },
        orderBy: { assignedAt: 'desc' },
      }),
      db.candidateDocument.findMany({
        where: { candidateId, organizationId: orgId },
        select: { id: true, type: true, fileName: true, uploadedAt: true },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);
  },

  // Apply to vacancy
  async findFirstStage(orgId: string, vacancyId: string) {
    return db.pipelineStage.findFirst({
      where: { vacancyId, organizationId: orgId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
  },

  async createApplication(data: {
    organizationId: string;
    candidateId: string;
    vacancyId: string;
    currentStageId: string;
    source: string;
  }) {
    return db.application.create({
      data,
      select: {
        id: true,
        status: true,
        source: true,
        appliedAt: true,
        vacancy: { select: { id: true, title: true } },
        currentStage: { select: { id: true, name: true } },
      },
    });
  },

  // Risks
  async getCandidateForRisks(orgId: string, candidateId: string) {
    return db.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        applications: { select: { status: true } },
        fitScores: {
          orderBy: { calculatedAt: 'desc' as const },
          take: 1,
          select: { overallScore: true },
        },
      },
    });
  },

  // KPIs
  async getDashboardKpis(orgId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return Promise.all([
      db.candidate.count({ where: { organizationId: orgId, isActive: true, deletedAt: null } }),
      db.candidate.count({ where: { organizationId: orgId, isActive: true, deletedAt: null, createdAt: { gte: monthStart } } }),
      db.application.count({ where: { organizationId: orgId, status: 'active' } }),
      db.candidate.groupBy({
        by: ['poolType'],
        where: { organizationId: orgId, isActive: true, deletedAt: null },
        _count: { id: true },
      }),
    ]);
  },
};
