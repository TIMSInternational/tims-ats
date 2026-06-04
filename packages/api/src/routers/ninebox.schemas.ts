import { z } from 'zod';

// ── Grid ─────────────────────────────────────────────────────────────

export const getGridInput = z.object({
  period: z.string(),
  companyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export const getEmployeeDetailInput = z.object({
  userId: z.string().uuid(),
  period: z.string(),
});

export const getAxisBreakdownInput = z.object({
  userId: z.string().uuid(),
  period: z.string(),
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

export const createCalibrationInput = z.object({
  period: z.string(),
  scheduledAt: z.string().datetime().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

export const getCalibrationInput = z.object({ id: z.string().uuid() });

export const submitCalibrationVoteInput = z.object({
  sessionId: z.string().uuid(),
  evaluatedUserId: z.string().uuid(),
  quadrant: z.string(),
  justification: z.string().optional(),
});

export const finalizeCalibrationInput = z.object({ sessionId: z.string().uuid() });

// ── Plans & Analytics ────────────────────────────────────────────────

export const getQuadrantPlanInput = z.object({ quadrant: z.string() });

export const getBenchStrengthInput = z.object({ period: z.string() });

// ── Dashboard KPIs ───────────────────────────────────────────────────

export const getDashboardKpisInput = z.object({ period: z.string() });
