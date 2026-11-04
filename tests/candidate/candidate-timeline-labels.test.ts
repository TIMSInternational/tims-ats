import { describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { localizeTimelineEvent } from '../../apps/web/lib/candidate-timeline-labels';

const timelineData = vi.hoisted(() => ({ value: [[], [], []] as unknown[] }));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: { getTimelineData: vi.fn(async () => timelineData.value) },
}));

import { candidateService } from '../../packages/api/src/services/candidate.service';

// A-04: the Candidate 360 history read "Applied to …", "Source: portal", "Start → Screening",
// "Document uploaded: cv.pdf" with a bare "cv".
describe('candidate history events', () => {
  it('the service returns a Spanish fallback plus the params the screen localizes', async () => {
    timelineData.value = [
      [
        {
          id: 'app1',
          source: 'portal',
          appliedAt: new Date('2026-11-01T10:00:00Z'),
          vacancy: { title: 'Analista Financiero' },
          movements: [
            { id: 'm1', fromStage: null, toStage: { name: 'Preselección' }, reason: null, movedAt: new Date('2026-11-02T10:00:00Z'), actor: null },
          ],
        },
      ],
      [],
      [{ id: 'd1', fileName: 'cv.pdf', type: 'cv', uploadedAt: new Date('2026-11-01T10:00:00Z') }],
    ];
    const events = await candidateService.getTimeline('org-1', 'cand-1', {});
    const byType = Object.fromEntries(events.map((e) => [e.type, e]));

    expect(byType.application?.title).toBe('Se postuló a Analista Financiero');
    expect(byType.application?.params).toEqual({ vacancyTitle: 'Analista Financiero', source: 'portal' });
    expect(byType.stage_movement?.title).toBe('Inicio → Preselección');
    expect(byType.document_uploaded?.title).toBe('Documento subido: cv.pdf');
    expect(JSON.stringify(events)).not.toMatch(/Applied to|Source:|Start →|Document uploaded/);
  });

  it('renders in Spanish with the source and document type as words', () => {
    const app = localizeTimelineEvent(
      { type: 'application', title: 'x', description: 'x', params: { vacancyTitle: 'Analista', source: 'portal' } },
      es.candidates,
    );
    expect(app).toEqual({ title: 'Se postuló a Analista', description: 'Fuente: Portal de empleo' });

    const move = localizeTimelineEvent(
      { type: 'stage_movement', title: 'x', description: null, params: { fromStage: null, toStage: 'Preselección' } },
      es.candidates,
    );
    expect(move.title).toBe('Inicio → Preselección');

    const doc = localizeTimelineEvent(
      { type: 'document_uploaded', title: 'x', description: 'cv', params: { fileName: 'cv.pdf', documentType: 'cv' } },
      es.candidates,
    );
    expect(doc).toEqual({ title: 'Documento subido: cv.pdf', description: 'Currículum (CV)' });
  });

  it('renders in English when the UI is in English, and keeps `$&` in user data literal', () => {
    const app = localizeTimelineEvent(
      { type: 'application', title: 'x', description: null, params: { vacancyTitle: 'Dev $& Ops', source: 'job_board' } },
      en.candidates,
    );
    expect(app).toEqual({ title: 'Applied to Dev $& Ops', description: 'Source: Job board' });
  });

  it('falls back to the server text for an event without params', () => {
    expect(localizeTimelineEvent({ type: 'other', title: 'Hola', description: null }, es.candidates)).toEqual({
      title: 'Hola',
      description: null,
    });
  });
});
