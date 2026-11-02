import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Every Spanish UI string, not just the public sections covered by public-copy-accents.test.ts.
// The whole file once shipped with its accents and ñ stripped ("Junior (0-2 anos)", "Cerrar sesion").
//
// Only spellings that are NEVER correct Spanish UI copy belong here. Words whose unaccented form is
// also a real word stay out — esta/está, el/él, tu/tú, si/sí, mas/más, solo, publica/pública,
// valida/válida, genero/género, cambio/cambió, and -ara/-aran (future vs. imperfect subjunctive).
const MISSPELLED_WORDS = [
  // ñ
  'ano',
  'anos',
  'anadir',
  'campana',
  'contrasena',
  'contrasenas',
  'desempeno',
  'diseno',
  'espanol',
  'manana',
  'pequeno',
  'pequenos',
  'senal',
  'tamano',
  'compania',
  'companias',
  // ü
  'antiguedad',
  'bilingue',
  // tildes
  'analisis',
  'anomalias',
  'aqui',
  'atras',
  'auditoria',
  'automaticamente',
  'bitacora',
  'boton',
  'busqueda',
  'busquedas',
  'catalogo',
  'categoria',
  'codigo',
  'comite',
  'critico',
  'criticos',
  'demografia',
  'dia',
  'dias',
  'estan',
  'exito',
  'guia',
  'historico',
  'indice',
  'lider',
  'lideres',
  'linea',
  'maximo',
  'metricas',
  'minimo',
  'modulo',
  'modulos',
  'numero',
  'pagina',
  'paginas',
  'pais',
  'razon',
  'telefono',
  'telemetria',
  'titulo',
  'ultimo',
  'ultimos',
  'unica',
  'volveras',
];

// -ción / -sión words are always accented in Spanish. English loanwords that share the ending:
const CION_ALLOWLIST = new Set(['session', 'sessions', 'succession']);
const CION = /\b[a-z]+(?:cion|sion)\b/gi;
const WORDS = new RegExp(`\\b(?:${MISSPELLED_WORDS.join('|')})\\b`, 'i');
// Interpolation placeholders, URLs and example email addresses are not prose.
const NOT_COPY = /\{[^{}]*\}|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g;

function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

function unaccentedOffenders(root: unknown): Array<[string, string]> {
  return strings(root, 'es').filter(([, raw]) => {
    const text = raw.replace(NOT_COPY, ' ');
    if (WORDS.test(text)) return true;
    return (text.match(CION) ?? []).some((word) => !CION_ALLOWLIST.has(word.toLowerCase()));
  });
}

describe('Spanish UI copy keeps its accents and ñ', () => {
  it('walks the whole file (guard against the walker silently matching nothing)', () => {
    expect(strings(es, 'es').length).toBeGreaterThan(3000);
  });

  it('has no known unaccented misspellings in any es.json value', () => {
    expect(unaccentedOffenders(es)).toEqual([]);
  });

  it('the detector catches the defects it exists for', () => {
    const bad = {
      a: 'Junior (0-2 anos)',
      b: 'Cerrar sesion',
      c: 'Configuracion',
      d: 'Revision de Acceso',
      e: 'Contrasena',
      f: 'Aparecera aqui',
    };
    expect(unaccentedOffenders(bad).map(([path]) => path)).toEqual(['es.a', 'es.b', 'es.c', 'es.d', 'es.e', 'es.f']);
  });

  it('does not flag correct Spanish or placeholders', () => {
    const good = {
      a: 'Junior (0-2 años)',
      b: 'Cerrar sesión',
      c: 'Esta acción no se puede deshacer.',
      d: 'Hola {sesion}, escribe a soporte@organizacion.co',
      e: 'Session replay',
    };
    expect(unaccentedOffenders(good)).toEqual([]);
  });
});
