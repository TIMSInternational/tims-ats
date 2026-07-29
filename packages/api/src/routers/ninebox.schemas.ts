import { z } from 'zod';

// ── Grid ─────────────────────────────────────────────────────────────

export const getAxisBreakdownInput = z.object({
  userId: z.string().uuid(),
  period: z.string().max(100),
});

export const getMovementHistoryInput = z.object({
  userId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

export const simulateInput = z.object({
  userId: z.string().uuid(),
  newPotentialScore: z.number().min(0).max(100),
  newPerformanceScore: z.number().min(0).max(100),
});

// ── Calibration ──────────────────────────────────────────────────────

export const submitCalibrationVoteInput = z.object({
  sessionId: z.string().uuid(),
  evaluatedUserId: z.string().uuid(),
  quadrant: z.string().max(100),
  justification: z.string().max(20000).optional(),
});

export const finalizeCalibrationInput = z.object({ sessionId: z.string().uuid() });

// ── Plans & Analytics ────────────────────────────────────────────────

export const getQuadrantPlanInput = z.object({ quadrant: z.string().max(100) });
