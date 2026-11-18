import type { StatusTone } from '../../../../components';

/** The grid's evaluation shape (C# nine-box reads). */
export interface NineBoxEvaluation {
  id: string;
  potentialScore: number;
  performanceScore: number;
  quadrant: string;
  confidence: number;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

export type QuadrantKey =
  | 'star'
  | 'high_potential'
  | 'enigma'
  | 'solid_performer'
  | 'consistent_performer'
  | 'core_player'
  | 'inconsistent'
  | 'workhouse'
  | 'underperformer'
  | 'risk';

/** Grid cell "potential-performance" → quadrant (mirrors @tims/shared quadrantToGrid). */
export const CELL_QUADRANT: Record<string, QuadrantKey> = {
  '3-3': 'star',
  '3-2': 'high_potential',
  '3-1': 'enigma',
  '2-3': 'solid_performer',
  '2-2': 'core_player',
  '2-1': 'inconsistent',
  '1-3': 'workhouse',
  '1-2': 'underperformer',
  '1-1': 'risk',
};

/** Chip tone per quadrant (foundation-spec.md §12): a word plus a tone, never colour alone. */
export const QUADRANT_TONE: Record<QuadrantKey, StatusTone> = {
  star: 'success',
  high_potential: 'success',
  enigma: 'warning',
  solid_performer: 'info',
  consistent_performer: 'info',
  core_player: 'brand',
  inconsistent: 'warning',
  workhouse: 'neutral',
  underperformer: 'danger',
  risk: 'danger',
};

/**
 * Cell fill: a navy-tint ramp by how strong the cell is (potential + performance), with danger-bg kept for
 * the low/low cell only. Text on every fill is text-primary (≥ 6:1).
 */
export function cellFill(potential: number, performance: number): string {
  const sum = potential + performance;
  if (sum <= 2) return 'bg-danger-bg';
  if (sum === 3) return 'bg-brand/5';
  if (sum === 4) return 'bg-brand/10';
  if (sum === 5) return 'bg-brand/20';
  return 'bg-brand/30';
}

export function isQuadrantKey(value: string): value is QuadrantKey {
  return value in QUADRANT_TONE;
}

/** Potential/performance scores (0-5 or 0-100) → % position in the grid, clamped so dots stay inside. */
export function toPercent(score: number): number {
  const normalized = score <= 5 ? (score / 5) * 100 : score;
  return Math.max(5, Math.min(95, normalized));
}
