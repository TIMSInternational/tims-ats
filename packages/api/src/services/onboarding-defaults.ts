// Default onboarding checklist seeded into every new OnboardingPlan — both the
// manual HR create path (routers/onboarding.ts create) and the accepted-offer
// hire handoff (routers/offer/lifecycle.ts convertToEmployee). Plain data: there
// is no per-org template model, so this constant is the single source of truth.
//
// `responsible` is the owner role slug (hr | it | manager | buddy | employee —
// "employee" is the new hire; an own-scoped caller may toggle only the tasks
// they own — enforced server-side by onboarding-self-service.ts, not just the UI). `dueOffsetDays` is relative to the plan's start
// date; `phase` is derived from it so the two can never disagree.
export const ONBOARDING_TASK_OWNERS = ['hr', 'it', 'manager', 'buddy', 'employee'] as const;
export type OnboardingTaskOwner = (typeof ONBOARDING_TASK_OWNERS)[number];
/** The owner slug of tasks the new hire completes themself (enforced server-side, onboarding-self-service.ts). */
export const NEW_HIRE_TASK_OWNER_SLUG: OnboardingTaskOwner = 'employee';
/** The owner slug of tasks the plan's buddy completes (enforced server-side, onboarding-self-service.ts). */
export const BUDDY_TASK_OWNER_SLUG: OnboardingTaskOwner = 'buddy';

type DefaultOnboardingTask = {
  readonly title: string;
  /** What the task means and what to do — shown under the title in "Mi Onboarding" and the HR list. */
  readonly description: string;
  readonly responsible: OnboardingTaskOwner;
  readonly dueOffsetDays: number;
};

// Titles and descriptions are stored on each new plan (existing plans keep the text they were created
// with). Spanish, Costa Rica-neutral; "compañero guía" is the buddy and "jefatura" the manager — the same
// words the owner labels use (apps/web i18n onboarding.ownerLabels).
export const DEFAULT_ONBOARDING_TASKS: readonly DefaultOnboardingTask[] = [
  {
    title: 'Firmar contrato y documentos de ingreso',
    description: 'Recursos Humanos coordina la firma del contrato y de los documentos de ingreso.',
    responsible: 'hr',
    dueOffsetDays: -3,
  },
  {
    title: 'Preparar equipo y accesos de TI (laptop, correo, sistemas)',
    description: 'TI prepara la computadora, la cuenta de correo y los accesos a los sistemas que vas a usar.',
    responsible: 'it',
    dueOffsetDays: -1,
  },
  {
    title: 'Bienvenida del primer día y recorrido por la empresa',
    description: 'Recursos Humanos te recibe el primer día y te muestra las instalaciones y la organización.',
    responsible: 'hr',
    dueOffsetDays: 0,
  },
  {
    title: 'Presentación con el compañero guía',
    description: 'Tu compañero guía te acompaña los primeros días y responde las dudas del día a día.',
    responsible: 'buddy',
    dueOffsetDays: 0,
  },
  {
    title: 'Leer y aceptar las políticas de la empresa',
    description:
      'Recursos Humanos te comparte las políticas internas (reglamento, conducta, seguridad de la información). Léelas y marca esta tarea cuando termines; si aún no las recibiste, pídelas a Recursos Humanos.',
    responsible: 'employee',
    dueOffsetDays: 2,
  },
  {
    title: 'Reunión 1:1 de bienvenida con la jefatura',
    description: 'Tu jefatura conversa contigo sobre el puesto, el equipo y las expectativas de las primeras semanas.',
    responsible: 'manager',
    dueOffsetDays: 2,
  },
  {
    title: 'Inscripción en nómina y beneficios',
    description:
      'Entrega a Recursos Humanos los datos que te pidan para la planilla (por ejemplo, la cuenta bancaria) y la inscripción en los beneficios. Marca esta tarea cuando lo hayas hecho.',
    responsible: 'employee',
    dueOffsetDays: 5,
  },
  {
    title: 'Presentación con el equipo',
    description: 'Tu jefatura te presenta al equipo de trabajo y a las personas con las que vas a colaborar.',
    responsible: 'manager',
    dueOffsetDays: 5,
  },
  {
    title: 'Definir objetivos de 30/60/90 días',
    description: 'Tu jefatura acuerda contigo los objetivos de tus primeros 30, 60 y 90 días.',
    responsible: 'manager',
    dueOffsetDays: 7,
  },
  {
    title: 'Revisión de objetivos de 30 días',
    description: 'Tu jefatura revisa contigo el avance de los objetivos del primer mes.',
    responsible: 'manager',
    dueOffsetDays: 30,
  },
  {
    title: 'Revisión de objetivos de 60 días',
    description: 'Tu jefatura revisa contigo el avance de los objetivos del segundo mes.',
    responsible: 'manager',
    dueOffsetDays: 60,
  },
  {
    title: 'Revisión de objetivos de 90 días y cierre del onboarding',
    description: 'Recursos Humanos y tu jefatura cierran el onboarding con la revisión de los 90 días.',
    responsible: 'hr',
    dueOffsetDays: 90,
  },
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
    description: task.description,
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
