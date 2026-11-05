import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { assertScoped } from '../../access';
import { assertVacancyUpdatePlacement } from './org-placement';
import { salarySchema, settingsSchema } from './crud';
import {
  vacancyLifecycleRepository,
  type VacancyLifecycleActor,
} from '../../repositories/vacancy-lifecycle.repository';

// Vacancy edit ("Editar" drawer), freeze ("Congelar") and resume ("Reanudar"). Data access lives in
// vacancy-lifecycle.repository.ts; every write is a status compare-and-set with its audit row in one
// transaction. Pilot launch-spine fix under owner decision D-1 (audit A-08, recruiter journeys-23,
// company-admin spec-39); owed a C# port with the rest of the vacancy spine.

const updateVacancyInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  companyId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  positions: z.number().int().min(1).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  salary: salarySchema,
  contractType: z.string().max(100).nullish(),
  location: z.string().max(200).nullish(),
  remotePolicy: z.enum(['onsite', 'remote', 'hybrid']).nullish(),
  assignedTo: z.string().uuid().nullish(),
  settings: settingsSchema,
});

const NOT_EDITABLE_MESSAGE =
  'Esta vacante no se puede editar en su estado actual. Si está pendiente de aprobación, retira la solicitud primero; una vacante cerrada no se edita.';
const NOT_FREEZABLE_MESSAGE = 'Solo se puede congelar una vacante publicada.';
const NOT_FROZEN_MESSAGE = 'La vacante ya no está congelada; recarga la página.';
const NOT_RESUMABLE_MESSAGE = 'Esta vacante se cerró antes de congelarse y no se puede reanudar. Duplícala para abrir un proceso nuevo.';

function actorOf(user: { id: string; impersonatorId?: string | null }): VacancyLifecycleActor {
  return { userId: user.id, actorId: user.impersonatorId ?? user.id };
}

export const vacancyLifecycleRouter = router({
  update: permissionProcedure('vacancy', 'update')
    .input(updateVacancyInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const organizationId = ctx.user.organizationId;

      await assertScoped('vacancy', id, ctx.access, ctx.user.id, organizationId);
      await assertVacancyUpdatePlacement(organizationId, id, data);

      const fields = Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .sort();
      if (fields.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No hay cambios para guardar' });
      }

      const row = await vacancyLifecycleRepository.updateContent(
        organizationId,
        id,
        {
          ...data,
          salary: (data.salary ?? undefined) as Prisma.InputJsonValue | undefined,
          settings: (data.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        fields,
        actorOf(ctx.user),
      );
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: NOT_EDITABLE_MESSAGE });
      return row;
    }),

  freeze: permissionProcedure('vacancy', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const row = await vacancyLifecycleRepository.freeze(ctx.user.organizationId, input.id, actorOf(ctx.user));
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: NOT_FREEZABLE_MESSAGE });
      return row;
    }),

  // A-08: the way back from "Congelar". Gated on vacancy:publish (same as publishing a channel): resuming
  // puts the vacancy back on the careers portal. The repository decides the status it returns to.
  resume: permissionProcedure('vacancy', 'publish')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('vacancy', input.id, ctx.access, ctx.user.id, ctx.user.organizationId);

      const result = await vacancyLifecycleRepository.resume(ctx.user.organizationId, input.id, actorOf(ctx.user));
      if (result.kind === 'not_frozen') throw new TRPCError({ code: 'CONFLICT', message: NOT_FROZEN_MESSAGE });
      if (result.kind === 'not_resumable') throw new TRPCError({ code: 'CONFLICT', message: NOT_RESUMABLE_MESSAGE });
      return result.vacancy;
    }),
});
