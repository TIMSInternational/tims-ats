import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  CANDIDATE_POOL_TYPES,
  CANDIDATE_SOURCES,
  candidatePoolLabel,
  candidateSourceLabel,
} from '../../apps/web/lib/candidate-labels';

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

  it('never prints a raw snake_case slug for an unknown value, and a dash for none', () => {
    expect(candidateSourceLabel('feria_de_empleo', es.candidates)).toBe('Feria de empleo');
    expect(candidatePoolLabel(null, es.candidates)).toBe('—');
    expect(candidateSourceLabel(undefined, es.candidates)).toBe('—');
  });
});
