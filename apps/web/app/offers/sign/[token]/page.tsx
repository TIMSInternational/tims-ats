'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { CANDIDATE_INTL_LOCALE, formatCandidateDate, formatCandidateOfferSalary } from '../../../../lib/candidate-format';
import { OrgLogo } from '../../../../components/org-logo';
import { Button } from '../../../../components/button';
import { CHOICE_INPUT_CLASSES, FIELD_LABEL_CLASSES, inputClasses } from '../../../../components/field-styles';
import { OfferSignStatus } from './offer-sign-status';
import { OfferSignDecline } from './offer-sign-decline';

export default function OfferSignPage() {
  const params = useParams();
  const token = params.token as string;
  const { t, locale } = useI18n();

  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [signatureName, setSignatureName] = useState('');

  const offer = trpc.offer.getBySigningToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const acceptMutation = trpc.offer.acceptByToken.useMutation({
    onSuccess: () => setAccepted(true),
  });

  const declineMutation = trpc.offer.declineByToken.useMutation({
    onSuccess: () => setDeclined(true),
  });

  if (offer.isLoading) {
    return <OfferSignStatus tone="brand" icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" title={t.offers.signLoading} subtitle={t.offers.signOneMoment} pulse />;
  }

  if (offer.error || !offer.data) {
    return <OfferSignStatus tone="danger" icon="M15 9l-6 6M9 9l6 6" circle title={t.offers.signInvalidLink} subtitle={t.offers.signInvalidLinkDesc} />;
  }

  const o = offer.data;
  const org = { name: o.organization.name, logo: o.organization.logo };

  if (o.status !== 'sent' && !accepted && !declined) {
    // A finished state, not a waiting one: a neutral check, and one full sentence per case. A converted
    // offer (the candidate accepted and was hired) reads as accepted, not as "no longer open".
    return (
      <OfferSignStatus
        tone="brand"
        icon="M9 12.75L11.25 15 15 9.75"
        circle
        organization={org}
        title={t.offers.signAlreadyAnswered}
        subtitle={o.status === 'accepted' || o.status === 'converted' ? t.offers.signAlreadyAccepted.replace('{org}', o.organization.name) : t.offers.signNoLongerOpen}
      />
    );
  }

  if (accepted) {
    return <OfferSignStatus tone="success" icon="M9 12.75L11.25 15 15 9.75" circle organization={org} title={t.offers.signAccepted} subtitle={`${t.offers.signAcceptedPrefix} ${o.candidate.firstName}. ${t.offers.signAcceptedSuffix}`} />;
  }

  if (declined) {
    return <OfferSignStatus tone="neutral" icon="M6 18L18 6M6 6l12 12" organization={org} title={t.offers.signDeclined} subtitle={t.offers.signDeclinedDesc} />;
  }

  const benefits = o.benefits as Record<string, string> | null;
  const benefitList = benefits ? Object.values(benefits) : [];
  // The signer's own calendar date (what they would write by hand next to their name).
  const today = new Intl.DateTimeFormat(CANDIDATE_INTL_LOCALE[locale], { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  return (
    <main className="min-h-dvh bg-surface-hover px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-2xl">
        {/* Header with org branding */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-popover">
          {/* Top bar */}
          <div className="flex items-center gap-4 bg-brand px-5 py-5 sm:px-8">
            <OrgLogo
              logo={o.organization.logo}
              name={o.organization.name}
              imgClassName="h-10 w-10 rounded-lg bg-white object-contain"
              fallbackClassName="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-lg"
              decorative
            />
            <div>
              <p className="text-heading font-semibold text-white">{o.organization.name}</p>
              <h1 className="text-callout text-white/80">{t.offers.signLetterTitle}</h1>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-7">
            {/* Greeting */}
            <div>
              <p className="text-base leading-relaxed text-primary sm:text-subheading">
                {t.offers.signGreeting} <strong>{o.candidate.firstName} {o.candidate.lastName}</strong>,
              </p>
              <p className="mt-3 max-w-prose text-base leading-relaxed text-secondary sm:text-subheading">
                {t.offers.signIntroPrefix}{' '}
                <strong className="text-brand">{o.vacancy.title}</strong> {t.offers.signIntroAt}{' '}
                {o.organization.name}. {t.offers.signIntroSuffix}
              </p>
            </div>

            {/* Offer details grid */}
            <section className="space-y-3 rounded-xl bg-brand-tint p-4 sm:p-5" aria-labelledby="offer-sign-details">
              <h2 id="offer-sign-details" className="mb-3 text-subheading font-semibold text-brand">{t.offers.signOfferDetails}</h2>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-callout text-secondary">{t.offers.signPosition}</dt>
                  <dd className="text-base font-medium text-primary sm:text-body">{o.vacancy.title}</dd>
                </div>
                <div>
                  <dt className="text-callout text-secondary">{t.offers.signBaseSalary}</dt>
                  <dd className="text-base font-medium text-primary sm:text-body">{formatCandidateOfferSalary(o.salary, o.currency, { perYear: t.offers.perYear, perMonth: t.offers.perMonth }, locale)}</dd>
                </div>
                <div>
                  <dt className="text-callout text-secondary">{t.offers.signContractType}</dt>
                  <dd className="text-base font-medium text-primary sm:text-body">{o.contractType}</dd>
                </div>
                <div>
                  <dt className="text-callout text-secondary">{t.offers.signStartDate}</dt>
                  {/* The organization's zone, like the candidate portal (UTC when it has none). */}
                  <dd className="text-base font-medium text-primary sm:text-body">{formatCandidateDate(o.startDate, locale, o.organization.timeZone)}</dd>
                </div>
              </dl>
            </section>

            {/* Benefits */}
            {benefitList.length > 0 && (
              <div>
                <h2 className="mb-2 text-subheading font-semibold text-brand">{t.offers.signBenefits}</h2>
                <ul className="space-y-1.5">
                  {benefitList.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-base text-secondary sm:text-body">
                      <svg className="mt-0.5 size-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Divider */}
            <hr className="border-border" />

            {/* Acceptance form */}
            <div className="space-y-4">
              <h2 className="text-subheading font-semibold text-brand">{t.offers.signAcceptanceTitle}</h2>

              {/* Terms checkbox */}
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className={`mt-0.5 ${CHOICE_INPUT_CLASSES}`}
                />
                <span className="text-base leading-snug text-primary sm:text-body">
                  {t.offers.signTermsAgreement}
                </span>
              </label>

              {/* Signature name */}
              <div>
                <label htmlFor="offer-sign-name" className={FIELD_LABEL_CLASSES}>
                  {t.offers.signFullNameLabel}
                </label>
                <input
                  id="offer-sign-name"
                  type="text"
                  autoComplete="name"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder={t.offers.signFullNamePlaceholder}
                  className={inputClasses('lg')}
                />
              </div>

              {/* Date (readonly) */}
              <div>
                <label htmlFor="offer-sign-date" className={FIELD_LABEL_CLASSES}>{t.offers.signDate}</label>
                <input
                  id="offer-sign-date"
                  type="text"
                  value={today}
                  readOnly
                  className={inputClasses('lg', 'bg-surface-hover text-secondary')}
                />
              </div>

              {/* Error */}
              {acceptMutation.error && (
                <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
                  {acceptMutation.error.message}
                </div>
              )}
              {declineMutation.error && (
                <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
                  {declineMutation.error.message}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3 pt-2">
                <Button
                  size="lg"
                  fullWidth
                  onClick={() => acceptMutation.mutate({ token, signatureName })}
                  disabled={!agreedTerms || signatureName.length < 2}
                  loading={acceptMutation.isPending}
                  loadingLabel={t.offers.signAccepting}
                >
                  {t.offers.signAcceptButton}
                </Button>
                <OfferSignDecline isPending={declineMutation.isPending} onDecline={() => declineMutation.mutate({ token })} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border bg-surface-hover px-5 py-4 sm:px-8">
            <p className="text-caption text-muted text-center">
              {t.offers.signConfidentialFooter}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
