'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, Clock, PenLine, X } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate, formatCandidateOfferSalary } from '../../../../../lib/candidate-format';
import { EvalButton } from './eval-button';
import { EvalChip } from './eval-chip';
import { EvalLoadError } from './eval-load-error';
import type { EvalChipTone } from './eval-control-styles';
import { EVAL_HINT_CLASSES } from './eval-styles';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
import {
  DASHBOARD_CARD,
  DASHBOARD_EMPTY,
  DASHBOARD_FACT,
  DASHBOARD_FACT_LABEL,
  DASHBOARD_ITEM,
  DASHBOARD_ITEM_HEAD,
  DASHBOARD_ITEM_META,
  DASHBOARD_ITEM_TITLE,
  DASHBOARD_LIST,
  DASHBOARD_TITLE,
} from './dashboard-styles';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// The panel's parts in the TIMS evaluation design (PCA). The terms are PCA FactTiles: the salary (long, monthly then
// yearly) spans the row, the start date and the contract share the next one; values in the PCA tile's mono, heading
// navy, allowed to wrap on a phone. Constants only: never a class list inside a ternary.
const TITLE_BLOCK = 'min-w-0';
const TERMS = 'm-0 mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2';
const TERM_WIDE = `${DASHBOARD_FACT} sm:col-span-2`;
const TERM_VALUE = 'm-0 font-eval-mono text-eval-md break-words text-eval-heading tabular-nums md:text-eval-lg';
/** The expiry line: the date in words, in the warning colour when it is within three days. */
const EXPIRY_LINE =
  'm-0 mt-3 flex items-start gap-1.5 text-eval-sm leading-[1.45] font-medium [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0';
const EXPIRY_SOON = `${EXPIRY_LINE} text-eval-warn`;
const EXPIRY_LATER = `${EXPIRY_LINE} text-eval-ink2`;
const EXPIRED_NOTE = `${EVAL_HINT_CLASSES} mt-3`;
const SIGN_ACTION = 'mt-4';

/** The chip's icon per shown status: sent waits on the candidate to review and sign. */
const STATUS_ICON: Record<string, ReactNode> = {
  sent: <PenLine aria-hidden="true" />,
  accepted: <Check aria-hidden="true" strokeWidth={2.5} />,
  declined: <X aria-hidden="true" strokeWidth={2.5} />,
  expired: <Clock aria-hidden="true" />,
};

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
  // PCA chip tones by meaning: a sent offer waits on the candidate (warn); accepted is done (ok); declined and expired
  // ended it (danger); anything else is informational (neutral).
  const statusTone = (s: string): EvalChipTone => {
    if (s === 'accepted') return 'ok';
    if (s === 'declined' || s === 'expired') return 'danger';
    if (s === 'sent') return 'warn';
    return 'neutral';
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
        <EvalLoadError title={pd.offerError} onRetry={() => void refetch()} />
      ) : offers.length === 0 ? (
        <p className={DASHBOARD_EMPTY}>{pd.offerEmpty}</p>
      ) : (
        <ul className={DASHBOARD_LIST}>
          {offers.map((offer) => {
            const expired = isExpired(offer, now);
            const shownStatus = expired ? 'expired' : offer.status;
            // An offer that expires within three days says so in the warning colour (and in words: the date).
            const expiresSoon =
              !expired && offer.expiresAt !== null && new Date(offer.expiresAt).getTime() - now < THREE_DAYS_MS;
            return (
              <li key={offer.id} className={DASHBOARD_ITEM}>
                <div className={DASHBOARD_ITEM_HEAD}>
                  <div className={TITLE_BLOCK}>
                    <h3 className={DASHBOARD_ITEM_TITLE}>{offer.vacancy.title}</h3>
                    {offer.vacancy.company?.name && <p className={DASHBOARD_ITEM_META}>{offer.vacancy.company.name}</p>}
                  </div>
                  <EvalChip tone={statusTone(shownStatus)} icon={STATUS_ICON[shownStatus]}>
                    {expired ? pd.offerStatusExpired : statusLabel(offer.status)}
                  </EvalChip>
                </div>

                <dl className={TERMS}>
                  <div className={TERM_WIDE}>
                    <dt className={DASHBOARD_FACT_LABEL}>{pd.offerSalary}</dt>
                    <dd className={TERM_VALUE}>
                      {formatCandidateOfferSalary(
                        offer.salary,
                        offer.currency,
                        { perYear: t.offers.perYear, perMonth: t.offers.perMonth },
                        locale,
                      )}
                    </dd>
                  </div>
                  <div className={DASHBOARD_FACT}>
                    <dt className={DASHBOARD_FACT_LABEL}>{pd.offerStartDate}</dt>
                    <dd className={TERM_VALUE}>{formatCandidateDate(offer.startDate, locale, timeZone)}</dd>
                  </div>
                  <div className={DASHBOARD_FACT}>
                    <dt className={DASHBOARD_FACT_LABEL}>{pd.offerContract}</dt>
                    <dd className={TERM_VALUE}>{offer.contractType}</dd>
                  </div>
                </dl>

                {expired ? (
                  <p className={EXPIRED_NOTE}>{pd.offerExpiredNote}</p>
                ) : (
                  offer.expiresAt && (
                    <p className={expiresSoon ? EXPIRY_SOON : EXPIRY_LATER}>
                      <Clock aria-hidden="true" />
                      <span>
                        {pd.offerExpiresOn} {formatCandidateDate(offer.expiresAt, locale, timeZone)}
                      </span>
                    </p>
                  )
                )}

                {offer.status === 'sent' && offer.signingToken && (
                  <EvalButton
                    href={`/offers/sign/${offer.signingToken}`}
                    width="bar"
                    className={SIGN_ACTION}
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                  >
                    {pd.offerReviewSign}
                  </EvalButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
