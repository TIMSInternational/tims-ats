'use client';

import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { candidateTimeZone, formatCandidateDate, formatCandidateOfferSalary } from '../../../../../lib/candidate-format';

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
  const { data, isLoading, isError } = trpc.candidatePortal.myOffers.useQuery({ orgSlug });
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
  const statusClasses = (s: string) => {
    if (s === 'accepted') return 'bg-[#ECFDF3] text-[#067647]';
    if (s === 'declined') return 'bg-[#FEF3F2] text-[#B42318]';
    if (s === 'expired') return 'bg-[#F6F6F6] text-[#585858]';
    return 'bg-[#F4F1FF] text-[#1F114C]';
  };

  const header = <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.offer}</h2>;

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-muted">{t.portalDashboard.offerLoading}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#B42318]">{t.portalDashboard.offerError}</p>
      </section>
    );
  }

  const offers = data ?? [];

  return (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}

      {offers.length === 0 ? (
        <p className="text-[12px] text-muted">{t.portalDashboard.offerEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {offers.map((offer) => {
            const expired = isExpired(offer, now);
            const shownStatus = expired ? 'expired' : offer.status;
            return (
            <li key={offer.id} className="rounded-xl border border-[#EDEDED] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#1F114C] truncate">{offer.vacancy.title}</p>
                  {offer.vacancy.company?.name && (
                    <p className="text-[12px] text-muted truncate">{offer.vacancy.company.name}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(shownStatus)}`}
                >
                  {expired ? t.portalDashboard.offerStatusExpired : statusLabel(offer.status)}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
                <div>
                  <dt className="text-muted">{t.portalDashboard.offerSalary}</dt>
                  <dd className="text-[#1F114C]">{formatCandidateOfferSalary(offer.salary, offer.currency, { perYear: t.offers.perYear, perMonth: t.offers.perMonth }, locale)}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t.portalDashboard.offerStartDate}</dt>
                  <dd className="text-[#1F114C]">
                    {formatCandidateDate(offer.startDate, locale, candidateTimeZone(timeZone, offer.vacancy.company?.timezone))}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t.portalDashboard.offerContract}</dt>
                  <dd className="text-[#1F114C] capitalize">{offer.contractType}</dd>
                </div>
              </dl>

              {expired ? (
                <p className="text-[12px] text-[#585858] mt-2">{t.portalDashboard.offerExpiredNote}</p>
              ) : (
                offer.expiresAt && (
                  <p className="text-[11px] text-muted mt-2">
                    {t.portalDashboard.offerExpiresOn}{' '}
                    {formatCandidateDate(offer.expiresAt, locale, candidateTimeZone(timeZone, offer.vacancy.company?.timezone))}
                  </p>
                )
              )}

              {offer.status === 'sent' && offer.signingToken && (
                <Link
                  href={`/offers/sign/${offer.signingToken}`}
                  className="mt-3 inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition"
                >
                  {t.portalDashboard.offerReviewSign}
                </Link>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
