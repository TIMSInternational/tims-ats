/**
 * Pure, synchronous optimistic move for the recruitment pipeline board.
 *
 * Relocates an application card to another stage and keeps each stage's `count`
 * badge in sync. Structural over the board shape (it only reads id / count /
 * applications), so it works with the real `PipelineBoardData` and with test
 * fixtures without casts. Returns the board unchanged when the card isn't found
 * or is already in the destination (same-stage drop is a no-op).
 *
 * Applied on drop via the moveCandidate mutation's `onMutate` so the card
 * commits to its new column immediately instead of snapping back and waiting
 * for the server refetch.
 */
export function moveApplicationOptimistic<
  App extends { id: string },
  Stage extends { id: string; count: number; applications: App[] },
  Board extends { stages: Stage[] },
>(board: Board, applicationId: string, toStageId: string): Board {
  const source = board.stages.find((stage) =>
    stage.applications.some((app) => app.id === applicationId),
  );
  if (!source || source.id === toStageId) return board;

  // Destination must exist before we detach the card from its source stage —
  // otherwise a stale/deleted toStageId would remove the card from every column.
  if (!board.stages.some((stage) => stage.id === toStageId)) return board;

  const moved = source.applications.find((app) => app.id === applicationId);
  if (!moved) return board;

  return {
    ...board,
    stages: board.stages.map((stage) => {
      if (stage.id === source.id) {
        const applications = stage.applications.filter((app) => app.id !== applicationId);
        return { ...stage, applications, count: applications.length };
      }
      if (stage.id === toStageId) {
        const applications = [...stage.applications, moved];
        return { ...stage, applications, count: applications.length };
      }
      return stage;
    }),
  } as Board;
}
