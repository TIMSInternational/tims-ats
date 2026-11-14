'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { timeZoneLabel } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { Button, ErrorState, PageHeader, Skeleton, StatusBadge, TEXT_LINK_CLASSES } from '../../../../components';
import { getSupportEmail } from '../../../../lib/support-email';
import { careersPageUrl, countryLabel, currencyLabel, languageLabel } from '../../../../lib/org-profile-format';

// /settings/organization — "Datos de la organización" (audit finding D-11). A read-only card that shows the
// country, currency, time zone, language, careers page and candidate contact mailbox exactly as the product
// resolves them, so an admin can verify the setup without asking support. Changes still go through support.
// Data: organization.getCurrent (an explicit, non-sensitive projection; no raw settings or billing data).

const SECTION_CLS = 'max-w-3xl rounded-xl bg-white p-5 shadow-card';

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string | null }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border-subtle py-3 last:border-0 md:grid-cols-[220px_1fr] md:gap-4">
      <dt className="text-callout font-medium text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-body text-primary">
        {value}
        {hint && <p className="mt-0.5 text-callout text-secondary">{hint}</p>}
      </dd>
    </div>
  );
}

export default function OrganizationProfilePage() {
  const { t, locale } = useI18n();
  const m = t.orgProfile;
  const ui = locale === 'EN' ? 'en' : 'es';
  const profile = trpc.organization.getCurrent.useQuery(undefined, { retry: false });
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  // A gap in setup reads as a state, not as data (settings-22).
  const missing = <StatusBadge tone="warning">{m.notConfigured}</StatusBadge>;
  const supportEmail = getSupportEmail();
  const fromCompany = (company: string | null) => (company ? m.fromCompany.replace('{company}', company) : null);

  let body: ReactNode;
  if (profile.isLoading) body = <Skeleton className="h-48 w-full rounded-lg" />;
  else if (profile.isError || !profile.data)
    body = <ErrorState onRetry={() => void profile.refetch()} error={profile.error} />;
  else {
    const p = profile.data;
    const careers = origin ? careersPageUrl(origin, p.slug) : null;
    body = (
      <dl>
        <Row label={m.name} value={p.name} />
        <Row label={m.country} value={countryLabel(p.country, ui) ?? missing} />
        <Row
          label={m.currency}
          value={currencyLabel(p.currency, ui) ?? missing}
          hint={p.currencySource === 'company' ? fromCompany(p.companyName) : null}
        />
        <Row
          label={m.timeZone}
          value={p.timeZone ? `${timeZoneLabel(p.timeZone, ui)} · ${p.timeZone}` : m.timeZoneUtc}
          hint={p.timeZoneSource === 'company' ? fromCompany(p.companyName) : m.timeZoneHint}
        />
        <Row label={m.language} value={languageLabel(p.locale, ui) ?? missing} />
        <Row
          label={m.careersUrl}
          value={
            careers ? (
              <>
                <a
                  href={careers}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby="org-careers-new-tab"
                  className={`${TEXT_LINK_CLASSES} break-all underline`}
                >
                  {careers}
                  <svg
                    className="size-3.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
                <span id="org-careers-new-tab" className="sr-only">
                  {m.opensInNewTab}
                </span>
              </>
            ) : (
              missing
            )
          }
        />
        <Row
          label={m.candidateContact}
          value={p.candidateContactEmail ?? missing}
          hint={
            p.candidateContactEmail
              ? m.candidateContactHint
              : p.candidateContactSource === 'billing'
                ? m.candidateContactBilling
                : m.candidateContactMissing
          }
        />
      </dl>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader
        title={m.title}
        description={m.subtitle}
        actions={
          supportEmail && (
            <Button
              variant="secondary"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent(m.requestChangeSubject)}`}
            >
              {m.requestChange}
            </Button>
          )
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <section className={SECTION_CLS} aria-label={m.title}>
          {body}
        </section>
      </div>
    </div>
  );
}
