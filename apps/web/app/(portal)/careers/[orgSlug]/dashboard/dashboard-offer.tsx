'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate, formatCandidateOfferSalary } from '../../../../../lib/candidate-format';
import { Button } from '../../../../../components/button';
import { ErrorState } from '../../../../../components/error-state';
import { StatusBadge, type StatusTone } from '../../../../../components/status-badge';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
import { DASHBOARD_CARD, DASHBOARD_ITEM, DASHBOARD_TITLE } from './dashboard-styles';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** A sent offer whose expiry has passed can no longer be signed (the API withholds its link). */
function isExpired(offer: { status: string; expiresAt: Date | string | null }, now: number): boolean {
  return offer.status === 'sent' && offer.expiresAt !== null && new Date(offer.expiresAt).getTime() <= now;
}

// "My Offer" section of the candidate dashboard (Wave 1 Slice 4). Lists the
// candidate's offers with key terms and links a 'sent' offer to the existing public
// signing flow (/offers/sign/[token]) — acceptance is NOT re-implemented in-portal.
// Data comes from candidatePortal.myOffers, scoped server-side to this candidate.
// Money with es-CR conventions, monthly first; dates in the organization's time zone (UTC when none).
export function DashboardOffer({ orgSlug, timeZone = null }: { orgSlug: string; timeZone?: string | null }) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.myOffers.useQuery({ orgSlug });
  const now = Date.now();

  const statusLabel = (s: string) => {
    switch (s) {
      case 'sent':
        return t.portalDashboard.offerStatusSent;
      case 'accepted':
        return t.portalDashboard.offerStatusAccepted;
      case 'declined':
        return t.portalDashboard.offerStatusDeclined;
      default:
        return s;
    }
  };
  const statusTone = (s: string): StatusTone => {
    if (s === 'accepted') return 'success';
    if (s === 'declined') return 'danger';
    if (s === 'expired') return 'neutral';
    return 'brand';
  };
  const pd = t.portalDashboard;
  const offers = data ?? [];

  return (
    <section aria-labelledby="dashboard-offer-title" className={DASHBOARD_CARD}>
      <h2 id="dashboard-offer-title" className={DASHBOARD_TITLE}>
        {pd.offer}
      </h2>

      {isLoading ? (
        <DashboardCardSkeleton label={pd.offerLoading} rows={1} />
      ) : isError ? (
        <ErrorState size="compact" title={pd.offerError} onRetry={() => void refetch()} />
      ) : offers.length === 0 ? (
        <p className="text-body text-secondary">{pd.offerEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {offers.map((offer) => {
            const expired = isExpired(offer, now);
            const shownStatus = expired ? 'expired' : offer.status;
            // An offer that expires within three days says so in the warning colour (and in words: the date).
            const expiresSoon =
              !expired && offer.expiresAt !== null && new Date(offer.expiresAt).getTime() - now < THREE_DAYS_MS;
            return (
              <li key={offer.id} className={DASHBOARD_ITEM}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-subheading font-semibold text-brand">{offer.vacancy.title}</h3>
                    {offer.vacancy.company?.name && (
                      <p className="break-words text-callout text-secondary">{offer.vacancy.company.name}</p>
                    )}
                  </div>
                  <StatusBadge tone={statusTone(shownStatus)} className="self-start">
                    {expired ? pd.offerStatusExpired : statusLabel(offer.status)}
                  </StatusBadge>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-callout text-secondary">{pd.offerSalary}</dt>
                    <dd className="text-body font-medium text-primary tabular-nums">{formatCandidateOfferSalary(offer.salary, offer.currency, { perYear: t.offers.perYear, perMonth: t.offers.perMonth }, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-callout text-secondary">{pd.offerStartDate}</dt>
                    <dd className="text-body font-medium text-primary">{formatCandidateDate(offer.startDate, locale, timeZone)}</dd>
                  </div>
                  <div>
                    <dt className="text-callout text-secondary">{pd.offerContract}</dt>
                    <dd className="text-body font-medium text-primary">{offer.contractType}</dd>
                  </div>
                </dl>

                {expired ? (
                  <p className="mt-2 text-callout text-secondary">{pd.offerExpiredNote}</p>
                ) : (
                  offer.expiresAt && (
                    <p className={`mt-2 text-callout font-medium ${expiresSoon ? 'text-warning' : 'text-secondary'}`}>
                      {pd.offerExpiresOn} {formatCandidateDate(offer.expiresAt, locale, timeZone)}
                    </p>
                  )
                )}

                {offer.status === 'sent' && offer.signingToken && (
                  <Button href={`/offers/sign/${offer.signingToken}`} className="mt-3">
                    {pd.offerReviewSign}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
