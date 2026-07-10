// Default onboarding task set applied to every new OnboardingPlan created on hire
// conversion (offer/lifecycle.ts convertToEmployee). Plain data — no configurable
// per-org template system; that's out of scope for this task.
export const DEFAULT_ONBOARDING_TASKS = [
  { title: 'Configurar equipo de TI (laptop, accesos, correo)', responsible: 'it', phase: 'day1_30', order: 0 },
  { title: 'Reunión 1:1 de bienvenida con el manager', responsible: 'manager', phase: 'day1_30', order: 1 },
  { title: 'Firmar documentos de ingreso (contrato, políticas)', responsible: 'hr', phase: 'day1_30', order: 2 },
  { title: 'Sesión de orientación cultural', responsible: 'hr', phase: 'day1_30', order: 3 },
  { title: 'Configurar herramientas internas del equipo', responsible: 'manager', phase: 'day1_30', order: 4 },
  { title: 'Check-in de 30 días con RRHH', responsible: 'hr', phase: 'day1_30', order: 5 },
  { title: 'Primera evaluación de desempeño inicial', responsible: 'manager', phase: 'day31_60', order: 6 },
  { title: 'Revisión de objetivos (OKRs) del primer trimestre', responsible: 'manager', phase: 'day31_60', order: 7 },
  { title: 'Completar ruta de capacitación específica del rol', responsible: 'employee', phase: 'day61_90', order: 8 },
  { title: 'Check-in de 90 días con RRHH', responsible: 'hr', phase: 'day61_90', order: 9 },
] as const;
