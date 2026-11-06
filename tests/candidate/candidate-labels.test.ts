import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  CANDIDATE_POOL_TYPES,
  CANDIDATE_SOURCES,
  CANDIDATE_STAFF_POOL_TYPES,
  candidatePoolLabel,
  candidatePoolOptionLabel,
  candidateSourceLabel,
} from '../../apps/web/lib/candidate-labels';

const ROOT = resolve(__dirname, '../..');
const CREATE_FORMS = [
  'apps/web/app/(admin)/recruitment/candidates/create-modal',
  'apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal',
];

// A-14 / A-12: staff screens showed raw slugs ("Fuente: portal", pool "active", "applicant: 3") and the
// English "Job Board". One shared vocabulary, rendered through i18n.
describe('candidate source and pool labels', () => {
  it('maps every known source to a Spanish label (and an English one)', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(candidateSourceLabel(source, es.candidates)).not.toBe(source);
      expect(candidateSourceLabel(source, en.candidates)).toBeTruthy();
    }
    expect(candidateSourceLabel('portal', es.candidates)).toBe('Portal de empleo');
    expect(candidateSourceLabel('job_board', es.candidates)).toBe('Bolsa de empleo');
    expect(candidateSourceLabel('job_board', en.candidates)).toBe('Job board');
  });

  it('maps every pool type, including the "active" the create forms store', () => {
    for (const pool of CANDIDATE_POOL_TYPES) {
      expect(candidatePoolLabel(pool, es.candidates)).not.toBe(pool);
    }
    expect(candidatePoolLabel('active', es.candidates)).toBe('Activo');
    expect(candidatePoolLabel('applicant', es.candidates)).toBe('Postulante');
  });

  // A-14 follow-up: both create forms had their own hard-coded pool lists ("Sourced — contactado
  // directamente") that disagreed with each other and with the table, which printed the English "Sourcing".
  it('gives the create forms the same pool names the tables show, with a hint, in es and en', () => {
    for (const pool of CANDIDATE_STAFF_POOL_TYPES) {
      for (const dict of [es.candidates, en.candidates]) {
        const option = candidatePoolOptionLabel(pool, dict);
        expect(option.startsWith(`${candidatePoolLabel(pool, dict)} — `)).toBe(true);
        expect(option.length).toBeGreaterThan(candidatePoolLabel(pool, dict).length + 3);
      }
    }
    expect(candidatePoolLabel('sourced', es.candidates)).toBe('Búsqueda directa');
    expect(candidatePoolOptionLabel('active', es.candidates)).toBe('Activo — busca empleo activamente');
  });

  it('keeps no private pool label list in either create form', () => {
    for (const form of CREATE_FORMS) {
      const helpers = readFileSync(resolve(ROOT, `${form}.helpers.ts`), 'utf8');
      const fields = readFileSync(resolve(ROOT, `${form}.fields.tsx`), 'utf8');
      expect(helpers).not.toMatch(/POOL_TYPES\s*=/);
      expect(fields).toContain('CANDIDATE_STAFF_POOL_TYPES.map(');
      expect(fields).toContain('candidatePoolOptionLabel(p, t.candidates)');
    }
  });

  it('never prints a raw snake_case slug for an unknown value, and a dash for none', () => {
    expect(candidateSourceLabel('feria_de_empleo', es.candidates)).toBe('Feria de empleo');
    expect(candidatePoolLabel(null, es.candidates)).toBe('—');
    expect(candidateSourceLabel(undefined, es.candidates)).toBe('—');
  });
});
