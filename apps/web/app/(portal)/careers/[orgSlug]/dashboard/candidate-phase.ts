// Candidates never see a vacancy's internal pipeline stage names ("Screening", "Prueba Tecnica",
// "Entrevista RRHH"…): those are the recruiting team's working labels, tenant-editable, often English
// or unaccented, and "Prueba" suggests assessments the candidate may never take. The portal shows one
// of a few candidate-facing phases instead, derived from the stage name and the application status.

export type CandidatePhase = 'review' | 'interviews' | 'offer' | 'hired' | 'closed';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Hired / closed come ONLY from the application status: a stage name never announces a selection
// ("No contratado" and "Entrevista de contratación" are stage names too), so an active application in
// a hiring-like stage stays in its neutral phase until the hire is actually recorded.
export function candidatePhase(stageName: string | null | undefined, status: string): CandidatePhase {
  if (status === 'hired') return 'hired';
  if (status === 'rejected' || status === 'withdrawn') return 'closed';
  const name = normalize(stageName ?? '');
  // A negated outcome ("No contratado", "Oferta no aceptada") is never read as that outcome.
  if (/\bno\s+(contratad|seleccionad|aceptad|apt[oa]|continua)/.test(name)) return 'review';
  if (/\b(oferta|offer)/.test(name)) return 'offer';
  if (/\b(entrevista|interview|panel|comite)/.test(name)) return 'interviews';
  return 'review';
}

/**
 * One entry per run of consecutive moves that land in the same phase, keeping the FIRST item of each
 * run — pass the moves oldest-first so that item is when the phase began.
 */
export function collapseToPhases<T>(
  items: readonly T[],
  phaseOf: (item: T) => CandidatePhase,
): Array<{ phase: CandidatePhase; item: T }> {
  const out: Array<{ phase: CandidatePhase; item: T }> = [];
  for (const item of items) {
    const phase = phaseOf(item);
    if (out.at(-1)?.phase !== phase) out.push({ phase, item });
  }
  return out;
}

export interface PhaseLabels {
  phaseReview: string;
  phaseReviewDesc: string;
  phaseInterviews: string;
  phaseInterviewsDesc: string;
  phaseOffer: string;
  phaseOfferDesc: string;
  phaseHired: string;
  phaseHiredDesc: string;
  phaseClosed: string;
  phaseClosedDesc: string;
}

export function phaseText(phase: CandidatePhase, labels: PhaseLabels): { label: string; description: string } {
  switch (phase) {
    case 'interviews':
      return { label: labels.phaseInterviews, description: labels.phaseInterviewsDesc };
    case 'offer':
      return { label: labels.phaseOffer, description: labels.phaseOfferDesc };
    case 'hired':
      return { label: labels.phaseHired, description: labels.phaseHiredDesc };
    case 'closed':
      return { label: labels.phaseClosed, description: labels.phaseClosedDesc };
    default:
      return { label: labels.phaseReview, description: labels.phaseReviewDesc };
  }
}
