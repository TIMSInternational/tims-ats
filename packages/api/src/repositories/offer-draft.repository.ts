import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';

// Data access for drafting an offer: the default-currency sources, the one-open-offer check, the draft insert
// and the compare-and-set draft edit. The rules live in routers/offer/crud.ts, open-offer-guard.ts and
// offer-currency.ts (Pilot UX audit B-04 / A-15 / B-12, company-admin data-62).

/** What offer.update returns: the edited terms, never `settings` (the candidate's signing token lives there). */
export const OFFER_EDIT_SELECT = {
  id: true,
  status: true,
  salary: true,
  currency: true,
  startDate: true,
  contractType: true,
  benefits: true,
  terms: true,
  expiresAt: true,
  updatedAt: true,
} satisfies Prisma.OfferSelect;

const CREATED_DRAFT_INCLUDE = {
  candidate: { select: { id: true, firstName: true, lastName: true } },
  vacancy: { select: { id: true, title: true } },
} satisfies Prisma.OfferInclude;

export type OfferCurrencySources = { orgSettings: unknown; companyCurrency: string | null };

export const offerDraftRepository = {
  /** The inputs of an offer's default currency: the organization's settings and the vacancy company's currency. */
  async currencySources(organizationId: string, vacancyId: string): Promise<OfferCurrencySources> {
    const [organization, vacancy] = await Promise.all([
      tenantDb.organization.findFirst({ where: { id: organizationId }, select: { settings: true } }),
      tenantDb.vacancy.findFirst({
        where: { id: vacancyId, organizationId },
        select: { company: { select: { currency: true } } },
      }),
    ]);
    return { orgSettings: organization?.settings ?? null, companyCurrency: vacancy?.company?.currency ?? null };
  },

  /** Inside the create transaction: the id of an offer matching `where` (an open-offer filter), or null. */
  async findOpenOfferId(tx: Prisma.TransactionClient, where: Prisma.OfferWhereInput): Promise<string | null> {
    const open = await tx.offer.findFirst({ where, select: { id: true } });
    return open?.id ?? null;
  },

  /** Inserts the draft inside the caller's transaction, after its one-open-offer check. */
  createDraft(tx: Prisma.TransactionClient, data: Prisma.OfferUncheckedCreateInput) {
    return tx.offer.create({ data, include: CREATED_DRAFT_INCLUDE });
  },

  /**
   * Compare-and-set on `draft`: writes only while the offer is still a draft, so a submission for approval that
   * lands between the caller's status check and this write cannot change the terms approvers are asked to
   * approve. `unchanged` (an edit of the pay) also requires the salary and currency the caller computed its write
   * from to still be stored, so two concurrent edits cannot interleave into a pair neither produced (USD 12 000,
   * then "CRC" and "24 000.12" = a fractional colón salary) or overwrite each other's amount. Returns whether the
   * write applied.
   */
  async updateDraft(
    organizationId: string,
    id: string,
    data: Prisma.OfferUpdateManyMutationInput,
    unchanged?: { salary: number; currency: string },
  ): Promise<boolean> {
    const where: Prisma.OfferWhereInput = { id, organizationId, status: 'draft' };
    if (unchanged) Object.assign(where, { salary: unchanged.salary, currency: unchanged.currency });
    const updated = await tenantDb.offer.updateMany({ where, data });
    return updated.count === 1;
  },

  /** The edited terms, read back after updateDraft. */
  findEdited(organizationId: string, id: string) {
    return tenantDb.offer.findFirstOrThrow({ where: { id, organizationId }, select: OFFER_EDIT_SELECT });
  },
};
