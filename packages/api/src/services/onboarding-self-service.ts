// Self-service write policy for OWN-scoped onboarding callers.
//
// Why this exists: the `employee` role holds onboarding read+update at scope
// `own` (seed-access-matrix.ts), and the own-scope fragment for onboardingPlan
// deliberately includes `buddyId` (entity-policies.ts) so a buddy can SEE the
// plan they support. `assertScoped` therefore proves only that the caller may
// reach the plan — not that they may change it. Without this policy a new hire
// (or their buddy) could mark HR/IT/manager tasks done, rewrite any task's
// title/responsible/dueDate/phase/order, edit the plan itself, and complete
// check-ins that HR runs — the "only your own tasks" rule lived in the UI only.
//
// Rule for an `own` caller (team/unit/company/organization callers are the
// people who run onboarding and are unaffected):
//   - updateTask: ONLY `{ completed }` may be sent, and only on a task the
//     caller owns on that plan:
//       * the new hire (plan.userId === caller) → tasks with responsible 'employee'
//       * the plan's buddy (plan.buddyId === caller) → tasks with responsible 'buddy'
//     The buddy arm is deliberate: the default checklist has a buddy-owned task
//     ("Presentación con el buddy asignado", onboarding-defaults.ts), and the
//     buddy is exactly the person who can truthfully say it happened. A buddy
//     can never touch the hire's own tasks, and neither can touch hr/it/manager.
//   - updatePlan, completeCheckIn: never (plan management and check-ins are run
//     by HR / the manager).
//
// Pure functions returning a decision; the router maps a denial to FORBIDDEN
// (services never import tRPC types).

import { NEW_HIRE_TASK_OWNER_SLUG, BUDDY_TASK_OWNER_SLUG } from './onboarding-defaults';

export type OwnScopeTaskUpdateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'fields' | 'no_change' | 'not_owner' };

export interface OwnScopeTaskUpdateArgs {
  callerId: string;
  plan: { userId: string; buddyId: string | null };
  task: { responsible: string };
  completed: boolean | undefined;
  /** Every non-`id`, non-`completed` input key whose value was actually sent (not undefined). */
  otherFieldsSent: readonly string[];
}

export function ownScopeTaskUpdateDecision(args: OwnScopeTaskUpdateArgs): OwnScopeTaskUpdateDecision {
  if (args.otherFieldsSent.length > 0) return { allowed: false, reason: 'fields' };
  if (args.completed === undefined) return { allowed: false, reason: 'no_change' };

  const isHire = args.plan.userId === args.callerId;
  const isBuddy = args.plan.buddyId !== null && args.plan.buddyId === args.callerId;

  if (isHire && args.task.responsible === NEW_HIRE_TASK_OWNER_SLUG) return { allowed: true };
  if (isBuddy && args.task.responsible === BUDDY_TASK_OWNER_SLUG) return { allowed: true };
  return { allowed: false, reason: 'not_owner' };
}

/** Keys of an update input (minus the listed ones) whose value is not undefined. `null` counts as sent. */
export function sentKeys(input: Record<string, unknown>, exclude: readonly string[]): string[] {
  return Object.keys(input).filter((key) => !exclude.includes(key) && input[key] !== undefined);
}
