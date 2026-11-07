import { TRPCError } from '@trpc/server';
import { filterStaffRoleSlugs } from '@tims/shared';
import { buildAccessForUser } from '../access';
import { interviewEvaluatorRepository, type EvaluatorCandidate } from '../repositories/interview-evaluator.repository';

// Who may sit on an interview panel: someone who can ACT on it. The invitation email carries the room link,
// and the room reads the interview (interview.getById / getVideoToken: interview:read), while the scorecard
// and the call are interview.submitScorecard / createVideoRoom (interview:create). An evaluator holding
// neither (a Colaborador: the employee role has only onboarding/performance grants) used to be accepted,
// got the email and then FORBIDDEN in the room. Any scope is enough: the interview's panel arm
// (access/entity-policies.ts) lets an assigned evaluator see it at every narrow scope.
// The C# picker lists the same people (AssignablePurposes.RuleFor(InterviewEvaluator): interview:create AND
// interview:read); this is the server-side refusal for anything that bypasses the picker.

export const EVALUATOR_REQUIRED_PERMISSIONS = [
  ['interview', 'read'],
  ['interview', 'create'],
] as const;

/** True when this organization user's session would hold every permission an evaluator needs. */
export async function canActAsEvaluator(organizationId: string, candidate: EvaluatorCandidate): Promise<boolean> {
  if (!candidate.isActive) return false;
  // The roles a session of theirs would carry (apps/web/app/api/trpc/[trpc]/route.ts): staff slugs only.
  const roles = filterStaffRoleSlugs(candidate.roleSlugs);
  if (roles.length === 0) return false;
  for (const [module, action] of EVALUATOR_REQUIRED_PERMISSIONS) {
    const access = await buildAccessForUser(
      { id: candidate.id, organizationId, roles, isPlatformOwner: false },
      module,
      action,
    );
    if (!access.allowed) return false;
  }
  return true;
}

function joinNames(people: readonly EvaluatorCandidate[]): string {
  const names = people.map((p) => `${p.firstName} ${p.lastName}`.trim() || p.id);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** The staff-facing refusal (tú): who cannot act, and what to do about it. */
export function evaluatorsCannotActMessage(
  people: readonly EvaluatorCandidate[],
  when: 'schedule' | 'reschedule',
): string {
  const plural = people.length > 1;
  const who = `${joinNames(people)} ${plural ? 'no pueden' : 'no puede'} abrir la sala de entrevista ni enviar el scorecard (${plural ? 'usuarios inactivos o sin acceso' : 'usuario inactivo o sin acceso'} a entrevistas).`;
  return when === 'reschedule'
    ? `No se puede reprogramar: ${who} ${plural ? 'Quítalos' : 'Quítalo'} del panel o pide a un administrador que revise su rol.`
    : `${who} Elige otro evaluador o pide a un administrador que le asigne un rol con acceso a entrevistas.`;
}

/**
 * Refuses a panel with anyone who is not a user of this organization (NOT_FOUND, as before) or who cannot open
 * the room and submit a scorecard (BAD_REQUEST naming them). Duplicates are checked once.
 */
export async function assertEvaluatorsCanAct(
  organizationId: string,
  userIds: readonly string[],
  when: 'schedule' | 'reschedule' = 'schedule',
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const candidates = await interviewEvaluatorRepository.findCandidates(organizationId, unique);
  if (candidates.length !== unique.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluador no encontrado en esta organización' });
  }
  await refuseWhoCannotAct(organizationId, candidates, when);
}

async function refuseWhoCannotAct(
  organizationId: string,
  candidates: readonly EvaluatorCandidate[],
  when: 'schedule' | 'reschedule',
): Promise<void> {
  const cannotAct: EvaluatorCandidate[] = [];
  for (const candidate of candidates) {
    if (!(await canActAsEvaluator(organizationId, candidate))) cannotAct.push(candidate);
  }
  if (cannotAct.length > 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: evaluatorsCannotActMessage(cannotAct, when) });
  }
}

/** Reschedule re-sends the invitation (and the room link) to the whole panel: refuse while it holds someone who cannot act. */
export async function assertPanelCanAct(organizationId: string, interviewId: string): Promise<void> {
  const panel = await interviewEvaluatorRepository.findPanelUserIds(organizationId, interviewId);
  if (panel.length === 0) return;
  await refuseWhoCannotAct(organizationId, await interviewEvaluatorRepository.findCandidates(organizationId, panel), 'reschedule');
}
