// "N días en etapa" on the pipeline card, list and table (A-23): the card used to count days since the
// application while the "Días en etapa" filter and the SLA badge measured time in the CURRENT stage, so a
// candidate who applied a month ago but moved yesterday looked stale. Pure module, node-testable.

const DAY_MS = 86_400_000;

/** Whole days elapsed since `date` (never negative); 0 for an unparseable value. */
export function wholeDaysSince(date: Date | string, now: number = Date.now()): number {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

export interface DaysInStageLabels {
  inStageToday: string;
  inStageOneDay: string;
  inStageDays: string;
}

export function daysInStageLabel(
  enteredStageAt: Date | string,
  labels: DaysInStageLabels,
  now: number = Date.now(),
): string {
  const days = wholeDaysSince(enteredStageAt, now);
  if (days === 0) return labels.inStageToday;
  if (days === 1) return labels.inStageOneDay;
  return labels.inStageDays.replace('{n}', String(days));
}
