// Pure nine-box shaping kernels + the shared quadrant maps (Phase-5 nine-box strangler, Slice 10).
// Moved here from packages/api/src/routers/ninebox.helpers.ts so BOTH stacks consumed ONE definition,
// golden-fixtured against contracts/ninebox-fixtures/.
// No DB, no I/O, no clock. Rounding uses JS Math.round (half-up) — mirror with ReportingMath.JsRound in C#.
//
// UPDATE 2026-08-05 (#57): the TS nine-box router is DELETED, so no TypeScript runtime code imports
// these kernels any more — the only remaining importer is tests/ninebox/kernels-fixtures.test.ts.
// They are NOT dead code and must not be deleted as such: that test is what pins
// contracts/ninebox-fixtures/ as the golden contract the C# port (Tims.Domain.NineBox) is asserted
// against. Deleting this module silently drops the C#-side contract with it.

// Map quadrant names to grid keys (potential-performance).
export const quadrantToGrid: Record<string, string> = {
  star: '3-3',
  high_potential: '3-2',
  enigma: '3-1',
  solid_performer: '2-3',
  consistent_performer: '2-3',
  core_player: '2-2',
  inconsistent: '2-1',
  workhouse: '1-3',
  underperformer: '1-2',
  risk: '1-1',
};

// Quadrant lookup by potential/performance band (simulate).
export const simulateQuadrantMap: Record<string, Record<string, string>> = {
  high: { high: 'star', medium: 'high_potential', low: 'enigma' },
  medium: { high: 'solid_performer', medium: 'core_player', low: 'inconsistent' },
  low: { high: 'workhouse', medium: 'underperformer', low: 'risk' },
};

// Standard development plans per quadrant.
export const quadrantPlans: Record<string, { title: string; actions: string[] }> = {
  star: {
    title: 'Retener y Acelerar',
    actions: ['Asignar proyectos de alta visibilidad', 'Incluir en plan de sucesion', 'Ofrecer mentoria ejecutiva'],
  },
  high_potential: {
    title: 'Desarrollar Rendimiento',
    actions: ['Establecer metas desafiantes', 'Asignar coaching de desempeno', 'Rotacion de roles'],
  },
  enigma: {
    title: 'Evaluar y Orientar',
    actions: ['Asignar mentor', 'Revisar encaje de rol', 'Establecer metas a corto plazo'],
  },
  solid_performer: {
    title: 'Reconocer y Desarrollar',
    actions: ['Reconocimiento publico', 'Plan de capacitacion en liderazgo', 'Proyectos cross-funcionales'],
  },
  core_player: {
    title: 'Motivar y Crecer',
    actions: ['Feedback regular', 'Capacitacion tecnica', 'Metas de estiramiento'],
  },
  inconsistent: {
    title: 'Diagnosticar y Apoyar',
    actions: ['Identificar barreras', 'Plan de mejora con seguimiento', 'Evaluar motivacion'],
  },
  workhouse: {
    title: 'Valorar Consistencia',
    actions: ['Reconocer contribuciones', 'Evaluar interes en crecimiento', 'Capacitacion selectiva'],
  },
  underperformer: {
    title: 'Plan de Mejora',
    actions: ['Plan de mejora formal (PIP)', 'Coaching intensivo', 'Revision en 90 dias'],
  },
  risk: {
    title: 'Accion Inmediata',
    actions: ['Conversacion de retroalimentacion directa', 'PIP con plazos estrictos', 'Evaluar reubicacion o salida'],
  },
};

// ── Pure kernels ────────────────────────────────────────────────────────────

export interface SimulateBandsResult {
  simulatedQuadrant: string;
  potentialBand: string;
  performanceBand: string;
}

/** simulate (read #5): band thresholds ≥67 high / ≥34 medium / else low → simulateQuadrantMap. */
export function simulateBands(newPotentialScore: number, newPerformanceScore: number): SimulateBandsResult {
  const potentialBand = newPotentialScore >= 67 ? 'high' : newPotentialScore >= 34 ? 'medium' : 'low';
  const performanceBand = newPerformanceScore >= 67 ? 'high' : newPerformanceScore >= 34 ? 'medium' : 'low';
  return {
    simulatedQuadrant: simulateQuadrantMap[potentialBand][performanceBand],
    potentialBand,
    performanceBand,
  };
}

export interface QuadrantPlanResult {
  title: string;
  actions: string[];
}

/** getQuadrantPlan (read #9): catalog lookup with the fixed fallback. */
export function resolveQuadrantPlan(quadrant: string): QuadrantPlanResult {
  return quadrantPlans[quadrant] ?? { title: 'Sin plan definido', actions: [] };
}

export interface BenchStrengthResult {
  total: number;
  distribution: Record<string, number>;
  highPotentialRatio: number;
  benchStrength: number;
}

/**
 * getBenchStrength (read #10): quadrant distribution + highPotentialCount (star+high_potential+enigma) +
 * highPotentialRatio = JS-half-up round of the percentage (0 when total 0). The router adds `period`.
 */
export function buildBenchStrength(quadrants: string[]): BenchStrengthResult {
  const distribution = buildQuadrantDistribution(quadrants);
  const total = quadrants.length;
  const highPotentialCount =
    (distribution['star'] ?? 0) + (distribution['high_potential'] ?? 0) + (distribution['enigma'] ?? 0);
  return {
    total,
    distribution,
    highPotentialRatio: total > 0 ? Math.round((highPotentialCount / total) * 100) : 0,
    benchStrength: highPotentialCount,
  };
}

/** getDashboardKpis (read #11) distribution: quadrant→count in first-seen order (object key insertion). */
export function buildQuadrantDistribution(quadrants: string[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const q of quadrants) {
    distribution[q] = (distribution[q] ?? 0) + 1;
  }
  return distribution;
}

/**
 * gridPlacement (read #1): group items by `quadrantToGrid[quadrant] ?? quadrant`, PRESERVING the input
 * order within each key AND the first-seen key insertion order. Generic over the item type — the router
 * feeds full evaluations (with the user include); the golden fixture feeds `{ id, quadrant }` items. The
 * quadrant is read through `quadrantOf` so the caller decides the field; the grid-key mapping (incl. the
 * "several quadrants → one cell", e.g. solid_performer + consistent_performer → 2-3, and the fallback to the
 * raw quadrant for an unmapped value) lives HERE so both stacks share it.
 */
export function gridPlacement<T>(items: T[], quadrantOf: (item: T) => string): Record<string, T[]> {
  const grid: Record<string, T[]> = {};
  for (const item of items) {
    const q = quadrantOf(item);
    const key = quadrantToGrid[q] ?? q;
    if (!grid[key]) {
      grid[key] = [];
    }
    grid[key].push(item);
  }
  return grid;
}

/** A single nine-box quadrant transition (read #4): from → to for one employee. */
export interface QuadrantMovement {
  userId: string;
  userName: string;
  from: { period: string; quadrant: string };
  to: { period: string; quadrant: string };
}

/** computeMovements input row: the evaluation scalars the movement computation needs (name split for userName). */
export interface MovementEvalInput {
  userId: string;
  firstName: string;
  lastName: string;
  period: string;
  quadrant: string;
}

/**
 * computeMovements (read #4): the input rows are PRE-ORDERED (userId asc, evaluatedAt asc). Group by user
 * (first-seen user order preserved) and emit a movement for EACH consecutive quadrant CHANGE
 * (`prev.quadrant !== curr.quadrant`) — no movement when a quadrant repeats. `userName` = `firstName lastName`.
 * The "only-on-change" rule + the ordering are the two invariants the golden fixture + integration bite pin.
 */
export function computeMovements(evaluations: MovementEvalInput[]): QuadrantMovement[] {
  const movements: QuadrantMovement[] = [];

  const byUser = new Map<string, MovementEvalInput[]>();
  for (const ev of evaluations) {
    const list = byUser.get(ev.userId) ?? [];
    list.push(ev);
    byUser.set(ev.userId, list);
  }

  for (const [, userEvals] of byUser) {
    for (let i = 1; i < userEvals.length; i++) {
      const prev = userEvals[i - 1];
      const curr = userEvals[i];
      if (prev.quadrant !== curr.quadrant) {
        movements.push({
          userId: curr.userId,
          userName: `${curr.firstName} ${curr.lastName}`,
          from: { period: prev.period, quadrant: prev.quadrant },
          to: { period: curr.period, quadrant: curr.quadrant },
        });
      }
    }
  }

  return movements;
}
