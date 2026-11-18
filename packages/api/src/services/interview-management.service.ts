import { TRPCError } from '@trpc/server';
import type { Prisma } from '@tims/db';
import { assertScoped, scopeWhereFor, type AccessContext } from '../access';
import { interviewManageRepository } from '../repositories/interview-manage.repository';

// ---------------------------------------------------------------------------
// Who may MANAGE an interview (reschedule, cancel, add or remove panel members)
// ---------------------------------------------------------------------------
// Seeing an interview and running it are different rights. The interview scope (entity-policies.ts)
// has a panel arm — an assigned evaluator sees the interview whatever its vacancy — so a committee
// member holding interview:update could cancel the interview or take other panelists off it. Managing
// therefore needs BOTH the interview scope AND the vacancy scope: at a narrow scope (team/unit/own) the
// interview's vacancy must be one the caller manages. Organization/company scope is unchanged.

const ORG_WIDE: ReadonlySet<string> = new Set(['organization', 'company']);

export async function assertInterviewManageable(
  access: AccessContext,
  userId: string,
  orgId: string,
  interviewId: string,
): Promise<void> {
  await assertScoped('interview', interviewId, access, userId, orgId);
  if (ORG_WIDE.has(access.scope)) return;
  const vacancyWhere = (await scopeWhereFor('vacancy', access, userId)) as Prisma.VacancyWhereInput;
  if (!(await interviewManageRepository.existsOnVacancy(orgId, interviewId, vacancyWhere))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Solo quien gestiona la vacante puede modificar esta entrevista o su panel',
    });
  }
}
