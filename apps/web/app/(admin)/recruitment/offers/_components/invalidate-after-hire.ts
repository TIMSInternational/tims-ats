/**
 * A confirmed hire changes more than the offer: the application becomes 'hired' (it leaves the active
 * pipeline) and the vacancy may close. Cached candidate, vacancy and pipeline screens would otherwise keep
 * offering stage/rejection actions and a public link for up to the provider's staleTime, and those actions
 * now fail against the database.
 */
export interface HireInvalidationUtils {
  offer: { getById: { invalidate(input: { id: string }): Promise<void> }; list: { invalidate(): Promise<void> } };
  onboarding: { list: { invalidate(): Promise<void> }; getDashboardKpis: { invalidate(): Promise<void> } };
  candidate: { invalidate(): Promise<void> };
  vacancy: { invalidate(): Promise<void> };
  pipeline: { invalidate(): Promise<void> };
}

export async function invalidateAfterHire(utils: HireInvalidationUtils, offerId: string): Promise<void> {
  await Promise.all([
    utils.offer.getById.invalidate({ id: offerId }),
    utils.offer.list.invalidate(),
    utils.onboarding.list.invalidate(),
    utils.onboarding.getDashboardKpis.invalidate(),
    utils.candidate.invalidate(),
    utils.vacancy.invalidate(),
    utils.pipeline.invalidate(),
  ]);
}
