'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { formatAnnualOfferSalary } from '../../../../../lib/offer-salary';
import { useTenantLocale } from '../../../../../lib/tenant-locale-context';
import { Button } from '../../../../../components/button';
import { StatusBadge, type StatusTone } from '../../../../../components/status-badge';

/* ── Candidate Header subcomponent ── */

interface CandidateHeaderProps {
  offer: {
    candidate: { firstName: string; lastName: string; avatar: string | null };
    vacancy: { title: string };
  };
  statusLabel: string;
  statusTone: StatusTone;
  completedValidations: number;
  totalValidations: number;
  progressPct: number;
  /** B-20: the ring is hidden when the offer has no pre-employment checks (it read "0/0"). */
  showValidations: boolean;
  canAuthorize: boolean;
  authorizationReason?: string;
  showHireAction: boolean;
  isConverted: boolean;
  isAuthorizing?: boolean;
  onAuthorize?: () => void;
  onViewOnboarding?: () => void;
  onViewLetter?: () => void;
  onSendForSigning?: () => void;
  isGeneratingLink?: boolean;
  /** B-17: shown only to viewers who may send; when disabled, `reason` says why. */
  sendForSigning: { visible: boolean; enabled: boolean; reason?: string };
  /** Edit / withdraw / "Crear nueva oferta" (OfferManageActions). */
  manageActions?: ReactNode;
}

export function CandidateHeader({
  offer,
  statusLabel,
  statusTone,
  completedValidations,
  totalValidations,
  progressPct,
  showValidations,
  canAuthorize,
  authorizationReason,
  showHireAction,
  isConverted,
  isAuthorizing,
  onAuthorize,
  onViewOnboarding,
  onViewLetter,
  onSendForSigning,
  isGeneratingLink,
  sendForSigning,
  manageActions,
}: CandidateHeaderProps) {
  const { t } = useI18n();
  // One primary, trailing (buttons.md › Style): hiring when it is on offer, else sending for signature.
  const sendIsPrimary = !showHireAction;
  const sendBlocked = sendForSigning.visible && !sendForSigning.enabled && sendForSigning.reason;
  const hireBlocked = showHireAction && !canAuthorize && authorizationReason;
  const reasons = [sendBlocked ? sendForSigning.reason : null, hireBlocked ? authorizationReason : null].filter(
    (r): r is string => Boolean(r),
  );

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      <div className="flex flex-wrap items-center gap-4 md:gap-5">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-xl font-semibold text-white" aria-hidden="true">
          {offer.candidate.firstName.charAt(0)}
          {offer.candidate.lastName.charAt(0)}
        </div>
        <div className="min-w-40 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-title font-semibold text-brand">
              {offer.candidate.firstName} {offer.candidate.lastName}
            </h1>
            <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
          </div>
          <p className="text-body text-secondary">{offer.vacancy.title}</p>
        </div>

        {/* Progress ring */}
        {showValidations && (
        <div className="shrink-0 text-center">
          <div className="relative size-16">
            <svg className="size-16 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-border" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                className="stroke-success" strokeWidth="2.5"
                strokeDasharray={`${progressPct} ${100 - progressPct}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-subheading font-semibold text-brand tabular-nums">
                {completedValidations}/{totalValidations}
              </span>
            </div>
          </div>
          <p className="mt-1 text-caption text-secondary">{t.offers.checksCompleted}</p>
        </div>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="secondary" onClick={onViewLetter} icon={DOC_ICON}>
            {t.offers.viewOfferLetter}
          </Button>
          {isConverted && onViewOnboarding && (
            <Button variant="tertiary" onClick={onViewOnboarding}>
              {t.offers.viewOnboarding}
            </Button>
          )}
          {manageActions}
          {sendForSigning.visible && (
            <Button
              variant={sendIsPrimary ? 'primary' : 'secondary'}
              disabled={!sendForSigning.enabled}
              loading={isGeneratingLink}
              loadingLabel={t.offers.generating}
              aria-describedby={sendBlocked ? 'offer-action-reason' : undefined}
              onClick={onSendForSigning}
              icon={MAIL_ICON}
            >
              {t.offers.sendForSignature}
            </Button>
          )}
          {showHireAction && (
            <Button
              disabled={!canAuthorize}
              loading={isAuthorizing}
              aria-describedby={hireBlocked ? 'offer-action-reason' : undefined}
              onClick={onAuthorize}
            >
              {t.offers.authorizeHiring}
            </Button>
          )}
        </div>
      </div>
      {/* Why an action is unavailable, in the page rather than a hover-only tooltip (feedback.md). */}
      {reasons.length > 0 && (
        <p id="offer-action-reason" className="mt-3 text-callout text-secondary">
          {reasons.join(' · ')}
        </p>
      )}
    </div>
  );
}

const DOC_ICON = (
  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const MAIL_ICON = (
  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

/* ── Offer Card subcomponent ── */

interface OfferCardProps {
  offer: {
    salary: number;
    currency: string;
    startDate: Date | string | null;
    contractType: string | null;
    vacancy: { title: string };
    status: string;
    expiresAt?: Date | string | null;
  };
  benefitList: string[];
  terms: Record<string, string> | null;
}

export function OfferCard({ offer, benefitList, terms }: OfferCardProps) {
  const { t } = useI18n();
  const { intlLocale } = useTenantLocale();

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-card" aria-labelledby="offer-card-title">
      {/* The status is shown once, in the page header; this band only names the offer. */}
      <div className="bg-brand px-4 py-4 md:px-5">
        <p className="text-caption font-medium uppercase tracking-wide text-white/70">{t.offers.offerCard}</p>
        <h2 id="offer-card-title" className="mt-0.5 text-heading font-semibold text-white">{offer.vacancy.title}</h2>
      </div>
      <div className="p-4 md:p-5">
        <dl className="mb-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-secondary">{t.offers.baseSalary}</dt>
            <dd className="text-subheading font-semibold text-brand tabular-nums">
              {formatAnnualOfferSalary(offer.salary, offer.currency, { perYear: t.offers.perYear, perMonth: t.offers.perMonth }, intlLocale)}
            </dd>
          </div>
          {terms?.bonus && (
            <div>
              <dt className="text-caption text-secondary">{t.offers.bonusLabel}</dt>
              <dd className="text-subheading font-semibold text-brand tabular-nums">{terms.bonus}</dd>
            </div>
          )}
          <div>
            <dt className="text-caption text-secondary">{t.offers.startDate}</dt>
            <dd className="text-body font-medium text-primary">
              {offer.startDate ? formatDate(offer.startDate) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-secondary">{t.offers.contractType}</dt>
            <dd className="text-body font-medium text-primary">{offer.contractType || '—'}</dd>
          </div>
          {/* B-15: optional terms appear only when they were filled in (no wall of "—"). */}
          {terms?.schedule && (
            <div>
              <dt className="text-caption text-secondary">{t.offers.schedule}</dt>
              <dd className="text-body text-primary">{terms.schedule}</dd>
            </div>
          )}
          {terms?.modality && (
            <div>
              <dt className="text-caption text-secondary">{t.offers.modality}</dt>
              <dd className="text-body text-primary">{terms.modality}</dd>
            </div>
          )}
          {offer.expiresAt && offer.status === 'sent' && (
            <div>
              <dt className="text-caption text-secondary">{t.offers.linkValidUntil}</dt>
              <dd className="text-body text-primary">{formatDate(offer.expiresAt)}</dd>
            </div>
          )}
        </dl>
        {benefitList.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-caption text-secondary mb-2">{t.offers.benefitsIncluded}</p>
            <div className="flex flex-wrap gap-1.5">
              {benefitList.map((b, i) => (
                <span key={i} className="text-caption bg-surface text-secondary px-2 py-1 rounded-full">
                  {String(b)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
