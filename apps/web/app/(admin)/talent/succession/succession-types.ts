export interface Successor {
  id: string;
  readiness: string;
  type: string;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

export interface CriticalRole {
  id: string;
  title: string;
  criticality: string;
  flightRisk?: number | null;
  targetBandLevel?: string | null;
  currentHolder?: {
    id: string;
    firstName: string;
    lastName: string;
    avatar?: string | null;
    jobTitle?: string | null;
  } | null;
  successors: Successor[];
}

export interface SalaryBandOption {
  level: string;
  title?: string | null;
}

export interface CompGapAlert {
  successorId: string;
  roleId: string;
  userId: string;
  currentSalary: number;
  currency: string;
  midSalary: number;
  bandLevel: string;
  gapPercent: number;
}

export interface AdjustmentTarget {
  userId: string;
  employeeName: string;
  previousSalary: number;
  suggestedNewSalary: number;
}

/** Readiness value → the label key in t.succession (developing is "En desarrollo", never "Externo"). */
export const READINESS_LABEL_KEY = {
  ready_now: 'readinessReadyNow',
  ready_1_year: 'readinessReady1',
  ready_2_years: 'readinessReady2',
  developing: 'readinessDeveloping',
} as const;

export function readinessKey(readiness: string): (typeof READINESS_LABEL_KEY)[keyof typeof READINESS_LABEL_KEY] {
  return READINESS_LABEL_KEY[readiness as keyof typeof READINESS_LABEL_KEY] ?? 'readinessDeveloping';
}
