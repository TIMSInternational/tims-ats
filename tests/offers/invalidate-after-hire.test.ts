import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterHire } from '../../apps/web/app/(admin)/recruitment/offers/_components/invalidate-after-hire';

describe('invalidateAfterHire', () => {
  it('refreshes candidate, vacancy and pipeline caches, not only offers and onboarding', async () => {
    const fn = () => vi.fn(async () => undefined);
    const utils = {
      offer: { getById: { invalidate: fn() }, list: { invalidate: fn() } },
      onboarding: { list: { invalidate: fn() }, getDashboardKpis: { invalidate: fn() } },
      candidate: { invalidate: fn() },
      vacancy: { invalidate: fn() },
      pipeline: { invalidate: fn() },
    };
    await invalidateAfterHire(utils, 'offer-1');
    expect(utils.offer.getById.invalidate).toHaveBeenCalledWith({ id: 'offer-1' });
    for (const f of [utils.candidate.invalidate, utils.vacancy.invalidate, utils.pipeline.invalidate]) {
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});
