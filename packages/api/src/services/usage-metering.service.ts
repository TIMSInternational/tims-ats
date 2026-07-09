import { getModuleUsageQuantity } from '../repositories/entitlement.repository';

// The only two metered modules with a real usage source today (Slice 2b).
// video_interviews / proctoring have no usage source and are intentionally absent.
export const METERED_MODULE_USAGE: Record<
  string,
  { agentSlugs: string[]; unit: string; aggregate: 'count' | 'durationMinutes' }
> = {
  ai_voice_interview: { agentSlugs: ['ai-voice-interview'], unit: 'minutes', aggregate: 'durationMinutes' },
  // One screening = one candidate-screener invocation; cv-parser (CV parsing) is
  // intentionally excluded to avoid double-counting.
  ai_screening: { agentSlugs: ['candidate-screener'], unit: 'screenings', aggregate: 'count' },
};

export async function getModuleUsage(
  orgId: string,
  moduleCode: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ quantity: number; unit: string } | null> {
  const desc = METERED_MODULE_USAGE[moduleCode];
  if (!desc) return null;
  const quantity = await getModuleUsageQuantity(orgId, desc.agentSlugs, desc.aggregate, periodStart, periodEnd);
  return { quantity, unit: desc.unit };
}
