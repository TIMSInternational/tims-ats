import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Explicit select objects — never return full records (CLAUDE.md §4)
// ---------------------------------------------------------------------------

// Codex re-review: list children (latest fitScore, application count) carry the
// application-level fragment so a candidate visible via one in-scope application
// does not surface fit scores / counts from out-of-scope vacancies. {} at org
// scope → identical to the previous static select.
const buildCandidateListSelect = (appScopeWhere: Prisma.ApplicationWhereInput) =>
  ({
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
      where: appScopeWhere as Prisma.FitScoreWhereInput,
      orderBy: { calculatedAt: 'desc' as const },
      take: 1,
      select: { id: true, overallScore: true, calculatedAt: true },
    },
    _count: { select: { applications: { where: appScopeWhere } } },
  }) satisfies Prisma.CandidateSelect;

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
  createdBy: {
    select: { id: true, firstName: true, lastName: true, avatar: true },
  },
} satisfies Prisma.CandidateSelect;

// Codex F1: the candidate-detail child relations (applications / fitScores /
// assessmentAssignments) are built per-request with the application-level scope
// fragment threaded in as their `where`, so a narrow-scoped user who reaches the
// candidate via ONE in-scope application cannot read their out-of-scope children.
// FitScore + AssessmentAssignment both relate to Vacancy with the same shape, so
// the SAME {vacancy: frag} fragment scopes all three. At org/company scope the
// fragment is {} → no behavior change.
const buildCandidateDetailSelect = (appScopeWhere: Prisma.ApplicationWhereInput) =>
  ({
    ...candidateDetailSelect,
    applications: {
      where: appScopeWhere,
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
      where: appScopeWhere as Prisma.FitScoreWhereInput,
      orderBy: { calculatedAt: 'desc' as const },
      select: { id: true, overallScore: true, breakdown: true, calculatedAt: true },
    },
    assessmentAssignments: {
      where: appScopeWhere as Prisma.AssessmentAssignmentWhereInput,
      select: {
        id: true,
        status: true,
        assignedAt: true,
        completedAt: true,
        assessmentType: { select: { id: true, name: true, code: true } },
        // Field-level safety (Wave 2.5 slice 6): rawScore + breakdown are
        // Psychometric Raw = restricted, super_admin ONLY (matrix §21). This
        // candidate-detail path carries no role check that could gate them, so
        // they are OMITTED here (fail-safe). Raw psychometrics are read only via
        // the assessment router's selectFor-gated + audited readers. Threading
        // ctx.access.roles down to this nested aggregate select is the documented
        // follow-on if a super_admin ever needs raw data on this path.
        result: { select: { id: true, normalizedScore: true } },
      },
    },
  }) satisfies Prisma.CandidateSelect;

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
  candidateId: true,
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
    scopeWhere: Prisma.CandidateWhereInput,
    appScopeWhere: Prisma.ApplicationWhereInput,
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

    const filterClause: Prisma.CandidateWhereInput = {};

    if (poolType) filterClause.poolType = poolType;
    if (source) filterClause.source = source;
    if (search) {
      filterClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { currentTitle: { contains: search, mode: 'insensitive' } },
        { currentCompany: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (tags && tags.length > 0) {
      filterClause.tags = { some: { tag: { in: tags } } };
    }
    if (skills && skills.length > 0) {
      filterClause.skills = { array_contains: skills };
    }
    if (fitMin !== undefined || fitMax !== undefined) {
      // The fit filter must only consider IN-SCOPE fit scores (codex re-review).
      filterClause.fitScores = {
        some: {
          AND: [
            {
              overallScore: {
                ...(fitMin !== undefined ? { gte: fitMin } : {}),
                ...(fitMax !== undefined ? { lte: fitMax } : {}),
              },
            },
            appScopeWhere as Prisma.FitScoreWhereInput,
          ],
        },
      };
    }

    return db.candidate.findMany({
      where: {
        AND: [
          { organizationId: orgId, isActive: true, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
          filterClause,
        ],
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: buildCandidateListSelect(appScopeWhere),
    });
  },

  async getById(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    id: string,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    return db.candidate.findFirst({
      where: {
        AND: [
          { id, organizationId: orgId, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
        ],
      },
      select: buildCandidateDetailSelect(appScopeWhere),
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

  async search(orgId: string, scopeWhere: Prisma.CandidateWhereInput, query: string, limit: number) {
    return db.candidate.findMany({
      where: {
        AND: [
          { organizationId: orgId, isActive: true, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
          {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { currentTitle: { contains: query, mode: 'insensitive' } },
              { currentCompany: { contains: query, mode: 'insensitive' } },
            ],
          },
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

  async updateCandidateParsedFields(
    orgId: string,
    candidateId: string,
    fields: { education: Prisma.InputJsonValue; languages: Prisma.InputJsonValue },
  ) {
    return db.candidate.update({
      where: { id: candidateId, organizationId: orgId },
      data: { education: fields.education, languages: fields.languages },
      select: { id: true },
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

  async countCandidatesInScope(orgId: string, candidateIds: string[], scopeWhere: Prisma.CandidateWhereInput) {
    return db.candidate.count({
      where: {
        AND: [
          { id: { in: candidateIds }, organizationId: orgId, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
        ],
      },
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

  async getPoolStats(orgId: string, scopeWhere: Prisma.CandidateWhereInput) {
    return db.candidate.groupBy({
      by: ['poolType'],
      where: {
        AND: [
          { organizationId: orgId, isActive: true, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
        ],
      },
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
  // Codex F1: application/assessment child loads are scope-filtered via the
  // threaded appScopeWhere ({vacancy: frag}) so out-of-scope rows never surface
  // in the timeline. At org scope appScopeWhere is {} → no behavior change.
  async getTimelineData(
    orgId: string,
    candidateId: string,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    return Promise.all([
      db.application.findMany({
        where: { AND: [{ candidateId, organizationId: orgId }, appScopeWhere] },
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
        where: { AND: [{ candidateId, organizationId: orgId }, appScopeWhere as Prisma.AssessmentAssignmentWhereInput] },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          completedAt: true,
          assessmentType: { select: { name: true, code: true } },
          // Restricted rawScore omitted here (super_admin-only, no role gate on
          // this timeline path). See buildCandidateDetailSelect note. The
          // timeline only needs normalizedScore for display.
          result: { select: { normalizedScore: true } },
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
  async getCandidateForRisks(
    orgId: string,
    candidateId: string,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    // Codex re-review: risk factors must derive only from IN-SCOPE applications
    // and fit scores. {} at org scope → previous behavior.
    return db.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        applications: { where: appScopeWhere, select: { status: true } },
        fitScores: {
          where: appScopeWhere as Prisma.FitScoreWhereInput,
          orderBy: { calculatedAt: 'desc' as const },
          take: 1,
          select: { overallScore: true },
        },
      },
    });
  },

  // KPIs
  async getDashboardKpis(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return Promise.all([
      db.candidate.count({
        where: {
          AND: [
            { organizationId: orgId, isActive: true, deletedAt: null },
            scopeWhere as Prisma.CandidateWhereInput,
          ],
        },
      }),
      db.candidate.count({
        where: {
          AND: [
            { organizationId: orgId, isActive: true, deletedAt: null, createdAt: { gte: monthStart } },
            scopeWhere as Prisma.CandidateWhereInput,
          ],
        },
      }),
      // Codex F4: the active-application KPI composes the application fragment —
      // a narrow-scoped dashboard must not show the org-wide count.
      db.application.count({
        where: { AND: [{ organizationId: orgId, status: 'active' }, appScopeWhere] },
      }),
      db.candidate.groupBy({
        by: ['poolType'],
        where: {
          AND: [
            { organizationId: orgId, isActive: true, deletedAt: null },
            scopeWhere as Prisma.CandidateWhereInput,
          ],
        },
        _count: { id: true },
      }),
    ]);
  },

  // Export
  async findForExport(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    filters: { poolType?: string; tags?: string[] },
    limit: number,
  ) {
    const filterClause: Prisma.CandidateWhereInput = {};
    if (filters.poolType) filterClause.poolType = filters.poolType;
    if (filters.tags && filters.tags.length > 0) {
      filterClause.tags = { some: { tag: { in: filters.tags } } };
    }

    return db.candidate.findMany({
      where: {
        AND: [
          { organizationId: orgId, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
          filterClause,
        ],
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        source: true,
        poolType: true,
        currentTitle: true,
        currentCompany: true,
        yearsExperience: true,
        location: true,
        tags: { select: { tag: true } },
        createdAt: true,
      },
    });
  },
};
