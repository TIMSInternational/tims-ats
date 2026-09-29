// Default onboarding checklist seeded into every new OnboardingPlan — both the
// manual HR create path (routers/onboarding.ts create) and the accepted-offer
// hire handoff (routers/offer/lifecycle.ts convertToEmployee). Plain data: there
// is no per-org template model, so this constant is the single source of truth.
//
// `responsible` is the owner role slug (hr | it | manager | buddy | employee —
// "employee" is the new hire; the personal "Mi Onboarding" view lets the hire
// toggle only their own tasks). `dueOffsetDays` is relative to the plan's start
// date; `phase` is derived from it so the two can never disagree.
export const ONBOARDING_TASK_OWNERS = ['hr', 'it', 'manager', 'buddy', 'employee'] as const;
export type OnboardingTaskOwner = (typeof ONBOARDING_TASK_OWNERS)[number];

type DefaultOnboardingTask = {
  readonly title: string;
  readonly responsible: OnboardingTaskOwner;
  readonly dueOffsetDays: number;
};

export const DEFAULT_ONBOARDING_TASKS: readonly DefaultOnboardingTask[] = [
  { title: 'Firmar contrato y documentos de ingreso', responsible: 'hr', dueOffsetDays: -3 },
  { title: 'Preparar equipo y accesos de TI (laptop, correo, sistemas)', responsible: 'it', dueOffsetDays: -1 },
  { title: 'Bienvenida del primer día y recorrido por la empresa', responsible: 'hr', dueOffsetDays: 0 },
  { title: 'Presentación con el buddy asignado', responsible: 'buddy', dueOffsetDays: 0 },
  { title: 'Leer y aceptar las políticas de la empresa', responsible: 'employee', dueOffsetDays: 2 },
  { title: 'Reunión 1:1 de bienvenida con el manager', responsible: 'manager', dueOffsetDays: 2 },
  { title: 'Inscripción en nómina y beneficios', responsible: 'employee', dueOffsetDays: 5 },
  { title: 'Presentación con el equipo', responsible: 'manager', dueOffsetDays: 5 },
  { title: 'Definir objetivos de 30/60/90 días', responsible: 'manager', dueOffsetDays: 7 },
  { title: 'Revisión de objetivos de 30 días', responsible: 'manager', dueOffsetDays: 30 },
  { title: 'Revisión de objetivos de 60 días', responsible: 'manager', dueOffsetDays: 60 },
  { title: 'Revisión de objetivos de 90 días y cierre del onboarding', responsible: 'hr', dueOffsetDays: 90 },
];

export function onboardingPhaseForOffset(dueOffsetDays: number): 'day1_30' | 'day31_60' | 'day61_90' {
  if (dueOffsetDays <= 30) return 'day1_30';
  if (dueOffsetDays <= 60) return 'day31_60';
  return 'day61_90';
}

function addUtcDays(startDate: Date, days: number): Date {
  const date = new Date(startDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

/** Nested-create rows for the default checklist; organizationId is explicit on every row. */
export function defaultOnboardingTasks(startDate: Date, organizationId: string) {
  return DEFAULT_ONBOARDING_TASKS.map((task, order) => ({
    organizationId,
    title: task.title,
    responsible: task.responsible,
    phase: onboardingPhaseForOffset(task.dueOffsetDays),
    dueDate: addUtcDays(startDate, task.dueOffsetDays),
    order,
  }));
}

const CHECK_IN_MILESTONES = [
  { type: 'day1', daysAfterStart: 0 },
  { type: 'day30', daysAfterStart: 30 },
  { type: 'day60', daysAfterStart: 60 },
] as const;

export function scheduledOnboardingCheckIns(startDate: Date, organizationId: string) {
  return CHECK_IN_MILESTONES.map(({ type, daysAfterStart }) => ({
    organizationId,
    type,
    scheduledDate: addUtcDays(startDate, daysAfterStart),
  }));
}
