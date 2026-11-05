import type { Action, Module } from '@tims/shared';

// User-facing wording for a permission denial (trpc.ts requirePermission / requireAnyPermission). The
// message reaches users verbatim — ~40 pilot screens toast `err.message` — so it must read as Spanish
// staff copy, never as "No tienes permiso para create en onboarding". Typed as full Records so a module
// or action added to @tims/shared without a label fails the type check instead of leaking its slug.

const MODULE_LABELS: Record<Module, string> = {
  vacancy: 'Vacantes',
  pipeline: 'Pipeline',
  candidate: 'Candidatos',
  assessment: 'Evaluaciones',
  interview: 'Entrevistas',
  offer: 'Ofertas',
  onboarding: 'Onboarding',
  performance: 'Desempeño',
  learning: 'Capacitación',
  ninebox: 'Nine Box',
  succession: 'Sucesión',
  team_intel: 'Inteligencia de equipo',
  engagement: 'Clima',
  dei: 'DEI',
  compensation: 'Compensación',
  monitoring: 'Monitoreo',
  organization: 'Organización',
  user: 'Usuarios',
  notification: 'Notificaciones',
  audit: 'Registro de auditoría',
  feature_flags: 'Funcionalidades',
  billing: 'Facturación',
  integration: 'Integraciones',
  fit_engine: 'Pesos FIT',
  validation: 'Validaciones',
  evaluation360: 'Evaluación 360',
};

const ACTION_VERBS: Record<Action, string> = {
  create: 'crear',
  read: 'ver',
  update: 'editar',
  delete: 'eliminar',
  approve: 'aprobar',
  export: 'exportar',
  publish: 'publicar',
};

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** "No tienes permiso para crear en el módulo Onboarding. …" — generic wording for an unknown slug. */
export function permissionDeniedMessage(module: string, action: string): string {
  const guidance = 'Si lo necesitas, pide acceso al administrador de tu organización.';
  if (!own(MODULE_LABELS, module) || !own(ACTION_VERBS, action)) {
    return `No tienes permiso para realizar esta acción. ${guidance}`;
  }
  return `No tienes permiso para ${ACTION_VERBS[action as Action]} en el módulo ${MODULE_LABELS[module as Module]}. ${guidance}`;
}
