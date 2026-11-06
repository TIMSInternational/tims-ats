// The "Proceso" card's steps, built from the vacancy's REAL stages and the application's movement history
// (A-03) — never a hard-coded "Postulada / Preselección / Evaluaciones / … / Contratación" list with steps
// ticked by order number. Pure module, node-testable.

export interface StageStepStage {
  id: string;
  name: string;
  order: number;
}

export interface StageStepMovement {
  movedAt: Date | string;
  fromStage: { id: string } | null;
  toStage: { id: string };
}

export interface StageStepApplication {
  appliedAt: Date | string;
  currentStage: { id: string };
}

export interface StageStep {
  id: string;
  name: string;
  /** reached: the application was in this stage; current: it is (or ended) here; pending: never reached. */
  state: 'reached' | 'current' | 'pending';
  /** When the application entered the stage (the application date for the stage it started in). */
  enteredAt: Date | string | null;
}

export function buildStageSteps(
  stages: readonly StageStepStage[],
  movements: readonly StageStepMovement[],
  application: StageStepApplication,
): StageStep[] {
  const ordered = [...movements].sort((a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime());
  // The stage the application started in: where its first move left from, or where it still is.
  const startStageId = ordered[0]?.fromStage?.id ?? application.currentStage.id;
  const enteredAt = new Map<string, Date | string>();
  enteredAt.set(startStageId, application.appliedAt);
  for (const move of ordered) enteredAt.set(move.toStage.id, move.movedAt); // last entry wins (re-entries)

  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const isCurrent = stage.id === application.currentStage.id;
      const reached = isCurrent || enteredAt.has(stage.id);
      return {
        id: stage.id,
        name: stage.name,
        state: isCurrent ? 'current' : reached ? 'reached' : 'pending',
        enteredAt: enteredAt.get(stage.id) ?? null,
      };
    });
}
