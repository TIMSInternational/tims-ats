import { beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot call 2026-11-05: moving a card to the final "Contratado" stage looks like a hire but does not record one
// (only "Autorizar Contratación" on the accepted offer does: hire-closure.service.ts). The board and the
// Candidate 360 now say so after such a move (lib/pipeline-move-toast.ts).

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/toast', () => ({ toast }));

const labels = es.pipeline;
beforeEach(() => toast.mockClear());

describe('announceStageMove — the "Contratado" hint', () => {
  it('after a move to "Contratado" (any case/accents) it tells how the hire is confirmed', async () => {
    const { announceStageMove } = await import('../../apps/web/lib/pipeline-move-toast');
    for (const name of ['Contratado', '  contratado ', 'CONTRATADO']) {
      toast.mockClear();
      announceStageMove({ warnings: null }, name, labels, {});
      expect(toast).toHaveBeenCalledWith(es.pipeline.hiredStageHint, { type: 'info', duration: 8000 });
    }
    expect(es.pipeline.hiredStageHint).toContain('«Autorizar Contratación»');
    expect(es.pipeline.hiredStageHint).toContain(es.offers.authorizeHiring);
    expect(en.pipeline.hiredStageHint).toContain(en.offers.authorizeHiring);
  });

  it('no hint for any other stage', async () => {
    const { announceStageMove } = await import('../../apps/web/lib/pipeline-move-toast');
    for (const name of ['Oferta', 'Entrevista final', 'Preselección', null]) {
      toast.mockClear();
      announceStageMove({ warnings: null }, name, labels, {});
      expect(toast).not.toHaveBeenCalledWith(es.pipeline.hiredStageHint, expect.anything());
    }
  });
});
