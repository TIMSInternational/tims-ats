import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { offerDetailHref } from '../../../lib/offer-deep-link';

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type PendingVacancyApprovals = RouterOutputs['vacancy']['getPending'];
export type PendingOfferApprovals = RouterOutputs['offer']['getPending'];

export type ApprovalInboxItem = {
  key: string;
  kind: 'vacancy' | 'offer';
  /** Deep link to the item itself (B-27): the vacancy page, or the offers page opened on that offer. */
  href: string;
  primary: string;
  /** Vacancy: who created it. Offer: the vacancy title. */
  secondary: string;
  requestedAt: string;
};

function fullName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

export function vacancyApprovalHref(vacancyId: string): string {
  return `/recruitment/vacancies/${encodeURIComponent(vacancyId)}`;
}

export function offerApprovalHref(offerId: string): string {
  return offerDetailHref(offerId);
}

/** One list, oldest request first, so the item that has waited longest is on top. */
export function buildApprovalInboxItems(
  vacancies: PendingVacancyApprovals | undefined,
  offers: PendingOfferApprovals | undefined,
): ApprovalInboxItem[] {
  const items: ApprovalInboxItem[] = [
    ...(vacancies ?? []).map((row) => ({
      key: `vacancy-${row.approvalId}`,
      kind: 'vacancy' as const,
      href: vacancyApprovalHref(row.vacancy.id),
      primary: row.vacancy.title,
      secondary: fullName(row.vacancy.creator),
      requestedAt: new Date(row.requestedAt).toISOString(),
    })),
    ...(offers ?? []).map((row) => ({
      key: `offer-${row.approvalId}`,
      kind: 'offer' as const,
      href: offerApprovalHref(row.offer.id),
      primary: fullName(row.offer.candidate),
      secondary: row.offer.vacancy?.title ?? '',
      requestedAt: new Date(row.requestedAt).toISOString(),
    })),
  ];
  return items.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
