// Map quadrant names to grid keys (potential-performance)
export const quadrantToGrid: Record<string, string> = {
  star: '3-3',
  high_potential: '3-2',
  enigma: '3-1',
  solid_performer: '2-3',
  consistent_performer: '2-3',
  core_player: '2-2',
  inconsistent: '2-1',
  workhouse: '1-3',
  underperformer: '1-2',
  risk: '1-1',
};

// Quadrant lookup by potential/performance band (simulate)
export const simulateQuadrantMap: Record<string, Record<string, string>> = {
  high: { high: 'star', medium: 'high_potential', low: 'enigma' },
  medium: { high: 'solid_performer', medium: 'core_player', low: 'inconsistent' },
  low: { high: 'workhouse', medium: 'underperformer', low: 'risk' },
};

// Standard development plans per quadrant
export const quadrantPlans: Record<string, { title: string; actions: string[] }> = {
  star: {
    title: 'Retener y Acelerar',
    actions: [
      'Asignar proyectos de alta visibilidad',
      'Incluir en plan de sucesion',
      'Ofrecer mentoria ejecutiva',
    ],
  },
  high_potential: {
    title: 'Desarrollar Rendimiento',
    actions: [
      'Establecer metas desafiantes',
      'Asignar coaching de desempeno',
      'Rotacion de roles',
    ],
  },
  enigma: {
    title: 'Evaluar y Orientar',
    actions: [
      'Asignar mentor',
      'Revisar encaje de rol',
      'Establecer metas a corto plazo',
    ],
  },
  solid_performer: {
    title: 'Reconocer y Desarrollar',
    actions: [
      'Reconocimiento publico',
      'Plan de capacitacion en liderazgo',
      'Proyectos cross-funcionales',
    ],
  },
  core_player: {
    title: 'Motivar y Crecer',
    actions: [
      'Feedback regular',
      'Capacitacion tecnica',
      'Metas de estiramiento',
    ],
  },
  inconsistent: {
    title: 'Diagnosticar y Apoyar',
    actions: [
      'Identificar barreras',
      'Plan de mejora con seguimiento',
      'Evaluar motivacion',
    ],
  },
  workhouse: {
    title: 'Valorar Consistencia',
    actions: [
      'Reconocer contribuciones',
      'Evaluar interes en crecimiento',
      'Capacitacion selectiva',
    ],
  },
  underperformer: {
    title: 'Plan de Mejora',
    actions: [
      'Plan de mejora formal (PIP)',
      'Coaching intensivo',
      'Revision en 90 dias',
    ],
  },
  risk: {
    title: 'Accion Inmediata',
    actions: [
      'Conversacion de retroalimentacion directa',
      'PIP con plazos estrictos',
      'Evaluar reubicacion o salida',
    ],
  },
};
