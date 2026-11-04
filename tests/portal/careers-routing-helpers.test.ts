import { describe, expect, it } from 'vitest';
import { careersNotFoundTarget } from '../../apps/web/lib/careers-not-found';
import {
  candidatePhase,
  collapseToPhases,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/candidate-phase';
import {
  isValidApplyEmail,
  isValidLinkedinUrl,
  normalizeLinkedinUrl,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/apply-fields';

describe('careers 404 target (never the staff dashboard)', () => {
  it('sends a missing page below a board back to that board, slug lower-cased', () => {
    expect(careersNotFoundTarget('/careers/Acme/x/y')).toEqual({ href: '/careers/acme' });
    expect(careersNotFoundTarget('/careers/acme/vacante/extra/')).toEqual({ href: '/careers/acme' });
  });

  it('offers no link when the board itself is missing (the link would 404 again)', () => {
    expect(careersNotFoundTarget('/careers/no-such-org')).toEqual({ href: null });
    expect(careersNotFoundTarget('/careers')).toEqual({ href: null });
    expect(careersNotFoundTarget('/careers/%E0%A4%A/x')).toEqual({ href: null });
  });

  it('is not involved outside /careers', () => {
    expect(careersNotFoundTarget('/recruitment/vacancies')).toBeNull();
    expect(careersNotFoundTarget('/careersfoo')).toBeNull();
    expect(careersNotFoundTarget(null)).toBeNull();
  });
});

describe('candidate-facing pipeline phases', () => {
  it('maps the default stage names to candidate phases', () => {
    const phases = [
      'Aplicado',
      'Screening',
      'Entrevista RRHH',
      'Prueba Tecnica',
      'Entrevista Final',
      'Oferta',
      'Contratado',
    ].map((name) => candidatePhase(name, 'active'));
    // "Contratado" is only a stage name: the hire is announced by the application status, never by it.
    expect(phases).toEqual(['review', 'review', 'interviews', 'review', 'interviews', 'offer', 'review']);
  });

  it('lets the application status win: rejected/withdrawn are closed, hired is hired', () => {
    expect(candidatePhase('Entrevista Final', 'rejected')).toBe('closed');
    expect(candidatePhase('Oferta', 'withdrawn')).toBe('closed');
    expect(candidatePhase('Screening', 'hired')).toBe('hired');
    expect(candidatePhase(null, 'active')).toBe('review');
  });

  it('never announces a selection from a stage name (Codex review)', () => {
    expect(candidatePhase('No contratado', 'active')).toBe('review');
    expect(candidatePhase('Entrevista de contratación', 'active')).toBe('interviews');
    expect(candidatePhase('Oferta no aceptada', 'active')).toBe('review');
    for (const name of ['Contratado', 'Contratación', 'Hired', 'Ingreso', 'No contratado']) {
      expect(candidatePhase(name, 'active')).not.toBe('hired');
    }
  });

  it('collapses consecutive moves within one phase', () => {
    const moves = ['Screening', 'Entrevista RRHH', 'Prueba Tecnica', 'Entrevista Final', 'Oferta'];
    expect(collapseToPhases(moves, (m) => candidatePhase(m, 'active')).map((e) => [e.phase, e.item])).toEqual([
      ['review', 'Screening'],
      ['interviews', 'Entrevista RRHH'],
      ['review', 'Prueba Tecnica'],
      ['interviews', 'Entrevista Final'],
      ['offer', 'Oferta'],
    ]);
  });
});

describe('apply form field rules (same validators as the server)', () => {
  it('accepts what portal.applyToVacancy accepts for email', () => {
    expect(isValidApplyEmail('maria@gmail.com')).toBe(true);
    expect(isValidApplyEmail(' maria@gmail.com ')).toBe(true);
    expect(isValidApplyEmail('maria@gmail')).toBe(false);
    expect(isValidApplyEmail('maria')).toBe(false);
  });

  it('prepends https:// to a LinkedIn value typed without a scheme', () => {
    expect(normalizeLinkedinUrl('linkedin.com/in/maria')).toBe('https://linkedin.com/in/maria');
    expect(normalizeLinkedinUrl(' www.linkedin.com/in/maria ')).toBe('https://www.linkedin.com/in/maria');
    expect(normalizeLinkedinUrl('http://linkedin.com/in/maria')).toBe('http://linkedin.com/in/maria');
    expect(normalizeLinkedinUrl('   ')).toBe('');
  });

  it('accepts an empty LinkedIn (optional) and refuses non-http(s) values', () => {
    expect(isValidLinkedinUrl('')).toBe(true);
    expect(isValidLinkedinUrl('linkedin.com/in/maria')).toBe(true);
    expect(isValidLinkedinUrl('javascript:alert(1)')).toBe(false);
    expect(isValidLinkedinUrl('ftp://linkedin.com/in/maria')).toBe(false);
  });
});
