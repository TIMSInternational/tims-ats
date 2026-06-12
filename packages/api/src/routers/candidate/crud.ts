import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { scopeWhereFor, assertScoped } from '../../access';

const cursorPaginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const candidateCreateInput = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(254),
  phone: z.string().max(30).optional(),
  source: z.string().min(1).max(100),
  poolType: z.string().min(1).max(100),
  avatar: z.string().url().max(2048).optional(),
  location: z.string().max(200).optional(),
  currentTitle: z.string().max(200).optional(),
  currentCompany: z.string().max(200).optional(),
  yearsExperience: z.number().int().min(0).optional(),
  skills: z.array(z.string().max(100)).max(50).optional(),
  linkedinUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(5000).optional(),
});

export const candidateCrudRouter = router({
  list: permissionProcedure('candidate', 'read')
    .input(
      cursorPaginationInput.extend({
        search: z.string().max(200).optional(),
        poolType: z.string().max(100).optional(),
        fitMin: z.number().min(0).max(100).optional(),
        fitMax: z.number().min(0).max(100).optional(),
        tags: z.array(z.string().max(100)).max(50).optional(),
        source: z.string().max(100).optional(),
        skills: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      // List children (fit scores, app counts) + fit filters carry the
      // application fragment (codex re-review).
      const appScopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id);
      return candidateService.list(ctx.user.organizationId, scopeWhere, appScopeWhere, input);
    }),

  getById: permissionProcedure('candidate', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      // Codex F1: child relations (applications/fitScores/assessments) are
      // filtered by the application-level fragment, not just the parent gate.
      const appScopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id);
      return candidateService.getById(ctx.user.organizationId, scopeWhere, input.id, appScopeWhere);
    }),

  create: permissionProcedure('candidate', 'create')
    .input(candidateCreateInput)
    .mutation(({ ctx, input }) => candidateService.create(ctx.user.organizationId, ctx.user.id, input)),

  update: permissionProcedure('candidate', 'update')
    .input(candidateCreateInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await assertScoped('candidate', id, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.update(ctx.user.organizationId, id, data);
    }),

  search: permissionProcedure('candidate', 'read')
    .input(z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      return candidateService.search(ctx.user.organizationId, scopeWhere, input.query, input.limit);
    }),

  getDashboardKpis: permissionProcedure('candidate', 'read')
    .query(async ({ ctx }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      // Codex F4: the active-application KPI carries the application fragment.
      const appScopeWhere = await scopeWhereFor('application', ctx.access, ctx.user.id);
      return candidateService.getDashboardKpis(ctx.user.organizationId, scopeWhere, appScopeWhere);
    }),
});
