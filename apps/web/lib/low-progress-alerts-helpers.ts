// Pure derivation helpers for the Performance "low-progress alerts" panel
// (Sprint 1.4 Task 2 — wiring `performance.getLowProgressAlerts` into the UI).
// Extracted from the panel component so the severity/day-math logic is
// independently unit-testable per this repo's test convention (JSX wiring
// itself is verified by live click-through, not unit tests).

export type AlertSeverity = 'critical' | 'warning';

/**
 * OKRs already come pre-filtered server-side to `progress < threshold`. Within
 * that set, anything under half the threshold is flagged critical (more severe
 * shortfall); the rest is a warning.
 */
export function getOkrProgressSeverity(progress: number, threshold: number): AlertSeverity {
  return progress < threshold / 2 ? 'critical' : 'warning';
}

/** Whole days between `dueDate` and `now` (0 if not yet overdue). */
export function getDaysOverdue(dueDate: string | Date, now: Date = new Date()): number {
  const due = new Date(dueDate);
  const diffMs = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/** Commitments overdue more than a week are critical; more recently overdue is a warning. */
export function getCommitmentSeverity(dueDate: string | Date, now: Date = new Date()): AlertSeverity {
  return getDaysOverdue(dueDate, now) > 7 ? 'critical' : 'warning';
}
