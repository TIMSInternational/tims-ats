import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import { boardUrlQuery, readBoardUrlState } from '../../apps/web/lib/pipeline-url-state';
import { daysInStageLabel, wholeDaysSince } from '../../apps/web/lib/pipeline-days';
import { FIT_BANDS, fitBand } from '../../apps/web/lib/pipeline-fit';
import { rejectionReasonLabel, toRejectCandidateInput } from '../../apps/web/lib/reject-reasons';
import { getNextActionForStage, visibleNextAction } from '../../apps/web/lib/pipeline-next-actions';
import { localizeTimelineEvent } from '../../apps/web/lib/candidate-timeline-labels';

const VACANCY = '22222222-2222-4222-8222-222222222222';

describe('A-09 board state in the URL', () => {
  it('round-trips the vacancy, view, status toggle and filters', () => {
    const state = {
      vacancy: VACANCY,
      view: 'table' as const,
      status: 'rejected' as const,
      filters: { source: 'portal', fitMin: 70, maxDays: 7, slaOnly: true },
    };
    const query = boardUrlQuery(state);
    expect(query).toBe(`?vacancy=${VACANCY}&view=table&status=rejected&source=portal&fit=70&days=7&sla=1`);
    expect(readBoardUrlState(new URLSearchParams(query.slice(1)))).toEqual(state);
  });

  it('omits defaults and falls back to them for missing or malformed values', () => {
    expect(boardUrlQuery({ vacancy: VACANCY, view: null, status: 'active', filters: { source: null, fitMin: null, maxDays: null, slaOnly: false } })).toBe(
      `?vacancy=${VACANCY}`,
    );
    expect(readBoardUrlState(new URLSearchParams('view=grid&status=deleted&fit=999&days=-1&source=<x>&sla=yes'))).toEqual({
      vacancy: null,
      view: null,
      status: 'active',
      filters: { source: null, fitMin: null, maxDays: null, slaOnly: false },
    });
    expect(readBoardUrlState(null).status).toBe('active');
  });
});

describe('A-23 days in the current stage and one FIT scale', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  it('counts whole days in the stage, never negative', () => {
    expect(wholeDaysSince('2026-11-10T08:00:00.000Z', now)).toBe(0);
    expect(wholeDaysSince('2026-11-03T12:00:00.000Z', now)).toBe(7);
    expect(wholeDaysSince('2026-11-11T12:00:00.000Z', now)).toBe(0);
    expect(wholeDaysSince('not a date', now)).toBe(0);
  });

  it('labels it as time in the stage', () => {
    expect(daysInStageLabel('2026-11-10T08:00:00.000Z', es.pipeline, now)).toBe('Hoy en esta etapa');
    expect(daysInStageLabel('2026-11-09T11:00:00.000Z', es.pipeline, now)).toBe('1 día en etapa');
    expect(daysInStageLabel('2026-11-03T12:00:00.000Z', es.pipeline, now)).toBe('7 días en etapa');
  });

  it('uses the same 70/40 bands everywhere, and the filter labels say so', () => {
    expect(FIT_BANDS).toEqual({ high: 70, medium: 40 });
    expect([fitBand(70), fitBand(69.9), fitBand(40), fitBand(39)]).toEqual(['high', 'medium', 'medium', 'low']);
    expect(es.pipeline.filterFitHigh).toContain('70');
    expect(es.pipeline.filterFitMedium).toContain('40');
  });
});

describe('A-05 / C-11 rejection helpers', () => {
  it('sends notifyCandidate only when the recruiter opted in', () => {
    expect(toRejectCandidateInput('a', 'OTHER', 'Otro', '')).toEqual({ applicationId: 'a', reason: 'OTHER: Otro' });
    expect(toRejectCandidateInput('a', 'OTHER', 'Otro', '', true)).toEqual({ applicationId: 'a', reason: 'OTHER: Otro', notifyCandidate: true });
  });

  it('shows a stored reason in the viewer language, and older free text as stored', () => {
    const reasons = es.rejectCandidateModal.reasons;
    expect(rejectionReasonLabel('SALARY_MISMATCH: Salary out of range', reasons)).toBe(reasons.SALARY_MISMATCH);
    expect(rejectionReasonLabel('UNKNOWN_CODE: Texto propio', reasons)).toBe('Texto propio');
    expect(rejectionReasonLabel('No cumple: perfil', reasons)).toBe('No cumple: perfil');
    expect(rejectionReasonLabel(null, reasons)).toBe('');
  });

  it('renders the rejection in the candidate history', () => {
    const event = localizeTimelineEvent(
      { type: 'application_rejected', title: 'x', description: 'y', params: { vacancyTitle: 'Analista', reason: 'NO_SHOW: No se presentó' } },
      es.candidates,
      es.rejectCandidateModal.reasons,
    );
    expect(event).toEqual({ title: 'Rechazado en Analista', description: es.rejectCandidateModal.reasons.NO_SHOW });
  });
});

describe('A-10 interview stages suggest scheduling for that candidate', () => {
  it('maps every interview stage name, old and new defaults, to the interview action', () => {
    for (const name of ['Entrevista con RR. HH.', 'Entrevista final', 'Entrevista RRHH', 'ENTREVISTA FINAL', 'Entrevistas']) {
      expect(getNextActionForStage(name)?.labelKey).toBe('entrevistas');
    }
    expect(getNextActionForStage('Entrevistador externo')).toBeNull();
    expect(getNextActionForStage('Prueba técnica')).toBeNull();
  });

  it('opens the candidate profile with the schedule form for the moved application', () => {
    const action = visibleNextAction(getNextActionForStage('Entrevista final'), 'full', {
      can: () => true,
      candidateId: 'c1',
      applicationId: 'a1',
    });
    expect(action?.href).toBe('/recruitment/candidates/c1?schedule=a1');
  });

  it('is dropped for a viewer who cannot schedule interviews', () => {
    const can = (module: string, action?: string) => !(module === 'interview' && action === 'create');
    expect(visibleNextAction(getNextActionForStage('Entrevista final'), 'full', { can, candidateId: 'c1', applicationId: 'a1' })).toBeNull();
  });
});
