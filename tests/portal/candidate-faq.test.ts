import { describe, it, expect } from 'vitest';
import { buildCandidateFaqContext } from '../../packages/api/src/services/candidate-portal.service';

const candidate = { id: 'cand-1', firstName: 'Ana', lastName: 'Gomez' };

describe('candidate FAQ prompt context', () => {
  it('focuses on an owned application id and omits all other applications', () => {
    const context = buildCandidateFaqContext(
      'TIMS',
      candidate as never,
      [
        {
          id: 'app-1',
          status: 'active',
          appliedAt: new Date('2026-07-01T00:00:00.000Z'),
          vacancy: { title: 'Backend Engineer', company: { name: 'TIMS' } },
          currentStage: { name: 'Screening' },
        },
        {
          id: 'app-2',
          status: 'active',
          appliedAt: new Date('2026-07-02T00:00:00.000Z'),
          vacancy: { title: 'Product Manager', company: { name: 'TIMS' } },
          currentStage: { name: 'Interview' },
        },
      ] as never,
      [] as never,
      [] as never,
      'app-2',
    );

    expect(context.applications).toHaveLength(1);
    expect(context.applications[0]).toMatchObject({
      id: 'app-2',
      vacancyTitle: 'Product Manager',
      currentStage: 'Interview',
    });
    expect(JSON.stringify(context)).not.toContain('Backend Engineer');
  });

  it('does not leak meeting URLs, signing tokens, raw settings, or internal notes into the prompt', () => {
    const context = buildCandidateFaqContext(
      'TIMS',
      candidate as never,
      [
        {
          id: 'app-1',
          status: 'active',
          appliedAt: new Date('2026-07-01T00:00:00.000Z'),
          vacancy: { title: 'Backend Engineer', company: { name: 'TIMS' } },
          currentStage: { name: 'Screening' },
          recruiterNotes: 'internal note',
        },
      ] as never,
      [
        {
          id: 'int-1',
          type: 'technical',
          status: 'scheduled',
          scheduledAt: new Date('2026-07-05T15:00:00.000Z'),
          duration: 45,
          location: null,
          meetingUrl: 'https://video.example/private-room',
          vacancy: { title: 'Backend Engineer' },
        },
      ] as never,
      [
        {
          id: 'offer-1',
          status: 'sent',
          salary: 100,
          currency: 'USD',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          contractType: 'full_time',
          expiresAt: new Date('2999-07-20T00:00:00.000Z'),
          settings: { signingToken: 'secret-signing-token' },
          vacancy: { title: 'Backend Engineer', company: { name: 'TIMS' } },
        },
      ] as never,
    );

    const serialized = JSON.stringify(context);
    expect(context.upcomingInterviews[0]?.hasJoinLink).toBe(true);
    expect(context.offers[0]?.signable).toBe(true);
    expect(serialized).not.toContain('https://video.example/private-room');
    expect(serialized).not.toContain('secret-signing-token');
    expect(serialized).not.toContain('settings');
    expect(serialized).not.toContain('internal note');
  });
});
