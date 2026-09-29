import type { Prisma } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { proctoringRepo } from '../repositories/proctoring.repository';

// Default off. Existing assessment types are never silently monitored.
export function isProctoringRequired(config: Prisma.JsonValue | null | undefined): boolean {
  return config !== null && typeof config === 'object' && !Array.isArray(config) &&
    config?.proctoringEnabled === true;
}

// Assessment assignment still runs in the existing TS domain until its .NET
// cutover. It reads the C#-managed type policy and snapshots that policy on a
// new assignment; all proctoring session/event/review writes live in .NET 10.
export async function policyForNewAssignment(
  organizationId: string,
  config: Prisma.JsonValue | null,
): Promise<boolean> {
  const required = isProctoringRequired(config);
  if (required && !(await proctoringRepo.hasEntitlement(organizationId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'entitlement_missing:proctoring' });
  }
  return required;
}
