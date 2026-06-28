// apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts
// Pure decision: has the call reached its duration cap and should auto-end?
// A null/non-positive cap means "no cap" (never auto-end client-side; the EL
// agent's global 900s cap remains the backstop).

export function shouldAutoEnd(elapsedSeconds: number, maxDurationSeconds: number | null): boolean {
  if (maxDurationSeconds === null || maxDurationSeconds <= 0) return false;
  return elapsedSeconds >= maxDurationSeconds;
}
